/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { EndOfLineSequence, IModelDeltaDecoration, TrackedRangeStickiness } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

// --------- utils

interface ILightWeightDecoration2 {
	range: Range;
	className: string | null | undefined;
}

function modelHasDecorations(model: TextModel, decorations: ILightWeightDecoration2[]) {
	let modelDecorations: ILightWeightDecoration2[] = [];
	let actualDecorations = model.getAllDecorations();
	for (let i = 0, len = actualDecorations.length; i < len; i++) {
		modelDecorations.push({
			range: actualDecorations[i].range,
			className: actualDecorations[i].options.className
		});
	}
	modelDecorations.sort((a, b) => Range.compareRangesUsingStarts(a.range, b.range));
	assert.deepEqual(modelDecorations, decorations);
}

function modelHasDecoration(model: TextModel, startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, className: string) {
	modelHasDecorations(model, [{
		range: new Range(startLineNumber, startColumn, endLineNumber, endColumn),
		className: className
	}]);
}

function modelHasNoDecorations(model: TextModel) {
	assert.equal(model.getAllDecorations().length, 0, 'Model has no decoration');
}

function addDecoration(model: TextModel, startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, className: string): string {
	return model.changeDecorations((changeAccessor) => {
		return changeAccessor.addDecoration(new Range(startLineNumber, startColumn, endLineNumber, endColumn), {
			className: className
		});
	})!;
}

function lineHasDecorations(model: TextModel, lineNumber: number, decorations: { start: number; end: number; className: string; }[]) {
	let lineDecorations: Array<{ start: number; end: number; className: string | null | undefined; }> = [];
	let decs = model.getLineDecorations(lineNumber);
	for (let i = 0, len = decs.length; i < len; i++) {
		lineDecorations.push({
			start: decs[i].range.startColumn,
			end: decs[i].range.endColumn,
			className: decs[i].options.className
		});
	}
	assert.deepEqual(lineDecorations, decorations, 'Line decorations');
}

function lineHasNoDecorations(model: TextModel, lineNumber: number) {
	lineHasDecorations(model, lineNumber, []);
}

function lineHasDecoration(model: TextModel, lineNumber: number, start: number, end: number, className: string) {
	lineHasDecorations(model, lineNumber, [{
		start: start,
		end: end,
		className: className
	}]);
}

