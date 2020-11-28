/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { DiffComputer } from 'vs/editor/common/diff/diffComputer';
import { IChange, ICharChange, ILineChange } from 'vs/editor/common/editorCommon';

function extractCharChangeRepresentation(change: ICharChange, expectedChange: ICharChange | null): ICharChange {
	let hasOriginal = expectedChange && expectedChange.originalStartLineNumber > 0;
	let hasModified = expectedChange && expectedChange.modifiedStartLineNumber > 0;
	return {
		originalStartLineNumber: hasOriginal ? change.originalStartLineNumber : 0,
		originalStartColumn: hasOriginal ? change.originalStartColumn : 0,
		originalEndLineNumber: hasOriginal ? change.originalEndLineNumber : 0,
		originalEndColumn: hasOriginal ? change.originalEndColumn : 0,

		modifiedStartLineNumber: hasModified ? change.modifiedStartLineNumber : 0,
		modifiedStartColumn: hasModified ? change.modifiedStartColumn : 0,
		modifiedEndLineNumber: hasModified ? change.modifiedEndLineNumber : 0,
		modifiedEndColumn: hasModified ? change.modifiedEndColumn : 0,
	};
}

function extractLineChangeRepresentation(change: ILineChange, expectedChange: ILineChange): IChange | ILineChange {
	if (change.charChanges) {
		let charChanges: ICharChange[] = [];
		for (let i = 0; i < change.charChanges.length; i++) {
			charChanges.push(
				extractCharChangeRepresentation(
					change.charChanges[i],
					expectedChange && expectedChange.charChanges && i < expectedChange.charChanges.length ? expectedChange.charChanges[i] : null
				)
			);
		}
		return {
			originalStartLineNumber: change.originalStartLineNumber,
			originalEndLineNumber: change.originalEndLineNumber,
			modifiedStartLineNumber: change.modifiedStartLineNumber,
			modifiedEndLineNumber: change.modifiedEndLineNumber,
			charChanges: charChanges
		};
	}
	return {
		originalStartLineNumber: change.originalStartLineNumber,
		originalEndLineNumber: change.originalEndLineNumber,
		modifiedStartLineNumber: change.modifiedStartLineNumber,
		modifiedEndLineNumber: change.modifiedEndLineNumber,
		charChanges: undefined
	};
}

function assertDiff(originalLines: string[], modifiedLines: string[], expectedChanges: IChange[], shouldComputeCharChanges: boolean = true, shouldPostProcessCharChanges: boolean = false, shouldIgnoreTrimWhitespace: boolean = false) {
	let diffComputer = new DiffComputer(originalLines, modifiedLines, {
		shouldComputeCharChanges,
		shouldPostProcessCharChanges,
		shouldIgnoreTrimWhitespace,
		shouldMakePrettyDiff: true,
		maxComputationTime: 0
	});
	let changes = diffComputer.computeDiff().changes;

	let extracted: IChange[] = [];
	for (let i = 0; i < changes.length; i++) {
		extracted.push(extractLineChangeRepresentation(changes[i], <ILineChange>(i < expectedChanges.length ? expectedChanges[i] : null)));
	}
	assert.deepEqual(extracted, expectedChanges);
}

function createLineDeletion(startLineNumber: number, endLineNumber: number, modifiedLineNumber: number): ILineChange {
	return {
		originalStartLineNumber: startLineNumber,
		originalEndLineNumber: endLineNumber,
		modifiedStartLineNumber: modifiedLineNumber,
		modifiedEndLineNumber: 0,
		charChanges: undefined
	};
}

function createLineInsertion(startLineNumber: number, endLineNumber: number, originalLineNumber: number): ILineChange {
	return {
		originalStartLineNumber: originalLineNumber,
		originalEndLineNumber: 0,
		modifiedStartLineNumber: startLineNumber,
		modifiedEndLineNumber: endLineNumber,
		charChanges: undefined
	};
}

