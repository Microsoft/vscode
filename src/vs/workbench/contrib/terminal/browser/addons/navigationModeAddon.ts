/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { Terminal, ITerminalAddon } from 'xterm';
import { addDisposableListener } from 'vs/base/browser/dom';
import { INavigationMode } from 'vs/workbench/contrib/terminal/common/terminal';

export class NavigationModeAddon implements INavigationMode, ITerminalAddon {
	private _terminal: Terminal | undefined;

	constructor(
		private _navigationModeContextKey: IContextKey<boolean>
	) { }

	activate(terminal: Terminal): void {
		this._terminal = terminal;
	}

	dispose() { }

	exitNavigationMode(): void {
		if (!this._terminal) {
			return;
		}
		this._terminal.scrollToBottom();
		this._terminal.focus();
	}

	focusPreviousLine(): void {
		if (!this._terminal || !this._terminal.element) {
			return;
		}

		// Focus previous row if a row is already focused
		if (document.activeElement && document.activeElement.parentElement && document.activeElement.parentElement.classList.contains('xterm-accessibility-tree')) {
			const element = <HTMLElement | null>document.activeElement.previousElementSibling;
			if (element) {
				element.focus();
				const disposable = addDisposableListener(element, 'blur', () => {
					this._navigationModeContextKey.set(false);
					disposable.dispose();
				});
				this._navigationModeContextKey.set(true);
			}
			return;
		}

		// Ensure a11y tree exists
		const treeContainer = this._terminal.element.querySelector('.xterm-accessibility-tree');
		if (!treeContainer) {
			return;
		}

		// Target is row before the cursor
		const targetRow = Math.max(this._terminal.buffer.active.cursorY - 1, 0);

		// Check bounds
		if (treeContainer.childElementCount < targetRow) {
			return;
		}

		// Focus
		const element = <HTMLElement>treeContainer.childNodes.item(targetRow);
		element.focus();
		const disposable = addDisposableListener(element, 'blur', () => {
			this._navigationModeContextKey.set(false);
			disposable.dispose();
		});
		this._navigationModeContextKey.set(true);
	}

	focusNextLine(): void {
		if (!this._terminal || !this._terminal.element) {
			return;
		}

		// Focus previous row if a row is already focused
		if (document.activeElement && document.activeElement.parentElement && document.activeElement.parentElement.classList.contains('xterm-accessibility-tree')) {
			const element = <HTMLElement | null>document.activeElement.nextElementSibling;
			if (element) {
				element.focus();
				const disposable = addDisposableListener(element, 'blur', () => {
					this._navigationModeContextKey.set(false);
					disposable.dispose();
				});
				this._navigationModeContextKey.set(true);
			}
			return;
		}

		// Ensure a11y tree exists
		const treeContainer = this._terminal.element.querySelector('.xterm-accessibility-tree');
		if (!treeContainer) {
			return;
		}

		// Target is cursor row
		const targetRow = this._terminal.buffer.active.cursorY;

		// Check bounds
		if (treeContainer.childElementCount < targetRow) {
			return;
		}

		// Focus row before cursor
		const element = <HTMLElement>treeContainer.childNodes.item(targetRow);
		element.focus();
		const disposable = addDisposableListener(element, 'blur', () => {
			this._navigationModeContextKey.set(false);
			disposable.dispose();
		});
		this._navigationModeContextKey.set(true);
	}
}