suite('Editor Model - Model Decorations', () => {
	const LINE1 = 'My First Line';
	const LINE2 = '\t\tMy Second Line';
	const LINE3 = '    Third Line';
	const LINE4 = '';
	const LINE5 = '1';

	// --------- Model Decorations

	let thisModel: TextModel;

	setup(() => {
		const text =
			LINE1 + '\r\n' +
			LINE2 + '\n' +
			LINE3 + '\n' +
			LINE4 + '\r\n' +
			LINE5;
		thisModel = createTextModel(text);
	});

	teardown(() => {
		thisModel.dispose();
	});

	test('single character decoration', () => {
		addDecoration(thisModel, 1, 1, 1, 2, 'myType');
		lineHasDecoration(thisModel, 1, 1, 2, 'myType');
		lineHasNoDecorations(thisModel, 2);
		lineHasNoDecorations(thisModel, 3);
		lineHasNoDecorations(thisModel, 4);
		lineHasNoDecorations(thisModel, 5);
	});

	test('line decoration', () => {
		addDecoration(thisModel, 1, 1, 1, 14, 'myType');
		lineHasDecoration(thisModel, 1, 1, 14, 'myType');
		lineHasNoDecorations(thisModel, 2);
		lineHasNoDecorations(thisModel, 3);
		lineHasNoDecorations(thisModel, 4);
		lineHasNoDecorations(thisModel, 5);
	});

	test('full line decoration', () => {
		addDecoration(thisModel, 1, 1, 2, 1, 'myType');

		let line1Decorations = thisModel.getLineDecorations(1);
		assert.equal(line1Decorations.length, 1);
		assert.equal(line1Decorations[0].options.className, 'myType');

		let line2Decorations = thisModel.getLineDecorations(1);
		assert.equal(line2Decorations.length, 1);
		assert.equal(line2Decorations[0].options.className, 'myType');

		lineHasNoDecorations(thisModel, 3);
		lineHasNoDecorations(thisModel, 4);
		lineHasNoDecorations(thisModel, 5);
	});

	test('multiple line decoration', () => {
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');

		let line1Decorations = thisModel.getLineDecorations(1);
		assert.equal(line1Decorations.length, 1);
		assert.equal(line1Decorations[0].options.className, 'myType');

		let line2Decorations = thisModel.getLineDecorations(1);
		assert.equal(line2Decorations.length, 1);
		assert.equal(line2Decorations[0].options.className, 'myType');

		let line3Decorations = thisModel.getLineDecorations(1);
		assert.equal(line3Decorations.length, 1);
		assert.equal(line3Decorations[0].options.className, 'myType');

		lineHasNoDecorations(thisModel, 4);
		lineHasNoDecorations(thisModel, 5);
	});

	// --------- removing, changing decorations

	test('decoration gets removed', () => {
		let decId = addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.changeDecorations((changeAccessor) => {
			changeAccessor.removeDecoration(decId);
		});
		modelHasNoDecorations(thisModel);
	});

	test('decorations get removed', () => {
		let decId1 = addDecoration(thisModel, 1, 2, 3, 2, 'myType1');
		let decId2 = addDecoration(thisModel, 1, 2, 3, 1, 'myType2');
		modelHasDecorations(thisModel, [
			{
				range: new Range(1, 2, 3, 1),
				className: 'myType2'
			},
			{
				range: new Range(1, 2, 3, 2),
				className: 'myType1'
			}
		]);
		thisModel.changeDecorations((changeAccessor) => {
			changeAccessor.removeDecoration(decId1);
		});
		modelHasDecorations(thisModel, [
			{
				range: new Range(1, 2, 3, 1),
				className: 'myType2'
			}
		]);
		thisModel.changeDecorations((changeAccessor) => {
			changeAccessor.removeDecoration(decId2);
		});
		modelHasNoDecorations(thisModel);
	});

	test('decoration range can be changed', () => {
		let decId = addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.changeDecorations((changeAccessor) => {
			changeAccessor.changeDecoration(decId, new Range(1, 1, 1, 2));
		});
		modelHasDecoration(thisModel, 1, 1, 1, 2, 'myType');
	});

	// --------- eventing

	test('decorations emit event on add', () => {
		let listenerCalled = 0;
		thisModel.onDidChangeDecorations((e) => {
			listenerCalled++;
		});
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		assert.equal(listenerCalled, 1, 'listener called');
	});

	test('decorations emit event on change', () => {
		let listenerCalled = 0;
		let decId = addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.onDidChangeDecorations((e) => {
			listenerCalled++;
		});
		thisModel.changeDecorations((changeAccessor) => {
			changeAccessor.changeDecoration(decId, new Range(1, 1, 1, 2));
		});
		assert.equal(listenerCalled, 1, 'listener called');
	});

	test('decorations emit event on remove', () => {
		let listenerCalled = 0;
		let decId = addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.onDidChangeDecorations((e) => {
			listenerCalled++;
		});
		thisModel.changeDecorations((changeAccessor) => {
			changeAccessor.removeDecoration(decId);
		});
		assert.equal(listenerCalled, 1, 'listener called');
	});

	test('decorations emit event when inserting one line text before it', () => {
		let listenerCalled = 0;
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');

		thisModel.onDidChangeDecorations((e) => {
			listenerCalled++;
		});

		thisModel.applyEdits([EditOperation.insert(new Position(1, 1), 'Hallo ')]);
		assert.equal(listenerCalled, 1, 'listener called');
	});

	test('decorations do not emit event on no-op deltaDecorations', () => {
		let listenerCalled = 0;

		thisModel.onDidChangeDecorations((e) => {
			listenerCalled++;
		});

		thisModel.deltaDecorations([], []);
		thisModel.changeDecorations((accessor) => {
			accessor.deltaDecorations([], []);
		});

		assert.equal(listenerCalled, 0, 'listener not called');
	});

	// --------- editing text & effects on decorations

	test('decorations are updated when inserting one line text before it', () => {
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.insert(new Position(1, 1), 'Hallo ')]);
		modelHasDecoration(thisModel, 1, 8, 3, 2, 'myType');
	});

	test('decorations are updated when inserting one line text before it 2', () => {
		addDecoration(thisModel, 1, 1, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 1, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.replace(new Range(1, 1, 1, 1), 'Hallo ')]);
		modelHasDecoration(thisModel, 1, 1, 3, 2, 'myType');
	});

	test('decorations are updated when inserting multiple lines text before it', () => {
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.insert(new Position(1, 1), 'Hallo\nI\'m inserting multiple\nlines')]);
		modelHasDecoration(thisModel, 3, 7, 5, 2, 'myType');
	});

	test('decorations change when inserting text after them', () => {
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.insert(new Position(3, 2), 'Hallo')]);
		modelHasDecoration(thisModel, 1, 2, 3, 7, 'myType');
	});

	test('decorations are updated when inserting text inside', () => {
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.insert(new Position(1, 3), 'Hallo ')]);
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
	});

	test('decorations are updated when inserting text inside 2', () => {
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.insert(new Position(3, 1), 'Hallo ')]);
		modelHasDecoration(thisModel, 1, 2, 3, 8, 'myType');
	});

	test('decorations are updated when inserting text inside 3', () => {
		addDecoration(thisModel, 1, 1, 2, 16, 'myType');
		modelHasDecoration(thisModel, 1, 1, 2, 16, 'myType');
		thisModel.applyEdits([EditOperation.insert(new Position(2, 2), '\n')]);
		modelHasDecoration(thisModel, 1, 1, 3, 15, 'myType');
	});

	test('decorations are updated when inserting multiple lines text inside', () => {
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.insert(new Position(1, 3), 'Hallo\nI\'m inserting multiple\nlines')]);
		modelHasDecoration(thisModel, 1, 2, 5, 2, 'myType');
	});

	test('decorations are updated when deleting one line text before it', () => {
		addDecoration(thisModel, 1, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 1, 2, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.delete(new Range(1, 1, 1, 2))]);
		modelHasDecoration(thisModel, 1, 1, 3, 2, 'myType');
	});

	test('decorations are updated when deleting multiple lines text before it', () => {
		addDecoration(thisModel, 2, 2, 3, 2, 'myType');
		modelHasDecoration(thisModel, 2, 2, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.delete(new Range(1, 1, 2, 1))]);
		modelHasDecoration(thisModel, 1, 2, 2, 2, 'myType');
	});

	test('decorations are updated when deleting multiple lines text before it 2', () => {
		addDecoration(thisModel, 2, 3, 3, 2, 'myType');
		modelHasDecoration(thisModel, 2, 3, 3, 2, 'myType');
		thisModel.applyEdits([EditOperation.delete(new Range(1, 1, 2, 2))]);
		modelHasDecoration(thisModel, 1, 2, 2, 2, 'myType');
	});

	test('decorations are updated when deleting text inside', () => {
		addDecoration(thisModel, 1, 2, 4, 1, 'myType');
		modelHasDecoration(thisModel, 1, 2, 4, 1, 'myType');
		thisModel.applyEdits([EditOperation.delete(new Range(1, 3, 2, 1))]);
		modelHasDecoration(thisModel, 1, 2, 3, 1, 'myType');
	});

	test('decorations are updated when deleting text inside 2', () => {
		addDecoration(thisModel, 1, 2, 4, 1, 'myType');
		modelHasDecoration(thisModel, 1, 2, 4, 1, 'myType');
		thisModel.applyEdits([
			EditOperation.delete(new Range(1, 1, 1, 2)),
			EditOperation.delete(new Range(4, 1, 4, 1))
		]);
		modelHasDecoration(thisModel, 1, 1, 4, 1, 'myType');
	});

	test('decorations are updated when deleting multiple lines text', () => {
		addDecoration(thisModel, 1, 2, 4, 1, 'myType');
		modelHasDecoration(thisModel, 1, 2, 4, 1, 'myType');
		thisModel.applyEdits([EditOperation.delete(new Range(1, 1, 3, 1))]);
		modelHasDecoration(thisModel, 1, 1, 2, 1, 'myType');
	});

	test('decorations are updated when changing EOL', () => {
		addDecoration(thisModel, 1, 2, 4, 1, 'myType1');
		addDecoration(thisModel, 1, 3, 4, 1, 'myType2');
		addDecoration(thisModel, 1, 4, 4, 1, 'myType3');
		addDecoration(thisModel, 1, 5, 4, 1, 'myType4');
		addDecoration(thisModel, 1, 6, 4, 1, 'myType5');
		addDecoration(thisModel, 1, 7, 4, 1, 'myType6');
		addDecoration(thisModel, 1, 8, 4, 1, 'myType7');
		addDecoration(thisModel, 1, 9, 4, 1, 'myType8');
		addDecoration(thisModel, 1, 10, 4, 1, 'myType9');
		thisModel.applyEdits([EditOperation.insert(new Position(1, 1), 'x')]);
		thisModel.setEOL(EndOfLineSequence.CRLF);
		thisModel.applyEdits([EditOperation.insert(new Position(1, 1), 'x')]);
		modelHasDecorations(thisModel, [
			{ range: new Range(1, 4, 4, 1), className: 'myType1' },
			{ range: new Range(1, 5, 4, 1), className: 'myType2' },
			{ range: new Range(1, 6, 4, 1), className: 'myType3' },
			{ range: new Range(1, 7, 4, 1), className: 'myType4' },
			{ range: new Range(1, 8, 4, 1), className: 'myType5' },
			{ range: new Range(1, 9, 4, 1), className: 'myType6' },
			{ range: new Range(1, 10, 4, 1), className: 'myType7' },
			{ range: new Range(1, 11, 4, 1), className: 'myType8' },
			{ range: new Range(1, 12, 4, 1), className: 'myType9' },
		]);
	});

	test('an apparently simple edit', () => {
		addDecoration(thisModel, 1, 2, 4, 1, 'myType1');
		thisModel.applyEdits([EditOperation.replace(new Range(1, 14, 2, 1), 'x')]);
		modelHasDecorations(thisModel, [
			{ range: new Range(1, 2, 3, 1), className: 'myType1' },
		]);
	});

	test('removeAllDecorationsWithOwnerId can be called after model dispose', () => {
		let model = createTextModel('asd');
		model.dispose();
		model.removeAllDecorationsWithOwnerId(1);
	});

	test('removeAllDecorationsWithOwnerId works', () => {
		thisModel.deltaDecorations([], [{ range: new Range(1, 2, 4, 1), options: { className: 'myType1' } }], 1);
		thisModel.removeAllDecorationsWithOwnerId(1);
		modelHasNoDecorations(thisModel);
	});
});

