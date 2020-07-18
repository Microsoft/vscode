/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';
import { disposeAll } from '../utils/dispose';
import { createTestEditor, wait } from './testUtils';


type VsCodeConfiguration = { [key: string]: any };

async function updateConfig(newConfig: VsCodeConfiguration): Promise<VsCodeConfiguration> {
	const oldConfig: VsCodeConfiguration = {};
	const config = vscode.workspace.getConfiguration(undefined);
	for (const configKey of Object.keys(newConfig)) {
		oldConfig[configKey] = config.get(configKey);
		await new Promise((resolve, reject) =>
			config.update(configKey, newConfig[configKey], vscode.ConfigurationTarget.Global)
				.then(() => resolve(), reject));
	}
	return oldConfig;
}

namespace Config {
	export const referencesCodeLens = 'typescript.referencesCodeLens.enabled';
}

suite('TypeScript References', () => {
	const configDefaults: VsCodeConfiguration = Object.freeze({
		[Config.referencesCodeLens]: true,
	});

	const _disposables: vscode.Disposable[] = [];
	let oldConfig: { [key: string]: any } = {};

	setup(async () => {
		await wait(100);

		// Save off config and apply defaults
		oldConfig = await updateConfig(configDefaults);
	});

	teardown(async () => {
		disposeAll(_disposables);

		// Restore config
		await updateConfig(oldConfig);

		return vscode.commands.executeCommand('workbench.action.closeAllEditors');
	});

	test('Should show on basic class', async () => {
		const testDocumentUri = vscode.Uri.parse('untitled:test1.ts');
		await createTestEditor(testDocumentUri,
			`class Foo {}`
		);

		const codeLenses = await getCodeLenses(testDocumentUri);
		assert.strictEqual(codeLenses?.length, 1);
		assert.strictEqual(codeLenses?.[0].range.start.line, 0);
	});

	test('Should show on basic class properties', async () => {
		const testDocumentUri = vscode.Uri.parse('untitled:test2.ts');
		await createTestEditor(testDocumentUri,
			`class Foo {`,
			`	prop: number;`,
			`	meth(): void {}`,
			`}`
		);

		const codeLenses = await getCodeLenses(testDocumentUri);
		assert.strictEqual(codeLenses?.length, 3);
		assert.strictEqual(codeLenses?.[0].range.start.line, 0);
		assert.strictEqual(codeLenses?.[1].range.start.line, 1);
		assert.strictEqual(codeLenses?.[2].range.start.line, 2);
	});

	test('Should not show on const property', async () => {
		const testDocumentUri = vscode.Uri.parse('untitled:test3.ts');
		await createTestEditor(testDocumentUri,
			`const foo = {`,
			`	prop: 1;`,
			`	meth(): void {}`,
			`}`
		);

		const codeLenses = await getCodeLenses(testDocumentUri);
		assert.strictEqual(codeLenses?.length, 0);
	});

	test.skip('Should not show duplicate references on ES5 class (https://github.com/microsoft/vscode/issues/90396)', async () => {
		const testDocumentUri = vscode.Uri.parse('untitled:test3.js');
		await createTestEditor(testDocumentUri,
			`function A() {`,
			`    console.log("hi");`,
			`}`,
			`A.x = {};`,
		);

		await wait(500);
		const codeLenses = await getCodeLenses(testDocumentUri);
		assert.strictEqual(codeLenses?.length, 1);
	});
});

function getCodeLenses(document: vscode.Uri): Thenable<readonly vscode.CodeLens[] | undefined> {
	return vscode.commands.executeCommand<readonly vscode.CodeLens[]>('vscode.executeCodeLensProvider', document, 100);
}

