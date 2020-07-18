/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { merge } from 'vs/platform/userDataSync/common/snippetsMerge';

const tsSnippet1 = `{

	// Place your snippets for TypeScript here. Each snippet is defined under a snippet name and has a prefix, body and
	// description. The prefix is what is used to trigger the snippet and the body will be expanded and inserted. Possible variables are:
	// $1, $2 for tab stops, $0 for the final cursor position, Placeholders with the
	// same ids are connected.
	"Print to console": {
	// Example:
	"prefix": "log",
		"body": [
			"console.log('$1');",
			"$2"
		],
			"description": "Log output to console",
	}

}`;

const tsSnippet2 = `{

	// Place your snippets for TypeScript here. Each snippet is defined under a snippet name and has a prefix, body and
	// description. The prefix is what is used to trigger the snippet and the body will be expanded and inserted. Possible variables are:
	// $1, $2 for tab stops, $0 for the final cursor position, Placeholders with the
	// same ids are connected.
	"Print to console": {
	// Example:
	"prefix": "log",
		"body": [
			"console.log('$1');",
			"$2"
		],
			"description": "Log output to console always",
	}

}`;

const htmlSnippet1 = `{
/*
	// Place your snippets for HTML here. Each snippet is defined under a snippet name and has a prefix, body and
	// description. The prefix is what is used to trigger the snippet and the body will be expanded and inserted.
	// Example:
	"Print to console": {
	"prefix": "log",
		"body": [
			"console.log('$1');",
			"$2"
		],
			"description": "Log output to console"
	}
*/
"Div": {
	"prefix": "div",
		"body": [
			"<div>",
			"",
			"</div>"
		],
			"description": "New div"
	}
}`;

const htmlSnippet2 = `{
/*
	// Place your snippets for HTML here. Each snippet is defined under a snippet name and has a prefix, body and
	// description. The prefix is what is used to trigger the snippet and the body will be expanded and inserted.
	// Example:
	"Print to console": {
	"prefix": "log",
		"body": [
			"console.log('$1');",
			"$2"
		],
			"description": "Log output to console"
	}
*/
"Div": {
	"prefix": "div",
		"body": [
			"<div>",
			"",
			"</div>"
		],
			"description": "New div changed"
	}
}`;

const cSnippet = `{
	// Place your snippets for c here. Each snippet is defined under a snippet name and has a prefix, body and
	// description. The prefix is what is used to trigger the snippet and the body will be expanded and inserted. Possible variables are:
	// $1, $2 for tab stops, $0 for the final cursor position.Placeholders with the
	// same ids are connected.
	// Example:
	"Print to console": {
	"prefix": "log",
		"body": [
			"console.log('$1');",
			"$2"
		],
			"description": "Log output to console"
	}
}`;

