/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from 'vs/base/common/strings';
import { ICodeEditor, IActiveCodeEditor } from 'vs/editor/browser/editorBrowser';
import { Position } from 'vs/editor/common/core/position';
import { Range, IRange } from 'vs/editor/common/core/range';
import { CancellationTokenSource, CancellationToken } from 'vs/base/common/cancellation';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ITextModel } from 'vs/editor/common/model';
import { EditorKeybindingCancellationTokenSource } from 'vs/editor/browser/core/keybindingCancellation';

export const enum CodeEditorStateFlag {
	Value = 1,
	Selection = 2,
	Position = 4,
	Scroll = 8
}

export class EditorState {

	private readonly flags: number;

	private readonly position: Position | null;
	private readonly selection: Range | null;
	private readonly modelVersionId: string | null;
	private readonly scrollLeft: number;
	private readonly scrollTop: number;

	constructor(editor: ICodeEditor, flags: number) {
		this.flags = flags;

		if ((this.flags & CodeEditorStateFlag.Value) !== 0) {
			const model = editor.getModel();
			this.modelVersionId = model ? strings.format('{0}#{1}', model.uri.toString(), model.getVersionId()) : null;
		} else {
			this.modelVersionId = null;
		}
		if ((this.flags & CodeEditorStateFlag.Position) !== 0) {
			this.position = editor.getPosition();
		} else {
			this.position = null;
		}
		if ((this.flags & CodeEditorStateFlag.Selection) !== 0) {
			this.selection = editor.getSelection();
		} else {
			this.selection = null;
		}
		if ((this.flags & CodeEditorStateFlag.Scroll) !== 0) {
			this.scrollLeft = editor.getScrollLeft();
			this.scrollTop = editor.getScrollTop();
		} else {
			this.scrollLeft = -1;
			this.scrollTop = -1;
		}
	}

	private _equals(other: any): boolean {

		if (!(other instanceof EditorState)) {
			return false;
		}
		const state = <EditorState>other;

		if (this.modelVersionId !== state.modelVersionId) {
			return false;
		}
		if (this.scrollLeft !== state.scrollLeft || this.scrollTop !== state.scrollTop) {
			return false;
		}
		if (!this.position && state.position || this.position && !state.position || this.position && state.position && !this.position.equals(state.position)) {
			return false;
		}
		if (!this.selection && state.selection || this.selection && !state.selection || this.selection && state.selection && !this.selection.equalsRange(state.selection)) {
			return false;
		}
		return true;
	}

	public validate(editor: ICodeEditor): boolean {
		return this._equals(new EditorState(editor, this.flags));
	}
}

/**
 * A cancellation token source that cancels when the editor changes as expressed
 * by the provided flags
 * @param range If provided, changes in position and selection within this range will not trigger cancellation
 */
export class EditorStateCancellationTokenSource extends EditorKeybindingCancellationTokenSource implements IDisposable {

	private readonly _listener = new DisposableStore();

	constructor(editor: IActiveCodeEditor, flags: CodeEditorStateFlag, range?: IRange, parent?: CancellationToken) {
		super(editor, parent);

		if (flags & CodeEditorStateFlag.Position) {
			this._listener.add(editor.onDidChangeCursorPosition(e => {
				if (!range || !Range.containsPosition(range, e.position)) {
					this.cancel();
				}
			}));
		}
		if (flags & CodeEditorStateFlag.Selection) {
			this._listener.add(editor.onDidChangeCursorSelection(e => {
				if (!range || !Range.containsRange(range, e.selection)) {
					this.cancel();
				}
			}));
		}
		if (flags & CodeEditorStateFlag.Scroll) {
			this._listener.add(editor.onDidScrollChange(_ => this.cancel()));
		}
		if (flags & CodeEditorStateFlag.Value) {
			this._listener.add(editor.onDidChangeModel(_ => this.cancel()));
			this._listener.add(editor.onDidChangeModelContent(_ => this.cancel()));
		}
	}

	override dispose() {
		this._listener.dispose();
		super.dispose();
	}
}

/**
 * A cancellation token source that cancels when the provided model changes
 */
export class TextModelCancellationTokenSource extends CancellationTokenSource implements IDisposable {

	private _listener: IDisposable;

	constructor(model: ITextModel, parent?: CancellationToken) {
		super(parent);
		this._listener = model.onDidChangeContent(() => this.cancel());
	}

	override dispose() {
		this._listener.dispose();
		super.dispose();
	}
}

export class StableEditorScrollState {

	public static capture(editor: ICodeEditor): StableEditorScrollState {
		let visiblePosition: Position | null = null;
		let visiblePositionScrollDelta = 0;
		if (editor.getScrollTop() !== 0) {
			const visibleRanges = editor.getVisibleRanges();
			if (visibleRanges.length > 0) {
				visiblePosition = visibleRanges[0].getStartPosition();
				const visiblePositionScrollTop = editor.getTopForPosition(visiblePosition.lineNumber, visiblePosition.column);
				visiblePositionScrollDelta = editor.getScrollTop() - visiblePositionScrollTop;
			}
		}
		return new StableEditorScrollState(visiblePosition, visiblePositionScrollDelta, editor.getPosition());
	}

	constructor(
		private readonly _visiblePosition: Position | null,
		private readonly _visiblePositionScrollDelta: number,
		private readonly _cursorPosition: Position | null
	) {
	}

	public restore(editor: ICodeEditor): void {
		if (this._visiblePosition) {
			const visiblePositionScrollTop = editor.getTopForPosition(this._visiblePosition.lineNumber, this._visiblePosition.column);
			editor.setScrollTop(visiblePositionScrollTop + this._visiblePositionScrollDelta);
		}
	}

	public restoreRelativeVerticalPositionOfCursor(editor: ICodeEditor): void {
		const currentCursorPosition = editor.getPosition();

		if (!this._cursorPosition || !currentCursorPosition) {
			return;
		}

		const offset = editor.getTopForLineNumber(currentCursorPosition.lineNumber) - editor.getTopForLineNumber(this._cursorPosition.lineNumber);
		editor.setScrollTop(editor.getScrollTop() + offset);
	}
}
