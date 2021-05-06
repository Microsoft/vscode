/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService, createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IExtensionService, IExtensionHostProfile } from 'vs/workbench/services/extensions/common/extensions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { Event } from 'vs/base/common/event';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IContextKeyService, RawContextKey, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ILabelService } from 'vs/platform/label/common/label';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { SlowExtensionAction } from 'vs/workbench/contrib/extensions/electron-sandbox/extensionsSlowActions';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ReportExtensionIssueAction } from 'vs/workbench/contrib/extensions/electron-sandbox/reportExtensionIssueAction';
import { AbstractRuntimeExtensionsEditor, IRuntimeExtension } from 'vs/workbench/contrib/extensions/browser/abstractRuntimeExtensionsEditor';
import { VSBuffer } from 'vs/base/common/buffer';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';

export const IExtensionHostProfileService = createDecorator<IExtensionHostProfileService>('extensionHostProfileService');
export const CONTEXT_PROFILE_SESSION_STATE = new RawContextKey<string>('profileSessionState', 'none');
export const CONTEXT_EXTENSION_HOST_PROFILE_RECORDED = new RawContextKey<boolean>('extensionHostProfileRecorded', false);

export enum ProfileSessionState {
	None = 0,
	Starting = 1,
	Running = 2,
	Stopping = 3
}

export interface IExtensionHostProfileService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeState: Event<void>;
	readonly onDidChangeLastProfile: Event<void>;

	readonly state: ProfileSessionState;
	readonly lastProfile: IExtensionHostProfile | null;

	startProfiling(): void;
	stopProfiling(): void;

	getUnresponsiveProfile(extensionId: ExtensionIdentifier): IExtensionHostProfile | undefined;
	setUnresponsiveProfile(extensionId: ExtensionIdentifier, profile: IExtensionHostProfile): void;
}

export class RuntimeExtensionsEditor extends AbstractRuntimeExtensionsEditor {

	private _profileInfo: IExtensionHostProfile | null;
	private _extensionsHostRecorded: IContextKey<boolean>;
	private _profileSessionState: IContextKey<string>;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionService extensionService: IExtensionService,
		@INotificationService notificationService: INotificationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ILabelService labelService: ILabelService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IExtensionHostProfileService private readonly _extensionHostProfileService: IExtensionHostProfileService,
	) {
		super(telemetryService, themeService, contextKeyService, extensionsWorkbenchService, extensionService, notificationService, contextMenuService, instantiationService, storageService, labelService, environmentService);
		this._profileInfo = this._extensionHostProfileService.lastProfile;
		this._extensionsHostRecorded = CONTEXT_EXTENSION_HOST_PROFILE_RECORDED.bindTo(contextKeyService);
		this._profileSessionState = CONTEXT_PROFILE_SESSION_STATE.bindTo(contextKeyService);

		this._register(this._extensionHostProfileService.onDidChangeLastProfile(() => {
			this._profileInfo = this._extensionHostProfileService.lastProfile;
			this._extensionsHostRecorded.set(!!this._profileInfo);
			this._updateExtensions();
		}));
		this._register(this._extensionHostProfileService.onDidChangeState(() => {
			const state = this._extensionHostProfileService.state;
			this._profileSessionState.set(ProfileSessionState[state].toLowerCase());
		}));
	}

	protected _getProfileInfo(): IExtensionHostProfile | null {
		return this._profileInfo;
	}

	protected _getUnresponsiveProfile(extensionId: ExtensionIdentifier): IExtensionHostProfile | undefined {
		return this._extensionHostProfileService.getUnresponsiveProfile(extensionId);
	}

	protected _createSlowExtensionAction(element: IRuntimeExtension): Action | null {
		if (element.unresponsiveProfile) {
			return this._instantiationService.createInstance(SlowExtensionAction, element.description, element.unresponsiveProfile);
		}
		return null;
	}

	protected _createReportExtensionIssueAction(element: IRuntimeExtension): Action | null {
		return this._instantiationService.createInstance(ReportExtensionIssueAction, element);
	}

	protected _createSaveExtensionHostProfileAction(): Action | null {
		return this._instantiationService.createInstance(SaveExtensionHostProfileAction, SaveExtensionHostProfileAction.ID, SaveExtensionHostProfileAction.LABEL);
	}

	protected _createProfileAction(): Action | null {
		const state = this._extensionHostProfileService.state;
		const profileAction = (
			state === ProfileSessionState.Running
				? this._instantiationService.createInstance(StopExtensionHostProfileAction, StopExtensionHostProfileAction.ID, StopExtensionHostProfileAction.LABEL)
				: this._instantiationService.createInstance(StartExtensionHostProfileAction, StartExtensionHostProfileAction.ID, StartExtensionHostProfileAction.LABEL)
		);
		return profileAction;
	}
}

