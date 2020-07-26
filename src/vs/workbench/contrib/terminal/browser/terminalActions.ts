/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action, IAction } from 'vs/base/common/actions';
import { EndOfLinePreference } from 'vs/editor/common/model';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { TERMINAL_VIEW_ID, ITerminalConfigHelper, TitleEventSource, TERMINAL_COMMAND_ID, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED, TERMINAL_ACTION_CATEGORY, KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE, KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED, KEYBINDING_CONTEXT_TERMINAL_FIND_NOT_VISIBLE, KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS } from 'vs/workbench/contrib/terminal/common/terminal';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { attachSelectBoxStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IQuickInputService, IPickOptions, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { PICK_WORKSPACE_FOLDER_COMMAND_ID } from 'vs/workbench/browser/actions/workspaceCommands';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ISelectOptionItem } from 'vs/base/browser/ui/selectBox/selectBox';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { isWindows } from 'vs/base/common/platform';
import { withNullAsUndefined } from 'vs/base/common/types';
import { ITerminalInstance, ITerminalService, Direction } from 'vs/workbench/contrib/terminal/browser/terminal';
import { Action2, registerAction2, ILocalizedString } from 'vs/platform/actions/common/actions';
import { TerminalQuickAccessProvider } from 'vs/workbench/contrib/terminal/browser/terminalQuickAccess';
import { ToggleViewAction } from 'vs/workbench/browser/actions/layoutActions';
import { IViewsService, IViewDescriptorService } from 'vs/workbench/common/views';
import { IContextKeyService, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { addClass } from 'vs/base/browser/dom';
import { selectBorder } from 'vs/platform/theme/common/colorRegistry';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { localize } from 'vs/nls';
import { CONTEXT_ACCESSIBILITY_MODE_ENABLED } from 'vs/platform/accessibility/common/accessibility';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITerminalContributionService } from 'vs/workbench/contrib/terminal/common/terminalExtensionPoints';
import { SelectActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';

async function getCwdForSplit(configHelper: ITerminalConfigHelper, instance: ITerminalInstance, folders?: IWorkspaceFolder[], commandService?: ICommandService): Promise<string | URI | undefined> {
	switch (configHelper.config.splitCwd) {
		case 'workspaceRoot':
			if (folders !== undefined && commandService !== undefined) {
				if (folders.length === 1) {
					return folders[0].uri;
				} else if (folders.length > 1) {
					// Only choose a path when there's more than 1 folder
					const options: IPickOptions<IQuickPickItem> = {
						placeHolder: localize('workbench.action.terminal.newWorkspacePlaceholder', "Select current working directory for new terminal")
					};
					const workspace = await commandService.executeCommand(PICK_WORKSPACE_FOLDER_COMMAND_ID, [options]);
					if (!workspace) {
						// Don't split the instance if the workspace picker was canceled
						return undefined;
					}
					return Promise.resolve(workspace.uri);
				}
			}
			return '';
		case 'initial':
			return instance.getInitialCwd();
		case 'inherited':
			return instance.getCwd();
	}
}

export class ToggleTerminalAction extends ToggleViewAction {

	public static readonly ID = TERMINAL_COMMAND_ID.TOGGLE;
	public static readonly LABEL = localize('workbench.action.terminal.toggleTerminal', "Toggle Integrated Terminal");

	constructor(
		id: string, label: string,
		@IViewsService viewsService: IViewsService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITerminalService private readonly terminalService: ITerminalService
	) {
		super(id, label, TERMINAL_VIEW_ID, viewsService, viewDescriptorService, contextKeyService, layoutService);
	}

	async run() {
		if (this.terminalService.terminalInstances.length === 0) {
			// If there is not yet an instance attempt to create it here so that we can suggest a
			// new shell on Windows (and not do so when the panel is restored on reload).
			const newTerminalInstance = this.terminalService.createTerminal(undefined);
			const toDispose = newTerminalInstance.onProcessIdReady(() => {
				newTerminalInstance.focus();
				toDispose.dispose();
			});
		}
		return super.run();
	}
}

export class KillTerminalAction extends Action {

	public static readonly ID = TERMINAL_COMMAND_ID.KILL;
	public static readonly LABEL = localize('workbench.action.terminal.kill', "Kill the Active Terminal Instance");
	public static readonly PANEL_LABEL = localize('workbench.action.terminal.kill.short', "Kill Terminal");

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		super(id, label, 'terminal-action codicon-trash');
	}

	async run() {
		await this._terminalService.doWithActiveInstance(async t => {
			t.dispose(true);
			if (this._terminalService.terminalInstances.length > 0) {
				await this._terminalService.showPanel(true);
			}
		});
	}
}