suite('SnippetsMerge', () => {

	test('merge when local and remote are same with one snippet', async () => {
		const local = { 'html.json': htmlSnippet1 };
		const remote = { 'html.json': htmlSnippet1 };

		const actual = merge(local, remote, null);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when local and remote are same with multiple entries', async () => {
		const local = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, null);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when local and remote are same with multiple entries in different order', async () => {
		const local = { 'typescript.json': tsSnippet1, 'html.json': htmlSnippet1 };
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, null);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when local and remote are same with different base content', async () => {
		const local = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };
		const base = { 'html.json': htmlSnippet2, 'typescript.json': tsSnippet2 };

		const actual = merge(local, remote, base);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when a new entry is added to remote', async () => {
		const local = { 'html.json': htmlSnippet1 };
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, null);

		assert.deepEqual(actual.local.added, { 'typescript.json': tsSnippet1 });
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when multiple new entries are added to remote', async () => {
		const local = {};
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, null);

		assert.deepEqual(actual.local.added, remote);
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when new entry is added to remote from base and local has not changed', async () => {
		const local = { 'html.json': htmlSnippet1 };
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, local);

		assert.deepEqual(actual.local.added, { 'typescript.json': tsSnippet1 });
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when an entry is removed from remote from base and local has not changed', async () => {
		const local = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };
		const remote = { 'html.json': htmlSnippet1 };

		const actual = merge(local, remote, local);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, ['typescript.json']);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when all entries are removed from base and local has not changed', async () => {
		const local = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };
		const remote = {};

		const actual = merge(local, remote, local);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, ['html.json', 'typescript.json']);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when an entry is updated in remote from base and local has not changed', async () => {
		const local = { 'html.json': htmlSnippet1 };
		const remote = { 'html.json': htmlSnippet2 };

		const actual = merge(local, remote, local);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, { 'html.json': htmlSnippet2 });
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when remote has moved forwarded with multiple changes and local stays with base', async () => {
		const local = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };
		const remote = { 'html.json': htmlSnippet2, 'c.json': cSnippet };

		const actual = merge(local, remote, local);

		assert.deepEqual(actual.local.added, { 'c.json': cSnippet });
		assert.deepEqual(actual.local.updated, { 'html.json': htmlSnippet2 });
		assert.deepEqual(actual.local.removed, ['typescript.json']);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when a new entries are added to local', async () => {
		const local = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1, 'c.json': cSnippet };
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, null);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, { 'c.json': cSnippet });
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when multiple new entries are added to local from base and remote is not changed', async () => {
		const local = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1, 'c.json': cSnippet };
		const remote = { 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, remote);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, { 'html.json': htmlSnippet1, 'c.json': cSnippet });
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when an entry is removed from local from base and remote has not changed', async () => {
		const local = { 'html.json': htmlSnippet1 };
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, remote);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, ['typescript.json']);
	});

	test('merge when an entry is updated in local from base and remote has not changed', async () => {
		const local = { 'html.json': htmlSnippet2, 'typescript.json': tsSnippet1 };
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, remote);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, { 'html.json': htmlSnippet2 });
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when local has moved forwarded with multiple changes and remote stays with base', async () => {
		const local = { 'html.json': htmlSnippet2, 'c.json': cSnippet };
		const remote = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, remote);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, { 'c.json': cSnippet });
		assert.deepEqual(actual.remote.updated, { 'html.json': htmlSnippet2 });
		assert.deepEqual(actual.remote.removed, ['typescript.json']);
	});

	test('merge when local and remote with one entry but different value', async () => {
		const local = { 'html.json': htmlSnippet1 };
		const remote = { 'html.json': htmlSnippet2 };

		const actual = merge(local, remote, null);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, ['html.json']);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when the entry is removed in remote but updated in local and a new entry is added in remote', async () => {
		const base = { 'html.json': htmlSnippet1 };
		const local = { 'html.json': htmlSnippet2 };
		const remote = { 'typescript.json': tsSnippet1 };

		const actual = merge(local, remote, base);

		assert.deepEqual(actual.local.added, { 'typescript.json': tsSnippet1 });
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, ['html.json']);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge with single entry and local is empty', async () => {
		const base = { 'html.json': htmlSnippet1 };
		const local = {};
		const remote = { 'html.json': htmlSnippet2 };

		const actual = merge(local, remote, base);

		assert.deepEqual(actual.local.added, { 'html.json': htmlSnippet2 });
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, []);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when local and remote has moved forwareded with conflicts', async () => {
		const base = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };
		const local = { 'html.json': htmlSnippet2, 'c.json': cSnippet };
		const remote = { 'typescript.json': tsSnippet2 };

		const actual = merge(local, remote, base);

		assert.deepEqual(actual.local.added, { 'typescript.json': tsSnippet2 });
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, ['html.json']);
		assert.deepEqual(actual.remote.added, { 'c.json': cSnippet });
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

	test('merge when local and remote has moved forwareded with multiple conflicts', async () => {
		const base = { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 };
		const local = { 'html.json': htmlSnippet2, 'typescript.json': tsSnippet2, 'c.json': cSnippet };
		const remote = { 'c.json': cSnippet };

		const actual = merge(local, remote, base);

		assert.deepEqual(actual.local.added, {});
		assert.deepEqual(actual.local.updated, {});
		assert.deepEqual(actual.local.removed, []);
		assert.deepEqual(actual.conflicts, ['html.json', 'typescript.json']);
		assert.deepEqual(actual.remote.added, {});
		assert.deepEqual(actual.remote.updated, {});
		assert.deepEqual(actual.remote.removed, []);
	});

});
