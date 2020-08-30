/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { getElementsForSourceLine } from './scroll-sync';

export class ActiveLineMarker {
	private _current: any;

	onDidChangeTextEditorSelection(line: number) {
		const { previous } = getElementsForSourceLine(line);
		this._update(previous && previous.element);
	}

	_update(before: HTMLElement | undefined) {
		this._unmarkActiveElement(this._current);
		this._markActiveElement(before);
		this._current = before;
	}

	_unmarkActiveElement(element: HTMLElement | undefined) {
		if (!element) {
			return;
		}
		element.className = element.className.replace(/\bcode-active-line\b/g, '');
	}

	_markActiveElement(element: HTMLElement | undefined) {
		if (!element) {
			return;
		}
		element.className += ' code-active-line';
	}
}
