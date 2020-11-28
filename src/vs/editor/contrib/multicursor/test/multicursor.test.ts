/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { Event } from 'vs/base/common/event';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { Handler } from 'vs/editor/common/editorCommon';
import { EndOfLineSequence } from 'vs/editor/common/model';
import { CommonFindController } from 'vs/editor/contrib/find/findController';
import { AddSelectionToNextFindMatchAction, InsertCursorAbove, InsertCursorBelow, MultiCursorSelectionController, SelectHighlightsAction } from 'vs/editor/contrib/multicursor/multicursor';
import { ITestCodeEditor, withTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IStorageService } from 'vs/platform/storage/common/storage';

suite('Multicursor', () => {

	test('issue #2205: Multi-cursor pastes in reverse order', () => {
		withTestCodeEditor([
			'abc',
			'def'
		], {}, (editor, viewModel) => {
			let addCursorUpAction = new InsertCursorAbove();

			editor.setSelection(new Selection(2, 1, 2, 1));
			addCursorUpAction.run(null!, editor, {});
			assert.equal(viewModel.getSelections().length, 2);

			editor.trigger('test', Handler.Paste, {
				text: '1\n2',
				multicursorText: [
					'1',
					'2'
				]
			});

			assert.equal(editor.getModel()!.getLineContent(1), '1abc');
			assert.equal(editor.getModel()!.getLineContent(2), '2def');
		});
	});

	test('issue #1336: Insert cursor below on last line adds a cursor to the end of the current line', () => {
		withTestCodeEditor([
			'abc'
		], {}, (editor, viewModel) => {
			let addCursorDownAction = new InsertCursorBelow();
			addCursorDownAction.run(null!, editor, {});
			assert.equal(viewModel.getSelections().length, 1);
		});
	});

});

function fromRange(rng: Range): number[] {
	return [rng.startLineNumber, rng.startColumn, rng.endLineNumber, rng.endColumn];
}

