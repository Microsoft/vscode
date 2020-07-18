/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResolvedAuthority, IRemoteAuthorityResolverService, ResolverResult, ResolvedOptions, IRemoteConnectionData } from 'vs/platform/remote/common/remoteAuthorityResolver';
import * as errors from 'vs/base/common/errors';
import { RemoteAuthorities } from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';

class PendingResolveAuthorityRequest {

	public value: ResolverResult | null;

	constructor(
		private readonly _resolve: (value: ResolverResult) => void,
		private readonly _reject: (err: any) => void,
		public readonly promise: Promise<ResolverResult>,
	) {
		this.value = null;
	}

	resolve(value: ResolverResult): void {
		this.value = value;
		this._resolve(this.value);
	}

	reject(err: any): void {
		this._reject(err);
	}
}

export class RemoteAuthorityResolverService extends Disposable implements IRemoteAuthorityResolverService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeConnectionData = this._register(new Emitter<void>());
	public readonly onDidChangeConnectionData = this._onDidChangeConnectionData.event;

	private readonly _resolveAuthorityRequests: Map<string, PendingResolveAuthorityRequest>;
	private readonly _connectionTokens: Map<string, string>;

	constructor() {
		super();
		this._resolveAuthorityRequests = new Map<string, PendingResolveAuthorityRequest>();
		this._connectionTokens = new Map<string, string>();
	}

	resolveAuthority(authority: string): Promise<ResolverResult> {
		if (!this._resolveAuthorityRequests.has(authority)) {
			let resolve: (value: ResolverResult) => void;
			let reject: (err: any) => void;
			const promise = new Promise<ResolverResult>((_resolve, _reject) => {
				resolve = _resolve;
				reject = _reject;
			});
			this._resolveAuthorityRequests.set(authority, new PendingResolveAuthorityRequest(resolve!, reject!, promise));
		}
		return this._resolveAuthorityRequests.get(authority)!.promise;
	}

	getConnectionData(authority: string): IRemoteConnectionData | null {
		if (!this._resolveAuthorityRequests.has(authority)) {
			return null;
		}
		const request = this._resolveAuthorityRequests.get(authority)!;
		if (!request.value) {
			return null;
		}
		const connectionToken = this._connectionTokens.get(authority);
		return {
			host: request.value.authority.host,
			port: request.value.authority.port,
			connectionToken: connectionToken
		};
	}

	_clearResolvedAuthority(authority: string): void {
		if (this._resolveAuthorityRequests.has(authority)) {
			this._resolveAuthorityRequests.get(authority)!.reject(errors.canceled());
			this._resolveAuthorityRequests.delete(authority);
		}
	}

	_setResolvedAuthority(resolvedAuthority: ResolvedAuthority, options?: ResolvedOptions): void {
		if (this._resolveAuthorityRequests.has(resolvedAuthority.authority)) {
			const request = this._resolveAuthorityRequests.get(resolvedAuthority.authority)!;
			RemoteAuthorities.set(resolvedAuthority.authority, resolvedAuthority.host, resolvedAuthority.port);
			request.resolve({ authority: resolvedAuthority, options });
			this._onDidChangeConnectionData.fire();
		}
	}

	_setResolvedAuthorityError(authority: string, err: any): void {
		if (this._resolveAuthorityRequests.has(authority)) {
			const request = this._resolveAuthorityRequests.get(authority)!;
			request.reject(err);
		}
	}

	_setAuthorityConnectionToken(authority: string, connectionToken: string): void {
		this._connectionTokens.set(authority, connectionToken);
		RemoteAuthorities.setConnectionToken(authority, connectionToken);
		this._onDidChangeConnectionData.fire();
	}
}
