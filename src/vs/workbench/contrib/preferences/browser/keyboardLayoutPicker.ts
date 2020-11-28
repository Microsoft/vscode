/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { StatusbarAlignment, IStatusbarService, IStatusbarEntryAccessor } from 'vs/workbench/services/statusbar/common/statusbar';
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { parseKeyboardLayoutDescription, areKeyboardLayoutsEqual, getKeyboardLayoutId, IKeyboardLayoutService, IKeyboardLayoutInfo } from 'vs/platform/keyboardLayout/common/keyboardLayout';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actions';
import { KEYBOARD_LAYOUT_OPEN_PICKER } from 'vs/workbench/contrib/preferences/common/preferences';
import { Action } from 'vs/base/common/actions';
import { isMacintosh, isWindows } from 'vs/base/common/platform';
import { QuickPickInput, IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { VSBuffer } from 'vs/base/common/buffer';
import { IEditorPane } from 'vs/workbench/common/editor';

export class KeyboardLayoutPickerContribution extends Disposable implements IWorkbenchContribution {
	private readonly pickerElement = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

	constructor(
		@IKeyboardLayoutService private readonly keyboardLayoutService: IKeyboardLayoutService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
	) {
		super();

		let layout = this.keyboardLayoutService.getCurrentKeyboardLayout();
		if (layout) {
			let layoutInfo = parseKeyboardLayoutDescription(layout);
			const text = nls.localize('keyboardLayout', "Layout: {0}", layoutInfo.label);

			this.pickerElement.value = this.statusbarService.addEntry(
				{
					text,
					ariaLabel: text,
					command: KEYBOARD_LAYOUT_OPEN_PICKER
				},
				'status.workbench.keyboardLayout',
				nls.localize('status.workbench.keyboardLayout', "Keyboard Layout"),
				StatusbarAlignment.RIGHT
			);
		}

		this._register(keyboardLayoutService.onDidChangeKeyboardLayout(() => {
			let layout = this.keyboardLayoutService.getCurrentKeyboardLayout();
			let layoutInfo = parseKeyboardLayoutDescription(layout);

			if (this.pickerElement.value) {
				const text = nls.localize('keyboardLayout', "Layout: {0}", layoutInfo.label);
				this.pickerElement.value.update({
					text,
					ariaLabel: text,
					command: KEYBOARD_LAYOUT_OPEN_PICKER
				});
			} else {
				const text = nls.localize('keyboardLayout', "Layout: {0}", layoutInfo.label);
				this.pickerElement.value = this.statusbarService.addEntry(
					{
						text,
						ariaLabel: text,
						command: KEYBOARD_LAYOUT_OPEN_PICKER
					},
					'status.workbench.keyboardLayout',
					nls.localize('status.workbench.keyboardLayout', "Keyboard Layout"),
					StatusbarAlignment.RIGHT
				);
			}
		}));
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(KeyboardLayoutPickerContribution, LifecyclePhase.Starting);

interface LayoutQuickPickItem extends IQuickPickItem {
	layout: IKeyboardLayoutInfo;
}

export class KeyboardLayoutPickerAction extends Action {
	static readonly ID = KEYBOARD_LAYOUT_OPEN_PICKER;
	static readonly LABEL = nls.localize('keyboard.chooseLayout', "Change Keyboard Layout");

	private static DEFAULT_CONTENT: string = [
		`// ${nls.localize('displayLanguage', 'Defines the keyboard layout used in VS Code in the browser environment.')}`,
		`// ${nls.localize('doc', 'Open VS Code and run "Developer: Inspect Key Mappings (JSON)" from Command Palette.')}`,
		``,
		`// Once you have the keyboard layout info, please paste it below.`,
		'\n'
	].join('\n');

	constructor(
		actionId: string,
		actionLabel: string,
		@IFileService private readonly fileService: IFileService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IKeyboardLayoutService private readonly keyboardLayoutService: IKeyboardLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(actionId, actionLabel, undefined, true);
	}

	async run(): Promise<void> {
		let layouts = this.keyboardLayoutService.getAllKeyboardLayouts();
		let currentLayout = this.keyboardLayoutService.getCurrentKeyboardLayout();
		let layoutConfig = this.configurationService.getValue('keyboard.layout');
		let isAutoDetect = layoutConfig === 'autodetect';

		const picks: QuickPickInput[] = layouts.map(layout => {
			const picked = !isAutoDetect && areKeyboardLayoutsEqual(currentLayout, layout);
			const layoutInfo = parseKeyboardLayoutDescription(layout);
			return {
				layout: layout,
				label: [layoutInfo.label, (layout && layout.isUserKeyboardLayout) ? '(User configured layout)' : ''].join(' '),
				id: (<any>layout).text || (<any>layout).lang || (<any>layout).layout,
				description: layoutInfo.description + (picked ? ' (Current layout)' : ''),
				picked: !isAutoDetect && areKeyboardLayoutsEqual(currentLayout, layout)
			};
		}).sort((a: IQuickPickItem, b: IQuickPickItem) => {
			return a.label < b.label ? -1 : (a.label > b.label ? 1 : 0);
		});

		if (picks.length > 0) {
			const platform = isMacintosh ? 'Mac' : isWindows ? 'Win' : 'Linux';
			picks.unshift({ type: 'separator', label: nls.localize('layoutPicks', "Keyboard Layouts ({0})", platform) });
		}

		let configureKeyboardLayout: IQuickPickItem = { label: nls.localize('configureKeyboardLayout', "Configure Keyboard Layout") };

		picks.unshift(configureKeyboardLayout);

		// Offer to "Auto Detect"
		const autoDetectMode: IQuickPickItem = {
			label: nls.localize('autoDetect', "Auto Detect"),
			description: isAutoDetect ? `Current: ${parseKeyboardLayoutDescription(currentLayout).label}` : undefined,
			picked: isAutoDetect ? true : undefined
		};

		picks.unshift(autoDetectMode);

		const pick = await this.quickInputService.pick(picks, { placeHolder: nls.localize('pickKeyboardLayout', "Select Keyboard Layout"), matchOnDescription: true });
		if (!pick) {
			return;
		}

		if (pick === autoDetectMode) {
			// set keymap service to auto mode
			this.configurationService.updateValue('keyboard.layout', 'autodetect');
			return;
		}

		if (pick === configureKeyboardLayout) {
			const file = this.environmentService.keyboardLayoutResource;

			await this.fileService.resolve(file).then(undefined, (error) => {
				return this.fileService.createFile(file, VSBuffer.fromString(KeyboardLayoutPickerAction.DEFAULT_CONTENT));
			}).then((stat): Promise<IEditorPane | undefined> | undefined => {
				if (!stat) {
					return undefined;
				}
				return this.editorService.openEditor({
					resource: stat.resource,
					mode: 'jsonc',
					options: { pinned: true }
				});
			}, (error) => {
				throw new Error(nls.localize('fail.createSettings', "Unable to create '{0}' ({1}).", file.toString(), error));
			});

			return Promise.resolve();
		}

		this.configurationService.updateValue('keyboard.layout', getKeyboardLayoutId((<LayoutQuickPickItem>pick).layout));
	}
}

const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.from(KeyboardLayoutPickerAction, {}), 'Preferences: Change Keyboard Layout', nls.localize('preferences', "Preferences"));
