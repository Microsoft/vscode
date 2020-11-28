/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IListService } from 'vs/platform/list/browser/listService';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IDebugService, IEnablement, CONTEXT_BREAKPOINTS_FOCUSED, CONTEXT_WATCH_EXPRESSIONS_FOCUSED, CONTEXT_VARIABLES_FOCUSED, EDITOR_CONTRIBUTION_ID, IDebugEditorContribution, CONTEXT_IN_DEBUG_MODE, CONTEXT_EXPRESSION_SELECTED, CONTEXT_BREAKPOINT_SELECTED, IConfig, IStackFrame, IThread, IDebugSession, CONTEXT_DEBUG_STATE, IDebugConfiguration, CONTEXT_JUMP_TO_CURSOR_SUPPORTED, REPL_VIEW_ID } from 'vs/workbench/contrib/debug/common/debug';
import { Expression, Variable, Breakpoint, FunctionBreakpoint, DataBreakpoint } from 'vs/workbench/contrib/debug/common/debugModel';
import { IExtensionsViewPaneContainer, VIEWLET_ID as EXTENSIONS_VIEWLET_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { ICodeEditor, isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { openBreakpointSource } from 'vs/workbench/contrib/debug/browser/breakpointsView';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { InputFocusedContext } from 'vs/platform/contextkey/common/contextkeys';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { PanelFocusContext } from 'vs/workbench/common/panel';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IViewsService } from 'vs/workbench/common/views';

export const ADD_CONFIGURATION_ID = 'debug.addConfiguration';
export const TOGGLE_INLINE_BREAKPOINT_ID = 'editor.debug.action.toggleInlineBreakpoint';
export const COPY_STACK_TRACE_ID = 'debug.copyStackTrace';
export const REVERSE_CONTINUE_ID = 'workbench.action.debug.reverseContinue';
export const STEP_BACK_ID = 'workbench.action.debug.stepBack';
export const RESTART_SESSION_ID = 'workbench.action.debug.restart';
export const TERMINATE_THREAD_ID = 'workbench.action.debug.terminateThread';
export const STEP_OVER_ID = 'workbench.action.debug.stepOver';
export const STEP_INTO_ID = 'workbench.action.debug.stepInto';
export const STEP_OUT_ID = 'workbench.action.debug.stepOut';
export const PAUSE_ID = 'workbench.action.debug.pause';
export const DISCONNECT_ID = 'workbench.action.debug.disconnect';
export const STOP_ID = 'workbench.action.debug.stop';
export const RESTART_FRAME_ID = 'workbench.action.debug.restartFrame';
export const CONTINUE_ID = 'workbench.action.debug.continue';
export const FOCUS_REPL_ID = 'workbench.debug.action.focusRepl';
export const JUMP_TO_CURSOR_ID = 'debug.jumpToCursor';

export const RESTART_LABEL = nls.localize('restartDebug', "Restart");
export const STEP_OVER_LABEL = nls.localize('stepOverDebug', "Step Over");
export const STEP_INTO_LABEL = nls.localize('stepIntoDebug', "Step Into");
export const STEP_OUT_LABEL = nls.localize('stepOutDebug', "Step Out");
export const PAUSE_LABEL = nls.localize('pauseDebug', "Pause");
export const DISCONNECT_LABEL = nls.localize('disconnect', "Disconnect");
export const STOP_LABEL = nls.localize('stop', "Stop");
export const CONTINUE_LABEL = nls.localize('continueDebug', "Continue");

interface CallStackContext {
	sessionId: string;
	threadId: string;
	frameId: string;
}

function isThreadContext(obj: any): obj is CallStackContext {
	return obj && typeof obj.sessionId === 'string' && typeof obj.threadId === 'string';
}

async function getThreadAndRun(accessor: ServicesAccessor, sessionAndThreadId: CallStackContext | unknown, run: (thread: IThread) => Promise<void>): Promise<void> {
	const debugService = accessor.get(IDebugService);
	let thread: IThread | undefined;
	if (isThreadContext(sessionAndThreadId)) {
		const session = debugService.getModel().getSession(sessionAndThreadId.sessionId);
		if (session) {
			thread = session.getAllThreads().find(t => t.getId() === sessionAndThreadId.threadId);
		}
	} else {
		thread = debugService.getViewModel().focusedThread;
		if (!thread) {
			const focusedSession = debugService.getViewModel().focusedSession;
			const threads = focusedSession ? focusedSession.getAllThreads() : undefined;
			thread = threads && threads.length ? threads[0] : undefined;
		}
	}

	if (thread) {
		await run(thread);
	}
}

function isStackFrameContext(obj: any): obj is CallStackContext {
	return obj && typeof obj.sessionId === 'string' && typeof obj.threadId === 'string' && typeof obj.frameId === 'string';
}

function getFrame(debugService: IDebugService, context: CallStackContext | unknown): IStackFrame | undefined {
	if (isStackFrameContext(context)) {
		const session = debugService.getModel().getSession(context.sessionId);
		if (session) {
			const thread = session.getAllThreads().find(t => t.getId() === context.threadId);
			if (thread) {
				return thread.getCallStack().find(sf => sf.getId() === context.frameId);
			}
		}
	}

	return undefined;
}

function isSessionContext(obj: any): obj is CallStackContext {
	return obj && typeof obj.sessionId === 'string';
}

export function registerCommands(): void {

	// These commands are used in call stack context menu, call stack inline actions, command palette, debug toolbar, mac native touch bar
	// When the command is exectued in the context of a thread(context menu on a thread, inline call stack action) we pass the thread id
	// Otherwise when it is executed "globaly"(using the touch bar, debug toolbar, command palette) we do not pass any id and just take whatever is the focussed thread
	// Same for stackFrame commands and session commands.
	CommandsRegistry.registerCommand({
		id: COPY_STACK_TRACE_ID,
		handler: async (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			const textResourcePropertiesService = accessor.get(ITextResourcePropertiesService);
			const clipboardService = accessor.get(IClipboardService);
			let frame = getFrame(accessor.get(IDebugService), context);
			if (frame) {
				const eol = textResourcePropertiesService.getEOL(frame.source.uri);
				await clipboardService.writeText(frame.thread.getCallStack().map(sf => sf.toString()).join(eol));
			}
		}
	});

	CommandsRegistry.registerCommand({
		id: REVERSE_CONTINUE_ID,
		handler: (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			getThreadAndRun(accessor, context, thread => thread.reverseContinue());
		}
	});

	CommandsRegistry.registerCommand({
		id: STEP_BACK_ID,
		handler: (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			getThreadAndRun(accessor, context, thread => thread.stepBack());
		}
	});

	CommandsRegistry.registerCommand({
		id: TERMINATE_THREAD_ID,
		handler: (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			getThreadAndRun(accessor, context, thread => thread.terminate());
		}
	});

	CommandsRegistry.registerCommand({
		id: JUMP_TO_CURSOR_ID,
		handler: async (accessor: ServicesAccessor) => {
			const debugService = accessor.get(IDebugService);
			const stackFrame = debugService.getViewModel().focusedStackFrame;
			const editorService = accessor.get(IEditorService);
			const activeEditorControl = editorService.activeTextEditorControl;
			const notificationService = accessor.get(INotificationService);
			const quickInputService = accessor.get(IQuickInputService);

			if (stackFrame && isCodeEditor(activeEditorControl) && activeEditorControl.hasModel()) {
				const position = activeEditorControl.getPosition();
				const resource = activeEditorControl.getModel().uri;
				const source = stackFrame.thread.session.getSourceForUri(resource);
				if (source) {
					const response = await stackFrame.thread.session.gotoTargets(source.raw, position.lineNumber, position.column);
					const targets = response?.body.targets;
					if (targets && targets.length) {
						let id = targets[0].id;
						if (targets.length > 1) {
							const picks = targets.map(t => ({ label: t.label, _id: t.id }));
							const pick = await quickInputService.pick(picks, { placeHolder: nls.localize('chooseLocation', "Choose the specific location") });
							if (!pick) {
								return;
							}

							id = pick._id;
						}

						return await stackFrame.thread.session.goto(stackFrame.thread.threadId, id).catch(e => notificationService.warn(e));
					}
				}
			}

			return notificationService.warn(nls.localize('noExecutableCode', "No executable code is associated at the current cursor position."));
		}
	});

	MenuRegistry.appendMenuItem(MenuId.EditorContext, {
		command: {
			id: JUMP_TO_CURSOR_ID,
			title: nls.localize('jumpToCursor', "Jump to Cursor"),
			category: { value: nls.localize('debug', "Debug"), original: 'Debug' }
		},
		when: ContextKeyExpr.and(CONTEXT_JUMP_TO_CURSOR_SUPPORTED, EditorContextKeys.editorTextFocus),
		group: 'debug',
		order: 3
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: RESTART_SESSION_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.Shift | KeyMod.CtrlCmd | KeyCode.F5,
		when: CONTEXT_IN_DEBUG_MODE,
		handler: async (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			const debugService = accessor.get(IDebugService);
			let session: IDebugSession | undefined;
			if (isSessionContext(context)) {
				session = debugService.getModel().getSession(context.sessionId);
			} else {
				session = debugService.getViewModel().focusedSession;
			}

			if (!session) {
				const { launch, name } = debugService.getConfigurationManager().selectedConfiguration;
				await debugService.startDebugging(launch, name, { noDebug: false });
			} else {
				session.removeReplExpressions();
				await debugService.restartSession(session);
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: STEP_OVER_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyCode.F10,
		when: CONTEXT_DEBUG_STATE.isEqualTo('stopped'),
		handler: (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			getThreadAndRun(accessor, context, (thread: IThread) => thread.next());
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: STEP_INTO_ID,
		weight: KeybindingWeight.WorkbenchContrib + 10, // Have a stronger weight to have priority over full screen when debugging
		primary: KeyCode.F11,
		// Use a more flexible when clause to not allow full screen command to take over when F11 pressed a lot of times
		when: CONTEXT_DEBUG_STATE.notEqualsTo('inactive'),
		handler: (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			getThreadAndRun(accessor, context, (thread: IThread) => thread.stepIn());
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: STEP_OUT_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.Shift | KeyCode.F11,
		when: CONTEXT_DEBUG_STATE.isEqualTo('stopped'),
		handler: (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			getThreadAndRun(accessor, context, (thread: IThread) => thread.stepOut());
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: PAUSE_ID,
		weight: KeybindingWeight.WorkbenchContrib + 2, // take priority over focus next part while we are debugging
		primary: KeyCode.F6,
		when: CONTEXT_DEBUG_STATE.isEqualTo('running'),
		handler: (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			getThreadAndRun(accessor, context, thread => thread.pause());
		}
	});

	CommandsRegistry.registerCommand({
		id: DISCONNECT_ID,
		handler: async (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			const debugService = accessor.get(IDebugService);
			let session: IDebugSession | undefined;
			if (isSessionContext(context)) {
				session = debugService.getModel().getSession(context.sessionId);
			} else {
				session = debugService.getViewModel().focusedSession;
			}
			await debugService.stopSession(session);
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: STOP_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.Shift | KeyCode.F5,
		when: CONTEXT_IN_DEBUG_MODE,
		handler: async (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			const debugService = accessor.get(IDebugService);
			let session: IDebugSession | undefined;
			if (isSessionContext(context)) {
				session = debugService.getModel().getSession(context.sessionId);
			} else {
				session = debugService.getViewModel().focusedSession;
			}

			const configurationService = accessor.get(IConfigurationService);
			const showSubSessions = configurationService.getValue<IDebugConfiguration>('debug').showSubSessionsInToolBar;
			// Stop should be sent to the root parent session
			while (!showSubSessions && session && session.parentSession) {
				session = session.parentSession;
			}

			await debugService.stopSession(session);
		}
	});

	CommandsRegistry.registerCommand({
		id: RESTART_FRAME_ID,
		handler: async (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			const debugService = accessor.get(IDebugService);
			const notificationService = accessor.get(INotificationService);
			let frame = getFrame(debugService, context);
			if (frame) {
				try {
					await frame.restart();
				} catch (e) {
					notificationService.error(e);
				}
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: CONTINUE_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyCode.F5,
		when: CONTEXT_IN_DEBUG_MODE,
		handler: (accessor: ServicesAccessor, _: string, context: CallStackContext | unknown) => {
			getThreadAndRun(accessor, context, thread => thread.continue());
		}
	});

	CommandsRegistry.registerCommand({
		id: FOCUS_REPL_ID,
		handler: async (accessor) => {
			const viewsService = accessor.get(IViewsService);
			await viewsService.openView(REPL_VIEW_ID, true);
		}
	});

	CommandsRegistry.registerCommand({
		id: 'debug.startFromConfig',
		handler: async (accessor, config: IConfig) => {
			const debugService = accessor.get(IDebugService);
			await debugService.startDebugging(undefined, config);
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'debug.toggleBreakpoint',
		weight: KeybindingWeight.WorkbenchContrib + 5,
		when: ContextKeyExpr.and(CONTEXT_BREAKPOINTS_FOCUSED, InputFocusedContext.toNegated()),
		primary: KeyCode.Space,
		handler: (accessor) => {
			const listService = accessor.get(IListService);
			const debugService = accessor.get(IDebugService);
			const list = listService.lastFocusedList;
			if (list instanceof List) {
				const focused = <IEnablement[]>list.getFocusedElements();
				if (focused && focused.length) {
					debugService.enableOrDisableBreakpoints(!focused[0].enabled, focused[0]);
				}
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'debug.enableOrDisableBreakpoint',
		weight: KeybindingWeight.WorkbenchContrib,
		primary: undefined,
		when: EditorContextKeys.editorTextFocus,
		handler: (accessor) => {
			const debugService = accessor.get(IDebugService);
			const editorService = accessor.get(IEditorService);
			const control = editorService.activeTextEditorControl;
			if (isCodeEditor(control)) {
				const model = control.getModel();
				if (model) {
					const position = control.getPosition();
					if (position) {
						const bps = debugService.getModel().getBreakpoints({ uri: model.uri, lineNumber: position.lineNumber });
						if (bps.length) {
							debugService.enableOrDisableBreakpoints(!bps[0].enabled, bps[0]);
						}
					}
				}
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'debug.renameWatchExpression',
		weight: KeybindingWeight.WorkbenchContrib + 5,
		when: CONTEXT_WATCH_EXPRESSIONS_FOCUSED,
		primary: KeyCode.F2,
		mac: { primary: KeyCode.Enter },
		handler: (accessor) => {
			const listService = accessor.get(IListService);
			const debugService = accessor.get(IDebugService);
			const focused = listService.lastFocusedList;

			if (focused) {
				const elements = focused.getFocus();
				if (Array.isArray(elements) && elements[0] instanceof Expression) {
					debugService.getViewModel().setSelectedExpression(elements[0]);
				}
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'debug.setVariable',
		weight: KeybindingWeight.WorkbenchContrib + 5,
		when: CONTEXT_VARIABLES_FOCUSED,
		primary: KeyCode.F2,
		mac: { primary: KeyCode.Enter },
		handler: (accessor) => {
			const listService = accessor.get(IListService);
			const debugService = accessor.get(IDebugService);
			const focused = listService.lastFocusedList;

			if (focused) {
				const elements = focused.getFocus();
				if (Array.isArray(elements) && elements[0] instanceof Variable) {
					debugService.getViewModel().setSelectedExpression(elements[0]);
				}
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'debug.removeWatchExpression',
		weight: KeybindingWeight.WorkbenchContrib,
		when: ContextKeyExpr.and(CONTEXT_WATCH_EXPRESSIONS_FOCUSED, CONTEXT_EXPRESSION_SELECTED.toNegated()),
		primary: KeyCode.Delete,
		mac: { primary: KeyMod.CtrlCmd | KeyCode.Backspace },
		handler: (accessor) => {
			const listService = accessor.get(IListService);
			const debugService = accessor.get(IDebugService);
			const focused = listService.lastFocusedList;

			if (focused) {
				let elements = focused.getFocus();
				if (Array.isArray(elements) && elements[0] instanceof Expression) {
					const selection = focused.getSelection();
					if (selection && selection.indexOf(elements[0]) >= 0) {
						elements = selection;
					}
					elements.forEach((e: Expression) => debugService.removeWatchExpressions(e.getId()));
				}
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'debug.removeBreakpoint',
		weight: KeybindingWeight.WorkbenchContrib,
		when: ContextKeyExpr.and(CONTEXT_BREAKPOINTS_FOCUSED, CONTEXT_BREAKPOINT_SELECTED.toNegated()),
		primary: KeyCode.Delete,
		mac: { primary: KeyMod.CtrlCmd | KeyCode.Backspace },
		handler: (accessor) => {
			const listService = accessor.get(IListService);
			const debugService = accessor.get(IDebugService);
			const list = listService.lastFocusedList;

			if (list instanceof List) {
				const focused = list.getFocusedElements();
				const element = focused.length ? focused[0] : undefined;
				if (element instanceof Breakpoint) {
					debugService.removeBreakpoints(element.getId());
				} else if (element instanceof FunctionBreakpoint) {
					debugService.removeFunctionBreakpoints(element.getId());
				} else if (element instanceof DataBreakpoint) {
					debugService.removeDataBreakpoints(element.getId());
				}
			}
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'debug.installAdditionalDebuggers',
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		handler: async (accessor) => {
			const viewletService = accessor.get(IViewletService);
			const viewlet = (await viewletService.openViewlet(EXTENSIONS_VIEWLET_ID, true))?.getViewPaneContainer() as IExtensionsViewPaneContainer;
			viewlet.search('tag:debuggers @sort:installs');
			viewlet.focus();
		}
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: ADD_CONFIGURATION_ID,
		weight: KeybindingWeight.WorkbenchContrib,
		when: undefined,
		primary: undefined,
		handler: async (accessor, launchUri: string) => {
			const manager = accessor.get(IDebugService).getConfigurationManager();
			if (accessor.get(IWorkspaceContextService).getWorkbenchState() === WorkbenchState.EMPTY) {
				accessor.get(INotificationService).info(nls.localize('noFolderDebugConfig', "Please first open a folder in order to do advanced debug configuration."));
				return;
			}

			const launch = manager.getLaunches().find(l => l.uri.toString() === launchUri) || manager.selectedConfiguration.launch;
			if (launch) {
				const { editor, created } = await launch.openConfigFile(false);
				if (editor && !created) {
					const codeEditor = <ICodeEditor>editor.getControl();
					if (codeEditor) {
						await codeEditor.getContribution<IDebugEditorContribution>(EDITOR_CONTRIBUTION_ID).addLaunchConfiguration();
					}
				}
			}
		}
	});

	const inlineBreakpointHandler = (accessor: ServicesAccessor) => {
		const debugService = accessor.get(IDebugService);
		const editorService = accessor.get(IEditorService);
		const control = editorService.activeTextEditorControl;
		if (isCodeEditor(control)) {
			const position = control.getPosition();
			if (position && control.hasModel() && debugService.canSetBreakpointsIn(control.getModel())) {
				const modelUri = control.getModel().uri;
				const breakpointAlreadySet = debugService.getModel().getBreakpoints({ lineNumber: position.lineNumber, uri: modelUri })
					.some(bp => (bp.sessionAgnosticData.column === position.column || (!bp.column && position.column <= 1)));

				if (!breakpointAlreadySet) {
					debugService.addBreakpoints(modelUri, [{ lineNumber: position.lineNumber, column: position.column > 1 ? position.column : undefined }]);
				}
			}
		}
	};

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		weight: KeybindingWeight.WorkbenchContrib,
		primary: KeyMod.Shift | KeyCode.F9,
		when: EditorContextKeys.editorTextFocus,
		id: TOGGLE_INLINE_BREAKPOINT_ID,
		handler: inlineBreakpointHandler
	});

	MenuRegistry.appendMenuItem(MenuId.EditorContext, {
		command: {
			id: TOGGLE_INLINE_BREAKPOINT_ID,
			title: nls.localize('addInlineBreakpoint', "Add Inline Breakpoint"),
			category: { value: nls.localize('debug', "Debug"), original: 'Debug' }
		},
		when: ContextKeyExpr.and(CONTEXT_IN_DEBUG_MODE, PanelFocusContext.toNegated(), EditorContextKeys.editorTextFocus),
		group: 'debug',
		order: 1
	});

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'debug.openBreakpointToSide',
		weight: KeybindingWeight.WorkbenchContrib,
		when: CONTEXT_BREAKPOINTS_FOCUSED,
		primary: KeyMod.CtrlCmd | KeyCode.Enter,
		secondary: [KeyMod.Alt | KeyCode.Enter],
		handler: (accessor) => {
			const listService = accessor.get(IListService);
			const list = listService.lastFocusedList;
			if (list instanceof List) {
				const focus = list.getFocusedElements();
				if (focus.length && focus[0] instanceof Breakpoint) {
					return openBreakpointSource(focus[0], true, false, true, accessor.get(IDebugService), accessor.get(IEditorService));
				}
			}

			return undefined;
		}
	});
}
