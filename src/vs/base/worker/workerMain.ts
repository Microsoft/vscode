/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {

	let MonacoEnvironment = (<any>self).MonacoEnvironment;
	let monacoBaseUrl = MonacoEnvironment && MonacoEnvironment.baseUrl ? MonacoEnvironment.baseUrl : '../../../';

	const trustedTypesPolicy = self.trustedTypes?.createPolicy('amdLoader', { createScriptURL: value => value });

	if (typeof (<any>self).define !== 'function' || !(<any>self).define.amd) {
		let loaderSrc: string | TrustedScriptURL = monacoBaseUrl + 'vs/loader.js';
		if (trustedTypesPolicy) {
			loaderSrc = trustedTypesPolicy.createScriptURL(loaderSrc);
		}
		importScripts(loaderSrc as string);
	}

	require.config({
		baseUrl: monacoBaseUrl,
		catchError: true,
		trustedTypesPolicy,
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
