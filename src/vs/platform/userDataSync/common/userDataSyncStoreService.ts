/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, } from 'vs/base/common/lifecycle';
import { IUserData, IUserDataSyncStoreService, UserDataSyncErrorCode, IUserDataSyncStore, getUserDataSyncStore, ServerResource, UserDataSyncStoreError, IUserDataSyncLogService, IUserDataManifest, IResourceRefHandle, HEADER_OPERATION_ID, HEADER_EXECUTION_ID } from 'vs/platform/userDataSync/common/userDataSync';
import { IRequestService, asText, isSuccess, asJson } from 'vs/platform/request/common/request';
import { joinPath, relativePath } from 'vs/base/common/resources';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IHeaders, IRequestOptions, IRequestContext } from 'vs/base/parts/request/common/request';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IProductService } from 'vs/platform/product/common/productService';
import { getServiceMachineId } from 'vs/platform/serviceMachineId/common/serviceMachineId';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { assign } from 'vs/base/common/objects';
import { generateUuid } from 'vs/base/common/uuid';
import { isWeb } from 'vs/base/common/platform';
import { Emitter, Event } from 'vs/base/common/event';
import { createCancelablePromise, timeout, CancelablePromise } from 'vs/base/common/async';

const DONOT_MAKE_REQUESTS_UNTIL_KEY = 'sync.donot-make-requests-until';
const USER_SESSION_ID_KEY = 'sync.user-session-id';
const MACHINE_SESSION_ID_KEY = 'sync.machine-session-id';
const REQUEST_SESSION_LIMIT = 100;
const REQUEST_SESSION_INTERVAL = 1000 * 60 * 5; /* 5 minutes */

export class UserDataSyncStoreService extends Disposable implements IUserDataSyncStoreService {

	_serviceBrand: any;

	readonly userDataSyncStore: IUserDataSyncStore | undefined;
	private authToken: { token: string, type: string } | undefined;
	private readonly commonHeadersPromise: Promise<{ [key: string]: string; }>;
	private readonly session: RequestsSession;

	private _onTokenFailed: Emitter<void> = this._register(new Emitter<void>());
	readonly onTokenFailed: Event<void> = this._onTokenFailed.event;

	private _onTokenSucceed: Emitter<void> = this._register(new Emitter<void>());
	readonly onTokenSucceed: Event<void> = this._onTokenSucceed.event;

	private _donotMakeRequestsUntil: Date | undefined = undefined;
	get donotMakeRequestsUntil() { return this._donotMakeRequestsUntil; }
	private _onDidChangeDonotMakeRequestsUntil = this._register(new Emitter<void>());
	readonly onDidChangeDonotMakeRequestsUntil = this._onDidChangeDonotMakeRequestsUntil.event;

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
		@IRequestService private readonly requestService: IRequestService,
		@IUserDataSyncLogService private readonly logService: IUserDataSyncLogService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IFileService fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.userDataSyncStore = getUserDataSyncStore(productService, configurationService);
		this.commonHeadersPromise = getServiceMachineId(environmentService, fileService, storageService)
			.then(uuid => {
				const headers: IHeaders = {
					'X-Client-Name': `${productService.applicationName}${isWeb ? '-web' : ''}`,
					'X-Client-Version': productService.version,
					'X-Machine-Id': uuid
				};
				if (productService.commit) {
					headers['X-Client-Commit'] = productService.commit;
				}
				return headers;
			});

