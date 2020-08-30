/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { env, extensions, ExtensionKind, UIKind, Uri } from 'vscode';

suite('vscode API - env', () => {

	test('env is set', function () {
		assert.equal(typeof env.language, 'string');
		assert.equal(typeof env.appRoot, 'string');
		assert.equal(typeof env.appName, 'string');
		assert.equal(typeof env.machineId, 'string');
		assert.equal(typeof env.sessionId, 'string');
		assert.equal(typeof env.shell, 'string');
	});

	test('env is readonly', function () {
		assert.throws(() => (env as any).language = '234');
		assert.throws(() => (env as any).appRoot = '234');
		assert.throws(() => (env as any).appName = '234');
		assert.throws(() => (env as any).machineId = '234');
		assert.throws(() => (env as any).sessionId = '234');
		assert.throws(() => (env as any).shell = '234');
	});

	test('env.remoteName', function () {
		const remoteName = env.remoteName;
		const knownWorkspaceExtension = extensions.getExtension('vscode.git');
		const knownUiExtension = extensions.getExtension('vscode.git-ui');
		if (typeof remoteName === 'undefined') {
			// not running in remote, so we expect both extensions
			assert.ok(knownWorkspaceExtension);
			assert.ok(knownUiExtension);
			assert.equal(ExtensionKind.UI, knownUiExtension!.extensionKind);
		} else if (typeof remoteName === 'string') {
			// running in remote, so we only expect workspace extensions
			assert.ok(knownWorkspaceExtension);
			if (env.uiKind === UIKind.Desktop) {
				assert.ok(!knownUiExtension); // we currently can only access extensions that run on same host
			}
			assert.equal(ExtensionKind.Workspace, knownWorkspaceExtension!.extensionKind);
		} else {
			assert.fail();
		}
	});

	test('env.uiKind', async function () {
		const uri = Uri.parse(`${env.uriScheme}:://vscode.vscode-api-tests/path?key=value&other=false`);
		const result = await env.asExternalUri(uri);

		const kind = env.uiKind;
		if (result.scheme === 'http' || result.scheme === 'https') {
			assert.equal(kind, UIKind.Web);
		} else {
			assert.equal(kind, UIKind.Desktop);
		}
	});

	test('env.asExternalUri - with env.uriScheme', async function () {
		const uri = Uri.parse(`${env.uriScheme}:://vscode.vscode-api-tests/path?key=value&other=false`);
		const result = await env.asExternalUri(uri);
		assert.ok(result);

		if (env.uiKind === UIKind.Desktop) {
			assert.equal(uri.scheme, result.scheme);
			assert.equal(uri.authority, result.authority);
			assert.equal(uri.path, result.path);
		} else {
			assert.ok(result.scheme === 'http' || result.scheme === 'https');
		}
	});
});
