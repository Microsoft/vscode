/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {

	let MonacoEnvironment = (<any>self).MonacoEnvironment;
	let monacoBaseUrl = MonacoEnvironment && MonacoEnvironment.baseUrl ? MonacoEnvironment.baseUrl : '../../../';

	if (typeof (<any>self).define !== 'function' || !(<any>self).define.amd) {
		importScripts(monacoBaseUrl + 'vs/loader.js');
	}

	require.config({
		baseUrl: monacoBaseUrl,
		catchError: true
	});

	let loadCode = function (moduleId: string) {
		require([moduleId], function (ws) {
			setTimeout(function () {
				let messageHandler = ws.create((msg: any, transfer?: Transferable[]) => {
					(<any>self).postMessage(msg, transfer);
				}, null);

				self.onmessage = (e: MessageEvent) => messageHandler.onmessage(e.data);
				while (beforeReadyMessages.length > 0) {
					self.onmessage(beforeReadyMessages.shift()!);
				}
			}, 0);
		});
	};

	let isFirstMessage = true;
	let beforeReadyMessages: MessageEvent[] = [];
	self.onmessage = (message: MessageEvent) => {
		if (!isFirstMessage) {
			beforeReadyMessages.push(message);
			return;
		}

		isFirstMessage = false;
		loadCode(message.data);
	};
})();
