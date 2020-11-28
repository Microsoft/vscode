/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { KeyMod, KeyChord, KeyCode } from 'vs/base/common/keyCodes';
import { Range } from 'vs/editor/common/core/range';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ServicesAccessor, registerEditorAction, EditorAction, IActionOptions } from 'vs/editor/browser/editorExtensions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IDebugService, CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE, State, IDebugEditorContribution, EDITOR_CONTRIBUTION_ID, BreakpointWidgetContext, IBreakpoint, BREAKPOINT_EDITOR_CONTRIBUTION_ID, IBreakpointEditorContribution, REPL_VIEW_ID, CONTEXT_STEP_INTO_TARGETS_SUPPORTED, WATCH_VIEW_ID, CONTEXT_DEBUGGERS_AVAILABLE, CONTEXT_EXCEPTION_WIDGET_VISIBLE } from 'vs/workbench/contrib/debug/common/debug';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { openBreakpointSource } from 'vs/workbench/contrib/debug/browser/breakpointsView';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { PanelFocusContext } from 'vs/workbench/common/panel';
import { IViewsService } from 'vs/workbench/common/views';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { Action } from 'vs/base/common/actions';
import { getDomNodePagePosition } from 'vs/base/browser/dom';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { Position } from 'vs/editor/common/core/position';
import { URI } from 'vs/base/common/uri';
import { IDisposable } from 'vs/base/common/lifecycle';
import { raceTimeout } from 'vs/base/common/async';