function createLineChange(originalStartLineNumber: number, originalEndLineNumber: number, modifiedStartLineNumber: number, modifiedEndLineNumber: number, charChanges?: ICharChange[]): ILineChange {
	return {
		originalStartLineNumber: originalStartLineNumber,
		originalEndLineNumber: originalEndLineNumber,
		modifiedStartLineNumber: modifiedStartLineNumber,
		modifiedEndLineNumber: modifiedEndLineNumber,
		charChanges: charChanges
	};
}

function createCharInsertion(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
	return {
		originalStartLineNumber: 0,
		originalStartColumn: 0,
		originalEndLineNumber: 0,
		originalEndColumn: 0,
		modifiedStartLineNumber: startLineNumber,
		modifiedStartColumn: startColumn,
		modifiedEndLineNumber: endLineNumber,
		modifiedEndColumn: endColumn
	};
}

function createCharDeletion(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number) {
	return {
		originalStartLineNumber: startLineNumber,
		originalStartColumn: startColumn,
		originalEndLineNumber: endLineNumber,
		originalEndColumn: endColumn,
		modifiedStartLineNumber: 0,
		modifiedStartColumn: 0,
		modifiedEndLineNumber: 0,
		modifiedEndColumn: 0
	};
}

function createCharChange(
	originalStartLineNumber: number, originalStartColumn: number, originalEndLineNumber: number, originalEndColumn: number,
	modifiedStartLineNumber: number, modifiedStartColumn: number, modifiedEndLineNumber: number, modifiedEndColumn: number
) {
	return {
		originalStartLineNumber: originalStartLineNumber,
		originalStartColumn: originalStartColumn,
		originalEndLineNumber: originalEndLineNumber,
		originalEndColumn: originalEndColumn,
		modifiedStartLineNumber: modifiedStartLineNumber,
		modifiedStartColumn: modifiedStartColumn,
		modifiedEndLineNumber: modifiedEndLineNumber,
		modifiedEndColumn: modifiedEndColumn
	};
}

