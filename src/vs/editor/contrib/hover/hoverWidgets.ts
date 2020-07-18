/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { Widget } from 'vs/base/browser/ui/widget';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IContentWidget, ICodeEditor, IContentWidgetPosition, ContentWidgetPositionPreference, IOverlayWidget, IOverlayWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { renderHoverAction, HoverWidget } from 'vs/base/browser/ui/hover/hoverWidget';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKey } from 'vs/platform/contextkey/common/contextkey';

export class ContentHoverWidget extends Widget implements IContentWidget {

	protected readonly _hover: HoverWidget;
	private readonly _id: string;
	protected _editor: ICodeEditor;
	private _isVisible: boolean;
	protected _showAtPosition: Position | null;
	protected _showAtRange: Range | null;
	private _stoleFocus: boolean;

	// Editor.IContentWidget.allowEditorOverflow
	public allowEditorOverflow = true;

	protected get isVisible(): boolean {
		return this._isVisible;
	}

	protected set isVisible(value: boolean) {
		this._isVisible = value;
		dom.toggleClass(this._hover.containerDomNode, 'hidden', !this._isVisible);
	}

	constructor(
		id: string,
		editor: ICodeEditor,
		private readonly _hoverVisibleKey: IContextKey<boolean>,
		private readonly _keybindingService: IKeybindingService
	) {
		super();

		this._hover = this._register(new HoverWidget());
		this._id = id;
		this._editor = editor;
		this._isVisible = false;
		this._stoleFocus = false;

		this.onkeydown(this._hover.containerDomNode, (e: IKeyboardEvent) => {
			if (e.equals(KeyCode.Escape)) {
				this.hide();
			}
		});

		this._register(this._editor.onDidChangeConfiguration((e: ConfigurationChangedEvent) => {
			if (e.hasChanged(EditorOption.fontInfo)) {
				this.updateFont();
			}
		}));

		this._editor.onDidLayoutChange(e => this.layout());

		this.layout();
		this._editor.addContentWidget(this);
		this._showAtPosition = null;
		this._showAtRange = null;
		this._stoleFocus = false;
	}

	public getId(): string {
		return this._id;
	}

	public getDomNode(): HTMLElement {
		return this._hover.containerDomNode;
	}

	public showAt(position: Position, range: Range | null, focus: boolean): void {
		// Position has changed
		this._showAtPosition = position;
		this._showAtRange = range;
		this._hoverVisibleKey.set(true);
		this.isVisible = true;

		this._editor.layoutContentWidget(this);
		// Simply force a synchronous render on the editor
		// such that the widget does not really render with left = '0px'
		this._editor.render();
		this._stoleFocus = focus;
		if (focus) {
			this._hover.containerDomNode.focus();
		}
	}

	public hide(): void {
		if (!this.isVisible) {
			return;
		}

		setTimeout(() => {
			// Give commands a chance to see the key
			if (!this.isVisible) {
				this._hoverVisibleKey.set(false);
			}
		}, 0);
		this.isVisible = false;

		this._editor.layoutContentWidget(this);
		if (this._stoleFocus) {
			this._editor.focus();
		}
	}

	public getPosition(): IContentWidgetPosition | null {
		if (this.isVisible) {
			return {
				position: this._showAtPosition,
				range: this._showAtRange,
				preference: [
					ContentWidgetPositionPreference.ABOVE,
					ContentWidgetPositionPreference.BELOW
				]
			};
		}
		return null;
	}

	public dispose(): void {
		this._editor.removeContentWidget(this);
		super.dispose();
	}

	private updateFont(): void {
		const codeClasses: HTMLElement[] = Array.prototype.slice.call(this._hover.contentsDomNode.getElementsByClassName('code'));
		codeClasses.forEach(node => this._editor.applyFontInfo(node));
	}

	protected updateContents(node: Node): void {
		this._hover.contentsDomNode.textContent = '';
		this._hover.contentsDomNode.appendChild(node);
		this.updateFont();

		this._editor.layoutContentWidget(this);
		this._hover.onContentsChanged();
	}

	protected _renderAction(parent: HTMLElement, actionOptions: { label: string, iconClass?: string, run: (target: HTMLElement) => void, commandId: string }): IDisposable {
		const keybinding = this._keybindingService.lookupKeybinding(actionOptions.commandId);
		const keybindingLabel = keybinding ? keybinding.getLabel() : null;
		return renderHoverAction(parent, actionOptions, keybindingLabel);
	}

	private layout(): void {
		const height = Math.max(this._editor.getLayoutInfo().height / 4, 250);
		const { fontSize, lineHeight } = this._editor.getOption(EditorOption.fontInfo);

		this._hover.contentsDomNode.style.fontSize = `${fontSize}px`;
		this._hover.contentsDomNode.style.lineHeight = `${lineHeight}px`;
		this._hover.contentsDomNode.style.maxHeight = `${height}px`;
		this._hover.contentsDomNode.style.maxWidth = `${Math.max(this._editor.getLayoutInfo().width * 0.66, 500)}px`;
	}
}

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
		dom.toggleClass(this._domNode, 'hidden', !this._isVisible);
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

	public dispose(): void {
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
