/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./indentGuides';
import { DynamicViewOverlay } from 'vs/editor/browser/view/dynamicViewOverlay';
import { Position } from 'vs/editor/common/core/position';
import { editorActiveIndentGuides, editorIndentGuides } from 'vs/editor/common/view/editorColorRegistry';
import { RenderingContext } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';


export class IndentGuidesOverlay extends DynamicViewOverlay {

	private readonly _context: ViewContext;
	private _primaryLineNumber: number;
	private _lineHeight: number;
	private _spaceWidth: number;
	private _renderResult: string[] | null;
	private _enabled: boolean;
	private _activeIndentEnabled: boolean;
	private _maxIndentLeft: number;

	constructor(context: ViewContext) {
		super();
		this._context = context;
		this._primaryLineNumber = 0;

		const options = this._context.configuration.options;
		const wrappingInfo = options.get(EditorOption.wrappingInfo);
		const fontInfo = options.get(EditorOption.fontInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._spaceWidth = fontInfo.spaceWidth;
		this._enabled = options.get(EditorOption.renderIndentGuides);
		this._activeIndentEnabled = options.get(EditorOption.highlightActiveIndentGuide);
		this._maxIndentLeft = wrappingInfo.wrappingColumn === -1 ? -1 : (wrappingInfo.wrappingColumn * fontInfo.typicalHalfwidthCharacterWidth);

		this._renderResult = null;

		this._context.addEventHandler(this);
	}

	public override dispose(): void {
		this._context.removeEventHandler(this);
		this._renderResult = null;
		super.dispose();
	}

	// --- begin event handlers

	public override onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		const options = this._context.configuration.options;
		const wrappingInfo = options.get(EditorOption.wrappingInfo);
		const fontInfo = options.get(EditorOption.fontInfo);

		this._lineHeight = options.get(EditorOption.lineHeight);
		this._spaceWidth = fontInfo.spaceWidth;
		this._enabled = options.get(EditorOption.renderIndentGuides);
		this._activeIndentEnabled = options.get(EditorOption.highlightActiveIndentGuide);
		this._maxIndentLeft = wrappingInfo.wrappingColumn === -1 ? -1 : (wrappingInfo.wrappingColumn * fontInfo.typicalHalfwidthCharacterWidth);
		return true;
	}
	public override onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): boolean {
		const selection = e.selections[0];
		const newPrimaryLineNumber = selection.isEmpty() ? selection.positionLineNumber : 0;

		if (this._primaryLineNumber !== newPrimaryLineNumber) {
			this._primaryLineNumber = newPrimaryLineNumber;
			return true;
		}

		return false;
	}
	public override onDecorationsChanged(e: viewEvents.ViewDecorationsChangedEvent): boolean {
		// true for inline decorations
		return true;
	}
	public override onFlushed(e: viewEvents.ViewFlushedEvent): boolean {
		return true;
	}
	public override onLinesChanged(e: viewEvents.ViewLinesChangedEvent): boolean {
		return true;
	}
	public override onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		return true;
	}
	public override onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		return true;
	}
	public override onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		return e.scrollTopChanged;// || e.scrollWidthChanged;
	}
	public override onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		return true;
	}
	public override onLanguageConfigurationChanged(e: viewEvents.ViewLanguageConfigurationEvent): boolean {
		return true;
	}

	// --- end event handlers

	public prepareRender(ctx: RenderingContext): void {
		if (!this._enabled) {
			this._renderResult = null;
			return;
		}

		const visibleStartLineNumber = ctx.visibleRange.startLineNumber;
		const visibleEndLineNumber = ctx.visibleRange.endLineNumber;
		const { indentSize } = this._context.model.getTextModelOptions();
		const indentWidth = indentSize * this._spaceWidth;
		const scrollWidth = ctx.scrollWidth;
		const lineHeight = this._lineHeight;

		const indents = this._context.model.getLinesIndentGuides(visibleStartLineNumber, visibleEndLineNumber);

		let activeIndentStartLineNumber = 0;
		let activeIndentEndLineNumber = 0;
		let activeIndentLevel = 0;
		if (this._activeIndentEnabled && this._primaryLineNumber) {
			const activeIndentInfo = this._context.model.getActiveIndentGuide(this._primaryLineNumber, visibleStartLineNumber, visibleEndLineNumber);
			activeIndentStartLineNumber = activeIndentInfo.startLineNumber;
			activeIndentEndLineNumber = activeIndentInfo.endLineNumber;
			activeIndentLevel = activeIndentInfo.indent;
		}

		const output: string[] = [];
		for (let lineNumber = visibleStartLineNumber; lineNumber <= visibleEndLineNumber; lineNumber++) {
			const containsActiveIndentGuide = (activeIndentStartLineNumber <= lineNumber && lineNumber <= activeIndentEndLineNumber);
			const lineIndex = lineNumber - visibleStartLineNumber;
			const indent = indents[lineIndex];

			let result = '';
			if (indent >= 1) {
				const leftMostVisiblePosition = ctx.visibleRangeForPosition(new Position(lineNumber, 1));
				let left = leftMostVisiblePosition ? leftMostVisiblePosition.left : 0;
				for (let i = 1; i <= indent; i++) {
					const className = (containsActiveIndentGuide && i === activeIndentLevel ? 'cigra' : 'cigr');
					result += `<div class="${className}" style="left:${left}px;height:${lineHeight}px;width:${indentWidth}px"></div>`;
					left += indentWidth;
					if (left > scrollWidth || (this._maxIndentLeft > 0 && left > this._maxIndentLeft)) {
						break;
					}
				}
			}

			output[lineIndex] = result;
		}
		this._renderResult = output;
	}

	public render(startLineNumber: number, lineNumber: number): string {
		if (!this._renderResult) {
			return '';
		}
		const lineIndex = lineNumber - startLineNumber;
		if (lineIndex < 0 || lineIndex >= this._renderResult.length) {
			return '';
		}
		return this._renderResult[lineIndex];
	}
}

registerThemingParticipant((theme, collector) => {
	const editorIndentGuidesColor = theme.getColor(editorIndentGuides);
	if (editorIndentGuidesColor) {
		collector.addRule(`.monaco-editor .lines-content .cigr { box-shadow: 1px 0 0 0 ${editorIndentGuidesColor} inset; }`);
	}
	const editorActiveIndentGuidesColor = theme.getColor(editorActiveIndentGuides) || editorIndentGuidesColor;
	if (editorActiveIndentGuidesColor) {
		collector.addRule(`.monaco-editor .lines-content .cigra { box-shadow: 1px 0 0 0 ${editorActiveIndentGuidesColor} inset; }`);
	}
});
