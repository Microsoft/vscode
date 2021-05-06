/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createApiFactoryAndRegisterActors } from 'vs/workbench/api/common/extHost.api.impl';
import { ExtensionActivationTimesBuilder } from 'vs/workbench/api/common/extHostExtensionActivator';
import { AbstractExtHostExtensionService } from 'vs/workbench/api/common/extHostExtensionService';
import { URI } from 'vs/base/common/uri';
import { RequireInterceptor } from 'vs/workbench/api/common/extHostRequireInterceptor';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ExtensionRuntime } from 'vs/workbench/api/common/extHostTypes';
import { timeout } from 'vs/base/common/async';
import { MainContext, MainThreadConsoleShape } from 'vs/workbench/api/common/extHost.protocol';

namespace TrustedFunction {

	// workaround a chrome issue not allowing to create new functions
	// see https://github.com/w3c/webappsec-trusted-types/wiki/Trusted-Types-for-function-constructor
	const ttpTrustedFunction = self.trustedTypes?.createPolicy('TrustedFunctionWorkaround', {
		createScript: (_, ...args: string[]) => {
			args.forEach((arg) => {
				if (!self.trustedTypes?.isScript(arg)) {
					throw new Error('TrustedScripts only, please');
				}
			});
			// NOTE: This is insecure without parsing the arguments and body,
			// Malicious inputs  can escape the function body and execute immediately!
			const fnArgs = args.slice(0, -1).join(',');
			const fnBody = args.pop()!.toString();
			const body = `(function anonymous(${fnArgs}) {\n${fnBody}\n})`;
			return body;
		}
	});

	export function create(...args: string[]): Function {
		if (!ttpTrustedFunction) {
			return new Function(...args);
		}
		return self.eval(ttpTrustedFunction.createScript('', ...args) as unknown as string);
	}
}

class WorkerRequireInterceptor extends RequireInterceptor {

	_installInterceptor() { }

	getModule(request: string, parent: URI): undefined | any {
		for (let alternativeModuleName of this._alternatives) {
			let alternative = alternativeModuleName(request);
			if (alternative) {
				request = alternative;
				break;
			}
		}

		if (this._factories.has(request)) {
			return this._factories.get(request)!.load(request, parent, () => { throw new Error('CANNOT LOAD MODULE from here.'); });
		}
		return undefined;
	}
}

export class ExtHostExtensionService extends AbstractExtHostExtensionService {
	readonly extensionRuntime = ExtensionRuntime.Webworker;

	private static _ttpExtensionScripts = self.trustedTypes?.createPolicy('ExtensionScripts', { createScript: source => source });

	private _fakeModules?: WorkerRequireInterceptor;

	protected async _beforeAlmostReadyToRunExtensions(): Promise<void> {
		const mainThreadConsole = this._extHostContext.getProxy(MainContext.MainThreadConsole);
		wrapConsoleMethods(mainThreadConsole, this._initData.environment.isExtensionDevelopmentDebug);

		// initialize API and register actors
		const apiFactory = this._instaService.invokeFunction(createApiFactoryAndRegisterActors);
		this._fakeModules = this._instaService.createInstance(WorkerRequireInterceptor, apiFactory, this._registry);
		await this._fakeModules.install();
		performance.mark('code/extHost/didInitAPI');

		await this._waitForDebuggerAttachment();
	}

	protected _getEntryPoint(extensionDescription: IExtensionDescription): string | undefined {
		return extensionDescription.browser;
	}

