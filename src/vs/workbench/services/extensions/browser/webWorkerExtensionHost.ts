/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWorkerBootstrapUrl } from 'vs/base/worker/defaultWorkerFactory';
import { Emitter, Event } from 'vs/base/common/event';
import { toDisposable, Disposable } from 'vs/base/common/lifecycle';
import { IMessagePassingProtocol } from 'vs/base/parts/ipc/common/ipc';
import { VSBuffer } from 'vs/base/common/buffer';
import { createMessageOfType, MessageType, isMessageOfType, ExtensionHostExitCode } from 'vs/workbench/services/extensions/common/extensionHostProtocol';
import { IInitData, UIKind } from 'vs/workbench/api/common/extHost.protocol';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { ILabelService } from 'vs/platform/label/common/label';
import { ILogService } from 'vs/platform/log/common/log';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import * as platform from 'vs/base/common/platform';
import * as dom from 'vs/base/browser/dom';
import { URI } from 'vs/base/common/uri';
import { IExtensionHost, ExtensionHostLogFileName, ExtensionHostKind } from 'vs/workbench/services/extensions/common/extensions';
import { IProductService } from 'vs/platform/product/common/productService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { joinPath } from 'vs/base/common/resources';
import { Registry } from 'vs/platform/registry/common/platform';
import { IOutputChannelRegistry, Extensions } from 'vs/workbench/services/output/common/output';
import { localize } from 'vs/nls';
import { generateUuid } from 'vs/base/common/uuid';
import { canceled, onUnexpectedError } from 'vs/base/common/errors';
import { Barrier } from 'vs/base/common/async';
import { FileAccess } from 'vs/base/common/network';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { NewWorkerMessage, TerminateWorkerMessage } from 'vs/workbench/services/extensions/common/polyfillNestedWorker.protocol';

export interface IWebWorkerExtensionHostInitData {
	readonly autoStart: boolean;
	readonly extensions: IExtensionDescription[];
}

export interface IWebWorkerExtensionHostDataProvider {
	getInitData(): Promise<IWebWorkerExtensionHostInitData>;
}

const ttPolicy = window.trustedTypes?.createPolicy('webWorkerExtensionHost', { createScriptURL: value => value });

const ttPolicyNestedWorker = window.trustedTypes?.createPolicy('webNestedWorkerExtensionHost', {
	createScriptURL(value) {
		if (value.startsWith('blob:')) {
			return value;
		}
		throw new Error(value + ' is NOT allowed');
	}
});

export class WebWorkerExtensionHost extends Disposable implements IExtensionHost {

	public readonly kind = ExtensionHostKind.LocalWebWorker;
	public readonly remoteAuthority = null;

	private readonly _onDidExit = this._register(new Emitter<[number, string | null]>());
	public readonly onExit: Event<[number, string | null]> = this._onDidExit.event;

	private _isTerminating: boolean;
	private _protocolPromise: Promise<IMessagePassingProtocol> | null;
	private _protocol: IMessagePassingProtocol | null;

	private readonly _extensionHostLogsLocation: URI;
	private readonly _extensionHostLogFile: URI;

	constructor(
		private readonly _initDataProvider: IWebWorkerExtensionHostDataProvider,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IWorkspaceContextService private readonly _contextService: IWorkspaceContextService,
		@ILabelService private readonly _labelService: ILabelService,
		@ILogService private readonly _logService: ILogService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IProductService private readonly _productService: IProductService,
		@ILayoutService private readonly _layoutService: ILayoutService,
	) {
		super();
		this._isTerminating = false;
		this._protocolPromise = null;
		this._protocol = null;
		this._extensionHostLogsLocation = joinPath(this._environmentService.extHostLogsPath, 'webWorker');
		this._extensionHostLogFile = joinPath(this._extensionHostLogsLocation, `${ExtensionHostLogFileName}.log`);
	}

	private _webWorkerExtensionHostIframeSrc(): string | null {
		if (this._environmentService.options && this._environmentService.options.webWorkerExtensionHostIframeSrc) {
			return this._environmentService.options.webWorkerExtensionHostIframeSrc;
		}
		if (this._productService.webEndpointUrl) {
			const forceHTTPS = (location.protocol === 'https:');
			let baseUrl = this._productService.webEndpointUrl;
			if (this._productService.quality) {
				baseUrl += `/${this._productService.quality}`;
			}
			if (this._productService.commit) {
				baseUrl += `/${this._productService.commit}`;
			}
			return (
				forceHTTPS
					? `${baseUrl}/out/vs/workbench/services/extensions/worker/httpsWebWorkerExtensionHostIframe.html`
					: `${baseUrl}/out/vs/workbench/services/extensions/worker/httpWebWorkerExtensionHostIframe.html`
			);
		}
		return null;
	}

