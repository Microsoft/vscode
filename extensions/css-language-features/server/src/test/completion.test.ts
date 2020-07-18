/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { TextDocument, CompletionList, TextEdit } from 'vscode-languageserver-types';
import { WorkspaceFolder } from 'vscode-languageserver-protocol';
import { getCSSLanguageService, LanguageServiceOptions, getSCSSLanguageService } from 'vscode-css-languageservice';
import { getNodeFSRequestService } from '../node/nodeFs';
import { getDocumentContext } from '../utils/documentContext';

export interface ItemDescription {
	label: string;
	resultText?: string;
}

suite('Completions', () => {

	let assertCompletion = function (completions: CompletionList, expected: ItemDescription, document: TextDocument, _offset: number) {
		let matches = completions.items.filter(completion => {
			return completion.label === expected.label;
		});

		assert.equal(matches.length, 1, `${expected.label} should only existing once: Actual: ${completions.items.map(c => c.label).join(', ')}`);
		let match = matches[0];
		if (expected.resultText && TextEdit.is(match.textEdit)) {
			assert.equal(TextDocument.applyEdits(document, [match.textEdit]), expected.resultText);
		}
	};

	async function assertCompletions(value: string, expected: { count?: number, items?: ItemDescription[] }, testUri: string, workspaceFolders?: WorkspaceFolder[], lang: string = 'css'): Promise<any> {
		const offset = value.indexOf('|');
		value = value.substr(0, offset) + value.substr(offset + 1);

		const document = TextDocument.create(testUri, lang, 0, value);
		const position = document.positionAt(offset);

		if (!workspaceFolders) {
			workspaceFolders = [{ name: 'x', uri: testUri.substr(0, testUri.lastIndexOf('/')) }];
		}

		const lsOptions: LanguageServiceOptions = { fileSystemProvider: getNodeFSRequestService() };
		const cssLanguageService = lang === 'scss' ? getSCSSLanguageService(lsOptions) : getCSSLanguageService(lsOptions);

		const context = getDocumentContext(testUri, workspaceFolders);
		const stylesheet = cssLanguageService.parseStylesheet(document);
		let list = await cssLanguageService.doComplete2(document, position, stylesheet, context);

		if (expected.count) {
			assert.equal(list.items.length, expected.count);
		}
		if (expected.items) {
			for (let item of expected.items) {
				assertCompletion(list, item, document, offset);
			}
		}
	}

	test('CSS url() Path completion', async function () {
		let testUri = URI.file(path.resolve(__dirname, '../../test/pathCompletionFixtures/about/about.css')).toString();
		let folders = [{ name: 'x', uri: URI.file(path.resolve(__dirname, '../../test')).toString() }];

		await assertCompletions('html { background-image: url("./|")', {
			items: [
				{ label: 'about.html', resultText: 'html { background-image: url("./about.html")' }
			]
		}, testUri, folders);

		await assertCompletions(`html { background-image: url('../|')`, {
			items: [
				{ label: 'about/', resultText: `html { background-image: url('../about/')` },
				{ label: 'index.html', resultText: `html { background-image: url('../index.html')` },
				{ label: 'src/', resultText: `html { background-image: url('../src/')` }
			]
		}, testUri, folders);

		await assertCompletions(`html { background-image: url('../src/a|')`, {
			items: [
				{ label: 'feature.js', resultText: `html { background-image: url('../src/feature.js')` },
				{ label: 'data/', resultText: `html { background-image: url('../src/data/')` },
				{ label: 'test.js', resultText: `html { background-image: url('../src/test.js')` }
			]
		}, testUri, folders);

		await assertCompletions(`html { background-image: url('../src/data/f|.asar')`, {
			items: [
				{ label: 'foo.asar', resultText: `html { background-image: url('../src/data/foo.asar')` }
			]
		}, testUri, folders);

		await assertCompletions(`html { background-image: url('|')`, {
			items: [
				{ label: 'about.html', resultText: `html { background-image: url('about.html')` },
			]
		}, testUri, folders);

		await assertCompletions(`html { background-image: url('/|')`, {
			items: [
				{ label: 'pathCompletionFixtures/', resultText: `html { background-image: url('/pathCompletionFixtures/')` }
			]
		}, testUri, folders);

		await assertCompletions(`html { background-image: url('/pathCompletionFixtures/|')`, {
			items: [
				{ label: 'about/', resultText: `html { background-image: url('/pathCompletionFixtures/about/')` },
				{ label: 'index.html', resultText: `html { background-image: url('/pathCompletionFixtures/index.html')` },
				{ label: 'src/', resultText: `html { background-image: url('/pathCompletionFixtures/src/')` }
			]
		}, testUri, folders);

		await assertCompletions(`html { background-image: url("/|")`, {
			items: [
				{ label: 'pathCompletionFixtures/', resultText: `html { background-image: url("/pathCompletionFixtures/")` }
			]
		}, testUri, folders);
	});

	test('CSS url() Path Completion - Unquoted url', async function () {
		let testUri = URI.file(path.resolve(__dirname, '../../test/pathCompletionFixtures/about/about.css')).toString();
		let folders = [{ name: 'x', uri: URI.file(path.resolve(__dirname, '../../test')).toString() }];

		await assertCompletions('html { background-image: url(./|)', {
			items: [
				{ label: 'about.html', resultText: 'html { background-image: url(./about.html)' }
			]
		}, testUri, folders);

		await assertCompletions('html { background-image: url(./a|)', {
			items: [
				{ label: 'about.html', resultText: 'html { background-image: url(./about.html)' }
			]
		}, testUri, folders);

		await assertCompletions('html { background-image: url(../|src/)', {
			items: [
				{ label: 'about/', resultText: 'html { background-image: url(../about/)' }
			]
		}, testUri, folders);

		await assertCompletions('html { background-image: url(../s|rc/)', {
			items: [
				{ label: 'about/', resultText: 'html { background-image: url(../about/)' }
			]
		}, testUri, folders);
	});

	test('CSS @import Path completion', async function () {
		let testUri = URI.file(path.resolve(__dirname, '../../test/pathCompletionFixtures/about/about.css')).toString();
		let folders = [{ name: 'x', uri: URI.file(path.resolve(__dirname, '../../test')).toString() }];

		await assertCompletions(`@import './|'`, {
			items: [
				{ label: 'about.html', resultText: `@import './about.html'` },
			]
		}, testUri, folders);

		await assertCompletions(`@import '../|'`, {
			items: [
				{ label: 'about/', resultText: `@import '../about/'` },
				{ label: 'scss/', resultText: `@import '../scss/'` },
				{ label: 'index.html', resultText: `@import '../index.html'` },
				{ label: 'src/', resultText: `@import '../src/'` }
			]
		}, testUri, folders);
	});

	/**
	 * For SCSS, `@import 'foo';` can be used for importing partial file `_foo.scss`
	 */
	test('SCSS @import Path completion', async function () {
		let testCSSUri = URI.file(path.resolve(__dirname, '../../test/pathCompletionFixtures/about/about.css')).toString();
		let folders = [{ name: 'x', uri: URI.file(path.resolve(__dirname, '../../test')).toString() }];

		/**
		 * We are in a CSS file, so no special treatment for SCSS partial files
		*/
		await assertCompletions(`@import '../scss/|'`, {
			items: [
				{ label: 'main.scss', resultText: `@import '../scss/main.scss'` },
				{ label: '_foo.scss', resultText: `@import '../scss/_foo.scss'` }
			]
		}, testCSSUri, folders);

		let testSCSSUri = URI.file(path.resolve(__dirname, '../../test/pathCompletionFixtures/scss/main.scss')).toString();
		await assertCompletions(`@import './|'`, {
			items: [
				{ label: '_foo.scss', resultText: `@import './foo'` }
			]
		}, testSCSSUri, folders, 'scss');
	});

	test('Completion should ignore files/folders starting with dot', async function () {
		let testUri = URI.file(path.resolve(__dirname, '../../test/pathCompletionFixtures/about/about.css')).toString();
		let folders = [{ name: 'x', uri: URI.file(path.resolve(__dirname, '../../test')).toString() }];

		await assertCompletions('html { background-image: url("../|")', {
			count: 4
		}, testUri, folders);

	});
});
