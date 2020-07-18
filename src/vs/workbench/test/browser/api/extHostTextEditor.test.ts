/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { TextEditorLineNumbersStyle, Range } from 'vs/workbench/api/common/extHostTypes';
import { TextEditorCursorStyle, RenderLineNumbersType } from 'vs/editor/common/config/editorOptions';
import { MainThreadTextEditorsShape, IResolvedTextEditorConfiguration, ITextEditorConfigurationUpdate } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostTextEditorOptions, ExtHostTextEditor } from 'vs/workbench/api/common/extHostTextEditor';
import { ExtHostDocumentData } from 'vs/workbench/api/common/extHostDocumentData';
import { URI } from 'vs/base/common/uri';
import { mock } from 'vs/base/test/common/mock';
import { NullLogService } from 'vs/platform/log/common/log';

suite('ExtHostTextEditor', () => {

	let editor: ExtHostTextEditor;
	let doc = new ExtHostDocumentData(undefined!, URI.file(''), [
		'aaaa bbbb+cccc abc'
	], '\n', 'text', 1, false);

	setup(() => {
		editor = new ExtHostTextEditor('fake', null!, new NullLogService(), doc, [], { cursorStyle: 0, insertSpaces: true, lineNumbers: 1, tabSize: 4, indentSize: 4 }, [], 1);
	});

	test('disposed editor', () => {

		assert.ok(editor.document);
		editor._acceptViewColumn(3);
		assert.equal(3, editor.viewColumn);

		editor.dispose();

		assert.throws(() => editor._acceptViewColumn(2));
		assert.equal(3, editor.viewColumn);

		assert.ok(editor.document);
		assert.throws(() => editor._acceptOptions(null!));
		assert.throws(() => editor._acceptSelections([]));
	});

	test('API [bug]: registerTextEditorCommand clears redo stack even if no edits are made #55163', async function () {
		let applyCount = 0;
		let editor = new ExtHostTextEditor('edt1',
			new class extends mock<MainThreadTextEditorsShape>() {
				$tryApplyEdits(): Promise<boolean> {
					applyCount += 1;
					return Promise.resolve(true);
				}
			}, new NullLogService(), doc, [], { cursorStyle: 0, insertSpaces: true, lineNumbers: 1, tabSize: 4, indentSize: 4 }, [], 1);

		await editor.edit(edit => { });
		assert.equal(applyCount, 0);

		await editor.edit(edit => { edit.setEndOfLine(1); });
		assert.equal(applyCount, 1);

		await editor.edit(edit => { edit.delete(new Range(0, 0, 1, 1)); });
		assert.equal(applyCount, 2);
	});
});