		/* A requests session that limits requests per sessions */
		this.session = new RequestsSession(REQUEST_SESSION_LIMIT, REQUEST_SESSION_INTERVAL, this.requestService, this.logService);
		this.initDonotMakeRequestsUntil();
	}

	setAuthToken(token: string, type: string): void {
		this.authToken = { token, type };
	}

	private initDonotMakeRequestsUntil(): void {
		const donotMakeRequestsUntil = this.storageService.getNumber(DONOT_MAKE_REQUESTS_UNTIL_KEY, StorageScope.GLOBAL);
		if (donotMakeRequestsUntil && Date.now() < donotMakeRequestsUntil) {
			this.setDonotMakeRequestsUntil(new Date(donotMakeRequestsUntil));
		}
	}

	private resetDonotMakeRequestsUntilPromise: CancelablePromise<void> | undefined = undefined;
	private setDonotMakeRequestsUntil(donotMakeRequestsUntil: Date | undefined): void {
		if (this._donotMakeRequestsUntil?.getTime() !== donotMakeRequestsUntil?.getTime()) {
			this._donotMakeRequestsUntil = donotMakeRequestsUntil;

			if (this.resetDonotMakeRequestsUntilPromise) {
				this.resetDonotMakeRequestsUntilPromise.cancel();
				this.resetDonotMakeRequestsUntilPromise = undefined;
			}

			if (this._donotMakeRequestsUntil) {
				this.storageService.store(DONOT_MAKE_REQUESTS_UNTIL_KEY, this._donotMakeRequestsUntil.getTime(), StorageScope.GLOBAL);
				this.resetDonotMakeRequestsUntilPromise = createCancelablePromise(token => timeout(this._donotMakeRequestsUntil!.getTime() - Date.now(), token).then(() => this.setDonotMakeRequestsUntil(undefined)));
			} else {
				this.storageService.remove(DONOT_MAKE_REQUESTS_UNTIL_KEY, StorageScope.GLOBAL);
			}

			this._onDidChangeDonotMakeRequestsUntil.fire();
		}
	}

	async getAllRefs(resource: ServerResource): Promise<IResourceRefHandle[]> {
		if (!this.userDataSyncStore) {
			throw new Error('No settings sync store url configured.');
		}

		const uri = joinPath(this.userDataSyncStore.url, 'resource', resource);
		const headers: IHeaders = {};

		const context = await this.request({ type: 'GET', url: uri.toString(), headers }, CancellationToken.None);

		if (!isSuccess(context)) {
			throw new UserDataSyncStoreError('Server returned ' + context.res.statusCode, UserDataSyncErrorCode.Unknown, context.res.headers[HEADER_OPERATION_ID]);
		}

		const result = await asJson<{ url: string, created: number }[]>(context) || [];
		return result.map(({ url, created }) => ({ ref: relativePath(uri, uri.with({ path: url }))!, created: created * 1000 /* Server returns in seconds */ }));
	}

	async resolveContent(resource: ServerResource, ref: string): Promise<string | null> {
		if (!this.userDataSyncStore) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStore.url, 'resource', resource, ref).toString();
		const headers: IHeaders = {};
		headers['Cache-Control'] = 'no-cache';

		const context = await this.request({ type: 'GET', url, headers }, CancellationToken.None);

		if (!isSuccess(context)) {
			throw new UserDataSyncStoreError('Server returned ' + context.res.statusCode, UserDataSyncErrorCode.Unknown, context.res.headers[HEADER_OPERATION_ID]);
		}

		const content = await asText(context);
		return content;
	}

	async delete(resource: ServerResource): Promise<void> {
		if (!this.userDataSyncStore) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStore.url, 'resource', resource).toString();
		const headers: IHeaders = {};

		const context = await this.request({ type: 'DELETE', url, headers }, CancellationToken.None);

		if (!isSuccess(context)) {
			throw new UserDataSyncStoreError('Server returned ' + context.res.statusCode, UserDataSyncErrorCode.Unknown, context.res.headers[HEADER_OPERATION_ID]);
		}
	}

	async read(resource: ServerResource, oldValue: IUserData | null, headers: IHeaders = {}): Promise<IUserData> {
		if (!this.userDataSyncStore) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStore.url, 'resource', resource, 'latest').toString();
		headers = { ...headers };
		// Disable caching as they are cached by synchronisers
		headers['Cache-Control'] = 'no-cache';
		if (oldValue) {
			headers['If-None-Match'] = oldValue.ref;
		}

		const context = await this.request({ type: 'GET', url, headers }, CancellationToken.None);

		if (context.res.statusCode === 304) {
			// There is no new value. Hence return the old value.
			return oldValue!;
		}

		if (!isSuccess(context)) {
			throw new UserDataSyncStoreError('Server returned ' + context.res.statusCode, UserDataSyncErrorCode.Unknown, context.res.headers[HEADER_OPERATION_ID]);
		}

		const ref = context.res.headers['etag'];
		if (!ref) {
			throw new UserDataSyncStoreError('Server did not return the ref', UserDataSyncErrorCode.NoRef, context.res.headers[HEADER_OPERATION_ID]);
		}
		const content = await asText(context);
		return { ref, content };
	}

	async write(resource: ServerResource, data: string, ref: string | null, headers: IHeaders = {}): Promise<string> {
		if (!this.userDataSyncStore) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStore.url, 'resource', resource).toString();
		headers = { ...headers };
		headers['Content-Type'] = 'text/plain';
		if (ref) {
			headers['If-Match'] = ref;
		}

		const context = await this.request({ type: 'POST', url, data, headers }, CancellationToken.None);

		if (!isSuccess(context)) {
			throw new UserDataSyncStoreError('Server returned ' + context.res.statusCode, UserDataSyncErrorCode.Unknown, context.res.headers[HEADER_OPERATION_ID]);
		}

		const newRef = context.res.headers['etag'];
		if (!newRef) {
			throw new UserDataSyncStoreError('Server did not return the ref', UserDataSyncErrorCode.NoRef, context.res.headers[HEADER_OPERATION_ID]);
		}
		return newRef;
	}

	async manifest(headers: IHeaders = {}): Promise<IUserDataManifest | null> {
		if (!this.userDataSyncStore) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStore.url, 'manifest').toString();
		headers = { ...headers };
		headers['Content-Type'] = 'application/json';

		const context = await this.request({ type: 'GET', url, headers }, CancellationToken.None);
		if (!isSuccess(context)) {
			throw new UserDataSyncStoreError('Server returned ' + context.res.statusCode, UserDataSyncErrorCode.Unknown, context.res.headers[HEADER_OPERATION_ID]);
		}

		const manifest = await asJson<IUserDataManifest>(context);
		const currentSessionId = this.storageService.get(USER_SESSION_ID_KEY, StorageScope.GLOBAL);

		if (currentSessionId && manifest && currentSessionId !== manifest.session) {
			// Server session is different from client session so clear cached session.
			this.clearSession();
		}

		if (manifest === null && currentSessionId) {
			// server session is cleared so clear cached session.
			this.clearSession();
		}

		if (manifest) {
			// update session
			this.storageService.store(USER_SESSION_ID_KEY, manifest.session, StorageScope.GLOBAL);
		}

		return manifest;
	}

	async clear(): Promise<void> {
		if (!this.userDataSyncStore) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStore.url, 'resource').toString();
		const headers: IHeaders = { 'Content-Type': 'text/plain' };

		const context = await this.request({ type: 'DELETE', url, headers }, CancellationToken.None);

		if (!isSuccess(context)) {
			throw new UserDataSyncStoreError('Server returned ' + context.res.statusCode, UserDataSyncErrorCode.Unknown, context.res.headers[HEADER_OPERATION_ID]);
		}

		// clear cached session.
		this.clearSession();
	}

	private clearSession(): void {
		this.storageService.remove(USER_SESSION_ID_KEY, StorageScope.GLOBAL);
		this.storageService.remove(MACHINE_SESSION_ID_KEY, StorageScope.GLOBAL);
	}

	private async request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
		if (!this.authToken) {
			throw new UserDataSyncStoreError('No Auth Token Available', UserDataSyncErrorCode.Unauthorized, undefined);
		}

		if (this._donotMakeRequestsUntil && Date.now() < this._donotMakeRequestsUntil.getTime()) {
			throw new UserDataSyncStoreError(`${options.type} request '${options.url?.toString()}' failed because of too many requests (429).`, UserDataSyncErrorCode.TooManyRequestsAndRetryAfter, undefined);
		}
		this.setDonotMakeRequestsUntil(undefined);

		const commonHeaders = await this.commonHeadersPromise;
		options.headers = assign(options.headers || {}, commonHeaders, {
			'X-Account-Type': this.authToken.type,
			'authorization': `Bearer ${this.authToken.token}`,
		});

		// Add session headers
		this.addSessionHeaders(options.headers);

		this.logService.trace('Sending request to server', { url: options.url, type: options.type, headers: { ...options.headers, ...{ authorization: undefined } } });

		let context;
		try {
			context = await this.session.request(options, token);
		} catch (e) {
			if (!(e instanceof UserDataSyncStoreError)) {
				e = new UserDataSyncStoreError(`Connection refused for the request '${options.url?.toString()}'.`, UserDataSyncErrorCode.ConnectionRefused, undefined);
			}
			this.logService.info('Request failed', options.url);
			throw e;
		}

		const operationId = context.res.headers[HEADER_OPERATION_ID];
		const requestInfo = { url: options.url, status: context.res.statusCode, 'execution-id': options.headers[HEADER_EXECUTION_ID], 'operation-id': operationId };
		if (isSuccess(context)) {
			this.logService.trace('Request succeeded', requestInfo);
		} else {
			this.logService.info('Request failed', requestInfo);
		}

		if (context.res.statusCode === 401) {
			this.authToken = undefined;
			this._onTokenFailed.fire();
			throw new UserDataSyncStoreError(`Request '${options.url?.toString()}' failed because of Unauthorized (401).`, UserDataSyncErrorCode.Unauthorized, operationId);
		}

		this._onTokenSucceed.fire();

		if (context.res.statusCode === 410) {
			throw new UserDataSyncStoreError(`${options.type} request '${options.url?.toString()}' failed because the requested resource is not longer available (410).`, UserDataSyncErrorCode.Gone, operationId);
		}

		if (context.res.statusCode === 412) {
			throw new UserDataSyncStoreError(`${options.type} request '${options.url?.toString()}' failed because of Precondition Failed (412). There is new data exists for this resource. Make the request again with latest data.`, UserDataSyncErrorCode.PreconditionFailed, operationId);
		}

		if (context.res.statusCode === 413) {
			throw new UserDataSyncStoreError(`${options.type} request '${options.url?.toString()}' failed because of too large payload (413).`, UserDataSyncErrorCode.TooLarge, operationId);
		}

		if (context.res.statusCode === 426) {
			throw new UserDataSyncStoreError(`${options.type} request '${options.url?.toString()}' failed with status Upgrade Required (426). Please upgrade the client and try again.`, UserDataSyncErrorCode.UpgradeRequired, operationId);
		}

		if (context.res.statusCode === 429) {
			const retryAfter = context.res.headers['retry-after'];
			if (retryAfter) {
				this.setDonotMakeRequestsUntil(new Date(Date.now() + (parseInt(retryAfter) * 1000)));
				throw new UserDataSyncStoreError(`${options.type} request '${options.url?.toString()}' failed because of too many requests (429).`, UserDataSyncErrorCode.TooManyRequestsAndRetryAfter, operationId);
			} else {
				throw new UserDataSyncStoreError(`${options.type} request '${options.url?.toString()}' failed because of too many requests (429).`, UserDataSyncErrorCode.TooManyRequests, operationId);
			}
		}

		return context;
	}

	private addSessionHeaders(headers: IHeaders): void {
		let machineSessionId = this.storageService.get(MACHINE_SESSION_ID_KEY, StorageScope.GLOBAL);
		if (machineSessionId === undefined) {
			machineSessionId = generateUuid();
			this.storageService.store(MACHINE_SESSION_ID_KEY, machineSessionId, StorageScope.GLOBAL);
		}
		headers['X-Machine-Session-Id'] = machineSessionId;

		const userSessionId = this.storageService.get(USER_SESSION_ID_KEY, StorageScope.GLOBAL);
		if (userSessionId !== undefined) {
			headers['X-User-Session-Id'] = userSessionId;
		}
	}

}

export class RequestsSession {

	private requests: string[] = [];
	private startTime: Date | undefined = undefined;

	constructor(
		private readonly limit: number,
		private readonly interval: number, /* in ms */
		private readonly requestService: IRequestService,
		private readonly logService: IUserDataSyncLogService,
	) { }

	request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
		if (this.isExpired()) {
			this.reset();
		}

		if (this.requests.length >= this.limit) {
			this.logService.info('Too many requests', ...this.requests);
			throw new UserDataSyncStoreError(`Too many requests. Allowed only ${this.limit} requests in ${this.interval / (1000 * 60)} minutes.`, UserDataSyncErrorCode.LocalTooManyRequests, undefined);
		}

		this.startTime = this.startTime || new Date();
		this.requests.push(options.url!);

		return this.requestService.request(options, token);
	}

	private isExpired(): boolean {
		return this.startTime !== undefined && new Date().getTime() - this.startTime.getTime() > this.interval;
	}

	private reset(): void {
		this.requests = [];
		this.startTime = undefined;
	}

}
