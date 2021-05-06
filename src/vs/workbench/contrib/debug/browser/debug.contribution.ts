/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/debug.contribution';
import 'vs/css!./media/debugHover';
import * as nls from 'vs/nls';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { Registry } from 'vs/platform/registry/common/platform';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { BreakpointsView } from 'vs/workbench/contrib/debug/browser/breakpointsView';
import { CallStackView } from 'vs/workbench/contrib/debug/browser/callStackView';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import {
	IDebugService, VIEWLET_ID, DEBUG_PANEL_ID, CONTEXT_IN_DEBUG_MODE, INTERNAL_CONSOLE_OPTIONS_SCHEMA,
	CONTEXT_DEBUG_STATE, VARIABLES_VIEW_ID, CALLSTACK_VIEW_ID, WATCH_VIEW_ID, BREAKPOINTS_VIEW_ID, LOADED_SCRIPTS_VIEW_ID, CONTEXT_LOADED_SCRIPTS_SUPPORTED, CONTEXT_CALLSTACK_ITEM_TYPE, CONTEXT_RESTART_FRAME_SUPPORTED, CONTEXT_JUMP_TO_CURSOR_SUPPORTED, CONTEXT_DEBUG_UX, BREAKPOINT_EDITOR_CONTRIBUTION_ID, REPL_VIEW_ID, CONTEXT_BREAKPOINTS_EXIST, EDITOR_CONTRIBUTION_ID, CONTEXT_DEBUGGERS_AVAILABLE, CONTEXT_SET_VARIABLE_SUPPORTED, CONTEXT_BREAK_WHEN_VALUE_CHANGES_SUPPORTED, CONTEXT_VARIABLE_EVALUATE_NAME_PRESENT, getStateLabel, State, CONTEXT_WATCH_ITEM_TYPE, CONTEXT_STACK_FRAME_SUPPORTS_RESTART, CONTEXT_BREAK_WHEN_VALUE_IS_READ_SUPPORTED, CONTEXT_BREAK_WHEN_VALUE_IS_ACCESSED_SUPPORTED, CONTEXT_FOCUSED_SESSION_IS_ATTACH, CONTEXT_TERMINATE_DEBUGGEE_SUPPORTED,
} from 'vs/workbench/contrib/debug/common/debug';
import { DebugToolBar } from 'vs/workbench/contrib/debug/browser/debugToolBar';
import { DebugService } from 'vs/workbench/contrib/debug/browser/debugService';
import { ADD_CONFIGURATION_ID, TOGGLE_INLINE_BREAKPOINT_ID, COPY_STACK_TRACE_ID, RESTART_SESSION_ID, TERMINATE_THREAD_ID, STEP_OVER_ID, STEP_INTO_ID, STEP_OUT_ID, PAUSE_ID, DISCONNECT_ID, STOP_ID, RESTART_FRAME_ID, CONTINUE_ID, FOCUS_REPL_ID, JUMP_TO_CURSOR_ID, RESTART_LABEL, STEP_INTO_LABEL, STEP_OVER_LABEL, STEP_OUT_LABEL, PAUSE_LABEL, DISCONNECT_LABEL, STOP_LABEL, CONTINUE_LABEL, DEBUG_START_LABEL, DEBUG_START_COMMAND_ID, DEBUG_RUN_LABEL, DEBUG_RUN_COMMAND_ID, EDIT_EXPRESSION_COMMAND_ID, REMOVE_EXPRESSION_COMMAND_ID, SELECT_AND_START_ID, SELECT_AND_START_LABEL } from 'vs/workbench/contrib/debug/browser/debugCommands';
import { StatusBarColorProvider } from 'vs/workbench/contrib/debug/browser/statusbarColorProvider';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, ViewContainerLocation, ViewContainer } from 'vs/workbench/common/views';
import { isMacintosh, isWeb } from 'vs/base/common/platform';
import { ContextKeyExpr, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { URI } from 'vs/base/common/uri';
import { DebugStatusContribution } from 'vs/workbench/contrib/debug/browser/debugStatus';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { launchSchemaId } from 'vs/workbench/services/configuration/common/configuration';
import { LoadedScriptsView } from 'vs/workbench/contrib/debug/browser/loadedScriptsView';
import { RunToCursorAction } from 'vs/workbench/contrib/debug/browser/debugEditorActions';
import { WatchExpressionsView, ADD_WATCH_LABEL, REMOVE_WATCH_EXPRESSIONS_COMMAND_ID, REMOVE_WATCH_EXPRESSIONS_LABEL, ADD_WATCH_ID } from 'vs/workbench/contrib/debug/browser/watchExpressionsView';
import { VariablesView, SET_VARIABLE_ID, COPY_VALUE_ID, BREAK_WHEN_VALUE_CHANGES_ID, COPY_EVALUATE_PATH_ID, ADD_TO_WATCH_ID, BREAK_WHEN_VALUE_IS_ACCESSED_ID, BREAK_WHEN_VALUE_IS_READ_ID } from 'vs/workbench/contrib/debug/browser/variablesView';
import { Repl } from 'vs/workbench/contrib/debug/browser/repl';
import { DebugContentProvider } from 'vs/workbench/contrib/debug/common/debugContentProvider';
import { WelcomeView } from 'vs/workbench/contrib/debug/browser/welcomeView';
import { DebugViewPaneContainer } from 'vs/workbench/contrib/debug/browser/debugViewlet';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { CallStackEditorContribution } from 'vs/workbench/contrib/debug/browser/callStackEditorContribution';
import { BreakpointEditorContribution } from 'vs/workbench/contrib/debug/browser/breakpointEditorContribution';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IQuickAccessRegistry, Extensions as QuickAccessExtensions } from 'vs/platform/quickinput/common/quickAccess';
import { StartDebugQuickAccessProvider } from 'vs/workbench/contrib/debug/browser/debugQuickAccess';
import { DebugProgressContribution } from 'vs/workbench/contrib/debug/browser/debugProgress';
import { DebugTitleContribution } from 'vs/workbench/contrib/debug/browser/debugTitle';
import { registerColors } from 'vs/workbench/contrib/debug/browser/debugColors';
import { DebugEditorContribution } from 'vs/workbench/contrib/debug/browser/debugEditorContribution';
import { FileAccess } from 'vs/base/common/network';
import * as icons from 'vs/workbench/contrib/debug/browser/debugIcons';

