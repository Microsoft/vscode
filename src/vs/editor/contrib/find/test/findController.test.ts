/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Delayer } from 'vs/base/common/async';
import { Event } from 'vs/base/common/event';
import * as platform from 'vs/base/common/platform';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { CommonFindController, FindStartFocusAction, IFindStartOptions, NextMatchFindAction, NextSelectionMatchFindAction, StartFindAction, StartFindReplaceAction, StartFindWithSelectionAction } from 'vs/editor/contrib/find/findController';
import { CONTEXT_FIND_INPUT_FOCUSED } from 'vs/editor/contrib/find/findModel';
import { withAsyncTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IStorageService } from 'vs/platform/storage/common/storage';

export class TestFindController extends CommonFindController {

	public hasFocus: boolean;
	public delayUpdateHistory: boolean = false;

	private _findInputFocused: IContextKey<boolean>;

	constructor(
		editor: ICodeEditor,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService storageService: IStorageService,
		@IClipboardService clipboardService: IClipboardService
	) {
		super(editor, contextKeyService, storageService, clipboardService);
		this._findInputFocused = CONTEXT_FIND_INPUT_FOCUSED.bindTo(contextKeyService);
		this._updateHistoryDelayer = new Delayer<void>(50);
		this.hasFocus = false;
	}

	protected async _start(opts: IFindStartOptions): Promise<void> {
		await super._start(opts);

		if (opts.shouldFocus !== FindStartFocusAction.NoFocusChange) {
			this.hasFocus = true;
		}

		let inputFocused = opts.shouldFocus === FindStartFocusAction.FocusFindInput;
		this._findInputFocused.set(inputFocused);
	}
}

function fromSelection(slc: Selection): number[] {
	return [slc.startLineNumber, slc.startColumn, slc.endLineNumber, slc.endColumn];
}

