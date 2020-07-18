/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from 'vs/base/common/arrays';
import { streamToBuffer } from 'vs/base/common/buffer';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { URI, UriComponents } from 'vs/base/common/uri';
import { createChannelSender } from 'vs/base/parts/ipc/common/ipc';
import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import * as modes from 'vs/editor/common/modes';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { IFileService } from 'vs/platform/files/common/files';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { ILogService } from 'vs/platform/log/common/log';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IRequestService } from 'vs/platform/request/common/request';
import { loadLocalResource, WebviewResourceResponse } from 'vs/platform/webview/common/resourceLoader';
import { IWebviewManagerService } from 'vs/platform/webview/common/webviewManagerService';
import { WebviewContentOptions, WebviewExtensionDescription } from 'vs/workbench/contrib/webview/browser/webview';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

/**
 * Try to rewrite `vscode-resource:` urls in html
 */
export function rewriteVsCodeResourceUrls(
	id: string,
	html: string,
): string {
	return html
		.replace(/(["'])vscode-resource:(\/\/([^\s\/'"]+?)(?=\/))?([^\s'"]+?)(["'])/gi, (_match, startQuote, _1, scheme, path, endQuote) => {
			if (scheme) {
				return `${startQuote}${Schemas.vscodeWebviewResource}://${id}/${scheme}${path}${endQuote}`;
			}
			if (!path.startsWith('//')) {
				// Add an empty authority if we don't already have one
				path = '//' + path;
			}
			return `${startQuote}${Schemas.vscodeWebviewResource}://${id}/file${path}${endQuote}`;
		});
}

/**
 * Manages the loading of resources inside of a webview.
 */
export class WebviewResourceRequestManager extends Disposable {

	private readonly _webviewManagerService: IWebviewManagerService;

	private _localResourceRoots: ReadonlyArray<URI>;
	private _portMappings: ReadonlyArray<modes.IWebviewPortMapping>;

	private _ready: Promise<void>;

	constructor(
		private readonly id: string,
		private readonly extension: WebviewExtensionDescription | undefined,
		initialContentOptions: WebviewContentOptions,
		getWebContentsId: Promise<number | undefined>,
		@ILogService private readonly _logService: ILogService,
		@IRemoteAuthorityResolverService remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IMainProcessService mainProcessService: IMainProcessService,
		@IElectronService electronService: IElectronService,
		@IFileService fileService: IFileService,
		@IRequestService requestService: IRequestService,
	) {
		super();

		this._logService.debug(`WebviewResourceRequestManager(${this.id}): init`);

		this._webviewManagerService = createChannelSender<IWebviewManagerService>(mainProcessService.getChannel('webview'));

		this._localResourceRoots = initialContentOptions.localResourceRoots || [];
		this._portMappings = initialContentOptions.portMapping || [];

		const remoteAuthority = environmentService.configuration.remoteAuthority;
		const remoteConnectionData = remoteAuthority ? remoteAuthorityResolverService.getConnectionData(remoteAuthority) : null;

		this._ready = getWebContentsId.then(async (webContentsId) => {
			this._logService.debug(`WebviewResourceRequestManager(${this.id}): did-start-loading`);
			await this._webviewManagerService.registerWebview(this.id, webContentsId, electronService.windowId, {
				extensionLocation: this.extension?.location.toJSON(),
				localResourceRoots: this._localResourceRoots.map(x => x.toJSON()),
				remoteConnectionData: remoteConnectionData,
				portMappings: this._portMappings,
			});

			this._logService.debug(`WebviewResourceRequestManager(${this.id}): did register`);
		});

		if (remoteAuthority) {
			this._register(remoteAuthorityResolverService.onDidChangeConnectionData(() => {
				const update = this._webviewManagerService.updateWebviewMetadata(this.id, {
					remoteConnectionData: remoteAuthority ? remoteAuthorityResolverService.getConnectionData(remoteAuthority) : null,
				});
				this._ready = this._ready.then(() => update);
			}));
		}

		this._register(toDisposable(() => this._webviewManagerService.unregisterWebview(this.id)));

		const loadResourceChannel = `vscode:loadWebviewResource-${id}`;
		const loadResourceListener = async (_event: any, requestId: number, resource: UriComponents) => {
			try {
				const response = await loadLocalResource(URI.revive(resource), {
					extensionLocation: this.extension?.location,
					roots: this._localResourceRoots,
					remoteConnectionData: remoteConnectionData,
				}, {
					readFileStream: (resource) => fileService.readFileStream(resource).then(x => x.value),
				}, requestService);

				if (response.type === WebviewResourceResponse.Type.Success) {
					const buffer = await streamToBuffer(response.stream);
					return this._webviewManagerService.didLoadResource(requestId, buffer);
				}
			} catch {
				// Noop
			}
			this._webviewManagerService.didLoadResource(requestId, undefined);
		};

		ipcRenderer.on(loadResourceChannel, loadResourceListener);
		this._register(toDisposable(() => ipcRenderer.removeListener(loadResourceChannel, loadResourceListener)));
	}

	public update(options: WebviewContentOptions) {
		const localResourceRoots = options.localResourceRoots || [];
		const portMappings = options.portMapping || [];

		if (!this.needsUpdate(localResourceRoots, portMappings)) {
			return;
		}

		this._localResourceRoots = localResourceRoots;
		this._portMappings = portMappings;

		this._logService.debug(`WebviewResourceRequestManager(${this.id}): will update`);

		const update = this._webviewManagerService.updateWebviewMetadata(this.id, {
			localResourceRoots: localResourceRoots.map(x => x.toJSON()),
			portMappings: portMappings,
		}).then(() => {
			this._logService.debug(`WebviewResourceRequestManager(${this.id}): did update`);
		});

		this._ready = this._ready.then(() => update);
	}

	private needsUpdate(
		localResourceRoots: readonly URI[],
		portMappings: readonly modes.IWebviewPortMapping[],
	): boolean {
		return !(
			equals(this._localResourceRoots, localResourceRoots, (a, b) => a.toString() === b.toString())
			&& equals(this._portMappings, portMappings, (a, b) => a.extensionHostPort === b.extensionHostPort && a.webviewPort === b.webviewPort)
		);
	}

	public ensureReady(): Promise<void> {
		return this._ready;
	}
}
