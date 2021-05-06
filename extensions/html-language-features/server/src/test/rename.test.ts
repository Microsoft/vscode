/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { WorkspaceEdit, TextDocument, getLanguageModes, ClientCapabilities } from '../modes/languageModes';
import { getNodeFSRequestService } from '../node/nodeFs';


async function testRename(value: string, newName: string, expectedDocContent: string): Promise<void> {
	const offset = value.indexOf('|');
	value = value.substr(0, offset) + value.substr(offset + 1);

	const document = TextDocument.create('test://test/test.html', 'html', 0, value);
	const workspace = {
		settings: {},
		folders: [{ name: 'foo', uri: 'test://foo' }]
	};
	const languageModes = getLanguageModes({ css: true, javascript: true }, workspace, ClientCapabilities.LATEST, getNodeFSRequestService());
	const javascriptMode = languageModes.getMode('javascript')
	const position = document.positionAt(offset);

	if (javascriptMode) {
		const workspaceEdit: WorkspaceEdit | null = await javascriptMode.doRename!(document, position, newName);

		if (!workspaceEdit || !workspaceEdit.changes) {
			assert.fail('No workspace edits');
		}

		const edits = workspaceEdit.changes[document.uri.toString()];
		if (!edits) {
			assert.fail(`No edits for file at ${document.uri.toString()}`);
		}

		const newDocContent = TextDocument.applyEdits(document, edits);
		assert.strictEqual(newDocContent, expectedDocContent, `Expected: ${expectedDocContent}\nActual: ${newDocContent}`);
	} else {
		assert.fail('should have javascriptMode but no')
	}
}

async function testNoRename(value: string, newName: string): Promise<void> {
	const offset = value.indexOf('|');
	value = value.substr(0, offset) + value.substr(offset + 1);

	const document = TextDocument.create('test://test/test.html', 'html', 0, value);
	const workspace = {
		settings: {},
		folders: [{ name: 'foo', uri: 'test://foo' }]
	};
	const languageModes = getLanguageModes({ css: true, javascript: true }, workspace, ClientCapabilities.LATEST, getNodeFSRequestService());
	const javascriptMode = languageModes.getMode('javascript')
	const position = document.positionAt(offset);

	if (javascriptMode) {
		const workspaceEdit: WorkspaceEdit | null = await javascriptMode.doRename!(document, position, newName);

		assert.ok(workspaceEdit?.changes === undefined, 'Should not rename but rename happened')
	} else {
		assert.fail('should have javascriptMode but no')
	}
}

suite('HTML Javascript Rename', () => {
	test('Rename Variable', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			'const |a = 2;',
			'const b = a + 2',
			'</script>',
			'</head>',
			'</html>'
		]

		const output = [
			'<html>',
			'<head>',
			'<script>',
			'const h = 2;',
			'const b = h + 2',
			'</script>',
			'</head>',
			'</html>'
		]

		await testRename(input.join('\n'), 'h', output.join('\n'))
	})

	test('Rename Function', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			`const name = 'cjg';`,
			'function |sayHello(name) {',
			`console.log('hello', name)`,
			'}',
			'sayHello(name)',
			'</script>',
			'</head>',
			'</html>'
		]

		const output = [
			'<html>',
			'<head>',
			'<script>',
			`const name = 'cjg';`,
			'function sayName(name) {',
			`console.log('hello', name)`,
			'}',
			'sayName(name)',
			'</script>',
			'</head>',
			'</html>'
		]

		await testRename(input.join('\n'), 'sayName', output.join('\n'))
	})

	test('Rename Function Params', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			`const name = 'cjg';`,
			'function sayHello(|name) {',
			`console.log('hello', name)`,
			'}',
			'sayHello(name)',
			'</script>',
			'</head>',
			'</html>'
		]

		const output = [
			'<html>',
			'<head>',
			'<script>',
			`const name = 'cjg';`,
			'function sayHello(newName) {',
			`console.log('hello', newName)`,
			'}',
			'sayHello(name)',
			'</script>',
			'</head>',
			'</html>'
		]

		await testRename(input.join('\n'), 'newName', output.join('\n'))
	})

	test('Rename Class', async () => {
		const input = [
			'<html>',
			'<head>',
			'<script>',
			`class |Foo {}`,
			`const foo = new Foo()`,
			'</script>',
			'</head>',
			'</html>'
		]

		const output = [
			'<html>',
			'<head>',
			'<script>',
			`class Bar {}`,
			`const foo = new Bar()`,
			'</script>',
			'</head>',
			'</html>'
		]

		await testRename(input.join('\n'), 'Bar', output.join('\n'))
	})

	test('Cannot Rename literal', async () => {
		const stringLiteralInput = [
			'<html>',
			'<head>',
			'<script>',
			`const name = |'cjg';`,
			'</script>',
			'</head>',
			'</html>'
		]
		const numberLiteralInput = [
			'<html>',
			'<head>',
			'<script>',
			`const num = |2;`,
			'</script>',
			'</head>',
			'</html>'
		]

		await testNoRename(stringLiteralInput.join('\n'), 'something')
		await testNoRename(numberLiteralInput.join('\n'), 'hhhh')
	})
});
