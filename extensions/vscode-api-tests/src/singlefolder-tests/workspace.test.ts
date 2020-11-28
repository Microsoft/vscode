/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';
import { createRandomFile, deleteFile, closeAllEditors, pathEquals, rndName, disposeAll, testFs, delay, withLogDisabled, revertAllDirty } from '../utils';
import { join, posix, basename } from 'path';
import * as fs from 'fs';
import { TestFS } from '../memfs';

suite('vscode API - workspace', () => {

	teardown(closeAllEditors);

	test('MarkdownString', function () {
		let md = new vscode.MarkdownString();
		assert.equal(md.value, '');
		assert.equal(md.isTrusted, undefined);

		md = new vscode.MarkdownString('**bold**');
		assert.equal(md.value, '**bold**');

		md.appendText('**bold?**');
		assert.equal(md.value, '**bold**\\*\\*bold?\\*\\*');

		md.appendMarkdown('**bold**');
		assert.equal(md.value, '**bold**\\*\\*bold?\\*\\***bold**');
	});


	test('textDocuments', () => {
		assert.ok(Array.isArray(vscode.workspace.textDocuments));
		assert.throws(() => (<any>vscode.workspace).textDocuments = null);
	});

	test('rootPath', () => {
		assert.ok(pathEquals(vscode.workspace.rootPath!, join(__dirname, '../../testWorkspace')));
		assert.throws(() => (vscode.workspace as any).rootPath = 'farboo');
	});

	test('workspaceFile', () => {
		assert.ok(!vscode.workspace.workspaceFile);
	});

	test('workspaceFolders', () => {
		if (vscode.workspace.workspaceFolders) {
			assert.equal(vscode.workspace.workspaceFolders.length, 1);
			assert.ok(pathEquals(vscode.workspace.workspaceFolders[0].uri.fsPath, join(__dirname, '../../testWorkspace')));
		}
	});

	test('getWorkspaceFolder', () => {
		const folder = vscode.workspace.getWorkspaceFolder(vscode.Uri.file(join(__dirname, '../../testWorkspace/far.js')));
		assert.ok(!!folder);

		if (folder) {
			assert.ok(pathEquals(folder.uri.fsPath, join(__dirname, '../../testWorkspace')));
		}
	});

	test('openTextDocument', async () => {
		const uri = await createRandomFile();

		// not yet there
		const existing1 = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
		assert.equal(existing1, undefined);

		// open and assert its there
		const doc = await vscode.workspace.openTextDocument(uri);
		assert.ok(doc);
		assert.equal(doc.uri.toString(), uri.toString());
		const existing2 = vscode.workspace.textDocuments.find(doc => doc.uri.toString() === uri.toString());
		assert.equal(existing2 === doc, true);
	});

	test('openTextDocument, illegal path', () => {
		return vscode.workspace.openTextDocument('funkydonky.txt').then(_doc => {
			throw new Error('missing error');
		}, _err => {
			// good!
		});
	});

	test('openTextDocument, untitled is dirty', async function () {
		return vscode.workspace.openTextDocument(vscode.workspace.workspaceFolders![0].uri.with({ scheme: 'untitled', path: posix.join(vscode.workspace.workspaceFolders![0].uri.path, 'newfile.txt') })).then(doc => {
			assert.equal(doc.uri.scheme, 'untitled');
			assert.ok(doc.isDirty);
		});
	});

	test('openTextDocument, untitled with host', function () {
		const uri = vscode.Uri.parse('untitled://localhost/c%24/Users/jrieken/code/samples/foobar.txt');
		return vscode.workspace.openTextDocument(uri).then(doc => {
			assert.equal(doc.uri.scheme, 'untitled');
		});
	});

	test('openTextDocument, untitled without path', function () {
		return vscode.workspace.openTextDocument().then(doc => {
			assert.equal(doc.uri.scheme, 'untitled');
			assert.ok(doc.isDirty);
		});
	});

	test('openTextDocument, untitled without path but language ID', function () {
		return vscode.workspace.openTextDocument({ language: 'xml' }).then(doc => {
			assert.equal(doc.uri.scheme, 'untitled');
			assert.equal(doc.languageId, 'xml');
			assert.ok(doc.isDirty);
		});
	});

	test('openTextDocument, untitled without path but language ID and content', function () {
		return vscode.workspace.openTextDocument({ language: 'html', content: '<h1>Hello world!</h1>' }).then(doc => {
			assert.equal(doc.uri.scheme, 'untitled');
			assert.equal(doc.languageId, 'html');
			assert.ok(doc.isDirty);
			assert.equal(doc.getText(), '<h1>Hello world!</h1>');
		});
	});

	test('openTextDocument, untitled closes on save', function () {
		const path = join(vscode.workspace.rootPath || '', './newfile.txt');

		return vscode.workspace.openTextDocument(vscode.Uri.parse('untitled:' + path)).then(doc => {
			assert.equal(doc.uri.scheme, 'untitled');
			assert.ok(doc.isDirty);

			let closed: vscode.TextDocument;
			let d0 = vscode.workspace.onDidCloseTextDocument(e => closed = e);

			return vscode.window.showTextDocument(doc).then(() => {
				return doc.save().then(() => {
					assert.ok(closed === doc);
					assert.ok(!doc.isDirty);
					assert.ok(fs.existsSync(path));

					d0.dispose();
					fs.unlinkSync(join(vscode.workspace.rootPath || '', './newfile.txt'));
				});
			});

		});
	});

	test('openTextDocument, uri scheme/auth/path', function () {

		let registration = vscode.workspace.registerTextDocumentContentProvider('sc', {
			provideTextDocumentContent() {
				return 'SC';
			}
		});

		return Promise.all([
			vscode.workspace.openTextDocument(vscode.Uri.parse('sc://auth')).then(doc => {
				assert.equal(doc.uri.authority, 'auth');
				assert.equal(doc.uri.path, '');
			}),
			vscode.workspace.openTextDocument(vscode.Uri.parse('sc:///path')).then(doc => {
				assert.equal(doc.uri.authority, '');
				assert.equal(doc.uri.path, '/path');
			}),
			vscode.workspace.openTextDocument(vscode.Uri.parse('sc://auth/path')).then(doc => {
				assert.equal(doc.uri.authority, 'auth');
				assert.equal(doc.uri.path, '/path');
			})
		]).then(() => {
			registration.dispose();
		});
	});

	test('openTextDocument, actual casing first', async function () {

		const fs = new TestFS('this-fs', false);
		const reg = vscode.workspace.registerFileSystemProvider(fs.scheme, fs, { isCaseSensitive: fs.isCaseSensitive });

		let uriOne = vscode.Uri.parse('this-fs:/one');
		let uriTwo = vscode.Uri.parse('this-fs:/two');
		let uriONE = vscode.Uri.parse('this-fs:/ONE'); // same resource, different uri
		let uriTWO = vscode.Uri.parse('this-fs:/TWO');

		fs.writeFile(uriOne, Buffer.from('one'), { create: true, overwrite: true });
		fs.writeFile(uriTwo, Buffer.from('two'), { create: true, overwrite: true });

		// lower case (actual case) comes first
		let docOne = await vscode.workspace.openTextDocument(uriOne);
		assert.equal(docOne.uri.toString(), uriOne.toString());

		let docONE = await vscode.workspace.openTextDocument(uriONE);
		assert.equal(docONE === docOne, true);
		assert.equal(docONE.uri.toString(), uriOne.toString());
		assert.equal(docONE.uri.toString() !== uriONE.toString(), true); // yep

		// upper case (NOT the actual case) comes first
		let docTWO = await vscode.workspace.openTextDocument(uriTWO);
		assert.equal(docTWO.uri.toString(), uriTWO.toString());

		let docTwo = await vscode.workspace.openTextDocument(uriTwo);
		assert.equal(docTWO === docTwo, true);
		assert.equal(docTwo.uri.toString(), uriTWO.toString());
		assert.equal(docTwo.uri.toString() !== uriTwo.toString(), true); // yep

		reg.dispose();
	});

	test('eol, read', () => {
		const a = createRandomFile('foo\nbar\nbar').then(file => {
			return vscode.workspace.openTextDocument(file).then(doc => {
				assert.equal(doc.eol, vscode.EndOfLine.LF);
			});
		});
		const b = createRandomFile('foo\nbar\nbar\r\nbaz').then(file => {
			return vscode.workspace.openTextDocument(file).then(doc => {
				assert.equal(doc.eol, vscode.EndOfLine.LF);
			});
		});
		const c = createRandomFile('foo\r\nbar\r\nbar').then(file => {
			return vscode.workspace.openTextDocument(file).then(doc => {
				assert.equal(doc.eol, vscode.EndOfLine.CRLF);
			});
		});
		return Promise.all([a, b, c]);
	});

	test('eol, change via editor', () => {
		return createRandomFile('foo\nbar\nbar').then(file => {
			return vscode.workspace.openTextDocument(file).then(doc => {
				assert.equal(doc.eol, vscode.EndOfLine.LF);
				return vscode.window.showTextDocument(doc).then(editor => {
					return editor.edit(builder => builder.setEndOfLine(vscode.EndOfLine.CRLF));

				}).then(value => {
					assert.ok(value);
					assert.ok(doc.isDirty);
					assert.equal(doc.eol, vscode.EndOfLine.CRLF);
				});
			});
		});
	});

	test('eol, change via applyEdit', () => {
		return createRandomFile('foo\nbar\nbar').then(file => {
			return vscode.workspace.openTextDocument(file).then(doc => {
				assert.equal(doc.eol, vscode.EndOfLine.LF);

				const edit = new vscode.WorkspaceEdit();
				edit.set(file, [vscode.TextEdit.setEndOfLine(vscode.EndOfLine.CRLF)]);
				return vscode.workspace.applyEdit(edit).then(value => {
					assert.ok(value);
					assert.ok(doc.isDirty);
					assert.equal(doc.eol, vscode.EndOfLine.CRLF);
				});
			});
		});
	});

	test('eol, change via onWillSave', async function () {
		let called = false;
		let sub = vscode.workspace.onWillSaveTextDocument(e => {
			called = true;
			e.waitUntil(Promise.resolve([vscode.TextEdit.setEndOfLine(vscode.EndOfLine.LF)]));
		});

		const file = await createRandomFile('foo\r\nbar\r\nbar');
		const doc = await vscode.workspace.openTextDocument(file);
		assert.equal(doc.eol, vscode.EndOfLine.CRLF);

		const edit = new vscode.WorkspaceEdit();
		edit.set(file, [vscode.TextEdit.insert(new vscode.Position(0, 0), '-changes-')]);
		const successEdit = await vscode.workspace.applyEdit(edit);
		assert.ok(successEdit);

		const successSave = await doc.save();
		assert.ok(successSave);
		assert.ok(called);
		assert.ok(!doc.isDirty);
		assert.equal(doc.eol, vscode.EndOfLine.LF);
		sub.dispose();
	});

	function assertEqualPath(a: string, b: string): void {
		assert.ok(pathEquals(a, b), `${a} <-> ${b}`);
	}

	test('events: onDidOpenTextDocument, onDidChangeTextDocument, onDidSaveTextDocument', async () => {
		const file = await createRandomFile();
		let disposables: vscode.Disposable[] = [];

		await revertAllDirty(); // needed for a clean state for `onDidSaveTextDocument` (#102365)

		let pendingAsserts: Function[] = [];
		let onDidOpenTextDocument = false;
		disposables.push(vscode.workspace.onDidOpenTextDocument(e => {
			pendingAsserts.push(() => assertEqualPath(e.uri.fsPath, file.fsPath));
			onDidOpenTextDocument = true;
		}));

		let onDidChangeTextDocument = false;
		disposables.push(vscode.workspace.onDidChangeTextDocument(e => {
			pendingAsserts.push(() => assertEqualPath(e.document.uri.fsPath, file.fsPath));
			onDidChangeTextDocument = true;
		}));

		let onDidSaveTextDocument = false;
		disposables.push(vscode.workspace.onDidSaveTextDocument(e => {
			pendingAsserts.push(() => assertEqualPath(e.uri.fsPath, file.fsPath));
			onDidSaveTextDocument = true;
		}));

		const doc = await vscode.workspace.openTextDocument(file);
		const editor = await vscode.window.showTextDocument(doc);

		await editor.edit((builder) => {
			builder.insert(new vscode.Position(0, 0), 'Hello World');
		});
		await doc.save();

		assert.ok(onDidOpenTextDocument);
		assert.ok(onDidChangeTextDocument);
		assert.ok(onDidSaveTextDocument);
		pendingAsserts.forEach(assert => assert());
		disposeAll(disposables);
		return deleteFile(file);
	});

	test('events: onDidSaveTextDocument fires even for non dirty file when saved', async () => {
		const file = await createRandomFile();
		let disposables: vscode.Disposable[] = [];
		let pendingAsserts: Function[] = [];

		await revertAllDirty(); // needed for a clean state for `onDidSaveTextDocument` (#102365)

		let onDidSaveTextDocument = false;
		disposables.push(vscode.workspace.onDidSaveTextDocument(e => {
			pendingAsserts.push(() => assertEqualPath(e.uri.fsPath, file.fsPath));
			onDidSaveTextDocument = true;
		}));

		const doc = await vscode.workspace.openTextDocument(file);
		await vscode.window.showTextDocument(doc);
		await vscode.commands.executeCommand('workbench.action.files.save');

		assert.ok(onDidSaveTextDocument);
		pendingAsserts.forEach(fn => fn());
		disposeAll(disposables);
		return deleteFile(file);
	});

	test('openTextDocument, with selection', function () {
		return createRandomFile('foo\nbar\nbar').then(file => {
			return vscode.workspace.openTextDocument(file).then(doc => {
				return vscode.window.showTextDocument(doc, { selection: new vscode.Range(new vscode.Position(1, 1), new vscode.Position(1, 2)) }).then(editor => {
					assert.equal(editor.selection.start.line, 1);
					assert.equal(editor.selection.start.character, 1);
					assert.equal(editor.selection.end.line, 1);
					assert.equal(editor.selection.end.character, 2);
				});
			});
		});
	});

	test('registerTextDocumentContentProvider, simple', function () {

		let registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
			provideTextDocumentContent(uri) {
				return uri.toString();
			}
		});

		const uri = vscode.Uri.parse('foo://testing/virtual.js');
		return vscode.workspace.openTextDocument(uri).then(doc => {
			assert.equal(doc.getText(), uri.toString());
			assert.equal(doc.isDirty, false);
			assert.equal(doc.uri.toString(), uri.toString());
			registration.dispose();
		});
	});

	test('registerTextDocumentContentProvider, constrains', function () {

		// built-in
		assert.throws(function () {
			vscode.workspace.registerTextDocumentContentProvider('untitled', { provideTextDocumentContent() { return null; } });
		});
		// built-in
		assert.throws(function () {
			vscode.workspace.registerTextDocumentContentProvider('file', { provideTextDocumentContent() { return null; } });
		});

		// missing scheme
		return vscode.workspace.openTextDocument(vscode.Uri.parse('notThere://foo/far/boo/bar')).then(() => {
			assert.ok(false, 'expected failure');
		}, _err => {
			// expected
		});
	});

	test('registerTextDocumentContentProvider, multiple', function () {

		// duplicate registration
		let registration1 = vscode.workspace.registerTextDocumentContentProvider('foo', {
			provideTextDocumentContent(uri) {
				if (uri.authority === 'foo') {
					return '1';
				}
				return undefined;
			}
		});
		let registration2 = vscode.workspace.registerTextDocumentContentProvider('foo', {
			provideTextDocumentContent(uri) {
				if (uri.authority === 'bar') {
					return '2';
				}
				return undefined;
			}
		});

		return Promise.all([
			vscode.workspace.openTextDocument(vscode.Uri.parse('foo://foo/bla')).then(doc => { assert.equal(doc.getText(), '1'); }),
			vscode.workspace.openTextDocument(vscode.Uri.parse('foo://bar/bla')).then(doc => { assert.equal(doc.getText(), '2'); })
		]).then(() => {
			registration1.dispose();
			registration2.dispose();
		});
	});

	test('registerTextDocumentContentProvider, evil provider', function () {

		// duplicate registration
		let registration1 = vscode.workspace.registerTextDocumentContentProvider('foo', {
			provideTextDocumentContent(_uri) {
				return '1';
			}
		});
		let registration2 = vscode.workspace.registerTextDocumentContentProvider('foo', {
			provideTextDocumentContent(_uri): string {
				throw new Error('fail');
			}
		});

		return vscode.workspace.openTextDocument(vscode.Uri.parse('foo://foo/bla')).then(doc => {
			assert.equal(doc.getText(), '1');
			registration1.dispose();
			registration2.dispose();
		});
	});

	test('registerTextDocumentContentProvider, invalid text', function () {

		let registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
			provideTextDocumentContent(_uri) {
				return <any>123;
			}
		});
		return vscode.workspace.openTextDocument(vscode.Uri.parse('foo://auth/path')).then(() => {
			assert.ok(false, 'expected failure');
		}, _err => {
			// expected
			registration.dispose();
		});
	});

	test('registerTextDocumentContentProvider, show virtual document', function () {

		let registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
			provideTextDocumentContent(_uri) {
				return 'I am virtual';
			}
		});

		return vscode.workspace.openTextDocument(vscode.Uri.parse('foo://something/path')).then(doc => {
			return vscode.window.showTextDocument(doc).then(editor => {

				assert.ok(editor.document === doc);
				assert.equal(editor.document.getText(), 'I am virtual');
				registration.dispose();
			});
		});
	});

	test('registerTextDocumentContentProvider, open/open document', function () {

		let callCount = 0;
		let registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
			provideTextDocumentContent(_uri) {
				callCount += 1;
				return 'I am virtual';
			}
		});

		const uri = vscode.Uri.parse('foo://testing/path');

		return Promise.all([vscode.workspace.openTextDocument(uri), vscode.workspace.openTextDocument(uri)]).then(docs => {
			let [first, second] = docs;
			assert.ok(first === second);
			assert.ok(vscode.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString()));
			assert.equal(callCount, 1);
			registration.dispose();
		});
	});

	test('registerTextDocumentContentProvider, empty doc', function () {

		let registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
			provideTextDocumentContent(_uri) {
				return '';
			}
		});

		const uri = vscode.Uri.parse('foo:doc/empty');

		return vscode.workspace.openTextDocument(uri).then(doc => {
			assert.equal(doc.getText(), '');
			assert.equal(doc.uri.toString(), uri.toString());
			registration.dispose();
		});
	});

	test('registerTextDocumentContentProvider, change event', async function () {

		let callCount = 0;
		let emitter = new vscode.EventEmitter<vscode.Uri>();

		let registration = vscode.workspace.registerTextDocumentContentProvider('foo', {
			onDidChange: emitter.event,
			provideTextDocumentContent(_uri) {
				return 'call' + (callCount++);
			}
		});

		const uri = vscode.Uri.parse('foo://testing/path3');
		const doc = await vscode.workspace.openTextDocument(uri);

		assert.equal(callCount, 1);
		assert.equal(doc.getText(), 'call0');

		return new Promise<void>(resolve => {

			let subscription = vscode.workspace.onDidChangeTextDocument(event => {
				assert.ok(event.document === doc);
				assert.equal(event.document.getText(), 'call1');
				subscription.dispose();
				registration.dispose();
				resolve();
			});

			emitter.fire(doc.uri);
		});
	});

	test('findFiles', () => {
		return vscode.workspace.findFiles('**/image.png').then((res) => {
			assert.equal(res.length, 2);
			assert.equal(basename(vscode.workspace.asRelativePath(res[0])), 'image.png');
		});
	});

	test('findFiles - null exclude', async () => {
		await vscode.workspace.findFiles('**/file.txt').then((res) => {
			// search.exclude folder is still searched, files.exclude folder is not
			assert.equal(res.length, 1);
			assert.equal(basename(vscode.workspace.asRelativePath(res[0])), 'file.txt');
		});

		await vscode.workspace.findFiles('**/file.txt', null).then((res) => {
			// search.exclude and files.exclude folders are both searched
			assert.equal(res.length, 2);
			assert.equal(basename(vscode.workspace.asRelativePath(res[0])), 'file.txt');
		});
	});

	test('findFiles - exclude', () => {
		return vscode.workspace.findFiles('**/image.png').then((res) => {
			assert.equal(res.length, 2);
			assert.equal(basename(vscode.workspace.asRelativePath(res[0])), 'image.png');
		});
	});

	test('findFiles, exclude', () => {
		return vscode.workspace.findFiles('**/image.png', '**/sub/**').then((res) => {
			assert.equal(res.length, 1);
			assert.equal(basename(vscode.workspace.asRelativePath(res[0])), 'image.png');
		});
	});

	test('findFiles, cancellation', () => {

		const source = new vscode.CancellationTokenSource();
		const token = source.token; // just to get an instance first
		source.cancel();

		return vscode.workspace.findFiles('*.js', null, 100, token).then((res) => {
			assert.deepEqual(res, []);
		});
	});

	test('findTextInFiles', async () => {
		const options: vscode.FindTextInFilesOptions = {
			include: '*.ts',
			previewOptions: {
				matchLines: 1,
				charsPerLine: 100
			}
		};

		const results: vscode.TextSearchResult[] = [];
		await vscode.workspace.findTextInFiles({ pattern: 'foo' }, options, result => {
			results.push(result);
		});

		assert.equal(results.length, 1);
		const match = <vscode.TextSearchMatch>results[0];
		assert(match.preview.text.indexOf('foo') >= 0);
		assert.equal(vscode.workspace.asRelativePath(match.uri), '10linefile.ts');
	});

	test('findTextInFiles, cancellation', async () => {
		const results: vscode.TextSearchResult[] = [];
		const cancellation = new vscode.CancellationTokenSource();
		cancellation.cancel();

		await vscode.workspace.findTextInFiles({ pattern: 'foo' }, result => {
			results.push(result);
		}, cancellation.token);
	});

	test('applyEdit', async () => {
		const doc = await vscode.workspace.openTextDocument(vscode.Uri.parse('untitled:' + join(vscode.workspace.rootPath || '', './new2.txt')));

		let edit = new vscode.WorkspaceEdit();
		edit.insert(doc.uri, new vscode.Position(0, 0), new Array(1000).join('Hello World'));

		let success = await vscode.workspace.applyEdit(edit);
		assert.equal(success, true);
		assert.equal(doc.isDirty, true);
	});

	test('applyEdit should fail when editing deleted resource', withLogDisabled(async () => {
		const resource = await createRandomFile();

		const edit = new vscode.WorkspaceEdit();
		edit.deleteFile(resource);
		edit.insert(resource, new vscode.Position(0, 0), '');

		let success = await vscode.workspace.applyEdit(edit);
		assert.equal(success, false);
	}));

	test('applyEdit should fail when renaming deleted resource', withLogDisabled(async () => {
		const resource = await createRandomFile();

		const edit = new vscode.WorkspaceEdit();
		edit.deleteFile(resource);
		edit.renameFile(resource, resource);

		let success = await vscode.workspace.applyEdit(edit);
		assert.equal(success, false);
	}));

	test('applyEdit should fail when editing renamed from resource', withLogDisabled(async () => {
		const resource = await createRandomFile();
		const newResource = vscode.Uri.file(resource.fsPath + '.1');
		const edit = new vscode.WorkspaceEdit();
		edit.renameFile(resource, newResource);
		edit.insert(resource, new vscode.Position(0, 0), '');

		let success = await vscode.workspace.applyEdit(edit);
		assert.equal(success, false);
	}));

	test('applyEdit "edit A -> rename A to B -> edit B"', async () => {
		await testEditRenameEdit(oldUri => oldUri.with({ path: oldUri.path + 'NEW' }));
	});

	test('applyEdit "edit A -> rename A to B (different case)" -> edit B', async () => {
		await testEditRenameEdit(oldUri => oldUri.with({ path: oldUri.path.toUpperCase() }));
	});

	test('applyEdit "edit A -> rename A to B (same case)" -> edit B', async () => {
		await testEditRenameEdit(oldUri => oldUri);
	});

	async function testEditRenameEdit(newUriCreator: (oldUri: vscode.Uri) => vscode.Uri): Promise<void> {
		const oldUri = await createRandomFile();
		const newUri = newUriCreator(oldUri);
		const edit = new vscode.WorkspaceEdit();
		edit.insert(oldUri, new vscode.Position(0, 0), 'BEFORE');
		edit.renameFile(oldUri, newUri);
		edit.insert(newUri, new vscode.Position(0, 0), 'AFTER');

		assert.ok(await vscode.workspace.applyEdit(edit));

		let doc = await vscode.workspace.openTextDocument(newUri);
		assert.equal(doc.getText(), 'AFTERBEFORE');
		assert.equal(doc.isDirty, true);
	}

	function nameWithUnderscore(uri: vscode.Uri) {
		return uri.with({ path: posix.join(posix.dirname(uri.path), `_${posix.basename(uri.path)}`) });
	}

	test('WorkspaceEdit: applying edits before and after rename duplicates resource #42633', withLogDisabled(async function () {
		let docUri = await createRandomFile();
		let newUri = nameWithUnderscore(docUri);

		let we = new vscode.WorkspaceEdit();
		we.insert(docUri, new vscode.Position(0, 0), 'Hello');
		we.insert(docUri, new vscode.Position(0, 0), 'Foo');
		we.renameFile(docUri, newUri);
		we.insert(newUri, new vscode.Position(0, 0), 'Bar');

		assert.ok(await vscode.workspace.applyEdit(we));
		let doc = await vscode.workspace.openTextDocument(newUri);
		assert.equal(doc.getText(), 'BarHelloFoo');
	}));

	test('WorkspaceEdit: Problem recreating a renamed resource #42634', withLogDisabled(async function () {
		let docUri = await createRandomFile();
		let newUri = nameWithUnderscore(docUri);

		let we = new vscode.WorkspaceEdit();
		we.insert(docUri, new vscode.Position(0, 0), 'Hello');
		we.insert(docUri, new vscode.Position(0, 0), 'Foo');
		we.renameFile(docUri, newUri);

		we.createFile(docUri);
		we.insert(docUri, new vscode.Position(0, 0), 'Bar');

		assert.ok(await vscode.workspace.applyEdit(we));

		let newDoc = await vscode.workspace.openTextDocument(newUri);
		assert.equal(newDoc.getText(), 'HelloFoo');
		let doc = await vscode.workspace.openTextDocument(docUri);
		assert.equal(doc.getText(), 'Bar');
	}));

	test('WorkspaceEdit api - after saving a deleted file, it still shows up as deleted. #42667', withLogDisabled(async function () {
		let docUri = await createRandomFile();
		let we = new vscode.WorkspaceEdit();
		we.deleteFile(docUri);
		we.insert(docUri, new vscode.Position(0, 0), 'InsertText');

		assert.ok(!(await vscode.workspace.applyEdit(we)));
		try {
			await vscode.workspace.openTextDocument(docUri);
			assert.ok(false);
		} catch (e) {
			assert.ok(true);
		}
	}));

	test('WorkspaceEdit: edit and rename parent folder duplicates resource #42641', async function () {

		let dir = vscode.Uri.parse(`${testFs.scheme}:/before-${rndName()}`);
		await testFs.createDirectory(dir);

		let docUri = await createRandomFile('', dir);
		let docParent = docUri.with({ path: posix.dirname(docUri.path) });
		let newParent = nameWithUnderscore(docParent);

		let we = new vscode.WorkspaceEdit();
		we.insert(docUri, new vscode.Position(0, 0), 'Hello');
		we.renameFile(docParent, newParent);

		assert.ok(await vscode.workspace.applyEdit(we));

		try {
			await vscode.workspace.openTextDocument(docUri);
			assert.ok(false);
		} catch (e) {
			assert.ok(true);
		}

		let newUri = newParent.with({ path: posix.join(newParent.path, posix.basename(docUri.path)) });
		let doc = await vscode.workspace.openTextDocument(newUri);
		assert.ok(doc);

		assert.equal(doc.getText(), 'Hello');
	});

	test('WorkspaceEdit: rename resource followed by edit does not work #42638', withLogDisabled(async function () {
		let docUri = await createRandomFile();
		let newUri = nameWithUnderscore(docUri);

		let we = new vscode.WorkspaceEdit();
		we.renameFile(docUri, newUri);
		we.insert(newUri, new vscode.Position(0, 0), 'Hello');

		assert.ok(await vscode.workspace.applyEdit(we));

		let doc = await vscode.workspace.openTextDocument(newUri);
		assert.equal(doc.getText(), 'Hello');
	}));

	test('WorkspaceEdit: create & override', withLogDisabled(async function () {

		let docUri = await createRandomFile('before');

		let we = new vscode.WorkspaceEdit();
		we.createFile(docUri);
		assert.ok(!await vscode.workspace.applyEdit(we));
		assert.equal((await vscode.workspace.openTextDocument(docUri)).getText(), 'before');

		we = new vscode.WorkspaceEdit();
		we.createFile(docUri, { overwrite: true });
		assert.ok(await vscode.workspace.applyEdit(we));
		assert.equal((await vscode.workspace.openTextDocument(docUri)).getText(), '');
	}));

	test('WorkspaceEdit: create & ignoreIfExists', withLogDisabled(async function () {
		let docUri = await createRandomFile('before');

		let we = new vscode.WorkspaceEdit();
		we.createFile(docUri, { ignoreIfExists: true });
		assert.ok(await vscode.workspace.applyEdit(we));
		assert.equal((await vscode.workspace.openTextDocument(docUri)).getText(), 'before');

		we = new vscode.WorkspaceEdit();
		we.createFile(docUri, { overwrite: true, ignoreIfExists: true });
		assert.ok(await vscode.workspace.applyEdit(we));
		assert.equal((await vscode.workspace.openTextDocument(docUri)).getText(), '');
	}));

	test('WorkspaceEdit: rename & ignoreIfExists', withLogDisabled(async function () {
		let aUri = await createRandomFile('aaa');
		let bUri = await createRandomFile('bbb');

		let we = new vscode.WorkspaceEdit();
		we.renameFile(aUri, bUri);
		assert.ok(!await vscode.workspace.applyEdit(we));

		we = new vscode.WorkspaceEdit();
		we.renameFile(aUri, bUri, { ignoreIfExists: true });
		assert.ok(await vscode.workspace.applyEdit(we));

		we = new vscode.WorkspaceEdit();
		we.renameFile(aUri, bUri, { overwrite: false, ignoreIfExists: true });
		assert.ok(!await vscode.workspace.applyEdit(we));

		we = new vscode.WorkspaceEdit();
		we.renameFile(aUri, bUri, { overwrite: true, ignoreIfExists: true });
		assert.ok(await vscode.workspace.applyEdit(we));
	}));

	test('WorkspaceEdit: delete & ignoreIfNotExists', withLogDisabled(async function () {

		let docUri = await createRandomFile();
		let we = new vscode.WorkspaceEdit();
		we.deleteFile(docUri, { ignoreIfNotExists: false });
		assert.ok(await vscode.workspace.applyEdit(we));

		we = new vscode.WorkspaceEdit();
		we.deleteFile(docUri, { ignoreIfNotExists: false });
		assert.ok(!await vscode.workspace.applyEdit(we));

		we = new vscode.WorkspaceEdit();
		we.deleteFile(docUri, { ignoreIfNotExists: true });
		assert.ok(await vscode.workspace.applyEdit(we));
	}));

	test('WorkspaceEdit: insert & rename multiple', async function () {

		let [f1, f2, f3] = await Promise.all([createRandomFile(), createRandomFile(), createRandomFile()]);

		let we = new vscode.WorkspaceEdit();
		we.insert(f1, new vscode.Position(0, 0), 'f1');
		we.insert(f2, new vscode.Position(0, 0), 'f2');
		we.insert(f3, new vscode.Position(0, 0), 'f3');

		let f1_ = nameWithUnderscore(f1);
		we.renameFile(f1, f1_);

		assert.ok(await vscode.workspace.applyEdit(we));

		assert.equal((await vscode.workspace.openTextDocument(f3)).getText(), 'f3');
		assert.equal((await vscode.workspace.openTextDocument(f2)).getText(), 'f2');
		assert.equal((await vscode.workspace.openTextDocument(f1_)).getText(), 'f1');
		try {
			await vscode.workspace.fs.stat(f1);
			assert.ok(false);
		} catch {
			assert.ok(true);
		}
	});

	test('workspace.applyEdit drops the TextEdit if there is a RenameFile later #77735 (with opened editor)', async function () {
		await test77735(true);
	});

	test('workspace.applyEdit drops the TextEdit if there is a RenameFile later #77735 (without opened editor)', async function () {
		await test77735(false);
	});

	async function test77735(withOpenedEditor: boolean): Promise<void> {
		const docUriOriginal = await createRandomFile();
		const docUriMoved = docUriOriginal.with({ path: `${docUriOriginal.path}.moved` });

		if (withOpenedEditor) {
			const document = await vscode.workspace.openTextDocument(docUriOriginal);
			await vscode.window.showTextDocument(document);
		} else {
			await vscode.commands.executeCommand('workbench.action.closeAllEditors');
		}

		for (let i = 0; i < 4; i++) {
			let we = new vscode.WorkspaceEdit();
			let oldUri: vscode.Uri;
			let newUri: vscode.Uri;
			let expected: string;

			if (i % 2 === 0) {
				oldUri = docUriOriginal;
				newUri = docUriMoved;
				we.insert(oldUri, new vscode.Position(0, 0), 'Hello');
				expected = 'Hello';
			} else {
				oldUri = docUriMoved;
				newUri = docUriOriginal;
				we.delete(oldUri, new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 5)));
				expected = '';
			}

			we.renameFile(oldUri, newUri);
			assert.ok(await vscode.workspace.applyEdit(we));

			const document = await vscode.workspace.openTextDocument(newUri);
			assert.equal(document.isDirty, true);

			await document.save();
			assert.equal(document.isDirty, false);

			assert.equal(document.getText(), expected);

			await delay(10);
		}
	}

	test('The api workspace.applyEdit failed for some case of mixing resourceChange and textEdit #80688', async function () {
		const file1 = await createRandomFile();
		const file2 = await createRandomFile();
		let we = new vscode.WorkspaceEdit();
		we.insert(file1, new vscode.Position(0, 0), 'import1;');

		const file2Name = basename(file2.fsPath);
		const file2NewUri = vscode.Uri.parse(file2.toString().replace(file2Name, `new/${file2Name}`));
		we.renameFile(file2, file2NewUri);

		we.insert(file1, new vscode.Position(0, 0), 'import2;');
		await vscode.workspace.applyEdit(we);

		const document = await vscode.workspace.openTextDocument(file1);
		// const expected = 'import1;import2;';
		const expected2 = 'import2;import1;';
		assert.equal(document.getText(), expected2);
	});

	test('The api workspace.applyEdit failed for some case of mixing resourceChange and textEdit #80688', async function () {
		const file1 = await createRandomFile();
		const file2 = await createRandomFile();
		let we = new vscode.WorkspaceEdit();
		we.insert(file1, new vscode.Position(0, 0), 'import1;');
		we.insert(file1, new vscode.Position(0, 0), 'import2;');

		const file2Name = basename(file2.fsPath);
		const file2NewUri = vscode.Uri.parse(file2.toString().replace(file2Name, `new/${file2Name}`));
		we.renameFile(file2, file2NewUri);

		await vscode.workspace.applyEdit(we);

		const document = await vscode.workspace.openTextDocument(file1);
		const expected = 'import1;import2;';
		// const expected2 = 'import2;import1;';
		assert.equal(document.getText(), expected);
	});

	test('issue #107739 - Redo of rename Java Class name has no effect', async () => {
		const file = await createRandomFile('hello');
		const fileName = basename(file.fsPath);
		const newFile = vscode.Uri.parse(file.toString().replace(fileName, `${fileName}2`));

		// apply edit
		{
			const we = new vscode.WorkspaceEdit();
			we.insert(file, new vscode.Position(0, 5), '2');
			we.renameFile(file, newFile);
			await vscode.workspace.applyEdit(we);
		}

		// show the new document
		{
			const document = await vscode.workspace.openTextDocument(newFile);
			await vscode.window.showTextDocument(document);
			assert.equal(document.getText(), 'hello2');
			assert.equal(document.isDirty, true);
		}

		// undo and show the old document
		{
			await vscode.commands.executeCommand('undo');
			const document = await vscode.workspace.openTextDocument(file);
			await vscode.window.showTextDocument(document);
			assert.equal(document.getText(), 'hello');
		}

		// redo and show the new document
		{
			await vscode.commands.executeCommand('redo');
			const document = await vscode.workspace.openTextDocument(newFile);
			await vscode.window.showTextDocument(document);
			assert.equal(document.getText(), 'hello2');
			assert.equal(document.isDirty, true);
		}

	});

	test('issue #110141 - TextEdit.setEndOfLine applies an edit and invalidates redo stack even when no change is made', async () => {
		const file = await createRandomFile('hello\nworld');

		const document = await vscode.workspace.openTextDocument(file);
		await vscode.window.showTextDocument(document);

		// apply edit
		{
			const we = new vscode.WorkspaceEdit();
			we.insert(file, new vscode.Position(0, 5), '2');
			await vscode.workspace.applyEdit(we);
		}

		// check the document
		{
			assert.equal(document.getText(), 'hello2\nworld');
			assert.equal(document.isDirty, true);
		}

		// apply no-op edit
		{
			const we = new vscode.WorkspaceEdit();
			we.set(file, [vscode.TextEdit.setEndOfLine(vscode.EndOfLine.LF)]);
			await vscode.workspace.applyEdit(we);
		}

		// undo
		{
			await vscode.commands.executeCommand('undo');
			assert.equal(document.getText(), 'hello\nworld');
			assert.equal(document.isDirty, false);
		}
	});
});
