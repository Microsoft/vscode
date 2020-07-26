/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import 'mocha';
import * as assert from 'assert';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { getLanguageModes, WorkspaceFolder, TextDocument, CompletionList, CompletionItemKind, ClientCapabilities, TextEdit } from '../modes/languageModes';
import { getNodeFSRequestService } from '../node/nodeFs';
import { getDocumentContext } from '../utils/documentContext';
export interface ItemDescription {
	label: string;
	documentation?: string;
	kind?: CompletionItemKind;
	resultText?: string;
	command?: { title: string, command: string };
	notAvailable?: boolean;
}

export function assertCompletion(completions: CompletionList, expected: ItemDescription, document: TextDocument) {
	let matches = completions.items.filter(completion => {
		return completion.label === expected.label;
	});
	if (expected.notAvailable) {
		assert.equal(matches.length, 0, `${expected.label} should not existing is results`);
		return;
	}

	assert.equal(matches.length, 1, `${expected.label} should only existing once: Actual: ${completions.items.map(c => c.label).join(', ')}`);
	let match = matches[0];
	if (expected.documentation) {
		assert.equal(match.documentation, expected.documentation);
	}
	if (expected.kind) {
		assert.equal(match.kind, expected.kind);
	}
	if (expected.resultText && match.textEdit) {
		const edit = TextEdit.is(match.textEdit) ? match.textEdit : TextEdit.replace(match.textEdit.replace, match.textEdit.newText);
		assert.equal(TextDocument.applyEdits(document, [edit]), expected.resultText);
	}
	if (expected.command) {
		assert.deepEqual(match.command, expected.command);
	}
}

const testUri = 'test://test/test.html';

export async function testCompletionFor(value: string, expected: { count?: number, items?: ItemDescription[] }, uri = testUri, workspaceFolders?: WorkspaceFolder[]): Promise<void> {
	let offset = value.indexOf('|');
	value = value.substr(0, offset) + value.substr(offset + 1);

	let workspace = {
		settings: {},
		folders: workspaceFolders || [{ name: 'x', uri: uri.substr(0, uri.lastIndexOf('/')) }]
	};

	let document = TextDocument.create(uri, 'html', 0, value);
	let position = document.positionAt(offset);
	const context = getDocumentContext(uri, workspace.folders);

	const languageModes = getLanguageModes({ css: true, javascript: true }, workspace, ClientCapabilities.LATEST, getNodeFSRequestService());
	const mode = languageModes.getModeAtPosition(document, position)!;

	let list = await mode.doComplete!(document, position, context);

	if (expected.count) {
		assert.equal(list.items.length, expected.count);
	}
	if (expected.items) {
		for (let item of expected.items) {
			assertCompletion(list, item, document);
		}
	}
}

suite('HTML Completion', () => {
	test('HTML JavaScript Completions', async () => {
		await testCompletionFor('<html><script>window.|</script></html>', {
			items: [
				{ label: 'location', resultText: '<html><script>window.location</script></html>' },
			]
		});
		await testCompletionFor('<html><script>$.|</script></html>', {
			items: [
				{ label: 'getJSON', resultText: '<html><script>$.getJSON</script></html>' },
			]
		});
		await testCompletionFor('<html><script>const x = { a: 1 };</script><script>x.|</script></html>', {
			items: [
				{ label: 'a', resultText: '<html><script>const x = { a: 1 };</script><script>x.a</script></html>' },
			]
		}, 'test://test/test2.html');
	});
});

