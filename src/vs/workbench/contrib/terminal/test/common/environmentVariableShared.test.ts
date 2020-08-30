/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { deepStrictEqual } from 'assert';
import { deserializeEnvironmentVariableCollection, serializeEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariableShared';
import { EnvironmentVariableMutatorType, IEnvironmentVariableMutator } from 'vs/workbench/contrib/terminal/common/environmentVariable';

suite('EnvironmentVariable - deserializeEnvironmentVariableCollection', () => {
	test('should construct correctly with 3 arguments', () => {
		const c = deserializeEnvironmentVariableCollection([
			['A', { value: 'a', type: EnvironmentVariableMutatorType.Replace }],
			['B', { value: 'b', type: EnvironmentVariableMutatorType.Append }],
			['C', { value: 'c', type: EnvironmentVariableMutatorType.Prepend }]
		]);
		const keys = [...c.keys()];
		deepStrictEqual(keys, ['A', 'B', 'C']);
		deepStrictEqual(c.get('A'), { value: 'a', type: EnvironmentVariableMutatorType.Replace });
		deepStrictEqual(c.get('B'), { value: 'b', type: EnvironmentVariableMutatorType.Append });
		deepStrictEqual(c.get('C'), { value: 'c', type: EnvironmentVariableMutatorType.Prepend });
	});
});

suite('EnvironmentVariable - serializeEnvironmentVariableCollection', () => {
	test('should correctly serialize the object', () => {
		const collection = new Map<string, IEnvironmentVariableMutator>();
		deepStrictEqual(serializeEnvironmentVariableCollection(collection), []);
		collection.set('A', { value: 'a', type: EnvironmentVariableMutatorType.Replace });
		collection.set('B', { value: 'b', type: EnvironmentVariableMutatorType.Append });
		collection.set('C', { value: 'c', type: EnvironmentVariableMutatorType.Prepend });
		deepStrictEqual(serializeEnvironmentVariableCollection(collection), [
			['A', { value: 'a', type: EnvironmentVariableMutatorType.Replace }],
			['B', { value: 'b', type: EnvironmentVariableMutatorType.Append }],
			['C', { value: 'c', type: EnvironmentVariableMutatorType.Prepend }]
		]);
	});
});
