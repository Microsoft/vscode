/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const WEB_WORKER_IFRAME = {
	sha: 'sha256-rSINb5Ths99Zj4Ml59jEdHS4WbO+H5Iw+oyRmyi2MLw=',
	js: `
(function() {
	const workerSrc = document.getElementById('vscode-worker-src').getAttribute('data-value');
	const worker = new Worker(workerSrc, { name: 'WorkerExtensionHost' });
	const vscodeWebWorkerExtHostId = document.getElementById('vscode-web-worker-ext-host-id').getAttribute('data-value');

	worker.onmessage = (event) => {
		const { data } = event;
		if (!(data instanceof ArrayBuffer)) {
			console.warn('Unknown data received', data);
			window.parent.postMessage({
				vscodeWebWorkerExtHostId,
				error: {
					name: 'Error',
					message: 'Unknown data received',
					stack: []
				}
			}, '*');
			return;
		}
		window.parent.postMessage({
			vscodeWebWorkerExtHostId,
			data: data
		}, '*', [data]);
	};

	worker.onerror = (event) => {
		console.error(event.message, event.error);
		window.parent.postMessage({
			vscodeWebWorkerExtHostId,
			error: {
				name: event.error ? event.error.name : '',
				message: event.error ? event.error.message : '',
				stack: event.error ? event.error.stack : []
			}
		}, '*');
	};

	window.addEventListener('message', function(event) {
		if (event.source !== window.parent) {
			return;
		}
		if (event.data.vscodeWebWorkerExtHostId !== vscodeWebWorkerExtHostId) {
			return;
		}
		worker.postMessage(event.data.data, [event.data.data]);
	}, false);
})();
`
};
