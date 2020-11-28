/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { ICommandQuickPick, CommandsHistory } from 'vs/platform/quickinput/browser/commandsQuickAccess';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IMenuService, MenuId, MenuItemAction, SubmenuItemAction, Action2 } from 'vs/platform/actions/common/actions';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { CancellationToken } from 'vs/base/common/cancellation';
import { timeout } from 'vs/base/common/async';
import { DisposableStore, toDisposable, dispose } from 'vs/base/common/lifecycle';
import { AbstractEditorCommandsQuickAccessProvider } from 'vs/editor/contrib/quickAccess/commandsQuickAccess';
import { IEditor } from 'vs/editor/common/editorCommon';
import { Language } from 'vs/base/common/platform';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { DefaultQuickAccessFilterValue } from 'vs/platform/quickinput/common/quickAccess';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkbenchQuickAccessConfiguration } from 'vs/workbench/browser/quickaccess';
import { Codicon, stripCodicons } from 'vs/base/common/codicons';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { TriggerAction } from 'vs/platform/quickinput/browser/pickerQuickAccess';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';

export class CommandsQuickAccessProvider extends AbstractEditorCommandsQuickAccessProvider {

	// If extensions are not yet registered, we wait for a little moment to give them
	// a chance to register so that the complete set of commands shows up as result
	// We do not want to delay functionality beyond that time though to keep the commands
	// functional.
	private readonly extensionRegistrationRace = Promise.race([
		timeout(800),
		this.extensionService.whenInstalledExtensionsRegistered()
	]);

	protected get activeTextEditorControl(): IEditor | undefined { return this.editorService.activeTextEditorControl; }

	get defaultFilterValue(): DefaultQuickAccessFilterValue | undefined {
		if (this.configuration.preserveInput) {
			return DefaultQuickAccessFilterValue.LAST;
		}

		return undefined;
	}

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IMenuService private readonly menuService: IMenuService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ICommandService commandService: ICommandService,
		@ITelemetryService telemetryService: ITelemetryService,
		@INotificationService notificationService: INotificationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
	) {
		super({
			showAlias: !Language.isDefaultVariant(),
			noResultsPick: {
				label: localize('noCommandResults', "No matching commands"),
				commandId: ''
			}
		}, instantiationService, keybindingService, commandService, telemetryService, notificationService);
	}

	private get configuration() {
		const commandPaletteConfig = this.configurationService.getValue<IWorkbenchQuickAccessConfiguration>().workbench.commandPalette;

		return {
			preserveInput: commandPaletteConfig.preserveInput
		};
	}

	protected async getCommandPicks(disposables: DisposableStore, token: CancellationToken): Promise<Array<ICommandQuickPick>> {

		// wait for extensions registration or 800ms once
		await this.extensionRegistrationRace;

		if (token.isCancellationRequested) {
			return [];
		}

		return [
			...this.getCodeEditorCommandPicks(),
			...this.getGlobalCommandPicks(disposables)
		].map(c => ({
			...c,
			buttons: [{
				iconClass: Codicon.gear.classNames,
				tooltip: localize('configure keybinding', "Configure Keybinding"),
			}],
			trigger: (): TriggerAction => {
				this.preferencesService.openGlobalKeybindingSettings(false, { query: `@command:${c.commandId}` });
				return TriggerAction.CLOSE_PICKER;
			},
		}));
	}

	private getGlobalCommandPicks(disposables: DisposableStore): ICommandQuickPick[] {
		const globalCommandPicks: ICommandQuickPick[] = [];
		const scopedContextKeyService = this.editorService.activeEditorPane?.scopedContextKeyService || this.editorGroupService.activeGroup.scopedContextKeyService;
		const globalCommandsMenu = this.menuService.createMenu(MenuId.CommandPalette, scopedContextKeyService);
		const globalCommandsMenuActions = globalCommandsMenu.getActions()
			.reduce((r, [, actions]) => [...r, ...actions], <Array<MenuItemAction | SubmenuItemAction | string>>[])
			.filter(action => action instanceof MenuItemAction && action.enabled) as MenuItemAction[];

		for (const action of globalCommandsMenuActions) {

			// Label
			let label = (typeof action.item.title === 'string' ? action.item.title : action.item.title.value) || action.item.id;

			// Category
			const category = typeof action.item.category === 'string' ? action.item.category : action.item.category?.value;
			if (category) {
				label = localize('commandWithCategory', "{0}: {1}", category, label);
			}

			// Alias
			const aliasLabel = typeof action.item.title !== 'string' ? action.item.title.original : undefined;
			const aliasCategory = (category && action.item.category && typeof action.item.category !== 'string') ? action.item.category.original : undefined;
			const commandAlias = (aliasLabel && category) ?
				aliasCategory ? `${aliasCategory}: ${aliasLabel}` : `${category}: ${aliasLabel}` :
				aliasLabel;

			globalCommandPicks.push({
				commandId: action.item.id,
				commandAlias,
				label: stripCodicons(label)
			});
		}

		// Cleanup
		globalCommandsMenu.dispose();
		disposables.add(toDisposable(() => dispose(globalCommandsMenuActions)));

		return globalCommandPicks;
	}
}

//#region Actions

export class ShowAllCommandsAction extends Action2 {

	static readonly ID = 'workbench.action.showCommands';

	constructor() {
		super({
			id: ShowAllCommandsAction.ID,
			title: { value: localize('showTriggerActions', "Show All Commands"), original: 'Show All Commands' },
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: undefined,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_P,
				secondary: [KeyCode.F1]
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IQuickInputService).quickAccess.show(CommandsQuickAccessProvider.PREFIX);
	}
}

export class ClearCommandHistoryAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.clearCommandHistory',
			title: { value: localize('clearCommandHistory', "Clear Command History"), original: 'Clear Command History' },
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);
		const storageService = accessor.get(IStorageService);

		const commandHistoryLength = CommandsHistory.getConfiguredCommandHistoryLength(configurationService);
		if (commandHistoryLength > 0) {
			CommandsHistory.clearHistory(configurationService, storageService);
		}
	}
}

//#endregion