/**
 * Copies the terminal selection. Note that since the command palette takes focus from the terminal,
 * this cannot be triggered through the command palette.
 */
export class CopyTerminalSelectionAction extends Action {

	public static readonly ID = TERMINAL_COMMAND_ID.COPY_SELECTION;
	public static readonly LABEL = localize('workbench.action.terminal.copySelection', "Copy Selection");
	public static readonly SHORT_LABEL = localize('workbench.action.terminal.copySelection.short', "Copy");

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		super(id, label);
	}

	async run() {
		await this._terminalService.getActiveInstance()?.copySelection();
	}
}

export class SelectAllTerminalAction extends Action {

	public static readonly ID = TERMINAL_COMMAND_ID.SELECT_ALL;
	public static readonly LABEL = localize('workbench.action.terminal.selectAll', "Select All");

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		super(id, label);
	}

	async run() {
		this._terminalService.getActiveInstance()?.selectAll();
	}
}

export const terminalSendSequenceCommand = (accessor: ServicesAccessor, args: { text?: string } | undefined) => {
	accessor.get(ITerminalService).doWithActiveInstance(t => {
		if (!args?.text) {
			return;
		}
		const configurationResolverService = accessor.get(IConfigurationResolverService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const historyService = accessor.get(IHistoryService);
		const activeWorkspaceRootUri = historyService.getLastActiveWorkspaceRoot(Schemas.file);
		const lastActiveWorkspaceRoot = activeWorkspaceRootUri ? withNullAsUndefined(workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri)) : undefined;
		const resolvedText = configurationResolverService.resolve(lastActiveWorkspaceRoot, args.text);
		t.sendText(resolvedText, false);
	});
};


export class CreateNewTerminalAction extends Action {

	public static readonly ID = TERMINAL_COMMAND_ID.NEW;
	public static readonly LABEL = localize('workbench.action.terminal.new', "Create New Integrated Terminal");
	public static readonly SHORT_LABEL = localize('workbench.action.terminal.new.short', "New Terminal");

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@ICommandService private readonly _commandService: ICommandService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService
	) {
		super(id, label, 'terminal-action codicon-add');
	}

	async run(event?: any) {
		const folders = this._workspaceContextService.getWorkspace().folders;
		if (event instanceof MouseEvent && (event.altKey || event.ctrlKey)) {
			const activeInstance = this._terminalService.getActiveInstance();
			if (activeInstance) {
				const cwd = await getCwdForSplit(this._terminalService.configHelper, activeInstance);
				this._terminalService.splitInstance(activeInstance, { cwd });
				return;
			}
		}

		let instance: ITerminalInstance | undefined;
		if (folders.length <= 1) {
			// Allow terminal service to handle the path when there is only a
			// single root
			instance = this._terminalService.createTerminal(undefined);
		} else {
			const options: IPickOptions<IQuickPickItem> = {
				placeHolder: localize('workbench.action.terminal.newWorkspacePlaceholder', "Select current working directory for new terminal")
			};
			const workspace = await this._commandService.executeCommand(PICK_WORKSPACE_FOLDER_COMMAND_ID, [options]);
			if (!workspace) {
				// Don't create the instance if the workspace picker was canceled
				return;
			}
			instance = this._terminalService.createTerminal({ cwd: workspace.uri });
		}
		this._terminalService.setActiveInstance(instance);
		await this._terminalService.showPanel(true);
	}
}