export const TOGGLE_BREAKPOINT_ID = 'editor.debug.action.toggleBreakpoint';
class ToggleBreakpointAction extends EditorAction {
	constructor() {
		super({
			id: TOGGLE_BREAKPOINT_ID,
			label: nls.localize('toggleBreakpointAction', "Debug: Toggle Breakpoint"),
			alias: 'Debug: Toggle Breakpoint',
			precondition: CONTEXT_DEBUGGERS_AVAILABLE,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyCode.F9,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<any> {
		if (editor.hasModel()) {
			const debugService = accessor.get(IDebugService);
			const modelUri = editor.getModel().uri;
			const canSet = debugService.canSetBreakpointsIn(editor.getModel());
			// Does not account for multi line selections, Set to remove multiple cursor on the same line
			const lineNumbers = [...new Set(editor.getSelections().map(s => s.getPosition().lineNumber))];

			return Promise.all(lineNumbers.map(line => {
				const bps = debugService.getModel().getBreakpoints({ lineNumber: line, uri: modelUri });
				if (bps.length) {
					return Promise.all(bps.map(bp => debugService.removeBreakpoints(bp.getId())));
				} else if (canSet) {
					return (debugService.addBreakpoints(modelUri, [{ lineNumber: line }]));
				} else {
					return [];
				}
			}));
		}
	}
}

export const TOGGLE_CONDITIONAL_BREAKPOINT_ID = 'editor.debug.action.conditionalBreakpoint';
class ConditionalBreakpointAction extends EditorAction {

	constructor() {
		super({
			id: TOGGLE_CONDITIONAL_BREAKPOINT_ID,
			label: nls.localize('conditionalBreakpointEditorAction', "Debug: Add Conditional Breakpoint..."),
			alias: 'Debug: Add Conditional Breakpoint...',
			precondition: CONTEXT_DEBUGGERS_AVAILABLE
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const debugService = accessor.get(IDebugService);

		const position = editor.getPosition();
		if (position && editor.hasModel() && debugService.canSetBreakpointsIn(editor.getModel())) {
			editor.getContribution<IBreakpointEditorContribution>(BREAKPOINT_EDITOR_CONTRIBUTION_ID).showBreakpointWidget(position.lineNumber, undefined, BreakpointWidgetContext.CONDITION);
		}
	}
}

export const ADD_LOG_POINT_ID = 'editor.debug.action.addLogPoint';
class LogPointAction extends EditorAction {

	constructor() {
		super({
			id: ADD_LOG_POINT_ID,
			label: nls.localize('logPointEditorAction', "Debug: Add Logpoint..."),
			alias: 'Debug: Add Logpoint...',
			precondition: CONTEXT_DEBUGGERS_AVAILABLE
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const debugService = accessor.get(IDebugService);

		const position = editor.getPosition();
		if (position && editor.hasModel() && debugService.canSetBreakpointsIn(editor.getModel())) {
			editor.getContribution<IBreakpointEditorContribution>(BREAKPOINT_EDITOR_CONTRIBUTION_ID).showBreakpointWidget(position.lineNumber, position.column, BreakpointWidgetContext.LOG_MESSAGE);
		}
	}
}

export class RunToCursorAction extends EditorAction {

	public static readonly ID = 'editor.debug.action.runToCursor';
	public static readonly LABEL = nls.localize('runToCursor', "Run to Cursor");

	constructor() {
		super({
			id: RunToCursorAction.ID,
			label: RunToCursorAction.LABEL,
			alias: 'Debug: Run to Cursor',
			precondition: ContextKeyExpr.and(CONTEXT_IN_DEBUG_MODE, PanelFocusContext.toNegated(), CONTEXT_DEBUG_STATE.isEqualTo('stopped'), EditorContextKeys.editorTextFocus),
			contextMenuOpts: {
				group: 'debug',
				order: 2
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const debugService = accessor.get(IDebugService);
		const focusedSession = debugService.getViewModel().focusedSession;
		if (debugService.state !== State.Stopped || !focusedSession) {
			return;
		}

		const position = editor.getPosition();
		if (!(editor.hasModel() && position)) {
			return;
		}

		const uri = editor.getModel().uri;
		const bpExists = !!(debugService.getModel().getBreakpoints({ column: position.column, lineNumber: position.lineNumber, uri }).length);

		let breakpointToRemove: IBreakpoint | undefined;
		let threadToContinue = debugService.getViewModel().focusedThread;
		if (!bpExists) {
			const addResult = await this.addBreakpoints(accessor, uri, position);
			if (addResult.thread) {
				threadToContinue = addResult.thread;
			}

			if (addResult.breakpoint) {
				breakpointToRemove = addResult.breakpoint;
			}
		}

		if (!threadToContinue) {
			return;
		}

		const oneTimeListener = threadToContinue.session.onDidChangeState(() => {
			const state = focusedSession.state;
			if (state === State.Stopped || state === State.Inactive) {
				if (breakpointToRemove) {
					debugService.removeBreakpoints(breakpointToRemove.getId());
				}
				oneTimeListener.dispose();
			}
		});

		await threadToContinue.continue();
	}

	private async addBreakpoints(accessor: ServicesAccessor, uri: URI, position: Position) {
		const debugService = accessor.get(IDebugService);
		const debugModel = debugService.getModel();
		const viewModel = debugService.getViewModel();
		const uriIdentityService = accessor.get(IUriIdentityService);

		let column = 0;
		const focusedStackFrame = viewModel.focusedStackFrame;
		if (focusedStackFrame && uriIdentityService.extUri.isEqual(focusedStackFrame.source.uri, uri) && focusedStackFrame.range.startLineNumber === position.lineNumber) {
			// If the cursor is on a line different than the one the debugger is currently paused on, then send the breakpoint at column 0 on the line
			// otherwise set it at the precise column #102199
			column = position.column;
		}

		const breakpoints = await debugService.addBreakpoints(uri, [{ lineNumber: position.lineNumber, column }], false);
		const breakpoint = breakpoints?.[0];
		if (!breakpoint) {
			return { breakpoint: undefined, thread: viewModel.focusedThread };
		}

		// If the breakpoint was not initially verified, wait up to 2s for it to become so.
		// Inherently racey if multiple sessions can verify async, but not solvable...
		if (!breakpoint.verified) {
			let listener: IDisposable;
			await raceTimeout(new Promise<void>(resolve => {
				listener = debugModel.onDidChangeBreakpoints(() => {
					if (breakpoint.verified) {
						resolve();
					}
				});
			}), 2000);
			listener!.dispose();
		}

		// Look at paused threads for sessions that verified this bp. Prefer, in order:
		const enum Score {
			/** The focused thread */
			Focused,
			/** Any other stopped thread of a session that verified the bp */
			Verified,
			/** Any thread that verified and paused in the same file */
			VerifiedAndPausedInFile,
			/** The focused thread if it verified the breakpoint */
			VerifiedAndFocused,
		}

		let bestThread = viewModel.focusedThread;
		let bestScore = Score.Focused;
		for (const sessionId of breakpoint.sessionsThatVerified) {
			const session = debugModel.getSession(sessionId);
			if (!session) {
				continue;
			}

			const threads = session.getAllThreads().filter(t => t.stopped);
			if (bestScore < Score.VerifiedAndFocused) {
				if (viewModel.focusedThread && threads.includes(viewModel.focusedThread)) {
					bestThread = viewModel.focusedThread;
					bestScore = Score.VerifiedAndFocused;
				}
			}

			if (bestScore < Score.VerifiedAndPausedInFile) {
				const pausedInThisFile = threads.find(t => {
					const top = t.getTopStackFrame();
					return top && uriIdentityService.extUri.isEqual(top.source.uri, uri);
				});

				if (pausedInThisFile) {
					bestThread = pausedInThisFile;
					bestScore = Score.VerifiedAndPausedInFile;
				}
			}

			if (bestScore < Score.Verified) {
				bestThread = threads[0];
				bestScore = Score.VerifiedAndPausedInFile;
			}
		}

		return { thread: bestThread, breakpoint };
	}
}

class SelectionToReplAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.debug.action.selectionToRepl',
			label: nls.localize('evaluateInDebugConsole', "Evaluate in Debug Console"),
			alias: 'Evaluate',
			precondition: ContextKeyExpr.and(EditorContextKeys.hasNonEmptySelection, CONTEXT_IN_DEBUG_MODE, EditorContextKeys.editorTextFocus),
			contextMenuOpts: {
				group: 'debug',
				order: 0
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const debugService = accessor.get(IDebugService);
		const viewsService = accessor.get(IViewsService);
		const viewModel = debugService.getViewModel();
		const session = viewModel.focusedSession;
		if (!editor.hasModel() || !session) {
			return;
		}

		const text = editor.getModel().getValueInRange(editor.getSelection());
		await session.addReplExpression(viewModel.focusedStackFrame!, text);
		await viewsService.openView(REPL_VIEW_ID, false);
	}
}

class SelectionToWatchExpressionsAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.debug.action.selectionToWatch',
			label: nls.localize('addToWatch', "Add to Watch"),
			alias: 'Add to Watch',
			precondition: ContextKeyExpr.and(EditorContextKeys.hasNonEmptySelection, CONTEXT_IN_DEBUG_MODE, EditorContextKeys.editorTextFocus),
			contextMenuOpts: {
				group: 'debug',
				order: 1
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const debugService = accessor.get(IDebugService);
		const viewsService = accessor.get(IViewsService);
		if (!editor.hasModel()) {
			return;
		}

		const text = editor.getModel().getValueInRange(editor.getSelection());
		await viewsService.openView(WATCH_VIEW_ID);
		debugService.addWatchExpression(text);
	}
}

class ShowDebugHoverAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.debug.action.showDebugHover',
			label: nls.localize('showDebugHover', "Debug: Show Hover"),
			alias: 'Debug: Show Hover',
			precondition: CONTEXT_IN_DEBUG_MODE,
			kbOpts: {
				kbExpr: EditorContextKeys.editorTextFocus,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_I),
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const position = editor.getPosition();
		if (!position || !editor.hasModel()) {
			return;
		}
		const word = editor.getModel().getWordAtPosition(position);
		if (!word) {
			return;
		}

		const range = new Range(position.lineNumber, position.column, position.lineNumber, word.endColumn);
		return editor.getContribution<IDebugEditorContribution>(EDITOR_CONTRIBUTION_ID).showHover(range, true);
	}
}

class StepIntoTargetsAction extends EditorAction {

	public static readonly ID = 'editor.debug.action.stepIntoTargets';
	public static readonly LABEL = nls.localize({ key: 'stepIntoTargets', comment: ['Step Into Targets lets the user step into an exact function he or she is interested in.'] }, "Step Into Targets...");

	constructor() {
		super({
			id: StepIntoTargetsAction.ID,
			label: StepIntoTargetsAction.LABEL,
			alias: 'Debug: Step Into Targets...',
			precondition: ContextKeyExpr.and(CONTEXT_STEP_INTO_TARGETS_SUPPORTED, CONTEXT_IN_DEBUG_MODE, CONTEXT_DEBUG_STATE.isEqualTo('stopped'), EditorContextKeys.editorTextFocus),
			contextMenuOpts: {
				group: 'debug',
				order: 1.5
			}
		});
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const debugService = accessor.get(IDebugService);
		const contextMenuService = accessor.get(IContextMenuService);
		const uriIdentityService = accessor.get(IUriIdentityService);
		const session = debugService.getViewModel().focusedSession;
		const frame = debugService.getViewModel().focusedStackFrame;

		if (session && frame && editor.hasModel() && uriIdentityService.extUri.isEqual(editor.getModel().uri, frame.source.uri)) {
			const targets = await session.stepInTargets(frame.frameId);
			if (!targets) {
				return;
			}

			editor.revealLineInCenterIfOutsideViewport(frame.range.startLineNumber);
			const cursorCoords = editor.getScrolledVisiblePosition({ lineNumber: frame.range.startLineNumber, column: frame.range.startColumn });
			const editorCoords = getDomNodePagePosition(editor.getDomNode());
			const x = editorCoords.left + cursorCoords.left;
			const y = editorCoords.top + cursorCoords.top + cursorCoords.height;

			contextMenuService.showContextMenu({
				getAnchor: () => ({ x, y }),
				getActions: () => {
					return targets.map(t => new Action(`stepIntoTarget:${t.id}`, t.label, undefined, true, () => session.stepIn(frame.thread.threadId, t.id)));
				}
			});
		}
	}
}

class GoToBreakpointAction extends EditorAction {
	constructor(private isNext: boolean, opts: IActionOptions) {
		super(opts);
	}

	async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<any> {
		const debugService = accessor.get(IDebugService);
		const editorService = accessor.get(IEditorService);
		const uriIdentityService = accessor.get(IUriIdentityService);

		if (editor.hasModel()) {
			const currentUri = editor.getModel().uri;
			const currentLine = editor.getPosition().lineNumber;
			//Breakpoints returned from `getBreakpoints` are already sorted.
			const allEnabledBreakpoints = debugService.getModel().getBreakpoints({ enabledOnly: true });

			//Try to find breakpoint in current file
			let moveBreakpoint =
				this.isNext
					? allEnabledBreakpoints.filter(bp => uriIdentityService.extUri.isEqual(bp.uri, currentUri) && bp.lineNumber > currentLine).shift()
					: allEnabledBreakpoints.filter(bp => uriIdentityService.extUri.isEqual(bp.uri, currentUri) && bp.lineNumber < currentLine).pop();

			//Try to find breakpoints in following files
			if (!moveBreakpoint) {
				moveBreakpoint =
					this.isNext
						? allEnabledBreakpoints.filter(bp => bp.uri.toString() > currentUri.toString()).shift()
						: allEnabledBreakpoints.filter(bp => bp.uri.toString() < currentUri.toString()).pop();
			}

			//Move to first or last possible breakpoint
			if (!moveBreakpoint && allEnabledBreakpoints.length) {
				moveBreakpoint = this.isNext ? allEnabledBreakpoints[0] : allEnabledBreakpoints[allEnabledBreakpoints.length - 1];
			}

			if (moveBreakpoint) {
				return openBreakpointSource(moveBreakpoint, false, true, false, debugService, editorService);
			}
		}
	}
}

class GoToNextBreakpointAction extends GoToBreakpointAction {
	constructor() {
		super(true, {
			id: 'editor.debug.action.goToNextBreakpoint',
			label: nls.localize('goToNextBreakpoint', "Debug: Go To Next Breakpoint"),
			alias: 'Debug: Go To Next Breakpoint',
			precondition: CONTEXT_DEBUGGERS_AVAILABLE
		});
	}
}

class GoToPreviousBreakpointAction extends GoToBreakpointAction {
	constructor() {
		super(false, {
			id: 'editor.debug.action.goToPreviousBreakpoint',
			label: nls.localize('goToPreviousBreakpoint', "Debug: Go To Previous Breakpoint"),
			alias: 'Debug: Go To Previous Breakpoint',
			precondition: CONTEXT_DEBUGGERS_AVAILABLE
		});
	}
}

class CloseExceptionWidgetAction extends EditorAction {

	constructor() {
		super({
			id: 'editor.debug.action.closeExceptionWidget',
			label: nls.localize('closeExceptionWidget', "Close Exception Widget"),
			alias: 'Close Exception Widget',
			precondition: CONTEXT_EXCEPTION_WIDGET_VISIBLE,
			kbOpts: {
				primary: KeyCode.Escape,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	async run(_accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const contribution = editor.getContribution<IDebugEditorContribution>(EDITOR_CONTRIBUTION_ID);
		contribution.closeExceptionWidget();
	}
}

export function registerEditorActions(): void {
	registerEditorAction(ToggleBreakpointAction);
	registerEditorAction(ConditionalBreakpointAction);
	registerEditorAction(LogPointAction);
	registerEditorAction(RunToCursorAction);
	registerEditorAction(StepIntoTargetsAction);
	registerEditorAction(SelectionToReplAction);
	registerEditorAction(SelectionToWatchExpressionsAction);
	registerEditorAction(ShowDebugHoverAction);
	registerEditorAction(GoToNextBreakpointAction);
	registerEditorAction(GoToPreviousBreakpointAction);
	registerEditorAction(CloseExceptionWidgetAction);
}
