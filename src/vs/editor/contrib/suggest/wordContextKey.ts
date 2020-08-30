/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey, IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IDisposable, dispose, Disposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

export class WordContextKey extends Disposable {

	static readonly AtEnd = new RawContextKey<boolean>('atEndOfWord', false);

	private readonly _ckAtEnd: IContextKey<boolean>;

	private _enabled: boolean = false;
	private _selectionListener?: IDisposable;

	constructor(
		private readonly _editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this._ckAtEnd = WordContextKey.AtEnd.bindTo(contextKeyService);
		this._register(this._editor.onDidChangeConfiguration(e => e.hasChanged(EditorOption.tabCompletion) && this._update()));
		this._update();
	}

	dispose(): void {
		super.dispose();
		dispose(this._selectionListener);
		this._ckAtEnd.reset();
	}

	private _update(): void {
		// only update this when tab completions are enabled
		const enabled = this._editor.getOption(EditorOption.tabCompletion) === 'on';
		if (this._enabled === enabled) {
			return;
		}
		this._enabled = enabled;

		if (this._enabled) {
			const checkForWordEnd = () => {
				if (!this._editor.hasModel()) {
					this._ckAtEnd.set(false);
					return;
				}
				const model = this._editor.getModel();
				const selection = this._editor.getSelection();
				const word = model.getWordAtPosition(selection.getStartPosition());
				if (!word) {
					this._ckAtEnd.set(false);
					return;
				}
				this._ckAtEnd.set(word.endColumn === selection.getStartPosition().column);
			};
			this._selectionListener = this._editor.onDidChangeCursorSelection(checkForWordEnd);
			checkForWordEnd();

		} else if (this._selectionListener) {
			this._ckAtEnd.reset();
			this._selectionListener.dispose();
			this._selectionListener = undefined;
		}
	}
}
