/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { Handler } from 'vs/editor/common/editorCommon';
import * as modes from 'vs/editor/common/modes';
import { LinkedEditingContribution } from 'vs/editor/contrib/linkedEditing/linkedEditing';
import { createTestCodeEditor, ITestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { CoreEditingCommands } from 'vs/editor/browser/controller/coreCommands';
import { ITextModel } from 'vs/editor/common/model';
import { USUAL_WORD_SEPARATORS } from 'vs/editor/common/model/wordHelper';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';

const mockFile = URI.parse('test:somefile.ttt');
const mockFileSelector = { scheme: 'test' };
const timeout = 30;

interface TestEditor {
	setPosition(pos: Position): Promise<any>;
	setSelection(sel: IRange): Promise<any>;
	trigger(source: string | null | undefined, handlerId: string, payload: any): Promise<any>;
	undo(): void;
	redo(): void;
}

const languageIdentifier = new modes.LanguageIdentifier('linkedEditingTestLangage', 74);
LanguageConfigurationRegistry.register(languageIdentifier, {
	wordPattern: /[a-zA-Z]+/
});

suite('linked editing', () => {
	const disposables = new DisposableStore();

	setup(() => {
		disposables.clear();
	});

	teardown(() => {
		disposables.clear();
	});

	function createMockEditor(text: string | string[]): ITestCodeEditor {
		const model = typeof text === 'string'
			? createTextModel(text, undefined, languageIdentifier, mockFile)
			: createTextModel(text.join('\n'), undefined, languageIdentifier, mockFile);

		const editor = createTestCodeEditor({ model });
		disposables.add(model);
		disposables.add(editor);

		return editor;
	}


	function testCase(
		name: string,
		initialState: { text: string | string[], responseWordPattern?: RegExp },
		operations: (editor: TestEditor) => Promise<void>,
		expectedEndText: string | string[]
	) {
		test(name, async () => {
			disposables.add(modes.LinkedEditingRangeProviderRegistry.register(mockFileSelector, {
				provideLinkedEditingRanges(model: ITextModel, pos: IPosition) {
					const wordAtPos = model.getWordAtPosition(pos);
					if (wordAtPos) {
						const matches = model.findMatches(wordAtPos.word, false, false, true, USUAL_WORD_SEPARATORS, false);
						return { ranges: matches.map(m => m.range), wordPattern: initialState.responseWordPattern };
					}
					return { ranges: [], wordPattern: initialState.responseWordPattern };
				}
			}));

			const editor = createMockEditor(initialState.text);
			editor.updateOptions({ linkedEditing: true });
			const linkedEditingContribution = editor.registerAndInstantiateContribution(
				LinkedEditingContribution.ID,
				LinkedEditingContribution
			);
			linkedEditingContribution.setDebounceDuration(0);

			const testEditor: TestEditor = {
				setPosition(pos: Position) {
					editor.setPosition(pos);
					return linkedEditingContribution.currentUpdateTriggerPromise;
				},
				setSelection(sel: IRange) {
					editor.setSelection(sel);
					return linkedEditingContribution.currentUpdateTriggerPromise;
				},
				trigger(source: string | null | undefined, handlerId: string, payload: any) {
					editor.trigger(source, handlerId, payload);
					return linkedEditingContribution.currentSyncTriggerPromise;
				},
				undo() {
					CoreEditingCommands.Undo.runEditorCommand(null, editor, null);
				},
				redo() {
					CoreEditingCommands.Redo.runEditorCommand(null, editor, null);
				}
			};

			await operations(testEditor);

			return new Promise<void>((resolve) => {
				setTimeout(() => {
					if (typeof expectedEndText === 'string') {
						assert.strictEqual(editor.getModel()!.getValue(), expectedEndText);
					} else {
						assert.strictEqual(editor.getModel()!.getValue(), expectedEndText.join('\n'));
					}
					resolve();
				}, timeout);
			});
		});
	}

	const state = {
		text: '<ooo></ooo>'
	};

	/**
	 * Simple insertion
	 */
	testCase('Simple insert - initial', state, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<iooo></iooo>');

	testCase('Simple insert - middle', state, async (editor) => {
		const pos = new Position(1, 3);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<oioo></oioo>');

	testCase('Simple insert - end', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<oooi></oooi>');

	/**
	 * Simple insertion - end
	 */
	testCase('Simple insert end - initial', state, async (editor) => {
		const pos = new Position(1, 8);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<iooo></iooo>');

	testCase('Simple insert end - middle', state, async (editor) => {
		const pos = new Position(1, 9);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<oioo></oioo>');

	testCase('Simple insert end - end', state, async (editor) => {
		const pos = new Position(1, 11);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<oooi></oooi>');

	/**
	 * Boundary insertion
	 */
	testCase('Simple insert - out of boundary', state, async (editor) => {
		const pos = new Position(1, 1);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, 'i<ooo></ooo>');

	testCase('Simple insert - out of boundary 2', state, async (editor) => {
		const pos = new Position(1, 6);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<ooo>i</ooo>');

	testCase('Simple insert - out of boundary 3', state, async (editor) => {
		const pos = new Position(1, 7);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<ooo><i/ooo>');

	testCase('Simple insert - out of boundary 4', state, async (editor) => {
		const pos = new Position(1, 12);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<ooo></ooo>i');

	/**
	 * Insert + Move
	 */
	testCase('Continuous insert', state, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<iiooo></iiooo>');

	testCase('Insert - move - insert', state, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
		await editor.setPosition(new Position(1, 4));
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<ioioo></ioioo>');

	testCase('Insert - move - insert outside region', state, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
		await editor.setPosition(new Position(1, 7));
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<iooo>i</iooo>');

	/**
	 * Selection insert
	 */
	testCase('Selection insert - simple', state, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.setSelection(new Range(1, 2, 1, 3));
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<ioo></ioo>');

	testCase('Selection insert - whole', state, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.setSelection(new Range(1, 2, 1, 5));
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<i></i>');

	testCase('Selection insert - across boundary', state, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.setSelection(new Range(1, 1, 1, 3));
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, 'ioo></oo>');

	/**
	 * @todo
	 * Undefined behavior
	 */
	// testCase('Selection insert - across two boundary', state, async (editor) => {
	// 	const pos = new Position(1, 2);
	// 	await editor.setPosition(pos);
	// 	await linkedEditingContribution.updateLinkedUI(pos);
	// 	await editor.setSelection(new Range(1, 4, 1, 9));
	// 	await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	// }, '<ooioo>');

	/**
	 * Break out behavior
	 */
	testCase('Breakout - type space', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: ' ' });
	}, '<ooo ></ooo>');

	testCase('Breakout - type space then undo', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: ' ' });
		editor.undo();
	}, '<ooo></ooo>');

	testCase('Breakout - type space in middle', state, async (editor) => {
		const pos = new Position(1, 4);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: ' ' });
	}, '<oo o></ooo>');

	testCase('Breakout - paste content starting with space', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Paste, { text: ' i="i"' });
	}, '<ooo i="i"></ooo>');

	testCase('Breakout - paste content starting with space then undo', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Paste, { text: ' i="i"' });
		editor.undo();
	}, '<ooo></ooo>');

	testCase('Breakout - paste content starting with space in middle', state, async (editor) => {
		const pos = new Position(1, 4);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Paste, { text: ' i' });
	}, '<oo io></ooo>');

	/**
	 * Break out with custom provider wordPattern
	 */

	const state3 = {
		...state,
		responseWordPattern: /[a-yA-Y]+/
	};

	testCase('Breakout with stop pattern - insert', state3, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<iooo></iooo>');

	testCase('Breakout with stop pattern - insert stop char', state3, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'z' });
	}, '<zooo></ooo>');

	testCase('Breakout with stop pattern - paste char', state3, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Paste, { text: 'z' });
	}, '<zooo></ooo>');

	testCase('Breakout with stop pattern - paste string', state3, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Paste, { text: 'zo' });
	}, '<zoooo></ooo>');

	testCase('Breakout with stop pattern - insert at end', state3, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'z' });
	}, '<oooz></ooo>');

	const state4 = {
		...state,
		responseWordPattern: /[a-eA-E]+/
	};

	testCase('Breakout with stop pattern - insert stop char, respos', state4, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, '<iooo></ooo>');

	/**
	 * Delete
	 */
	testCase('Delete - left char', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', 'deleteLeft', {});
	}, '<oo></oo>');

	testCase('Delete - left char then undo', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', 'deleteLeft', {});
		editor.undo();
	}, '<ooo></ooo>');

	testCase('Delete - left word', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', 'deleteWordLeft', {});
	}, '<></>');

	testCase('Delete - left word then undo', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', 'deleteWordLeft', {});
		editor.undo();
		editor.undo();
	}, '<ooo></ooo>');

	/**
	 * Todo: Fix test
	 */
	// testCase('Delete - left all', state, async (editor) => {
	// 	const pos = new Position(1, 3);
	// 	await editor.setPosition(pos);
	// 	await linkedEditingContribution.updateLinkedUI(pos);
	// 	await editor.trigger('keyboard', 'deleteAllLeft', {});
	// }, '></>');

	/**
	 * Todo: Fix test
	 */
	// testCase('Delete - left all then undo', state, async (editor) => {
	// 	const pos = new Position(1, 5);
	// 	await editor.setPosition(pos);
	// 	await linkedEditingContribution.updateLinkedUI(pos);
	// 	await editor.trigger('keyboard', 'deleteAllLeft', {});
	// 	editor.undo();
	// }, '></ooo>');

	testCase('Delete - left all then undo twice', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', 'deleteAllLeft', {});
		editor.undo();
		editor.undo();
	}, '<ooo></ooo>');

	testCase('Delete - selection', state, async (editor) => {
		const pos = new Position(1, 5);
		await editor.setPosition(pos);
		await editor.setSelection(new Range(1, 2, 1, 3));
		await editor.trigger('keyboard', 'deleteLeft', {});
	}, '<oo></oo>');

	testCase('Delete - selection across boundary', state, async (editor) => {
		const pos = new Position(1, 3);
		await editor.setPosition(pos);
		await editor.setSelection(new Range(1, 1, 1, 3));
		await editor.trigger('keyboard', 'deleteLeft', {});
	}, 'oo></oo>');

	/**
	 * Undo / redo
	 */
	testCase('Undo/redo - simple undo', state, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
		editor.undo();
		editor.undo();
	}, '<ooo></ooo>');

	testCase('Undo/redo - simple undo/redo', state, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
		editor.undo();
		editor.redo();
	}, '<iooo></iooo>');

	/**
	 * Multi line
	 */
	const state2 = {
		text: [
			'<ooo>',
			'</ooo>'
		]
	};

	testCase('Multiline insert', state2, async (editor) => {
		const pos = new Position(1, 2);
		await editor.setPosition(pos);
		await editor.trigger('keyboard', Handler.Type, { text: 'i' });
	}, [
		'<iooo>',
		'</iooo>'
	]);
});
