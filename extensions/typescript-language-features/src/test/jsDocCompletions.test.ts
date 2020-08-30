/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as vscode from 'vscode';
import { disposeAll } from '../utils/dispose';
import { acceptFirstSuggestion } from './suggestTestHelpers';
import { assertEditorContents, Config, createTestEditor, CURSOR, enumerateConfig, insertModesValues, joinLines, updateConfig, VsCodeConfiguration, wait } from './testUtils';

const testDocumentUri = vscode.Uri.parse('untitled:test.ts');

suite('JSDoc Completions', () => {
	const _disposables: vscode.Disposable[] = [];

	const configDefaults: VsCodeConfiguration = Object.freeze({
		[Config.snippetSuggestions]: 'inline',
	});

	let oldConfig: { [key: string]: any } = {};

	setup(async () => {
		await wait(100);

		// Save off config and apply defaults
		oldConfig = await updateConfig(testDocumentUri, configDefaults);
	});

	teardown(async () => {
		disposeAll(_disposables);

		// Restore config
		await updateConfig(testDocumentUri, oldConfig);

		return vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('Should complete jsdoc inside single line comment', async () => {
		await enumerateConfig(testDocumentUri, Config.insertMode, insertModesValues, async config => {

			const editor = await createTestEditor(testDocumentUri,
				`/**$0 */`,
				`function abcdef(x, y) { }`,
			);

			await acceptFirstSuggestion(testDocumentUri, _disposables);

			assertEditorContents(editor,
				joinLines(
					`/**`,
					` * `,
					` * @param x ${CURSOR}`,
					` * @param y `,
					` */`,
					`function abcdef(x, y) { }`,
				),
				`Config: ${config}`);
		});
	});
});