export class SplitTerminalAction extends Action {
	public static readonly ID = TERMINAL_COMMAND_ID.SPLIT;
	public static readonly LABEL = localize('workbench.action.terminal.split', "Split Terminal");
	public static readonly SHORT_LABEL = localize('workbench.action.terminal.split.short', "Split");
	public static readonly HORIZONTAL_CLASS = 'terminal-action codicon-split-horizontal';
	public static readonly VERTICAL_CLASS = 'terminal-action codicon-split-vertical';

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@ICommandService private readonly _commandService: ICommandService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService
	) {
		super(id, label, SplitTerminalAction.HORIZONTAL_CLASS);
	}

	public async run(): Promise<any> {
		await this._terminalService.doWithActiveInstance(async t => {
			const cwd = await getCwdForSplit(this._terminalService.configHelper, t, this._workspaceContextService.getWorkspace().folders, this._commandService);
			if (cwd === undefined) {
				return undefined;
			}
			this._terminalService.splitInstance(t, { cwd });
			return this._terminalService.showPanel(true);
		});
	}
}

export class SplitInActiveWorkspaceTerminalAction extends Action {
	public static readonly ID = TERMINAL_COMMAND_ID.SPLIT_IN_ACTIVE_WORKSPACE;
	public static readonly LABEL = localize('workbench.action.terminal.splitInActiveWorkspace', "Split Terminal (In Active Workspace)");

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		super(id, label);
	}

	async run() {
		await this._terminalService.doWithActiveInstance(async t => {
			const cwd = await getCwdForSplit(this._terminalService.configHelper, t);
			this._terminalService.splitInstance(t, { cwd });
			await this._terminalService.showPanel(true);
		});
	}
}

export class TerminalPasteAction extends Action {

	public static readonly ID = TERMINAL_COMMAND_ID.PASTE;
	public static readonly LABEL = localize('workbench.action.terminal.paste', "Paste into Active Terminal");
	public static readonly SHORT_LABEL = localize('workbench.action.terminal.paste.short', "Paste");

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		super(id, label);
	}

	async run() {
		this._terminalService.getActiveOrCreateInstance()?.paste();
	}
}

export class SelectDefaultShellWindowsTerminalAction extends Action {

	public static readonly ID = TERMINAL_COMMAND_ID.SELECT_DEFAULT_SHELL;
	public static readonly LABEL = localize('workbench.action.terminal.selectDefaultShell', "Select Default Shell");

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		super(id, label);
	}

	async run() {
		this._terminalService.selectDefaultShell();
	}
}

const terminalIndexRe = /^([0-9]+): /;

export class SwitchTerminalAction extends Action {

	public static readonly ID = TERMINAL_COMMAND_ID.SWITCH_TERMINAL;
	public static readonly LABEL = localize('workbench.action.terminal.switchTerminal', "Switch Terminal");

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@ITerminalContributionService private readonly _contributions: ITerminalContributionService,
		@ICommandService private readonly _commands: ICommandService,
	) {
		super(id, label, 'terminal-action switch-terminal');
	}

	public run(item?: string): Promise<any> {
		if (!item || !item.split) {
			return Promise.resolve(null);
		}
		if (item === SwitchTerminalActionViewItem.SEPARATOR) {
			this._terminalService.refreshActiveTab();
			return Promise.resolve(null);
		}
		if (item === SelectDefaultShellWindowsTerminalAction.LABEL) {
			this._terminalService.refreshActiveTab();
			return this._terminalService.selectDefaultShell();
		}

		const indexMatches = terminalIndexRe.exec(item);
		if (indexMatches) {
			this._terminalService.setActiveTabByIndex(Number(indexMatches[1]) - 1);
			return this._terminalService.showPanel(true);
		}

		const customType = this._contributions.terminalTypes.find(t => t.title === item);
		if (customType) {
			return this._commands.executeCommand(customType.command);
		}

		console.warn(`Unmatched terminal item: "${item}"`);
		return Promise.resolve();
	}
}

export class SwitchTerminalActionViewItem extends SelectActionViewItem {

	public static readonly SEPARATOR = '─────────';

