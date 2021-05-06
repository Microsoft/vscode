/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { merge, removeFromValueTree } from 'vs/platform/configuration/common/configuration';
import { mergeChanges } from 'vs/platform/configuration/common/configurationModels';

suite('Configuration', () => {

	test('simple merge', () => {
		let base = { 'a': 1, 'b': 2 };
		merge(base, { 'a': 3, 'c': 4 }, true);
		assert.deepStrictEqual(base, { 'a': 3, 'b': 2, 'c': 4 });
		base = { 'a': 1, 'b': 2 };
		merge(base, { 'a': 3, 'c': 4 }, false);
		assert.deepStrictEqual(base, { 'a': 1, 'b': 2, 'c': 4 });
	});

	test('removeFromValueTree: remove a non existing key', () => {
		let target = { 'a': { 'b': 2 } };

		removeFromValueTree(target, 'c');

		assert.deepStrictEqual(target, { 'a': { 'b': 2 } });
	});

	test('removeFromValueTree: remove a multi segmented key from an object that has only sub sections of the key', () => {
		let target = { 'a': { 'b': 2 } };

		removeFromValueTree(target, 'a.b.c');

		assert.deepStrictEqual(target, { 'a': { 'b': 2 } });
	});

	test('removeFromValueTree: remove a single segmented key', () => {
		let target = { 'a': 1 };

		removeFromValueTree(target, 'a');

		assert.deepStrictEqual(target, {});
	});

	test('removeFromValueTree: remove a single segmented key when its value is undefined', () => {
		let target = { 'a': undefined };

		removeFromValueTree(target, 'a');

		assert.deepStrictEqual(target, {});
	});

	test('removeFromValueTree: remove a multi segmented key when its value is undefined', () => {
		let target = { 'a': { 'b': 1 } };

		removeFromValueTree(target, 'a.b');

		assert.deepStrictEqual(target, {});
	});

	test('removeFromValueTree: remove a multi segmented key when its value is array', () => {
		let target = { 'a': { 'b': [1] } };

		removeFromValueTree(target, 'a.b');

		assert.deepStrictEqual(target, {});
	});

	test('removeFromValueTree: remove a multi segmented key first segment value is array', () => {
		let target = { 'a': [1] };

		removeFromValueTree(target, 'a.0');

		assert.deepStrictEqual(target, { 'a': [1] });
	});

	test('removeFromValueTree: remove when key is the first segmenet', () => {
		let target = { 'a': { 'b': 1 } };

		removeFromValueTree(target, 'a');

		assert.deepStrictEqual(target, {});
	});

	test('removeFromValueTree: remove a multi segmented key when the first node has more values', () => {
		let target = { 'a': { 'b': { 'c': 1 }, 'd': 1 } };

		removeFromValueTree(target, 'a.b.c');

		assert.deepStrictEqual(target, { 'a': { 'd': 1 } });
	});

	test('removeFromValueTree: remove a multi segmented key when in between node has more values', () => {
		let target = { 'a': { 'b': { 'c': { 'd': 1 }, 'd': 1 } } };

		removeFromValueTree(target, 'a.b.c.d');

		assert.deepStrictEqual(target, { 'a': { 'b': { 'd': 1 } } });
	});

	test('removeFromValueTree: remove a multi segmented key when the last but one node has more values', () => {
		let target = { 'a': { 'b': { 'c': 1, 'd': 1 } } };

		removeFromValueTree(target, 'a.b.c');

		assert.deepStrictEqual(target, { 'a': { 'b': { 'd': 1 } } });
	});

});

suite('Configuration Changes: Merge', () => {

	test('merge only keys', () => {
		const actual = mergeChanges({ keys: ['a', 'b'], overrides: [] }, { keys: ['c', 'd'], overrides: [] });
		assert.deepStrictEqual(actual, { keys: ['a', 'b', 'c', 'd'], overrides: [] });
	});

	test('merge only keys with duplicates', () => {
		const actual = mergeChanges({ keys: ['a', 'b'], overrides: [] }, { keys: ['c', 'd'], overrides: [] }, { keys: ['a', 'd', 'e'], overrides: [] });
		assert.deepStrictEqual(actual, { keys: ['a', 'b', 'c', 'd', 'e'], overrides: [] });
	});

	test('merge only overrides', () => {
		const actual = mergeChanges({ keys: [], overrides: [['a', ['1', '2']]] }, { keys: [], overrides: [['b', ['3', '4']]] });
		assert.deepStrictEqual(actual, { keys: [], overrides: [['a', ['1', '2']], ['b', ['3', '4']]] });
	});

	test('merge only overrides with duplicates', () => {
		const actual = mergeChanges({ keys: [], overrides: [['a', ['1', '2']], ['b', ['5', '4']]] }, { keys: [], overrides: [['b', ['3', '4']]] }, { keys: [], overrides: [['c', ['1', '4']], ['a', ['2', '3']]] });
		assert.deepStrictEqual(actual, { keys: [], overrides: [['a', ['1', '2', '3']], ['b', ['5', '4', '3']], ['c', ['1', '4']]] });
	});

	test('merge', () => {
		const actual = mergeChanges({ keys: ['b', 'b'], overrides: [['a', ['1', '2']], ['b', ['5', '4']]] }, { keys: ['b'], overrides: [['b', ['3', '4']]] }, { keys: ['c', 'a'], overrides: [['c', ['1', '4']], ['a', ['2', '3']]] });
		assert.deepStrictEqual(actual, { keys: ['b', 'c', 'a'], overrides: [['a', ['1', '2', '3']], ['b', ['5', '4', '3']], ['c', ['1', '4']]] });
	});

	test('merge single change', () => {
		const actual = mergeChanges({ keys: ['b', 'b'], overrides: [['a', ['1', '2']], ['b', ['5', '4']]] });
		assert.deepStrictEqual(actual, { keys: ['b', 'b'], overrides: [['a', ['1', '2']], ['b', ['5', '4']]] });
	});

	test('merge no changes', () => {
		const actual = mergeChanges();
		assert.deepStrictEqual(actual, { keys: [], overrides: [] });
	});

});
