/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { session } from 'electron';
import { ILogService } from 'vs/platform/log/common/log';
import { TernarySearchTree } from 'vs/base/common/map';
import { isLinux } from 'vs/base/common/platform';
import { IWindowsMainService } from 'vs/platform/windows/electron-main/windows';

type ProtocolCallback = { (result: string | Electron.FilePathWithHeaders | { error: number }): void };

export class FileProtocolHandler extends Disposable {

	private readonly validRoots = TernarySearchTree.forUris<boolean>(() => !isLinux);

	constructor(
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		const { defaultSession } = session;

		// Define an initial set of roots we allow loading from
		// - appRoot	: all files installed as part of the app
		// - extensions : all files shipped from extensions
		this.validRoots.set(URI.file(environmentService.appRoot), true);
		this.validRoots.set(URI.file(environmentService.extensionsPath), true);

		// Register vscode-file:// handler
		defaultSession.protocol.registerFileProtocol(Schemas.vscodeFileResource, (request, callback) => this.handleResourceRequest(request, callback as unknown as ProtocolCallback));

		// Block any file:// access (sandbox only)
		if (environmentService.args.__sandbox) {
			defaultSession.protocol.interceptFileProtocol(Schemas.file, (request, callback) => this.handleFileRequest(request, callback as unknown as ProtocolCallback));
		}

		// Cleanup
		this._register(toDisposable(() => {
			defaultSession.protocol.unregisterProtocol(Schemas.vscodeFileResource);
			if (environmentService.args.__sandbox) {
				defaultSession.protocol.uninterceptProtocol(Schemas.file);
			}
		}));
	}

	injectWindowsMainService(windowsMainService: IWindowsMainService): void {
		this._register(windowsMainService.onWindowReady(window => {
			if (window.config?.extensionDevelopmentPath || window.config?.extensionTestsPath) {
				const disposables = new DisposableStore();
				disposables.add(Event.any(window.onClose, window.onDestroy)(() => disposables.dispose()));

				// Allow access to extension development path
				if (window.config.extensionDevelopmentPath) {
					for (const extensionDevelopmentPath of window.config.extensionDevelopmentPath) {
						disposables.add(this.addValidRoot(URI.file(extensionDevelopmentPath)));
					}
				}

				// Allow access to extension tests path
				if (window.config.extensionTestsPath) {
					disposables.add(this.addValidRoot(URI.file(window.config.extensionTestsPath)));
				}
			}
		}));
	}

	private addValidRoot(root: URI): IDisposable {
		if (!this.validRoots.get(root)) {
			this.validRoots.set(root, true);

			return toDisposable(() => this.validRoots.delete(root));
		}

		return Disposable.None;
	}

	private async handleFileRequest(request: Electron.ProtocolRequest, callback: ProtocolCallback) {
		const uri = URI.parse(request.url);

		this.logService.error(`Refused to load resource ${uri.fsPath} from ${Schemas.file}: protocol`);
		callback({ error: -3 /* ABORTED */ });
	}

	private async handleResourceRequest(request: Electron.ProtocolRequest, callback: ProtocolCallback) {
		const uri = URI.parse(request.url);

		// Restore the `vscode-file` URI to a `file` URI so that we can
		// ensure the root is valid and properly tell Chrome where the
		// resource is at.
		const fileUri = FileAccess.asFileUri(uri);
		if (this.validRoots.findSubstr(fileUri)) {
			return callback({
				path: fileUri.fsPath
			});
		}

		this.logService.error(`${Schemas.vscodeFileResource}: Refused to load resource ${fileUri.fsPath}}`);
		callback({ error: -3 /* ABORTED */ });
	}
}