	public async start(): Promise<IMessagePassingProtocol> {
		if (!this._protocolPromise) {
			if (platform.isWeb) {
				const webWorkerExtensionHostIframeSrc = this._webWorkerExtensionHostIframeSrc();
				if (webWorkerExtensionHostIframeSrc) {
					this._protocolPromise = this._startInsideIframe(webWorkerExtensionHostIframeSrc);
				} else {
					console.warn(`The web worker extension host is started without an iframe sandbox!`);
					this._protocolPromise = this._startOutsideIframe();
				}
			} else {
				this._protocolPromise = this._startOutsideIframe();
			}
			this._protocolPromise.then(protocol => this._protocol = protocol);
		}
		return this._protocolPromise;
	}

	private async _startInsideIframe(webWorkerExtensionHostIframeSrc: string): Promise<IMessagePassingProtocol> {
		const emitter = this._register(new Emitter<VSBuffer>());

		const iframe = document.createElement('iframe');
		iframe.setAttribute('class', 'web-worker-ext-host-iframe');
		iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
		iframe.style.display = 'none';

		const vscodeWebWorkerExtHostId = generateUuid();
		iframe.setAttribute('src', `${webWorkerExtensionHostIframeSrc}?vscodeWebWorkerExtHostId=${vscodeWebWorkerExtHostId}`);

		const barrier = new Barrier();
		let port!: MessagePort;
		let barrierError: Error | null = null;
		let barrierHasError = false;
		let startTimeout: any = null;

		const rejectBarrier = (exitCode: number, error: Error) => {
			barrierError = error;
			barrierHasError = true;
			onUnexpectedError(barrierError);
			clearTimeout(startTimeout);
			this._onDidExit.fire([ExtensionHostExitCode.UnexpectedError, barrierError.message]);
			barrier.open();
		};

		const resolveBarrier = (messagePort: MessagePort) => {
			port = messagePort;
			clearTimeout(startTimeout);
			barrier.open();
		};

		startTimeout = setTimeout(() => {
			console.warn(`The Web Worker Extension Host did not start in 60s, that might be a problem.`);
		}, 60000);

		this._register(dom.addDisposableListener(window, 'message', (event) => {
			if (event.source !== iframe.contentWindow) {
				return;
			}
			if (event.data.vscodeWebWorkerExtHostId !== vscodeWebWorkerExtHostId) {
				return;
			}
			if (event.data.error) {
				const { name, message, stack } = event.data.error;
				const err = new Error();
				err.message = message;
				err.name = name;
				err.stack = stack;
				return rejectBarrier(ExtensionHostExitCode.UnexpectedError, err);
			}
			const { data } = event.data;
			if (barrier.isOpen() || !(data instanceof MessagePort)) {
				console.warn('UNEXPECTED message', event);
				const err = new Error('UNEXPECTED message');
				return rejectBarrier(ExtensionHostExitCode.UnexpectedError, err);
			}
			resolveBarrier(data);
		}));

		this._layoutService.container.appendChild(iframe);
		this._register(toDisposable(() => iframe.remove()));

		// await MessagePort and use it to directly communicate
		// with the worker extension host
		await barrier.wait();

		if (barrierHasError) {
			throw barrierError;
		}

		port.onmessage = (event) => {
			const { data } = event;
			if (!(data instanceof ArrayBuffer)) {
				console.warn('UNKNOWN data received', data);
				this._onDidExit.fire([77, 'UNKNOWN data received']);
				return;
			}
			emitter.fire(VSBuffer.wrap(new Uint8Array(data, 0, data.byteLength)));
		};

		const protocol: IMessagePassingProtocol = {
			onMessage: emitter.event,
			send: vsbuf => {
				const data = vsbuf.buffer.buffer.slice(vsbuf.buffer.byteOffset, vsbuf.buffer.byteOffset + vsbuf.buffer.byteLength);
				port.postMessage(data, [data]);
			}
		};

		return this._performHandshake(protocol);
	}

