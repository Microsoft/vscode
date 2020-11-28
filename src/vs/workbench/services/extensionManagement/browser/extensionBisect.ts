/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IExtensionManagementService, IGlobalExtensionEnablementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ExtensionType, IExtension } from 'vs/platform/extensions/common/extensions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { INotificationService, IPromptChoice, Severity } from 'vs/platform/notification/common/notification';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { createDecorator, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ILogService } from 'vs/platform/log/common/log';
import { IProductService } from 'vs/platform/product/common/productService';
import { IWorkbenchIssueService } from 'vs/workbench/services/issue/common/issue';

// --- bisect service

export const IExtensionBisectService = createDecorator<IExtensionBisectService>('IExtensionBisectService');

export interface IExtensionBisectService {

	readonly _serviceBrand: undefined;

	isDisabledByBisect(extension: IExtension): boolean;
	isActive: boolean;
	disabledCount: number;
	start(extensions: ILocalExtension[]): Promise<void>;
	next(seeingBad: boolean): Promise<{ id: string, bad: boolean } | undefined>;
	reset(): Promise<void>;
}

class BisectState {

	static fromJSON(raw: string | undefined): BisectState | undefined {
		if (!raw) {
			return undefined;
		}
		try {
			interface Raw extends BisectState { }
			const data: Raw = JSON.parse(raw);
			return new BisectState(data.extensions, data.low, data.high);
		} catch {
			return undefined;
		}
	}

	readonly mid: number;

	constructor(
		readonly extensions: string[],
		readonly low: number,
		readonly high: number,
	) {
		this.mid = ((low + high) / 2) | 0;
	}
}

class ExtensionBisectService implements IExtensionBisectService {

	declare readonly _serviceBrand: undefined;

	private static readonly _storageKey = 'extensionBisectState';

	private readonly _state: BisectState | undefined;
	private readonly _disabled = new Map<string, boolean>();

	constructor(
		@ILogService logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
	) {
		const raw = _storageService.get(ExtensionBisectService._storageKey, StorageScope.GLOBAL);
		this._state = BisectState.fromJSON(raw);

		if (this._state) {
			const { mid, high } = this._state;
			for (let i = 0; i < this._state.extensions.length; i++) {
				const isDisabled = i >= mid && i < high;
				this._disabled.set(this._state.extensions[i], isDisabled);
			}
			logService.warn('extension BISECT active', [...this._disabled]);
		}
	}

	get isActive() {
		return !!this._state;
	}

	get disabledCount() {
		return this._state ? this._state.high - this._state.mid : -1;
	}

	isDisabledByBisect(extension: IExtension): boolean {
		if (!this._state) {
			return false;
		}
		const disabled = this._disabled.get(extension.identifier.id);
		return disabled ?? false;
	}

	async start(extensions: ILocalExtension[]): Promise<void> {
		if (this._state) {
			throw new Error('invalid state');
		}
		const extensionIds = extensions.map(ext => ext.identifier.id);
		const newState = new BisectState(extensionIds, 0, extensionIds.length);
		this._storageService.store(ExtensionBisectService._storageKey, JSON.stringify(newState), StorageScope.GLOBAL, StorageTarget.MACHINE);
		await this._storageService.flush();
	}

	async next(seeingBad: boolean): Promise<{ id: string; bad: boolean; } | undefined> {
		if (!this._state) {
			throw new Error('invalid state');
		}
		// check if there is only one left
		if (this._state.low === this._state.high - 1) {
			await this.reset();
			return { id: this._state.extensions[this._state.low], bad: seeingBad };
		}
		// the second half is disabled so if there is still bad it must be
		// in the first half
		const nextState = new BisectState(
			this._state.extensions,
			seeingBad ? this._state.low : this._state.mid,
			seeingBad ? this._state.mid : this._state.high,
		);
		this._storageService.store(ExtensionBisectService._storageKey, JSON.stringify(nextState), StorageScope.GLOBAL, StorageTarget.MACHINE);
		await this._storageService.flush();
		return undefined;
	}

	async reset(): Promise<void> {
		this._storageService.remove(ExtensionBisectService._storageKey, StorageScope.GLOBAL);
		await this._storageService.flush();
	}
}

registerSingleton(IExtensionBisectService, ExtensionBisectService, true);

// --- bisect UI

class ExtensionBisectUi {