suite('HTML Path Completion', () => {
	const triggerSuggestCommand = {
		title: 'Suggest',
		command: 'editor.action.triggerSuggest'
	};

	const fixtureRoot = path.resolve(__dirname, '../../src/test/pathCompletionFixtures');
	const fixtureWorkspace = { name: 'fixture', uri: URI.file(fixtureRoot).toString() };
	const indexHtmlUri = URI.file(path.resolve(fixtureRoot, 'index.html')).toString();
	const aboutHtmlUri = URI.file(path.resolve(fixtureRoot, 'about/about.html')).toString();

	test('Basics - Correct label/kind/result/command', async () => {
		await testCompletionFor('<script src="./|">', {
			items: [
				{ label: 'about/', kind: CompletionItemKind.Folder, resultText: '<script src="./about/">', command: triggerSuggestCommand },
				{ label: 'index.html', kind: CompletionItemKind.File, resultText: '<script src="./index.html">' },
				{ label: 'src/', kind: CompletionItemKind.Folder, resultText: '<script src="./src/">', command: triggerSuggestCommand }
			]
		}, indexHtmlUri);
	});

	test('Basics - Single Quote', async () => {
		await testCompletionFor(`<script src='./|'>`, {
			items: [
				{ label: 'about/', kind: CompletionItemKind.Folder, resultText: `<script src='./about/'>`, command: triggerSuggestCommand },
				{ label: 'index.html', kind: CompletionItemKind.File, resultText: `<script src='./index.html'>` },
				{ label: 'src/', kind: CompletionItemKind.Folder, resultText: `<script src='./src/'>`, command: triggerSuggestCommand }
			]
		}, indexHtmlUri);
	});

	test('No completion for remote paths', async () => {
		await testCompletionFor('<script src="http:">', { items: [] });
		await testCompletionFor('<script src="http:/|">', { items: [] });
		await testCompletionFor('<script src="http://|">', { items: [] });
		await testCompletionFor('<script src="https:|">', { items: [] });
		await testCompletionFor('<script src="https:/|">', { items: [] });
		await testCompletionFor('<script src="https://|">', { items: [] });
		await testCompletionFor('<script src="//|">', { items: [] });
	});

	test('Relative Path', async () => {
		await testCompletionFor('<script src="../|">', {
			items: [
				{ label: 'about/', resultText: '<script src="../about/">' },
				{ label: 'index.html', resultText: '<script src="../index.html">' },
				{ label: 'src/', resultText: '<script src="../src/">' }
			]
		}, aboutHtmlUri);

		await testCompletionFor('<script src="../src/|">', {
			items: [
				{ label: 'feature.js', resultText: '<script src="../src/feature.js">' },
				{ label: 'test.js', resultText: '<script src="../src/test.js">' },
			]
		}, aboutHtmlUri);
	});

	test('Absolute Path', async () => {
		await testCompletionFor('<script src="/|">', {
			items: [
				{ label: 'about/', resultText: '<script src="/about/">' },
				{ label: 'index.html', resultText: '<script src="/index.html">' },
				{ label: 'src/', resultText: '<script src="/src/">' },
			]
		}, indexHtmlUri);

		await testCompletionFor('<script src="/src/|">', {
			items: [
				{ label: 'feature.js', resultText: '<script src="/src/feature.js">' },
				{ label: 'test.js', resultText: '<script src="/src/test.js">' },
			]
		}, aboutHtmlUri, [fixtureWorkspace]);
	});

	test('Empty Path Value', async () => {
		// document: index.html
		await testCompletionFor('<script src="|">', {
			items: [
				{ label: 'about/', resultText: '<script src="about/">' },
				{ label: 'index.html', resultText: '<script src="index.html">' },
				{ label: 'src/', resultText: '<script src="src/">' },
			]
		}, indexHtmlUri);
		// document: about.html
		await testCompletionFor('<script src="|">', {
			items: [
				{ label: 'about.css', resultText: '<script src="about.css">' },
				{ label: 'about.html', resultText: '<script src="about.html">' },
				{ label: 'media/', resultText: '<script src="media/">' },
			]
		}, aboutHtmlUri);
	});
	test('Incomplete Path', async () => {
		await testCompletionFor('<script src="/src/f|">', {
			items: [
				{ label: 'feature.js', resultText: '<script src="/src/feature.js">' },
				{ label: 'test.js', resultText: '<script src="/src/test.js">' },
			]
		}, aboutHtmlUri, [fixtureWorkspace]);

		await testCompletionFor('<script src="../src/f|">', {
			items: [
				{ label: 'feature.js', resultText: '<script src="../src/feature.js">' },
				{ label: 'test.js', resultText: '<script src="../src/test.js">' },
			]
		}, aboutHtmlUri, [fixtureWorkspace]);
	});

	test('No leading dot or slash', async () => {
		// document: index.html
		await testCompletionFor('<script src="s|">', {
			items: [
				{ label: 'about/', resultText: '<script src="about/">' },
				{ label: 'index.html', resultText: '<script src="index.html">' },
				{ label: 'src/', resultText: '<script src="src/">' },
			]
		}, indexHtmlUri, [fixtureWorkspace]);

		await testCompletionFor('<script src="src/|">', {
			items: [
				{ label: 'feature.js', resultText: '<script src="src/feature.js">' },
				{ label: 'test.js', resultText: '<script src="src/test.js">' },
			]
		}, indexHtmlUri, [fixtureWorkspace]);

		await testCompletionFor('<script src="src/f|">', {
			items: [
				{ label: 'feature.js', resultText: '<script src="src/feature.js">' },
				{ label: 'test.js', resultText: '<script src="src/test.js">' },
			]
		}, indexHtmlUri, [fixtureWorkspace]);

		// document: about.html
		await testCompletionFor('<script src="s|">', {
			items: [
				{ label: 'about.css', resultText: '<script src="about.css">' },
				{ label: 'about.html', resultText: '<script src="about.html">' },
				{ label: 'media/', resultText: '<script src="media/">' },
			]
		}, aboutHtmlUri, [fixtureWorkspace]);

		await testCompletionFor('<script src="media/|">', {
			items: [
				{ label: 'icon.pic', resultText: '<script src="media/icon.pic">' }
			]
		}, aboutHtmlUri, [fixtureWorkspace]);

		await testCompletionFor('<script src="media/f|">', {
			items: [
				{ label: 'icon.pic', resultText: '<script src="media/icon.pic">' }
			]
		}, aboutHtmlUri, [fixtureWorkspace]);
	});

	test('Trigger completion in middle of path', async () => {
		// document: index.html
		await testCompletionFor('<script src="src/f|eature.js">', {
			items: [
				{ label: 'feature.js', resultText: '<script src="src/feature.js">' },
				{ label: 'test.js', resultText: '<script src="src/test.js">' },
			]
		}, indexHtmlUri, [fixtureWorkspace]);

		await testCompletionFor('<script src="s|rc/feature.js">', {
			items: [
				{ label: 'about/', resultText: '<script src="about/">' },
				{ label: 'index.html', resultText: '<script src="index.html">' },
				{ label: 'src/', resultText: '<script src="src/">' },
			]
		}, indexHtmlUri, [fixtureWorkspace]);

		// document: about.html
		await testCompletionFor('<script src="media/f|eature.js">', {
			items: [
				{ label: 'icon.pic', resultText: '<script src="media/icon.pic">' }
			]
		}, aboutHtmlUri, [fixtureWorkspace]);

		await testCompletionFor('<script src="m|edia/feature.js">', {
			items: [
				{ label: 'about.css', resultText: '<script src="about.css">' },
				{ label: 'about.html', resultText: '<script src="about.html">' },
				{ label: 'media/', resultText: '<script src="media/">' },
			]
		}, aboutHtmlUri, [fixtureWorkspace]);
	});


	test('Trigger completion in middle of path and with whitespaces', async () => {
		await testCompletionFor('<script src="./| about/about.html>', {
			items: [
				{ label: 'about/', resultText: '<script src="./about/ about/about.html>' },
				{ label: 'index.html', resultText: '<script src="./index.html about/about.html>' },
				{ label: 'src/', resultText: '<script src="./src/ about/about.html>' },
			]
		}, indexHtmlUri, [fixtureWorkspace]);

		await testCompletionFor('<script src="./a|bout /about.html>', {
			items: [
				{ label: 'about/', resultText: '<script src="./about/ /about.html>' },
				{ label: 'index.html', resultText: '<script src="./index.html /about.html>' },
				{ label: 'src/', resultText: '<script src="./src/ /about.html>' },
			]
		}, indexHtmlUri, [fixtureWorkspace]);
	});

	test('Completion should ignore files/folders starting with dot', async () => {
		await testCompletionFor('<script src="./|"', {
			count: 3
		}, indexHtmlUri, [fixtureWorkspace]);
	});

	test('Unquoted Path', async () => {
		/* Unquoted value is not supported in html language service yet
		testCompletionFor(`<div><a href=about/|>`, {
			items: [
				{ label: 'about.html', resultText: `<div><a href=about/about.html>` }
			]
		}, testUri);
		*/
	});
});