suite('Editor Diff - DiffComputer', () => {

	// ---- insertions

	test('one inserted line below', () => {
		let original = ['line'];
		let modified = ['line', 'new line'];
		let expected = [createLineInsertion(2, 2, 1)];
		assertDiff(original, modified, expected);
	});

	test('two inserted lines below', () => {
		let original = ['line'];
		let modified = ['line', 'new line', 'another new line'];
		let expected = [createLineInsertion(2, 3, 1)];
		assertDiff(original, modified, expected);
	});

	test('one inserted line above', () => {
		let original = ['line'];
		let modified = ['new line', 'line'];
		let expected = [createLineInsertion(1, 1, 0)];
		assertDiff(original, modified, expected);
	});

	test('two inserted lines above', () => {
		let original = ['line'];
		let modified = ['new line', 'another new line', 'line'];
		let expected = [createLineInsertion(1, 2, 0)];
		assertDiff(original, modified, expected);
	});

	test('one inserted line in middle', () => {
		let original = ['line1', 'line2', 'line3', 'line4'];
		let modified = ['line1', 'line2', 'new line', 'line3', 'line4'];
		let expected = [createLineInsertion(3, 3, 2)];
		assertDiff(original, modified, expected);
	});

	test('two inserted lines in middle', () => {
		let original = ['line1', 'line2', 'line3', 'line4'];
		let modified = ['line1', 'line2', 'new line', 'another new line', 'line3', 'line4'];
		let expected = [createLineInsertion(3, 4, 2)];
		assertDiff(original, modified, expected);
	});

	test('two inserted lines in middle interrupted', () => {
		let original = ['line1', 'line2', 'line3', 'line4'];
		let modified = ['line1', 'line2', 'new line', 'line3', 'another new line', 'line4'];
		let expected = [createLineInsertion(3, 3, 2), createLineInsertion(5, 5, 3)];
		assertDiff(original, modified, expected);
	});

	// ---- deletions

	test('one deleted line below', () => {
		let original = ['line', 'new line'];
		let modified = ['line'];
		let expected = [createLineDeletion(2, 2, 1)];
		assertDiff(original, modified, expected);
	});

	test('two deleted lines below', () => {
		let original = ['line', 'new line', 'another new line'];
		let modified = ['line'];
		let expected = [createLineDeletion(2, 3, 1)];
		assertDiff(original, modified, expected);
	});

	test('one deleted lines above', () => {
		let original = ['new line', 'line'];
		let modified = ['line'];
		let expected = [createLineDeletion(1, 1, 0)];
		assertDiff(original, modified, expected);
	});

	test('two deleted lines above', () => {
		let original = ['new line', 'another new line', 'line'];
		let modified = ['line'];
		let expected = [createLineDeletion(1, 2, 0)];
		assertDiff(original, modified, expected);
	});

	test('one deleted line in middle', () => {
		let original = ['line1', 'line2', 'new line', 'line3', 'line4'];
		let modified = ['line1', 'line2', 'line3', 'line4'];
		let expected = [createLineDeletion(3, 3, 2)];
		assertDiff(original, modified, expected);
	});

	test('two deleted lines in middle', () => {
		let original = ['line1', 'line2', 'new line', 'another new line', 'line3', 'line4'];
		let modified = ['line1', 'line2', 'line3', 'line4'];
		let expected = [createLineDeletion(3, 4, 2)];
		assertDiff(original, modified, expected);
	});

	test('two deleted lines in middle interrupted', () => {
		let original = ['line1', 'line2', 'new line', 'line3', 'another new line', 'line4'];
		let modified = ['line1', 'line2', 'line3', 'line4'];
		let expected = [createLineDeletion(3, 3, 2), createLineDeletion(5, 5, 3)];
		assertDiff(original, modified, expected);
	});

	// ---- changes

	test('one line changed: chars inserted at the end', () => {
		let original = ['line'];
		let modified = ['line changed'];
		let expected = [
			createLineChange(1, 1, 1, 1, [
				createCharInsertion(1, 5, 1, 13)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('one line changed: chars inserted at the beginning', () => {
		let original = ['line'];
		let modified = ['my line'];
		let expected = [
			createLineChange(1, 1, 1, 1, [
				createCharInsertion(1, 1, 1, 4)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('one line changed: chars inserted in the middle', () => {
		let original = ['abba'];
		let modified = ['abzzba'];
		let expected = [
			createLineChange(1, 1, 1, 1, [
				createCharInsertion(1, 3, 1, 5)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('one line changed: chars inserted in the middle (two spots)', () => {
		let original = ['abba'];
		let modified = ['abzzbzza'];
		let expected = [
			createLineChange(1, 1, 1, 1, [
				createCharInsertion(1, 3, 1, 5),
				createCharInsertion(1, 6, 1, 8)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('one line changed: chars deleted 1', () => {
		let original = ['abcdefg'];
		let modified = ['abcfg'];
		let expected = [
			createLineChange(1, 1, 1, 1, [
				createCharDeletion(1, 4, 1, 6)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('one line changed: chars deleted 2', () => {
		let original = ['abcdefg'];
		let modified = ['acfg'];
		let expected = [
			createLineChange(1, 1, 1, 1, [
				createCharDeletion(1, 2, 1, 3),
				createCharDeletion(1, 4, 1, 6)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('two lines changed 1', () => {
		let original = ['abcd', 'efgh'];
		let modified = ['abcz'];
		let expected = [
			createLineChange(1, 2, 1, 1, [
				createCharChange(1, 4, 2, 5, 1, 4, 1, 5)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('two lines changed 2', () => {
		let original = ['foo', 'abcd', 'efgh', 'BAR'];
		let modified = ['foo', 'abcz', 'BAR'];
		let expected = [
			createLineChange(2, 3, 2, 2, [
				createCharChange(2, 4, 3, 5, 2, 4, 2, 5)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('two lines changed 3', () => {
		let original = ['foo', 'abcd', 'efgh', 'BAR'];
		let modified = ['foo', 'abcz', 'zzzzefgh', 'BAR'];
		let expected = [
			createLineChange(2, 3, 2, 3, [
				createCharChange(2, 4, 2, 5, 2, 4, 3, 5)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('three lines changed', () => {
		let original = ['foo', 'abcd', 'efgh', 'BAR'];
		let modified = ['foo', 'zzzefgh', 'xxx', 'BAR'];
		let expected = [
			createLineChange(2, 3, 2, 3, [
				createCharChange(2, 1, 2, 5, 2, 1, 2, 4),
				createCharInsertion(3, 1, 3, 4)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('big change part 1', () => {
		let original = ['foo', 'abcd', 'efgh', 'BAR'];
		let modified = ['hello', 'foo', 'zzzefgh', 'xxx', 'BAR'];
		let expected = [
			createLineInsertion(1, 1, 0),
			createLineChange(2, 3, 3, 4, [
				createCharChange(2, 1, 2, 5, 3, 1, 3, 4),
				createCharInsertion(4, 1, 4, 4)
			])
		];
		assertDiff(original, modified, expected);
	});

	test('big change part 2', () => {
		let original = ['foo', 'abcd', 'efgh', 'BAR', 'RAB'];
		let modified = ['hello', 'foo', 'zzzefgh', 'xxx', 'BAR'];
		let expected = [
			createLineInsertion(1, 1, 0),
			createLineChange(2, 3, 3, 4, [
				createCharChange(2, 1, 2, 5, 3, 1, 3, 4),
				createCharInsertion(4, 1, 4, 4)
			]),
			createLineDeletion(5, 5, 5)
		];
		assertDiff(original, modified, expected);
	});

	test('char change postprocessing merges', () => {
		let original = ['abba'];
		let modified = ['azzzbzzzbzzza'];
		let expected = [
			createLineChange(1, 1, 1, 1, [
				createCharChange(1, 2, 1, 4, 1, 2, 1, 13)
			])
		];
		assertDiff(original, modified, expected, true, true);
	});

	test('ignore trim whitespace', () => {
		let original = ['\t\t foo ', 'abcd', 'efgh', '\t\t BAR\t\t'];
		let modified = ['  hello\t', '\t foo   \t', 'zzzefgh', 'xxx', '   BAR   \t'];
		let expected = [
			createLineInsertion(1, 1, 0),
			createLineChange(2, 3, 3, 4, [
				createCharChange(2, 1, 2, 5, 3, 1, 3, 4),
				createCharInsertion(4, 1, 4, 4)
			])
		];
		assertDiff(original, modified, expected, true, false, true);
	});

	test('issue #12122 r.hasOwnProperty is not a function', () => {
		let original = ['hasOwnProperty'];
		let modified = ['hasOwnProperty', 'and another line'];
		let expected = [
			createLineInsertion(2, 2, 1)
		];
		assertDiff(original, modified, expected);
	});

	test('empty diff 1', () => {
		let original = [''];
		let modified = ['something'];
		let expected = [
			createLineChange(1, 1, 1, 1, [
				createCharChange(0, 0, 0, 0, 0, 0, 0, 0)
			])
		];
		assertDiff(original, modified, expected, true, false, true);
	});

	test('empty diff 2', () => {
		let original = [''];
		let modified = ['something', 'something else'];
		let expected = [
			createLineChange(1, 1, 1, 2, [
				createCharChange(0, 0, 0, 0, 0, 0, 0, 0)
			])
		];
		assertDiff(original, modified, expected, true, false, true);
	});

	test('empty diff 3', () => {
		let original = ['something', 'something else'];
		let modified = [''];
		let expected = [
			createLineChange(1, 2, 1, 1, [
				createCharChange(0, 0, 0, 0, 0, 0, 0, 0)
			])
		];
		assertDiff(original, modified, expected, true, false, true);
	});

	test('empty diff 4', () => {
		let original = ['something'];
		let modified = [''];
		let expected = [
			createLineChange(1, 1, 1, 1, [
				createCharChange(0, 0, 0, 0, 0, 0, 0, 0)
			])
		];
		assertDiff(original, modified, expected, true, false, true);
	});

	test('pretty diff 1', () => {
		let original = [
			'suite(function () {',
			'	test1() {',
			'		assert.ok(true);',
			'	}',
			'',
			'	test2() {',
			'		assert.ok(true);',
			'	}',
			'});',
			'',
		];
		let modified = [
			'// An insertion',
			'suite(function () {',
			'	test1() {',
			'		assert.ok(true);',
			'	}',
			'',
			'	test2() {',
			'		assert.ok(true);',
			'	}',
			'',
			'	test3() {',
			'		assert.ok(true);',
			'	}',
			'});',
			'',
		];
		let expected = [
			createLineInsertion(1, 1, 0),
			createLineInsertion(10, 13, 8)
		];
		assertDiff(original, modified, expected, true, false, true);
	});

	test('pretty diff 2', () => {
		let original = [
			'// Just a comment',
			'',
			'function compute(a, b, c, d) {',
			'	if (a) {',
			'		if (b) {',
			'			if (c) {',
			'				return 5;',
			'			}',
			'		}',
			'		// These next lines will be deleted',
			'		if (d) {',
			'			return -1;',
			'		}',
			'		return 0;',
			'	}',
			'}',
		];
		let modified = [
			'// Here is an inserted line',
			'// and another inserted line',
			'// and another one',
			'// Just a comment',
			'',
			'function compute(a, b, c, d) {',
			'	if (a) {',
			'		if (b) {',
			'			if (c) {',
			'				return 5;',
			'			}',
			'		}',
			'		return 0;',
			'	}',
			'}',
		];
		let expected = [
			createLineInsertion(1, 3, 0),
			createLineDeletion(10, 13, 12),
		];
		assertDiff(original, modified, expected, true, false, true);
	});

	test('pretty diff 3', () => {
		let original = [
			'class A {',
			'	/**',
			'	 * m1',
			'	 */',
			'	method1() {}',
			'',
			'	/**',
			'	 * m3',
			'	 */',
			'	method3() {}',
			'}',
		];
		let modified = [
			'class A {',
			'	/**',
			'	 * m1',
			'	 */',
			'	method1() {}',
			'',
			'	/**',
			'	 * m2',
			'	 */',
			'	method2() {}',
			'',
			'	/**',
			'	 * m3',
			'	 */',
			'	method3() {}',
			'}',
		];
		let expected = [
			createLineInsertion(7, 11, 6)
		];
		assertDiff(original, modified, expected, true, false, true);
	});

	test('issue #23636', () => {
		let original = [
			'if(!TextDrawLoad[playerid])',
			'{',
			'',
			'	TextDrawHideForPlayer(playerid,TD_AppleJob[3]);',
			'	TextDrawHideForPlayer(playerid,TD_AppleJob[4]);',
			'	if(!AppleJobTreesType[AppleJobTreesPlayerNum[playerid]])',
			'	{',
			'		for(new i=0;i<10;i++) if(StatusTD_AppleJobApples[playerid][i]) TextDrawHideForPlayer(playerid,TD_AppleJob[5+i]);',
			'	}',
			'	else',
			'	{',
			'		for(new i=0;i<10;i++) if(StatusTD_AppleJobApples[playerid][i]) TextDrawHideForPlayer(playerid,TD_AppleJob[15+i]);',
			'	}',
			'}',
			'else',
			'{',
			'	TextDrawHideForPlayer(playerid,TD_AppleJob[3]);',
			'	TextDrawHideForPlayer(playerid,TD_AppleJob[27]);',
			'	if(!AppleJobTreesType[AppleJobTreesPlayerNum[playerid]])',
			'	{',
			'		for(new i=0;i<10;i++) if(StatusTD_AppleJobApples[playerid][i]) TextDrawHideForPlayer(playerid,TD_AppleJob[28+i]);',
			'	}',
			'	else',
			'	{',
			'		for(new i=0;i<10;i++) if(StatusTD_AppleJobApples[playerid][i]) TextDrawHideForPlayer(playerid,TD_AppleJob[38+i]);',
			'	}',
			'}',
		];
		let modified = [
			'	if(!TextDrawLoad[playerid])',
			'	{',
			'	',
			'		TextDrawHideForPlayer(playerid,TD_AppleJob[3]);',
			'		TextDrawHideForPlayer(playerid,TD_AppleJob[4]);',
			'		if(!AppleJobTreesType[AppleJobTreesPlayerNum[playerid]])',
			'		{',
			'			for(new i=0;i<10;i++) if(StatusTD_AppleJobApples[playerid][i]) TextDrawHideForPlayer(playerid,TD_AppleJob[5+i]);',
			'		}',
			'		else',
			'		{',
			'			for(new i=0;i<10;i++) if(StatusTD_AppleJobApples[playerid][i]) TextDrawHideForPlayer(playerid,TD_AppleJob[15+i]);',
			'		}',
			'	}',
			'	else',
			'	{',
			'		TextDrawHideForPlayer(playerid,TD_AppleJob[3]);',
			'		TextDrawHideForPlayer(playerid,TD_AppleJob[27]);',
			'		if(!AppleJobTreesType[AppleJobTreesPlayerNum[playerid]])',
			'		{',
			'			for(new i=0;i<10;i++) if(StatusTD_AppleJobApples[playerid][i]) TextDrawHideForPlayer(playerid,TD_AppleJob[28+i]);',
			'		}',
			'		else',
			'		{',
			'			for(new i=0;i<10;i++) if(StatusTD_AppleJobApples[playerid][i]) TextDrawHideForPlayer(playerid,TD_AppleJob[38+i]);',
			'		}',
			'	}',
		];
		let expected = [
			createLineChange(
				1, 27, 1, 27,
				[
					createCharChange(1, 1, 1, 1, 1, 1, 1, 2),
					createCharChange(2, 1, 2, 1, 2, 1, 2, 2),
					createCharChange(3, 1, 3, 1, 3, 1, 3, 2),
					createCharChange(4, 1, 4, 1, 4, 1, 4, 2),
					createCharChange(5, 1, 5, 1, 5, 1, 5, 2),
					createCharChange(6, 1, 6, 1, 6, 1, 6, 2),
					createCharChange(7, 1, 7, 1, 7, 1, 7, 2),
					createCharChange(8, 1, 8, 1, 8, 1, 8, 2),
					createCharChange(9, 1, 9, 1, 9, 1, 9, 2),
					createCharChange(10, 1, 10, 1, 10, 1, 10, 2),
					createCharChange(11, 1, 11, 1, 11, 1, 11, 2),
					createCharChange(12, 1, 12, 1, 12, 1, 12, 2),
					createCharChange(13, 1, 13, 1, 13, 1, 13, 2),
					createCharChange(14, 1, 14, 1, 14, 1, 14, 2),
					createCharChange(15, 1, 15, 1, 15, 1, 15, 2),
					createCharChange(16, 1, 16, 1, 16, 1, 16, 2),
					createCharChange(17, 1, 17, 1, 17, 1, 17, 2),
					createCharChange(18, 1, 18, 1, 18, 1, 18, 2),
					createCharChange(19, 1, 19, 1, 19, 1, 19, 2),
					createCharChange(20, 1, 20, 1, 20, 1, 20, 2),
					createCharChange(21, 1, 21, 1, 21, 1, 21, 2),
					createCharChange(22, 1, 22, 1, 22, 1, 22, 2),
					createCharChange(23, 1, 23, 1, 23, 1, 23, 2),
					createCharChange(24, 1, 24, 1, 24, 1, 24, 2),
					createCharChange(25, 1, 25, 1, 25, 1, 25, 2),
					createCharChange(26, 1, 26, 1, 26, 1, 26, 2),
					createCharChange(27, 1, 27, 1, 27, 1, 27, 2),
				]
			)
			// createLineInsertion(7, 11, 6)
		];
		assertDiff(original, modified, expected, true, true, false);
	});

	test('issue #43922', () => {
		let original = [
			' * `yarn [install]` -- Install project NPM dependencies. This is automatically done when you first create the project. You should only need to run this if you add dependencies in `package.json`.',
		];
		let modified = [
			' * `yarn` -- Install project NPM dependencies. You should only need to run this if you add dependencies in `package.json`.',
		];
		let expected = [
			createLineChange(
				1, 1, 1, 1,
				[
					createCharChange(1, 9, 1, 19, 0, 0, 0, 0),
					createCharChange(1, 58, 1, 120, 0, 0, 0, 0),
				]
			)
		];
		assertDiff(original, modified, expected, true, true, false);
	});

	test('issue #42751', () => {
		let original = [
			'    1',
			'  2',
		];
		let modified = [
			'    1',
			'   3',
		];
		let expected = [
			createLineChange(
				2, 2, 2, 2,
				[
					createCharChange(2, 3, 2, 4, 2, 3, 2, 5)
				]
			)
		];
		assertDiff(original, modified, expected, true, true, false);
	});

	test('does not give character changes', () => {
		let original = [
			'    1',
			'  2',
			'A',
		];
		let modified = [
			'    1',
			'   3',
			' A',
		];
		let expected = [
			createLineChange(
				2, 3, 2, 3
			)
		];
		assertDiff(original, modified, expected, false, false, false);
	});

	test('issue #44422: Less than ideal diff results', () => {
		let original = [
			'export class C {',
			'',
			'	public m1(): void {',
			'		{',
			'		//2',
			'		//3',
			'		//4',
			'		//5',
			'		//6',
			'		//7',
			'		//8',
			'		//9',
			'		//10',
			'		//11',
			'		//12',
			'		//13',
			'		//14',
			'		//15',
			'		//16',
			'		//17',
			'		//18',
			'		}',
			'	}',
			'',
			'	public m2(): void {',
			'		if (a) {',
			'			if (b) {',
			'				//A1',
			'				//A2',
			'				//A3',
			'				//A4',
			'				//A5',
			'				//A6',
			'				//A7',
			'				//A8',
			'			}',
			'		}',
			'',
			'		//A9',
			'		//A10',
			'		//A11',
			'		//A12',
			'		//A13',
			'		//A14',
			'		//A15',
			'	}',
			'',
			'	public m3(): void {',
			'		if (a) {',
			'			//B1',
			'		}',
			'		//B2',
			'		//B3',
			'	}',
			'',
			'	public m4(): boolean {',
			'		//1',
			'		//2',
			'		//3',
			'		//4',
			'	}',
			'',
			'}',
		];
		let modified = [
			'export class C {',
			'',
			'	constructor() {',
			'',
			'',
			'',
			'',
			'	}',
			'',
			'	public m1(): void {',
			'		{',
			'		//2',
			'		//3',
			'		//4',
			'		//5',
			'		//6',
			'		//7',
			'		//8',
			'		//9',
			'		//10',
			'		//11',
			'		//12',
			'		//13',
			'		//14',
			'		//15',
			'		//16',
			'		//17',
			'		//18',
			'		}',
			'	}',
			'',
			'	public m4(): boolean {',
			'		//1',
			'		//2',
			'		//3',
			'		//4',
			'	}',
			'',
			'}',
		];
		let expected = [
			createLineChange(
				2, 0, 3, 9
			),
			createLineChange(
				25, 55, 31, 0
			)
		];
		assertDiff(original, modified, expected, false, false, false);
	});

	test('gives preference to matching longer lines', () => {
		let original = [
			'A',
			'A',
			'BB',
			'C',
		];
		let modified = [
			'A',
			'BB',
			'A',
			'D',
			'E',
			'A',
			'C',
		];
		let expected = [
			createLineChange(
				2, 2, 1, 0
			),
			createLineChange(
				3, 0, 3, 6
			)
		];
		assertDiff(original, modified, expected, false, false, false);
	});
});