suite('FindController', async () => {
	let queryState: { [key: string]: any; } = {};
	let clipboardState = '';
	let serviceCollection = new ServiceCollection();
	serviceCollection.set(IStorageService, {
		_serviceBrand: undefined,
		onDidChangeTarget: Event.None,
		onDidChangeValue: Event.None,
		onWillSaveState: Event.None,
		get: (key: string) => queryState[key],
		getBoolean: (key: string) => !!queryState[key],
		getNumber: (key: string) => undefined!,
		store: (key: string, value: any) => { queryState[key] = value; return Promise.resolve(); },
		remove: () => undefined,
		isNew: () => false,
		flush: () => { return Promise.resolve(); },
		keys: () => [],
		logStorage: () => { },
		migrate: () => { throw new Error(); }
	} as IStorageService);

	if (platform.isMacintosh) {
		serviceCollection.set(IClipboardService, <any>{
			readFindText: () => clipboardState,
			writeFindText: (value: any) => { clipboardState = value; }
		});
	}

	/* test('stores to the global clipboard buffer on start find action', async () => {
		await withAsyncTestCodeEditor([
			'ABC',
			'ABC',
			'XYZ',
			'ABC'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			if (!platform.isMacintosh) {
				assert.ok(true);
				return;
			}
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let startFindAction = new StartFindAction();
			// I select ABC on the first line
			editor.setSelection(new Selection(1, 1, 1, 4));
			// I hit Ctrl+F to show the Find dialog
			startFindAction.run(null, editor);

			assert.deepEqual(findController.getGlobalBufferTerm(), findController.getState().searchString);
			findController.dispose();
		});
	});

	test('reads from the global clipboard buffer on next find action if buffer exists', async () => {
		await withAsyncTestCodeEditor([
			'ABC',
			'ABC',
			'XYZ',
			'ABC'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = 'ABC';

			if (!platform.isMacintosh) {
				assert.ok(true);
				return;
			}

			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let findState = findController.getState();
			let nextMatchFindAction = new NextMatchFindAction();

			nextMatchFindAction.run(null, editor);
			assert.equal(findState.searchString, 'ABC');

			assert.deepEqual(fromSelection(editor.getSelection()!), [1, 1, 1, 4]);

			findController.dispose();
		});
	});

	test('writes to the global clipboard buffer when text changes', async () => {
		await withAsyncTestCodeEditor([
			'ABC',
			'ABC',
			'XYZ',
			'ABC'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			if (!platform.isMacintosh) {
				assert.ok(true);
				return;
			}

			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let findState = findController.getState();

			findState.change({ searchString: 'ABC' }, true);

			assert.deepEqual(findController.getGlobalBufferTerm(), 'ABC');

			findController.dispose();
		});
	}); */

	test('issue #1857: F3, Find Next, acts like "Find Under Cursor"', async () => {
		await withAsyncTestCodeEditor([
			'ABC',
			'ABC',
			'XYZ',
			'ABC'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			// The cursor is at the very top, of the file, at the first ABC
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let findState = findController.getState();
			let startFindAction = new StartFindAction();
			let nextMatchFindAction = new NextMatchFindAction();

			// I hit Ctrl+F to show the Find dialog
			await startFindAction.run(null, editor);

			// I type ABC.
			findState.change({ searchString: 'A' }, true);
			findState.change({ searchString: 'AB' }, true);
			findState.change({ searchString: 'ABC' }, true);

			// The first ABC is highlighted.
			assert.deepEqual(fromSelection(editor.getSelection()!), [1, 1, 1, 4]);

			// I hit Esc to exit the Find dialog.
			findController.closeFindWidget();
			findController.hasFocus = false;

			// The cursor is now at end of the first line, with ABC on that line highlighted.
			assert.deepEqual(fromSelection(editor.getSelection()!), [1, 1, 1, 4]);

			// I hit delete to remove it and change the text to XYZ.
			editor.pushUndoStop();
			editor.executeEdits('test', [EditOperation.delete(new Range(1, 1, 1, 4))]);
			editor.executeEdits('test', [EditOperation.insert(new Position(1, 1), 'XYZ')]);
			editor.pushUndoStop();

			// At this point the text editor looks like this:
			//   XYZ
			//   ABC
			//   XYZ
			//   ABC
			assert.equal(editor.getModel()!.getLineContent(1), 'XYZ');

			// The cursor is at end of the first line.
			assert.deepEqual(fromSelection(editor.getSelection()!), [1, 4, 1, 4]);

			// I hit F3 to "Find Next" to find the next occurrence of ABC, but instead it searches for XYZ.
			await nextMatchFindAction.run(null, editor);

			assert.equal(findState.searchString, 'ABC');
			assert.equal(findController.hasFocus, false);

			findController.dispose();
		});
	});

	test('issue #3090: F3 does not loop with two matches on a single line', async () => {
		await withAsyncTestCodeEditor([
			'import nls = require(\'vs/nls\');'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let nextMatchFindAction = new NextMatchFindAction();

			editor.setPosition({
				lineNumber: 1,
				column: 9
			});

			await nextMatchFindAction.run(null, editor);
			assert.deepEqual(fromSelection(editor.getSelection()!), [1, 26, 1, 29]);

			await nextMatchFindAction.run(null, editor);
			assert.deepEqual(fromSelection(editor.getSelection()!), [1, 8, 1, 11]);

			findController.dispose();
		});
	});

	test('issue #6149: Auto-escape highlighted text for search and replace regex mode', async () => {
		await withAsyncTestCodeEditor([
			'var x = (3 * 5)',
			'var y = (3 * 5)',
			'var z = (3  * 5)',
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let startFindAction = new StartFindAction();
			let nextMatchFindAction = new NextMatchFindAction();

			editor.setSelection(new Selection(1, 9, 1, 13));

			findController.toggleRegex();
			await startFindAction.run(null, editor);

			await nextMatchFindAction.run(null, editor);
			assert.deepEqual(fromSelection(editor.getSelection()!), [2, 9, 2, 13]);

			await nextMatchFindAction.run(null, editor);
			assert.deepEqual(fromSelection(editor.getSelection()!), [1, 9, 1, 13]);

			findController.dispose();
		});
	});

	test('issue #41027: Don\'t replace find input value on replace action if find input is active', async () => {
		await withAsyncTestCodeEditor([
			'test',
		], { serviceCollection: serviceCollection }, async (editor) => {
			let testRegexString = 'tes.';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let nextMatchFindAction = new NextMatchFindAction();
			let startFindReplaceAction = new StartFindReplaceAction();

			findController.toggleRegex();
			findController.setSearchString(testRegexString);
			await findController.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: 'none',
				seedSearchStringFromGlobalClipboard: false,
				shouldFocus: FindStartFocusAction.FocusFindInput,
				shouldAnimate: false,
				updateSearchScope: false,
				loop: true
			});
			await nextMatchFindAction.run(null, editor);
			await startFindReplaceAction.run(null, editor);

			assert.equal(findController.getState().searchString, testRegexString);

			findController.dispose();
		});
	});

	test('issue #9043: Clear search scope when find widget is hidden', async () => {
		await withAsyncTestCodeEditor([
			'var x = (3 * 5)',
			'var y = (3 * 5)',
			'var z = (3 * 5)',
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			await findController.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: 'none',
				seedSearchStringFromGlobalClipboard: false,
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: false,
				updateSearchScope: false,
				loop: true
			});

			assert.equal(findController.getState().searchScope, null);

			findController.getState().change({
				searchScope: [new Range(1, 1, 1, 5)]
			}, false);

			assert.deepEqual(findController.getState().searchScope, [new Range(1, 1, 1, 5)]);

			findController.closeFindWidget();
			assert.equal(findController.getState().searchScope, null);
		});
	});

	test('issue #18111: Regex replace with single space replaces with no space', async () => {
		await withAsyncTestCodeEditor([
			'HRESULT OnAmbientPropertyChange(DISPID   dispid);'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);

			let startFindAction = new StartFindAction();
			await startFindAction.run(null, editor);

			findController.getState().change({ searchString: '\\b\\s{3}\\b', replaceString: ' ', isRegex: true }, false);
			findController.moveToNextMatch();

			assert.deepEqual(editor.getSelections()!.map(fromSelection), [
				[1, 39, 1, 42]
			]);

			findController.replace();

			assert.deepEqual(editor.getValue(), 'HRESULT OnAmbientPropertyChange(DISPID dispid);');

			findController.dispose();
		});
	});

	test('issue #24714: Regular expression with ^ in search & replace', async () => {
		await withAsyncTestCodeEditor([
			'',
			'line2',
			'line3'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);

			let startFindAction = new StartFindAction();
			await startFindAction.run(null, editor);

			findController.getState().change({ searchString: '^', replaceString: 'x', isRegex: true }, false);
			findController.moveToNextMatch();

			assert.deepEqual(editor.getSelections()!.map(fromSelection), [
				[2, 1, 2, 1]
			]);

			findController.replace();

			assert.deepEqual(editor.getValue(), '\nxline2\nline3');

			findController.dispose();
		});
	});

	test('issue #38232: Find Next Selection, regex enabled', async () => {
		await withAsyncTestCodeEditor([
			'([funny]',
			'',
			'([funny]'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let nextSelectionMatchFindAction = new NextSelectionMatchFindAction();

			// toggle regex
			findController.getState().change({ isRegex: true }, false);

			// change selection
			editor.setSelection(new Selection(1, 1, 1, 9));

			// cmd+f3
			await nextSelectionMatchFindAction.run(null, editor);

			assert.deepEqual(editor.getSelections()!.map(fromSelection), [
				[3, 1, 3, 9]
			]);

			findController.dispose();
		});
	});

	test('issue #38232: Find Next Selection, regex enabled, find widget open', async () => {
		await withAsyncTestCodeEditor([
			'([funny]',
			'',
			'([funny]'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let startFindAction = new StartFindAction();
			let nextSelectionMatchFindAction = new NextSelectionMatchFindAction();

			// cmd+f - open find widget
			await startFindAction.run(null, editor);

			// toggle regex
			findController.getState().change({ isRegex: true }, false);

			// change selection
			editor.setSelection(new Selection(1, 1, 1, 9));

			// cmd+f3
			await nextSelectionMatchFindAction.run(null, editor);

			assert.deepEqual(editor.getSelections()!.map(fromSelection), [
				[3, 1, 3, 9]
			]);

			findController.dispose();
		});
	});

	test('issue #47400, CMD+E supports feeding multiple line of text into the find widget', async () => {
		await withAsyncTestCodeEditor([
			'ABC',
			'ABC',
			'XYZ',
			'ABC',
			'ABC'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let startFindAction = new StartFindAction();

			// change selection
			editor.setSelection(new Selection(1, 1, 1, 1));

			// cmd+f - open find widget
			await startFindAction.run(null, editor);

			editor.setSelection(new Selection(1, 1, 2, 4));
			let startFindWithSelectionAction = new StartFindWithSelectionAction();
			await startFindWithSelectionAction.run(null, editor);
			let findState = findController.getState();

			assert.deepEqual(findState.searchString.split(/\r\n|\r|\n/g), ['ABC', 'ABC']);

			editor.setSelection(new Selection(3, 1, 3, 1));
			await startFindWithSelectionAction.run(null, editor);

			findController.dispose();
		});
	});

	test('issue #109756, CMD+E with empty cursor should always work', async () => {
		await withAsyncTestCodeEditor([
			'ABC',
			'ABC',
			'XYZ',
			'ABC',
			'ABC'
		], { serviceCollection: serviceCollection }, async (editor) => {
			clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			editor.setSelection(new Selection(1, 2, 1, 2));

			let startFindWithSelectionAction = new StartFindWithSelectionAction();
			startFindWithSelectionAction.run(null, editor);

			let findState = findController.getState();
			assert.deepEqual(findState.searchString, 'ABC');
			findController.dispose();
		});
	});
});

