/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/debug.contribution';
import 'vs/css!./media/debugHover';
import * as nls from 'vs/nls';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { SyncActionDescriptor, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { Registry } from 'vs/platform/registry/common/platform';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { IWorkbenchActionRegistry, Extensions as WorkbenchActionRegistryExtensions } from 'vs/workbench/common/actions';
import { BreakpointsView } from 'vs/workbench/contrib/debug/browser/breakpointsView';
import { CallStackView } from 'vs/workbench/contrib/debug/browser/callStackView';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import {
	IDebugService, VIEWLET_ID, DEBUG_PANEL_ID, CONTEXT_IN_DEBUG_MODE, INTERNAL_CONSOLE_OPTIONS_SCHEMA,
	CONTEXT_DEBUG_STATE, VARIABLES_VIEW_ID, CALLSTACK_VIEW_ID, WATCH_VIEW_ID, BREAKPOINTS_VIEW_ID, LOADED_SCRIPTS_VIEW_ID, CONTEXT_LOADED_SCRIPTS_SUPPORTED, CONTEXT_FOCUSED_SESSION_IS_ATTACH, CONTEXT_STEP_BACK_SUPPORTED, CONTEXT_CALLSTACK_ITEM_TYPE, CONTEXT_RESTART_FRAME_SUPPORTED, CONTEXT_JUMP_TO_CURSOR_SUPPORTED, CONTEXT_DEBUG_UX, BREAKPOINT_EDITOR_CONTRIBUTION_ID, REPL_VIEW_ID, CONTEXT_BREAKPOINTS_EXIST, EDITOR_CONTRIBUTION_ID, CONTEXT_DEBUGGERS_AVAILABLE,
} from 'vs/workbench/contrib/debug/common/debug';
import { StartAction, AddFunctionBreakpointAction, ConfigureAction, DisableAllBreakpointsAction, EnableAllBreakpointsAction, RemoveAllBreakpointsAction, RunAction, ReapplyBreakpointsAction, SelectAndStartAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { DebugToolBar } from 'vs/workbench/contrib/debug/browser/debugToolBar';
import { DebugService } from 'vs/workbench/contrib/debug/browser/debugService';
import { registerCommands, ADD_CONFIGURATION_ID, TOGGLE_INLINE_BREAKPOINT_ID, COPY_STACK_TRACE_ID, REVERSE_CONTINUE_ID, STEP_BACK_ID, RESTART_SESSION_ID, TERMINATE_THREAD_ID, STEP_OVER_ID, STEP_INTO_ID, STEP_OUT_ID, PAUSE_ID, DISCONNECT_ID, STOP_ID, RESTART_FRAME_ID, CONTINUE_ID, FOCUS_REPL_ID, JUMP_TO_CURSOR_ID, RESTART_LABEL, STEP_INTO_LABEL, STEP_OVER_LABEL, STEP_OUT_LABEL, PAUSE_LABEL, DISCONNECT_LABEL, STOP_LABEL, CONTINUE_LABEL } from 'vs/workbench/contrib/debug/browser/debugCommands';
import { StatusBarColorProvider } from 'vs/workbench/contrib/debug/browser/statusbarColorProvider';
import { IViewsRegistry, Extensions as ViewExtensions, IViewContainersRegistry, ViewContainerLocation, ViewContainer } from 'vs/workbench/common/views';
import { isMacintosh, isWeb } from 'vs/base/common/platform';
import { ContextKeyExpr, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { URI } from 'vs/base/common/uri';
import { DebugStatusContribution } from 'vs/workbench/contrib/debug/browser/debugStatus';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { launchSchemaId } from 'vs/workbench/services/configuration/common/configuration';
import { LoadedScriptsView } from 'vs/workbench/contrib/debug/browser/loadedScriptsView';
import { ADD_LOG_POINT_ID, TOGGLE_CONDITIONAL_BREAKPOINT_ID, TOGGLE_BREAKPOINT_ID, RunToCursorAction, registerEditorActions } from 'vs/workbench/contrib/debug/browser/debugEditorActions';
import { WatchExpressionsView } from 'vs/workbench/contrib/debug/browser/watchExpressionsView';
import { VariablesView } from 'vs/workbench/contrib/debug/browser/variablesView';
import { ClearReplAction, Repl } from 'vs/workbench/contrib/debug/browser/repl';
import { DebugContentProvider } from 'vs/workbench/contrib/debug/common/debugContentProvider';
import { WelcomeView } from 'vs/workbench/contrib/debug/browser/welcomeView';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { DebugViewPaneContainer, OpenDebugConsoleAction, OpenDebugViewletAction } from 'vs/workbench/contrib/debug/browser/debugViewlet';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { CallStackEditorContribution } from 'vs/workbench/contrib/debug/browser/callStackEditorContribution';
import { BreakpointEditorContribution } from 'vs/workbench/contrib/debug/browser/breakpointEditorContribution';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IQuickAccessRegistry, Extensions as QuickAccessExtensions } from 'vs/platform/quickinput/common/quickAccess';
import { StartDebugQuickAccessProvider } from 'vs/workbench/contrib/debug/browser/debugQuickAccess';
import { DebugProgressContribution } from 'vs/workbench/contrib/debug/browser/debugProgress';
import { DebugTitleContribution } from 'vs/workbench/contrib/debug/browser/debugTitle';
import { Codicon } from 'vs/base/common/codicons';
import { registerColors } from 'vs/workbench/contrib/debug/browser/debugColors';
import { DebugEditorContribution } from 'vs/workbench/contrib/debug/browser/debugEditorContribution';

const registry = Registry.as<IWorkbenchActionRegistry>(WorkbenchActionRegistryExtensions.WorkbenchActions);
const debugCategory = nls.localize('debugCategory', "Debug");
const runCategroy = nls.localize('runCategory', "Run");
registerWorkbenchContributions();
registerColors();
registerCommandsAndActions();
registerDebugMenu();
registerEditorActions();
registerCommands();
registerDebugPanel();
registry.registerWorkbenchAction(SyncActionDescriptor.from(StartAction, { primary: KeyCode.F5 }, CONTEXT_IN_DEBUG_MODE.toNegated()), 'Debug: Start Debugging', debugCategory, CONTEXT_DEBUGGERS_AVAILABLE);
registry.registerWorkbenchAction(SyncActionDescriptor.from(RunAction, { primary: KeyMod.CtrlCmd | KeyCode.F5, mac: { primary: KeyMod.WinCtrl | KeyCode.F5 } }), 'Run: Start Without Debugging', runCategroy, CONTEXT_DEBUGGERS_AVAILABLE);

registerSingleton(IDebugService, DebugService, true);
registerDebugView();
registerConfiguration();
regsiterEditorContributions();

function registerWorkbenchContributions(): void {
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

}

function regsiterEditorContributions(): void {
	registerEditorContribution('editor.contrib.callStack', CallStackEditorContribution);
	registerEditorContribution(BREAKPOINT_EDITOR_CONTRIBUTION_ID, BreakpointEditorContribution);
	registerEditorContribution(EDITOR_CONTRIBUTION_ID, DebugEditorContribution);
}

function registerCommandsAndActions(): void {

	registry.registerWorkbenchAction(SyncActionDescriptor.from(ConfigureAction), 'Debug: Open launch.json', debugCategory, CONTEXT_DEBUGGERS_AVAILABLE);
	registry.registerWorkbenchAction(SyncActionDescriptor.from(AddFunctionBreakpointAction), 'Debug: Add Function Breakpoint', debugCategory, CONTEXT_DEBUGGERS_AVAILABLE);
	registry.registerWorkbenchAction(SyncActionDescriptor.from(ReapplyBreakpointsAction), 'Debug: Reapply All Breakpoints', debugCategory, CONTEXT_DEBUGGERS_AVAILABLE);
	registry.registerWorkbenchAction(SyncActionDescriptor.from(RemoveAllBreakpointsAction), 'Debug: Remove All Breakpoints', debugCategory, CONTEXT_DEBUGGERS_AVAILABLE);
	registry.registerWorkbenchAction(SyncActionDescriptor.from(EnableAllBreakpointsAction), 'Debug: Enable All Breakpoints', debugCategory, CONTEXT_DEBUGGERS_AVAILABLE);
	registry.registerWorkbenchAction(SyncActionDescriptor.from(DisableAllBreakpointsAction), 'Debug: Disable All Breakpoints', debugCategory, CONTEXT_DEBUGGERS_AVAILABLE);
	registry.registerWorkbenchAction(SyncActionDescriptor.from(SelectAndStartAction), 'Debug: Select and Start Debugging', debugCategory, CONTEXT_DEBUGGERS_AVAILABLE);
	registry.registerWorkbenchAction(SyncActionDescriptor.from(ClearReplAction), 'Debug: Clear Console', debugCategory, CONTEXT_DEBUGGERS_AVAILABLE);

	const registerDebugCommandPaletteItem = (id: string, title: string, when?: ContextKeyExpression, precondition?: ContextKeyExpression) => {
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			when: ContextKeyExpr.and(CONTEXT_DEBUGGERS_AVAILABLE, when),
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
	registerDebugCommandPaletteItem(DISCONNECT_ID, DISCONNECT_LABEL, CONTEXT_IN_DEBUG_MODE, CONTEXT_FOCUSED_SESSION_IS_ATTACH);
	registerDebugCommandPaletteItem(STOP_ID, STOP_LABEL, CONTEXT_IN_DEBUG_MODE, CONTEXT_FOCUSED_SESSION_IS_ATTACH.toNegated());
	registerDebugCommandPaletteItem(CONTINUE_ID, CONTINUE_LABEL, CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
	registerDebugCommandPaletteItem(FOCUS_REPL_ID, nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'debugFocusConsole' }, 'Focus on Debug Console View'));
	registerDebugCommandPaletteItem(JUMP_TO_CURSOR_ID, nls.localize('jumpToCursor', "Jump to Cursor"), CONTEXT_JUMP_TO_CURSOR_SUPPORTED);
	registerDebugCommandPaletteItem(JUMP_TO_CURSOR_ID, nls.localize('SetNextStatement', "Set Next Statement"), CONTEXT_JUMP_TO_CURSOR_SUPPORTED);
	registerDebugCommandPaletteItem(RunToCursorAction.ID, RunToCursorAction.LABEL, ContextKeyExpr.and(CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE.isEqualTo('stopped')));
	registerDebugCommandPaletteItem(TOGGLE_INLINE_BREAKPOINT_ID, nls.localize('inlineBreakpoint', "Inline Breakpoint"));

	// Debug toolbar

	const registerDebugToolBarItem = (id: string, title: string, order: number, icon: { light?: URI, dark?: URI } | ThemeIcon, when?: ContextKeyExpression, precondition?: ContextKeyExpression) => {
		MenuRegistry.appendMenuItem(MenuId.DebugToolBar, {
			group: 'navigation',
			when,
			order,
			command: {
				id,
				title,
				icon,
				precondition
			}
		});
	};

	registerDebugToolBarItem(CONTINUE_ID, CONTINUE_LABEL, 10, { id: 'codicon/debug-continue' }, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
	registerDebugToolBarItem(PAUSE_ID, PAUSE_LABEL, 10, { id: 'codicon/debug-pause' }, CONTEXT_DEBUG_STATE.notEqualsTo('stopped'), CONTEXT_DEBUG_STATE.isEqualTo('running'));
	registerDebugToolBarItem(STOP_ID, STOP_LABEL, 70, { id: 'codicon/debug-stop' }, CONTEXT_FOCUSED_SESSION_IS_ATTACH.toNegated());
	registerDebugToolBarItem(DISCONNECT_ID, DISCONNECT_LABEL, 70, { id: 'codicon/debug-disconnect' }, CONTEXT_FOCUSED_SESSION_IS_ATTACH);
	registerDebugToolBarItem(STEP_OVER_ID, STEP_OVER_LABEL, 20, { id: 'codicon/debug-step-over' }, undefined, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
	registerDebugToolBarItem(STEP_INTO_ID, STEP_INTO_LABEL, 30, { id: 'codicon/debug-step-into' }, undefined, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
	registerDebugToolBarItem(STEP_OUT_ID, STEP_OUT_LABEL, 40, { id: 'codicon/debug-step-out' }, undefined, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
	registerDebugToolBarItem(RESTART_SESSION_ID, RESTART_LABEL, 60, { id: 'codicon/debug-restart' });
	registerDebugToolBarItem(STEP_BACK_ID, nls.localize('stepBackDebug', "Step Back"), 50, { id: 'codicon/debug-step-back' }, CONTEXT_STEP_BACK_SUPPORTED, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
	registerDebugToolBarItem(REVERSE_CONTINUE_ID, nls.localize('reverseContinue', "Reverse"), 60, { id: 'codicon/debug-reverse-continue' }, CONTEXT_STEP_BACK_SUPPORTED, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));

	// Debug callstack context menu
	const registerDebugCallstackItem = (id: string, title: string, order: number, when?: ContextKeyExpression, precondition?: ContextKeyExpression, group = 'navigation') => {
		MenuRegistry.appendMenuItem(MenuId.DebugCallStackContext, {
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
	registerDebugCallstackItem(RESTART_SESSION_ID, RESTART_LABEL, 10, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('session'));
	registerDebugCallstackItem(STOP_ID, STOP_LABEL, 20, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('session'));
	registerDebugCallstackItem(PAUSE_ID, PAUSE_LABEL, 10, ContextKeyExpr.and(CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('running')));
	registerDebugCallstackItem(CONTINUE_ID, CONTINUE_LABEL, 10, ContextKeyExpr.and(CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('stopped')));
	registerDebugCallstackItem(STEP_OVER_ID, STEP_OVER_LABEL, 20, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
	registerDebugCallstackItem(STEP_INTO_ID, STEP_INTO_LABEL, 30, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
	registerDebugCallstackItem(STEP_OUT_ID, STEP_OUT_LABEL, 40, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
	registerDebugCallstackItem(TERMINATE_THREAD_ID, nls.localize('terminateThread', "Terminate Thread"), 10, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('thread'), undefined, 'termination');
	registerDebugCallstackItem(RESTART_FRAME_ID, nls.localize('restartFrame', "Restart Frame"), 10, ContextKeyExpr.and(CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('stackFrame'), CONTEXT_RESTART_FRAME_SUPPORTED));
	registerDebugCallstackItem(COPY_STACK_TRACE_ID, nls.localize('copyStackTrace', "Copy Call Stack"), 20, CONTEXT_CALLSTACK_ITEM_TYPE.isEqualTo('stackFrame'));

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

		registerTouchBarEntry(StartAction.ID, StartAction.LABEL, 0, CONTEXT_IN_DEBUG_MODE.toNegated(), URI.parse(require.toUrl('vs/workbench/contrib/debug/browser/media/continue-tb.png')));
		registerTouchBarEntry(RunAction.ID, RunAction.LABEL, 1, CONTEXT_IN_DEBUG_MODE.toNegated(), URI.parse(require.toUrl('vs/workbench/contrib/debug/browser/media/continue-without-debugging-tb.png')));
		registerTouchBarEntry(CONTINUE_ID, CONTINUE_LABEL, 0, CONTEXT_DEBUG_STATE.isEqualTo('stopped'), URI.parse(require.toUrl('vs/workbench/contrib/debug/browser/media/continue-tb.png')));
		registerTouchBarEntry(PAUSE_ID, PAUSE_LABEL, 1, ContextKeyExpr.and(CONTEXT_IN_DEBUG_MODE, ContextKeyExpr.notEquals('debugState', 'stopped')), URI.parse(require.toUrl('vs/workbench/contrib/debug/browser/media/pause-tb.png')));
		registerTouchBarEntry(STEP_OVER_ID, STEP_OVER_LABEL, 2, CONTEXT_IN_DEBUG_MODE, URI.parse(require.toUrl('vs/workbench/contrib/debug/browser/media/stepover-tb.png')));
		registerTouchBarEntry(STEP_INTO_ID, STEP_INTO_LABEL, 3, CONTEXT_IN_DEBUG_MODE, URI.parse(require.toUrl('vs/workbench/contrib/debug/browser/media/stepinto-tb.png')));
		registerTouchBarEntry(STEP_OUT_ID, STEP_OUT_LABEL, 4, CONTEXT_IN_DEBUG_MODE, URI.parse(require.toUrl('vs/workbench/contrib/debug/browser/media/stepout-tb.png')));
		registerTouchBarEntry(RESTART_SESSION_ID, RESTART_LABEL, 5, CONTEXT_IN_DEBUG_MODE, URI.parse(require.toUrl('vs/workbench/contrib/debug/browser/media/restart-tb.png')));
		registerTouchBarEntry(STOP_ID, STOP_LABEL, 6, CONTEXT_IN_DEBUG_MODE, URI.parse(require.toUrl('vs/workbench/contrib/debug/browser/media/stop-tb.png')));
	}
}

function registerDebugMenu(): void {
	// View menu

	MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
		group: '3_views',
		command: {
			id: VIEWLET_ID,
			title: nls.localize({ key: 'miViewRun', comment: ['&& denotes a mnemonic'] }, "&&Run")
		},
		order: 4
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
		group: '4_panels',
		command: {
			id: OpenDebugConsoleAction.ID,
			title: nls.localize({ key: 'miToggleDebugConsole', comment: ['&& denotes a mnemonic'] }, "De&&bug Console")
		},
		order: 2
	});

	// Debug menu

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '1_debug',
		command: {
			id: StartAction.ID,
			title: nls.localize({ key: 'miStartDebugging', comment: ['&& denotes a mnemonic'] }, "&&Start Debugging")
		},
		order: 1
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '1_debug',
		command: {
			id: RunAction.ID,
			title: nls.localize({ key: 'miRun', comment: ['&& denotes a mnemonic'] }, "Run &&Without Debugging")
		},
		order: 2
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '1_debug',
		command: {
			id: STOP_ID,
			title: nls.localize({ key: 'miStopDebugging', comment: ['&& denotes a mnemonic'] }, "&&Stop Debugging"),
			precondition: CONTEXT_IN_DEBUG_MODE
		},
		order: 3
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '1_debug',
		command: {
			id: RESTART_SESSION_ID,
			title: nls.localize({ key: 'miRestart Debugging', comment: ['&& denotes a mnemonic'] }, "&&Restart Debugging"),
			precondition: CONTEXT_IN_DEBUG_MODE
		},
		order: 4
	});

	// Configuration
	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '2_configuration',
		command: {
			id: ConfigureAction.ID,
			title: nls.localize({ key: 'miOpenConfigurations', comment: ['&& denotes a mnemonic'] }, "Open &&Configurations")
		},
		order: 1
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '2_configuration',
		command: {
			id: ADD_CONFIGURATION_ID,
			title: nls.localize({ key: 'miAddConfiguration', comment: ['&& denotes a mnemonic'] }, "A&&dd Configuration...")
		},
		order: 2
	});

	// Step Commands
	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '3_step',
		command: {
			id: STEP_OVER_ID,
			title: nls.localize({ key: 'miStepOver', comment: ['&& denotes a mnemonic'] }, "Step &&Over"),
			precondition: CONTEXT_DEBUG_STATE.isEqualTo('stopped')
		},
		order: 1
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '3_step',
		command: {
			id: STEP_INTO_ID,
			title: nls.localize({ key: 'miStepInto', comment: ['&& denotes a mnemonic'] }, "Step &&Into"),
			precondition: CONTEXT_DEBUG_STATE.isEqualTo('stopped')
		},
		order: 2
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '3_step',
		command: {
			id: STEP_OUT_ID,
			title: nls.localize({ key: 'miStepOut', comment: ['&& denotes a mnemonic'] }, "Step O&&ut"),
			precondition: CONTEXT_DEBUG_STATE.isEqualTo('stopped')
		},
		order: 3
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '3_step',
		command: {
			id: CONTINUE_ID,
			title: nls.localize({ key: 'miContinue', comment: ['&& denotes a mnemonic'] }, "&&Continue"),
			precondition: CONTEXT_DEBUG_STATE.isEqualTo('stopped')
		},
		order: 4
	});

	// New Breakpoints
	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '4_new_breakpoint',
		command: {
			id: TOGGLE_BREAKPOINT_ID,
			title: nls.localize({ key: 'miToggleBreakpoint', comment: ['&& denotes a mnemonic'] }, "Toggle &&Breakpoint")
		},
		order: 1
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarNewBreakpointMenu, {
		group: '1_breakpoints',
		command: {
			id: TOGGLE_CONDITIONAL_BREAKPOINT_ID,
			title: nls.localize({ key: 'miConditionalBreakpoint', comment: ['&& denotes a mnemonic'] }, "&&Conditional Breakpoint...")
		},
		order: 1
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarNewBreakpointMenu, {
		group: '1_breakpoints',
		command: {
			id: TOGGLE_INLINE_BREAKPOINT_ID,
			title: nls.localize({ key: 'miInlineBreakpoint', comment: ['&& denotes a mnemonic'] }, "Inline Breakp&&oint")
		},
		order: 2
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarNewBreakpointMenu, {
		group: '1_breakpoints',
		command: {
			id: AddFunctionBreakpointAction.ID,
			title: nls.localize({ key: 'miFunctionBreakpoint', comment: ['&& denotes a mnemonic'] }, "&&Function Breakpoint...")
		},
		order: 3
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarNewBreakpointMenu, {
		group: '1_breakpoints',
		command: {
			id: ADD_LOG_POINT_ID,
			title: nls.localize({ key: 'miLogPoint', comment: ['&& denotes a mnemonic'] }, "&&Logpoint...")
		},
		order: 4
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '4_new_breakpoint',
		title: nls.localize({ key: 'miNewBreakpoint', comment: ['&& denotes a mnemonic'] }, "&&New Breakpoint"),
		submenu: MenuId.MenubarNewBreakpointMenu,
		order: 2
	});

	// Modify Breakpoints
	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '5_breakpoints',
		command: {
			id: EnableAllBreakpointsAction.ID,
			title: nls.localize({ key: 'miEnableAllBreakpoints', comment: ['&& denotes a mnemonic'] }, "&&Enable All Breakpoints")
		},
		order: 1
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '5_breakpoints',
		command: {
			id: DisableAllBreakpointsAction.ID,
			title: nls.localize({ key: 'miDisableAllBreakpoints', comment: ['&& denotes a mnemonic'] }, "Disable A&&ll Breakpoints")
		},
		order: 2
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: '5_breakpoints',
		command: {
			id: RemoveAllBreakpointsAction.ID,
			title: nls.localize({ key: 'miRemoveAllBreakpoints', comment: ['&& denotes a mnemonic'] }, "Remove &&All Breakpoints")
		},
		order: 3
	});

	// Install Debuggers
	MenuRegistry.appendMenuItem(MenuId.MenubarDebugMenu, {
		group: 'z_install',
		command: {
			id: 'debug.installAdditionalDebuggers',
			title: nls.localize({ key: 'miInstallAdditionalDebuggers', comment: ['&& denotes a mnemonic'] }, "&&Install Additional Debuggers...")
		},
		order: 1
	});
}

function registerDebugPanel(): void {
	// register repl panel

	const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
		id: DEBUG_PANEL_ID,
		name: nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'debugPanel' }, 'Debug Console'),
		icon: Codicon.debugConsole.classNames,
		ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [DEBUG_PANEL_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
		storageId: DEBUG_PANEL_ID,
		focusCommand: { id: OpenDebugConsoleAction.ID },
		order: 2,
		hideIfEmpty: true
	}, ViewContainerLocation.Panel);

	Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
		id: REPL_VIEW_ID,
		name: nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'debugPanel' }, 'Debug Console'),
		containerIcon: Codicon.debugConsole.classNames,
		canToggleVisibility: false,
		canMoveView: true,
		when: CONTEXT_DEBUGGERS_AVAILABLE,
		ctorDescriptor: new SyncDescriptor(Repl),
	}], VIEW_CONTAINER);

	registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenDebugConsoleAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_Y }), 'View: Debug Console', nls.localize('view', "View"), CONTEXT_DEBUGGERS_AVAILABLE);
}

