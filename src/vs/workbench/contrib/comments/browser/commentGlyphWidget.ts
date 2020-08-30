/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Color, RGBA } from 'vs/base/common/color';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { IModelDecorationOptions, OverviewRulerLane } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { themeColorFromId } from 'vs/platform/theme/common/themeService';

const overviewRulerDefault = new Color(new RGBA(197, 197, 197, 1));

export const overviewRulerCommentingRangeForeground = registerColor('editorGutter.commentRangeForeground', { dark: overviewRulerDefault, light: overviewRulerDefault, hc: overviewRulerDefault }, nls.localize('editorGutterCommentRangeForeground', 'Editor gutter decoration color for commenting ranges.'));

export class CommentGlyphWidget {
	private _lineNumber!: number;
	private _editor: ICodeEditor;
	private commentsDecorations: string[] = [];
	private _commentsOptions: ModelDecorationOptions;

	constructor(editor: ICodeEditor, lineNumber: number) {
		this._commentsOptions = this.createDecorationOptions();
		this._editor = editor;
		this.setLineNumber(lineNumber);
	}

	private createDecorationOptions(): ModelDecorationOptions {
		const decorationOptions: IModelDecorationOptions = {
			isWholeLine: true,
			overviewRuler: {
				color: themeColorFromId(overviewRulerCommentingRangeForeground),
				position: OverviewRulerLane.Center
			},
			linesDecorationsClassName: `comment-range-glyph comment-thread`
		};

		return ModelDecorationOptions.createDynamic(decorationOptions);
	}

	setLineNumber(lineNumber: number): void {
		this._lineNumber = lineNumber;
		let commentsDecorations = [{
			range: {
				startLineNumber: lineNumber, startColumn: 1,
				endLineNumber: lineNumber, endColumn: 1
			},
			options: this._commentsOptions
		}];

		this.commentsDecorations = this._editor.deltaDecorations(this.commentsDecorations, commentsDecorations);
	}

	getPosition(): IContentWidgetPosition {
		const range = this._editor.hasModel() && this.commentsDecorations && this.commentsDecorations.length
			? this._editor.getModel().getDecorationRange(this.commentsDecorations[0])
			: null;

		return {
			position: {
				lineNumber: range ? range.startLineNumber : this._lineNumber,
				column: 1
			},
			preference: [ContentWidgetPositionPreference.EXACT]
		};
	}

	dispose() {
		if (this.commentsDecorations) {
			this._editor.deltaDecorations(this.commentsDecorations, []);
		}
	}
}