suite('FindController query options persistence', async () => {
	let queryState: { [key: string]: any; } = {};
	queryState['editor.isRegex'] = false;
	queryState['editor.matchCase'] = false;
	queryState['editor.wholeWord'] = false;
	let serviceCollection = new ServiceCollection();
	serviceCollection.set(IStorageService, {
		_serviceBrand: undefined,
		onDidChangeTarget: Event.None,
		onDidChangeValue: Event.None,
		onWillSaveState: Event.None,
		get: (key: string) => queryState[key],
		getBoolean: (key: string) => !!queryState[key],
		getNumber: (key: string) => undefined!,
		store: (key: string, value: any) => { queryState[key] = value; return Promise.resolve(); },
		remove: () => undefined,
		isNew: () => false,
		flush: () => { return Promise.resolve(); },
		keys: () => [],
		logStorage: () => { },
		migrate: () => { throw new Error(); }
	} as IStorageService);

	test('matchCase', async () => {
		await withAsyncTestCodeEditor([
			'abc',
			'ABC',
			'XYZ',
			'ABC'
		], { serviceCollection: serviceCollection }, async (editor) => {
			queryState = { 'editor.isRegex': false, 'editor.matchCase': true, 'editor.wholeWord': false };
			// The cursor is at the very top, of the file, at the first ABC
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let findState = findController.getState();
			let startFindAction = new StartFindAction();

			// I hit Ctrl+F to show the Find dialog
			await startFindAction.run(null, editor);

			// I type ABC.
			findState.change({ searchString: 'ABC' }, true);
			// The second ABC is highlighted as matchCase is true.
			assert.deepEqual(fromSelection(editor.getSelection()!), [2, 1, 2, 4]);

			findController.dispose();
		});
	});

	queryState = { 'editor.isRegex': false, 'editor.matchCase': false, 'editor.wholeWord': true };

	test('wholeWord', async () => {
		await withAsyncTestCodeEditor([
			'ABC',
			'AB',
			'XYZ',
			'ABC'
		], { serviceCollection: serviceCollection }, async (editor) => {
			queryState = { 'editor.isRegex': false, 'editor.matchCase': false, 'editor.wholeWord': true };
			// The cursor is at the very top, of the file, at the first ABC
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			let findState = findController.getState();
			let startFindAction = new StartFindAction();

			// I hit Ctrl+F to show the Find dialog
			await startFindAction.run(null, editor);

			// I type AB.
			findState.change({ searchString: 'AB' }, true);
			// The second AB is highlighted as wholeWord is true.
			assert.deepEqual(fromSelection(editor.getSelection()!), [2, 1, 2, 3]);

			findController.dispose();
		});
	});

	test('toggling options is saved', async () => {
		await withAsyncTestCodeEditor([
			'ABC',
			'AB',
			'XYZ',
			'ABC'
		], { serviceCollection: serviceCollection }, async (editor) => {
			queryState = { 'editor.isRegex': false, 'editor.matchCase': false, 'editor.wholeWord': true };
			// The cursor is at the very top, of the file, at the first ABC
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			findController.toggleRegex();
			assert.equal(queryState['editor.isRegex'], true);

			findController.dispose();
		});
	});

	test('issue #27083: Update search scope once find widget becomes visible', async () => {
		await withAsyncTestCodeEditor([
			'var x = (3 * 5)',
			'var y = (3 * 5)',
			'var z = (3 * 5)',
		], { serviceCollection: serviceCollection, find: { autoFindInSelection: 'always', globalFindClipboard: false } }, async (editor) => {
			// clipboardState = '';
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);
			const findConfig: IFindStartOptions = {
				forceRevealReplace: false,
				seedSearchStringFromSelection: 'none',
				seedSearchStringFromGlobalClipboard: false,
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: false,
				updateSearchScope: true,
				loop: true
			};

			editor.setSelection(new Range(1, 1, 2, 1));
			findController.start(findConfig);
			assert.deepEqual(findController.getState().searchScope, [new Selection(1, 1, 2, 1)]);

			findController.closeFindWidget();

			editor.setSelections([new Selection(1, 1, 2, 1), new Selection(2, 1, 2, 5)]);
			findController.start(findConfig);
			assert.deepEqual(findController.getState().searchScope, [new Selection(1, 1, 2, 1), new Selection(2, 1, 2, 5)]);
		});
	});

	test('issue #58604: Do not update searchScope if it is empty', async () => {
		await withAsyncTestCodeEditor([
			'var x = (3 * 5)',
			'var y = (3 * 5)',
			'var z = (3 * 5)',
		], { serviceCollection: serviceCollection, find: { autoFindInSelection: 'always', globalFindClipboard: false } }, async (editor) => {
			// clipboardState = '';
			editor.setSelection(new Range(1, 2, 1, 2));
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);

			await findController.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: 'none',
				seedSearchStringFromGlobalClipboard: false,
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: false,
				updateSearchScope: true,
				loop: true
			});

			assert.deepEqual(findController.getState().searchScope, null);
		});
	});

	test('issue #58604: Update searchScope if it is not empty', async () => {
		await withAsyncTestCodeEditor([
			'var x = (3 * 5)',
			'var y = (3 * 5)',
			'var z = (3 * 5)',
		], { serviceCollection: serviceCollection, find: { autoFindInSelection: 'always', globalFindClipboard: false } }, async (editor) => {
			// clipboardState = '';
			editor.setSelection(new Range(1, 2, 1, 3));
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);

			await findController.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: 'none',
				seedSearchStringFromGlobalClipboard: false,
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: false,
				updateSearchScope: true,
				loop: true
			});

			assert.deepEqual(findController.getState().searchScope, [new Selection(1, 2, 1, 3)]);
		});
	});


	test('issue #27083: Find in selection when multiple lines are selected', async () => {
		await withAsyncTestCodeEditor([
			'var x = (3 * 5)',
			'var y = (3 * 5)',
			'var z = (3 * 5)',
		], { serviceCollection: serviceCollection, find: { autoFindInSelection: 'multiline', globalFindClipboard: false } }, async (editor) => {
			// clipboardState = '';
			editor.setSelection(new Range(1, 6, 2, 1));
			let findController = editor.registerAndInstantiateContribution(TestFindController.ID, TestFindController);

			await findController.start({
				forceRevealReplace: false,
				seedSearchStringFromSelection: 'none',
				seedSearchStringFromGlobalClipboard: false,
				shouldFocus: FindStartFocusAction.NoFocusChange,
				shouldAnimate: false,
				updateSearchScope: true,
				loop: true
			});

			assert.deepEqual(findController.getState().searchScope, [new Selection(1, 6, 2, 1)]);
		});
	});
});
