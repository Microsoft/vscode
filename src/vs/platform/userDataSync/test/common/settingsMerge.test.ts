/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { merge, updateIgnoredSettings, addSetting } from 'vs/platform/userDataSync/common/settingsMerge';
import type { IConflictSetting } from 'vs/platform/userDataSync/common/userDataSync';

const formattingOptions = { eol: '\n', insertSpaces: false, tabSize: 4 };

suite('SettingsMerge - Merge', () => {

	test('merge when local and remote are same with one entry', async () => {
		const localContent = stringify({ 'a': 1 });
		const remoteContent = stringify({ 'a': 1 });
		const actual = merge(localContent, remoteContent, null, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when local and remote are same with multiple entries', async () => {
		const localContent = stringify({
			'a': 1,
			'b': 2
		});
		const remoteContent = stringify({
			'a': 1,
			'b': 2
		});
		const actual = merge(localContent, remoteContent, null, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when local and remote are same with multiple entries in different order', async () => {
		const localContent = stringify({
			'b': 2,
			'a': 1,
		});
		const remoteContent = stringify({
			'a': 1,
			'b': 2
		});
		const actual = merge(localContent, remoteContent, null, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, localContent);
		assert.strictEqual(actual.remoteContent, remoteContent);
		assert.ok(actual.hasConflicts);
		assert.strictEqual(actual.conflictsSettings.length, 0);
	});

	test('merge when local and remote are same with different base content', async () => {
		const localContent = stringify({
			'b': 2,
			'a': 1,
		});
		const baseContent = stringify({
			'a': 2,
			'b': 1
		});
		const remoteContent = stringify({
			'a': 1,
			'b': 2
		});
		const actual = merge(localContent, remoteContent, baseContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, localContent);
		assert.strictEqual(actual.remoteContent, remoteContent);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(actual.hasConflicts);
	});

	test('merge when a new entry is added to remote', async () => {
		const localContent = stringify({
			'a': 1,
		});
		const remoteContent = stringify({
			'a': 1,
			'b': 2
		});
		const actual = merge(localContent, remoteContent, null, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when multiple new entries are added to remote', async () => {
		const localContent = stringify({
			'a': 1,
		});
		const remoteContent = stringify({
			'a': 1,
			'b': 2,
			'c': 3,
		});
		const actual = merge(localContent, remoteContent, null, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when multiple new entries are added to remote from base and local has not changed', async () => {
		const localContent = stringify({
			'a': 1,
		});
		const remoteContent = stringify({
			'b': 2,
			'a': 1,
			'c': 3,
		});
		const actual = merge(localContent, remoteContent, localContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when an entry is removed from remote from base and local has not changed', async () => {
		const localContent = stringify({
			'a': 1,
			'b': 2,
		});
		const remoteContent = stringify({
			'a': 1,
		});
		const actual = merge(localContent, remoteContent, localContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when all entries are removed from base and local has not changed', async () => {
		const localContent = stringify({
			'a': 1,
		});
		const remoteContent = stringify({});
		const actual = merge(localContent, remoteContent, localContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when an entry is updated in remote from base and local has not changed', async () => {
		const localContent = stringify({
			'a': 1,
		});
		const remoteContent = stringify({
			'a': 2
		});
		const actual = merge(localContent, remoteContent, localContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when remote has moved forwareded with multiple changes and local stays with base', async () => {
		const localContent = stringify({
			'a': 1,
		});
		const remoteContent = stringify({
			'a': 2,
			'b': 1,
			'c': 3,
			'd': 4,
		});
		const actual = merge(localContent, remoteContent, localContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when remote has moved forwareded with order changes and local stays with base', async () => {
		const localContent = stringify({
			'a': 1,
			'b': 2,
			'c': 3,
		});
		const remoteContent = stringify({
			'a': 2,
			'd': 4,
			'c': 3,
			'b': 2,
		});
		const actual = merge(localContent, remoteContent, localContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when remote has moved forwareded with comment changes and local stays with base', async () => {
		const localContent = `
{
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 1,
}`;
		const remoteContent = stringify`
{
	// comment b has changed
	"b": 2,
	// this is comment for c
	"c": 1,
}`;
		const actual = merge(localContent, remoteContent, localContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when remote has moved forwareded with comment and order changes and local stays with base', async () => {
		const localContent = `
{
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 1,
}`;
		const remoteContent = stringify`
{
	// this is comment for c
	"c": 1,
	// comment b has changed
	"b": 2,
}`;
		const actual = merge(localContent, remoteContent, localContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when a new entries are added to local', async () => {
		const localContent = stringify({
			'a': 1,
			'b': 2,
			'c': 3,
			'd': 4,
		});
		const remoteContent = stringify({
			'a': 1,
		});
		const actual = merge(localContent, remoteContent, null, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, localContent);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when multiple new entries are added to local from base and remote is not changed', async () => {
		const localContent = stringify({
			'a': 2,
			'b': 1,
			'c': 3,
			'd': 4,
		});
		const remoteContent = stringify({
			'a': 1,
		});
		const actual = merge(localContent, remoteContent, remoteContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, localContent);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when an entry is removed from local from base and remote has not changed', async () => {
		const localContent = stringify({
			'a': 1,
			'c': 2
		});
		const remoteContent = stringify({
			'a': 2,
			'b': 1,
			'c': 3,
			'd': 4,
		});
		const actual = merge(localContent, remoteContent, remoteContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, localContent);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when an entry is updated in local from base and remote has not changed', async () => {
		const localContent = stringify({
			'a': 1,
			'c': 2
		});
		const remoteContent = stringify({
			'a': 2,
			'c': 2,
		});
		const actual = merge(localContent, remoteContent, remoteContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, localContent);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when local has moved forwarded with multiple changes and remote stays with base', async () => {
		const localContent = stringify({
			'a': 2,
			'b': 1,
			'c': 3,
			'd': 4,
		});
		const remoteContent = stringify({
			'a': 1,
		});
		const actual = merge(localContent, remoteContent, remoteContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, localContent);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when local has moved forwarded with order changes and remote stays with base', async () => {
		const localContent = `
{
	"b": 2,
	"c": 1,
}`;
		const remoteContent = stringify`
{
	"c": 1,
	"b": 2,
}`;
		const actual = merge(localContent, remoteContent, remoteContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, localContent);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when local has moved forwarded with comment changes and remote stays with base', async () => {
		const localContent = `
{
	// comment for b has changed
	"b": 2,
	// comment for c
	"c": 1,
}`;
		const remoteContent = stringify`
{
	// comment for b
	"b": 2,
	// comment for c
	"c": 1,
}`;
		const actual = merge(localContent, remoteContent, remoteContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, localContent);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when local has moved forwarded with comment and order changes and remote stays with base', async () => {
		const localContent = `
{
	// comment for c
	"c": 1,
	// comment for b has changed
	"b": 2,
}`;
		const remoteContent = stringify`
{
	// comment for b
	"b": 2,
	// comment for c
	"c": 1,
}`;
		const actual = merge(localContent, remoteContent, remoteContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, localContent);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('merge when local and remote with one entry but different value', async () => {
		const localContent = stringify({
			'a': 1
		});
		const remoteContent = stringify({
			'a': 2
		});
		const expectedConflicts: IConflictSetting[] = [{ key: 'a', localValue: 1, remoteValue: 2 }];
		const actual = merge(localContent, remoteContent, null, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, localContent);
		assert.strictEqual(actual.remoteContent, remoteContent);
		assert.ok(actual.hasConflicts);
		assert.deepStrictEqual(actual.conflictsSettings, expectedConflicts);
	});

	test('merge when the entry is removed in remote but updated in local and a new entry is added in remote', async () => {
		const baseContent = stringify({
			'a': 1
		});
		const localContent = stringify({
			'a': 2
		});
		const remoteContent = stringify({
			'b': 2
		});
		const expectedConflicts: IConflictSetting[] = [{ key: 'a', localValue: 2, remoteValue: undefined }];
		const actual = merge(localContent, remoteContent, baseContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, stringify({
			'a': 2,
			'b': 2
		}));
		assert.strictEqual(actual.remoteContent, remoteContent);
		assert.ok(actual.hasConflicts);
		assert.deepStrictEqual(actual.conflictsSettings, expectedConflicts);
	});

	test('merge with single entry and local is empty', async () => {
		const baseContent = stringify({
			'a': 1
		});
		const localContent = stringify({});
		const remoteContent = stringify({
			'a': 2
		});
		const expectedConflicts: IConflictSetting[] = [{ key: 'a', localValue: undefined, remoteValue: 2 }];
		const actual = merge(localContent, remoteContent, baseContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, localContent);
		assert.strictEqual(actual.remoteContent, remoteContent);
		assert.ok(actual.hasConflicts);
		assert.deepStrictEqual(actual.conflictsSettings, expectedConflicts);
	});

	test('merge when local and remote has moved forwareded with conflicts', async () => {
		const baseContent = stringify({
			'a': 1,
			'b': 2,
			'c': 3,
			'd': 4,
		});
		const localContent = stringify({
			'a': 2,
			'c': 3,
			'd': 5,
			'e': 4,
			'f': 1,
		});
		const remoteContent = stringify({
			'b': 3,
			'c': 3,
			'd': 6,
			'e': 5,
		});
		const expectedConflicts: IConflictSetting[] = [
			{ key: 'b', localValue: undefined, remoteValue: 3 },
			{ key: 'a', localValue: 2, remoteValue: undefined },
			{ key: 'd', localValue: 5, remoteValue: 6 },
			{ key: 'e', localValue: 4, remoteValue: 5 },
		];
		const actual = merge(localContent, remoteContent, baseContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, stringify({
			'a': 2,
			'c': 3,
			'd': 5,
			'e': 4,
			'f': 1,
		}));
		assert.strictEqual(actual.remoteContent, stringify({
			'b': 3,
			'c': 3,
			'd': 6,
			'e': 5,
			'f': 1,
		}));
		assert.ok(actual.hasConflicts);
		assert.deepStrictEqual(actual.conflictsSettings, expectedConflicts);
	});

	test('merge when local and remote has moved forwareded with change in order', async () => {
		const baseContent = stringify({
			'a': 1,
			'b': 2,
			'c': 3,
			'd': 4,
		});
		const localContent = stringify({
			'a': 2,
			'c': 3,
			'b': 2,
			'd': 4,
			'e': 5,
		});
		const remoteContent = stringify({
			'a': 1,
			'b': 2,
			'c': 4,
		});
		const actual = merge(localContent, remoteContent, baseContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, stringify({
			'a': 2,
			'c': 4,
			'b': 2,
			'e': 5,
		}));
		assert.strictEqual(actual.remoteContent, stringify({
			'a': 2,
			'b': 2,
			'e': 5,
			'c': 4,
		}));
		assert.ok(actual.hasConflicts);
		assert.deepStrictEqual(actual.conflictsSettings, []);
	});

	test('merge when local and remote has moved forwareded with comment changes', async () => {
		const baseContent = `
{
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 1
}`;
		const localContent = `
{
	// comment b has changed in local
	"b": 2,
	// this is comment for c
	"c": 1
}`;
		const remoteContent = `
{
	// comment b has changed in remote
	"b": 2,
	// this is comment for c
	"c": 1
}`;
		const actual = merge(localContent, remoteContent, baseContent, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, localContent);
		assert.strictEqual(actual.remoteContent, remoteContent);
		assert.ok(actual.hasConflicts);
		assert.deepStrictEqual(actual.conflictsSettings, []);
	});

	test('resolve when local and remote has moved forwareded with resolved conflicts', async () => {
		const baseContent = stringify({
			'a': 1,
			'b': 2,
			'c': 3,
			'd': 4,
		});
		const localContent = stringify({
			'a': 2,
			'c': 3,
			'd': 5,
			'e': 4,
			'f': 1,
		});
		const remoteContent = stringify({
			'b': 3,
			'c': 3,
			'd': 6,
			'e': 5,
		});
		const expectedConflicts: IConflictSetting[] = [
			{ key: 'd', localValue: 5, remoteValue: 6 },
		];
		const actual = merge(localContent, remoteContent, baseContent, [], [{ key: 'a', value: 2 }, { key: 'b', value: undefined }, { key: 'e', value: 5 }], formattingOptions);
		assert.strictEqual(actual.localContent, stringify({
			'a': 2,
			'c': 3,
			'd': 5,
			'e': 5,
			'f': 1,
		}));
		assert.strictEqual(actual.remoteContent, stringify({
			'c': 3,
			'd': 6,
			'e': 5,
			'f': 1,
			'a': 2,
		}));
		assert.ok(actual.hasConflicts);
		assert.deepStrictEqual(actual.conflictsSettings, expectedConflicts);
	});

	test('ignored setting is not merged when changed in local and remote', async () => {
		const localContent = stringify({ 'a': 1 });
		const remoteContent = stringify({ 'a': 2 });
		const actual = merge(localContent, remoteContent, null, ['a'], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('ignored setting is not merged when changed in local and remote from base', async () => {
		const baseContent = stringify({ 'a': 0 });
		const localContent = stringify({ 'a': 1 });
		const remoteContent = stringify({ 'a': 2 });
		const actual = merge(localContent, remoteContent, baseContent, ['a'], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('ignored setting is not merged when added in remote', async () => {
		const localContent = stringify({});
		const remoteContent = stringify({ 'a': 1 });
		const actual = merge(localContent, remoteContent, null, ['a'], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('ignored setting is not merged when added in remote from base', async () => {
		const localContent = stringify({ 'b': 2 });
		const remoteContent = stringify({ 'a': 1, 'b': 2 });
		const actual = merge(localContent, remoteContent, localContent, ['a'], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('ignored setting is not merged when removed in remote', async () => {
		const localContent = stringify({ 'a': 1 });
		const remoteContent = stringify({});
		const actual = merge(localContent, remoteContent, null, ['a'], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('ignored setting is not merged when removed in remote from base', async () => {
		const localContent = stringify({ 'a': 2 });
		const remoteContent = stringify({});
		const actual = merge(localContent, remoteContent, localContent, ['a'], [], formattingOptions);
		assert.strictEqual(actual.localContent, null);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('ignored setting is not merged with other changes without conflicts', async () => {
		const baseContent = stringify({
			'a': 2,
			'b': 2,
			'c': 3,
			'd': 4,
			'e': 5,
		});
		const localContent = stringify({
			'a': 1,
			'b': 2,
			'c': 3,
		});
		const remoteContent = stringify({
			'a': 3,
			'b': 3,
			'd': 4,
			'e': 6,
		});
		const actual = merge(localContent, remoteContent, baseContent, ['a', 'e'], [], formattingOptions);
		assert.strictEqual(actual.localContent, stringify({
			'a': 1,
			'b': 3,
		}));
		assert.strictEqual(actual.remoteContent, stringify({
			'a': 3,
			'b': 3,
			'e': 6,
		}));
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});

	test('ignored setting is not merged with other changes conflicts', async () => {
		const baseContent = stringify({
			'a': 2,
			'b': 2,
			'c': 3,
			'd': 4,
			'e': 5,
		});
		const localContent = stringify({
			'a': 1,
			'b': 4,
			'c': 3,
			'd': 5,
		});
		const remoteContent = stringify({
			'a': 3,
			'b': 3,
			'e': 6,
		});
		const expectedConflicts: IConflictSetting[] = [
			{ key: 'd', localValue: 5, remoteValue: undefined },
			{ key: 'b', localValue: 4, remoteValue: 3 },
		];
		const actual = merge(localContent, remoteContent, baseContent, ['a', 'e'], [], formattingOptions);
		assert.strictEqual(actual.localContent, stringify({
			'a': 1,
			'b': 4,
			'd': 5,
		}));
		assert.strictEqual(actual.remoteContent, stringify({
			'a': 3,
			'b': 3,
			'e': 6,
		}));
		assert.deepStrictEqual(actual.conflictsSettings, expectedConflicts);
		assert.ok(actual.hasConflicts);
	});

	test('merge when remote has comments and local is empty', async () => {
		const localContent = `
{

}`;
		const remoteContent = stringify`
{
	// this is a comment
	"a": 1,
}`;
		const actual = merge(localContent, remoteContent, null, [], [], formattingOptions);
		assert.strictEqual(actual.localContent, remoteContent);
		assert.strictEqual(actual.remoteContent, null);
		assert.strictEqual(actual.conflictsSettings.length, 0);
		assert.ok(!actual.hasConflicts);
	});
});

suite('SettingsMerge - Compute Remote Content', () => {

	test('local content is returned when there are no ignored settings', async () => {
		const localContent = stringify({
			'a': 1,
			'b': 2,
			'c': 3,
		});
		const remoteContent = stringify({
			'a': 3,
			'b': 3,
			'd': 4,
			'e': 6,
		});
		const actual = updateIgnoredSettings(localContent, remoteContent, [], formattingOptions);
		assert.strictEqual(actual, localContent);
	});

	test('ignored settings are not updated from remote content', async () => {
		const localContent = stringify({
			'a': 1,
			'b': 2,
			'c': 3,
		});
		const remoteContent = stringify({
			'a': 3,
			'b': 3,
			'd': 4,
			'e': 6,
		});
		const expected = stringify({
			'a': 3,
			'b': 2,
			'c': 3,
		});
		const actual = updateIgnoredSettings(localContent, remoteContent, ['a'], formattingOptions);
		assert.strictEqual(actual, expected);
	});

});

suite('SettingsMerge - Add Setting', () => {

	test('Insert after a setting without comments', () => {

		const sourceContent = `
{
	"a": 1,
	"b": 2,
	"c": 3
}`;
		const targetContent = `
{
	"a": 2,
	"d": 3
}`;

		const expected = `
{
	"a": 2,
	"b": 2,
	"d": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting without comments at the end', () => {

		const sourceContent = `
{
	"a": 1,
	"b": 2,
	"c": 3
}`;
		const targetContent = `
{
	"a": 2
}`;

		const expected = `
{
	"a": 2,
	"b": 2
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert between settings without comment', () => {

		const sourceContent = `
{
	"a": 1,
	"b": 2,
	"c": 3
}`;
		const targetContent = `
{
	"a": 1,
	"c": 3
}`;

		const expected = `
{
	"a": 1,
	"b": 2,
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert between settings and there is a comment in between in source', () => {

		const sourceContent = `
{
	"a": 1,
	// this is comment for b
	"b": 2,
	"c": 3
}`;
		const targetContent = `
{
	"a": 1,
	"c": 3
}`;

		const expected = `
{
	"a": 1,
	"b": 2,
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting and after a comment at the end', () => {

		const sourceContent = `
{
	"a": 1,
	// this is comment for b
	"b": 2
}`;
		const targetContent = `
{
	"a": 1
	// this is comment for b
}`;

		const expected = `
{
	"a": 1,
	// this is comment for b
	"b": 2
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting ending with comma and after a comment at the end', () => {

		const sourceContent = `
{
	"a": 1,
	// this is comment for b
	"b": 2
}`;
		const targetContent = `
{
	"a": 1,
	// this is comment for b
}`;

		const expected = `
{
	"a": 1,
	// this is comment for b
	"b": 2
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a comment and there are no settings', () => {

		const sourceContent = `
{
	// this is comment for b
	"b": 2
}`;
		const targetContent = `
{
	// this is comment for b
}`;

		const expected = `
{
	// this is comment for b
	"b": 2
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting and between a comment and setting', () => {

		const sourceContent = `
{
	"a": 1,
	// this is comment for b
	"b": 2,
	"c": 3
}`;
		const targetContent = `
{
	"a": 1,
	// this is comment for b
	"c": 3
}`;

		const expected = `
{
	"a": 1,
	// this is comment for b
	"b": 2,
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting between two comments and there is a setting after', () => {

		const sourceContent = `
{
	"a": 1,
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 3
}`;
		const targetContent = `
{
	"a": 1,
	// this is comment for b
	// this is comment for c
	"c": 3
}`;

		const expected = `
{
	"a": 1,
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting between two comments on the same line and there is a setting after', () => {

		const sourceContent = `
{
	"a": 1,
	/* this is comment for b */
	"b": 2,
	// this is comment for c
	"c": 3
}`;
		const targetContent = `
{
	"a": 1,
	/* this is comment for b */ // this is comment for c
	"c": 3
}`;

		const expected = `
{
	"a": 1,
	/* this is comment for b */
	"b": 2, // this is comment for c
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting between two line comments on the same line and there is a setting after', () => {

		const sourceContent = `
{
	"a": 1,
	/* this is comment for b */
	"b": 2,
	// this is comment for c
	"c": 3
}`;
		const targetContent = `
{
	"a": 1,
	// this is comment for b // this is comment for c
	"c": 3
}`;

		const expected = `
{
	"a": 1,
	// this is comment for b // this is comment for c
	"b": 2,
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting between two comments and there is no setting after', () => {

		const sourceContent = `
{
	"a": 1,
	// this is comment for b
	"b": 2
	// this is a comment
}`;
		const targetContent = `
{
	"a": 1
	// this is comment for b
	// this is a comment
}`;

		const expected = `
{
	"a": 1,
	// this is comment for b
	"b": 2
	// this is a comment
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting with comma and between two comments and there is no setting after', () => {

		const sourceContent = `
{
	"a": 1,
	// this is comment for b
	"b": 2
	// this is a comment
}`;
		const targetContent = `
{
	"a": 1,
	// this is comment for b
	// this is a comment
}`;

		const expected = `
{
	"a": 1,
	// this is comment for b
	"b": 2
	// this is a comment
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});
	test('Insert before a setting without comments', () => {

		const sourceContent = `
{
	"a": 1,
	"b": 2,
	"c": 3
}`;
		const targetContent = `
{
	"d": 2,
	"c": 3
}`;

		const expected = `
{
	"d": 2,
	"b": 2,
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting without comments at the end', () => {

		const sourceContent = `
{
	"a": 1,
	"b": 2,
	"c": 3
}`;
		const targetContent = `
{
	"c": 3
}`;

		const expected = `
{
	"b": 2,
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting with comment', () => {

		const sourceContent = `
{
	"a": 1,
	"b": 2,
	// this is comment for c
	"c": 3
}`;
		const targetContent = `
{
	// this is comment for c
	"c": 3
}`;

		const expected = `
{
	"b": 2,
	// this is comment for c
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting and before a comment at the beginning', () => {

		const sourceContent = `
{
	// this is comment for b
	"b": 2,
	"c": 3,
}`;
		const targetContent = `
{
	// this is comment for b
	"c": 3
}`;

		const expected = `
{
	// this is comment for b
	"b": 2,
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting ending with comma and before a comment at the begninning', () => {

		const sourceContent = `
{
	// this is comment for b
	"b": 2,
	"c": 3,
}`;
		const targetContent = `
{
	// this is comment for b
	"c": 3,
}`;

		const expected = `
{
	// this is comment for b
	"b": 2,
	"c": 3,
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting and between a setting and comment', () => {

		const sourceContent = `
{
	"a": 1,
	// this is comment for b
	"b": 2,
	"c": 3
}`;
		const targetContent = `
{
	"d": 1,
	// this is comment for b
	"c": 3
}`;

		const expected = `
{
	"d": 1,
	// this is comment for b
	"b": 2,
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting between two comments and there is a setting before', () => {

		const sourceContent = `
{
	"a": 1,
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 3
}`;
		const targetContent = `
{
	"d": 1,
	// this is comment for b
	// this is comment for c
	"c": 3
}`;

		const expected = `
{
	"d": 1,
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting between two comments on the same line and there is a setting before', () => {

		const sourceContent = `
{
	"a": 1,
	/* this is comment for b */
	"b": 2,
	// this is comment for c
	"c": 3
}`;
		const targetContent = `
{
	"d": 1,
	/* this is comment for b */ // this is comment for c
	"c": 3
}`;

		const expected = `
{
	"d": 1,
	/* this is comment for b */
	"b": 2,
	// this is comment for c
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting between two line comments on the same line and there is a setting before', () => {

		const sourceContent = `
{
	"a": 1,
	/* this is comment for b */
	"b": 2,
	// this is comment for c
	"c": 3
}`;
		const targetContent = `
{
	"d": 1,
	// this is comment for b // this is comment for c
	"c": 3
}`;

		const expected = `
{
	"d": 1,
	"b": 2,
	// this is comment for b // this is comment for c
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting between two comments and there is no setting before', () => {

		const sourceContent = `
{
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 1
}`;
		const targetContent = `
{
	// this is comment for b
	// this is comment for c
	"c": 1
}`;

		const expected = `
{
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 1
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert before a setting with comma and between two comments and there is no setting before', () => {

		const sourceContent = `
{
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 1
}`;
		const targetContent = `
{
	// this is comment for b
	// this is comment for c
	"c": 1,
}`;

		const expected = `
{
	// this is comment for b
	"b": 2,
	// this is comment for c
	"c": 1,
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a setting that is of object type', () => {

		const sourceContent = `
{
	"b": {
		"d": 1
	},
	"a": 2,
	"c": 1
}`;
		const targetContent = `
{
	"b": {
		"d": 1
	},
	"c": 1
}`;

		const actual = addSetting('a', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, sourceContent);
	});

	test('Insert after a setting that is of array type', () => {

		const sourceContent = `
{
	"b": [
		1
	],
	"a": 2,
	"c": 1
}`;
		const targetContent = `
{
	"b": [
		1
	],
	"c": 1
}`;

		const actual = addSetting('a', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, sourceContent);
	});

	test('Insert after a comment with comma separator of previous setting and no next nodes ', () => {

		const sourceContent = `
{
	"a": 1
	// this is comment for a
	,
	"b": 2
}`;
		const targetContent = `
{
	"a": 1
	// this is comment for a
	,
}`;

		const expected = `
{
	"a": 1
	// this is comment for a
	,
	"b": 2
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a comment with comma separator of previous setting and there is a setting after ', () => {

		const sourceContent = `
{
	"a": 1
	// this is comment for a
	,
	"b": 2,
	"c": 3
}`;
		const targetContent = `
{
	"a": 1
	// this is comment for a
	,
	"c": 3
}`;

		const expected = `
{
	"a": 1
	// this is comment for a
	,
	"b": 2,
	"c": 3
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});

	test('Insert after a comment with comma separator of previous setting and there is a comment after ', () => {

		const sourceContent = `
{
	"a": 1
	// this is comment for a
	,
	"b": 2
	// this is a comment
}`;
		const targetContent = `
{
	"a": 1
	// this is comment for a
	,
	// this is a comment
}`;

		const expected = `
{
	"a": 1
	// this is comment for a
	,
	"b": 2
	// this is a comment
}`;

		const actual = addSetting('b', sourceContent, targetContent, formattingOptions);

		assert.strictEqual(actual, expected);
	});
});


function stringify(value: any): string {
	return JSON.stringify(value, null, '\t');
}
