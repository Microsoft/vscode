/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as os from 'os';
import * as vscode from 'vscode';
import { assertNoRpc, closeAllEditors, delay, disposeAll } from '../utils';

const webviewId = 'myWebview';

function workspaceFile(...segments: string[]) {
	return vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0].uri, ...segments);
}

const testDocument = workspaceFile('bower.json');

suite.skip('vscode API - webview', () => {
	const disposables: vscode.Disposable[] = [];

	function _register<T extends vscode.Disposable>(disposable: T) {
		disposables.push(disposable);
		return disposable;
	}

	teardown(async () => {
		assertNoRpc();
		await closeAllEditors();
		disposeAll(disposables);
	});

	test('webviews should be able to send and receive messages', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true }));
		const firstResponse = getMessage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				window.addEventListener('message', (message) => {
					vscode.postMessage({ value: message.data.value + 1 });
				});
			</script>`);

		webview.webview.postMessage({ value: 1 });
		assert.strictEqual((await firstResponse).value, 2);
	});

	test('webviews should not have scripts enabled by default', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, {}));
		const response = Promise.race<any>([
			getMessage(webview),
			new Promise<{}>(resolve => setTimeout(() => resolve({ value: '🎉' }), 1000))
		]);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				vscode.postMessage({ value: '💉' });
			</script>`);

		assert.strictEqual((await response).value, '🎉');
	});

	test('webviews should update html', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true }));

		{
			const response = getMessage(webview);
			webview.webview.html = createHtmlDocumentWithBody(/*html*/`
				<script>
					const vscode = acquireVsCodeApi();
					vscode.postMessage({ value: 'first' });
				</script>`);

			assert.strictEqual((await response).value, 'first');
		}
		{
			const response = getMessage(webview);
			webview.webview.html = createHtmlDocumentWithBody(/*html*/`
				<script>
					const vscode = acquireVsCodeApi();
					vscode.postMessage({ value: 'second' });
				</script>`);

			assert.strictEqual((await response).value, 'second');
		}
	});

	test.skip('webviews should preserve vscode API state when they are hidden', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true }));
		const ready = getMessage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				let value = (vscode.getState() || {}).value || 0;

				window.addEventListener('message', (message) => {
					switch (message.data.type) {
					case 'get':
						vscode.postMessage({ value });
						break;

					case 'add':
						++value;;
						vscode.setState({ value });
						vscode.postMessage({ value });
						break;
					}
				});

				vscode.postMessage({ type: 'ready' });
			</script>`);
		await ready;

		const firstResponse = await sendRecieveMessage(webview, { type: 'add' });
		assert.strictEqual(firstResponse.value, 1);

		// Swap away from the webview
		const doc = await vscode.workspace.openTextDocument(testDocument);
		await vscode.window.showTextDocument(doc);

		// And then back
		const ready2 = getMessage(webview);
		webview.reveal(vscode.ViewColumn.One);
		await ready2;

		// We should still have old state
		const secondResponse = await sendRecieveMessage(webview, { type: 'get' });
		assert.strictEqual(secondResponse.value, 1);
	});

	test('webviews should preserve their context when they are moved between view columns', async () => {
		const doc = await vscode.workspace.openTextDocument(testDocument);
		await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);

		// Open webview in same column
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true }));
		const ready = getMessage(webview);
		webview.webview.html = statefulWebviewHtml;
		await ready;

		const firstResponse = await sendRecieveMessage(webview, { type: 'add' });
		assert.strictEqual(firstResponse.value, 1);

		// Now move webview to new view column
		webview.reveal(vscode.ViewColumn.Two);

		// We should still have old state
		const secondResponse = await sendRecieveMessage(webview, { type: 'get' });
		assert.strictEqual(secondResponse.value, 1);
	});

	test('webviews with retainContextWhenHidden should preserve their context when they are hidden', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true, retainContextWhenHidden: true }));
		const ready = getMessage(webview);

		webview.webview.html = statefulWebviewHtml;
		await ready;

		const firstResponse = await sendRecieveMessage(webview, { type: 'add' });
		assert.strictEqual((await firstResponse).value, 1);

		// Swap away from the webview
		const doc = await vscode.workspace.openTextDocument(testDocument);
		await vscode.window.showTextDocument(doc);

		// And then back
		webview.reveal(vscode.ViewColumn.One);

		// We should still have old state
		const secondResponse = await sendRecieveMessage(webview, { type: 'get' });
		assert.strictEqual(secondResponse.value, 1);
	});

	test('webviews with retainContextWhenHidden should preserve their page position when hidden', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true, retainContextWhenHidden: true }));
		const ready = getMessage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			${'<h1>Header</h1>'.repeat(200)}
			<script>
				const vscode = acquireVsCodeApi();

				setTimeout(() => {
					window.scroll(0, 100);
					vscode.postMessage({ value: window.scrollY });
				}, 500);

				window.addEventListener('message', (message) => {
					switch (message.data.type) {
						case 'get':
							vscode.postMessage({ value: window.scrollY });
							break;
					}
				});
				vscode.postMessage({ type: 'ready' });
			</script>`);
		await ready;

		const firstResponse = getMessage(webview);

		assert.strictEqual(Math.round((await firstResponse).value), 100);

		// Swap away from the webview
		const doc = await vscode.workspace.openTextDocument(testDocument);
		await vscode.window.showTextDocument(doc);

		// And then back
		webview.reveal(vscode.ViewColumn.One);

		// We should still have old scroll pos
		const secondResponse = await sendRecieveMessage(webview, { type: 'get' });
		assert.strictEqual(Math.round(secondResponse.value), 100);
	});

	test('webviews with retainContextWhenHidden should be able to recive messages while hidden', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true, retainContextWhenHidden: true }));
		const ready = getMessage(webview);

		webview.webview.html = statefulWebviewHtml;
		await ready;

		const firstResponse = await sendRecieveMessage(webview, { type: 'add' });
		assert.strictEqual((await firstResponse).value, 1);

		// Swap away from the webview
		const doc = await vscode.workspace.openTextDocument(testDocument);
		await vscode.window.showTextDocument(doc);

		// Try posting a message to our hidden webview
		const secondResponse = await sendRecieveMessage(webview, { type: 'add' });
		assert.strictEqual((await secondResponse).value, 2);

		// Now show webview again
		webview.reveal(vscode.ViewColumn.One);

		// We should still have old state
		const thirdResponse = await sendRecieveMessage(webview, { type: 'get' });
		assert.strictEqual(thirdResponse.value, 2);
	});


	test.skip('webviews should only be able to load resources from workspace by default', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', {
			viewColumn: vscode.ViewColumn.One
		}, {
			enableScripts: true
		}));

		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				window.addEventListener('message', (message) => {
					const img = document.createElement('img');
					img.addEventListener('load', () => {
						vscode.postMessage({ value: true });
					});
					img.addEventListener('error', () => {
						vscode.postMessage({ value: false });
					});
					img.src = message.data.src;
					document.body.appendChild(img);
				});

				vscode.postMessage({ type: 'ready' });
			</script>`);

		const ready = getMessage(webview);
		await ready;

		{
			const imagePath = webview.webview.asWebviewUri(workspaceFile('image.png'));
			const response = await sendRecieveMessage(webview, { src: imagePath.toString() });
			assert.strictEqual(response.value, true);
		}
		// {
		// 	// #102188. Resource filename containing special characters like '%', '#', '?'.
		// 	const imagePath = webview.webview.asWebviewUri(workspaceFile('image%02.png'));
		// 	const response = await sendRecieveMessage(webview, { src: imagePath.toString() });
		// 	assert.strictEqual(response.value, true);
		// }
		// {
		// 	// #102188. Resource filename containing special characters like '%', '#', '?'.
		// 	const imagePath = webview.webview.asWebviewUri(workspaceFile('image%.png'));
		// 	const response = await sendRecieveMessage(webview, { src: imagePath.toString() });
		// 	assert.strictEqual(response.value, true);
		// }
		{
			const imagePath = webview.webview.asWebviewUri(workspaceFile('no-such-image.png'));
			const response = await sendRecieveMessage(webview, { src: imagePath.toString() });
			assert.strictEqual(response.value, false);
		}
		{
			const imagePath = webview.webview.asWebviewUri(workspaceFile('..', '..', '..', 'resources', 'linux', 'code.png'));
			const response = await sendRecieveMessage(webview, { src: imagePath.toString() });
			assert.strictEqual(response.value, false);
		}
	});

	test.skip('webviews should allow overriding allowed resource paths using localResourceRoots', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, {
			enableScripts: true,
			localResourceRoots: [workspaceFile('sub')]
		}));

		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				window.addEventListener('message', (message) => {
					const img = document.createElement('img');
					img.addEventListener('load', () => { vscode.postMessage({ value: true }); });
					img.addEventListener('error', () => { vscode.postMessage({ value: false }); });
					img.src = message.data.src;
					document.body.appendChild(img);
				});
			</script>`);

		{
			const response = sendRecieveMessage(webview, { src: webview.webview.asWebviewUri(workspaceFile('sub', 'image.png')).toString() });
			assert.strictEqual((await response).value, true);
		}
		{
			const response = sendRecieveMessage(webview, { src: webview.webview.asWebviewUri(workspaceFile('image.png')).toString() });
			assert.strictEqual((await response).value, false);
		}
	});

	test.skip('webviews using hard-coded old style vscode-resource uri should work', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, {
			enableScripts: true,
			localResourceRoots: [workspaceFile('sub')]
		}));

		const imagePath = workspaceFile('sub', 'image.png').with({ scheme: 'vscode-resource' }).toString();

		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<img src="${imagePath}">
			<script>
				const vscode = acquireVsCodeApi();
				const img = document.getElementsByTagName('img')[0];
				img.addEventListener('load', () => { vscode.postMessage({ value: true }); });
				img.addEventListener('error', () => { vscode.postMessage({ value: false }); });
			</script>`);

		const firstResponse = getMessage(webview);

		assert.strictEqual((await firstResponse).value, true);
	});

	test('webviews should have real view column after they are created, #56097', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.Active }, { enableScripts: true }));

		// Since we used a symbolic column, we don't know what view column the webview will actually show in at first
		assert.strictEqual(webview.viewColumn, undefined);

		let changed = false;
		const viewStateChanged = new Promise<vscode.WebviewPanelOnDidChangeViewStateEvent>((resolve) => {
			webview.onDidChangeViewState(e => {
				if (changed) {
					throw new Error('Only expected a single view state change');
				}
				changed = true;
				resolve(e);
			}, undefined, disposables);
		});

		assert.strictEqual((await viewStateChanged).webviewPanel.viewColumn, vscode.ViewColumn.One);

		const firstResponse = getMessage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();
				vscode.postMessage({  });
			</script>`);

		webview.webview.postMessage({ value: 1 });
		await firstResponse;
		assert.strictEqual(webview.viewColumn, vscode.ViewColumn.One);
	});

	if (os.platform() === 'darwin') {
		test.skip('webview can copy text from webview', async () => {
			const expectedText = `webview text from: ${Date.now()}!`;

			const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true, retainContextWhenHidden: true }));
			const ready = getMessage(webview);


			webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<b>${expectedText}</b>
			<script>
				const vscode = acquireVsCodeApi();
				document.execCommand('selectAll');
				vscode.postMessage({ type: 'ready' });
			</script>`);
			await ready;

			await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
			await delay(200); // Make sure copy has time to reach webview
			assert.strictEqual(await vscode.env.clipboard.readText(), expectedText);
		});
	}

	test('webviews should transfer ArrayBuffers to and from webviews', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true, retainContextWhenHidden: true }));
		const ready = getMessage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();

				window.addEventListener('message', (message) => {
					switch (message.data.type) {
						case 'add1':
							const arrayBuffer = message.data.array;
							const uint8Array = new Uint8Array(arrayBuffer);

							for (let i = 0; i < uint8Array.length; ++i) {
								uint8Array[i] = uint8Array[i] + 1;
							}

							vscode.postMessage({ array: arrayBuffer }, [arrayBuffer]);
							break;
					}
				});
				vscode.postMessage({ type: 'ready' });
			</script>`);
		await ready;

		const responsePromise = getMessage(webview);

		const bufferLen = 100;

		{
			const arrayBuffer = new ArrayBuffer(bufferLen);
			const uint8Array = new Uint8Array(arrayBuffer);
			for (let i = 0; i < bufferLen; ++i) {
				uint8Array[i] = i;
			}
			webview.webview.postMessage({
				type: 'add1',
				array: arrayBuffer
			});
		}
		{
			const response = await responsePromise;
			assert.ok(response.array instanceof ArrayBuffer);

			const uint8Array = new Uint8Array(response.array);
			for (let i = 0; i < bufferLen; ++i) {
				assert.strictEqual(uint8Array[i], i + 1);
			}
		}
	});

	test('webviews should transfer Typed arrays to and from webviews', async () => {
		const webview = _register(vscode.window.createWebviewPanel(webviewId, 'title', { viewColumn: vscode.ViewColumn.One }, { enableScripts: true, retainContextWhenHidden: true }));
		const ready = getMessage(webview);
		webview.webview.html = createHtmlDocumentWithBody(/*html*/`
			<script>
				const vscode = acquireVsCodeApi();

				window.addEventListener('message', (message) => {
					switch (message.data.type) {
						case 'add1':
							const uint8Array = message.data.array1;

							// This should update both buffers since they use the same ArrayBuffer storage
							const uint16Array = message.data.array2;
							for (let i = 0; i < uint16Array.length; ++i) {
								uint16Array[i] = uint16Array[i] + 1;
							}

							vscode.postMessage({ array1: uint8Array, array2: uint16Array, }, [uint16Array.buffer]);
							break;
					}
				});
				vscode.postMessage({ type: 'ready' });
			</script>`);
		await ready;

		const responsePromise = getMessage(webview);

		const bufferLen = 100;
		{
			const arrayBuffer = new ArrayBuffer(bufferLen);
			const uint8Array = new Uint8Array(arrayBuffer);
			const uint16Array = new Uint16Array(arrayBuffer);
			for (let i = 0; i < uint16Array.length; ++i) {
				uint16Array[i] = i;
			}

			webview.webview.postMessage({
				type: 'add1',
				array1: uint8Array,
				array2: uint16Array,
			});
		}
		{
			const response = await responsePromise;

			assert.ok(response.array1 instanceof Uint8Array);
			assert.ok(response.array2 instanceof Uint16Array);
			assert.ok(response.array1.buffer === response.array2.buffer);

			const uint8Array = response.array1;
			for (let i = 0; i < bufferLen; ++i) {
				if (i % 2 === 0) {
					assert.strictEqual(uint8Array[i], Math.floor(i / 2) + 1);
				} else {
					assert.strictEqual(uint8Array[i], 0);
				}
			}
		}
	});
});

