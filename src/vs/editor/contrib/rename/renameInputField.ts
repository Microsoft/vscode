/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./renameInputField';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { Position } from 'vs/editor/common/core/position';
import { IRange } from 'vs/editor/common/core/range';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { localize } from 'vs/nls';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { inputBackground, inputBorder, inputForeground, widgetShadow, editorWidgetBackground } from 'vs/platform/theme/common/colorRegistry';
import { IColorTheme, IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { CancellationToken } from 'vs/base/common/cancellation';

export const CONTEXT_RENAME_INPUT_VISIBLE = new RawContextKey<boolean>('renameInputVisible', false);

export interface RenameInputFieldResult {
	newName: string;
	wantsPreview?: boolean;
}

export class RenameInputField implements IContentWidget {

	private _position?: Position;
	private _domNode?: HTMLElement;
	private _input?: HTMLInputElement;
	private _label?: HTMLDivElement;
	private _visible?: boolean;
	private readonly _visibleContextKey: IContextKey<boolean>;
	private readonly _disposables = new DisposableStore();

	readonly allowEditorOverflow: boolean = true;

	constructor(
		private readonly _editor: ICodeEditor,
		private readonly _acceptKeybindings: [string, string],
		@IThemeService private readonly _themeService: IThemeService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		this._visibleContextKey = CONTEXT_RENAME_INPUT_VISIBLE.bindTo(contextKeyService);

		this._editor.addContentWidget(this);

		this._disposables.add(this._editor.onDidChangeConfiguration(e => {
			if (e.hasChanged(EditorOption.fontInfo)) {
				this._updateFont();
			}
		}));

		this._disposables.add(_themeService.onDidColorThemeChange(this._updateStyles, this));
	}

	dispose(): void {
		this._disposables.dispose();
		this._editor.removeContentWidget(this);
	}

	getId(): string {
		return '__renameInputWidget';
	}

	getDomNode(): HTMLElement {
		if (!this._domNode) {
			this._domNode = document.createElement('div');
			this._domNode.className = 'monaco-editor rename-box';

			this._input = document.createElement('input');
			this._input.className = 'rename-input';
			this._input.type = 'text';
			this._input.setAttribute('aria-label', localize('renameAriaLabel', "Rename input. Type new name and press Enter to commit."));
			this._domNode.appendChild(this._input);

			this._label = document.createElement('div');
			this._label.className = 'rename-label';
			this._domNode.appendChild(this._label);
			const updateLabel = () => {
				const [accept, preview] = this._acceptKeybindings;
				this._keybindingService.lookupKeybinding(accept);
				this._label!.innerText = localize({ key: 'label', comment: ['placeholders are keybindings, e.g "F2 to Rename, Shift+F2 to Preview"'] }, "{0} to Rename, {1} to Preview", this._keybindingService.lookupKeybinding(accept)?.getLabel(), this._keybindingService.lookupKeybinding(preview)?.getLabel());
			};
			updateLabel();
			this._disposables.add(this._keybindingService.onDidUpdateKeybindings(updateLabel));

			this._updateFont();
			this._updateStyles(this._themeService.getColorTheme());
		}
		return this._domNode;
	}

	private _updateStyles(theme: IColorTheme): void {
		if (!this._input || !this._domNode) {
			return;
		}

		const widgetShadowColor = theme.getColor(widgetShadow);
		this._domNode.style.backgroundColor = String(theme.getColor(editorWidgetBackground) ?? '');
		this._domNode.style.boxShadow = widgetShadowColor ? ` 0 0 8px 2px ${widgetShadowColor}` : '';
		this._domNode.style.color = String(theme.getColor(inputForeground) ?? '');

		this._input.style.backgroundColor = String(theme.getColor(inputBackground) ?? '');
		// this._input.style.color = String(theme.getColor(inputForeground) ?? '');
		const border = theme.getColor(inputBorder);
		this._input.style.borderWidth = border ? '1px' : '0px';
		this._input.style.borderStyle = border ? 'solid' : 'none';
		this._input.style.borderColor = border?.toString() ?? 'none';
	}

	private _updateFont(): void {
		if (!this._input || !this._label) {
			return;
		}

		const fontInfo = this._editor.getOption(EditorOption.fontInfo);
		this._input.style.fontFamily = fontInfo.fontFamily;
		this._input.style.fontWeight = fontInfo.fontWeight;
		this._input.style.fontSize = `${fontInfo.fontSize}px`;

		this._label.style.fontSize = `${fontInfo.fontSize * 0.8}px`;
	}

	getPosition(): IContentWidgetPosition | null {
		if (!this._visible) {
			return null;
		}
		return {
			position: this._position!,
			preference: [ContentWidgetPositionPreference.BELOW, ContentWidgetPositionPreference.ABOVE]
		};
	}

	afterRender(position: ContentWidgetPositionPreference | null): void {
		if (!position) {
			// cancel rename when input widget isn't rendered anymore
			this.cancelInput(true);
		}
	}


	private _currentAcceptInput?: (wantsPreview: boolean) => void;
	private _currentCancelInput?: (focusEditor: boolean) => void;

	acceptInput(wantsPreview: boolean): void {
		if (this._currentAcceptInput) {
			this._currentAcceptInput(wantsPreview);
		}
	}

	cancelInput(focusEditor: boolean): void {
		if (this._currentCancelInput) {
			this._currentCancelInput(focusEditor);
		}
	}

	getInput(where: IRange, value: string, selectionStart: number, selectionEnd: number, supportPreview: boolean, token: CancellationToken): Promise<RenameInputFieldResult | boolean> {

		this._domNode!.classList.toggle('preview', supportPreview);

		this._position = new Position(where.startLineNumber, where.startColumn);
		this._input!.value = value;
		this._input!.setAttribute('selectionStart', selectionStart.toString());
		this._input!.setAttribute('selectionEnd', selectionEnd.toString());
		this._input!.size = Math.max((where.endColumn - where.startColumn) * 1.1, 20);

		const disposeOnDone = new DisposableStore();

		return new Promise<RenameInputFieldResult | boolean>(resolve => {

			this._currentCancelInput = (focusEditor) => {
				this._currentAcceptInput = undefined;
				this._currentCancelInput = undefined;
				resolve(focusEditor);
				return true;
			};

			this._currentAcceptInput = (wantsPreview) => {
				if (this._input!.value.trim().length === 0 || this._input!.value === value) {
					// empty or whitespace only or not changed
					this.cancelInput(true);
					return;
				}

				this._currentAcceptInput = undefined;
				this._currentCancelInput = undefined;
				resolve({
					newName: this._input!.value,
					wantsPreview: supportPreview && wantsPreview
				});
			};

			token.onCancellationRequested(() => this.cancelInput(true));
			disposeOnDone.add(this._editor.onDidBlurEditorWidget(() => this.cancelInput(false)));

			this._show();

		}).finally(() => {
			disposeOnDone.dispose();
			this._hide();
		});
	}

	private _show(): void {
		this._editor.revealLineInCenterIfOutsideViewport(this._position!.lineNumber, ScrollType.Smooth);
		this._visible = true;
		this._visibleContextKey.set(true);
		this._editor.layoutContentWidget(this);

		setTimeout(() => {
			this._input!.focus();
			this._input!.setSelectionRange(
				parseInt(this._input!.getAttribute('selectionStart')!),
				parseInt(this._input!.getAttribute('selectionEnd')!));
		}, 100);
	}

	private _hide(): void {
		this._visible = false;
		this._visibleContextKey.reset();
		this._editor.layoutContentWidget(this);
	}
}
