/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from '../util/dispose';
import { isMarkdownFile } from './file';

export interface LastScrollLocation {
	readonly line: number;
	readonly uri: vscode.Uri;
}

export class TopmostLineMonitor extends Disposable {

	private readonly pendingUpdates = new Map<string, number>();
	private readonly throttle = 50;
	private previousMDTextEditors = new Map<string, vscode.TextEditor>();
	private previousStaticEditorInfo = new Map<string, LastScrollLocation>();
	private isPrevEditorCustom = false;

	constructor() {
		super();

		if (vscode.window.activeTextEditor) {
			this.setPreviousMDTextEditorLine(vscode.window.activeTextEditor);
		}

		this._register(vscode.window.onDidChangeTextEditorVisibleRanges(event => {
			if (isMarkdownFile(event.textEditor.document)) {
				const line = getVisibleLine(event.textEditor);
				if (typeof line === 'number') {
					this.updateLine(event.textEditor.document.uri, line);
				}
			}
		}));

		this._register(vscode.window.onDidChangeActiveTextEditor(textEditor => {

			// When at a markdown file, apply existing scroll settings from static preview if last editor was custom.
			// Also save reference to text editor for line number reference later
			if (textEditor && textEditor.document && isMarkdownFile(textEditor.document)) {
				if (this.isPrevEditorCustom) {
					const line = this.getPreviousStaticEditorLineByUri(textEditor.document.uri);
					if (line) {
						this._onEditorNeedsScrolling.fire({ line: line, editor: textEditor });
					}
				}
				this.setPreviousMDTextEditorLine(textEditor);
			}

			this.isPrevEditorCustom = (textEditor === undefined);
		}));
	}

	private readonly _onChanged = this._register(new vscode.EventEmitter<{ readonly resource: vscode.Uri, readonly line: number }>());
	public readonly onDidChanged = this._onChanged.event;

	private readonly _onEditorNeedsScrolling = this._register(new vscode.EventEmitter<{ readonly line: number, readonly editor: vscode.TextEditor }>());
	public readonly onEditorNeedsScrolling = this._onEditorNeedsScrolling.event;

	public setPreviousMDTextEditorLine(editor: vscode.TextEditor) {
		const uri = editor.document.uri;
		this.previousMDTextEditors.set(uri.toString(), editor);
	}

	public getPreviousMDTextEditorLineByUri(resource: vscode.Uri) {
		const editor = this.previousMDTextEditors.get(resource.toString());
		return editor?.visibleRanges[0].start.line;
	}

	public setPreviousStaticEditorLine(scrollLocation: LastScrollLocation) {
		this.previousStaticEditorInfo.set(scrollLocation.uri.toString(), scrollLocation);
	}

	public getPreviousStaticEditorLineByUri(resource: vscode.Uri) {
		const scrollLoc = this.previousStaticEditorInfo.get(resource.toString());
		return scrollLoc?.line;
	}

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