	protected async _loadCommonJSModule<T>(extensionId: ExtensionIdentifier | null, module: URI, activationTimesBuilder: ExtensionActivationTimesBuilder): Promise<T> {

		module = module.with({ path: ensureSuffix(module.path, '.js') });
		if (extensionId) {
			performance.mark(`code/extHost/willFetchExtensionCode/${extensionId.value}`);
		}
		const response = await fetch(module.toString(true));
		if (extensionId) {
			performance.mark(`code/extHost/didFetchExtensionCode/${extensionId.value}`);
		}

		if (response.status !== 200) {
			throw new Error(response.statusText);
		}

		// fetch JS sources as text and create a new function around it
		const source = await response.text();
		// Here we append #vscode-extension to serve as a marker, such that source maps
		// can be adjusted for the extra wrapping function.
		const sourceURL = `${module.toString(true)}#vscode-extension`;
		const fullSource = `${source}\n//# sourceURL=${sourceURL}`;
		let initFn: Function;
		try {
			initFn = TrustedFunction.create(
				ExtHostExtensionService._ttpExtensionScripts?.createScript('module') as unknown as string ?? 'module',
				ExtHostExtensionService._ttpExtensionScripts?.createScript('exports') as unknown as string ?? 'exports',
				ExtHostExtensionService._ttpExtensionScripts?.createScript('require') as unknown as string ?? 'require',
				ExtHostExtensionService._ttpExtensionScripts?.createScript(fullSource) as unknown as string ?? fullSource
			);
		} catch (err) {
			if (extensionId) {
				console.error(`Loading code for extension ${extensionId.value} failed: ${err.message}`);
			} else {
				console.error(`Loading code failed: ${err.message}`);
			}
			console.error(`${module.toString(true)}${typeof err.line === 'number' ? ` line ${err.line}` : ''}${typeof err.column === 'number' ? ` column ${err.column}` : ''}`);
			console.error(err);
			throw err;
		}

		// define commonjs globals: `module`, `exports`, and `require`
		const _exports = {};
		const _module = { exports: _exports };
		const _require = (request: string) => {
			const result = this._fakeModules!.getModule(request, module);
			if (result === undefined) {
				throw new Error(`Cannot load module '${request}'`);
			}
			return result;
		};

		try {
			activationTimesBuilder.codeLoadingStart();
			if (extensionId) {
				performance.mark(`code/extHost/willLoadExtensionCode/${extensionId.value}`);
			}
			initFn(_module, _exports, _require);
			return <T>(_module.exports !== _exports ? _module.exports : _exports);
		} finally {
			if (extensionId) {
				performance.mark(`code/extHost/didLoadExtensionCode/${extensionId.value}`);
			}
			activationTimesBuilder.codeLoadingStop();
		}
	}

	async $setRemoteEnvironment(_env: { [key: string]: string | null }): Promise<void> {
		throw new Error('Not supported');
	}

	private async _waitForDebuggerAttachment(waitTimeout = 5000) {
		// debugger attaches async, waiting for it fixes #106698 and #99222
		if (!this._initData.environment.isExtensionDevelopmentDebug) {
			return;
		}

		const deadline = Date.now() + waitTimeout;
		while (Date.now() < deadline && !('__jsDebugIsReady' in globalThis)) {
			await timeout(10);
		}
	}
}

function ensureSuffix(path: string, suffix: string): string {
	return path.endsWith(suffix) ? path : path + suffix;
}

// copied from bootstrap-fork.js
function wrapConsoleMethods(service: MainThreadConsoleShape, callToNative: boolean) {
	wrap('info', 'log');
	wrap('log', 'log');
	wrap('warn', 'warn');
	wrap('error', 'error');

	function wrap(method: 'error' | 'warn' | 'info' | 'log', severity: 'error' | 'warn' | 'log') {
		const original = console[method];
		console[method] = function () {
			service.$logExtensionHostMessage({ type: '__$console', severity, arguments: safeToArray(arguments) });
			if (callToNative) {
				original.apply(console, arguments as any);
			}
		};
	}

	const MAX_LENGTH = 100000;

	function safeToArray(args: IArguments) {
		const seen: any[] = [];
		const argsArray = [];

		// Massage some arguments with special treatment
		if (args.length) {
			for (let i = 0; i < args.length; i++) {

				// Any argument of type 'undefined' needs to be specially treated because
				// JSON.stringify will simply ignore those. We replace them with the string
				// 'undefined' which is not 100% right, but good enough to be logged to console
				if (typeof args[i] === 'undefined') {
					args[i] = 'undefined';
				}

				// Any argument that is an Error will be changed to be just the error stack/message
				// itself because currently cannot serialize the error over entirely.
				else if (args[i] instanceof Error) {
					const errorObj = args[i];
					if (errorObj.stack) {
						args[i] = errorObj.stack;
					} else {
						args[i] = errorObj.toString();
					}
				}

				argsArray.push(args[i]);
			}
		}

		try {
			const res = JSON.stringify(argsArray, function (key, value) {

				// Objects get special treatment to prevent circles
				if (value && typeof value === 'object') {
					if (seen.indexOf(value) !== -1) {
						return '[Circular]';
					}

					seen.push(value);
				}

				return value;
			});

			if (res.length > MAX_LENGTH) {
				return 'Output omitted for a large object that exceeds the limits';
			}

			return res;
		} catch (error) {
			return `Output omitted for an object that cannot be inspected ('${error.toString()}')`;
		}
	}
}
