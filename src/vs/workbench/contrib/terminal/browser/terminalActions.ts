/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserFeatures } from 'vs/base/browser/canIUse';
import { Action } from 'vs/base/common/actions';
import { Codicon } from 'vs/base/common/codicons';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { Schemas } from 'vs/base/common/network';
import { isWindows, isLinux } from 'vs/base/common/platform';
import { withNullAsUndefined } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EndOfLinePreference } from 'vs/editor/common/model';
import { localize } from 'vs/nls';
import { CONTEXT_ACCESSIBILITY_MODE_ENABLED } from 'vs/platform/accessibility/common/accessibility';
import { Action2, ICommandActionTitle, ILocalizedString, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyAndExpr, ContextKeyEqualsExpr, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ILabelService } from 'vs/platform/label/common/label';
import { IListService } from 'vs/platform/list/browser/listService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IPickOptions, IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { ILocalTerminalService } from 'vs/platform/terminal/common/terminal';
import { IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { PICK_WORKSPACE_FOLDER_COMMAND_ID } from 'vs/workbench/browser/actions/workspaceCommands';
import { FindInFilesCommand, IFindInFilesArgs } from 'vs/workbench/contrib/search/browser/searchActions';
import { Direction, IRemoteTerminalService, ITerminalInstance, ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { TerminalQuickAccessProvider } from 'vs/workbench/contrib/terminal/browser/terminalQuickAccess';
import { IRemoteTerminalAttachTarget, ITerminalConfigHelper, ITerminalProfile, KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS, KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED, KEYBINDING_CONTEXT_TERMINAL_FIND_NOT_VISIBLE, KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE, KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_IS_OPEN, KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_TABS_FOCUS, KEYBINDING_CONTEXT_TERMINAL_TABS_SINGULAR_SELECTION, KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED, TERMINAL_ACTION_CATEGORY, TerminalCommandId, TerminalSettingId, TERMINAL_VIEW_ID, TitleEventSource } from 'vs/workbench/contrib/terminal/common/terminal';
import { ITerminalContributionService } from 'vs/workbench/contrib/terminal/common/terminalExtensionPoints';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';

export const switchTerminalActionViewItemSeparator = '─────────';
export const switchTerminalShowTabsTitle = localize('showTerminalTabs', "Show Tabs");

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

export const terminalSendSequenceCommand = (accessor: ServicesAccessor, args: { text?: string } | undefined) => {
	accessor.get(ITerminalService).doWithActiveInstance(async t => {
		if (!args?.text) {
			return;
		}
		const configurationResolverService = accessor.get(IConfigurationResolverService);
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const historyService = accessor.get(IHistoryService);
		const activeWorkspaceRootUri = historyService.getLastActiveWorkspaceRoot(Schemas.file);
		const lastActiveWorkspaceRoot = activeWorkspaceRootUri ? withNullAsUndefined(workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri)) : undefined;
		const resolvedText = await configurationResolverService.resolveAsync(lastActiveWorkspaceRoot, args.text);
		t.sendText(resolvedText, false);
	});
};

const terminalIndexRe = /^([0-9]+): /;

export class TerminalLaunchHelpAction extends Action {

	constructor(
		@IOpenerService private readonly _openerService: IOpenerService
	) {
		super('workbench.action.terminal.launchHelp', localize('terminalLaunchHelp', "Open Help"));
	}

	override async run(): Promise<void> {
		this._openerService.open('https://aka.ms/vscode-troubleshoot-terminal-launch');
	}
}

export function registerTerminalActions() {
	const category: ILocalizedString = { value: TERMINAL_ACTION_CATEGORY, original: 'Terminal' };

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.NewInActiveWorkspace,
				title: { value: localize('workbench.action.terminal.newInActiveWorkspace', "Create New Integrated Terminal (In Active Workspace)"), original: 'Create New Integrated Terminal (In Active Workspace)' },
				f1: true,
				category
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			if (terminalService.isProcessSupportRegistered) {
				const instance = terminalService.createTerminal(undefined);
				if (!instance) {
					return;
				}
				terminalService.setActiveInstance(instance);
			}
			await terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.NewWithProfile,
				title: { value: localize('workbench.action.terminal.newWithProfile', "Create New Integrated Terminal (With Profile)"), original: 'Create New Integrated Terminal (With Profile)' },
				f1: true,
				category,
				description: {
					description: 'workbench.action.terminal.newWithProfile',
					args: [{
						name: 'profile',
						schema: {
							type: 'object'
						}
					}]
				},
			});
		}
		async run(accessor: ServicesAccessor, eventOrProfile: unknown | ITerminalProfile, profile?: ITerminalProfile) {
			let event: MouseEvent | undefined;
			if (eventOrProfile && typeof eventOrProfile === 'object' && 'profileName' in eventOrProfile) {
				profile = eventOrProfile as ITerminalProfile;
			} else {
				event = eventOrProfile as MouseEvent;
			}
			const terminalService = accessor.get(ITerminalService);
			const workspaceContextService = accessor.get(IWorkspaceContextService);
			const commandService = accessor.get(ICommandService);
			const folders = workspaceContextService.getWorkspace().folders;
			if (event instanceof MouseEvent && (event.altKey || event.ctrlKey)) {
				const activeInstance = terminalService.getActiveInstance();
				if (activeInstance) {
					const cwd = await getCwdForSplit(terminalService.configHelper, activeInstance);
					terminalService.splitInstance(activeInstance, profile, cwd);
					return;
				}
			}

			if (terminalService.isProcessSupportRegistered) {
				let instance: ITerminalInstance | undefined;
				let cwd: string | URI | undefined;
				if (folders.length > 1) {
					// multi-root workspace, create root picker
					const options: IPickOptions<IQuickPickItem> = {
						placeHolder: localize('workbench.action.terminal.newWorkspacePlaceholder', "Select current working directory for new terminal")
					};
					const workspace = await commandService.executeCommand(PICK_WORKSPACE_FOLDER_COMMAND_ID, [options]);
					if (!workspace) {
						// Don't create the instance if the workspace picker was canceled
						return;
					}
					cwd = workspace.uri;
				}

				if (profile) {
					instance = terminalService.createTerminal(profile, cwd);
				} else {
					instance = await terminalService.showProfileQuickPick('createInstance', cwd);
				}

				if (instance) {
					terminalService.setActiveInstance(instance);
				}
			}
			await terminalService.showPanel(true);
		}
	});


	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ShowTabs,
				title: { value: localize('workbench.action.terminal.showTabs', "Show Tabs"), original: 'Show Tabs' },
				f1: false,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			terminalService.showTabs();
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.FocusPreviousPane,
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
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			terminalService.getActiveGroup()?.focusPreviousPane();
			await terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.FocusNextPane,
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
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			terminalService.getActiveGroup()?.focusNextPane();
			await terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ResizePaneLeft,
				title: { value: localize('workbench.action.terminal.resizePaneLeft', "Resize Pane Left"), original: 'Resize Pane Left' },
				f1: true,
				category,
				keybinding: {
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.LeftArrow },
					mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.LeftArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveGroup()?.resizePane(Direction.Left);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ResizePaneRight,
				title: { value: localize('workbench.action.terminal.resizePaneRight', "Resize Pane Right"), original: 'Resize Pane Right' },
				f1: true,
				category,
				keybinding: {
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.RightArrow },
					mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.RightArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveGroup()?.resizePane(Direction.Right);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ResizePaneUp,
				title: { value: localize('workbench.action.terminal.resizePaneUp', "Resize Pane Up"), original: 'Resize Pane Up' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.UpArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveGroup()?.resizePane(Direction.Up);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ResizePaneDown,
				title: { value: localize('workbench.action.terminal.resizePaneDown', "Resize Pane Down"), original: 'Resize Pane Down' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.DownArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveGroup()?.resizePane(Direction.Down);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.Focus,
				title: { value: localize('workbench.action.terminal.focus', "Focus Terminal"), original: 'Focus Terminal' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
				// This command is used to show instead of tabs when there is only a single terminal
				menu: {
					id: MenuId.ViewTitle,
					group: 'navigation',
					order: 0,
					when: ContextKeyAndExpr.create([
						ContextKeyEqualsExpr.create('view', TERMINAL_VIEW_ID),
						ContextKeyExpr.has(`config.${TerminalSettingId.TabsEnabled}`),
						ContextKeyExpr.or(
							ContextKeyExpr.and(
								ContextKeyExpr.equals(`config.${TerminalSettingId.TabsShowActiveTerminal}`, 'singleTerminal'),
								ContextKeyExpr.equals('terminalCount', 1)
							),
							ContextKeyExpr.and(
								ContextKeyExpr.equals(`config.${TerminalSettingId.TabsShowActiveTerminal}`, 'singleTerminalOrNarrow'),
								ContextKeyExpr.or(
									ContextKeyExpr.equals('terminalCount', 1),
									ContextKeyExpr.has('isTerminalTabsNarrow')
								)
							),
							ContextKeyExpr.equals(`config.${TerminalSettingId.TabsShowActiveTerminal}`, 'always')
						)
					]),
				}
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
				id: TerminalCommandId.FocusTabs,
				title: { value: localize('workbench.action.terminal.focus.tabsView', "Focus Terminal Tabs View"), original: 'Focus Terminal Tabs View' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_BACKSLASH,
					weight: KeybindingWeight.WorkbenchContrib,
					when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_TABS_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FOCUS),
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).focusTabs();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.FocusNext,
				title: { value: localize('workbench.action.terminal.focusNext', "Focus Next Terminal"), original: 'Focus Next Terminal' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.PageDown,
					mac: {
						primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_CLOSE_SQUARE_BRACKET
					},
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
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
				id: TerminalCommandId.FocusPrevious,
				title: { value: localize('workbench.action.terminal.focusPrevious', "Focus Previous Terminal"), original: 'Focus Previous Terminal' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.PageUp,
					mac: {
						primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_OPEN_SQUARE_BRACKET
					},
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				}
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
				id: TerminalCommandId.RunSelectedText,
				title: { value: localize('workbench.action.terminal.runSelectedText', "Run Selected Text In Active Terminal"), original: 'Run Selected Text In Active Terminal' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			const codeEditorService = accessor.get(ICodeEditorService);

			const instance = terminalService.getActiveOrCreateInstance();
			const editor = codeEditorService.getActiveCodeEditor();
			if (!editor || !editor.hasModel()) {
				return;
			}
			const selection = editor.getSelection();
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
				id: TerminalCommandId.RunActiveFile,
				title: { value: localize('workbench.action.terminal.runActiveFile', "Run Active File In Active Terminal"), original: 'Run Active File In Active Terminal' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			const codeEditorService = accessor.get(ICodeEditorService);
			const notificationService = accessor.get(INotificationService);

			const editor = codeEditorService.getActiveCodeEditor();
			if (!editor || !editor.hasModel()) {
				return;
			}

			const uri = editor.getModel().uri;
			if (uri.scheme !== Schemas.file) {
				notificationService.warn(localize('workbench.action.terminal.runActiveFile.noFile', 'Only files on disk can be run in the terminal'));
				return;
			}

			// TODO: Convert this to ctrl+c, ctrl+v for pwsh?
			const instance = terminalService.getActiveOrCreateInstance();
			const path = await terminalService.preparePathForTerminalAsync(uri.fsPath, instance.shellLaunchConfig.executable, instance.title, instance.shellType, instance.isRemote);
			instance.sendText(path, true);
			return terminalService.showPanel();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ScrollDownLine,
				title: { value: localize('workbench.action.terminal.scrollDown', "Scroll Down (Line)"), original: 'Scroll Down (Line)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.PageDown,
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.DownArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollDownLine();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ScrollDownPage,
				title: { value: localize('workbench.action.terminal.scrollDownPage', "Scroll Down (Page)"), original: 'Scroll Down (Page)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Shift | KeyCode.PageDown,
					mac: { primary: KeyCode.PageDown },
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE.negate()),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollDownPage();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ScrollToBottom,
				title: { value: localize('workbench.action.terminal.scrollToBottom', "Scroll to Bottom"), original: 'Scroll to Bottom' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.End,
					linux: { primary: KeyMod.Shift | KeyCode.End },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollToBottom();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ScrollUpLine,
				title: { value: localize('workbench.action.terminal.scrollUp', "Scroll Up (Line)"), original: 'Scroll Up (Line)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.PageUp,
					linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.UpArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollUpLine();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ScrollUpPage,
				title: { value: localize('workbench.action.terminal.scrollUpPage', "Scroll Up (Page)"), original: 'Scroll Up (Page)' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Shift | KeyCode.PageUp,
					mac: { primary: KeyCode.PageUp },
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_ALT_BUFFER_ACTIVE.negate()),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollUpPage();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ScrollToTop,
				title: { value: localize('workbench.action.terminal.scrollToTop', "Scroll to Top"), original: 'Scroll to Top' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.Home,
					linux: { primary: KeyMod.Shift | KeyCode.Home },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.scrollToTop();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.NavigationModeExit,
				title: { value: localize('workbench.action.terminal.navigationModeExit', "Exit Navigation Mode"), original: 'Exit Navigation Mode' },
				f1: true,
				category,
				keybinding: {
					primary: KeyCode.Escape,
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_A11Y_TREE_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.navigationMode?.exitNavigationMode();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.NavigationModeFocusPrevious,
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
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.navigationMode?.focusPreviousLine();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.NavigationModeFocusNext,
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
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.navigationMode?.focusNextLine();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ClearSelection,
				title: { value: localize('workbench.action.terminal.clearSelection', "Clear Selection"), original: 'Clear Selection' },
				f1: true,
				category,
				keybinding: {
					primary: KeyCode.Escape,
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED, KEYBINDING_CONTEXT_TERMINAL_FIND_NOT_VISIBLE),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.ChangeIcon,
				title: { value: localize('workbench.action.terminal.changeIcon', "Change Icon..."), original: 'Change Icon...' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			return accessor.get(ITerminalService).getActiveInstance()?.changeIcon();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ChangeIconInstance,
				title: { value: localize('workbench.action.terminal.changeIcon', "Change Icon..."), original: 'Change Icon...' },
				f1: false,
				category,
				precondition: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_TABS_SINGULAR_SELECTION)
			});
		}
		async run(accessor: ServicesAccessor) {
			return getSelectedInstances(accessor)?.[0].changeIcon();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.Rename,
				title: { value: localize('workbench.action.terminal.rename', "Rename..."), original: 'Rename...' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			return accessor.get(ITerminalService).getActiveInstance()?.rename();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.RenameInstance,
				title: { value: localize('workbench.action.terminal.renameInstance', "Rename..."), original: 'Rename...' },
				f1: false,
				category,
				keybinding: {
					primary: KeyCode.F2,
					mac: {
						primary: KeyCode.Enter
					},
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_TABS_FOCUS),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_TABS_SINGULAR_SELECTION),
			});
		}
		async run(accessor: ServicesAccessor) {
			return getSelectedInstances(accessor)?.[0].rename();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.FindFocus,
				title: { value: localize('workbench.action.terminal.focusFind', "Focus Find"), original: 'Focus Find' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyCode.KEY_F,
					when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED, KEYBINDING_CONTEXT_TERMINAL_FOCUS),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).focusFindWidget();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.FindHide,
				title: { value: localize('workbench.action.terminal.hideFind', "Hide Find"), original: 'Hide Find' },
				f1: true,
				category,
				keybinding: {
					primary: KeyCode.Escape,
					secondary: [KeyMod.Shift | KeyCode.Escape],
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_VISIBLE),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).hideFindWidget();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.AttachToRemoteTerminal,
				title: { value: localize('workbench.action.terminal.attachToRemote', "Attach to Session"), original: 'Attach to Session' },
				f1: true,
				category
			});
		}
		async run(accessor: ServicesAccessor) {
			const quickInputService = accessor.get(IQuickInputService);
			const terminalService = accessor.get(ITerminalService);
			const labelService = accessor.get(ILabelService);
			const remoteAgentService = accessor.get(IRemoteAgentService);
			const notificationService = accessor.get(INotificationService);
			const offProcTerminalService = remoteAgentService.getConnection() ? accessor.get(IRemoteTerminalService) : accessor.get(ILocalTerminalService);

			const terms = await offProcTerminalService.listProcesses();

			offProcTerminalService.reduceConnectionGraceTime();

			const unattachedTerms = terms.filter(term => !terminalService.isAttachedToTerminal(term));
			const items = unattachedTerms.map(term => {
				const cwdLabel = labelService.getUriLabel(URI.file(term.cwd));
				return {
					label: term.title,
					detail: term.workspaceName ? `${term.workspaceName} ⸱ ${cwdLabel}` : cwdLabel,
					description: term.pid ? String(term.pid) : '',
					term
				};
			});
			if (items.length === 0) {
				notificationService.info(localize('noUnattachedTerminals', 'There are no unattached terminals to attach to'));
				return;
			}
			const selected = await quickInputService.pick<IRemoteTerminalPick>(items, { canPickMany: false });
			if (selected) {
				const instance = terminalService.createTerminal({ attachPersistentProcess: selected.term });
				terminalService.setActiveInstance(instance);
				terminalService.showPanel(true);
			}
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.QuickOpenTerm,
				title: { value: localize('quickAccessTerminal', "Switch Active Terminal"), original: 'Switch Active Terminal' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(IQuickInputService).quickAccess.show(TerminalQuickAccessProvider.PREFIX);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ScrollToPreviousCommand,
				title: { value: localize('workbench.action.terminal.scrollToPreviousCommand', "Scroll To Previous Command"), original: 'Scroll To Previous Command' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyCode.UpArrow },
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.ScrollToNextCommand,
				title: { value: localize('workbench.action.terminal.scrollToNextCommand', "Scroll To Next Command"), original: 'Scroll To Next Command' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyCode.DownArrow },
					when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.SelectToPreviousCommand,
				title: { value: localize('workbench.action.terminal.selectToPreviousCommand', "Select To Previous Command"), original: 'Select To Previous Command' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.UpArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.SelectToNextCommand,
				title: { value: localize('workbench.action.terminal.selectToNextCommand', "Select To Next Command"), original: 'Select To Next Command' },
				f1: true,
				category,
				keybinding: {
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.DownArrow },
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS,
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.SelectToPreviousLine,
				title: { value: localize('workbench.action.terminal.selectToPreviousLine', "Select To Previous Line"), original: 'Select To Previous Line' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.SelectToNextLine,
				title: { value: localize('workbench.action.terminal.selectToNextLine', "Select To Next Line"), original: 'Select To Next Line' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.ToggleEscapeSequenceLogging,
				title: { value: localize('workbench.action.terminal.toggleEscapeSequenceLogging', "Toggle Escape Sequence Logging"), original: 'Toggle Escape Sequence Logging' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.SendSequence,
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
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.NewWithCwd,
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
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor, args?: { cwd?: string }) {
			const terminalService = accessor.get(ITerminalService);
			if (terminalService.isProcessSupportRegistered) {
				const instance = terminalService.createTerminal({ cwd: args?.cwd });
				if (!instance) {
					return;
				}
				terminalService.setActiveInstance(instance);
			}
			return terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			const title = localize('workbench.action.terminal.renameWithArg', "Rename the Currently Active Terminal");
			super({
				id: TerminalCommandId.RenameWithArgs,
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
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.ToggleFindRegex,
				title: { value: localize('workbench.action.terminal.toggleFindRegex', "Toggle Find Using Regex"), original: 'Toggle Find Using Regex' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.KEY_R,
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_R },
					when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.ToggleFindWholeWord,
				title: { value: localize('workbench.action.terminal.toggleFindWholeWord', "Toggle Find Using Whole Word"), original: 'Toggle Find Using Whole Word' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.KEY_W,
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_W },
					when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.ToggleFindCaseSensitive,
				title: { value: localize('workbench.action.terminal.toggleFindCaseSensitive', "Toggle Find Using Case Sensitive"), original: 'Toggle Find Using Case Sensitive' },
				f1: true,
				category,
				keybinding: {
					primary: KeyMod.Alt | KeyCode.KEY_C,
					mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_C },
					when: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_FIND_FOCUSED),
					weight: KeybindingWeight.WorkbenchContrib
				},
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
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
				id: TerminalCommandId.FindNext,
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
				],
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).findNext();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.FindPrevious,
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
				],
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).findPrevious();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.SearchWorkspace,
				title: { value: localize('workbench.action.terminal.searchWorkspace', "Search Workspace"), original: 'Search Workspace' },
				f1: true,
				category,
				keybinding: [
					{
						primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_F,
						when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED),
						weight: KeybindingWeight.WorkbenchContrib + 50
					}
				],
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			const query = accessor.get(ITerminalService).getActiveInstance()?.selection;
			FindInFilesCommand(accessor, { query } as IFindInFilesArgs);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.Relaunch,
				title: { value: localize('workbench.action.terminal.relaunch', "Relaunch Active Terminal"), original: 'Relaunch Active Terminal' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.relaunch();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ShowEnvironmentInformation,
				title: { value: localize('workbench.action.terminal.showEnvironmentInformation', "Show Environment Information"), original: 'Show Environment Information' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.showEnvironmentInfoHover();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.Split,
				title: { value: localize('workbench.action.terminal.split', "Split Terminal"), original: 'Split Terminal' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_5,
					weight: KeybindingWeight.WorkbenchContrib,
					mac: {
						primary: KeyMod.CtrlCmd | KeyCode.US_BACKSLASH,
						secondary: [KeyMod.WinCtrl | KeyMod.Shift | KeyCode.KEY_5]
					},
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS
				},
				icon: Codicon.splitHorizontal,
				description: {
					description: 'workbench.action.terminal.split',
					args: [{
						name: 'profile',
						schema: {
							type: 'object'
						}
					}]
				},
			});
		}
		async run(accessor: ServicesAccessor, profile?: ITerminalProfile) {
			const terminalService = accessor.get(ITerminalService);
			await terminalService.doWithActiveInstance(async t => {
				const cwd = await getCwdForSplit(terminalService.configHelper, t, accessor.get(IWorkspaceContextService).getWorkspace().folders, accessor.get(ICommandService));
				if (cwd === undefined) {
					return undefined;
				}
				terminalService.splitInstance(t, profile, cwd);
				return terminalService.showPanel(true);
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.SplitInstance,
				title: { value: localize('workbench.action.terminal.split', "Split Terminal"), original: 'Split Terminal' },
				f1: false,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_5,
					mac: {
						primary: KeyMod.CtrlCmd | KeyCode.US_BACKSLASH,
						secondary: [KeyMod.WinCtrl | KeyMod.Shift | KeyCode.KEY_5]
					},
					weight: KeybindingWeight.WorkbenchContrib,
					when: KEYBINDING_CONTEXT_TERMINAL_TABS_FOCUS
				}
			});
		}
		async run(accessor: ServicesAccessor) {
			const instances = getSelectedInstances(accessor);
			if (instances) {
				for (const instance of instances) {
					accessor.get(ITerminalService).splitInstance(instance);
				}
			}
			accessor.get(ITerminalService).focusTabs();
			focusNext(accessor);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.SplitInActiveWorkspace,
				title: { value: localize('workbench.action.terminal.splitInActiveWorkspace', "Split Terminal (In Active Workspace)"), original: 'Split Terminal (In Active Workspace)' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			await terminalService.doWithActiveInstance(async t => {
				const cwd = await getCwdForSplit(terminalService.configHelper, t);
				terminalService.splitInstance(t, { cwd });
				await terminalService.showPanel(true);
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.SelectAll,
				title: { value: localize('workbench.action.terminal.selectAll', "Select All"), original: 'Select All' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
				keybinding: [{
					// Don't use ctrl+a by default as that would override the common go to start
					// of prompt shell binding
					primary: 0,
					// Technically this doesn't need to be here as it will fall back to this
					// behavior anyway when handed to xterm.js, having this handled by VS Code
					// makes it easier for users to see how it works though.
					mac: { primary: KeyMod.CtrlCmd | KeyCode.KEY_A },
					weight: KeybindingWeight.WorkbenchContrib,
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS
				}]
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).getActiveInstance()?.selectAll();
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.New,
				title: { value: localize('workbench.action.terminal.new', "Create New Integrated Terminal"), original: 'Create New Integrated Terminal' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
				icon: Codicon.plus,
				keybinding: {
					primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_BACKTICK,
					mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.US_BACKTICK },
					weight: KeybindingWeight.WorkbenchContrib
				}
			});
		}
		async run(accessor: ServicesAccessor, event: unknown) {
			const terminalService = accessor.get(ITerminalService);
			const workspaceContextService = accessor.get(IWorkspaceContextService);
			const commandService = accessor.get(ICommandService);
			const folders = workspaceContextService.getWorkspace().folders;
			if (event instanceof MouseEvent && (event.altKey || event.ctrlKey)) {
				const activeInstance = terminalService.getActiveInstance();
				if (activeInstance) {
					const cwd = await getCwdForSplit(terminalService.configHelper, activeInstance);
					terminalService.splitInstance(activeInstance, { cwd });
					return;
				}
			}

			if (terminalService.isProcessSupportRegistered) {
				let instance: ITerminalInstance | undefined;
				if (folders.length <= 1) {
					// Allow terminal service to handle the path when there is only a
					// single root
					instance = terminalService.createTerminal(undefined);
				} else {
					const options: IPickOptions<IQuickPickItem> = {
						placeHolder: localize('workbench.action.terminal.newWorkspacePlaceholder', "Select current working directory for new terminal")
					};
					const workspace = await commandService.executeCommand(PICK_WORKSPACE_FOLDER_COMMAND_ID, [options]);
					if (!workspace) {
						// Don't create the instance if the workspace picker was canceled
						return;
					}
					instance = terminalService.createTerminal({ cwd: workspace.uri });
				}
				terminalService.setActiveInstance(instance);
			}
			await terminalService.showPanel(true);
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.Kill,
				title: { value: localize('workbench.action.terminal.kill', "Kill the Active Terminal Instance"), original: 'Kill the Active Terminal Instance' },
				f1: true,
				category,
				precondition: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_IS_OPEN),
				icon: Codicon.trash,
				menu: {
					id: MenuId.ViewTitle,
					group: 'navigation',
					order: 3,
					when: ContextKeyAndExpr.create([
						ContextKeyEqualsExpr.create('view', TERMINAL_VIEW_ID),
						ContextKeyExpr.not(`config.${TerminalSettingId.TabsEnabled}`)
					])
				}
			});
		}
		async run(accessor: ServicesAccessor) {
			const terminalService = accessor.get(ITerminalService);
			await terminalService.doWithActiveInstance(async t => {
				t.dispose(true);
				if (terminalService.terminalInstances.length > 0) {
					await terminalService.showPanel(true);
				}
			});
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.KillInstance,
				title: {
					value: localize('workbench.action.terminal.kill.short', "Kill Terminal"), original: 'Kill Terminal'
				},
				f1: false,
				category,
				precondition: ContextKeyExpr.or(KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_IS_OPEN),
				keybinding: {
					primary: KeyCode.Delete,
					mac: {
						primary: KeyMod.CtrlCmd | KeyCode.Backspace,
						secondary: [KeyCode.Delete]
					},
					weight: KeybindingWeight.WorkbenchContrib,
					when: KEYBINDING_CONTEXT_TERMINAL_TABS_FOCUS
				}
			});
		}
		async run(accessor: ServicesAccessor) {
			getSelectedInstances(accessor)?.forEach(instance => instance.dispose(true));
			const terminalService = accessor.get(ITerminalService);
			if (terminalService.terminalInstances.length > 0) {
				terminalService.focusTabs();
				focusNext(accessor);
			}
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.Clear,
				title: { value: localize('workbench.action.terminal.clear', "Clear"), original: 'Clear' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
				keybinding: [{
					primary: 0,
					mac: { primary: KeyMod.CtrlCmd | KeyCode.KEY_K },
					// Weight is higher than work workbench contributions so the keybinding remains
					// highest priority when chords are registered afterwards
					weight: KeybindingWeight.WorkbenchContrib + 1,
					when: KEYBINDING_CONTEXT_TERMINAL_FOCUS
				}]
			});
		}
		run(accessor: ServicesAccessor) {
			accessor.get(ITerminalService).doWithActiveInstance(t => {
				t.clear();
				t.focus();
			});
		}
	});
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.SelectDefaultProfile,
				title: { value: localize('workbench.action.terminal.selectDefaultProfile', "Select Default Profile"), original: 'Select Default Profile' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			await accessor.get(ITerminalService).showProfileQuickPick('setDefault');
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.CreateWithProfileButton,
				title: TerminalCommandId.CreateWithProfileButton,
				f1: false,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
				menu: [{
					id: MenuId.ViewTitle,
					group: 'navigation',
					order: 0,
					when: ContextKeyAndExpr.create([
						ContextKeyEqualsExpr.create('view', TERMINAL_VIEW_ID)
					]),
				}]
			});
		}
		async run(accessor: ServicesAccessor) {
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.ConfigureTerminalSettings,
				title: { value: localize('workbench.action.terminal.openSettings', "Configure Terminal Settings"), original: 'Configure Terminal Settings' },
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor) {
			await accessor.get(IPreferencesService).openSettings(false, '@feature:terminal');
		}
	});

	// Some commands depend on platform features
	if (BrowserFeatures.clipboard.writeText) {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: TerminalCommandId.CopySelection,
					title: { value: localize('workbench.action.terminal.copySelection', "Copy Selection"), original: 'Copy Selection' },
					f1: true,
					category,
					// TODO: Why is copy still showing up when text isn't selected?
					precondition: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED),
					keybinding: [{
						primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
						win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_C, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_C] },
						linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_C },
						weight: KeybindingWeight.WorkbenchContrib,
						when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED, KEYBINDING_CONTEXT_TERMINAL_FOCUS)
					}]
				});
			}
			async run(accessor: ServicesAccessor) {
				await accessor.get(ITerminalService).getActiveInstance()?.copySelection();
			}
		});
	}

	if (BrowserFeatures.clipboard.readText) {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: TerminalCommandId.Paste,
					title: { value: localize('workbench.action.terminal.paste', "Paste into Active Terminal"), original: 'Paste into Active Terminal' },
					f1: true,
					category,
					precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
					keybinding: [{
						primary: KeyMod.CtrlCmd | KeyCode.KEY_V,
						win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_V, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_V] },
						linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_V },
						weight: KeybindingWeight.WorkbenchContrib,
						when: KEYBINDING_CONTEXT_TERMINAL_FOCUS
					}],
				});
			}
			async run(accessor: ServicesAccessor) {
				await accessor.get(ITerminalService).getActiveInstance()?.paste();
			}
		});
	}

	if (BrowserFeatures.clipboard.readText && isLinux) {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: TerminalCommandId.PasteSelection,
					title: { value: localize('workbench.action.terminal.pasteSelection', "Paste Selection into Active Terminal"), original: 'Paste Selection into Active Terminal' },
					f1: true,
					category,
					precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED,
					keybinding: [{
						linux: { primary: KeyMod.Shift | KeyCode.Insert },
						weight: KeybindingWeight.WorkbenchContrib,
						when: KEYBINDING_CONTEXT_TERMINAL_FOCUS
					}],
				});
			}
			async run(accessor: ServicesAccessor) {
				await accessor.get(ITerminalService).getActiveInstance()?.pasteSelection();
			}
		});
	}

	const switchTerminalTitle: ICommandActionTitle = { value: localize('workbench.action.terminal.switchTerminal', "Switch Terminal"), original: 'Switch Terminal' };
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TerminalCommandId.SwitchTerminal,
				title: switchTerminalTitle,
				f1: true,
				category,
				precondition: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
			});
		}
		async run(accessor: ServicesAccessor, item?: string) {
			const terminalService = accessor.get(ITerminalService);
			const terminalContributionService = accessor.get(ITerminalContributionService);
			const commandService = accessor.get(ICommandService);
			if (!item || !item.split) {
				return Promise.resolve(null);
			}
			if (item === switchTerminalActionViewItemSeparator) {
				terminalService.refreshActiveTab();
				return Promise.resolve(null);
			}
			if (item === switchTerminalShowTabsTitle) {
				accessor.get(IConfigurationService).updateValue(TerminalSettingId.TabsEnabled, true);
				return;
			}
			const indexMatches = terminalIndexRe.exec(item);
			if (indexMatches) {
				terminalService.setActiveTabByIndex(Number(indexMatches[1]) - 1);
				return terminalService.showPanel(true);
			}
			const customType = terminalContributionService.terminalTypes.find(t => t.title === item);
			if (customType) {
				return commandService.executeCommand(customType.command);
			}

			const quickSelectProfiles = terminalService.availableProfiles;

			// Remove 'New ' from the selected item to get the profile name
			const profileSelection = item.substring(4);
			if (quickSelectProfiles) {
				const profile = quickSelectProfiles.find(profile => profile.profileName === profileSelection);
				if (profile) {
					const instance = terminalService.createTerminal(profile);
					terminalService.setActiveInstance(instance);
				} else {
					console.warn(`No profile with name "${profileSelection}"`);
				}
			} else {
				console.warn(`Unmatched terminal item: "${item}"`);
			}
			return Promise.resolve();
		}
	});
}

interface IRemoteTerminalPick extends IQuickPickItem {
	term: IRemoteTerminalAttachTarget;
}

function getSelectedInstances(accessor: ServicesAccessor): ITerminalInstance[] | undefined {
	const listService = accessor.get(IListService);
	const terminalService = accessor.get(ITerminalService);
	if (!listService.lastFocusedList?.getSelection()) {
		return undefined;
	}
	const selections = listService.lastFocusedList.getSelection();
	const focused = listService.lastFocusedList.getFocus();
	const instances: ITerminalInstance[] = [];

	if (focused.length === 1 && !selections.includes(focused[0])) {
		// focused length is always a max of 1
		// if the focused one is not in the selected list, return that item
		instances.push(terminalService.getInstanceFromIndex(focused[0]) as ITerminalInstance);
		return instances;
	}

	// multi-select
	for (const selection of selections) {
		instances.push(terminalService.getInstanceFromIndex(selection) as ITerminalInstance);
	}
	return instances;
}

function focusNext(accessor: ServicesAccessor): void {
	const listService = accessor.get(IListService);
	listService.lastFocusedList?.focusNext();
}
