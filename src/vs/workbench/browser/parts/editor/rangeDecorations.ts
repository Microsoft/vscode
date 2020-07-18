/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { Emitter } from 'vs/base/common/event';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IRange } from 'vs/editor/common/core/range';
import { CursorChangeReason, ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { ICodeEditor, isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { TrackedRangeStickiness, IModelDecorationsChangeAccessor } from 'vs/editor/common/model';

export interface IRangeHighlightDecoration {
	resource: URI;
	range: IRange;
	isWholeLine?: boolean;
}

export class RangeHighlightDecorations extends Disposable {

	private rangeHighlightDecorationId: string | null = null;
	private editor: ICodeEditor | null = null;
	private readonly editorDisposables = this._register(new DisposableStore());

	private readonly _onHighlightRemoved: Emitter<void> = this._register(new Emitter<void>());
	readonly onHighlightRemoved = this._onHighlightRemoved.event;

	constructor(
		@IEditorService private readonly editorService: IEditorService
	) {
		super();
	}

	removeHighlightRange() {
		if (this.editor && this.editor.getModel() && this.rangeHighlightDecorationId) {
			this.editor.deltaDecorations([this.rangeHighlightDecorationId], []);
			this._onHighlightRemoved.fire();
		}

		this.rangeHighlightDecorationId = null;
	}

	highlightRange(range: IRangeHighlightDecoration, editor?: any) {
		editor = editor ? editor : this.getEditor(range);
		if (isCodeEditor(editor)) {
			this.doHighlightRange(editor, range);
		}
	}

	private doHighlightRange(editor: ICodeEditor, selectionRange: IRangeHighlightDecoration) {
		this.removeHighlightRange();

		editor.changeDecorations((changeAccessor: IModelDecorationsChangeAccessor) => {
			this.rangeHighlightDecorationId = changeAccessor.addDecoration(selectionRange.range, this.createRangeHighlightDecoration(selectionRange.isWholeLine));
		});

		this.setEditor(editor);
	}

	private getEditor(resourceRange: IRangeHighlightDecoration): ICodeEditor | undefined {
		const activeEditor = this.editorService.activeEditor;
		const resource = activeEditor && activeEditor.resource;
		if (resource) {
			if (resource.toString() === resourceRange.resource.toString()) {
				return this.editorService.activeTextEditorControl as ICodeEditor;
			}
		}

		return undefined;
	}

	private setEditor(editor: ICodeEditor) {
		if (this.editor !== editor) {
			this.editorDisposables.clear();
			this.editor = editor;
			this.editorDisposables.add(this.editor.onDidChangeCursorPosition((e: ICursorPositionChangedEvent) => {
				if (
					e.reason === CursorChangeReason.NotSet
					|| e.reason === CursorChangeReason.Explicit
					|| e.reason === CursorChangeReason.Undo
					|| e.reason === CursorChangeReason.Redo
				) {
					this.removeHighlightRange();
				}
			}));
			this.editorDisposables.add(this.editor.onDidChangeModel(() => { this.removeHighlightRange(); }));
			this.editorDisposables.add(this.editor.onDidDispose(() => {
				this.removeHighlightRange();
				this.editor = null;
			}));
		}
	}

	private static readonly _WHOLE_LINE_RANGE_HIGHLIGHT = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'rangeHighlight',
		isWholeLine: true
	});

	private static readonly _RANGE_HIGHLIGHT = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'rangeHighlight'
	});

	private createRangeHighlightDecoration(isWholeLine: boolean = true): ModelDecorationOptions {
		return (isWholeLine ? RangeHighlightDecorations._WHOLE_LINE_RANGE_HIGHLIGHT : RangeHighlightDecorations._RANGE_HIGHLIGHT);
	}

	dispose() {
		super.dispose();

		if (this.editor && this.editor.getModel()) {
			this.removeHighlightRange();
			this.editor = null;
		}
	}
}
