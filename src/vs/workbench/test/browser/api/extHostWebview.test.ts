/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { NullLogService } from 'vs/platform/log/common/log';
import { MainThreadWebviews } from 'vs/workbench/api/browser/mainThreadWebview';
import { ExtHostWebviews } from 'vs/workbench/api/common/extHostWebview';
import { EditorViewColumn } from 'vs/workbench/api/common/shared/editor';
import { mock } from 'vs/base/test/common/mock';
import { SingleProxyRPCProtocol } from './testRPCProtocol';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { IExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { NullApiDeprecationService } from 'vs/workbench/api/common/extHostApiDeprecationService';

suite('ExtHostWebview', () => {

	let rpcProtocol: (IExtHostRpcService & IExtHostContext) | undefined;
	let extHostDocuments: ExtHostDocuments | undefined;

	setup(() => {
		const shape = createNoopMainThreadWebviews();
		rpcProtocol = SingleProxyRPCProtocol(shape);

		const extHostDocumentsAndEditors = new ExtHostDocumentsAndEditors(rpcProtocol, new NullLogService());
		extHostDocuments = new ExtHostDocuments(rpcProtocol, extHostDocumentsAndEditors);
	});

	test('Cannot register multiple serializers for the same view type', async () => {
		const viewType = 'view.type';

		const extHostWebviews = new ExtHostWebviews(rpcProtocol!, {
			webviewCspSource: '',
			webviewResourceRoot: '',
			isExtensionDevelopmentDebug: false,
		}, undefined, new NullLogService(), NullApiDeprecationService, extHostDocuments!);

		let lastInvokedDeserializer: vscode.WebviewPanelSerializer | undefined = undefined;

		class NoopSerializer implements vscode.WebviewPanelSerializer {
			async deserializeWebviewPanel(_webview: vscode.WebviewPanel, _state: any): Promise<void> {
				lastInvokedDeserializer = this;
			}
		}

		const extension = {} as IExtensionDescription;

		const serializerA = new NoopSerializer();
		const serializerB = new NoopSerializer();

		const serializerARegistration = extHostWebviews.registerWebviewPanelSerializer(extension, viewType, serializerA);

		await extHostWebviews.$deserializeWebviewPanel('x', viewType, 'title', {}, 0 as EditorViewColumn, {});
		assert.strictEqual(lastInvokedDeserializer, serializerA);

		assert.throws(
			() => extHostWebviews.registerWebviewPanelSerializer(extension, viewType, serializerB),
			'Should throw when registering two serializers for the same view');

		serializerARegistration.dispose();

		extHostWebviews.registerWebviewPanelSerializer(extension, viewType, serializerB);

		await extHostWebviews.$deserializeWebviewPanel('x', viewType, 'title', {}, 0 as EditorViewColumn, {});
		assert.strictEqual(lastInvokedDeserializer, serializerB);
	});

	test('asWebviewUri for desktop vscode-resource scheme', () => {
		const extHostWebviews = new ExtHostWebviews(rpcProtocol!, {
			webviewCspSource: '',
			webviewResourceRoot: 'vscode-resource://{{resource}}',
			isExtensionDevelopmentDebug: false,
		}, undefined, new NullLogService(), NullApiDeprecationService, extHostDocuments!);
		const webview = extHostWebviews.createWebviewPanel({} as any, 'type', 'title', 1, {});

		assert.strictEqual(
			webview.webview.asWebviewUri(URI.parse('file:///Users/codey/file.html')).toString(),
			'vscode-resource://file///Users/codey/file.html',
			'Unix basic'
		);

		assert.strictEqual(
			webview.webview.asWebviewUri(URI.parse('file:///Users/codey/file.html#frag')).toString(),
			'vscode-resource://file///Users/codey/file.html#frag',
			'Unix should preserve fragment'
		);

		assert.strictEqual(
			webview.webview.asWebviewUri(URI.parse('file:///Users/codey/f%20ile.html')).toString(),
			'vscode-resource://file///Users/codey/f%20ile.html',
			'Unix with encoding'
		);

		assert.strictEqual(
			webview.webview.asWebviewUri(URI.parse('file://localhost/Users/codey/file.html')).toString(),
			'vscode-resource://file//localhost/Users/codey/file.html',
			'Unix should preserve authority'
		);

		assert.strictEqual(
			webview.webview.asWebviewUri(URI.parse('file:///c:/codey/file.txt')).toString(),
			'vscode-resource://file///c%3A/codey/file.txt',
			'Windows C drive'
		);
	});

	test('asWebviewUri for web endpoint', () => {
		const extHostWebviews = new ExtHostWebviews(rpcProtocol!, {
			webviewCspSource: '',
			webviewResourceRoot: `https://{{uuid}}.webview.contoso.com/commit/{{resource}}`,
			isExtensionDevelopmentDebug: false,
		}, undefined, new NullLogService(), NullApiDeprecationService, extHostDocuments!);
		const webview = extHostWebviews.createWebviewPanel({} as any, 'type', 'title', 1, {});

		function stripEndpointUuid(input: string) {
			return input.replace(/^https:\/\/[^\.]+?\./, '');
		}

		assert.strictEqual(
			stripEndpointUuid(webview.webview.asWebviewUri(URI.parse('file:///Users/codey/file.html')).toString()),
			'webview.contoso.com/commit/file///Users/codey/file.html',
			'Unix basic'
		);

		assert.strictEqual(
			stripEndpointUuid(webview.webview.asWebviewUri(URI.parse('file:///Users/codey/file.html#frag')).toString()),
			'webview.contoso.com/commit/file///Users/codey/file.html#frag',
			'Unix should preserve fragment'
		);

		assert.strictEqual(
			stripEndpointUuid(webview.webview.asWebviewUri(URI.parse('file:///Users/codey/f%20ile.html')).toString()),
			'webview.contoso.com/commit/file///Users/codey/f%20ile.html',
			'Unix with encoding'
		);

		assert.strictEqual(
			stripEndpointUuid(webview.webview.asWebviewUri(URI.parse('file://localhost/Users/codey/file.html')).toString()),
			'webview.contoso.com/commit/file//localhost/Users/codey/file.html',
			'Unix should preserve authority'
		);

		assert.strictEqual(
			stripEndpointUuid(webview.webview.asWebviewUri(URI.parse('file:///c:/codey/file.txt')).toString()),
			'webview.contoso.com/commit/file///c%3A/codey/file.txt',
			'Windows C drive'
		);
	});
});


function createNoopMainThreadWebviews() {
	return new class extends mock<MainThreadWebviews>() {
		$createWebviewPanel() { /* noop */ }
		$registerSerializer() { /* noop */ }
		$unregisterSerializer() { /* noop */ }
	};
}

