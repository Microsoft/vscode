/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Widget } from 'vs/base/browser/ui/widget';
import { ICodeEditor, IOverlayWidget, IOverlayWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';

export class GlyphHoverWidget extends Widget implements IOverlayWidget {

	private readonly _id: string;
	protected _editor: ICodeEditor;
	private _isVisible: boolean;
	private readonly _domNode: HTMLElement;
	protected _showAtLineNumber: number;

	constructor(id: string, editor: ICodeEditor) {
		super();
		this._id = id;
		this._editor = editor;
		this._isVisible = false;

		this._domNode = document.createElement('div');
		this._domNode.className = 'monaco-hover hidden';
		this._domNode.setAttribute('aria-hidden', 'true');
		this._domNode.setAttribute('role', 'tooltip');

		this._showAtLineNumber = -1;

		this._register(this._editor.onDidChangeConfiguration((e: ConfigurationChangedEvent) => {
			if (e.hasChanged(EditorOption.fontInfo)) {
				this.updateFont();
			}
		}));

		this._editor.addOverlayWidget(this);
	}

	protected get isVisible(): boolean {
		return this._isVisible;
	}

	protected set isVisible(value: boolean) {
		this._isVisible = value;
		this._domNode.classList.toggle('hidden', !this._isVisible);
	}

	public getId(): string {
		return this._id;
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public showAt(lineNumber: number): void {
		this._showAtLineNumber = lineNumber;

		if (!this.isVisible) {
			this.isVisible = true;
		}

		const editorLayout = this._editor.getLayoutInfo();
		const topForLineNumber = this._editor.getTopForLineNumber(this._showAtLineNumber);
		const editorScrollTop = this._editor.getScrollTop();
		const lineHeight = this._editor.getOption(EditorOption.lineHeight);
		const nodeHeight = this._domNode.clientHeight;
		const top = topForLineNumber - editorScrollTop - ((nodeHeight - lineHeight) / 2);

		this._domNode.style.left = `${editorLayout.glyphMarginLeft + editorLayout.glyphMarginWidth}px`;
		this._domNode.style.top = `${Math.max(Math.round(top), 0)}px`;
	}

	public hide(): void {
		if (!this.isVisible) {
			return;
		}
		this.isVisible = false;
	}

	public getPosition(): IOverlayWidgetPosition | null {
		return null;
	}

	public override dispose(): void {
		this._editor.removeOverlayWidget(this);
		super.dispose();
	}

	private updateFont(): void {
		const codeTags: HTMLElement[] = Array.prototype.slice.call(this._domNode.getElementsByTagName('code'));
		const codeClasses: HTMLElement[] = Array.prototype.slice.call(this._domNode.getElementsByClassName('code'));

		[...codeTags, ...codeClasses].forEach(node => this._editor.applyFontInfo(node));
	}

	protected updateContents(node: Node): void {
		this._domNode.textContent = '';
		this._domNode.appendChild(node);
		this.updateFont();
	}
}
