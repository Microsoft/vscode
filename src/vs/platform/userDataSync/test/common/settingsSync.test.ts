/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IUserDataSyncStoreService, IUserDataSyncService, SyncResource, UserDataSyncError, UserDataSyncErrorCode, ISyncData, SyncStatus } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncClient, UserDataSyncTestServer } from 'vs/platform/userDataSync/test/common/userDataSyncClient';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { SettingsSynchroniser, ISettingsSyncContent, parseSettingsSyncContent } from 'vs/platform/userDataSync/common/settingsSync';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { IFileService } from 'vs/platform/files/common/files';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { VSBuffer } from 'vs/base/common/buffer';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { Event } from 'vs/base/common/event';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	'id': 'settingsSync',
	'type': 'object',
	'properties': {
		'settingsSync.machine': {
			'type': 'string',
			'scope': ConfigurationScope.MACHINE
		},
		'settingsSync.machineOverridable': {
			'type': 'string',
			'scope': ConfigurationScope.MACHINE_OVERRIDABLE
		}
	}
});

suite('SettingsSync - Auto', () => {

	const disposableStore = new DisposableStore();
	const server = new UserDataSyncTestServer();
	let client: UserDataSyncClient;
	let testObject: SettingsSynchroniser;

	setup(async () => {
		client = disposableStore.add(new UserDataSyncClient(server));
		await client.setUp(true);
		testObject = (client.instantiationService.get(IUserDataSyncService) as UserDataSyncService).getSynchroniser(SyncResource.Settings) as SettingsSynchroniser;
		disposableStore.add(toDisposable(() => client.instantiationService.get(IUserDataSyncStoreService).clear()));
	});

	teardown(() => disposableStore.clear());

	test('when settings file does not exist', async () => {
		const fileService = client.instantiationService.get(IFileService);
		const settingResource = client.instantiationService.get(IEnvironmentService).settingsResource;

		assert.deepStrictEqual(await testObject.getLastSyncUserData(), null);
		let manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);

		assert.deepStrictEqual(server.requests, [
			{ type: 'GET', url: `${server.url}/v1/resource/${testObject.resource}/latest`, headers: {} },
		]);
		assert.ok(!await fileService.exists(settingResource));

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.deepStrictEqual(lastSyncUserData!.ref, remoteUserData.ref);
		assert.deepStrictEqual(lastSyncUserData!.syncData, remoteUserData.syncData);
		assert.strictEqual(lastSyncUserData!.syncData, null);

		manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);
		assert.deepStrictEqual(server.requests, []);

		manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);
		assert.deepStrictEqual(server.requests, []);
	});

	test('when settings file is empty and remote has no changes', async () => {
		const fileService = client.instantiationService.get(IFileService);
		const settingsResource = client.instantiationService.get(IEnvironmentService).settingsResource;
		await fileService.writeFile(settingsResource, VSBuffer.fromString(''));

		await testObject.sync(await client.manifest());

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.strictEqual(parseSettingsSyncContent(lastSyncUserData!.syncData!.content!)?.settings, '{}');
		assert.strictEqual(parseSettingsSyncContent(remoteUserData!.syncData!.content!)?.settings, '{}');
		assert.strictEqual((await fileService.readFile(settingsResource)).value.toString(), '');
	});

	test('when settings file is empty and remote has changes', async () => {
		const client2 = disposableStore.add(new UserDataSyncClient(server));
		await client2.setUp(true);
		const content =
			`{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",
	"workbench.tree.indent": 20,
	"workbench.colorCustomizations": {
		"editorLineNumber.activeForeground": "#ff0000",
		"[GitHub Sharp]": {
			"statusBarItem.remoteBackground": "#24292E",
			"editorPane.background": "#f3f1f11a"
		}
	},

	"gitBranch.base": "remote-repo/master",

	// Experimental
	"workbench.view.experimental.allowMovingToNewContainer": true,
}`;
		await client2.instantiationService.get(IFileService).writeFile(client2.instantiationService.get(IEnvironmentService).settingsResource, VSBuffer.fromString(content));
		await client2.sync();

		const fileService = client.instantiationService.get(IFileService);
		const settingsResource = client.instantiationService.get(IEnvironmentService).settingsResource;
		await fileService.writeFile(settingsResource, VSBuffer.fromString(''));

		await testObject.sync(await client.manifest());

		const lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.strictEqual(parseSettingsSyncContent(lastSyncUserData!.syncData!.content!)?.settings, content);
		assert.strictEqual(parseSettingsSyncContent(remoteUserData!.syncData!.content!)?.settings, content);
		assert.strictEqual((await fileService.readFile(settingsResource)).value.toString(), content);
	});

	test('when settings file is created after first sync', async () => {
		const fileService = client.instantiationService.get(IFileService);

		const settingsResource = client.instantiationService.get(IEnvironmentService).settingsResource;
		await testObject.sync(await client.manifest());
		await fileService.createFile(settingsResource, VSBuffer.fromString('{}'));

		let lastSyncUserData = await testObject.getLastSyncUserData();
		const manifest = await client.manifest();
		server.reset();
		await testObject.sync(manifest);

		assert.deepStrictEqual(server.requests, [
			{ type: 'POST', url: `${server.url}/v1/resource/${testObject.resource}`, headers: { 'If-Match': lastSyncUserData?.ref } },
		]);

		lastSyncUserData = await testObject.getLastSyncUserData();
		const remoteUserData = await testObject.getRemoteUserData(null);
		assert.deepStrictEqual(lastSyncUserData!.ref, remoteUserData.ref);
		assert.deepStrictEqual(lastSyncUserData!.syncData, remoteUserData.syncData);
		assert.strictEqual(parseSettingsSyncContent(lastSyncUserData!.syncData!.content!)?.settings, '{}');
	});

	test('sync for first time to the server', async () => {
		const expected =
			`{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",
	"workbench.tree.indent": 20,
	"workbench.colorCustomizations": {
		"editorLineNumber.activeForeground": "#ff0000",
		"[GitHub Sharp]": {
			"statusBarItem.remoteBackground": "#24292E",
			"editorPane.background": "#f3f1f11a"
		}
	},

	"gitBranch.base": "remote-repo/master",

	// Experimental
	"workbench.view.experimental.allowMovingToNewContainer": true,
}`;

		await updateSettings(expected, client);
		await testObject.sync(await client.manifest());

		const { content } = await client.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSettings(content!);
		assert.deepStrictEqual(actual, expected);
	});

	test('do not sync machine settings', async () => {
		const settingsContent =
			`{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",

	// Machine
	"settingsSync.machine": "someValue",
	"settingsSync.machineOverridable": "someValue"
}`;
		await updateSettings(settingsContent, client);

		await testObject.sync(await client.manifest());

		const { content } = await client.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSettings(content!);
		assert.deepStrictEqual(actual, `{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp"
}`);
	});

	test('do not sync machine settings when spread across file', async () => {
		const settingsContent =
			`{
	// Always
	"files.autoSave": "afterDelay",
	"settingsSync.machine": "someValue",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",

	// Machine
	"settingsSync.machineOverridable": "someValue"
}`;
		await updateSettings(settingsContent, client);

		await testObject.sync(await client.manifest());

		const { content } = await client.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSettings(content!);
		assert.deepStrictEqual(actual, `{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp"
}`);
	});

	test('do not sync machine settings when spread across file - 2', async () => {
		const settingsContent =
			`{
	// Always
	"files.autoSave": "afterDelay",
	"settingsSync.machine": "someValue",

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",

	// Machine
	"settingsSync.machineOverridable": "someValue",
	"files.simpleDialog.enable": true,
}`;
		await updateSettings(settingsContent, client);

		await testObject.sync(await client.manifest());

		const { content } = await client.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSettings(content!);
		assert.deepStrictEqual(actual, `{
	// Always
	"files.autoSave": "afterDelay",

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",
	"files.simpleDialog.enable": true,
}`);
	});

	test('sync when all settings are machine settings', async () => {
		const settingsContent =
			`{
	// Machine
	"settingsSync.machine": "someValue",
	"settingsSync.machineOverridable": "someValue"
}`;
		await updateSettings(settingsContent, client);

		await testObject.sync(await client.manifest());

		const { content } = await client.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSettings(content!);
		assert.deepStrictEqual(actual, `{
}`);
	});

	test('sync when all settings are machine settings with trailing comma', async () => {
		const settingsContent =
			`{
	// Machine
	"settingsSync.machine": "someValue",
	"settingsSync.machineOverridable": "someValue",
}`;
		await updateSettings(settingsContent, client);

		await testObject.sync(await client.manifest());

		const { content } = await client.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSettings(content!);
		assert.deepStrictEqual(actual, `{
	,
}`);
	});

	test('local change event is triggered when settings are changed', async () => {
		const content =
			`{
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,
}`;

		await updateSettings(content, client);
		await testObject.sync(await client.manifest());

		const promise = Event.toPromise(testObject.onDidChangeLocal);
		await updateSettings(`{
	"files.autoSave": "off",
	"files.simpleDialog.enable": true,
}`, client);
		await promise;
	});

	test('do not sync ignored settings', async () => {
		const settingsContent =
			`{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Editor
	"editor.fontFamily": "Fira Code",

	// Terminal
	"terminal.integrated.shell.osx": "some path",

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",

	// Ignored
	"settingsSync.ignoredSettings": [
		"editor.fontFamily",
		"terminal.integrated.shell.osx"
	]
}`;
		await updateSettings(settingsContent, client);

		await testObject.sync(await client.manifest());

		const { content } = await client.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSettings(content!);
		assert.deepStrictEqual(actual, `{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",

	// Ignored
	"settingsSync.ignoredSettings": [
		"editor.fontFamily",
		"terminal.integrated.shell.osx"
	]
}`);
	});

	test('do not sync ignored and machine settings', async () => {
		const settingsContent =
			`{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Editor
	"editor.fontFamily": "Fira Code",

	// Terminal
	"terminal.integrated.shell.osx": "some path",

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",

	// Ignored
	"settingsSync.ignoredSettings": [
		"editor.fontFamily",
		"terminal.integrated.shell.osx"
	],

	// Machine
	"settingsSync.machine": "someValue",
}`;
		await updateSettings(settingsContent, client);

		await testObject.sync(await client.manifest());

		const { content } = await client.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSettings(content!);
		assert.deepStrictEqual(actual, `{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",

	// Ignored
	"settingsSync.ignoredSettings": [
		"editor.fontFamily",
		"terminal.integrated.shell.osx"
	],
}`);
	});

	test('sync throws invalid content error', async () => {
		const expected =
			`{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",
	"workbench.tree.indent": 20,
	"workbench.colorCustomizations": {
		"editorLineNumber.activeForeground": "#ff0000",
		"[GitHub Sharp]": {
			"statusBarItem.remoteBackground": "#24292E",
			"editorPane.background": "#f3f1f11a"
		}
	}

	"gitBranch.base": "remote-repo/master",

	// Experimental
	"workbench.view.experimental.allowMovingToNewContainer": true,
}`;

		await updateSettings(expected, client);

		try {
			await testObject.sync(await client.manifest());
			assert.fail('should fail with invalid content error');
		} catch (e) {
			assert.ok(e instanceof UserDataSyncError);
			assert.deepStrictEqual((<UserDataSyncError>e).code, UserDataSyncErrorCode.LocalInvalidContent);
		}
	});

	test('sync when there are conflicts', async () => {
		const client2 = disposableStore.add(new UserDataSyncClient(server));
		await client2.setUp(true);
		await updateSettings(JSON.stringify({
			'a': 1,
			'b': 2,
			'settingsSync.ignoredSettings': ['a']
		}), client2);
		await client2.sync();

		await updateSettings(JSON.stringify({
			'a': 2,
			'b': 1,
			'settingsSync.ignoredSettings': ['a']
		}), client);
		await testObject.sync(await client.manifest());

		assert.strictEqual(testObject.status, SyncStatus.HasConflicts);
		assert.strictEqual(testObject.conflicts[0].localResource.toString(), testObject.localResource.toString());

		const fileService = client.instantiationService.get(IFileService);
		const mergeContent = (await fileService.readFile(testObject.conflicts[0].previewResource)).value.toString();
		assert.deepStrictEqual(JSON.parse(mergeContent), {
			'b': 1,
			'settingsSync.ignoredSettings': ['a']
		});
	});

});

