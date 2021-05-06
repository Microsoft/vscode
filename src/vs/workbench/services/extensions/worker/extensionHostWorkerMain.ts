/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

(function () {

	const MonacoEnvironment = (<any>self).MonacoEnvironment;
	const monacoBaseUrl = MonacoEnvironment && MonacoEnvironment.baseUrl ? MonacoEnvironment.baseUrl : '../../../../../';

	const trustedTypesPolicy = (
		typeof self.trustedTypes?.createPolicy === 'function'
			? self.trustedTypes?.createPolicy('amdLoader', {
				createScriptURL: value => value,
				createScript: (_, ...args: string[]) => {
					// workaround a chrome issue not allowing to create new functions
					// see https://github.com/w3c/webappsec-trusted-types/wiki/Trusted-Types-for-function-constructor
					const fnArgs = args.slice(0, -1).join(',');
					const fnBody = args.pop()!.toString();
					const body = `(function anonymous(${fnArgs}) {\n${fnBody}\n})`;
					return body;
				}
			})
			: undefined
	);

	function loadAMDLoader() {
		return new Promise<void>((resolve, reject) => {
			if (typeof (<any>self).define === 'function' && (<any>self).define.amd) {
				return resolve();
			}
			const loaderSrc: string | TrustedScriptURL = monacoBaseUrl + 'vs/loader.js';

			const isCrossOrigin = (/^((http:)|(https:)|(file:))/.test(loaderSrc) && loaderSrc.substring(0, self.origin.length) !== self.origin);
			if (!isCrossOrigin) {
				// use `fetch` if possible because `importScripts`
				// is synchronous and can lead to deadlocks on Safari
				fetch(loaderSrc).then((response) => {
					if (response.status !== 200) {
						throw new Error(response.statusText);
					}
					return response.text();
				}).then((text) => {
					text = `${text}\n//# sourceURL=${loaderSrc}`;
					const func = (
						trustedTypesPolicy
							? self.eval(trustedTypesPolicy.createScript('', text) as unknown as string)
							: new Function(text)
					);
					func.call(self);
					resolve();
				}).then(undefined, reject);
				return;
			}

			if (trustedTypesPolicy) {
				importScripts(trustedTypesPolicy.createScriptURL(loaderSrc) as unknown as string);
			} else {
				importScripts(loaderSrc as string);
			}
			resolve();
		});
	}

	loadAMDLoader().then(() => {
		require.config({
			baseUrl: monacoBaseUrl,
			catchError: true,
			trustedTypesPolicy
		});
		require(['vs/workbench/services/extensions/worker/extensionHostWorker'], () => { }, err => console.error(err));
	}).then(undefined, (err) => console.error(err));
})();