export class StartExtensionHostProfileAction extends Action {
	static readonly ID = 'workbench.extensions.action.extensionHostProfile';
	static readonly LABEL = nls.localize('extensionHostProfileStart', "Start Extension Host Profile");

	constructor(
		id: string = StartExtensionHostProfileAction.ID, label: string = StartExtensionHostProfileAction.LABEL,
		@IExtensionHostProfileService private readonly _extensionHostProfileService: IExtensionHostProfileService,
	) {
		super(id, label);
	}

	override run(): Promise<any> {
		this._extensionHostProfileService.startProfiling();
		return Promise.resolve();
	}
}

export class StopExtensionHostProfileAction extends Action {
	static readonly ID = 'workbench.extensions.action.stopExtensionHostProfile';
	static readonly LABEL = nls.localize('stopExtensionHostProfileStart', "Stop Extension Host Profile");

	constructor(
		id: string = StartExtensionHostProfileAction.ID, label: string = StartExtensionHostProfileAction.LABEL,
		@IExtensionHostProfileService private readonly _extensionHostProfileService: IExtensionHostProfileService,
	) {
		super(id, label);
	}

	override run(): Promise<any> {
		this._extensionHostProfileService.stopProfiling();
		return Promise.resolve();
	}
}

export class SaveExtensionHostProfileAction extends Action {

	static readonly LABEL = nls.localize('saveExtensionHostProfile', "Save Extension Host Profile");
	static readonly ID = 'workbench.extensions.action.saveExtensionHostProfile';

	constructor(
		id: string = SaveExtensionHostProfileAction.ID, label: string = SaveExtensionHostProfileAction.LABEL,
		@INativeHostService private readonly _nativeHostService: INativeHostService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IExtensionHostProfileService private readonly _extensionHostProfileService: IExtensionHostProfileService,
		@IFileService private readonly _fileService: IFileService
	) {
		super(id, label, undefined, false);
		this._extensionHostProfileService.onDidChangeLastProfile(() => {
			this.enabled = (this._extensionHostProfileService.lastProfile !== null);
		});
	}

	override run(): Promise<any> {
		return Promise.resolve(this._asyncRun());
	}

	private async _asyncRun(): Promise<any> {
		let picked = await this._nativeHostService.showSaveDialog({
			title: 'Save Extension Host Profile',
			buttonLabel: 'Save',
			defaultPath: `CPU-${new Date().toISOString().replace(/[\-:]/g, '')}.cpuprofile`,
			filters: [{
				name: 'CPU Profiles',
				extensions: ['cpuprofile', 'txt']
			}]
		});

		if (!picked || !picked.filePath || picked.canceled) {
			return;
		}

		const profileInfo = this._extensionHostProfileService.lastProfile;
		let dataToWrite: object = profileInfo ? profileInfo.data : {};

		let savePath = picked.filePath;

		if (this._environmentService.isBuilt) {
			const profiler = await import('v8-inspect-profiler');
			// when running from a not-development-build we remove
			// absolute filenames because we don't want to reveal anything
			// about users. We also append the `.txt` suffix to make it
			// easier to attach these files to GH issues
			let tmp = profiler.rewriteAbsolutePaths({ profile: dataToWrite as any }, 'piiRemoved');
			dataToWrite = tmp.profile;

			savePath = savePath + '.txt';
		}

		return this._fileService.writeFile(URI.file(savePath), VSBuffer.fromString(JSON.stringify(profileInfo ? profileInfo.data : {}, null, '\t')));
	}
}