	constructor(
		action: IAction,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IThemeService private readonly _themeService: IThemeService,
		@ITerminalContributionService private readonly _contributions: ITerminalContributionService,
		@IContextViewService contextViewService: IContextViewService,
	) {
		super(null, action, getTerminalSelectOpenItems(_terminalService, _contributions), _terminalService.activeTabIndex, contextViewService, { ariaLabel: localize('terminals', 'Open Terminals.'), optionsAsChildren: true });

		this._register(_terminalService.onInstancesChanged(this._updateItems, this));
		this._register(_terminalService.onActiveTabChanged(this._updateItems, this));
		this._register(_terminalService.onInstanceTitleChanged(this._updateItems, this));
		this._register(_terminalService.onTabDisposed(this._updateItems, this));
		this._register(attachSelectBoxStyler(this.selectBox, _themeService));
	}

	render(container: HTMLElement): void {
		super.render(container);
		addClass(container, 'switch-terminal');
		this._register(attachStylerCallback(this._themeService, { selectBorder }, colors => {
			container.style.borderColor = colors.selectBorder ? `${colors.selectBorder}` : '';
		}));
	}

	private _updateItems(): void {
		this.setOptions(getTerminalSelectOpenItems(this._terminalService, this._contributions), this._terminalService.activeTabIndex);
	}
}

function getTerminalSelectOpenItems(terminalService: ITerminalService, contributions: ITerminalContributionService): ISelectOptionItem[] {
	const items = terminalService.getTabLabels().map(label => <ISelectOptionItem>{ text: label });
	items.push({ text: SwitchTerminalActionViewItem.SEPARATOR, isDisabled: true });

	for (const contributed of contributions.terminalTypes) {
		items.push({ text: contributed.title });
	}

	items.push({ text: SelectDefaultShellWindowsTerminalAction.LABEL });
	return items;
}

export class ClearTerminalAction extends Action {

	public static readonly ID = TERMINAL_COMMAND_ID.CLEAR;
	public static readonly LABEL = localize('workbench.action.terminal.clear', "Clear");

	constructor(
		id: string, label: string,
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		super(id, label);
	}

	async run() {
		this._terminalService.doWithActiveInstance(t => {
			t.clear();
			t.focus();
		});
	}
}

export class TerminalLaunchHelpAction extends Action {

	constructor(
		@IOpenerService private readonly _openerService: IOpenerService
	) {
		super('workbench.action.terminal.launchHelp', localize('terminalLaunchHelp', "Open Help"));
	}

	async run(): Promise<void> {
		this._openerService.open('https://aka.ms/vscode-troubleshoot-terminal-launch');
	}
}