	private async _startOutsideIframe(): Promise<IMessagePassingProtocol> {
		const emitter = new Emitter<VSBuffer>();

		const url = getWorkerBootstrapUrl(FileAccess.asBrowserUri('../worker/extensionHostWorkerMain.js', require).toString(true), 'WorkerExtensionHost');
		const worker = new Worker(ttPolicy?.createScriptURL(url) as unknown as string ?? url, { name: 'WorkerExtensionHost' });

		const barrier = new Barrier();
		let port!: MessagePort;

		const nestedWorker = new Map<string, Worker>();

		worker.onmessage = (event) => {

			const data: MessagePort | NewWorkerMessage | TerminateWorkerMessage = event.data;

			if (data instanceof MessagePort) {
				// receiving a message port which is used to communicate
				// with the web worker extension host
				if (barrier.isOpen()) {
					console.warn('UNEXPECTED message', event);
					this._onDidExit.fire([ExtensionHostExitCode.UnexpectedError, 'received a message port AFTER opening the barrier']);
					return;
				}
				port = data;
				barrier.open();


			} else if (data?.type === '_newWorker') {
				// receiving a message to create a new nested/child worker
				const worker = new Worker((ttPolicyNestedWorker?.createScriptURL(data.url) ?? data.url) as string, data.options);
				worker.postMessage(data.port, [data.port]);
				worker.onerror = console.error.bind(console);
				nestedWorker.set(data.id, worker);

			} else if (data?.type === '_terminateWorker') {
				// receiving a message to terminate nested/child worker
				if (nestedWorker.has(data.id)) {
					nestedWorker.get(data.id)!.terminate();
					nestedWorker.delete(data.id);
				}

			} else {
				// all other messages are an error
				console.warn('UNEXPECTED message', event);
				this._onDidExit.fire([ExtensionHostExitCode.UnexpectedError, 'UNEXPECTED message']);
			}
		};

		// await MessagePort and use it to directly communicate
		// with the worker extension host
		await barrier.wait();

		port.onmessage = (event) => {
			const { data } = event;
			if (!(data instanceof ArrayBuffer)) {
				console.warn('UNKNOWN data received', data);
				this._onDidExit.fire([77, 'UNKNOWN data received']);
				return;
			}

			emitter.fire(VSBuffer.wrap(new Uint8Array(data, 0, data.byteLength)));
		};

		worker.onerror = (event) => {
			console.error(event.message, event.error);
			this._onDidExit.fire([ExtensionHostExitCode.UnexpectedError, event.message || event.error]);
		};

		// keep for cleanup
		this._register(emitter);
		this._register(toDisposable(() => worker.terminate()));

		const protocol: IMessagePassingProtocol = {
			onMessage: emitter.event,
			send: vsbuf => {
				const data = vsbuf.buffer.buffer.slice(vsbuf.buffer.byteOffset, vsbuf.buffer.byteOffset + vsbuf.buffer.byteLength);
				port.postMessage(data, [data]);
			}
		};

		return this._performHandshake(protocol);
	}

	private async _performHandshake(protocol: IMessagePassingProtocol): Promise<IMessagePassingProtocol> {
		// extension host handshake happens below
		// (1) <== wait for: Ready
		// (2) ==> send: init data
		// (3) <== wait for: Initialized

		await Event.toPromise(Event.filter(protocol.onMessage, msg => isMessageOfType(msg, MessageType.Ready)));
		if (this._isTerminating) {
			throw canceled();
		}
		protocol.send(VSBuffer.fromString(JSON.stringify(await this._createExtHostInitData())));
		if (this._isTerminating) {
			throw canceled();
		}
		await Event.toPromise(Event.filter(protocol.onMessage, msg => isMessageOfType(msg, MessageType.Initialized)));
		if (this._isTerminating) {
			throw canceled();
		}

		// Register log channel for web worker exthost log
		Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).registerChannel({ id: 'webWorkerExtHostLog', label: localize('name', "Worker Extension Host"), file: this._extensionHostLogFile, log: true });

		return protocol;
	}

	public override dispose(): void {
		if (this._isTerminating) {
			return;
		}
		this._isTerminating = true;
		if (this._protocol) {
			this._protocol.send(createMessageOfType(MessageType.Terminate));
		}
		super.dispose();
	}

	getInspectPort(): number | undefined {
		return undefined;
	}

	enableInspectPort(): Promise<boolean> {
		return Promise.resolve(false);
	}

	private async _createExtHostInitData(): Promise<IInitData> {
		const [telemetryInfo, initData] = await Promise.all([this._telemetryService.getTelemetryInfo(), this._initDataProvider.getInitData()]);
		const workspace = this._contextService.getWorkspace();
		return {
			commit: this._productService.commit,
			version: this._productService.version,
			parentPid: -1,
			environment: {
				isExtensionDevelopmentDebug: this._environmentService.debugRenderer,
				appName: this._productService.nameLong,
				appUriScheme: this._productService.urlProtocol,
				appLanguage: platform.language,
				extensionDevelopmentLocationURI: this._environmentService.extensionDevelopmentLocationURI,
				extensionTestsLocationURI: this._environmentService.extensionTestsLocationURI,
				globalStorageHome: this._environmentService.globalStorageHome,
				workspaceStorageHome: this._environmentService.workspaceStorageHome,
				webviewResourceRoot: this._environmentService.webviewResourceRoot,
				webviewCspSource: this._environmentService.webviewCspSource,
			},
			workspace: this._contextService.getWorkbenchState() === WorkbenchState.EMPTY ? undefined : {
				configuration: workspace.configuration || undefined,
				id: workspace.id,
				name: this._labelService.getWorkspaceLabel(workspace)
			},
			resolvedExtensions: [],
			hostExtensions: [],
			extensions: initData.extensions,
			telemetryInfo,
			logLevel: this._logService.getLevel(),
			logsLocation: this._extensionHostLogsLocation,
			logFile: this._extensionHostLogFile,
			autoStart: initData.autoStart,
			remote: {
				authority: this._environmentService.remoteAuthority,
				connectionData: null,
				isRemote: false
			},
			uiKind: platform.isWeb ? UIKind.Web : UIKind.Desktop
		};
	}
}
