/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IUserDataSyncStoreService, IUserDataSyncService, SyncResource, SyncStatus, Conflict, USER_DATA_SYNC_SCHEME, PREVIEW_DIR_NAME } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncClient, UserDataSyncTestServer } from 'vs/platform/userDataSync/test/common/userDataSyncClient';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { IFileService } from 'vs/platform/files/common/files';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { VSBuffer } from 'vs/base/common/buffer';
import { ISyncData } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { SnippetsSynchroniser } from 'vs/platform/userDataSync/common/snippetsSync';
import { joinPath } from 'vs/base/common/resources';
import { IStringDictionary } from 'vs/base/common/collections';

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

const htmlSnippet3 = `{
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
			"description": "New div changed again"
	}
}`;

const globalSnippet = `{
	// Place your global snippets here. Each snippet is defined under a snippet name and has a scope, prefix, body and
	// description. Add comma separated ids of the languages where the snippet is applicable in the scope field. If scope
	// is left empty or omitted, the snippet gets applied to all languages. The prefix is what is
	// used to trigger the snippet and the body will be expanded and inserted. Possible variables are:
	// $1, $2 for tab stops, $0 for the final cursor position, and {1: label}, { 2: another } for placeholders.
	// Placeholders with the same ids are connected.
	// Example:
	// "Print to console": {
	// 	"scope": "javascript,typescript",
	// 	"prefix": "log",
	// 	"body": [
	// 		"console.log('$1');",
	// 		"$2"
	// 	],
	// 	"description": "Log output to console"
	// }
}`;