const debugCategory = nls.localize('debugCategory', "Debug");
registerColors();
registerSingleton(IDebugService, DebugService, true);

// Register Debug Workbench Contributions
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(DebugStatusContribution, LifecyclePhase.Eventually);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(DebugProgressContribution, LifecyclePhase.Eventually);
if (isWeb) {
	Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(DebugTitleContribution, LifecyclePhase.Eventually);
}
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(DebugToolBar, LifecyclePhase.Restored);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(DebugContentProvider, LifecyclePhase.Eventually);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(StatusBarColorProvider, LifecyclePhase.Eventually);

// Register Quick Access
Registry.as<IQuickAccessRegistry>(QuickAccessExtensions.Quickaccess).registerQuickAccessProvider({
	ctor: StartDebugQuickAccessProvider,
	prefix: StartDebugQuickAccessProvider.PREFIX,
	contextKey: 'inLaunchConfigurationsPicker',
	placeholder: nls.localize('startDebugPlaceholder', "Type the name of a launch configuration to run."),
	helpEntries: [{ description: nls.localize('startDebuggingHelp', "Start Debugging"), needsEditor: false }]
});


registerEditorContribution('editor.contrib.callStack', CallStackEditorContribution);
registerEditorContribution(BREAKPOINT_EDITOR_CONTRIBUTION_ID, BreakpointEditorContribution);
registerEditorContribution(EDITOR_CONTRIBUTION_ID, DebugEditorContribution);

const registerDebugCommandPaletteItem = (id: string, title: string, when?: ContextKeyExpression, precondition?: ContextKeyExpression) => {
	MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
		when: ContextKeyExpr.and(CONTEXT_DEBUGGERS_AVAILABLE, when),
		group: debugCategory,
		command: {
			id,
			title: `Debug: ${title}`,
			precondition
		}
	});
};

