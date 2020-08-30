/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyMod } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution } from 'vs/editor/common/editorCommon';

/**
 * Prevents the top-level menu from showing up when doing Alt + Click in the editor
 */
export class MenuPreventer extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.menuPreventer';

	private _editor: ICodeEditor;
	private _altListeningMouse: boolean;
	private _altMouseTriggered: boolean;

	constructor(editor: ICodeEditor) {
		super();
		this._editor = editor;
		this._altListeningMouse = false;
		this._altMouseTriggered = false;

		// A global crossover handler to prevent menu bar from showing up
		// When <alt> is hold, we will listen to mouse events and prevent
		// the release event up <alt> if the mouse is triggered.

		this._register(this._editor.onMouseDown((e) => {
			if (this._altListeningMouse) {
				this._altMouseTriggered = true;
			}
		}));

		this._register(this._editor.onKeyDown((e) => {
			if (e.equals(KeyMod.Alt)) {
				if (!this._altListeningMouse) {
					this._altMouseTriggered = false;
				}
				this._altListeningMouse = true;
			}
		}));

		this._register(this._editor.onKeyUp((e) => {
			if (e.equals(KeyMod.Alt)) {
				if (this._altMouseTriggered) {
					e.preventDefault();
				}
				this._altListeningMouse = false;
				this._altMouseTriggered = false;
			}
		}));
	}
}

registerEditorContribution(MenuPreventer.ID, MenuPreventer);
