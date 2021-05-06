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
import { Lazy } from 'vs/base/common/lazy';

suite('ExtHostTextEditor', () => {

	let editor: ExtHostTextEditor;
	let doc = new ExtHostDocumentData(undefined!, URI.file(''), [
		'aaaa bbbb+cccc abc'
	], '\n', 1, 'text', false);

	setup(() => {
		editor = new ExtHostTextEditor('fake', null!, new NullLogService(), new Lazy(() => doc.document), [], { cursorStyle: 0, insertSpaces: true, lineNumbers: 1, tabSize: 4 }, [], 1);
	});

	test('disposed editor', () => {

		assert.ok(editor.value.document);
		editor._acceptViewColumn(3);
		assert.strictEqual(3, editor.value.viewColumn);

		editor.dispose();

		assert.throws(() => editor._acceptViewColumn(2));
		assert.strictEqual(3, editor.value.viewColumn);

		assert.ok(editor.value.document);
		assert.throws(() => editor._acceptOptions(null!));
		assert.throws(() => editor._acceptSelections([]));
	});

	test('API [bug]: registerTextEditorCommand clears redo stack even if no edits are made #55163', async function () {
		let applyCount = 0;
		let editor = new ExtHostTextEditor('edt1',
			new class extends mock<MainThreadTextEditorsShape>() {
				override $tryApplyEdits(): Promise<boolean> {
					applyCount += 1;
					return Promise.resolve(true);
				}
			}, new NullLogService(), new Lazy(() => doc.document), [], { cursorStyle: 0, insertSpaces: true, lineNumbers: 1, tabSize: 4 }, [], 1);

		await editor.value.edit(edit => { });
		assert.strictEqual(applyCount, 0);

		await editor.value.edit(edit => { edit.setEndOfLine(1); });
		assert.strictEqual(applyCount, 1);

		await editor.value.edit(edit => { edit.delete(new Range(0, 0, 1, 1)); });
		assert.strictEqual(applyCount, 2);
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
				assert.strictEqual(id, '1');
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
			$tryInsertSnippet: undefined!,
			$getDiffInformation: undefined!
		};
		opts = new ExtHostTextEditorOptions(mockProxy, '1', {
			tabSize: 4,
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
			tabSize: opts.value.tabSize,
			insertSpaces: opts.value.insertSpaces,
			cursorStyle: opts.value.cursorStyle,
			lineNumbers: opts.value.lineNumbers
		};
		assert.deepStrictEqual(actual, expected);
	}

	test('can set tabSize to the same value', () => {
		opts.value.tabSize = 4;
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('can change tabSize to positive integer', () => {
		opts.value.tabSize = 1;
		assertState(opts, {
			tabSize: 1,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ tabSize: 1 }]);
	});

	test('can change tabSize to positive float', () => {
		opts.value.tabSize = 2.3;
		assertState(opts, {
			tabSize: 2,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ tabSize: 2 }]);
	});

	test('can change tabSize to a string number', () => {
		opts.value.tabSize = '2';
		assertState(opts, {
			tabSize: 2,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ tabSize: 2 }]);
	});

	test('tabSize can request indentation detection', () => {
		opts.value.tabSize = 'auto';
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ tabSize: 'auto' }]);
	});

	test('ignores invalid tabSize 1', () => {
		opts.value.tabSize = null!;
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('ignores invalid tabSize 2', () => {
		opts.value.tabSize = -5;
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('ignores invalid tabSize 3', () => {
		opts.value.tabSize = 'hello';
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('ignores invalid tabSize 4', () => {
		opts.value.tabSize = '-17';
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('can set insertSpaces to the same value', () => {
		opts.value.insertSpaces = false;
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('can set insertSpaces to boolean', () => {
		opts.value.insertSpaces = true;
		assertState(opts, {
			tabSize: 4,
			insertSpaces: true,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ insertSpaces: true }]);
	});

	test('can set insertSpaces to false string', () => {
		opts.value.insertSpaces = 'false';
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('can set insertSpaces to truey', () => {
		opts.value.insertSpaces = 'hello';
		assertState(opts, {
			tabSize: 4,
			insertSpaces: true,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ insertSpaces: true }]);
	});

	test('insertSpaces can request indentation detection', () => {
		opts.value.insertSpaces = 'auto';
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ insertSpaces: 'auto' }]);
	});

	test('can set cursorStyle to same value', () => {
		opts.value.cursorStyle = TextEditorCursorStyle.Line;
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('can change cursorStyle', () => {
		opts.value.cursorStyle = TextEditorCursorStyle.Block;
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Block,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ cursorStyle: TextEditorCursorStyle.Block }]);
	});

	test('can set lineNumbers to same value', () => {
		opts.value.lineNumbers = TextEditorLineNumbersStyle.On;
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('can change lineNumbers', () => {
		opts.value.lineNumbers = TextEditorLineNumbersStyle.Off;
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.Off
		});
		assert.deepStrictEqual(calls, [{ lineNumbers: RenderLineNumbersType.Off }]);
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
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, []);
	});

	test('can do bulk updates 1', () => {
		opts.assign({
			tabSize: 'auto',
			insertSpaces: true
		});
		assertState(opts, {
			tabSize: 4,
			insertSpaces: true,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ tabSize: 'auto', insertSpaces: true }]);
	});

	test('can do bulk updates 2', () => {
		opts.assign({
			tabSize: 3,
			insertSpaces: 'auto'
		});
		assertState(opts, {
			tabSize: 3,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Line,
			lineNumbers: RenderLineNumbersType.On
		});
		assert.deepStrictEqual(calls, [{ tabSize: 3, insertSpaces: 'auto' }]);
	});

	test('can do bulk updates 3', () => {
		opts.assign({
			cursorStyle: TextEditorCursorStyle.Block,
			lineNumbers: TextEditorLineNumbersStyle.Relative
		});
		assertState(opts, {
			tabSize: 4,
			insertSpaces: false,
			cursorStyle: TextEditorCursorStyle.Block,
			lineNumbers: RenderLineNumbersType.Relative
		});
		assert.deepStrictEqual(calls, [{ cursorStyle: TextEditorCursorStyle.Block, lineNumbers: RenderLineNumbersType.Relative }]);
	});

});