suite('Multicursor selection', () => {
	let queryState: { [key: string]: any; } = {};
	let serviceCollection = new ServiceCollection();
	serviceCollection.set(IStorageService, {
		_serviceBrand: undefined,
		onDidChangeValue: Event.None,
		onDidChangeTarget: Event.None,
		onWillSaveState: Event.None,
		get: (key: string) => queryState[key],
		getBoolean: (key: string) => !!queryState[key],
		getNumber: (key: string) => undefined!,
		store: (key: string, value: any) => { queryState[key] = value; return Promise.resolve(); },
		remove: (key) => undefined,
		logStorage: () => undefined,
		migrate: (toWorkspace) => Promise.resolve(undefined),
		flush: () => Promise.resolve(undefined),
		isNew: () => true,
		keys: () => []
	} as IStorageService);

	test('issue #8817: Cursor position changes when you cancel multicursor', () => {
		withTestCodeEditor([
			'var x = (3 * 5)',
			'var y = (3 * 5)',
			'var z = (3 * 5)',
		], { serviceCollection: serviceCollection }, (editor) => {

			let findController = editor.registerAndInstantiateContribution(CommonFindController.ID, CommonFindController);
			let multiCursorSelectController = editor.registerAndInstantiateContribution(MultiCursorSelectionController.ID, MultiCursorSelectionController);
			let selectHighlightsAction = new SelectHighlightsAction();

			editor.setSelection(new Selection(2, 9, 2, 16));

			selectHighlightsAction.run(null!, editor);
			assert.deepEqual(editor.getSelections()!.map(fromRange), [
				[2, 9, 2, 16],
				[1, 9, 1, 16],
				[3, 9, 3, 16],
			]);

			editor.trigger('test', 'removeSecondaryCursors', null);

			assert.deepEqual(fromRange(editor.getSelection()!), [2, 9, 2, 16]);

			multiCursorSelectController.dispose();
			findController.dispose();
		});
	});

	test('issue #5400: "Select All Occurrences of Find Match" does not select all if find uses regex', () => {
		withTestCodeEditor([
			'something',
			'someething',
			'someeething',
			'nothing'
		], { serviceCollection: serviceCollection }, (editor) => {

			let findController = editor.registerAndInstantiateContribution(CommonFindController.ID, CommonFindController);
			let multiCursorSelectController = editor.registerAndInstantiateContribution(MultiCursorSelectionController.ID, MultiCursorSelectionController);
			let selectHighlightsAction = new SelectHighlightsAction();

			editor.setSelection(new Selection(1, 1, 1, 1));
			findController.getState().change({ searchString: 'some+thing', isRegex: true, isRevealed: true }, false);

			selectHighlightsAction.run(null!, editor);
			assert.deepEqual(editor.getSelections()!.map(fromRange), [
				[1, 1, 1, 10],
				[2, 1, 2, 11],
				[3, 1, 3, 12],
			]);

			assert.equal(findController.getState().searchString, 'some+thing');

			multiCursorSelectController.dispose();
			findController.dispose();
		});
	});

	test('AddSelectionToNextFindMatchAction can work with multiline', () => {
		withTestCodeEditor([
			'',
			'qwe',
			'rty',
			'',
			'qwe',
			'',
			'rty',
			'qwe',
			'rty'
		], { serviceCollection: serviceCollection }, (editor) => {

			let findController = editor.registerAndInstantiateContribution(CommonFindController.ID, CommonFindController);
			let multiCursorSelectController = editor.registerAndInstantiateContribution(MultiCursorSelectionController.ID, MultiCursorSelectionController);
			let addSelectionToNextFindMatch = new AddSelectionToNextFindMatchAction();

			editor.setSelection(new Selection(2, 1, 3, 4));

			addSelectionToNextFindMatch.run(null!, editor);
			assert.deepEqual(editor.getSelections()!.map(fromRange), [
				[2, 1, 3, 4],
				[8, 1, 9, 4]
			]);

			editor.trigger('test', 'removeSecondaryCursors', null);

			assert.deepEqual(fromRange(editor.getSelection()!), [2, 1, 3, 4]);

			multiCursorSelectController.dispose();
			findController.dispose();
		});
	});

	test('issue #6661: AddSelectionToNextFindMatchAction can work with touching ranges', () => {
		withTestCodeEditor([
			'abcabc',
			'abc',
			'abcabc',
		], { serviceCollection: serviceCollection }, (editor) => {

			let findController = editor.registerAndInstantiateContribution(CommonFindController.ID, CommonFindController);
			let multiCursorSelectController = editor.registerAndInstantiateContribution(MultiCursorSelectionController.ID, MultiCursorSelectionController);
			let addSelectionToNextFindMatch = new AddSelectionToNextFindMatchAction();

			editor.setSelection(new Selection(1, 1, 1, 4));

			addSelectionToNextFindMatch.run(null!, editor);
			assert.deepEqual(editor.getSelections()!.map(fromRange), [
				[1, 1, 1, 4],
				[1, 4, 1, 7]
			]);

			addSelectionToNextFindMatch.run(null!, editor);
			addSelectionToNextFindMatch.run(null!, editor);
			addSelectionToNextFindMatch.run(null!, editor);
			assert.deepEqual(editor.getSelections()!.map(fromRange), [
				[1, 1, 1, 4],
				[1, 4, 1, 7],
				[2, 1, 2, 4],
				[3, 1, 3, 4],
				[3, 4, 3, 7]
			]);

			editor.trigger('test', Handler.Type, { text: 'z' });
			assert.deepEqual(editor.getSelections()!.map(fromRange), [
				[1, 2, 1, 2],
				[1, 3, 1, 3],
				[2, 2, 2, 2],
				[3, 2, 3, 2],
				[3, 3, 3, 3]
			]);
			assert.equal(editor.getValue(), [
				'zz',
				'z',
				'zz',
			].join('\n'));

			multiCursorSelectController.dispose();
			findController.dispose();
		});
	});

	test('issue #23541: Multiline Ctrl+D does not work in CRLF files', () => {
		withTestCodeEditor([
			'',
			'qwe',
			'rty',
			'',
			'qwe',
			'',
			'rty',
			'qwe',
			'rty'
		], { serviceCollection: serviceCollection }, (editor) => {

			editor.getModel()!.setEOL(EndOfLineSequence.CRLF);

			let findController = editor.registerAndInstantiateContribution(CommonFindController.ID, CommonFindController);
			let multiCursorSelectController = editor.registerAndInstantiateContribution(MultiCursorSelectionController.ID, MultiCursorSelectionController);
			let addSelectionToNextFindMatch = new AddSelectionToNextFindMatchAction();

			editor.setSelection(new Selection(2, 1, 3, 4));

			addSelectionToNextFindMatch.run(null!, editor);
			assert.deepEqual(editor.getSelections()!.map(fromRange), [
				[2, 1, 3, 4],
				[8, 1, 9, 4]
			]);

			editor.trigger('test', 'removeSecondaryCursors', null);

			assert.deepEqual(fromRange(editor.getSelection()!), [2, 1, 3, 4]);

			multiCursorSelectController.dispose();
			findController.dispose();
		});
	});

	function testMulticursor(text: string[], callback: (editor: ITestCodeEditor, findController: CommonFindController) => void): void {
		withTestCodeEditor(text, { serviceCollection: serviceCollection }, (editor) => {
			let findController = editor.registerAndInstantiateContribution(CommonFindController.ID, CommonFindController);
			let multiCursorSelectController = editor.registerAndInstantiateContribution(MultiCursorSelectionController.ID, MultiCursorSelectionController);

			callback(editor, findController);

			multiCursorSelectController.dispose();
			findController.dispose();
		});
	}

	function testAddSelectionToNextFindMatchAction(text: string[], callback: (editor: ITestCodeEditor, action: AddSelectionToNextFindMatchAction, findController: CommonFindController) => void): void {
		testMulticursor(text, (editor, findController) => {
			let action = new AddSelectionToNextFindMatchAction();
			callback(editor, action, findController);
		});
	}

	test('AddSelectionToNextFindMatchAction starting with single collapsed selection', () => {
		const text = [
			'abc pizza',
			'abc house',
			'abc bar'
		];
		testAddSelectionToNextFindMatchAction(text, (editor, action, findController) => {
			editor.setSelections([
				new Selection(1, 2, 1, 2),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
				new Selection(3, 1, 3, 4),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
				new Selection(3, 1, 3, 4),
			]);
		});
	});

	test('AddSelectionToNextFindMatchAction starting with two selections, one being collapsed 1)', () => {
		const text = [
			'abc pizza',
			'abc house',
			'abc bar'
		];
		testAddSelectionToNextFindMatchAction(text, (editor, action, findController) => {
			editor.setSelections([
				new Selection(1, 1, 1, 4),
				new Selection(2, 2, 2, 2),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
				new Selection(3, 1, 3, 4),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
				new Selection(3, 1, 3, 4),
			]);
		});
	});

	test('AddSelectionToNextFindMatchAction starting with two selections, one being collapsed 2)', () => {
		const text = [
			'abc pizza',
			'abc house',
			'abc bar'
		];
		testAddSelectionToNextFindMatchAction(text, (editor, action, findController) => {
			editor.setSelections([
				new Selection(1, 2, 1, 2),
				new Selection(2, 1, 2, 4),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
				new Selection(3, 1, 3, 4),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
				new Selection(3, 1, 3, 4),
			]);
		});
	});

	test('AddSelectionToNextFindMatchAction starting with all collapsed selections', () => {
		const text = [
			'abc pizza',
			'abc house',
			'abc bar'
		];
		testAddSelectionToNextFindMatchAction(text, (editor, action, findController) => {
			editor.setSelections([
				new Selection(1, 2, 1, 2),
				new Selection(2, 2, 2, 2),
				new Selection(3, 1, 3, 1),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
				new Selection(3, 1, 3, 4),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 4),
				new Selection(2, 1, 2, 4),
				new Selection(3, 1, 3, 4),
			]);
		});
	});

	test('AddSelectionToNextFindMatchAction starting with all collapsed selections on different words', () => {
		const text = [
			'abc pizza',
			'abc house',
			'abc bar'
		];
		testAddSelectionToNextFindMatchAction(text, (editor, action, findController) => {
			editor.setSelections([
				new Selection(1, 6, 1, 6),
				new Selection(2, 6, 2, 6),
				new Selection(3, 6, 3, 6),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 5, 1, 10),
				new Selection(2, 5, 2, 10),
				new Selection(3, 5, 3, 8),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 5, 1, 10),
				new Selection(2, 5, 2, 10),
				new Selection(3, 5, 3, 8),
			]);
		});
	});

	test('issue #20651: AddSelectionToNextFindMatchAction case insensitive', () => {
		const text = [
			'test',
			'testte',
			'Test',
			'testte',
			'test'
		];
		testAddSelectionToNextFindMatchAction(text, (editor, action, findController) => {
			editor.setSelections([
				new Selection(1, 1, 1, 5),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 5),
				new Selection(2, 1, 2, 5),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 5),
				new Selection(2, 1, 2, 5),
				new Selection(3, 1, 3, 5),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 5),
				new Selection(2, 1, 2, 5),
				new Selection(3, 1, 3, 5),
				new Selection(4, 1, 4, 5),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 5),
				new Selection(2, 1, 2, 5),
				new Selection(3, 1, 3, 5),
				new Selection(4, 1, 4, 5),
				new Selection(5, 1, 5, 5),
			]);

			action.run(null!, editor);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 5),
				new Selection(2, 1, 2, 5),
				new Selection(3, 1, 3, 5),
				new Selection(4, 1, 4, 5),
				new Selection(5, 1, 5, 5),
			]);
		});
	});

	suite('Find state disassociation', () => {

		const text = [
			'app',
			'apples',
			'whatsapp',
			'app',
			'App',
			' app'
		];

		test('enters mode', () => {
			testAddSelectionToNextFindMatchAction(text, (editor, action, findController) => {
				editor.setSelections([
					new Selection(1, 2, 1, 2),
				]);

				action.run(null!, editor);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 1, 1, 4),
				]);

				action.run(null!, editor);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 1, 1, 4),
					new Selection(4, 1, 4, 4),
				]);

				action.run(null!, editor);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 1, 1, 4),
					new Selection(4, 1, 4, 4),
					new Selection(6, 2, 6, 5),
				]);
			});
		});

		test('leaves mode when selection changes', () => {
			testAddSelectionToNextFindMatchAction(text, (editor, action, findController) => {
				editor.setSelections([
					new Selection(1, 2, 1, 2),
				]);

				action.run(null!, editor);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 1, 1, 4),
				]);

				action.run(null!, editor);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 1, 1, 4),
					new Selection(4, 1, 4, 4),
				]);

				// change selection
				editor.setSelections([
					new Selection(1, 1, 1, 4),
				]);

				action.run(null!, editor);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 1, 1, 4),
					new Selection(2, 1, 2, 4),
				]);
			});
		});

		test('Select Highlights respects mode ', () => {
			testMulticursor(text, (editor, findController) => {
				let action = new SelectHighlightsAction();
				editor.setSelections([
					new Selection(1, 2, 1, 2),
				]);

				action.run(null!, editor);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 1, 1, 4),
					new Selection(4, 1, 4, 4),
					new Selection(6, 2, 6, 5),
				]);

				action.run(null!, editor);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 1, 1, 4),
					new Selection(4, 1, 4, 4),
					new Selection(6, 2, 6, 5),
				]);
			});
		});

	});
});
