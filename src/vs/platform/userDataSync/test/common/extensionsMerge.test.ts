/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ISyncExtension } from 'vs/platform/userDataSync/common/userDataSync';
import { merge } from 'vs/platform/userDataSync/common/extensionsMerge';

suite('ExtensionsMerge', () => {

	test('merge returns local extension if remote does not exist', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, null, null, [], []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, localExtensions);
	});

	test('merge returns local extension if remote does not exist with ignored extensions', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, null, null, [], ['a']);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge returns local extension if remote does not exist with ignored extensions (ignore case)', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, null, null, [], ['A']);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge returns local extension if remote does not exist with skipped extensions', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const skippedExtension: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, null, null, skippedExtension, []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge returns local extension if remote does not exist with skipped and ignored extensions', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const skippedExtension: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, null, null, skippedExtension, ['a']);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when there is no base', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true }, { identifier: { id: 'c', uuid: 'c' }, installed: true }]);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when there is no base and with ignored extensions', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], ['a']);

		assert.deepEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true }, { identifier: { id: 'c', uuid: 'c' }, installed: true }]);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when remote is moved forwarded', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true }, { identifier: { id: 'c', uuid: 'c' }, installed: true }]);
		assert.deepEqual(actual.removed, [{ id: 'a', uuid: 'a' }, { id: 'd', uuid: 'd' }]);
		assert.deepEqual(actual.updated, []);
		assert.equal(actual.remote, null);
	});

	test('merge local and remote extensions when remote is moved forwarded with disabled extension', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, disabled: true, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true }, { identifier: { id: 'c', uuid: 'c' }, installed: true }]);
		assert.deepEqual(actual.removed, [{ id: 'a', uuid: 'a' }]);
		assert.deepEqual(actual.updated, [{ identifier: { id: 'd', uuid: 'd' }, disabled: true, installed: true }]);
		assert.equal(actual.remote, null);
	});

	test('merge local and remote extensions when remote moved forwarded with ignored extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], ['a']);

		assert.deepEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true }, { identifier: { id: 'c', uuid: 'c' }, installed: true }]);
		assert.deepEqual(actual.removed, [{ id: 'd', uuid: 'd' }]);
		assert.deepEqual(actual.updated, []);
		assert.equal(actual.remote, null);
	});

	test('merge local and remote extensions when remote is moved forwarded with skipped extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, []);

		assert.deepEqual(actual.added, [{ identifier: { id: 'b', uuid: 'b' }, installed: true }, { identifier: { id: 'c', uuid: 'c' }, installed: true }]);
		assert.deepEqual(actual.removed, [{ id: 'd', uuid: 'd' }]);
		assert.deepEqual(actual.updated, []);
		assert.equal(actual.remote, null);
	});

	test('merge local and remote extensions when remote is moved forwarded with skipped and ignored extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, ['b']);

		assert.deepEqual(actual.added, [{ identifier: { id: 'c', uuid: 'c' }, installed: true }]);
		assert.deepEqual(actual.removed, [{ id: 'd', uuid: 'd' }]);
		assert.deepEqual(actual.updated, []);
		assert.equal(actual.remote, null);
	});

	test('merge local and remote extensions when local is moved forwarded', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, localExtensions);
	});

	test('merge local and remote extensions when local is moved forwarded with disabled extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, disabled: true, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, localExtensions);
	});

	test('merge local and remote extensions when local is moved forwarded with ignored settings', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], ['b']);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, [
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
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
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when local is moved forwarded with skipped and ignored extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, ['c']);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when both moved forwarded', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], []);

		assert.deepEqual(actual.added, [{ identifier: { id: 'e', uuid: 'e' }, installed: true }]);
		assert.deepEqual(actual.removed, [{ id: 'a', uuid: 'a' }]);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when both moved forwarded with ignored extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, [], ['a', 'e']);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when both moved forwarded with skipped extensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, []);

		assert.deepEqual(actual.added, [{ identifier: { id: 'e', uuid: 'e' }, installed: true }]);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge local and remote extensions when both moved forwarded with skipped and ignoredextensions', () => {
		const baseExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const skippedExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'e', uuid: 'e' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, baseExtensions, skippedExtensions, ['e']);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge when remote extension has no uuid and different extension id case', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'A' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'A', uuid: 'a' }, installed: true },
			{ identifier: { id: 'd', uuid: 'd' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' }, installed: true },
			{ identifier: { id: 'c', uuid: 'c' }, installed: true },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepEqual(actual.added, [{ identifier: { id: 'd', uuid: 'd' }, installed: true }]);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge when remote extension is not an installed extension', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
			{ identifier: { id: 'b', uuid: 'b' } },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when remote extension is not an installed extension but is an installed extension locally', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' } },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, localExtensions);
	});

	test('merge when an extension is not an installed extension remotely and does not exist locally', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' } },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' } },
			{ identifier: { id: 'b', uuid: 'b' } },
		];

		const actual = merge(localExtensions, remoteExtensions, remoteExtensions, [], []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when an extension is an installed extension remotely but not locally and updated locally', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, disabled: true },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, disabled: true },
		];

		const actual = merge(localExtensions, remoteExtensions, remoteExtensions, [], []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

	test('merge when an extension is an installed extension remotely but not locally and updated remotely', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' } },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' }, installed: true, disabled: true },
		];

		const actual = merge(localExtensions, remoteExtensions, localExtensions, [], []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, remoteExtensions);
		assert.deepEqual(actual.remote, null);
	});

	test('merge not installed extensions', () => {
		const localExtensions: ISyncExtension[] = [
			{ identifier: { id: 'a', uuid: 'a' } },
		];
		const remoteExtensions: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' } },
		];
		const expected: ISyncExtension[] = [
			{ identifier: { id: 'b', uuid: 'b' } },
			{ identifier: { id: 'a', uuid: 'a' } },
		];

		const actual = merge(localExtensions, remoteExtensions, null, [], []);

		assert.deepEqual(actual.added, []);
		assert.deepEqual(actual.removed, []);
		assert.deepEqual(actual.updated, []);
		assert.deepEqual(actual.remote, expected);
	});

});