suite('Decorations and editing', () => {

	function _runTest(decRange: Range, stickiness: TrackedRangeStickiness, editRange: Range, editText: string, editForceMoveMarkers: boolean, expectedDecRange: Range, msg: string): void {
		let model = createTextModel([
			'My First Line',
			'My Second Line',
			'Third Line'
		].join('\n'));

		const id = model.deltaDecorations([], [{ range: decRange, options: { stickiness: stickiness } }])[0];
		model.applyEdits([{
			range: editRange,
			text: editText,
			forceMoveMarkers: editForceMoveMarkers
		}]);
		const actual = model.getDecorationRange(id);
		assert.deepEqual(actual, expectedDecRange, msg);

		model.dispose();
	}

	function runTest(decRange: Range, editRange: Range, editText: string, expectedDecRange: Range[][]): void {
		_runTest(decRange, 0, editRange, editText, false, expectedDecRange[0][0], 'no-0-AlwaysGrowsWhenTypingAtEdges');
		_runTest(decRange, 1, editRange, editText, false, expectedDecRange[0][1], 'no-1-NeverGrowsWhenTypingAtEdges');
		_runTest(decRange, 2, editRange, editText, false, expectedDecRange[0][2], 'no-2-GrowsOnlyWhenTypingBefore');
		_runTest(decRange, 3, editRange, editText, false, expectedDecRange[0][3], 'no-3-GrowsOnlyWhenTypingAfter');

		_runTest(decRange, 0, editRange, editText, true, expectedDecRange[1][0], 'force-0-AlwaysGrowsWhenTypingAtEdges');
		_runTest(decRange, 1, editRange, editText, true, expectedDecRange[1][1], 'force-1-NeverGrowsWhenTypingAtEdges');
		_runTest(decRange, 2, editRange, editText, true, expectedDecRange[1][2], 'force-2-GrowsOnlyWhenTypingBefore');
		_runTest(decRange, 3, editRange, editText, true, expectedDecRange[1][3], 'force-3-GrowsOnlyWhenTypingAfter');
	}

	suite('insert', () => {
		suite('collapsed dec', () => {
			test('before', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 3, 1, 3), 'xx',
					[
						[new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6)],
						[new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6)],
					]
				);
			});
			test('equal', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 4, 1, 4), 'xx',
					[
						[new Range(1, 4, 1, 6), new Range(1, 6, 1, 6), new Range(1, 4, 1, 4), new Range(1, 6, 1, 6)],
						[new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6)],
					]
				);
			});
			test('after', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 5, 1, 5), 'xx',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});
		});
		suite('non-collapsed dec', () => {
			test('before', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 3), 'xx',
					[
						[new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11)],
						[new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11)],
					]
				);
			});
			test('start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 4), 'xx',
					[
						[new Range(1, 4, 1, 11), new Range(1, 6, 1, 11), new Range(1, 4, 1, 11), new Range(1, 6, 1, 11)],
						[new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11)],
					]
				);
			});
			test('inside', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 5), 'xx',
					[
						[new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11)],
						[new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11)],
					]
				);
			});
			test('end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 9, 1, 9), 'xx',
					[
						[new Range(1, 4, 1, 11), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 11)],
						[new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11)],
					]
				);
			});
			test('after', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 10, 1, 10), 'xx',
					[
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
					]
				);
			});
		});
	});

	suite('delete', () => {
		suite('collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 1, 1, 3), '',
					[
						[new Range(1, 2, 1, 2), new Range(1, 2, 1, 2), new Range(1, 2, 1, 2), new Range(1, 2, 1, 2)],
						[new Range(1, 2, 1, 2), new Range(1, 2, 1, 2), new Range(1, 2, 1, 2), new Range(1, 2, 1, 2)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 2, 1, 4), '',
					[
						[new Range(1, 2, 1, 2), new Range(1, 2, 1, 2), new Range(1, 2, 1, 2), new Range(1, 2, 1, 2)],
						[new Range(1, 2, 1, 2), new Range(1, 2, 1, 2), new Range(1, 2, 1, 2), new Range(1, 2, 1, 2)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 3, 1, 5), '',
					[
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
					]
				);
			});
			test('edit.start >= range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 4, 1, 6), '',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 5, 1, 7), '',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});
		});
		suite('non-collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 1, 1, 3), '',
					[
						[new Range(1, 2, 1, 7), new Range(1, 2, 1, 7), new Range(1, 2, 1, 7), new Range(1, 2, 1, 7)],
						[new Range(1, 2, 1, 7), new Range(1, 2, 1, 7), new Range(1, 2, 1, 7), new Range(1, 2, 1, 7)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 2, 1, 4), '',
					[
						[new Range(1, 2, 1, 7), new Range(1, 2, 1, 7), new Range(1, 2, 1, 7), new Range(1, 2, 1, 7)],
						[new Range(1, 2, 1, 7), new Range(1, 2, 1, 7), new Range(1, 2, 1, 7), new Range(1, 2, 1, 7)],
					]
				);
			});
			test('edit.start < range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 5), '',
					[
						[new Range(1, 3, 1, 7), new Range(1, 3, 1, 7), new Range(1, 3, 1, 7), new Range(1, 3, 1, 7)],
						[new Range(1, 3, 1, 7), new Range(1, 3, 1, 7), new Range(1, 3, 1, 7), new Range(1, 3, 1, 7)],
					]
				);
			});

			test('edit.start < range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 9), '',
					[
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
					]
				);
			});

			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 10), '',
					[
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
					]
				);
			});

			test('edit.start == range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 6), '',
					[
						[new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7)],
						[new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7)],
					]
				);
			});

			test('edit.start == range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 9), '',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});

			test('edit.start == range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 10), '',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});

			test('edit.start > range.start && edit.start < range.end && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 7), '',
					[
						[new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7)],
						[new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7)],
					]
				);
			});

			test('edit.start > range.start && edit.start < range.end && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 9), '',
					[
						[new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5)],
						[new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5)],
					]
				);
			});

			test('edit.start > range.start && edit.start < range.end && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 10), '',
					[
						[new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5)],
						[new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5)],
					]
				);
			});

			test('edit.start == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 9, 1, 11), '',
					[
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
					]
				);
			});

			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 10, 1, 11), '',
					[
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
					]
				);
			});
		});
	});

	suite('replace short', () => {
		suite('collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 1, 1, 3), 'c',
					[
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 2, 1, 4), 'c',
					[
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
						[new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3), new Range(1, 3, 1, 3)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 3, 1, 5), 'c',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});
			test('edit.start >= range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 4, 1, 6), 'c',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 5, 1, 5), new Range(1, 5, 1, 5), new Range(1, 5, 1, 5), new Range(1, 5, 1, 5)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 5, 1, 7), 'c',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});
		});
		suite('non-collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 1, 1, 3), 'c',
					[
						[new Range(1, 3, 1, 8), new Range(1, 3, 1, 8), new Range(1, 3, 1, 8), new Range(1, 3, 1, 8)],
						[new Range(1, 3, 1, 8), new Range(1, 3, 1, 8), new Range(1, 3, 1, 8), new Range(1, 3, 1, 8)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 2, 1, 4), 'c',
					[
						[new Range(1, 3, 1, 8), new Range(1, 3, 1, 8), new Range(1, 3, 1, 8), new Range(1, 3, 1, 8)],
						[new Range(1, 3, 1, 8), new Range(1, 3, 1, 8), new Range(1, 3, 1, 8), new Range(1, 3, 1, 8)],
					]
				);
			});
			test('edit.start < range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 5), 'c',
					[
						[new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8)],
						[new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8)],
					]
				);
			});
			test('edit.start < range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 9), 'c',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 10), 'c',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});
			test('edit.start == range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 6), 'c',
					[
						[new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8)],
						[new Range(1, 5, 1, 8), new Range(1, 5, 1, 8), new Range(1, 5, 1, 8), new Range(1, 5, 1, 8)],
					]
				);
			});
			test('edit.start == range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 9), 'c',
					[
						[new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5)],
						[new Range(1, 5, 1, 5), new Range(1, 5, 1, 5), new Range(1, 5, 1, 5), new Range(1, 5, 1, 5)],
					]
				);
			});
			test('edit.start == range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 10), 'c',
					[
						[new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5), new Range(1, 4, 1, 5)],
						[new Range(1, 5, 1, 5), new Range(1, 5, 1, 5), new Range(1, 5, 1, 5), new Range(1, 5, 1, 5)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 7), 'c',
					[
						[new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8)],
						[new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 9), 'c',
					[
						[new Range(1, 4, 1, 6), new Range(1, 4, 1, 6), new Range(1, 4, 1, 6), new Range(1, 4, 1, 6)],
						[new Range(1, 4, 1, 6), new Range(1, 4, 1, 6), new Range(1, 4, 1, 6), new Range(1, 4, 1, 6)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 10), 'c',
					[
						[new Range(1, 4, 1, 6), new Range(1, 4, 1, 6), new Range(1, 4, 1, 6), new Range(1, 4, 1, 6)],
						[new Range(1, 4, 1, 6), new Range(1, 4, 1, 6), new Range(1, 4, 1, 6), new Range(1, 4, 1, 6)],
					]
				);
			});
			test('edit.start == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 9, 1, 11), 'c',
					[
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
						[new Range(1, 4, 1, 10), new Range(1, 4, 1, 10), new Range(1, 4, 1, 10), new Range(1, 4, 1, 10)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 10, 1, 11), 'c',
					[
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
					]
				);
			});
		});
	});

	suite('replace long', () => {
		suite('collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 1, 1, 3), 'cccc',
					[
						[new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6)],
						[new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 2, 1, 4), 'cccc',
					[
						[new Range(1, 4, 1, 6), new Range(1, 6, 1, 6), new Range(1, 4, 1, 4), new Range(1, 6, 1, 6)],
						[new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6), new Range(1, 6, 1, 6)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 3, 1, 5), 'cccc',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 7, 1, 7), new Range(1, 7, 1, 7), new Range(1, 7, 1, 7), new Range(1, 7, 1, 7)],
					]
				);
			});
			test('edit.start >= range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 4, 1, 6), 'cccc',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 8, 1, 8), new Range(1, 8, 1, 8), new Range(1, 8, 1, 8), new Range(1, 8, 1, 8)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 5, 1, 7), 'cccc',
					[
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
						[new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4), new Range(1, 4, 1, 4)],
					]
				);
			});
		});
		suite('non-collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 1, 1, 3), 'cccc',
					[
						[new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11)],
						[new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 2, 1, 4), 'cccc',
					[
						[new Range(1, 4, 1, 11), new Range(1, 6, 1, 11), new Range(1, 4, 1, 11), new Range(1, 6, 1, 11)],
						[new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11), new Range(1, 6, 1, 11)],
					]
				);
			});
			test('edit.start < range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 5), 'cccc',
					[
						[new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11)],
						[new Range(1, 7, 1, 11), new Range(1, 7, 1, 11), new Range(1, 7, 1, 11), new Range(1, 7, 1, 11)],
					]
				);
			});
			test('edit.start < range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 9), 'cccc',
					[
						[new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7)],
						[new Range(1, 7, 1, 7), new Range(1, 7, 1, 7), new Range(1, 7, 1, 7), new Range(1, 7, 1, 7)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 10), 'cccc',
					[
						[new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7), new Range(1, 4, 1, 7)],
						[new Range(1, 7, 1, 7), new Range(1, 7, 1, 7), new Range(1, 7, 1, 7), new Range(1, 7, 1, 7)],
					]
				);
			});
			test('edit.start == range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 6), 'cccc',
					[
						[new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11)],
						[new Range(1, 8, 1, 11), new Range(1, 8, 1, 11), new Range(1, 8, 1, 11), new Range(1, 8, 1, 11)],
					]
				);
			});
			test('edit.start == range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 9), 'cccc',
					[
						[new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8)],
						[new Range(1, 8, 1, 8), new Range(1, 8, 1, 8), new Range(1, 8, 1, 8), new Range(1, 8, 1, 8)],
					]
				);
			});
			test('edit.start == range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 10), 'cccc',
					[
						[new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8), new Range(1, 4, 1, 8)],
						[new Range(1, 8, 1, 8), new Range(1, 8, 1, 8), new Range(1, 8, 1, 8), new Range(1, 8, 1, 8)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 7), 'cccc',
					[
						[new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11)],
						[new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11), new Range(1, 4, 1, 11)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 9), 'cccc',
					[
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 10), 'cccc',
					[
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
					]
				);
			});
			test('edit.start == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 9, 1, 11), 'cccc',
					[
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
						[new Range(1, 4, 1, 13), new Range(1, 4, 1, 13), new Range(1, 4, 1, 13), new Range(1, 4, 1, 13)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 10, 1, 11), 'cccc',
					[
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
						[new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9), new Range(1, 4, 1, 9)],
					]
				);
			});
		});
	});
});

