/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Constants } from 'vs/base/common/uint';
import { Range } from 'vs/editor/common/core/range';
import { TrackedRangeStickiness, IModelDeltaDecoration, IModelDecorationOptions, OverviewRulerLane } from 'vs/editor/common/model';
import { IDebugService, IStackFrame } from 'vs/workbench/contrib/debug/common/debug';
import { registerThemingParticipant, themeColorFromId, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { localize } from 'vs/nls';
import { Event } from 'vs/base/common/event';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { distinct } from 'vs/base/common/arrays';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { debugStackframe, debugStackframeFocused } from 'vs/workbench/contrib/debug/browser/debugIcons';

const topStackFrameColor = registerColor('editor.stackFrameHighlightBackground', { dark: '#ffff0033', light: '#ffff6673', hc: '#ffff0033' }, localize('topStackFrameLineHighlight', 'Background color for the highlight of line at the top stack frame position.'));
const focusedStackFrameColor = registerColor('editor.focusedStackFrameHighlightBackground', { dark: '#7abd7a4d', light: '#cee7ce73', hc: '#7abd7a4d' }, localize('focusedStackFrameLineHighlight', 'Background color for the highlight of line at focused stack frame position.'));
const stickiness = TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges;

// we need a separate decoration for glyph margin, since we do not want it on each line of a multi line statement.
const TOP_STACK_FRAME_MARGIN: IModelDecorationOptions = {
	glyphMarginClassName: ThemeIcon.asClassName(debugStackframe),
	stickiness,
	overviewRuler: {
		position: OverviewRulerLane.Full,
		color: themeColorFromId(topStackFrameColor)
	}
};
const FOCUSED_STACK_FRAME_MARGIN: IModelDecorationOptions = {
	glyphMarginClassName: ThemeIcon.asClassName(debugStackframeFocused),
	stickiness,
	overviewRuler: {
		position: OverviewRulerLane.Full,
		color: themeColorFromId(focusedStackFrameColor)
	}
};
const TOP_STACK_FRAME_DECORATION: IModelDecorationOptions = {
	isWholeLine: true,
	className: 'debug-top-stack-frame-line',
	stickiness
};
const TOP_STACK_FRAME_INLINE_DECORATION: IModelDecorationOptions = {
	beforeContentClassName: 'debug-top-stack-frame-column'
};
const FOCUSED_STACK_FRAME_DECORATION: IModelDecorationOptions = {
	isWholeLine: true,
	className: 'debug-focused-stack-frame-line',
	stickiness
};

export function createDecorationsForStackFrame(stackFrame: IStackFrame, isFocusedSession: boolean): IModelDeltaDecoration[] {
	// only show decorations for the currently focused thread.
	const result: IModelDeltaDecoration[] = [];
	const columnUntilEOLRange = new Range(stackFrame.range.startLineNumber, stackFrame.range.startColumn, stackFrame.range.startLineNumber, Constants.MAX_SAFE_SMALL_INTEGER);
	const range = new Range(stackFrame.range.startLineNumber, stackFrame.range.startColumn, stackFrame.range.startLineNumber, stackFrame.range.startColumn + 1);

	// compute how to decorate the editor. Different decorations are used if this is a top stack frame, focused stack frame,
	// an exception or a stack frame that did not change the line number (we only decorate the columns, not the whole line).
	const topStackFrame = stackFrame.thread.getTopStackFrame();
	if (stackFrame.getId() === topStackFrame?.getId()) {
		if (isFocusedSession) {
			result.push({
				options: TOP_STACK_FRAME_MARGIN,
				range
			});
		}

		result.push({
			options: TOP_STACK_FRAME_DECORATION,
			range: columnUntilEOLRange
		});

		if (stackFrame.range.startColumn > 1) {
			result.push({
				options: TOP_STACK_FRAME_INLINE_DECORATION,
				range: columnUntilEOLRange
			});
		}
	} else {
		if (isFocusedSession) {
			result.push({
				options: FOCUSED_STACK_FRAME_MARGIN,
				range
			});
		}

		result.push({
			options: FOCUSED_STACK_FRAME_DECORATION,
			range: columnUntilEOLRange
		});
	}

	return result;
}

export class CallStackEditorContribution implements IEditorContribution {
	private toDispose: IDisposable[] = [];
	private decorationIds: string[] = [];

	constructor(
		private readonly editor: ICodeEditor,
		@IDebugService private readonly debugService: IDebugService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		const setDecorations = () => this.decorationIds = this.editor.deltaDecorations(this.decorationIds, this.createCallStackDecorations());
		this.toDispose.push(Event.any(this.debugService.getViewModel().onDidFocusStackFrame, this.debugService.getModel().onDidChangeCallStack)(() => {
			setDecorations();
		}));
		this.toDispose.push(this.editor.onDidChangeModel(e => {
			if (e.newModelUrl) {
				setDecorations();
			}
		}));
	}

	private createCallStackDecorations(): IModelDeltaDecoration[] {
		const focusedStackFrame = this.debugService.getViewModel().focusedStackFrame;
		const decorations: IModelDeltaDecoration[] = [];
		this.debugService.getModel().getSessions().forEach(s => {
			const isSessionFocused = s === focusedStackFrame?.thread.session;
			s.getAllThreads().forEach(t => {
				if (t.stopped) {
					const callStack = t.getCallStack();
					const stackFrames: IStackFrame[] = [];
					if (callStack.length > 0) {
						// Always decorate top stack frame, and decorate focused stack frame if it is not the top stack frame
						if (focusedStackFrame && !focusedStackFrame.equals(callStack[0])) {
							stackFrames.push(focusedStackFrame);
						}
						stackFrames.push(callStack[0]);
					}

					stackFrames.forEach(candidateStackFrame => {
						if (candidateStackFrame && this.uriIdentityService.extUri.isEqual(candidateStackFrame.source.uri, this.editor.getModel()?.uri)) {
							decorations.push(...createDecorationsForStackFrame(candidateStackFrame, isSessionFocused));
						}
					});
				}
			});
		});

		// Deduplicate same decorations so colors do not stack #109045
		return distinct(decorations, d => `${d.options.className} ${d.options.glyphMarginClassName} ${d.range.startLineNumber} ${d.range.startColumn}`);
	}

	dispose(): void {
		this.editor.deltaDecorations(this.decorationIds, []);
		this.toDispose = dispose(this.toDispose);
	}
}

registerThemingParticipant((theme, collector) => {
	const topStackFrame = theme.getColor(topStackFrameColor);
	if (topStackFrame) {
		collector.addRule(`.monaco-editor .view-overlays .debug-top-stack-frame-line { background: ${topStackFrame}; }`);
	}

	const focusedStackFrame = theme.getColor(focusedStackFrameColor);
	if (focusedStackFrame) {
		collector.addRule(`.monaco-editor .view-overlays .debug-focused-stack-frame-line { background: ${focusedStackFrame}; }`);
	}
});