function registerDebugView(): void {
	const viewContainer = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
		id: VIEWLET_ID,
		name: nls.localize('run', "Run"),
		ctorDescriptor: new SyncDescriptor(DebugViewPaneContainer),
		icon: Codicon.debugAlt.classNames,
		alwaysUseContainerInfo: true,
		order: 2
	}, ViewContainerLocation.Sidebar);
	registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenDebugViewletAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_D }), 'View: Show Run and Debug', nls.localize('view', "View"));

	// Register default debug views
	const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);
	viewsRegistry.registerViews([{ id: VARIABLES_VIEW_ID, name: nls.localize('variables', "Variables"), containerIcon: Codicon.debugAlt.classNames, ctorDescriptor: new SyncDescriptor(VariablesView), order: 10, weight: 40, canToggleVisibility: true, canMoveView: true, focusCommand: { id: 'workbench.debug.action.focusVariablesView' }, when: CONTEXT_DEBUG_UX.isEqualTo('default') }], viewContainer);
	viewsRegistry.registerViews([{ id: WATCH_VIEW_ID, name: nls.localize('watch', "Watch"), containerIcon: Codicon.debugAlt.classNames, ctorDescriptor: new SyncDescriptor(WatchExpressionsView), order: 20, weight: 10, canToggleVisibility: true, canMoveView: true, focusCommand: { id: 'workbench.debug.action.focusWatchView' }, when: CONTEXT_DEBUG_UX.isEqualTo('default') }], viewContainer);
	viewsRegistry.registerViews([{ id: CALLSTACK_VIEW_ID, name: nls.localize('callStack', "Call Stack"), containerIcon: Codicon.debugAlt.classNames, ctorDescriptor: new SyncDescriptor(CallStackView), order: 30, weight: 30, canToggleVisibility: true, canMoveView: true, focusCommand: { id: 'workbench.debug.action.focusCallStackView' }, when: CONTEXT_DEBUG_UX.isEqualTo('default') }], viewContainer);
	viewsRegistry.registerViews([{ id: BREAKPOINTS_VIEW_ID, name: nls.localize('breakpoints', "Breakpoints"), containerIcon: Codicon.debugAlt.classNames, ctorDescriptor: new SyncDescriptor(BreakpointsView), order: 40, weight: 20, canToggleVisibility: true, canMoveView: true, focusCommand: { id: 'workbench.debug.action.focusBreakpointsView' }, when: ContextKeyExpr.or(CONTEXT_BREAKPOINTS_EXIST, CONTEXT_DEBUG_UX.isEqualTo('default')) }], viewContainer);
	viewsRegistry.registerViews([{ id: WelcomeView.ID, name: WelcomeView.LABEL, containerIcon: Codicon.debugAlt.classNames, ctorDescriptor: new SyncDescriptor(WelcomeView), order: 1, weight: 40, canToggleVisibility: true, when: CONTEXT_DEBUG_UX.isEqualTo('simple') }], viewContainer);
	viewsRegistry.registerViews([{ id: LOADED_SCRIPTS_VIEW_ID, name: nls.localize('loadedScripts', "Loaded Scripts"), containerIcon: Codicon.debugAlt.classNames, ctorDescriptor: new SyncDescriptor(LoadedScriptsView), order: 35, weight: 5, canToggleVisibility: true, canMoveView: true, collapsed: true, when: ContextKeyExpr.and(CONTEXT_LOADED_SCRIPTS_SUPPORTED, CONTEXT_DEBUG_UX.isEqualTo('default')) }], viewContainer);
}

function registerConfiguration(): void {
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
				type: 'boolean',
				description: nls.localize({ comment: ['This is the description for a setting'], key: 'inlineValues' }, "Show variable values inline in editor while debugging."),
				default: false
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
			'debug.openDebug': {
				enum: ['neverOpen', 'openOnSessionStart', 'openOnFirstSessionStart', 'openOnDebugBreak'],
				default: 'openOnFirstSessionStart',
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
			}
		}
	});
}