interface ILightWeightDecoration {
	id: string;
	range: Range;
}

suite('deltaDecorations', () => {

	function decoration(id: string, startLineNumber: number, startColumn: number, endLineNumber: number, endColum: number): ILightWeightDecoration {
		return {
			id: id,
			range: new Range(startLineNumber, startColumn, endLineNumber, endColum)
		};
	}

	function toModelDeltaDecoration(dec: ILightWeightDecoration): IModelDeltaDecoration {
		return {
			range: dec.range,
			options: {
				className: dec.id
			}
		};
	}

	function strcmp(a: string, b: string): number {
		if (a === b) {
			return 0;
		}
		if (a < b) {
			return -1;
		}
		return 1;
	}

	function readModelDecorations(model: TextModel, ids: string[]): ILightWeightDecoration[] {
		return ids.map((id) => {
			return {
				range: model.getDecorationRange(id)!,
				id: model.getDecorationOptions(id)!.className!
			};
		});
	}

	function testDeltaDecorations(text: string[], decorations: ILightWeightDecoration[], newDecorations: ILightWeightDecoration[]): void {

		let model = createTextModel(text.join('\n'));

		// Add initial decorations & assert they are added
		let initialIds = model.deltaDecorations([], decorations.map(toModelDeltaDecoration));
		let actualDecorations = readModelDecorations(model, initialIds);

		assert.equal(initialIds.length, decorations.length, 'returns expected cnt of ids');
		assert.equal(initialIds.length, model.getAllDecorations().length, 'does not leak decorations');
		actualDecorations.sort((a, b) => strcmp(a.id, b.id));
		decorations.sort((a, b) => strcmp(a.id, b.id));
		assert.deepEqual(actualDecorations, decorations);

		let newIds = model.deltaDecorations(initialIds, newDecorations.map(toModelDeltaDecoration));
		let actualNewDecorations = readModelDecorations(model, newIds);

		assert.equal(newIds.length, newDecorations.length, 'returns expected cnt of ids');
		assert.equal(newIds.length, model.getAllDecorations().length, 'does not leak decorations');
		actualNewDecorations.sort((a, b) => strcmp(a.id, b.id));
		newDecorations.sort((a, b) => strcmp(a.id, b.id));
		assert.deepEqual(actualDecorations, decorations);

		model.dispose();
	}

	function range(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number): Range {
		return new Range(startLineNumber, startColumn, endLineNumber, endColumn);
	}

	test('result respects input', () => {
		let model = createTextModel([
			'Hello world,',
			'How are you?'
		].join('\n'));

		let ids = model.deltaDecorations([], [
			toModelDeltaDecoration(decoration('a', 1, 1, 1, 12)),
			toModelDeltaDecoration(decoration('b', 2, 1, 2, 13))
		]);

		assert.deepEqual(model.getDecorationRange(ids[0]), range(1, 1, 1, 12));
		assert.deepEqual(model.getDecorationRange(ids[1]), range(2, 1, 2, 13));

		model.dispose();
	});

	test('deltaDecorations 1', () => {
		testDeltaDecorations(
			[
				'This is a text',
				'That has multiple lines',
				'And is very friendly',
				'Towards testing'
			],
			[
				decoration('a', 1, 1, 1, 2),
				decoration('b', 1, 1, 1, 15),
				decoration('c', 1, 1, 2, 1),
				decoration('d', 1, 1, 2, 24),
				decoration('e', 2, 1, 2, 24),
				decoration('f', 2, 1, 4, 16)
			],
			[
				decoration('x', 1, 1, 1, 2),
				decoration('b', 1, 1, 1, 15),
				decoration('c', 1, 1, 2, 1),
				decoration('d', 1, 1, 2, 24),
				decoration('e', 2, 1, 2, 21),
				decoration('f', 2, 17, 4, 16)
			]
		);
	});

	test('deltaDecorations 2', () => {
		testDeltaDecorations(
			[
				'This is a text',
				'That has multiple lines',
				'And is very friendly',
				'Towards testing'
			],
			[
				decoration('a', 1, 1, 1, 2),
				decoration('b', 1, 2, 1, 3),
				decoration('c', 1, 3, 1, 4),
				decoration('d', 1, 4, 1, 5),
				decoration('e', 1, 5, 1, 6)
			],
			[
				decoration('a', 1, 2, 1, 3),
				decoration('b', 1, 3, 1, 4),
				decoration('c', 1, 4, 1, 5),
				decoration('d', 1, 5, 1, 6)
			]
		);
	});

	test('deltaDecorations 3', () => {
		testDeltaDecorations(
			[
				'This is a text',
				'That has multiple lines',
				'And is very friendly',
				'Towards testing'
			],
			[
				decoration('a', 1, 1, 1, 2),
				decoration('b', 1, 2, 1, 3),
				decoration('c', 1, 3, 1, 4),
				decoration('d', 1, 4, 1, 5),
				decoration('e', 1, 5, 1, 6)
			],
			[]
		);
	});

	test('issue #4317: editor.setDecorations doesn\'t update the hover message', () => {

		let model = createTextModel('Hello world!');

		let ids = model.deltaDecorations([], [{
			range: {
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: 100,
				endColumn: 1
			},
			options: {
				hoverMessage: { value: 'hello1' }
			}
		}]);

		ids = model.deltaDecorations(ids, [{
			range: {
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: 100,
				endColumn: 1
			},
			options: {
				hoverMessage: { value: 'hello2' }
			}
		}]);

		let actualDecoration = model.getDecorationOptions(ids[0]);

		assert.deepEqual(actualDecoration!.hoverMessage, { value: 'hello2' });

		model.dispose();
	});

	test('model doesn\'t get confused with individual tracked ranges', () => {
		let model = createTextModel([
			'Hello world,',
			'How are you?'
		].join('\n'));

		let trackedRangeId = model.changeDecorations((changeAcessor) => {
			return changeAcessor.addDecoration(
				{
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 1,
					endColumn: 1
				}, {
				stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges
			}
			);
		});
		model.changeDecorations((changeAccessor) => {
			changeAccessor.removeDecoration(trackedRangeId!);
		});

		let ids = model.deltaDecorations([], [
			toModelDeltaDecoration(decoration('a', 1, 1, 1, 12)),
			toModelDeltaDecoration(decoration('b', 2, 1, 2, 13))
		]);

		assert.deepEqual(model.getDecorationRange(ids[0]), range(1, 1, 1, 12));
		assert.deepEqual(model.getDecorationRange(ids[1]), range(2, 1, 2, 13));

		ids = model.deltaDecorations(ids, [
			toModelDeltaDecoration(decoration('a', 1, 1, 1, 12)),
			toModelDeltaDecoration(decoration('b', 2, 1, 2, 13))
		]);

		assert.deepEqual(model.getDecorationRange(ids[0]), range(1, 1, 1, 12));
		assert.deepEqual(model.getDecorationRange(ids[1]), range(2, 1, 2, 13));

		model.dispose();
	});

	test('issue #16922: Clicking on link doesn\'t seem to do anything', () => {
		let model = createTextModel([
			'Hello world,',
			'How are you?',
			'Fine.',
			'Good.',
		].join('\n'));

		model.deltaDecorations([], [
			{ range: new Range(1, 1, 1, 1), options: { className: '1' } },
			{ range: new Range(1, 13, 1, 13), options: { className: '2' } },
			{ range: new Range(2, 1, 2, 1), options: { className: '3' } },
			{ range: new Range(2, 1, 2, 4), options: { className: '4' } },
			{ range: new Range(2, 8, 2, 13), options: { className: '5' } },
			{ range: new Range(3, 1, 4, 6), options: { className: '6' } },
			{ range: new Range(1, 1, 3, 6), options: { className: 'x1' } },
			{ range: new Range(2, 5, 2, 8), options: { className: 'x2' } },
			{ range: new Range(1, 1, 2, 8), options: { className: 'x3' } },
			{ range: new Range(2, 5, 3, 1), options: { className: 'x4' } },
		]);

		let inRange = model.getDecorationsInRange(new Range(2, 6, 2, 6));

		let inRangeClassNames = inRange.map(d => d.options.className);
		inRangeClassNames.sort();
		assert.deepEqual(inRangeClassNames, ['x1', 'x2', 'x3', 'x4']);

		model.dispose();
	});

	test('issue #41492: URL highlighting persists after pasting over url', () => {

		let model = createTextModel([
			'My First Line'
		].join('\n'));

		const id = model.deltaDecorations([], [{ range: new Range(1, 2, 1, 14), options: { stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, collapseOnReplaceEdit: true } }])[0];
		model.applyEdits([{
			range: new Range(1, 1, 1, 14),
			text: 'Some new text that is longer than the previous one',
			forceMoveMarkers: false
		}]);
		const actual = model.getDecorationRange(id);
		assert.deepEqual(actual, new Range(1, 1, 1, 1));

		model.dispose();
	});
});
