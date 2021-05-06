/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IRemoteAuthorityResolverService = createDecorator<IRemoteAuthorityResolverService>('remoteAuthorityResolverService');

export interface ResolvedAuthority {
	readonly authority: string;
	readonly host: string;
	readonly port: number;
	readonly connectionToken: string | undefined;
}

export enum RemoteTrustOption {
	Unknown = 0,
	DisableTrust = 1,
	MachineTrusted = 2
}

export interface ResolvedOptions {
	readonly extensionHostEnv?: { [key: string]: string | null };
	readonly trust?: RemoteTrustOption;
}

export interface TunnelDescription {
	remoteAddress: { port: number, host: string };
	localAddress: { port: number, host: string } | string;
}
export interface TunnelInformation {
	environmentTunnels?: TunnelDescription[];
}

export interface ResolverResult {
	authority: ResolvedAuthority;
	options?: ResolvedOptions;
	tunnelInformation?: TunnelInformation;
}

export interface IRemoteConnectionData {
	host: string;
	port: number;
	connectionToken: string | undefined;
}

export enum RemoteAuthorityResolverErrorCode {
	Unknown = 'Unknown',
	NotAvailable = 'NotAvailable',
	TemporarilyNotAvailable = 'TemporarilyNotAvailable',
	NoResolverFound = 'NoResolverFound'
}

export class RemoteAuthorityResolverError extends Error {

	public static isTemporarilyNotAvailable(err: any): boolean {
		return (err instanceof RemoteAuthorityResolverError) && err._code === RemoteAuthorityResolverErrorCode.TemporarilyNotAvailable;
	}

	public static isNoResolverFound(err: any): err is RemoteAuthorityResolverError {
		return (err instanceof RemoteAuthorityResolverError) && err._code === RemoteAuthorityResolverErrorCode.NoResolverFound;
	}

	public static isHandled(err: any): boolean {
		return (err instanceof RemoteAuthorityResolverError) && err.isHandled;
	}

	public readonly _message: string | undefined;
	public readonly _code: RemoteAuthorityResolverErrorCode;
	public readonly _detail: any;

	public isHandled: boolean;

	constructor(message?: string, code: RemoteAuthorityResolverErrorCode = RemoteAuthorityResolverErrorCode.Unknown, detail?: any) {
		super(message);

		this._message = message;
		this._code = code;
		this._detail = detail;

		this.isHandled = (code === RemoteAuthorityResolverErrorCode.NotAvailable) && detail === true;

		// workaround when extending builtin objects and when compiling to ES5, see:
		// https://github.com/microsoft/TypeScript-wiki/blob/master/Breaking-Changes.md#extending-built-ins-like-error-array-and-map-may-no-longer-work
		if (typeof (<any>Object).setPrototypeOf === 'function') {
			(<any>Object).setPrototypeOf(this, RemoteAuthorityResolverError.prototype);
		}
	}
}

export interface IRemoteAuthorityResolverService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeConnectionData: Event<void>;

	resolveAuthority(authority: string): Promise<ResolverResult>;
	getConnectionData(authority: string): IRemoteConnectionData | null;

	_clearResolvedAuthority(authority: string): void;
	_setResolvedAuthority(resolvedAuthority: ResolvedAuthority, resolvedOptions?: ResolvedOptions): void;
	_setResolvedAuthorityError(authority: string, err: any): void;
	_setAuthorityConnectionToken(authority: string, connectionToken: string): void;
}