suite('ExtHostTextEditorOptions', () => {

	let opts: ExtHostTextEditorOptions;
	let calls: ITextEditorConfigurationUpdate[] = [];

	setup(() => {
		calls = [];
		let mockProxy: MainThreadTextEditorsShape = {
			dispose: undefined!,
			$trySetOptions: (id: string, options: ITextEditorConfigurationUpdate) => {
				assert.equal(id, '1');
				calls.push(options);
				return Promise.resolve(undefined);
			},
			$tryShowTextDocument: undefined!,
			$registerTextEditorDecorationType: undefined!,
			$removeTextEditorDecorationType: undefined!,
			$tryShowEditor: undefined!,
			$tryHideEditor: undefined!,
			$trySetDecorations: undefined!,
			$trySetDecorationsFast: undefined!,
			$tryRevealRange: undefined!,
			$trySetSelections: undefined!,
			$tryApplyEdits: undefined!,
			$tryApplyWorkspaceEdit: undefined!,
			$tryInsertSnippet: undefined!,
			$getDiffInformation: undefined!
		};
		opts = new ExtHostTextEditorOptions(mockProxy, '1', {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		}, new NullLogService());
	});

	teardown(() => {
		opts = null!;
		calls = null!;
	});

	function assertState(opts: ExtHostTextEditorOptions, expected: IResolvedTextEditorConfiguration): void {
		let actual = {
			tabSize: opts.tabSize,
			indentSize: opts.indentSize,
			insertSpaces: opts.insertSpaces,
			cursorStyle: opts.cursorStyle,
			lineNumbers: opts.lineNumbers
		};
		assert.deepEqual(actual, expected);
	}

	test('can set tabSize to the same value', () => {
		opts.tabSize = 4;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('can change tabSize to positive integer', () => {
		opts.tabSize = 1;
		assertState(opts, {
			tabSize: 1,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ tabSize: 1 }]);
	});

	test('can change tabSize to positive float', () => {
		opts.tabSize = 2.3;
		assertState(opts, {
			tabSize: 2,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ tabSize: 2 }]);
	});

	test('can change tabSize to a string number', () => {
		opts.tabSize = '2';
		assertState(opts, {
			tabSize: 2,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ tabSize: 2 }]);
	});

	test('tabSize can request indentation detection', () => {
		opts.tabSize = 'auto';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ tabSize: 'auto' }]);
	});

	test('ignores invalid tabSize 1', () => {
		opts.tabSize = null!;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('ignores invalid tabSize 2', () => {
		opts.tabSize = -5;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('ignores invalid tabSize 3', () => {
		opts.tabSize = 'hello';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('ignores invalid tabSize 4', () => {
		opts.tabSize = '-17';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('can set indentSize to the same value', () => {
		opts.indentSize = 4;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('can change indentSize to positive integer', () => {
		opts.indentSize = 1;
		assertState(opts, {
			tabSize: 4,
			indentSize: 1,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ indentSize: 1 }]);
	});

	test('can change indentSize to positive float', () => {
		opts.indentSize = 2.3;
		assertState(opts, {
			tabSize: 4,
			indentSize: 2,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ indentSize: 2 }]);
	});

	test('can change indentSize to a string number', () => {
		opts.indentSize = '2';
		assertState(opts, {
			tabSize: 4,
			indentSize: 2,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ indentSize: 2 }]);
	});

	test('indentSize can request to use tabSize', () => {
		opts.indentSize = 'tabSize';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ indentSize: 'tabSize' }]);
	});

	test('indentSize cannot request indentation detection', () => {
		opts.indentSize = 'auto';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('ignores invalid indentSize 1', () => {
		opts.indentSize = null!;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('ignores invalid indentSize 2', () => {
		opts.indentSize = -5;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('ignores invalid indentSize 3', () => {
		opts.indentSize = 'hello';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('ignores invalid indentSize 4', () => {
		opts.indentSize = '-17';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('can set insertSpaces to the same value', () => {
		opts.insertSpaces = false;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('can set insertSpaces to boolean', () => {
		opts.insertSpaces = true;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: true,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ insertSpaces: true }]);
	});

	test('can set insertSpaces to false string', () => {
		opts.insertSpaces = 'false';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('can set insertSpaces to truey', () => {
		opts.insertSpaces = 'hello';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: true,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ insertSpaces: true }]);
	});

	test('insertSpaces can request indentation detection', () => {
		opts.insertSpaces = 'auto';
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ insertSpaces: 'auto' }]);
	});

	test('can set cursorStyle to same value', () => {
		opts.cursorStyle = TextEditorCursorStyle.Line;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('can change cursorStyle', () => {
		opts.cursorStyle = TextEditorCursorStyle.Block;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Block,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ cursorStyle: TextEditorCursorStyle.Block }]);
	});

	test('can set lineNumbers to same value', () => {
		opts.lineNumbers = TextEditorLineNumbersStyle.On;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('can change lineNumbers', () => {
		opts.lineNumbers = TextEditorLineNumbersStyle.Off;
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.Off
		});
		assert.deepEqual(calls, [{ lineNumbers: RenderLineNumbersType.Off }]);
	});

	test('can do bulk updates 0', () => {
		opts.assign({
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: TextEditorLineNumbersStyle.On
		});
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, []);
	});

	test('can do bulk updates 1', () => {
		opts.assign({
			tabSize: 'auto',
			insertSpaces: true
		});
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: true,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ tabSize: 'auto', insertSpaces: true }]);
	});

	test('can do bulk updates 2', () => {
		opts.assign({
			tabSize: 3,
			insertSpaces: 'auto'
		});
		assertState(opts, {
			tabSize: 3,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepEqual(calls, [{ tabSize: 3, insertSpaces: 'auto' }]);
	});

	test('can do bulk updates 3', () => {
		opts.assign({
			cursorStyle: TextEditorCursorStyle.Block,
			lineNumbers: TextEditorLineNumbersStyle.Relative
		});
		assertState(opts, {
			tabSize: 4,
			indentSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Block,
			lineNumbers: RenderLineNumbersType.Relative
		});
		assert.deepEqual(calls, [{ cursorStyle: TextEditorCursorStyle.Block, lineNumbers: RenderLineNumbersType.Relative }]);
	});

});