export function registerTerminalActions() {
	const category: ILocalizedString = { value: TERMINAL_ACTION_CATEGORY, original: 'Terminal' };

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.NEW_IN_ACTIVE_WORKSPACE,
				title: { value: localize('workbench.action.terminal.newInActiveWorkspace', "Create New Integrated Terminal (In Active Workspace)"), original: 'Create New Integrated Terminal (In Active Workspace)' },
				f1: true,
				category
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			const instance = terminalService.createTerminal(undefined);
			if (!instance) {
				return;
			}
			terminalService.setActiveInstance(instance);
			await terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.FOCUS_PREVIOUS_PANE,
				title: { value: localize('workbench.action.terminal.focusPreviousPane', "Focus Previous Pane"), original: 'Focus Previous Pane' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.LeftArrow,
					secondary: [KeyMod.Alt | KeyCode.UpArrow],
					mac: {
						primary: KeyMod.Alt | KeyMod.CtrlCmd | KeyCode.LeftArrow,
						secondary: [KeyMod.Alt | KeyMod.CtrlCmd | KeyCode.UpArrow]
					},
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			terminalService.getActiveTab()?.focusPreviousPane();
			await terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.FOCUS_NEXT_PANE,
				title: { value: localize('workbench.action.terminal.focusNextPane', "Focus Next Pane"), original: 'Focus Next Pane' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.RightArrow,
					secondary: [KeyMod.Alt | KeyCode.DownArrow],
					mac: {
						primary: KeyMod.Alt | KeyMod.CtrlCmd | KeyCode.RightArrow,
						secondary: [KeyMod.Alt | KeyMod.CtrlCmd | KeyCode.DownArrow]
					},
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			terminalService.getActiveTab()?.focusNextPane();
			await terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.RESIZE_PANE_LEFT,
				title: { value: localize('workbench.action.terminal.resizePaneLeft', "Resize Pane Left"), original: 'Resize Pane Left' },
				f1: true,
				category,
				keybinding: {
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.LeftArrow },
					mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.LeftArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveTab()?.resizePane(Direction.Left);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.RESIZE_PANE_RIGHT,
				title: { value: localize('workbench.action.terminal.resizePaneRight', "Resize Pane Right"), original: 'Resize Pane Right' },
				f1: true,
				category,
				keybinding: {
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.RightArrow },
					mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.RightArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveTab()?.resizePane(Direction.Right);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.RESIZE_PANE_UP,
				title: { value: localize('workbench.action.terminal.resizePaneUp', "Resize Pane Up"), original: 'Resize Pane Up' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.UpArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveTab()?.resizePane(Direction.Up);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.RESIZE_PANE_DOWN,
				title: { value: localize('workbench.action.terminal.resizePaneDown', "Resize Pane Down"), original: 'Resize Pane Down' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.DownArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveTab()?.resizePane(Direction.Down);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.FOCUS,
				title: { value: localize('workbench.action.terminal.focus', "Focus Terminal"), original: 'Focus Terminal' },
				f1: true,
				category
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			const instance = terminalService.getActiveOrCreateInstance();
			if (!instance) {
				return;
			}
			terminalService.setActiveInstance(instance);
			return terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.FOCUS_NEXT,
				title: { value: localize('workbench.action.terminal.focusNext', "Focus Next Terminal"), original: 'Focus Next Terminal' },
				f1: true,
				category
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			terminalService.setActiveTabToNext();
			await terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.FOCUS_PREVIOUS,
				title: { value: localize('workbench.action.terminal.focusPrevious', "Focus Previous Terminal"), original: 'Focus Previous Terminal' },
				f1: true,
				category
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			terminalService.setActiveTabToPrevious();
			await terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.RUN_SELECTED_TEXT,
				title: { value: localize('workbench.action.terminal.runSelectedText', "Run Selected Text In Active Terminal"), original: 'Run Selected Text In Active Terminal' },
				f1: true,
				category
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			const codeEditorService = accessor.get(ICodeEditorService);

			const instance = terminalService.getActiveOrCreateInstance();
			let editor = codeEditorService.getFocusedCodeEditor();
			if (!editor || !editor.hasModel()) {
				return;
			}
			let selection = editor.getSelection();
			let text: string;
			if (selection.isEmpty()) {
				text = editor.getModel().getLineContent(selection.selectionStartLineNumber).trim();
			} else {
				const endOfLinePreference = isWindows ? EndOfLinePreference.LF : EndOfLinePreference.CRLF;
				text = editor.getModel().getValueInRange(selection, endOfLinePreference);
			}
			instance.sendText(text, true);
			return terminalService.showPanel();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.RUN_ACTIVE_FILE,
				title: { value: localize('workbench.action.terminal.runActiveFile', "Run Active File In Active Terminal"), original: 'Run Active File In Active Terminal' },
				f1: true,
				category
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			const codeEditorService = accessor.get(ICodeEditorService);
			const notificationService = accessor.get(INotificationService);

			const instance = terminalService.getActiveOrCreateInstance();
			await instance.processReady;

			const editor = codeEditorService.getActiveCodeEditor();
			if (!editor || !editor.hasModel()) {
				return;
			}

			const uri = editor.getModel().uri;
			if (uri.scheme !== 'file') {
				notificationService.warn(localize('workbench.action.terminal.runActiveFile.noFile', 'Only files on disk can be run in the terminal'));
				return;
			}

			// TODO: Convert this to ctrl+c, ctrl+v for pwsh?
			const path = await terminalService.preparePathForTerminalAsync(uri.fsPath, instance.shellLaunchConfig.executable, instance.title, instance.shellType);
			instance.sendText(path, true);
			return terminalService.showPanel();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SCROLL_DOWN_LINE,
				title: { value: localize('workbench.action.terminal.scrollDown', "Scroll Down (Line)"), original: 'Scroll Down (Line)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.PageDown,
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.DownArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollDownLine();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SCROLL_DOWN_PAGE,
				title: { value: localize('workbench.action.terminal.scrollDownPage', "Scroll Down (Page)"), original: 'Scroll Down (Page)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Shift | KeyCode.PageDown,
					mac: { primary: KeyCode.PageDown },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollDownPage();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SCROLL_TO_BOTTOM,
				title: { value: localize('workbench.action.terminal.scrollToBottom', "Scroll to Bottom"), original: 'Scroll to Bottom' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.End,
					linux: { primary: KeyMod.Shift | KeyCode.End },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollToBottom();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SCROLL_UP_LINE,
				title: { value: localize('workbench.action.terminal.scrollUp', "Scroll Up (Line)"), original: 'Scroll Up (Line)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.PageUp,
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.UpArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollUpLine();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SCROLL_UP_PAGE,
				title: { value: localize('workbench.action.terminal.scrollUpPage', "Scroll Up (Page)"), original: 'Scroll Up (Page)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Shift | KeyCode.PageUp,
					mac: { primary: KeyCode.PageUp },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollUpPage();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SCROLL_TO_TOP,
				title: { value: localize('workbench.action.terminal.scrollToTop', "Scroll to Top"), original: 'Scroll to Top' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.Home,
					linux: { primary: KeyMod.Shift | KeyCode.Home },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollToTop();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.NAVIGATION_MODE_EXIT,
				title: { value: localize('workbench.action.terminal.navigationModeExit', "Exit Navigation Mode"), original: 'Exit Navigation Mode' },
				f1: true,
				category,
				keybinding: {
					primary: KeyCode.Escape,
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.navigationMode?.exitNavigationMode();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.NAVIGATION_MODE_FOCUS_PREVIOUS,
				title: { value: localize('workbench.action.terminal.navigationModeFocusPrevious', "Focus Previous Line (Navigation Mode)"), original: 'Focus Previous Line (Navigation Mode)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.UpArrow,
					when: ContextKeyExpr.or(
						ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED),
						ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED)
					),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.navigationMode?.focusPreviousLine();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.NAVIGATION_MODE_FOCUS_NEXT,
				title: { value: localize('workbench.action.terminal.navigationModeFocusNext', "Focus Next Line (Navigation Mode)"), original: 'Focus Next Line (Navigation Mode)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.DownArrow,
					when: ContextKeyExpr.or(
						ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED),
						ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED)
					),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.navigationMode?.focusNextLine();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.CLEAR_SELECTION,
				title: { value: localize('workbench.action.terminal.clearSelection', "Clear Selection"), original: 'Clear Selection' },
				f1: true,
				category,
				keybinding: {
					primary: KeyCode.Escape,
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED, KEYBINDING_CONTEXT_TERMINAL_FIND_NOT_VISIBLE),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			const terminalInstance = accessor.get(ITerminalService).getActiveInstance();
			if (terminalInstance && terminalInstance.hasSelection()) {
				terminalInstance.clearSelection();
			}
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.MANAGE_WORKSPACE_SHELL_PERMISSIONS,
				title: { value: localize('workbench.action.terminal.manageWorkspaceShellPermissions', "Manage Workspace Shell Permissions"), original: 'Manage Workspace Shell Permissions' },
				f1: true,
				category
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).manageWorkspaceShellPermissions();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.RENAME,
				title: { value: localize('workbench.action.terminal.rename', "Rename"), original: 'Rename' },
				f1: true,
				category
			});
		}
		async run(accessor: ServicesAccessor) {
			await accessor.get(ITerminalService).doWithActiveInstance(async t => {
				const name = await accessor.get(IQuickInputService).input({
					value: t.title,
					prompt: localize('workbench.action.terminal.rename.prompt', "Enter terminal name"),
				});
				if (name) {
					t.setTitle(name, TitleEventSource.Api);
				}
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.FIND_FOCUS,
				title: { value: localize('workbench.action.terminal.focusFind', "Focus Find"), original: 'Focus Find' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.KEY_F,
					when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED, KEYBINDING_CONTEXT_TERMINAL_FOCUS),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).focusFindWidget();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.FIND_HIDE,
				title: { value: localize('workbench.action.terminal.hideFind', "Hide Find"), original: 'Hide Find' },
				f1: true,
				category,
				keybinding: {
					primary: KeyCode.Escape,
					secondary: [KeyMod.Shift | KeyCode.Escape],
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).hideFindWidget();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.QUICK_OPEN_TERM,
				title: { value: localize('quickAccessTerminal', "Switch Active Terminal"), original: 'Switch Active Terminal' },
				f1: true,
				category
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(IQuickInputService).quickAccess.show(TerminalQuickAccessProvider.PREFIX);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SCROLL_TO_PREVIOUS_COMMAND,
				title: { value: localize('workbench.action.terminal.scrollToPreviousCommand', "Scroll To Previous Command"), original: 'Scroll To Previous Command' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyCode.UpArrow },
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).doWithActiveInstance(t => {
				t.commandTracker?.scrollToPreviousCommand();
				t.focus();
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SCROLL_TO_NEXT_COMMAND,
				title: { value: localize('workbench.action.terminal.scrollToNextCommand', "Scroll To Next Command"), original: 'Scroll To Next Command' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyCode.DownArrow },
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).doWithActiveInstance(t => {
				t.commandTracker?.scrollToNextCommand();
				t.focus();
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SELECT_TO_PREVIOUS_COMMAND,
				title: { value: localize('workbench.action.terminal.selectToPreviousCommand', "Select To Previous Command"), original: 'Select To Previous Command' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.UpArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).doWithActiveInstance(t => {
				t.commandTracker?.selectToPreviousCommand();
				t.focus();
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SELECT_TO_NEXT_COMMAND,
				title: { value: localize('workbench.action.terminal.selectToNextCommand', "Select To Next Command"), original: 'Select To Next Command' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.DownArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).doWithActiveInstance(t => {
				t.commandTracker?.selectToNextCommand();
				t.focus();
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SELECT_TO_PREVIOUS_LINE,
				title: { value: localize('workbench.action.terminal.selectToPreviousLine', "Select To Previous Line"), original: 'Select To Previous Line' },
				f1: true,
				category
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).doWithActiveInstance(t => {
				t.commandTracker?.selectToPreviousLine();
				t.focus();
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SELECT_TO_NEXT_LINE,
				title: { value: localize('workbench.action.terminal.selectToNextLine', "Select To Next Line"), original: 'Select To Next Line' },
				f1: true,
				category
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).doWithActiveInstance(t => {
				t.commandTracker?.selectToNextLine();
				t.focus();
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.TOGGLE_ESCAPE_SEQUENCE_LOGGING,
				title: { value: localize('workbench.action.terminal.toggleEscapeSequenceLogging', "Toggle Escape Sequence Logging"), original: 'Toggle Escape Sequence Logging' },
				f1: true,
				category
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.toggleEscapeSequenceLogging();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			const title = localize('workbench.action.terminal.sendSequence', "Send Custom Sequence To Terminal");
			super({
				id: TERMINAL_COMMAND_ID.SEND_SEQUENCE,
				title: { value: title, original: 'Send Custom Sequence To Terminal' },
				category,
				description: {
					description: title,
					args: [{
						name: 'args',
						schema: {
							type: 'object',
							required: ['text'],
							properties: {
								text: { type: 'string' }
							},
						}
					}]
				}
			});
		}
		run(accessor: ServicesAccessor, args?: { text?: string }) {
			terminalSendSequenceCommand(accessor, args);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			const title = localize('workbench.action.terminal.newWithCwd', "Create New Integrated Terminal Starting in a Custom Working Directory");
			super({
				id: TERMINAL_COMMAND_ID.NEW_WITH_CWD,
				title: { value: title, original: 'Create New Integrated Terminal Starting in a Custom Working Directory' },
				category,
				description: {
					description: title,
					args: [{
						name: 'args',
						schema: {
							type: 'object',
							required: ['cwd'],
							properties: {
								cwd: {
									description: localize('workbench.action.terminal.newWithCwd.cwd', "The directory to start the terminal at"),
									type: 'string'
								}
							},
						}
					}]
				}
			});
		}
		async run(accessor: ServicesAccessor, args?: { cwd?: string }) {
			const terminalService = accessor.get(ITerminalService);
			const instance = terminalService.createTerminal({ cwd: args?.cwd });
			if (!instance) {
				return;
			}
			terminalService.setActiveInstance(instance);
			return terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			const title = localize('workbench.action.terminal.renameWithArg', "Rename the Currently Active Terminal");
			super({
				id: TERMINAL_COMMAND_ID.RENAME_WITH_ARG,
				title: { value: title, original: 'Rename the Currently Active Terminal' },
				category,
				description: {
					description: title,
					args: [{
						name: 'args',
						schema: {
							type: 'object',
							required: ['name'],
							properties: {
								name: {
									description: localize('workbench.action.terminal.renameWithArg.name', "The new name for the terminal"),
									type: 'string',
									minLength: 1
								}
							}
						}
					}]
				}
			});
		}
		run(accessor: ServicesAccessor, args?: { name?: string }) {
			const notificationService = accessor.get(INotificationService);
			if (!args?.name) {
				notificationService.warn(localize('workbench.action.terminal.renameWithArg.noName', "No name argument provided"));
				return;
			}
			accessor.get(ITerminalService).getActiveInstance()?.setTitle(args.name, TitleEventSource.Api);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.TOGGLE_FIND_REGEX,
				title: { value: localize('workbench.action.terminal.toggleFindRegex', "Toggle Find Using Regex"), original: 'Toggle Find Using Regex' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.KEY_R,
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_R },
					when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			const state = accessor.get(ITerminalService).getFindState();
			state.change({ isRegex: !state.isRegex }, false);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.TOGGLE_FIND_WHOLE_WORD,
				title: { value: localize('workbench.action.terminal.toggleFindWholeWord', "Toggle Find Using Whole Word"), original: 'Toggle Find Using Whole Word' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.KEY_W,
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_W },
					when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED),
					weight: KeybindingWeight.WorkbenchContrib
				},
			});
		}
		run(accessor: ServicesAccessor) {
			const state = accessor.get(ITerminalService).getFindState();
			state.change({ wholeWord: !state.wholeWord }, false);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.TOGGLE_FIND_CASE_SENSITIVE,
				title: { value: localize('workbench.action.terminal.toggleFindCaseSensitive', "Toggle Find Using Case Sensitive"), original: 'Toggle Find Using Case Sensitive' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.KEY_C,
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_C },
					when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED),
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		run(accessor: ServicesAccessor) {
			const state = accessor.get(ITerminalService).getFindState();
			state.change({ matchCase: !state.matchCase }, false);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.FIND_NEXT,
				title: { value: localize('workbench.action.terminal.findNext', "Find Next"), original: 'Find Next' },
				f1: true,
				category,
				keybinding: [
					{
						primary: KeyCode.F3,
						mac: { primary: KeyMod.CtrlCmd | KeyCode.KEY_G, secondary: [KeyCode.F3] },
						when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED),
						weight: KeybindingWeight.WorkbenchContrib
					},
					{
						primary: KeyMod.Shift | KeyCode.Enter,
						when: KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED,
						weight: KeybindingWeight.WorkbenchContrib
					}
				]
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).findNext();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.FIND_PREVIOUS,
				title: { value: localize('workbench.action.terminal.findPrevious', "Find Previous"), original: 'Find Previous' },
				f1: true,
				category,
				keybinding: [
					{
						primary: KeyMod.Shift | KeyCode.F3,
						mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_G, secondary: [KeyMod.Shift | KeyCode.F3] },
						when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED),
						weight: KeybindingWeight.WorkbenchContrib
					},
					{
						primary: KeyCode.Enter,
						when: KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED,
						weight: KeybindingWeight.WorkbenchContrib
					}
				]
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).findPrevious();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.RELAUNCH,
				title: { value: localize('workbench.action.terminal.relaunch', "Relaunch Active Terminal"), original: 'Relaunch Active Terminal' },
				f1: true,
				category
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.relaunch();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TERMINAL_COMMAND_ID.SHOW_ENVIRONMENT_INFORMATION,
				title: { value: localize('workbench.action.terminal.showEnvironmentInformation', "Show Environment Information"), original: 'Show Environment Information' },
				f1: true,
				category
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.showEnvironmentInfoHover();
		}
	});
}
