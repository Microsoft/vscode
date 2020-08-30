/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* Based on @sergeche's work in his emmet plugin */

import * as vscode from 'vscode';
import evaluate from '@emmetio/math-expression';
import { DocumentStreamReader } from './bufferStream';

export function evaluateMathExpression() {
	if (!vscode.window.activeTextEditor) {
		vscode.window.showInformationMessage('No editor is active');
		return;
	}
	const editor = vscode.window.activeTextEditor;
	const stream = new DocumentStreamReader(editor.document);
	editor.edit(editBuilder => {
		editor.selections.forEach(selection => {
			const pos = selection.isReversed ? selection.anchor : selection.active;
			stream.pos = pos;

			try {
				const result = String(evaluate(stream, true));
				editBuilder.replace(new vscode.Range(stream.pos, pos), result);
			} catch (err) {
				vscode.window.showErrorMessage('Could not evaluate expression');
				// Ignore error since most likely it’s because of non-math expression
				console.warn('Math evaluation error', err);
			}
		});
	});

}
