/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { LanguageIdentifier } from 'vs/editor/common/modes';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { BracketMatchingController } from 'vs/editor/contrib/bracketMatching/bracketMatching';
import { withTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { MockMode } from 'vs/editor/test/common/mocks/mockMode';

suite('bracket matching', () => {
	class BracketMode extends MockMode {

		private static readonly _id = new LanguageIdentifier('bracketMode', 3);

		constructor() {
			super(BracketMode._id);
			this._register(LanguageConfigurationRegistry.register(this.getLanguageIdentifier(), {
				brackets: [
					['{', '}'],
					['[', ']'],
					['(', ')'],
				]
			}));
		}
	}

	test('issue #183: jump to matching bracket position', () => {
		let mode = new BracketMode();
		let model = createTextModel('var x = (3 + (5-7)) + ((5+3)+5);', undefined, mode.getLanguageIdentifier());

		withTestCodeEditor(null, { model: model }, (editor) => {
			let bracketMatchingController = editor.registerAndInstantiateContribution(BracketMatchingController.ID, BracketMatchingController);

			// start on closing bracket
			editor.setPosition(new Position(1, 20));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 9));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 19));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 9));

			// start on opening bracket
			editor.setPosition(new Position(1, 23));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 31));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 23));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 31));

			bracketMatchingController.dispose();
		});

		model.dispose();
		mode.dispose();
	});

	test('Jump to next bracket', () => {
		let mode = new BracketMode();
		let model = createTextModel('var x = (3 + (5-7)); y();', undefined, mode.getLanguageIdentifier());

		withTestCodeEditor(null, { model: model }, (editor) => {
			let bracketMatchingController = editor.registerAndInstantiateContribution(BracketMatchingController.ID, BracketMatchingController);

			// start position between brackets
			editor.setPosition(new Position(1, 16));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 18));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 14));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 18));

			// skip brackets in comments
			editor.setPosition(new Position(1, 21));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 23));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 24));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 23));

			// do not break if no brackets are available
			editor.setPosition(new Position(1, 26));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getPosition(), new Position(1, 26));

			bracketMatchingController.dispose();
		});

		model.dispose();
		mode.dispose();
	});

	test('Select to next bracket', () => {
		let mode = new BracketMode();
		let model = createTextModel('var x = (3 + (5-7)); y();', undefined, mode.getLanguageIdentifier());

		withTestCodeEditor(null, { model: model }, (editor) => {
			let bracketMatchingController = editor.registerAndInstantiateContribution(BracketMatchingController.ID, BracketMatchingController);


			// start position in open brackets
			editor.setPosition(new Position(1, 9));
			bracketMatchingController.selectToBracket(true);
			assert.deepEqual(editor.getPosition(), new Position(1, 20));
			assert.deepEqual(editor.getSelection(), new Selection(1, 9, 1, 20));

			// start position in close brackets
			editor.setPosition(new Position(1, 20));
			bracketMatchingController.selectToBracket(true);
			assert.deepEqual(editor.getPosition(), new Position(1, 20));
			assert.deepEqual(editor.getSelection(), new Selection(1, 9, 1, 20));

			// start position between brackets
			editor.setPosition(new Position(1, 16));
			bracketMatchingController.selectToBracket(true);
			assert.deepEqual(editor.getPosition(), new Position(1, 19));
			assert.deepEqual(editor.getSelection(), new Selection(1, 14, 1, 19));

			// start position outside brackets
			editor.setPosition(new Position(1, 21));
			bracketMatchingController.selectToBracket(true);
			assert.deepEqual(editor.getPosition(), new Position(1, 25));
			assert.deepEqual(editor.getSelection(), new Selection(1, 23, 1, 25));

			// do not break if no brackets are available
			editor.setPosition(new Position(1, 26));
			bracketMatchingController.selectToBracket(true);
			assert.deepEqual(editor.getPosition(), new Position(1, 26));
			assert.deepEqual(editor.getSelection(), new Selection(1, 26, 1, 26));

			bracketMatchingController.dispose();
		});

		model.dispose();
		mode.dispose();
	});

	test('issue #1772: jump to enclosing brackets', () => {
		const text = [
			'const x = {',
			'    something: [0, 1, 2],',
			'    another: true,',
			'    somethingmore: [0, 2, 4]',
			'};',
		].join('\n');
		const mode = new BracketMode();
		const model = createTextModel(text, undefined, mode.getLanguageIdentifier());

		withTestCodeEditor(null, { model: model }, (editor) => {
			const bracketMatchingController = editor.registerAndInstantiateContribution(BracketMatchingController.ID, BracketMatchingController);

			editor.setPosition(new Position(3, 5));
			bracketMatchingController.jumpToBracket();
			assert.deepEqual(editor.getSelection(), new Selection(5, 1, 5, 1));

			bracketMatchingController.dispose();
		});

		model.dispose();
		mode.dispose();
	});

	test('issue #43371: argument to not select brackets', () => {
		const text = [
			'const x = {',
			'    something: [0, 1, 2],',
			'    another: true,',
			'    somethingmore: [0, 2, 4]',
			'};',
		].join('\n');
		const mode = new BracketMode();
		const model = createTextModel(text, undefined, mode.getLanguageIdentifier());

		withTestCodeEditor(null, { model: model }, (editor) => {
			const bracketMatchingController = editor.registerAndInstantiateContribution(BracketMatchingController.ID, BracketMatchingController);

			editor.setPosition(new Position(3, 5));
			bracketMatchingController.selectToBracket(false);
			assert.deepEqual(editor.getSelection(), new Selection(1, 12, 5, 1));

			bracketMatchingController.dispose();
		});

		model.dispose();
		mode.dispose();
	});

	test('issue #45369: Select to Bracket with multicursor', () => {
		let mode = new BracketMode();
		let model = createTextModel('{  }   {   }   { }', undefined, mode.getLanguageIdentifier());

		withTestCodeEditor(null, { model: model }, (editor) => {
			let bracketMatchingController = editor.registerAndInstantiateContribution(BracketMatchingController.ID, BracketMatchingController);

			// cursors inside brackets become selections of the entire bracket contents
			editor.setSelections([
				new Selection(1, 3, 1, 3),
				new Selection(1, 10, 1, 10),
				new Selection(1, 17, 1, 17)
			]);
			bracketMatchingController.selectToBracket(true);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 5),
				new Selection(1, 8, 1, 13),
				new Selection(1, 16, 1, 19)
			]);

			// cursors to the left of bracket pairs become selections of the entire pair
			editor.setSelections([
				new Selection(1, 1, 1, 1),
				new Selection(1, 6, 1, 6),
				new Selection(1, 14, 1, 14)
			]);
			bracketMatchingController.selectToBracket(true);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 5),
				new Selection(1, 8, 1, 13),
				new Selection(1, 16, 1, 19)
			]);

			// cursors just right of a bracket pair become selections of the entire pair
			editor.setSelections([
				new Selection(1, 5, 1, 5),
				new Selection(1, 13, 1, 13),
				new Selection(1, 19, 1, 19)
			]);
			bracketMatchingController.selectToBracket(true);
			assert.deepEqual(editor.getSelections(), [
				new Selection(1, 1, 1, 5),
				new Selection(1, 8, 1, 13),
				new Selection(1, 16, 1, 19)
			]);

			bracketMatchingController.dispose();
		});

		model.dispose();
		mode.dispose();
	});
});