registerDebugCommandPaletteItem(RESTART_SESSION_ID, RESTART_LABEL);
registerDebugCommandPaletteItem(TERMINATE_THREAD_ID, nls.localize('terminateThread', "Terminate Thread"), CONTEXT_IN_DEBUG_MODE);
registerDebugCommandPaletteItem(STEP_OVER_ID, STEP_OVER_LABEL, CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugCommandPaletteItem(STEP_INTO_ID, STEP_INTO_LABEL, CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugCommandPaletteItem(STEP_OUT_ID, STEP_OUT_LABEL, CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugCommandPaletteItem(PAUSE_ID, PAUSE_LABEL, CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE.isEqualTo('running'));
registerDebugCommandPaletteItem(DISCONNECT_ID, DISCONNECT_LABEL, CONTEXT_IN_DEBUG_MODE, ContextKeyExpr.or(CONTEXT_FOCUSED_SESSION_IS_ATTACH, CONTEXT_TERMINATE_DEBUGGEE_SUPPORTED));
registerDebugCommandPaletteItem(STOP_ID, STOP_LABEL, CONTEXT_IN_DEBUG_MODE, ContextKeyExpr.or(CONTEXT_FOCUSED_SESSION_IS_ATTACH.toNegated(), CONTEXT_TERMINATE_DEBUGGEE_SUPPORTED));
registerDebugCommandPaletteItem(CONTINUE_ID, CONTINUE_LABEL, CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugCommandPaletteItem(FOCUS_REPL_ID, nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'debugFocusConsole' }, 'Focus on Debug Console View'));
registerDebugCommandPaletteItem(JUMP_TO_CURSOR_ID, nls.localize('jumpToCursor', "Jump to Cursor"), CONTEXT_JUMP_TO_CURSOR_SUPPORTED);
registerDebugCommandPaletteItem(JUMP_TO_CURSOR_ID, nls.localize('SetNextStatement', "Set Next Statement"), CONTEXT_JUMP_TO_CURSOR_SUPPORTED);
registerDebugCommandPaletteItem(RunToCursorAction.ID, RunToCursorAction.LABEL, ContextKeyExpr.and(CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE.isEqualTo('stopped')));
registerDebugCommandPaletteItem(TOGGLE_INLINE_BREAKPOINT_ID, nls.localize('inlineBreakpoint', "Inline Breakpoint"));
registerDebugCommandPaletteItem(DEBUG_START_COMMAND_ID, DEBUG_START_LABEL, ContextKeyExpr.and(CONTEXT_DEBUGGERS_AVAILABLE, CONTEXT_DEBUG_STATE.notEqualsTo(getStateLabel(State.Initializing))));
registerDebugCommandPaletteItem(DEBUG_RUN_COMMAND_ID, DEBUG_RUN_LABEL, ContextKeyExpr.and(CONTEXT_DEBUGGERS_AVAILABLE, CONTEXT_DEBUG_STATE.notEqualsTo(getStateLabel(State.Initializing))));
registerDebugCommandPaletteItem(SELECT_AND_START_ID, SELECT_AND_START_LABEL, ContextKeyExpr.and(CONTEXT_DEBUGGERS_AVAILABLE, CONTEXT_DEBUG_STATE.notEqualsTo(getStateLabel(State.Initializing))));


// Debug callstack context menu
const registerDebugViewMenuItem = (menuId: MenuId, id: string, title: string, order: number, when?: ContextKeyExpression, precondition?: ContextKeyExpression, group = 'navigation') => {
	MenuRegistry.appendMenuItem(menuId, {
		group,
		when,
		order,
		command: {
			id,
			title,
			precondition
		}
	});
};
registerDebugViewMenuItem(MenuId.DebugCallStackContext, RESTART_SESSION_ID, RESTART_LABEL, 10, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('session'), undefined, '3_modification');
registerDebugViewMenuItem(MenuId.DebugCallStackContext, DISCONNECT_ID, DISCONNECT_LABEL, 20, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('session'), undefined, '3_modification');
registerDebugViewMenuItem(MenuId.DebugCallStackContext, STOP_ID, STOP_LABEL, 30, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('session'), undefined, '3_modification');
registerDebugViewMenuItem(MenuId.DebugCallStackContext, PAUSE_ID, PAUSE_LABEL, 10, ContextKeyExpr.and(CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('running')));
registerDebugViewMenuItem(MenuId.DebugCallStackContext, CONTINUE_ID, CONTINUE_LABEL, 10, ContextKeyExpr.and(CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('stopped')));
registerDebugViewMenuItem(MenuId.DebugCallStackContext, STEP_OVER_ID, STEP_OVER_LABEL, 20, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugViewMenuItem(MenuId.DebugCallStackContext, STEP_INTO_ID, STEP_INTO_LABEL, 30, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugViewMenuItem(MenuId.DebugCallStackContext, STEP_OUT_ID, STEP_OUT_LABEL, 40, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugViewMenuItem(MenuId.DebugCallStackContext, TERMINATE_THREAD_ID, nls.localize('terminateThread', "Terminate Thread"), 10, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), undefined, 'termination');
registerDebugViewMenuItem(MenuId.DebugCallStackContext, RESTART_FRAME_ID, nls.localize('restartFrame', "Restart Frame"), 10, ContextKeyExpr.and(CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('stackFrame'), CONTEXT_RESTART_FRAME_SUPPORTED), CONTEXT_STACK_FRAME_SUPPORTS_RESTART);
registerDebugViewMenuItem(MenuId.DebugCallStackContext, COPY_STACK_TRACE_ID, nls.localize('copyStackTrace', "Copy Call Stack"), 20, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('stackFrame'));

registerDebugViewMenuItem(MenuId.DebugVariablesContext, SET_VARIABLE_ID, nls.localize('setValue', "Set Value"), 10, CONTEXT_SET_VARIABLE_SUPPORTED, undefined, '3_modification');
registerDebugViewMenuItem(MenuId.DebugVariablesContext, COPY_VALUE_ID, nls.localize('copyValue', "Copy Value"), 10, undefined, undefined, '5_cutcopypaste');
registerDebugViewMenuItem(MenuId.DebugVariablesContext, COPY_EVALUATE_PATH_ID, nls.localize('copyAsExpression', "Copy as Expression"), 20, CONTEXT_VARIABLE_EVALUATE_NAME_PRESENT, undefined, '5_cutcopypaste');
registerDebugViewMenuItem(MenuId.DebugVariablesContext, ADD_TO_WATCH_ID, nls.localize('addToWatchExpressions', "Add to Watch"), 100, CONTEXT_VARIABLE_EVALUATE_NAME_PRESENT, undefined, 'z_commands');
registerDebugViewMenuItem(MenuId.DebugVariablesContext, BREAK_WHEN_VALUE_IS_READ_ID, nls.localize('breakWhenValueIsRead', "Break on Value Read"), 200, CONTEXT_BREAK_WHEN_VALUE_IS_READ_SUPPORTED, undefined, 'z_commands');
registerDebugViewMenuItem(MenuId.DebugVariablesContext, BREAK_WHEN_VALUE_CHANGES_ID, nls.localize('breakWhenValueChanges', "Break on Value Change"), 210, CONTEXT_BREAK_WHEN_VALUE_CHANGES_SUPPORTED, undefined, 'z_commands');
registerDebugViewMenuItem(MenuId.DebugVariablesContext, BREAK_WHEN_VALUE_IS_ACCESSED_ID, nls.localize('breakWhenValueIsAccessed', "Break on Value Access"), 220, CONTEXT_BREAK_WHEN_VALUE_IS_ACCESSED_SUPPORTED, undefined, 'z_commands');

registerDebugViewMenuItem(MenuId.DebugWatchContext, ADD_WATCH_ID, ADD_WATCH_LABEL, 10, undefined, undefined, '3_modification');
registerDebugViewMenuItem(MenuId.DebugWatchContext, EDIT_EXPRESSION_COMMAND_ID, nls.localize('editWatchExpression', "Edit Expression"), 20, CONTEXT_WATCH_ITEM_TYPE.isEqualTo('expression'), undefined, '3_modification');
registerDebugViewMenuItem(MenuId.DebugWatchContext, COPY_VALUE_ID, nls.localize('copyValue', "Copy Value"), 30, ContextKeyExpr.or(CONTEXT_WATCH_ITEM_TYPE.isEqualTo('expression'), CONTEXT_WATCH_ITEM_TYPE.isEqualTo('variable')), CONTEXT_IN_DEBUG_MODE, '3_modification');
registerDebugViewMenuItem(MenuId.DebugWatchContext, REMOVE_EXPRESSION_COMMAND_ID, nls.localize('removeWatchExpression', "Remove Expression"), 10, CONTEXT_WATCH_ITEM_TYPE.isEqualTo('expression'), undefined, 'z_commands');
registerDebugViewMenuItem(MenuId.DebugWatchContext, REMOVE_WATCH_EXPRESSIONS_COMMAND_ID, REMOVE_WATCH_EXPRESSIONS_LABEL, 20, undefined, undefined, 'z_commands');

// Touch Bar
if (isMacintosh) {

	const registerTouchBarEntry = (id: string, title: string, order: number, when: ContextKeyExpression | undefined, iconUri: URI) => {
		MenuRegistry.appendMenuItem(MenuId.TouchBarContext, {
			command: {
				id,
				title,
				icon: { dark: iconUri }
			},
			when: ContextKeyExpr.and(CONTEXT_DEBUGGERS_AVAILABLE, when),
			group: '9_debug',
			order
		});
	};

	registerTouchBarEntry(DEBUG_START_COMMAND_ID, DEBUG_START_LABEL, 0, CONTEXT_IN_DEBUG_MODE.toNegated(), FileAccess.asFileUri('vs/workbench/contrib/debug/browser/media/continue-tb.png', require));
	registerTouchBarEntry(DEBUG_RUN_COMMAND_ID, DEBUG_RUN_LABEL, 1, CONTEXT_IN_DEBUG_MODE.toNegated(), FileAccess.asFileUri('vs/workbench/contrib/debug/browser/media/continue-without-debugging-tb.png', require));
	registerTouchBarEntry(CONTINUE_ID, CONTINUE_LABEL, 0, CONTEXT_DEBUG_STATE.isEqualTo('stopped'), FileAccess.asFileUri('vs/workbench/contrib/debug/browser/media/continue-tb.png', require));
	registerTouchBarEntry(PAUSE_ID, PAUSE_LABEL, 1, ContextKeyExpr.and(CONTEXT_IN_DEBUG_MODE, ContextKeyExpr.notEquals('debugState', 'stopped')), FileAccess.asFileUri('vs/workbench/contrib/debug/browser/media/pause-tb.png', require));
	registerTouchBarEntry(STEP_OVER_ID, STEP_OVER_LABEL, 2, CONTEXT_IN_DEBUG_MODE, FileAccess.asFileUri('vs/workbench/contrib/debug/browser/media/stepover-tb.png', require));
	registerTouchBarEntry(STEP_INTO_ID, STEP_INTO_LABEL, 3, CONTEXT_IN_DEBUG_MODE, FileAccess.asFileUri('vs/workbench/contrib/debug/browser/media/stepinto-tb.png', require));
	registerTouchBarEntry(STEP_OUT_ID, STEP_OUT_LABEL, 4, CONTEXT_IN_DEBUG_MODE, FileAccess.asFileUri('vs/workbench/contrib/debug/browser/media/stepout-tb.png', require));
	registerTouchBarEntry(RESTART_SESSION_ID, RESTART_LABEL, 5, CONTEXT_IN_DEBUG_MODE, FileAccess.asFileUri('vs/workbench/contrib/debug/browser/media/restart-tb.png', require));
	registerTouchBarEntry(STOP_ID, STOP_LABEL, 6, CONTEXT_IN_DEBUG_MODE, FileAccess.asFileUri('vs/workbench/contrib/debug/browser/media/stop-tb.png', require));
}

// Debug menu

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '1_debug',
	command: {
		id: DEBUG_START_COMMAND_ID,
		title: nls.localize({ key: 'miStartDebugging', comment: ['&& denotes a mnemonic'] }, "&&Start Debugging")
	},
	order: 1,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '1_debug',
	command: {
		id: DEBUG_RUN_COMMAND_ID,
		title: nls.localize({ key: 'miRun', comment: ['&& denotes a mnemonic'] }, "Run &&Without Debugging")
	},
	order: 2,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '1_debug',
	command: {
		id: STOP_ID,
		title: nls.localize({ key: 'miStopDebugging', comment: ['&& denotes a mnemonic'] }, "&&Stop Debugging"),
		precondition: CONTEXT_IN_DEBUG_MODE
	},
	order: 3,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '1_debug',
	command: {
		id: RESTART_SESSION_ID,
		title: nls.localize({ key: 'miRestart Debugging', comment: ['&& denotes a mnemonic'] }, "&&Restart Debugging"),
		precondition: CONTEXT_IN_DEBUG_MODE
	},
	order: 4,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

// Configuration

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '2_configuration',
	command: {
		id: ADD_CONFIGURATION_ID,
		title: nls.localize({ key: 'miAddConfiguration', comment: ['&& denotes a mnemonic'] }, "A&&dd Configuration...")
	},
	order: 2,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

// Step Commands
MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '3_step',
	command: {
		id: STEP_OVER_ID,
		title: nls.localize({ key: 'miStepOver', comment: ['&& denotes a mnemonic'] }, "Step &&Over"),
		precondition: CONTEXT_DEBUG_STATE.isEqualTo('stopped')
	},
	order: 1,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '3_step',
	command: {
		id: STEP_INTO_ID,
		title: nls.localize({ key: 'miStepInto', comment: ['&& denotes a mnemonic'] }, "Step &&Into"),
		precondition: CONTEXT_DEBUG_STATE.isEqualTo('stopped')
	},
	order: 2,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '3_step',
	command: {
		id: STEP_OUT_ID,
		title: nls.localize({ key: 'miStepOut', comment: ['&& denotes a mnemonic'] }, "Step O&&ut"),
		precondition: CONTEXT_DEBUG_STATE.isEqualTo('stopped')
	},
	order: 3,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '3_step',
	command: {
		id: CONTINUE_ID,
		title: nls.localize({ key: 'miContinue', comment: ['&& denotes a mnemonic'] }, "&&Continue"),
		precondition: CONTEXT_DEBUG_STATE.isEqualTo('stopped')
	},
	order: 4,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

// New Breakpoints

MenuRegistry.appendMenuItem(MenuId.MenubarNewBreakpointMenu, {
	group: '1_breakpoints',
	command: {
		id: TOGGLE_INLINE_BREAKPOINT_ID,
		title: nls.localize({ key: 'miInlineBreakpoint', comment: ['&& denotes a mnemonic'] }, "Inline Breakp&&oint")
	},
	order: 2,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: '4_new_breakpoint',
	title: nls.localize({ key: 'miNewBreakpoint', comment: ['&& denotes a mnemonic'] }, "&&New Breakpoint"),
	submenu: MenuId.MenubarNewBreakpointMenu,
	order: 2,
	when: CONTEXT_DEBUGGERS_AVAILABLE
});

// Breakpoint actions are registered from breakpointsView.ts

// Install Debuggers
MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
	group: 'z_install',
	command: {
		id: 'debug.installAdditionalDebuggers',
		title: nls.localize({ key: 'miInstallAdditionalDebuggers', comment: ['&& denotes a mnemonic'] }, "&&Install Additional Debuggers...")
	},
	order: 1
});

// register repl panel

const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: DEBUG_PANEL_ID,
	title: nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'debugPanel' }, 'Debug Console'),
	icon: icons.debugConsoleViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DEBUG_PANEL_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	storageId: DEBUG_PANEL_ID,
	hideIfEmpty: true,
}, ViewContainerLocation.Panel, { donotRegisterOpenCommand: true });

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: REPL_VIEW_ID,
	name: nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'debugPanel' }, 'Debug Console'),
	containerIcon: icons.debugConsoleViewIcon,
	canToggleVisibility: false,
	canMoveView: true,
	when: CONTEXT_DEBUGGERS_AVAILABLE,
	ctorDescriptor: new SyncDescriptor(Repl),
	openCommandActionDescriptor: {
		id: 'workbench.debug.action.toggleRepl',
		mnemonicTitle: nls.localize({ key: 'miToggleDebugConsole', comment: ['&& denotes a mnemonic'] }, "De&&bug Console"),
		keybindings: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Y },
		order: 2
	}
}], VIEW_CONTAINER);


const viewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: VIEWLET_ID,
	title: nls.localize('run and debug', "Run and Debug"),
	openCommandActionDescriptor: {
		id: VIEWLET_ID,
		mnemonicTitle: nls.localize({ key: 'miViewRun', comment: ['&& denotes a mnemonic'] }, "&&Run"),
		keybindings: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_D },
		order: 3
	},
	ctorDescriptor: new SyncDescriptor(DebugViewPaneContainer),
	icon: icons.runViewIcon,
	alwaysUseContainerInfo: true,
	order: 3,
}, ViewContainerLocation.Sidebar);

// Register default debug views
const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
viewsRegistry.registerViews([{ id: VARIABLES_VIEW_ID, name: nls.localize('variables', "Variables"), containerIcon: icons.variablesViewIcon, ctorDescriptor: new SyncDescriptor(VariablesView), order: 10, weight: 40, canToggleVisibility: true, canMoveView: true, focusCommand: { id: 'workbench.debug.action.focusVariablesView' }, when: CONTEXT_DEBUG_UX.isEqualTo('default') }], viewContainer);
viewsRegistry.registerViews([{ id: WATCH_VIEW_ID, name: nls.localize('watch', "Watch"), containerIcon: icons.watchViewIcon, ctorDescriptor: new SyncDescriptor(WatchExpressionsView), order: 20, weight: 10, canToggleVisibility: true, canMoveView: true, focusCommand: { id: 'workbench.debug.action.focusWatchView' }, when: CONTEXT_DEBUG_UX.isEqualTo('default') }], viewContainer);
viewsRegistry.registerViews([{ id: CALLSTACK_VIEW_ID, name: nls.localize('callStack', "Call Stack"), containerIcon: icons.callStackViewIcon, ctorDescriptor: new SyncDescriptor(CallStackView), order: 30, weight: 30, canToggleVisibility: true, canMoveView: true, focusCommand: { id: 'workbench.debug.action.focusCallStackView' }, when: CONTEXT_DEBUG_UX.isEqualTo('default') }], viewContainer);
viewsRegistry.registerViews([{ id: BREAKPOINTS_VIEW_ID, name: nls.localize('breakpoints', "Breakpoints"), containerIcon: icons.breakpointsViewIcon, ctorDescriptor: new SyncDescriptor(BreakpointsView), order: 40, weight: 20, canToggleVisibility: true, canMoveView: true, focusCommand: { id: 'workbench.debug.action.focusBreakpointsView' }, when: ContextKeyExpr.or(CONTEXT_BREAKPOINTS_EXIST, CONTEXT_DEBUG_UX.isEqualTo('default')) }], viewContainer);
viewsRegistry.registerViews([{ id: WelcomeView.ID, name: WelcomeView.LABEL, containerIcon: icons.runViewIcon, ctorDescriptor: new SyncDescriptor(WelcomeView), order: 1, weight: 40, canToggleVisibility: true, when: CONTEXT_DEBUG_UX.isEqualTo('simple') }], viewContainer);
viewsRegistry.registerViews([{ id: LOADED_SCRIPTS_VIEW_ID, name: nls.localize('loadedScripts', "Loaded Scripts"), containerIcon: icons.loadedScriptsViewIcon, ctorDescriptor: new SyncDescriptor(LoadedScriptsView), order: 35, weight: 5, canToggleVisibility: true, canMoveView: true, collapsed: true, when: ContextKeyExpr.and(CONTEXT_LOADED_SCRIPTS_SUPPORTED, CONTEXT_DEBUG_UX.isEqualTo('default')) }], viewContainer);

