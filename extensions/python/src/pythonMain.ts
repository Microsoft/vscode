/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext, languages, IndentAction } from 'vscode';

export function activate(_context: ExtensionContext): any {
	languages.setLanguageConfiguration('python', {
		onEnterRules: [
			{
				beforeText: /^\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async).*?:\s*$/,
				action: { indentAction: IndentAction.Indent }
			}
		]
	});
}
