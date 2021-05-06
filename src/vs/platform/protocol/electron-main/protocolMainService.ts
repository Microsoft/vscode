/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { ipcMain, session } from 'electron';
import { ILogService } from 'vs/platform/log/common/log';
import { TernarySearchTree } from 'vs/base/common/map';
import { isLinux, isPreferringBrowserCodeLoad } from 'vs/base/common/platform';
import { extname } from 'vs/base/common/resources';
import { IIPCObjectUrl, IProtocolMainService } from 'vs/platform/protocol/electron-main/protocol';
import { generateUuid } from 'vs/base/common/uuid';

type ProtocolCallback = { (result: string | Electron.FilePathWithHeaders | { error: number }): void };

export class ProtocolMainService extends Disposable implements IProtocolMainService {

	declare readonly _serviceBrand: undefined;

	private readonly validRoots = TernarySearchTree.forUris<boolean>(() => !isLinux);
	private readonly validExtensions = new Set(['.png', '.jpg', '.jpeg', '.gif', '.bmp']); // https://github.com/microsoft/vscode/issues/119384

	constructor(
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Define an initial set of roots we allow loading from
		// - appRoot	: all files installed as part of the app
		// - extensions : all files shipped from extensions
		// - storage    : all files in global and workspace storage (https://github.com/microsoft/vscode/issues/116735)
		this.addValidFileRoot(URI.file(environmentService.appRoot));
		this.addValidFileRoot(URI.file(environmentService.extensionsPath));
		this.addValidFileRoot(environmentService.globalStorageHome);
		this.addValidFileRoot(environmentService.workspaceStorageHome);

		// Handle protocols
		this.handleProtocols();
	}

	private handleProtocols(): void {
		const { defaultSession } = session;

		// Register vscode-file:// handler
		defaultSession.protocol.registerFileProtocol(Schemas.vscodeFileResource, (request, callback) => this.handleResourceRequest(request, callback as unknown as ProtocolCallback));

		// Intercept any file:// access
		defaultSession.protocol.interceptFileProtocol(Schemas.file, (request, callback) => this.handleFileRequest(request, callback as unknown as ProtocolCallback));

		// Cleanup
		this._register(toDisposable(() => {
			defaultSession.protocol.unregisterProtocol(Schemas.vscodeFileResource);
			defaultSession.protocol.uninterceptProtocol(Schemas.file);
		}));
	}

	addValidFileRoot(root: URI): IDisposable {
		if (!this.validRoots.get(root)) {
			this.validRoots.set(root, true);

			return toDisposable(() => this.validRoots.delete(root));
		}

		return Disposable.None;
	}

	//#region file://

	private handleFileRequest(request: Electron.ProtocolRequest, callback: ProtocolCallback): void {
		const fileUri = URI.parse(request.url);

		// isPreferringBrowserCodeLoad: false
		if (!isPreferringBrowserCodeLoad) {

			// first check by validRoots
			if (this.validRoots.findSubstr(fileUri)) {
				return callback({
					path: fileUri.fsPath
				});
			}

			// then check by validExtensions
			if (this.validExtensions.has(extname(fileUri))) {
				return callback({
					path: fileUri.fsPath
				});
			}

			// finally block to load the resource
			this.logService.error(`${Schemas.file}: Refused to load resource ${fileUri.fsPath} from ${Schemas.file}: protocol (original URL: ${request.url})`);

			return callback({ error: -3 /* ABORTED */ });
		}

		// isPreferringBrowserCodeLoad: true
		// => block any file request
		else {
			this.logService.error(`Refused to load resource ${fileUri.fsPath} from ${Schemas.file}: protocol (original URL: ${request.url})`);

			return callback({ error: -3 /* ABORTED */ });
		}
	}

	//#endregion

	//#region vscode-file://

	private handleResourceRequest(request: Electron.ProtocolRequest, callback: ProtocolCallback): void {
		const uri = URI.parse(request.url);

		// Restore the `vscode-file` URI to a `file` URI so that we can
		// ensure the root is valid and properly tell Chrome where the
		// resource is at.
		const fileUri = FileAccess.asFileUri(uri);

		// first check by validRoots
		if (this.validRoots.findSubstr(fileUri)) {
			return callback({
				path: fileUri.fsPath
			});
		}

		// then check by validExtensions
		if (this.validExtensions.has(extname(fileUri))) {
			return callback({
				path: fileUri.fsPath
			});
		}

		// finally block to load the resource
		this.logService.error(`${Schemas.vscodeFileResource}: Refused to load resource ${fileUri.fsPath} from ${Schemas.vscodeFileResource}: protocol (original URL: ${request.url})`);

		return callback({ error: -3 /* ABORTED */ });
	}

	//#endregion

	//#region IPC Object URLs

	createIPCObjectUrl<T>(): IIPCObjectUrl<T> {
		let obj: T | undefined = undefined;

		// Create unique URI
		const resource = URI.from({
			scheme: 'vscode', // used for all our IPC communication (vscode:<channel>)
			path: generateUuid()
		});

		// Install IPC handler
		const channel = resource.toString();
		const handler = async (): Promise<T | undefined> => obj;
		ipcMain.handle(channel, handler);

		this.logService.trace(`IPC Object URL: Registered new channel ${channel}.`);

		return {
			resource,
			update: updatedObj => obj = updatedObj,
			dispose: () => {
				this.logService.trace(`IPC Object URL: Removed channel ${channel}.`);

				ipcMain.removeHandler(channel);
			}
		};
	}

	//#endregion
}