// Register configuration
const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'debug',
	order: 20,
	title: nls.localize('debugConfigurationTitle', "Debug"),
	type: 'object',
	properties: {
		'debug.allowBreakpointsEverywhere': {
			type: 'boolean',
			description: nls.localize({ comment: ['This is the description for a setting'], key: 'allowBreakpointsEverywhere' }, "Allow setting breakpoints in any file."),
			default: false
		},
		'debug.openExplorerOnEnd': {
			type: 'boolean',
			description: nls.localize({ comment: ['This is the description for a setting'], key: 'openExplorerOnEnd' }, "Automatically open the explorer view at the end of a debug session."),
			default: false
		},
		'debug.inlineValues': {
			type: ['boolean', 'string'],
			'enum': [true, false, 'auto'],
			description: nls.localize({ comment: ['This is the description for a setting'], key: 'inlineValues' }, "Show variable values inline in editor while debugging."),
			'enumDescriptions': [
				nls.localize('inlineValues.on', 'Always show variable values inline in editor while debugging.'),
				nls.localize('inlineValues.off', 'Never show variable values inline in editor while debugging.'),
				nls.localize('inlineValues.focusNoScroll', 'Show variable values inline in editor while debugging when the language supports inline value locations.'),
			],
			default: 'auto'
		},
		'debug.toolBarLocation': {
			enum: ['floating', 'docked', 'hidden'],
			markdownDescription: nls.localize({ comment: ['This is the description for a setting'], key: 'toolBarLocation' }, "Controls the location of the debug toolbar. Either `floating` in all views, `docked` in the debug view, or `hidden`."),
			default: 'floating'
		},
		'debug.showInStatusBar': {
			enum: ['never', 'always', 'onFirstSessionStart'],
			enumDescriptions: [nls.localize('never', "Never show debug in status bar"), nls.localize('always', "Always show debug in status bar"), nls.localize('onFirstSessionStart', "Show debug in status bar only after debug was started for the first time")],
			description: nls.localize({ comment: ['This is the description for a setting'], key: 'showInStatusBar' }, "Controls when the debug status bar should be visible."),
			default: 'onFirstSessionStart'
		},
		'debug.internalConsoleOptions': INTERNAL_CONSOLE_OPTIONS_SCHEMA,
		'debug.console.closeOnEnd': {
			type: 'boolean',
			description: nls.localize('debug.console.closeOnEnd', "Controls if the debug console should be automatically closed when the debug session ends."),
			default: false
		},
		'debug.terminal.clearBeforeReusing': {
			type: 'boolean',
			description: nls.localize({ comment: ['This is the description for a setting'], key: 'debug.terminal.clearBeforeReusing' }, "Before starting a new debug session in an integrated or external terminal, clear the terminal."),
			default: false
		},
		'debug.openDebug': {
			enum: ['neverOpen', 'openOnSessionStart', 'openOnFirstSessionStart', 'openOnDebugBreak'],
			default: 'openOnDebugBreak',
			description: nls.localize('openDebug', "Controls when the debug view should open.")
		},
		'debug.showSubSessionsInToolBar': {
			type: 'boolean',
			description: nls.localize({ comment: ['This is the description for a setting'], key: 'showSubSessionsInToolBar' }, "Controls whether the debug sub-sessions are shown in the debug tool bar. When this setting is false the stop command on a sub-session will also stop the parent session."),
			default: false
		},
		'debug.console.fontSize': {
			type: 'number',
			description: nls.localize('debug.console.fontSize', "Controls the font size in pixels in the debug console."),
			default: isMacintosh ? 12 : 14,
		},
		'debug.console.fontFamily': {
			type: 'string',
			description: nls.localize('debug.console.fontFamily', "Controls the font family in the debug console."),
			default: 'default'
		},
		'debug.console.lineHeight': {
			type: 'number',
			description: nls.localize('debug.console.lineHeight', "Controls the line height in pixels in the debug console. Use 0 to compute the line height from the font size."),
			default: 0
		},
		'debug.console.wordWrap': {
			type: 'boolean',
			description: nls.localize('debug.console.wordWrap', "Controls if the lines should wrap in the debug console."),
			default: true
		},
		'debug.console.historySuggestions': {
			type: 'boolean',
			description: nls.localize('debug.console.historySuggestions', "Controls if the debug console should suggest previously typed input."),
			default: true
		},
		'debug.console.collapseIdenticalLines': {
			type: 'boolean',
			description: nls.localize('debug.console.collapseIdenticalLines', "Controls if the debug console should collapse identical lines and show a number of occurrences with a badge."),
			default: true
		},
		'launch': {
			type: 'object',
			description: nls.localize({ comment: ['This is the description for a setting'], key: 'launch' }, "Global debug launch configuration. Should be used as an alternative to 'launch.json' that is shared across workspaces."),
			default: { configurations: [], compounds: [] },
			$ref: launchSchemaId
		},
		'debug.focusWindowOnBreak': {
			type: 'boolean',
			description: nls.localize('debug.focusWindowOnBreak', "Controls whether the workbench window should be focused when the debugger breaks."),
			default: true
		},
		'debug.onTaskErrors': {
			enum: ['debugAnyway', 'showErrors', 'prompt', 'abort'],
			enumDescriptions: [nls.localize('debugAnyway', "Ignore task errors and start debugging."), nls.localize('showErrors', "Show the Problems view and do not start debugging."), nls.localize('prompt', "Prompt user."), nls.localize('cancel', "Cancel debugging.")],
			description: nls.localize('debug.onTaskErrors', "Controls what to do when errors are encountered after running a preLaunchTask."),
			default: 'prompt'
		},
		'debug.showBreakpointsInOverviewRuler': {
			type: 'boolean',
			description: nls.localize({ comment: ['This is the description for a setting'], key: 'showBreakpointsInOverviewRuler' }, "Controls whether breakpoints should be shown in the overview ruler."),
			default: false
		},
		'debug.showInlineBreakpointCandidates': {
			type: 'boolean',
			description: nls.localize({ comment: ['This is the description for a setting'], key: 'showInlineBreakpointCandidates' }, "Controls whether inline breakpoints candidate decorations should be shown in the editor while debugging."),
			default: true
		},
		'debug.saveBeforeStart': {
			description: nls.localize('debug.saveBeforeStart', "Controls what editors to save before starting a debug session."),
			enum: ['allEditorsInActiveGroup', 'nonUntitledEditorsInActiveGroup', 'none'],
			enumDescriptions: [
				nls.localize('debug.saveBeforeStart.allEditorsInActiveGroup', "Save all editors in the active group before starting a debug session."),
				nls.localize('debug.saveBeforeStart.nonUntitledEditorsInActiveGroup', "Save all editors in the active group except untitled ones before starting a debug session."),
				nls.localize('debug.saveBeforeStart.none', "Don't save any editors before starting a debug session."),
			],
			default: 'allEditorsInActiveGroup'
		}
	}
});
