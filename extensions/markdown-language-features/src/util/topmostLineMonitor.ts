/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../util/dispose';
import { isMarkdownFile } from './file';

export class TopmostLineMonitor extends Disposable {

	private readonly pendingUpdates = new Map<string, number>();
	private readonly throttle = 50;

	constructor() {
		super();
		this._register(vscode.window.onDidChangeTextEditorVisibleRanges(event => {
			if (isMarkdownFile(event.textEditor.document)) {
				const line = getVisibleLine(event.textEditor);
				if (typeof line === 'number') {
					this.updateLine(event.textEditor.document.uri, line);
				}
			}
		}));
	}

	private readonly _onChanged = this._register(new vscode.EventEmitter<{ readonly resource: vscode.Uri, readonly line: number }>());
	public readonly onDidChanged = this._onChanged.event;

	private updateLine(
		resource: vscode.Uri,
		line: number
	) {
		const key = resource.toString();
		if (!this.pendingUpdates.has(key)) {
			// schedule update
			setTimeout(() => {
				if (this.pendingUpdates.has(key)) {
					this._onChanged.fire({
						resource,
						line: this.pendingUpdates.get(key) as number
					});
					this.pendingUpdates.delete(key);
				}
			}, this.throttle);
		}

		this.pendingUpdates.set(key, line);
	}
}

/**
 * Get the top-most visible range of `editor`.
 *
 * Returns a fractional line number based the visible character within the line.
 * Floor to get real line number
 */
export function getVisibleLine(
	editor: vscode.TextEditor
): number | undefined {
	if (!editor.visibleRanges.length) {
		return undefined;
	}

	const firstVisiblePosition = editor.visibleRanges[0].start;
	const lineNumber = firstVisiblePosition.line;
	const line = editor.document.lineAt(lineNumber);
	const progress = firstVisiblePosition.character / (line.text.length + 2);
	return lineNumber + progress;
}
