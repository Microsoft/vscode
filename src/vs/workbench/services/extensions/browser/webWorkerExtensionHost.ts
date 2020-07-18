/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWorkerBootstrapUrl } from 'vs/base/worker/defaultWorkerFactory';
import { Emitter, Event } from 'vs/base/common/event';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { IMessagePassingProtocol } from 'vs/base/parts/ipc/common/ipc';
import { VSBuffer } from 'vs/base/common/buffer';
import { createMessageOfType, MessageType, isMessageOfType } from 'vs/workbench/services/extensions/common/extensionHostProtocol';
import { IInitData, UIKind } from 'vs/workbench/api/common/extHost.protocol';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { ILabelService } from 'vs/platform/label/common/label';
import { ILogService } from 'vs/platform/log/common/log';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import * as platform from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { IExtensionHost, ExtensionHostLogFileName, ExtensionHostKind } from 'vs/workbench/services/extensions/common/extensions';
import { IProductService } from 'vs/platform/product/common/productService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { joinPath } from 'vs/base/common/resources';
import { Registry } from 'vs/platform/registry/common/platform';
import { IOutputChannelRegistry, Extensions } from 'vs/workbench/services/output/common/output';
import { localize } from 'vs/nls';

export interface IWebWorkerExtensionHostInitData {
	readonly autoStart: boolean;
	readonly extensions: IExtensionDescription[];
}

export interface IWebWorkerExtensionHostDataProvider {
	getInitData(): Promise<IWebWorkerExtensionHostInitData>;
}

export class WebWorkerExtensionHost implements IExtensionHost {

	public readonly kind = ExtensionHostKind.LocalWebWorker;
	public readonly remoteAuthority = null;

	private _toDispose = new DisposableStore();
	private _isTerminating: boolean = false;
	private _protocol?: IMessagePassingProtocol;

	private readonly _onDidExit = new Emitter<[number, string | null]>();
	readonly onExit: Event<[number, string | null]> = this._onDidExit.event;

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
	) {
		this._extensionHostLogsLocation = URI.file(this._environmentService.logsPath).with({ scheme: this._environmentService.logFile.scheme });
		this._extensionHostLogFile = joinPath(this._extensionHostLogsLocation, `${ExtensionHostLogFileName}.log`);
	}

	async start(): Promise<IMessagePassingProtocol> {

		if (!this._protocol) {

			const emitter = new Emitter<VSBuffer>();

			const url = getWorkerBootstrapUrl(require.toUrl('../worker/extensionHostWorkerMain.js'), 'WorkerExtensionHost');
			const worker = new Worker(url, { name: 'WorkerExtensionHost' });

			worker.onmessage = (event) => {
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
				this._onDidExit.fire([81, event.message || event.error]);
			};

			// keep for cleanup
			this._toDispose.add(emitter);
			this._toDispose.add(toDisposable(() => worker.terminate()));

			const protocol: IMessagePassingProtocol = {
				onMessage: emitter.event,
				send: vsbuf => {
					const data = vsbuf.buffer.buffer.slice(vsbuf.buffer.byteOffset, vsbuf.buffer.byteOffset + vsbuf.buffer.byteLength);
					worker.postMessage(data, [data]);
				}
			};

			// extension host handshake happens below
			// (1) <== wait for: Ready
			// (2) ==> send: init data
			// (3) <== wait for: Initialized

			await Event.toPromise(Event.filter(protocol.onMessage, msg => isMessageOfType(msg, MessageType.Ready)));
			protocol.send(VSBuffer.fromString(JSON.stringify(await this._createExtHostInitData())));
			await Event.toPromise(Event.filter(protocol.onMessage, msg => isMessageOfType(msg, MessageType.Initialized)));

			// Register log channel for web worker exthost log
			Registry.as<IOutputChannelRegistry>(Extensions.OutputChannels).registerChannel({ id: 'webWorkerExtHostLog', label: localize('name', "Worker Extension Host"), file: this._extensionHostLogFile, log: true });

			this._protocol = protocol;
		}
		return this._protocol;

	}

	dispose(): void {
		if (!this._protocol) {
			this._toDispose.dispose();
			return;
		}
		if (this._isTerminating) {
			return;
		}
		this._isTerminating = true;
		this._protocol.send(createMessageOfType(MessageType.Terminate));
		setTimeout(() => this._toDispose.dispose(), 10 * 1000);
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
				isExtensionDevelopmentDebug: false, //todo@jrieken web
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
				authority: this._environmentService.configuration.remoteAuthority,
				connectionData: null,
				isRemote: false
			},
			uiKind: platform.isWeb ? UIKind.Web : UIKind.Desktop
		};
	}
}
