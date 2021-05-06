/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'vs/base/browser/dom';
import { IMarkdownString, isEmptyMarkdownString } from 'vs/base/common/htmlContent';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { HoverOperation, HoverStartMode, IHoverComputer } from 'vs/editor/contrib/hover/hoverOperation';
import { GlyphHoverWidget } from 'vs/editor/contrib/hover/hoverWidgets';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IOpenerService, NullOpenerService } from 'vs/platform/opener/common/opener';
import { asArray } from 'vs/base/common/arrays';

export interface IHoverMessage {
	value: IMarkdownString;
}

class MarginComputer implements IHoverComputer<IHoverMessage[]> {

	private readonly _editor: ICodeEditor;
	private _lineNumber: number;
	private _result: IHoverMessage[];

	constructor(editor: ICodeEditor) {
		this._editor = editor;
		this._lineNumber = -1;
		this._result = [];
	}

	public setLineNumber(lineNumber: number): void {
		this._lineNumber = lineNumber;
		this._result = [];
	}

	public clearResult(): void {
		this._result = [];
	}

	public computeSync(): IHoverMessage[] {

		const toHoverMessage = (contents: IMarkdownString): IHoverMessage => {
			return {
				value: contents
			};
		};

		const lineDecorations = this._editor.getLineDecorations(this._lineNumber);

		const result: IHoverMessage[] = [];
		if (!lineDecorations) {
			return result;
		}

		for (const d of lineDecorations) {
			if (!d.options.glyphMarginClassName) {
				continue;
			}

			const hoverMessage = d.options.glyphMarginHoverMessage;
			if (!hoverMessage || isEmptyMarkdownString(hoverMessage)) {
				continue;
			}

			result.push(...asArray(hoverMessage).map(toHoverMessage));
		}

		return result;
	}

	public onResult(result: IHoverMessage[], isFromSynchronousComputation: boolean): void {
		this._result = this._result.concat(result);
	}

	public getResult(): IHoverMessage[] {
		return this._result;
	}

	public getResultWithLoadingMessage(): IHoverMessage[] {
		return this.getResult();
	}
}

export class ModesGlyphHoverWidget extends GlyphHoverWidget {

	public static readonly ID = 'editor.contrib.modesGlyphHoverWidget';
	private _messages: IHoverMessage[];
	private _lastLineNumber: number;

	private readonly _markdownRenderer: MarkdownRenderer;
	private readonly _computer: MarginComputer;
	private readonly _hoverOperation: HoverOperation<IHoverMessage[]>;
	private readonly _renderDisposeables = this._register(new DisposableStore());

	constructor(
		editor: ICodeEditor,
		modeService: IModeService,
		openerService: IOpenerService = NullOpenerService,
	) {
		super(ModesGlyphHoverWidget.ID, editor);

		this._messages = [];
		this._lastLineNumber = -1;

		this._markdownRenderer = this._register(new MarkdownRenderer({ editor: this._editor }, modeService, openerService));
		this._computer = new MarginComputer(this._editor);

		this._hoverOperation = new HoverOperation(
			this._computer,
			(result: IHoverMessage[]) => this._withResult(result),
			undefined,
			(result: any) => this._withResult(result),
			300
		);

	}

	public override dispose(): void {
		this._hoverOperation.cancel();
		super.dispose();
	}

	public onModelDecorationsChanged(): void {
		if (this.isVisible) {
			// The decorations have changed and the hover is visible,
			// we need to recompute the displayed text
			this._hoverOperation.cancel();
			this._computer.clearResult();
			this._hoverOperation.start(HoverStartMode.Delayed);
		}
	}

	public startShowingAt(lineNumber: number): void {
		if (this._lastLineNumber === lineNumber) {
			// We have to show the widget at the exact same line number as before, so no work is needed
			return;
		}

		this._hoverOperation.cancel();

		this.hide();

		this._lastLineNumber = lineNumber;
		this._computer.setLineNumber(lineNumber);
		this._hoverOperation.start(HoverStartMode.Delayed);
	}

	public override hide(): void {
		this._lastLineNumber = -1;
		this._hoverOperation.cancel();
		super.hide();
	}

	public _withResult(result: IHoverMessage[]): void {
		this._messages = result;

		if (this._messages.length > 0) {
			this._renderMessages(this._lastLineNumber, this._messages);
		} else {
			this.hide();
		}
	}

	private _renderMessages(lineNumber: number, messages: IHoverMessage[]): void {
		this._renderDisposeables.clear();

		const fragment = document.createDocumentFragment();

		for (const msg of messages) {
			const renderedContents = this._markdownRenderer.render(msg.value);
			this._renderDisposeables.add(renderedContents);
			fragment.appendChild($('div.hover-row', undefined, renderedContents.element));
		}

		this.updateContents(fragment);
		this.showAt(lineNumber);
	}
}
