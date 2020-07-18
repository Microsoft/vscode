/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResolvedAuthority, IRemoteAuthorityResolverService, ResolverResult, IRemoteConnectionData } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { RemoteAuthorities } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';

export class RemoteAuthorityResolverService extends Disposable implements IRemoteAuthorityResolverService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConnectionData = this._register(new Emitter<void>());
	public readonly onDidChangeConnectionData = this._onDidChangeConnectionData.event;

	private readonly _cache: Map<string, ResolverResult>;
	private readonly _connectionTokens: Map<string, string>;

	constructor(resourceUriProvider: ((uri: URI) => URI) | undefined) {
		super();
		this._cache = new Map<string, ResolverResult>();
		this._connectionTokens = new Map<string, string>();
		if (resourceUriProvider) {
			RemoteAuthorities.setDelegate(resourceUriProvider);
		}
	}

	async resolveAuthority(authority: string): Promise<ResolverResult> {
		if (!this._cache.has(authority)) {
			const result = this._doResolveAuthority(authority);
			RemoteAuthorities.set(authority, result.authority.host, result.authority.port);
			this._cache.set(authority, result);
			this._onDidChangeConnectionData.fire();
		}
		return this._cache.get(authority)!;
	}

	getConnectionData(authority: string): IRemoteConnectionData | null {
		if (!this._cache.has(authority)) {
			return null;
		}
		const resolverResult = this._cache.get(authority)!;
		const connectionToken = this._connectionTokens.get(authority);
		return {
			host: resolverResult.authority.host,
			port: resolverResult.authority.port,
			connectionToken: connectionToken
		};
	}

	private _doResolveAuthority(authority: string): ResolverResult {
		if (authority.indexOf(':') >= 0) {
			const pieces = authority.split(':');
			return { authority: { authority, host: pieces[0], port: parseInt(pieces[1], 10) } };
		}
		return { authority: { authority, host: authority, port: 80 } };
	}

	_clearResolvedAuthority(authority: string): void {
	}

	_setResolvedAuthority(resolvedAuthority: ResolvedAuthority) {
	}

	_setResolvedAuthorityError(authority: string, err: any): void {
	}

	_setAuthorityConnectionToken(authority: string, connectionToken: string): void {
		this._connectionTokens.set(authority, connectionToken);
		RemoteAuthorities.setConnectionToken(authority, connectionToken);
		this._onDidChangeConnectionData.fire();
	}
}
