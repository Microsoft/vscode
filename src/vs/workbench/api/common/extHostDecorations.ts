/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { URI } from 'vs/base/common/uri';
import { MainContext, ExtHostDecorationsShape, MainThreadDecorationsShape, DecorationData, DecorationRequest, DecorationReply } from 'vs/workbench/api/common/extHost.protocol';
import { Disposable, FileDecoration } from 'vs/workbench/api/common/extHostTypes';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { ILogService } from 'vs/platform/log/common/log';
import { asArray, groupBy } from 'vs/base/common/arrays';
import { compare, count } from 'vs/base/common/strings';
import { dirname } from 'vs/base/common/path';

interface ProviderData {
	provider: vscode.FileDecorationProvider;
	extensionId: ExtensionIdentifier;
}

export class ExtHostDecorations implements ExtHostDecorationsShape {

	private static _handlePool = 0;
	private static _maxEventSize = 250;

	readonly _serviceBrand: undefined;
	private readonly _provider = new Map<number, ProviderData>();
	private readonly _proxy: MainThreadDecorationsShape;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@ILogService private readonly _logService: ILogService,
	) {
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadDecorations);
	}

	registerFileDecorationProvider(provider: vscode.FileDecorationProvider, extensionId: ExtensionIdentifier): vscode.Disposable {
		const handle = ExtHostDecorations._handlePool++;
		this._provider.set(handle, { provider, extensionId });
		this._proxy.$registerDecorationProvider(handle, extensionId.value);

		const listener = provider.onDidChangeFileDecorations && provider.onDidChangeFileDecorations(e => {
			if (!e) {
				this._proxy.$onDidChange(handle, null);
				return;
			}
			let array = asArray(e);
			if (array.length <= ExtHostDecorations._maxEventSize) {
				this._proxy.$onDidChange(handle, array);
				return;
			}

			// too many resources per event. pick one resource per folder, starting
			// with parent folders
			this._logService.warn('[Decorations] CAPPING events from decorations provider', extensionId.value, array.length);
			const mapped = array.map(uri => ({ uri, rank: count(uri.path, '/') }));
			const groups = groupBy(mapped, (a, b) => a.rank - b.rank || compare(a.uri.path, b.uri.path));
			let picked: URI[] = [];
			outer: for (let uris of groups) {
				let lastDirname: string | undefined;
				for (let obj of uris) {
					let myDirname = dirname(obj.uri.path);
					if (lastDirname !== myDirname) {
						lastDirname = myDirname;
						if (picked.push(obj.uri) >= ExtHostDecorations._maxEventSize) {
							break outer;
						}
					}
				}
			}
			this._proxy.$onDidChange(handle, picked);
		});

		return new Disposable(() => {
			listener?.dispose();
			this._proxy.$unregisterDecorationProvider(handle);
			this._provider.delete(handle);
		});
	}

	async $provideDecorations(handle: number, requests: DecorationRequest[], token: CancellationToken): Promise<DecorationReply> {

		if (!this._provider.has(handle)) {
			// might have been unregistered in the meantime
			return Object.create(null);
		}

		const result: DecorationReply = Object.create(null);
		const { provider, extensionId } = this._provider.get(handle)!;

		await Promise.all(requests.map(async request => {
			try {
				const { uri, id } = request;
				const data = await Promise.resolve(provider.provideFileDecoration(URI.revive(uri), token));
				if (!data) {
					return;
				}
				try {
					FileDecoration.validate(data);
					result[id] = <DecorationData>[data.propagate, data.tooltip, data.badge, data.color];
				} catch (e) {
					this._logService.warn(`INVALID decoration from extension '${extensionId.value}': ${e}`);
				}
			} catch (err) {
				this._logService.error(err);
			}
		}));

		return result;
	}
}

export const IExtHostDecorations = createDecorator<IExtHostDecorations>('IExtHostDecorations');
export interface IExtHostDecorations extends ExtHostDecorations { }
