/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { HoverProvider, Hover, MarkedString, TextDocument, CancellationToken, Position, workspace } from 'vscode';
import { textToMarkedString } from './utils/markedTextUtil';
import phpGlobals = require('./phpGlobals');
import phpGlobalFunctions = require('./phpGlobalFunctions');

export default class PHPHoverProvider implements HoverProvider {

	public provideHover(document: TextDocument, position: Position, _token: CancellationToken): Hover | undefined {
		let enable = workspace.getConfiguration('php').get<boolean>('suggest.basic', true);
		if (!enable) {
			return undefined;
		}

		let wordRange = document.getWordRangeAtPosition(position);
		if (!wordRange) {
			return undefined;
		}

		let name = document.getText(wordRange);

		let entry = phpGlobalFunctions.globalfunctions[name] || phpGlobals.compiletimeconstants[name] || phpGlobals.globalvariables[name] || phpGlobals.keywords[name];
		if (entry && entry.description) {
			let signature = name + (entry.signature || '');
			let contents: MarkedString[] = [textToMarkedString(entry.description), { language: 'php', value: signature }];
			return new Hover(contents, wordRange);
		}

		return undefined;
	}
}