suite('SnippetsSync', () => {

	const disposableStore = new DisposableStore();
	const server = new UserDataSyncTestServer();
	let testClient: UserDataSyncClient;
	let client2: UserDataSyncClient;

	let testObject: SnippetsSynchroniser;

	setup(async () => {
		testClient = disposableStore.add(new UserDataSyncClient(server));
		await testClient.setUp(true);
		testObject = (testClient.instantiationService.get(IUserDataSyncService) as UserDataSyncService).getSynchroniser(SyncResource.Snippets) as SnippetsSynchroniser;
		disposableStore.add(toDisposable(() => testClient.instantiationService.get(IUserDataSyncStoreService).clear()));

		client2 = disposableStore.add(new UserDataSyncClient(server));
		await client2.setUp(true);
	});

	teardown(() => disposableStore.clear());

	test('first time sync - outgoing to server (no snippets)', async () => {
		await updateSnippet('html.json', htmlSnippet1, testClient);
		await updateSnippet('typescript.json', tsSnippet1, testClient);

		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 });
	});

	test('first time sync - incoming from server (no snippets)', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();

		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet1);
		const actual2 = await readSnippet('typescript.json', testClient);
		assert.equal(actual2, tsSnippet1);
	});

	test('first time sync when snippets exists', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await client2.sync();

		await updateSnippet('typescript.json', tsSnippet1, testClient);
		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet1);
		const actual2 = await readSnippet('typescript.json', testClient);
		assert.equal(actual2, tsSnippet1);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 });
	});

	test('first time sync when snippets exists - has conflicts', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet2, testClient);
		await testObject.sync();

		assert.equal(testObject.status, SyncStatus.HasConflicts);
		const environmentService = testClient.instantiationService.get(IEnvironmentService);
		const local = joinPath(environmentService.userDataSyncHome, testObject.resource, PREVIEW_DIR_NAME, 'html.json');
		assertConflicts(testObject.conflicts, [{ local, remote: local.with({ scheme: USER_DATA_SYNC_SCHEME }) }]);
	});

	test('first time sync when snippets exists - has conflicts and accept conflicts', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet2, testClient);
		await testObject.sync();
		const conflicts = testObject.conflicts;
		await testObject.acceptConflict(conflicts[0].local, htmlSnippet1);

		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);
		const fileService = testClient.instantiationService.get(IFileService);
		assert.ok(!await fileService.exists(conflicts[0].local));

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet1);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'html.json': htmlSnippet1 });
	});

	test('first time sync when snippets exists - has multiple conflicts', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet2, testClient);
		await updateSnippet('typescript.json', tsSnippet2, testClient);
		await testObject.sync();

		assert.equal(testObject.status, SyncStatus.HasConflicts);
		const environmentService = testClient.instantiationService.get(IEnvironmentService);
		const local1 = joinPath(environmentService.userDataSyncHome, testObject.resource, PREVIEW_DIR_NAME, 'html.json');
		const local2 = joinPath(environmentService.userDataSyncHome, testObject.resource, PREVIEW_DIR_NAME, 'typescript.json');
		assertConflicts(testObject.conflicts, [
			{ local: local1, remote: local1.with({ scheme: USER_DATA_SYNC_SCHEME }) },
			{ local: local2, remote: local2.with({ scheme: USER_DATA_SYNC_SCHEME }) }
		]);
	});

	test('first time sync when snippets exists - has multiple conflicts and accept one conflict', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet2, testClient);
		await updateSnippet('typescript.json', tsSnippet2, testClient);
		await testObject.sync();

		let conflicts = testObject.conflicts;
		await testObject.acceptConflict(conflicts[0].local, htmlSnippet2);
		const fileService = testClient.instantiationService.get(IFileService);
		assert.ok(!await fileService.exists(conflicts[0].local));

		conflicts = testObject.conflicts;
		assert.equal(testObject.status, SyncStatus.HasConflicts);
		const environmentService = testClient.instantiationService.get(IEnvironmentService);
		const local = joinPath(environmentService.userDataSyncHome, testObject.resource, PREVIEW_DIR_NAME, 'typescript.json');
		assertConflicts(testObject.conflicts, [{ local, remote: local.with({ scheme: USER_DATA_SYNC_SCHEME }) }]);
	});

	test('first time sync when snippets exists - has multiple conflicts and accept all conflicts', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet2, testClient);
		await updateSnippet('typescript.json', tsSnippet2, testClient);
		await testObject.sync();

		const conflicts = testObject.conflicts;
		await testObject.acceptConflict(conflicts[0].local, htmlSnippet2);
		await testObject.acceptConflict(conflicts[1].local, tsSnippet1);

		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);
		const fileService = testClient.instantiationService.get(IFileService);
		assert.ok(!await fileService.exists(conflicts[0].local));
		assert.ok(!await fileService.exists(conflicts[1].local));

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet2);
		const actual2 = await readSnippet('typescript.json', testClient);
		assert.equal(actual2, tsSnippet1);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'html.json': htmlSnippet2, 'typescript.json': tsSnippet1 });
	});

	test('sync adding a snippet', async () => {
		await updateSnippet('html.json', htmlSnippet1, testClient);
		await testObject.sync();

		await updateSnippet('typescript.json', tsSnippet1, testClient);
		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet1);
		const actual2 = await readSnippet('typescript.json', testClient);
		assert.equal(actual2, tsSnippet1);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 });
	});

	test('sync adding a snippet - accept', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await client2.sync();
		await testObject.sync();

		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();

		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet1);
		const actual2 = await readSnippet('typescript.json', testClient);
		assert.equal(actual2, tsSnippet1);
	});

	test('sync updating a snippet', async () => {
		await updateSnippet('html.json', htmlSnippet1, testClient);
		await testObject.sync();

		await updateSnippet('html.json', htmlSnippet2, testClient);
		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet2);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'html.json': htmlSnippet2 });
	});

	test('sync updating a snippet - accept', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await client2.sync();
		await testObject.sync();

		await updateSnippet('html.json', htmlSnippet2, client2);
		await client2.sync();

		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet2);
	});

	test('sync updating a snippet - conflict', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await client2.sync();
		await testObject.sync();

		await updateSnippet('html.json', htmlSnippet2, client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet3, testClient);
		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.HasConflicts);
		const environmentService = testClient.instantiationService.get(IEnvironmentService);
		const local = joinPath(environmentService.userDataSyncHome, testObject.resource, PREVIEW_DIR_NAME, 'html.json');
		assertConflicts(testObject.conflicts, [{ local, remote: local.with({ scheme: USER_DATA_SYNC_SCHEME }) }]);
	});

	test('sync updating a snippet - resolve conflict', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await client2.sync();
		await testObject.sync();

		await updateSnippet('html.json', htmlSnippet2, client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet3, testClient);
		await testObject.sync();
		await testObject.acceptConflict(testObject.conflicts[0].local, htmlSnippet2);

		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet2);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'html.json': htmlSnippet2 });
	});

	test('sync removing a snippet', async () => {
		await updateSnippet('html.json', htmlSnippet1, testClient);
		await updateSnippet('typescript.json', tsSnippet1, testClient);
		await testObject.sync();

		await removeSnippet('html.json', testClient);
		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('typescript.json', testClient);
		assert.equal(actual1, tsSnippet1);
		const actual2 = await readSnippet('html.json', testClient);
		assert.equal(actual2, null);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'typescript.json': tsSnippet1 });
	});

	test('sync removing a snippet - accept', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();
		await testObject.sync();

		await removeSnippet('html.json', client2);
		await client2.sync();

		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('typescript.json', testClient);
		assert.equal(actual1, tsSnippet1);
		const actual2 = await readSnippet('html.json', testClient);
		assert.equal(actual2, null);
	});

	test('sync removing a snippet locally and updating it remotely', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();
		await testObject.sync();

		await updateSnippet('html.json', htmlSnippet2, client2);
		await client2.sync();

		await removeSnippet('html.json', testClient);
		await testObject.sync();

		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('typescript.json', testClient);
		assert.equal(actual1, tsSnippet1);
		const actual2 = await readSnippet('html.json', testClient);
		assert.equal(actual2, htmlSnippet2);
	});

	test('sync removing a snippet - conflict', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();
		await testObject.sync();

		await removeSnippet('html.json', client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet2, testClient);
		await testObject.sync();

		assert.equal(testObject.status, SyncStatus.HasConflicts);
		const environmentService = testClient.instantiationService.get(IEnvironmentService);
		const local = joinPath(environmentService.userDataSyncHome, testObject.resource, PREVIEW_DIR_NAME, 'html.json');
		assertConflicts(testObject.conflicts, [{ local, remote: local.with({ scheme: USER_DATA_SYNC_SCHEME }) }]);
	});

	test('sync removing a snippet - resolve conflict', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();
		await testObject.sync();

		await removeSnippet('html.json', client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet2, testClient);
		await testObject.sync();
		await testObject.acceptConflict(testObject.conflicts[0].local, htmlSnippet3);

		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('typescript.json', testClient);
		assert.equal(actual1, tsSnippet1);
		const actual2 = await readSnippet('html.json', testClient);
		assert.equal(actual2, htmlSnippet3);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'typescript.json': tsSnippet1, 'html.json': htmlSnippet3 });
	});

	test('sync removing a snippet - resolve conflict by removing', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();
		await testObject.sync();

		await removeSnippet('html.json', client2);
		await client2.sync();

		await updateSnippet('html.json', htmlSnippet2, testClient);
		await testObject.sync();
		await testObject.acceptConflict(testObject.conflicts[0].local, '');

		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('typescript.json', testClient);
		assert.equal(actual1, tsSnippet1);
		const actual2 = await readSnippet('html.json', testClient);
		assert.equal(actual2, null);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'typescript.json': tsSnippet1 });
	});

	test('first time sync - push', async () => {
		await updateSnippet('html.json', htmlSnippet1, testClient);
		await updateSnippet('typescript.json', tsSnippet1, testClient);

		await testObject.push();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'html.json': htmlSnippet1, 'typescript.json': tsSnippet1 });
	});

	test('first time sync - pull', async () => {
		await updateSnippet('html.json', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();

		await testObject.pull();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet1);
		const actual2 = await readSnippet('typescript.json', testClient);
		assert.equal(actual2, tsSnippet1);
	});

	test('sync global and language snippet', async () => {
		await updateSnippet('global.code-snippets', globalSnippet, client2);
		await updateSnippet('html.json', htmlSnippet1, client2);
		await client2.sync();

		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('html.json', testClient);
		assert.equal(actual1, htmlSnippet1);
		const actual2 = await readSnippet('global.code-snippets', testClient);
		assert.equal(actual2, globalSnippet);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'html.json': htmlSnippet1, 'global.code-snippets': globalSnippet });
	});

	test('sync should ignore non snippets', async () => {
		await updateSnippet('global.code-snippets', globalSnippet, client2);
		await updateSnippet('html.html', htmlSnippet1, client2);
		await updateSnippet('typescript.json', tsSnippet1, client2);
		await client2.sync();

		await testObject.sync();
		assert.equal(testObject.status, SyncStatus.Idle);
		assert.deepEqual(testObject.conflicts, []);

		const actual1 = await readSnippet('typescript.json', testClient);
		assert.equal(actual1, tsSnippet1);
		const actual2 = await readSnippet('global.code-snippets', testClient);
		assert.equal(actual2, globalSnippet);
		const actual3 = await readSnippet('html.html', testClient);
		assert.equal(actual3, null);

		const { content } = await testClient.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSnippets(content!);
		assert.deepEqual(actual, { 'typescript.json': tsSnippet1, 'global.code-snippets': globalSnippet });
	});

	function parseSnippets(content: string): IStringDictionary<string> {
		const syncData: ISyncData = JSON.parse(content);
		return JSON.parse(syncData.content);
	}

	async function updateSnippet(name: string, content: string, client: UserDataSyncClient): Promise<void> {
		const fileService = client.instantiationService.get(IFileService);
		const environmentService = client.instantiationService.get(IEnvironmentService);
		const snippetsResource = joinPath(environmentService.snippetsHome, name);
		await fileService.writeFile(snippetsResource, VSBuffer.fromString(content));
	}

	async function removeSnippet(name: string, client: UserDataSyncClient): Promise<void> {
		const fileService = client.instantiationService.get(IFileService);
		const environmentService = client.instantiationService.get(IEnvironmentService);
		const snippetsResource = joinPath(environmentService.snippetsHome, name);
		await fileService.del(snippetsResource);
	}

	async function readSnippet(name: string, client: UserDataSyncClient): Promise<string | null> {
		const fileService = client.instantiationService.get(IFileService);
		const environmentService = client.instantiationService.get(IEnvironmentService);
		const snippetsResource = joinPath(environmentService.snippetsHome, name);
		if (await fileService.exists(snippetsResource)) {
			const content = await fileService.readFile(snippetsResource);
			return content.value.toString();
		}
		return null;
	}

	function assertConflicts(actual: Conflict[], expected: Conflict[]) {
		assert.deepEqual(actual.map(({ local, remote }) => ({ local: local.toString(), remote: remote.toString() })), expected.map(({ local, remote }) => ({ local: local.toString(), remote: remote.toString() })));
	}

});
