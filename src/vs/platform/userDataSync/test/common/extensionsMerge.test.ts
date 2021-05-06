/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ISyncExtension, ISyncExtensionWithVersion } from 'vs/platform/userDataSync/common/userDataSync';
import { merge } from 'vs/platform/userDataSync/common/extensionsMerge';

suite('ExtensionsMerge', () => {

	test('merge returns local extension if remote does not exist', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, null, null, [], []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, localExtensions);
	});

	test('merge returns local extension if remote does not exist with ignored extensions', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, null, null, [], ['a']);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge returns local extension if remote does not exist with ignored extensions (ignore case)', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, null, null, [], ['A']);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge returns local extension if remote does not exist with skipped extensions', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const skippedExtension: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, null, null, skippedExtension, []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge returns local extension if remote does not exist with skipped and ignored extensions', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const skippedExtension: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, null, null, skippedExtension, ['a']);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when there is no base', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' }, { identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when there is no base and with ignored extensions', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], ['a']);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' }, { identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when remote is moved forwarded', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' }, { identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, [{ id: 'a', uuid: 'a' }, { id: 'd', uuid: 'd' }]);
		assert.deepStrictEqual(actual.updated, []);
		assert.strictEqual(actual.remote, null);
	});

	test('merge local and remote extensions when remote is moved forwarded with disabled extension', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, disabled: true, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' }, { identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, [{ id: 'a', uuid: 'a' }]);
		assert.deepStrictEqual(actual.updated, [{ identifier: { id: 'd', uuid: 'd' }, disabled: true, installed: true, version: '1.0.0' }]);
		assert.strictEqual(actual.remote, null);
	});

	test('merge local and remote extensions when remote moved forwarded with ignored extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], ['a']);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' }, { identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, [{ id: 'd', uuid: 'd' }]);
		assert.deepStrictEqual(actual.updated, []);
		assert.strictEqual(actual.remote, null);
	});

	test('merge local and remote extensions when remote is moved forwarded with skipped extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, []);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' }, { identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, [{ id: 'd', uuid: 'd' }]);
		assert.deepStrictEqual(actual.updated, []);
		assert.strictEqual(actual.remote, null);
	});

	test('merge local and remote extensions when remote is moved forwarded with skipped and ignored extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, ['b']);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, [{ id: 'd', uuid: 'd' }]);
		assert.deepStrictEqual(actual.updated, []);
		assert.strictEqual(actual.remote, null);
	});

	test('merge local and remote extensions when local is moved forwarded', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, localExtensions);
	});

	test('merge local and remote extensions when local is moved forwarded with disabled extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, disabled: true, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, localExtensions);
	});

	test('merge local and remote extensions when local is moved forwarded with ignored settings', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], ['b']);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, [
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		]);
	});

	test('merge local and remote extensions when local is moved forwarded with skipped extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when local is moved forwarded with skipped and ignored extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, ['c']);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when both moved forwarded', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, [{ id: 'a', uuid: 'a' }]);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when both moved forwarded with ignored extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], ['a', 'e']);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when both moved forwarded with skipped extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, []);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when both moved forwarded with skipped and ignoredextensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, ['e']);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge when remote extension has no uuid and different extension id case', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'A' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'A', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepStrictEqual(actual.added, [{ identifier: { id: 'd', uuid: 'd' }, installed: true, version: '1.0.0' }]);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge when remote extension is not an installed extension', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, null);
	});

	test('merge when remote extension is not an installed extension but is an installed extension locally', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, localExtensions);
	});

	test('merge when an extension is not an installed extension remotely and does not exist locally', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, version: '1.0.0' },
			{ identifier: { id: 'b', uuid: 'b' }, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, remoteExtensions, [], []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, null);
	});

	test('merge when an extension is an installed extension remotely but not locally and updated locally', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, disabled: true, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, disabled: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, remoteExtensions, [], []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

	test('merge when an extension is an installed extension remotely but not locally and updated remotely', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, disabled: true, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, localExtensions, [], []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, remoteExtensions);
		assert.deepStrictEqual(actual.remote, null);
	});

	test('merge not installed extensions', () => {
		const localExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'a', uuid: 'a' }, version: '1.0.0' },
		];
		const remoteExtensions: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, version: '1.0.0' },
		];
		const expected: ISyncExtensionWithVersion[] = [
			{ identifier: { id: 'b', uuid: 'b' }, version: '1.0.0' },
			{ identifier: { id: 'a', uuid: 'a' }, version: '1.0.0' },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepStrictEqual(actual.added, []);
		assert.deepStrictEqual(actual.removed, []);
		assert.deepStrictEqual(actual.updated, []);
		assert.deepStrictEqual(actual.remote, expected);
	});

});
