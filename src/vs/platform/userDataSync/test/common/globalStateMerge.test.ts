/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { merge } from 'vs/platform/userDataSync/common/globalStateMerge';
import { NullLogService } from 'vs/platform/log/common/log';

suite('GlobalStateMerge', () => {

	test('merge when local and remote are same with one value', async () => {
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, null, [{ key: 'a', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when local and remote are same with multiple entries', async () => {
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const remote = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };

		const actual = merge(local, remote, null, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when local and remote are same with multiple entries in different order', async () => {
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const remote = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, null, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when local and remote are same with different base content', async () => {
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const remote = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };
		const base = { 'b': { version: 1, value: 'a' } };

		const actual = merge(local, remote, base, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when a new entry is added to remote', async () => {
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, null, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, { 'b': { version: 1, value: 'b' } });
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when multiple new entries are added to remote', async () => {
		const local = {};
		const remote = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, null, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } });
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when new entry is added to remote from base and local has not changed', async () => {
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, local, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, { 'b': { version: 1, value: 'b' } });
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when an entry is removed from remote from base and local has not changed', async () => {
		const local = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };
		const remote = { 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, local, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, ['b']);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when all entries are removed from base and local has not changed', async () => {
		const local = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };
		const remote = {};

		const actual = merge(local, remote, local, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, ['b', 'a']);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when an entry is updated in remote from base and local has not changed', async () => {
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'a': { version: 1, value: 'b' } };

		const actual = merge(local, remote, local, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, { 'a': { version: 1, value: 'b' } });
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when remote has moved forwarded with multiple changes and local stays with base', async () => {
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const remote = { 'a': { version: 1, value: 'd' }, 'c': { version: 1, value: 'c' } };

		const actual = merge(local, remote, local, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, { 'c': { version: 1, value: 'c' } });
		assert.deepEqual(actual.local.updated, { 'a': { version: 1, value: 'd' } });
		assert.deepEqual(actual.local.removed, ['b']);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when new entries are added to local', async () => {
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const remote = { 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, null, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, local);
	});

	test('merge when multiple new entries are added to local from base and remote is not changed', async () => {
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' }, 'c': { version: 1, value: 'c' } };
		const remote = { 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, remote, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, local);
	});

	test('merge when an entry is removed from local from base and remote has not changed', async () => {
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };

		const actual = merge(local, remote, remote, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, local);
	});

	test('merge when an entry is updated in local from base and remote has not changed', async () => {
		const local = { 'a': { version: 1, value: 'b' } };
		const remote = { 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, remote, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, local);
	});

	test('merge when local has moved forwarded with multiple changes and remote stays with base', async () => {
		const local = { 'a': { version: 1, value: 'd' }, 'b': { version: 1, value: 'b' } };
		const remote = { 'a': { version: 1, value: 'a' }, 'c': { version: 1, value: 'c' } };

		const actual = merge(local, remote, remote, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, local);
	});

	test('merge when local and remote with one entry but different value', async () => {
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'a': { version: 1, value: 'b' } };

		const actual = merge(local, remote, null, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, { 'a': { version: 1, value: 'b' } });
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when the entry is removed in remote but updated in local and a new entry is added in remote', async () => {
		const base = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'd' } };
		const remote = { 'a': { version: 1, value: 'a' }, 'c': { version: 1, value: 'c' } };

		const actual = merge(local, remote, base, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, { 'c': { version: 1, value: 'c' } });
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, ['b']);
		assert.deepEqual(actual.remote, null);
	});

	test('merge with single entry and local is empty', async () => {
		const base = { 'a': { version: 1, value: 'a' } };
		const local = {};
		const remote = { 'a': { version: 1, value: 'b' } };

		const actual = merge(local, remote, base, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, { 'a': { version: 1, value: 'b' } });
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when local and remote has moved forwareded with conflicts', async () => {
		const base = { 'a': { version: 1, value: 'a' } };
		const local = { 'a': { version: 1, value: 'd' } };
		const remote = { 'a': { version: 1, value: 'b' } };

		const actual = merge(local, remote, base, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }, { key: 'c', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, { 'a': { version: 1, value: 'b' } });
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when a new entry is added to remote but not a registered key', async () => {
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, null, [{ key: 'a', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when a new entry is added to remote but different version', async () => {
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'b': { version: 2, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, null, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when an entry is updated to remote but not a registered key', async () => {
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'a': { version: 1, value: 'b' } };

		const actual = merge(local, remote, local, [], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when a new entry is updated to remote but different version', async () => {
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const remote = { 'b': { version: 2, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, local, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when a local value is update with lower version', async () => {
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'c' } };
		const remote = { 'b': { version: 2, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, remote, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when a local value is update with higher version', async () => {
		const local = { 'a': { version: 1, value: 'a' }, 'b': { version: 2, value: 'c' } };
		const remote = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, remote, [{ key: 'a', version: 1 }, { key: 'b', version: 2 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, local);
	});

	test('merge when a local value is removed but not registered', async () => {
		const base = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'b': { version: 2, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, base, [{ key: 'a', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when a local value is removed with lower version', async () => {
		const base = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'b': { version: 2, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, base, [{ key: 'a', version: 1 }, { key: 'b', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

	test('merge when a local value is removed with higher version', async () => {
		const base = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, base, [{ key: 'a', version: 1 }, { key: 'b', version: 2 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, local);
	});

	test('merge when a local value is not yet registered', async () => {
		const base = { 'a': { version: 1, value: 'a' }, 'b': { version: 1, value: 'b' } };
		const local = { 'a': { version: 1, value: 'a' } };
		const remote = { 'b': { version: 1, value: 'b' }, 'a': { version: 1, value: 'a' } };

		const actual = merge(local, remote, base, [{ key: 'a', version: 1 }], [], new NullLogService());

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.remote, null);
	});

});