suite('SettingsSync - Manual', () => {

	const disposableStore = new DisposableStore();
	const server = new UserDataSyncTestServer();
	let client: UserDataSyncClient;
	let testObject: SettingsSynchroniser;

	setup(async () => {
		client = disposableStore.add(new UserDataSyncClient(server));
		await client.setUp(true);
		testObject = (client.instantiationService.get(IUserDataSyncService) as UserDataSyncService).getSynchroniser(SyncResource.Settings) as SettingsSynchroniser;
		disposableStore.add(toDisposable(() => client.instantiationService.get(IUserDataSyncStoreService).clear()));
	});

	teardown(() => disposableStore.clear());

	test('do not sync ignored settings', async () => {
		const settingsContent =
			`{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Editor
	"editor.fontFamily": "Fira Code",

	// Terminal
	"terminal.integrated.shell.osx": "some path",

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",

	// Ignored
	"settingsSync.ignoredSettings": [
		"editor.fontFamily",
		"terminal.integrated.shell.osx"
	]
}`;
		await updateSettings(settingsContent, client);

		let preview = await testObject.preview(await client.manifest());
		assert.strictEqual(testObject.status, SyncStatus.Syncing);
		preview = await testObject.accept(preview!.resourcePreviews[0].previewResource);
		preview = await testObject.apply(false);

		const { content } = await client.read(testObject.resource);
		assert.ok(content !== null);
		const actual = parseSettings(content!);
		assert.deepStrictEqual(actual, `{
	// Always
	"files.autoSave": "afterDelay",
	"files.simpleDialog.enable": true,

	// Workbench
	"workbench.colorTheme": "GitHub Sharp",

	// Ignored
	"settingsSync.ignoredSettings": [
		"editor.fontFamily",
		"terminal.integrated.shell.osx"
	]
}`);
	});

});

function parseSettings(content: string): string {
	const syncData: ISyncData = JSON.parse(content);
	const settingsSyncContent: ISettingsSyncContent = JSON.parse(syncData.content);
	return settingsSyncContent.settings;
}

async function updateSettings(content: string, client: UserDataSyncClient): Promise<void> {
	await client.instantiationService.get(IFileService).writeFile(client.instantiationService.get(IEnvironmentService).settingsResource, VSBuffer.fromString(content));
	await client.instantiationService.get(IConfigurationService).reloadConfiguration();
}