	static ctxIsBisectActive = new RawContextKey('isExtensionBisectActive', false);

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@IExtensionBisectService private readonly _extensionBisectService: IExtensionBisectService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		if (_extensionBisectService.isActive) {
			ExtensionBisectUi.ctxIsBisectActive.bindTo(contextKeyService).set(true);
			this._showBisectPrompt();
		}
	}

	private _showBisectPrompt(): void {

		const goodPrompt: IPromptChoice = {
			label: 'Good now',
			run: () => this._commandService.executeCommand('extension.bisect.next', false)
		};
		const badPrompt: IPromptChoice = {
			label: 'This is bad',
			run: () => this._commandService.executeCommand('extension.bisect.next', true)
		};
		const stop: IPromptChoice = {
			label: 'Stop Bisect',
			run: () => this._commandService.executeCommand('extension.bisect.stop')
		};

		this._notificationService.prompt(
			Severity.Info,
			localize('bisect', "Extension Bisect is active and has disabled {0} extensions. Check if you can still reproduce the problem and proceed by selecting from these options.", this._extensionBisectService.disabledCount),
			[goodPrompt, badPrompt, stop],
			{ sticky: true }
		);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench).registerWorkbenchContribution(
	ExtensionBisectUi,
	LifecyclePhase.Restored
);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'extension.bisect.start',
			title: localize('title.start', "Start Extension Bisect"),
			category: localize('help', "Help"),
			f1: true,
			precondition: ExtensionBisectUi.ctxIsBisectActive.negate()
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const dialogService = accessor.get(IDialogService);
		const hostService = accessor.get(IHostService);
		const extensionManagement = accessor.get(IExtensionManagementService);
		const extensionEnablementService = accessor.get(IGlobalExtensionEnablementService);
		const extensionsBisect = accessor.get(IExtensionBisectService);

		const disabled = new Set(extensionEnablementService.getDisabledExtensions().map(id => id.id));
		const extensions = (await extensionManagement.getInstalled(ExtensionType.User)).filter(ext => !disabled.has(ext.identifier.id));

		const res = await dialogService.confirm({
			message: localize('msg.start', "Extension Bisect"),
			detail: localize('detail.start', "Extension Bisect will use binary search to find an extension that causes a problem. During the process the window reloads repeatedly (~{0} times). Each time you must confirm if you are still seeing problems.", 1 + Math.log2(extensions.length) | 0),
			primaryButton: localize('msg2', "Start Extension Bisect")
		});

		if (res.confirmed) {
			await extensionsBisect.start(extensions);
			hostService.reload();
		}
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'extension.bisect.next',
			title: localize('title.isBad', "Continue Extension Bisect"),
			category: localize('help', "Help"),
			f1: true,
			precondition: ExtensionBisectUi.ctxIsBisectActive
		});
	}

	async run(accessor: ServicesAccessor, seeingBad: boolean | undefined): Promise<void> {
		const dialogService = accessor.get(IDialogService);
		const hostService = accessor.get(IHostService);
		const bisectService = accessor.get(IExtensionBisectService);
		const productService = accessor.get(IProductService);
		const extensionEnablementService = accessor.get(IGlobalExtensionEnablementService);
		const issueService = accessor.get(IWorkbenchIssueService);

		if (!bisectService.isActive) {
			return;
		}
		if (seeingBad === undefined) {
			seeingBad = await this._checkForBad(dialogService);
		}
		if (seeingBad === undefined) {
			await bisectService.reset();
			hostService.reload();
			return;
		}
		const done = await bisectService.next(seeingBad);
		if (!done) {
			hostService.reload();
			return;
		}

		if (done.bad) {
			// DONE but nothing found
			await dialogService.show(Severity.Info, localize('done.msg', "Extension Bisect"), [], {
				detail: localize('done.detail2', "Extension Bisect is done but no extension has been identified. This might be a problem with {0}", productService.nameShort)
			});

		} else {
			// DONE and identified extension
			const res = await dialogService.show(Severity.Info, localize('done.msg', "Extension Bisect"),
				[localize('report', "Report Issue & Continue"), localize('done', "Continue")],
				// [],
				{
					detail: localize('done.detail', "Extension Bisect is done and has identified {0} as the extension causing the problem.", done.id),
					checkbox: { label: localize('done.disbale', "Keep this extension disabled"), checked: true },
					cancelId: 1
				}
			);
			if (res.checkboxChecked) {
				await extensionEnablementService.disableExtension({ id: done.id }, undefined);
			}
			if (res.choice === 0) {
				await issueService.openReporter({ extensionId: done.id });
			}
		}
		await bisectService.reset();
		hostService.reload();
	}

	private async _checkForBad(dialogService: IDialogService) {
		const options = {
			cancelId: 2,
			detail: localize('detail.next', "Are you still seeing the problem for which you have started extension bisect?")
		};
		const res = await dialogService.show(
			Severity.Info,
			localize('msg.next', "Extension Bisect"),
			[localize('next.good', "Good now"), localize('next.bad', "This is bad"), localize('next.stop', "Stop Bisect")],
			options
		);
		if (res.choice === options.cancelId) {
			return undefined;
		}
		return res.choice === 1;
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'extension.bisect.stop',
			title: localize('title.stop', "Stop Extension Bisect"),
			category: localize('help', "Help"),
			f1: true,
			precondition: ExtensionBisectUi.ctxIsBisectActive
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const extensionsBisect = accessor.get(IExtensionBisectService);
		const hostService = accessor.get(IHostService);
		await extensionsBisect.reset();
		hostService.reload();
	}
});
