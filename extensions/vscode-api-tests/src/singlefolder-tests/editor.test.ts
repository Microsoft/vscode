/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { workspace, window, Position, Range, commands, TextEditor, TextDocument, TextEditorCursorStyle, TextEditorLineNumbersStyle, SnippetString, Selection, Uri, env } from 'vscode';
import { createRandomFile, deleteFile, closeAllEditors } from '../utils';

suite('vscode API - editors', () => {

	teardown(closeAllEditors);

	function withRandomFileEditor(initialContents: string, run: (editor: TextEditor, doc: TextDocument) => Thenable<void>): Thenable<boolean> {
		return createRandomFile(initialContents).then(file => {
			return workspace.openTextDocument(file).then(doc => {
				return window.showTextDocument(doc).then((editor) => {
					return run(editor, doc).then(_ => {
						if (doc.isDirty) {
							return doc.save().then(saved => {
								assert.ok(saved);
								assert.ok(!doc.isDirty);
								return deleteFile(file);
							});
						} else {
							return deleteFile(file);
						}
					});
				});
			});
		});
	}

	test('insert snippet', () => {
		const snippetString = new SnippetString()
			.appendText('This is a ')
			.appendTabstop()
			.appendPlaceholder('placeholder')
			.appendText(' snippet');

		return withRandomFileEditor('', (editor, doc) => {
			return editor.insertSnippet(snippetString).then(inserted => {
				assert.ok(inserted);
				assert.equal(doc.getText(), 'This is a placeholder snippet');
				assert.ok(doc.isDirty);
			});
		});
	});

	test('insert snippet with clipboard variables', async function () {
		const old = await env.clipboard.readText();

		const newValue = 'INTEGRATION-TESTS';
		await env.clipboard.writeText(newValue);

		const actualValue = await env.clipboard.readText();

		if (actualValue !== newValue) {
			// clipboard not working?!?
			this.skip();
			return;
		}

		const snippetString = new SnippetString('running: $CLIPBOARD');

		await withRandomFileEditor('', async (editor, doc) => {
			const inserted = await editor.insertSnippet(snippetString);
			assert.ok(inserted);
			assert.equal(doc.getText(), 'running: INTEGRATION-TESTS');
			assert.ok(doc.isDirty);
		});

		await env.clipboard.writeText(old);
	});

	test('insert snippet with replacement, editor selection', () => {
		const snippetString = new SnippetString()
			.appendText('has been');

		return withRandomFileEditor('This will be replaced', (editor, doc) => {
			editor.selection = new Selection(
				new Position(0, 5),
				new Position(0, 12)
			);

			return editor.insertSnippet(snippetString).then(inserted => {
				assert.ok(inserted);
				assert.equal(doc.getText(), 'This has been replaced');
				assert.ok(doc.isDirty);
			});
		});
	});

	test('insert snippet with replacement, selection as argument', () => {
		const snippetString = new SnippetString()
			.appendText('has been');

		return withRandomFileEditor('This will be replaced', (editor, doc) => {
			const selection = new Selection(
				new Position(0, 5),
				new Position(0, 12)
			);

			return editor.insertSnippet(snippetString, selection).then(inserted => {
				assert.ok(inserted);
				assert.equal(doc.getText(), 'This has been replaced');
				assert.ok(doc.isDirty);
			});
		});
	});

	test('make edit', () => {
		return withRandomFileEditor('', (editor, doc) => {
			return editor.edit((builder) => {
				builder.insert(new Position(0, 0), 'Hello World');
			}).then(applied => {
				assert.ok(applied);
				assert.equal(doc.getText(), 'Hello World');
				assert.ok(doc.isDirty);
			});
		});
	});

	test('issue #6281: Edits fail to validate ranges correctly before applying', () => {
		return withRandomFileEditor('Hello world!', (editor, doc) => {
			return editor.edit((builder) => {
				builder.replace(new Range(0, 0, Number.MAX_VALUE, Number.MAX_VALUE), 'new');
			}).then(applied => {
				assert.ok(applied);
				assert.equal(doc.getText(), 'new');
				assert.ok(doc.isDirty);
			});
		});
	});

	function executeReplace(editor: TextEditor, range: Range, text: string, undoStopBefore: boolean, undoStopAfter: boolean): Thenable<boolean> {
		return editor.edit((builder) => {
			builder.replace(range, text);
		}, { undoStopBefore: undoStopBefore, undoStopAfter: undoStopAfter });
	}

	test('TextEditor.edit can control undo/redo stack 1', () => {
		return withRandomFileEditor('Hello world!', (editor, doc) => {
			return executeReplace(editor, new Range(0, 0, 0, 1), 'h', false, false).then(applied => {
				assert.ok(applied);
				assert.equal(doc.getText(), 'hello world!');
				assert.ok(doc.isDirty);
				return executeReplace(editor, new Range(0, 1, 0, 5), 'ELLO', false, false);
			}).then(applied => {
				assert.ok(applied);
				assert.equal(doc.getText(), 'hELLO world!');
				assert.ok(doc.isDirty);
				return commands.executeCommand('undo');
			}).then(_ => {
				assert.equal(doc.getText(), 'Hello world!');
			});
		});
	});

	test('TextEditor.edit can control undo/redo stack 2', () => {
		return withRandomFileEditor('Hello world!', (editor, doc) => {
			return executeReplace(editor, new Range(0, 0, 0, 1), 'h', false, false).then(applied => {
				assert.ok(applied);
				assert.equal(doc.getText(), 'hello world!');
				assert.ok(doc.isDirty);
				return executeReplace(editor, new Range(0, 1, 0, 5), 'ELLO', true, false);
			}).then(applied => {
				assert.ok(applied);
				assert.equal(doc.getText(), 'hELLO world!');
				assert.ok(doc.isDirty);
				return commands.executeCommand('undo');
			}).then(_ => {
				assert.equal(doc.getText(), 'hello world!');
			});
		});
	});

	test('issue #16573: Extension API: insertSpaces and tabSize are undefined', () => {
		return withRandomFileEditor('Hello world!\n\tHello world!', (editor, _doc) => {

			assert.equal(editor.options.tabSize, 4);
			assert.equal(editor.options.insertSpaces, false);
			assert.equal(editor.options.cursorStyle, TextEditorCursorStyle.Line);
			assert.equal(editor.options.lineNumbers, TextEditorLineNumbersStyle.On);

			editor.options = {
				tabSize: 2
			};

			assert.equal(editor.options.tabSize, 2);
			assert.equal(editor.options.insertSpaces, false);
			assert.equal(editor.options.cursorStyle, TextEditorCursorStyle.Line);
			assert.equal(editor.options.lineNumbers, TextEditorLineNumbersStyle.On);

			editor.options.tabSize = 'invalid';

			assert.equal(editor.options.tabSize, 2);
			assert.equal(editor.options.insertSpaces, false);
			assert.equal(editor.options.cursorStyle, TextEditorCursorStyle.Line);
			assert.equal(editor.options.lineNumbers, TextEditorLineNumbersStyle.On);

			return Promise.resolve();
		});
	});

	test('issue #20757: Overlapping ranges are not allowed!', () => {
		return withRandomFileEditor('Hello world!\n\tHello world!', (editor, _doc) => {
			return editor.edit((builder) => {
				// create two edits that overlap (i.e. are illegal)
				builder.replace(new Range(0, 0, 0, 2), 'He');
				builder.replace(new Range(0, 1, 0, 3), 'el');
			}).then(

				(_applied) => {
					assert.ok(false, 'edit with overlapping ranges should fail');
				},

				(_err) => {
					assert.ok(true, 'edit with overlapping ranges should fail');
				}
			);
		});
	});

	test('throw when using invalid edit', async function () {
		await withRandomFileEditor('foo', editor => {
			return new Promise((resolve, reject) => {
				editor.edit(edit => {
					edit.insert(new Position(0, 0), 'bar');
					setTimeout(() => {
						try {
							edit.insert(new Position(0, 0), 'bar');
							reject(new Error('expected error'));
						} catch (err) {
							assert.ok(true);
							resolve();
						}
					}, 0);
				});
			});
		});
	});

	test('editor contents are correctly read (small file)', function () {
		return testEditorContents('/far.js');
	});

	test('editor contents are correctly read (large file)', async function () {
		return testEditorContents('/lorem.txt');
	});

	async function testEditorContents(relativePath: string) {
		const root = workspace.workspaceFolders![0]!.uri;
		const file = Uri.parse(root.toString() + relativePath);
		const document = await workspace.openTextDocument(file);

		assert.equal(document.getText(), Buffer.from(await workspace.fs.readFile(file)).toString());
	}
});
