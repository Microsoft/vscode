/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { merge } from 'vs/platform/userDataSync/common/keybindingsMerge';
import { TestUserDataSyncUtilService } from 'vs/platform/userDataSync/test/common/userDataSyncClient';

suite('KeybindingsMerge - No Conflicts', () => {

	test('merge when local and remote are same with one entry', async () => {
		const localContent = stringify([{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const remoteContent = stringify([{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(!actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when local and remote are same with similar when contexts', async () => {
		const localContent = stringify([{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const remoteContent = stringify([{ key: 'alt+c', command: 'a', when: '!editorReadonly && editorTextFocus' }]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(!actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when local and remote has entries in different order', async () => {
		const localContent = stringify([
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+a', command: 'a', when: 'editorTextFocus' }
		]);
		const remoteContent = stringify([
			{ key: 'alt+a', command: 'a', when: 'editorTextFocus' },
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' }
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(!actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when local and remote are same with multiple entries', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } }
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } }
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(!actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when local and remote are same with different base content', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } }
		]);
		const baseContent = stringify([
			{ key: 'ctrl+c', command: 'e' },
			{ key: 'shift+d', command: 'd', args: { text: '`' } }
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } }
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, baseContent);
		assert.ok(!actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when local and remote are same with multiple entries in different order', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } }
		]);
		const remoteContent = stringify([
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(!actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when local and remote are same when remove entry is in different order', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } }
		]);
		const remoteContent = stringify([
			{ key: 'alt+d', command: '-a' },
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(!actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when a new entry is added to remote', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, remoteContent);
	});

	test('merge when multiple new entries are added to remote', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
			{ key: 'cmd+d', command: 'c' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, remoteContent);
	});

	test('merge when multiple new entries are added to remote from base and local has not changed', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
			{ key: 'cmd+d', command: 'c' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, localContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, remoteContent);
	});

	test('merge when an entry is removed from remote from base and local has not changed', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, localContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, remoteContent);
	});

	test('merge when an entry (same command) is removed from remote from base and local has not changed', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, localContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, remoteContent);
	});

	test('merge when an entry is updated in remote from base and local has not changed', async () => {
		const localContent = stringify([
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, localContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, remoteContent);
	});

	test('merge when a command with multiple entries is updated from remote from base and local has not changed', async () => {
		const localContent = stringify([
			{ key: 'shift+c', command: 'c' },
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: 'b' },
			{ key: 'cmd+c', command: 'a' },
		]);
		const remoteContent = stringify([
			{ key: 'shift+c', command: 'c' },
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: 'b' },
			{ key: 'cmd+d', command: 'a' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, localContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, remoteContent);
	});

	test('merge when remote has moved forwareded with multiple changes and local stays with base', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+e', command: 'd' },
			{ key: 'cmd+d', command: 'c', when: 'context1' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'cmd+e', command: 'd' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'alt+f', command: 'f' },
			{ key: 'alt+d', command: '-f' },
			{ key: 'cmd+d', command: 'c', when: 'context1' },
			{ key: 'cmd+c', command: '-c' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, localContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, remoteContent);
	});

	test('merge when a new entry is added to local', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when multiple new entries are added to local', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
			{ key: 'cmd+d', command: 'c' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when multiple new entries are added to local from base and remote is not changed', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
			{ key: 'cmd+d', command: 'c' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, remoteContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when an entry is removed from local from base and remote has not changed', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, remoteContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when an entry (with same command) is removed from local from base and remote has not changed', async () => {
		const localContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: '-a' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, remoteContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when an entry is updated in local from base and remote has not changed', async () => {
		const localContent = stringify([
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, remoteContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when a command with multiple entries is updated from local from base and remote has not changed', async () => {
		const localContent = stringify([
			{ key: 'shift+c', command: 'c' },
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: 'b' },
			{ key: 'cmd+c', command: 'a' },
		]);
		const remoteContent = stringify([
			{ key: 'shift+c', command: 'c' },
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+d', command: 'b' },
			{ key: 'cmd+d', command: 'a' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, remoteContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, localContent);
	});

	test('merge when local has moved forwareded with multiple changes and remote stays with base', async () => {
		const localContent = stringify([
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'cmd+e', command: 'd' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'alt+f', command: 'f' },
			{ key: 'alt+d', command: '-f' },
			{ key: 'cmd+d', command: 'c', when: 'context1' },
			{ key: 'cmd+c', command: '-c' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'cmd+c', command: 'b', args: { text: '`' } },
			{ key: 'alt+d', command: '-a' },
			{ key: 'cmd+e', command: 'd' },
			{ key: 'cmd+d', command: 'c', when: 'context1' },
		]);
		const expected = stringify([
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'cmd+e', command: 'd' },
			{ key: 'alt+d', command: '-a' },
			{ key: 'alt+f', command: 'f' },
			{ key: 'alt+d', command: '-f' },
			{ key: 'cmd+d', command: 'c', when: 'context1' },
			{ key: 'cmd+c', command: '-c' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, remoteContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, expected);
	});

	test('merge when local and remote has moved forwareded with conflicts', async () => {
		const baseContent = stringify([
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'ctrl+c', command: '-a' },
			{ key: 'cmd+e', command: 'd' },
			{ key: 'alt+a', command: 'f' },
			{ key: 'alt+d', command: '-f' },
			{ key: 'cmd+d', command: 'c', when: 'context1' },
			{ key: 'cmd+c', command: '-c' },
		]);
		const localContent = stringify([
			{ key: 'alt+d', command: '-f' },
			{ key: 'cmd+e', command: 'd' },
			{ key: 'cmd+c', command: '-c' },
			{ key: 'cmd+d', command: 'c', when: 'context1' },
			{ key: 'alt+a', command: 'f' },
			{ key: 'alt+e', command: 'e' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+a', command: 'f' },
			{ key: 'cmd+c', command: '-c' },
			{ key: 'cmd+d', command: 'd' },
			{ key: 'alt+d', command: '-f' },
			{ key: 'alt+c', command: 'c', when: 'context1' },
			{ key: 'alt+g', command: 'g', when: 'context2' },
		]);
		const expected = stringify([
			{ key: 'alt+d', command: '-f' },
			{ key: 'cmd+d', command: 'd' },
			{ key: 'cmd+c', command: '-c' },
			{ key: 'alt+c', command: 'c', when: 'context1' },
			{ key: 'alt+a', command: 'f' },
			{ key: 'alt+e', command: 'e' },
			{ key: 'alt+g', command: 'g', when: 'context2' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, baseContent);
		assert.ok(actual.hasChanges);
		assert.ok(!actual.hasConflicts);
		assert.strictEqual(actual.mergeContent, expected);
	});

	test('merge when local and remote with one entry but different value', async () => {
		const localContent = stringify([{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const remoteContent = stringify([{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(actual.hasChanges);
		assert.ok(actual.hasConflicts);
		assert.strictEqual(actual.mergeContent,
			`[
	{
		"key": "alt+d",
		"command": "a",
		"when": "editorTextFocus && !editorReadonly"
	}
]`);
	});

	test('merge when local and remote with different keybinding', async () => {
		const localContent = stringify([
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+a', command: '-a', when: 'editorTextFocus && !editorReadonly' }
		]);
		const remoteContent = stringify([
			{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+a', command: '-a', when: 'editorTextFocus && !editorReadonly' }
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, null);
		assert.ok(actual.hasChanges);
		assert.ok(actual.hasConflicts);
		assert.strictEqual(actual.mergeContent,
			`[
	{
		"key": "alt+d",
		"command": "a",
		"when": "editorTextFocus && !editorReadonly"
	},
	{
		"key": "alt+a",
		"command": "-a",
		"when": "editorTextFocus && !editorReadonly"
	}
]`);
	});

	test('merge when the entry is removed in local but updated in remote', async () => {
		const baseContent = stringify([{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const localContent = stringify([]);
		const remoteContent = stringify([{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const actual = await mergeKeybindings(localContent, remoteContent, baseContent);
		assert.ok(actual.hasChanges);
		assert.ok(actual.hasConflicts);
		assert.strictEqual(actual.mergeContent,
			`[]`);
	});

	test('merge when the entry is removed in local but updated in remote and a new entry is added in local', async () => {
		const baseContent = stringify([{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const localContent = stringify([{ key: 'alt+b', command: 'b' }]);
		const remoteContent = stringify([{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const actual = await mergeKeybindings(localContent, remoteContent, baseContent);
		assert.ok(actual.hasChanges);
		assert.ok(actual.hasConflicts);
		assert.strictEqual(actual.mergeContent,
			`[
	{
		"key": "alt+b",
		"command": "b"
	}
]`);
	});

	test('merge when the entry is removed in remote but updated in local', async () => {
		const baseContent = stringify([{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const localContent = stringify([{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const remoteContent = stringify([]);
		const actual = await mergeKeybindings(localContent, remoteContent, baseContent);
		assert.ok(actual.hasChanges);
		assert.ok(actual.hasConflicts);
		assert.strictEqual(actual.mergeContent,
			`[
	{
		"key": "alt+c",
		"command": "a",
		"when": "editorTextFocus && !editorReadonly"
	}
]`);
	});

	test('merge when the entry is removed in remote but updated in local and a new entry is added in remote', async () => {
		const baseContent = stringify([{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const localContent = stringify([{ key: 'alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' }]);
		const remoteContent = stringify([{ key: 'alt+b', command: 'b' }]);
		const actual = await mergeKeybindings(localContent, remoteContent, baseContent);
		assert.ok(actual.hasChanges);
		assert.ok(actual.hasConflicts);
		assert.strictEqual(actual.mergeContent,
			`[
	{
		"key": "alt+c",
		"command": "a",
		"when": "editorTextFocus && !editorReadonly"
	},
	{
		"key": "alt+b",
		"command": "b"
	}
]`);
	});

	test('merge when local and remote has moved forwareded with conflicts', async () => {
		const baseContent = stringify([
			{ key: 'alt+d', command: 'a', when: 'editorTextFocus && !editorReadonly' },
			{ key: 'alt+c', command: '-a' },
			{ key: 'cmd+e', command: 'd' },
			{ key: 'alt+a', command: 'f' },
			{ key: 'alt+d', command: '-f' },
			{ key: 'cmd+d', command: 'c', when: 'context1' },
			{ key: 'cmd+c', command: '-c' },
		]);
		const localContent = stringify([
			{ key: 'alt+d', command: '-f' },
			{ key: 'cmd+e', command: 'd' },
			{ key: 'cmd+c', command: '-c' },
			{ key: 'cmd+d', command: 'c', when: 'context1' },
			{ key: 'alt+a', command: 'f' },
			{ key: 'alt+e', command: 'e' },
		]);
		const remoteContent = stringify([
			{ key: 'alt+a', command: 'f' },
			{ key: 'cmd+c', command: '-c' },
			{ key: 'cmd+d', command: 'd' },
			{ key: 'alt+d', command: '-f' },
			{ key: 'alt+c', command: 'c', when: 'context1' },
			{ key: 'alt+g', command: 'g', when: 'context2' },
		]);
		const actual = await mergeKeybindings(localContent, remoteContent, baseContent);
		assert.ok(actual.hasChanges);
		assert.ok(actual.hasConflicts);
		assert.strictEqual(actual.mergeContent,
			`[
	{
		"key": "alt+d",
		"command": "-f"
	},
	{
		"key": "cmd+d",
		"command": "d"
	},
	{
		"key": "cmd+c",
		"command": "-c"
	},
	{
		"key": "cmd+d",
		"command": "c",
		"when": "context1"
	},
	{
		"key": "alt+a",
		"command": "f"
	},
	{
		"key": "alt+e",
		"command": "e"
	},
	{
		"key": "alt+g",
		"command": "g",
		"when": "context2"
	}
]`);
	});

});

async function mergeKeybindings(localContent: string, remoteContent: string, baseContent: string | null) {
	const userDataSyncUtilService = new TestUserDataSyncUtilService();
	const formattingOptions = await userDataSyncUtilService.resolveFormattingOptions();
	return merge(localContent, remoteContent, baseContent, formattingOptions, userDataSyncUtilService);
}

function stringify(value: any): string {
	return JSON.stringify(value, null, '\t');
}
