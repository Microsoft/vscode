/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { Action } from 'vs/base/common/actions';
import { Disposable } from 'vs/base/common/lifecycle';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { Range } from 'vs/editor/common/core/range';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { Codicon } from 'vs/base/common/codicons';
import { ITextModel } from 'vs/editor/common/model';

export interface IDiffLinesChange {
	readonly originalStartLineNumber: number;
	readonly originalEndLineNumber: number;
	readonly modifiedStartLineNumber: number;
	readonly modifiedEndLineNumber: number;
	readonly originalModel: ITextModel;
	viewLineCounts: number[] | null;
}

export class InlineDiffMargin extends Disposable {
	private readonly _diffActions: HTMLElement;

	private _visibility: boolean = false;

	get visibility(): boolean {
		return this._visibility;
	}

	set visibility(_visibility: boolean) {
		if (this._visibility !== _visibility) {
			this._visibility = _visibility;

			if (_visibility) {
				this._diffActions.style.visibility = 'visible';
			} else {
				this._diffActions.style.visibility = 'hidden';
			}
		}
	}

	constructor(
		private readonly _viewZoneId: string,
		private readonly _marginDomNode: HTMLElement,
		public readonly editor: CodeEditorWidget,
		public readonly diff: IDiffLinesChange,
		private readonly _contextMenuService: IContextMenuService,
		private readonly _clipboardService: IClipboardService
	) {
		super();

		// make sure the diff margin shows above overlay.
		this._marginDomNode.style.zIndex = '10';

		this._diffActions = document.createElement('div');
		this._diffActions.className = Codicon.lightBulb.classNames + ' lightbulb-glyph';
		this._diffActions.style.position = 'absolute';
		const lineHeight = editor.getOption(EditorOption.lineHeight);
		const lineFeed = editor.getModel()!.getEOL();
		this._diffActions.style.right = '0px';
		this._diffActions.style.visibility = 'hidden';
		this._diffActions.style.height = `${lineHeight}px`;
		this._diffActions.style.lineHeight = `${lineHeight}px`;
		this._marginDomNode.appendChild(this._diffActions);

		const actions: Action[] = [];

		// default action
		actions.push(new Action(
			'diff.clipboard.copyDeletedContent',
			diff.originalEndLineNumber > diff.modifiedStartLineNumber
				? nls.localize('diff.clipboard.copyDeletedLinesContent.label', "Copy deleted lines")
				: nls.localize('diff.clipboard.copyDeletedLinesContent.single.label', "Copy deleted line"),
			undefined,
			true,
			async () => {
				const range = new Range(diff.originalStartLineNumber, 1, diff.originalEndLineNumber + 1, 1);
				const deletedText = diff.originalModel.getValueInRange(range);
				await this._clipboardService.writeText(deletedText);
			}
		));

		let currentLineNumberOffset = 0;
		let copyLineAction: Action | undefined = undefined;
		if (diff.originalEndLineNumber > diff.modifiedStartLineNumber) {
			copyLineAction = new Action(
				'diff.clipboard.copyDeletedLineContent',
				nls.localize('diff.clipboard.copyDeletedLineContent.label', "Copy deleted line ({0})", diff.originalStartLineNumber),
				undefined,
				true,
				async () => {
					const lineContent = diff.originalModel.getLineContent(diff.originalStartLineNumber + currentLineNumberOffset);
					await this._clipboardService.writeText(lineContent);
				}
			);

			actions.push(copyLineAction);
		}

		const readOnly = editor.getOption(EditorOption.readOnly);
		if (!readOnly) {
			actions.push(new Action('diff.inline.revertChange', nls.localize('diff.inline.revertChange.label', "Revert this change"), undefined, true, async () => {
				const range = new Range(diff.originalStartLineNumber, 1, diff.originalEndLineNumber, diff.originalModel.getLineMaxColumn(diff.originalEndLineNumber));
				const deletedText = diff.originalModel.getValueInRange(range);
				if (diff.modifiedEndLineNumber === 0) {
					// deletion only
					const column = editor.getModel()!.getLineMaxColumn(diff.modifiedStartLineNumber);
					editor.executeEdits('diffEditor', [
						{
							range: new Range(diff.modifiedStartLineNumber, column, diff.modifiedStartLineNumber, column),
							text: lineFeed + deletedText
						}
					]);
				} else {
					const column = editor.getModel()!.getLineMaxColumn(diff.modifiedEndLineNumber);
					editor.executeEdits('diffEditor', [
						{
							range: new Range(diff.modifiedStartLineNumber, 1, diff.modifiedEndLineNumber, column),
							text: deletedText
						}
					]);
				}

			}));
		}

		const showContextMenu = (x: number, y: number) => {
			this._contextMenuService.showContextMenu({
				getAnchor: () => {
					return {
						x,
						y
					};
				},
				getActions: () => {
					if (copyLineAction) {
						copyLineAction.label = nls.localize('diff.clipboard.copyDeletedLineContent.label', "Copy deleted line ({0})", diff.originalStartLineNumber + currentLineNumberOffset);
					}
					return actions;
				},
				autoSelectFirstItem: true
			});
		};

		this._register(dom.addStandardDisposableListener(this._diffActions, 'mousedown', e => {
			const { top, height } = dom.getDomNodePagePosition(this._diffActions);
			let pad = Math.floor(lineHeight / 3);
			e.preventDefault();

			showContextMenu(e.posx, top + height + pad);

		}));

		this._register(editor.onMouseMove((e: IEditorMouseEvent) => {
			if (e.target.type === MouseTargetType.CONTENT_VIEW_ZONE || e.target.type === MouseTargetType.GUTTER_VIEW_ZONE) {
				const viewZoneId = e.target.detail.viewZoneId;

				if (viewZoneId === this._viewZoneId) {
					this.visibility = true;
					currentLineNumberOffset = this._updateLightBulbPosition(this._marginDomNode, e.event.browserEvent.y, lineHeight);
				} else {
					this.visibility = false;
				}
			} else {
				this.visibility = false;
			}
		}));

		this._register(editor.onMouseDown((e: IEditorMouseEvent) => {
			if (!e.event.rightButton) {
				return;
			}

			if (e.target.type === MouseTargetType.CONTENT_VIEW_ZONE || e.target.type === MouseTargetType.GUTTER_VIEW_ZONE) {
				const viewZoneId = e.target.detail.viewZoneId;

				if (viewZoneId === this._viewZoneId) {
					e.event.preventDefault();
					currentLineNumberOffset = this._updateLightBulbPosition(this._marginDomNode, e.event.browserEvent.y, lineHeight);
					showContextMenu(e.event.posx, e.event.posy + lineHeight);
				}
			}
		}));
	}

	private _updateLightBulbPosition(marginDomNode: HTMLElement, y: number, lineHeight: number): number {
		const { top } = dom.getDomNodePagePosition(marginDomNode);
		const offset = y - top;
		const lineNumberOffset = Math.floor(offset / lineHeight);
		const newTop = lineNumberOffset * lineHeight;
		this._diffActions.style.top = `${newTop}px`;
		if (this.diff.viewLineCounts) {
			let acc = 0;
			for (let i = 0; i < this.diff.viewLineCounts.length; i++) {
				acc += this.diff.viewLineCounts[i];
				if (lineNumberOffset < acc) {
					return i;
				}
			}
		}
		return lineNumberOffset;
	}
}