function createHtmlDocumentWithBody(body: string): string {
	return /*html*/`<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="UTF-8">
	<meta name="viewport" content="width=device-width, initial-scale=1.0">
	<meta http-equiv="X-UA-Compatible" content="ie=edge">
	<title>Document</title>
</head>
<body>
	${body}
</body>
</html>`;
}

const statefulWebviewHtml = createHtmlDocumentWithBody(/*html*/ `
	<script>
		const vscode = acquireVsCodeApi();
		let value = 0;
		window.addEventListener('message', (message) => {
			switch (message.data.type) {
				case 'get':
					vscode.postMessage({ value });
					break;

				case 'add':
					++value;;
					vscode.setState({ value });
					vscode.postMessage({ value });
					break;
			}
		});
		vscode.postMessage({ type: 'ready' });
	</script>`);


function getMessage<R = any>(webview: vscode.WebviewPanel): Promise<R> {
	return new Promise<R>(resolve => {
		const sub = webview.webview.onDidReceiveMessage(message => {
			sub.dispose();
			resolve(message);
		});
	});
}

function sendRecieveMessage<T = {}, R = any>(webview: vscode.WebviewPanel, message: T): Promise<R> {
	const p = getMessage<R>(webview);
	webview.webview.postMessage(message);
	return p;
}
