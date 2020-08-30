/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorCommand } from 'vs/editor/browser/editorExtensions';
import { Position } from 'vs/editor/common/core/position';
import { deserializePipePositions, serializePipePositions, testRepeatedActionAndExtractPositions } from 'vs/editor/contrib/wordOperations/test/wordTestUtils';
import { CursorWordPartLeft, CursorWordPartLeftSelect, CursorWordPartRight, CursorWordPartRightSelect, DeleteWordPartLeft, DeleteWordPartRight } from 'vs/editor/contrib/wordPartOperations/wordPartOperations';

suite('WordPartOperations', () => {
	const _deleteWordPartLeft = new DeleteWordPartLeft();
	const _deleteWordPartRight = new DeleteWordPartRight();
	const _cursorWordPartLeft = new CursorWordPartLeft();
	const _cursorWordPartLeftSelect = new CursorWordPartLeftSelect();
	const _cursorWordPartRight = new CursorWordPartRight();
	const _cursorWordPartRightSelect = new CursorWordPartRightSelect();

	function runEditorCommand(editor: ICodeEditor, command: EditorCommand): void {
		command.runEditorCommand(null, editor, null);
	}
	function cursorWordPartLeft(editor: ICodeEditor, inSelectionmode: boolean = false): void {
		runEditorCommand(editor, inSelectionmode ? _cursorWordPartLeftSelect : _cursorWordPartLeft);
	}
	function cursorWordPartRight(editor: ICodeEditor, inSelectionmode: boolean = false): void {
		runEditorCommand(editor, inSelectionmode ? _cursorWordPartRightSelect : _cursorWordPartRight);
	}
	function deleteWordPartLeft(editor: ICodeEditor): void {
		runEditorCommand(editor, _deleteWordPartLeft);
	}
	function deleteWordPartRight(editor: ICodeEditor): void {
		runEditorCommand(editor, _deleteWordPartRight);
	}

	test('cursorWordPartLeft - basic', () => {
		const EXPECTED = [
			'|start| |line|',
			'|this|Is|A|Camel|Case|Var|  |this_|is_|a_|snake_|case_|var| |THIS_|IS_|CAPS_|SNAKE| |this_|IS|Mixed|Use|',
			'|end| |line'
		].join('\n');
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1000, 1000),
			ed => cursorWordPartLeft(ed),
			ed => ed.getPosition()!,
			ed => ed.getPosition()!.equals(new Position(1, 1))
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('cursorWordPartLeft - issue #53899: whitespace', () => {
		const EXPECTED = '|myvar| |=| |\'|demonstration|     |of| |selection| |with| |space|\'';
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1000, 1000),
			ed => cursorWordPartLeft(ed),
			ed => ed.getPosition()!,
			ed => ed.getPosition()!.equals(new Position(1, 1))
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('cursorWordPartLeft - issue #53899: underscores', () => {
		const EXPECTED = '|myvar| |=| |\'|demonstration_____|of| |selection| |with| |space|\'';
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1000, 1000),
			ed => cursorWordPartLeft(ed),
			ed => ed.getPosition()!,
			ed => ed.getPosition()!.equals(new Position(1, 1))
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('cursorWordPartRight - basic', () => {
		const EXPECTED = [
			'start| |line|',
			'|this|Is|A|Camel|Case|Var|  |this|_is|_a|_snake|_case|_var| |THIS|_IS|_CAPS|_SNAKE| |this|_IS|Mixed|Use|',
			'|end| |line|'
		].join('\n');
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1, 1),
			ed => cursorWordPartRight(ed),
			ed => ed.getPosition()!,
			ed => ed.getPosition()!.equals(new Position(3, 9))
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('cursorWordPartRight - issue #53899: whitespace', () => {
		const EXPECTED = 'myvar| |=| |\'|demonstration|     |of| |selection| |with| |space|\'|';
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1, 1),
			ed => cursorWordPartRight(ed),
			ed => ed.getPosition()!,
			ed => ed.getPosition()!.equals(new Position(1, 52))
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('cursorWordPartRight - issue #53899: underscores', () => {
		const EXPECTED = 'myvar| |=| |\'|demonstration|_____of| |selection| |with| |space|\'|';
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1, 1),
			ed => cursorWordPartRight(ed),
			ed => ed.getPosition()!,
			ed => ed.getPosition()!.equals(new Position(1, 52))
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('cursorWordPartRight - issue #53899: second case', () => {
		const EXPECTED = [
			';| |--| |1|',
			'|;|        |--| |2|',
			'|;|    |#|3|',
			'|;|   |#|4|'
		].join('\n');
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1, 1),
			ed => cursorWordPartRight(ed),
			ed => ed.getPosition()!,
			ed => ed.getPosition()!.equals(new Position(4, 7))
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('issue #93239 - cursorWordPartRight', () => {
		const EXPECTED = [
			'foo|_bar|',
		].join('\n');
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1, 1),
			ed => cursorWordPartRight(ed),
			ed => ed.getPosition()!,
			ed => ed.getPosition()!.equals(new Position(1, 8))
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('issue #93239 - cursorWordPartLeft', () => {
		const EXPECTED = [
			'|foo_|bar',
		].join('\n');
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1, 8),
			ed => cursorWordPartLeft(ed),
			ed => ed.getPosition()!,
			ed => ed.getPosition()!.equals(new Position(1, 1))
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('deleteWordPartLeft - basic', () => {
		const EXPECTED = '|   |/*| |Just| |some| |text| |a|+=| |3| |+|5|-|3| |*/|  |this|Is|A|Camel|Case|Var|  |this_|is_|a_|snake_|case_|var| |THIS_|IS_|CAPS_|SNAKE| |this_|IS|Mixed|Use';
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1, 1000),
			ed => deleteWordPartLeft(ed),
			ed => ed.getPosition()!,
			ed => ed.getValue().length === 0
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});

	test('deleteWordPartRight - basic', () => {
		const EXPECTED = '   |/*| |Just| |some| |text| |a|+=| |3| |+|5|-|3| |*/|  |this|Is|A|Camel|Case|Var|  |this|_is|_a|_snake|_case|_var| |THIS|_IS|_CAPS|_SNAKE| |this|_IS|Mixed|Use|';
		const [text,] = deserializePipePositions(EXPECTED);
		const actualStops = testRepeatedActionAndExtractPositions(
			text,
			new Position(1, 1),
			ed => deleteWordPartRight(ed),
			ed => new Position(1, text.length - ed.getValue().length + 1),
			ed => ed.getValue().length === 0
		);
		const actual = serializePipePositions(text, actualStops);
		assert.deepEqual(actual, EXPECTED);
	});
});
