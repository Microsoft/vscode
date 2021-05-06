/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable, } from 'vs/base/common/lifecycle';
import { IUserData, IUserDataSyncStoreService, UserDataSyncErrorCode, IUserDataSyncStore, ServerResource, UserDataSyncStoreError, IUserDataSyncLogService, IUserDataManifest, IResourceRefHandle, HEADER_OPERATION_ID, HEADER_EXECUTION_ID, CONFIGURATION_SYNC_STORE_KEY, IAuthenticationProvider, IUserDataSyncStoreManagementService, UserDataSyncStoreType, IUserDataSyncStoreClient, SYNC_SERVICE_URL_TYPE } from 'vs/platform/userDataSync/common/userDataSync';
import { IRequestService, asText, isSuccess as isSuccessContext, asJson } from 'vs/platform/request/common/request';
import { joinPath, relativePath } from 'vs/base/common/resources';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IHeaders, IRequestOptions, IRequestContext } from 'vs/base/parts/request/common/request';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IProductService } from 'vs/platform/product/common/productService';
import { ConfigurationSyncStore } from 'vs/base/common/product';
import { getServiceMachineId } from 'vs/platform/serviceMachineId/common/serviceMachineId';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { generateUuid } from 'vs/base/common/uuid';
import { isWeb } from 'vs/base/common/platform';
import { Emitter, Event } from 'vs/base/common/event';
import { createCancelablePromise, timeout, CancelablePromise } from 'vs/base/common/async';
import { isString, isObject, isArray } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { getErrorMessage, isPromiseCanceledError } from 'vs/base/common/errors';

const SYNC_PREVIOUS_STORE = 'sync.previous.store';
const DONOT_MAKE_REQUESTS_UNTIL_KEY = 'sync.donot-make-requests-until';
const USER_SESSION_ID_KEY = 'sync.user-session-id';
const MACHINE_SESSION_ID_KEY = 'sync.machine-session-id';
const REQUEST_SESSION_LIMIT = 100;
const REQUEST_SESSION_INTERVAL = 1000 * 60 * 5; /* 5 minutes */

type UserDataSyncStore = IUserDataSyncStore & { defaultType: UserDataSyncStoreType; };

export abstract class AbstractUserDataSyncStoreManagementService extends Disposable implements IUserDataSyncStoreManagementService {

	_serviceBrand: any;

	private readonly _onDidChangeUserDataSyncStore = this._register(new Emitter<void>());
	readonly onDidChangeUserDataSyncStore = this._onDidChangeUserDataSyncStore.event;
	private _userDataSyncStore: UserDataSyncStore | undefined;
	get userDataSyncStore(): UserDataSyncStore | undefined { return this._userDataSyncStore; }

	protected get userDataSyncStoreType(): UserDataSyncStoreType | undefined {
		return this.storageService.get(SYNC_SERVICE_URL_TYPE, StorageScope.GLOBAL) as UserDataSyncStoreType;
	}
	protected set userDataSyncStoreType(type: UserDataSyncStoreType | undefined) {
		this.storageService.store(SYNC_SERVICE_URL_TYPE, type, StorageScope.GLOBAL, isWeb ? StorageTarget.USER /* sync in web */ : StorageTarget.MACHINE);
	}

	constructor(
		@IProductService protected readonly productService: IProductService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IStorageService protected readonly storageService: IStorageService,
	) {
		super();
		this.updateUserDataSyncStore();
		this._register(Event.filter(storageService.onDidChangeValue, e => e.key === SYNC_SERVICE_URL_TYPE && e.scope === StorageScope.GLOBAL && this.userDataSyncStoreType !== this.userDataSyncStore?.type)(() => this.updateUserDataSyncStore()));
	}

	protected updateUserDataSyncStore(): void {
		this._userDataSyncStore = this.toUserDataSyncStore(this.productService[CONFIGURATION_SYNC_STORE_KEY], this.configurationService.getValue<ConfigurationSyncStore>(CONFIGURATION_SYNC_STORE_KEY));
		this._onDidChangeUserDataSyncStore.fire();
	}

	protected toUserDataSyncStore(productStore: ConfigurationSyncStore & { web?: ConfigurationSyncStore } | undefined, configuredStore?: ConfigurationSyncStore): UserDataSyncStore | undefined {
		// Check for web overrides for backward compatibility while reading previous store
		productStore = isWeb && productStore?.web ? { ...productStore, ...productStore.web } : productStore;
		const value: Partial<ConfigurationSyncStore> = { ...(productStore || {}), ...(configuredStore || {}) };
		if (value
			&& isString(value.url)
			&& isObject(value.authenticationProviders)
			&& Object.keys(value.authenticationProviders).every(authenticationProviderId => isArray(value!.authenticationProviders![authenticationProviderId].scopes))
		) {
			const syncStore = value as ConfigurationSyncStore;
			const canSwitch = !!syncStore.canSwitch && !configuredStore?.url;
			const defaultType: UserDataSyncStoreType = syncStore.url === syncStore.insidersUrl ? 'insiders' : 'stable';
			const type: UserDataSyncStoreType = (canSwitch ? this.userDataSyncStoreType : undefined) || defaultType;
			const url = configuredStore?.url ||
				(type === 'insiders' ? syncStore.insidersUrl
					: type === 'stable' ? syncStore.stableUrl
						: syncStore.url);
			return {
				url: URI.parse(url),
				type,
				defaultType,
				defaultUrl: URI.parse(syncStore.url),
				stableUrl: URI.parse(syncStore.stableUrl),
				insidersUrl: URI.parse(syncStore.insidersUrl),
				canSwitch,
				authenticationProviders: Object.keys(syncStore.authenticationProviders).reduce<IAuthenticationProvider[]>((result, id) => {
					result.push({ id, scopes: syncStore!.authenticationProviders[id].scopes });
					return result;
				}, [])
			};
		}
		return undefined;
	}

	abstract switch(type: UserDataSyncStoreType): Promise<void>;
	abstract getPreviousUserDataSyncStore(): Promise<IUserDataSyncStore | undefined>;

}

export class UserDataSyncStoreManagementService extends AbstractUserDataSyncStoreManagementService implements IUserDataSyncStoreManagementService {

	private readonly previousConfigurationSyncStore: ConfigurationSyncStore | undefined;

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
	) {
		super(productService, configurationService, storageService);

		const previousConfigurationSyncStore = this.storageService.get(SYNC_PREVIOUS_STORE, StorageScope.GLOBAL);
		if (previousConfigurationSyncStore) {
			this.previousConfigurationSyncStore = JSON.parse(previousConfigurationSyncStore);
		}

		const syncStore = this.productService[CONFIGURATION_SYNC_STORE_KEY];
		if (syncStore) {
			this.storageService.store(SYNC_PREVIOUS_STORE, JSON.stringify(syncStore), StorageScope.GLOBAL, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(SYNC_PREVIOUS_STORE, StorageScope.GLOBAL);
		}
	}

	async switch(type: UserDataSyncStoreType): Promise<void> {
		if (type !== this.userDataSyncStoreType) {
			this.userDataSyncStoreType = type;
			this.updateUserDataSyncStore();
		}
	}

	async getPreviousUserDataSyncStore(): Promise<IUserDataSyncStore | undefined> {
		return this.toUserDataSyncStore(this.previousConfigurationSyncStore);
	}
}

export class UserDataSyncStoreClient extends Disposable implements IUserDataSyncStoreClient {

	private userDataSyncStoreUrl: URI | undefined;

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
		userDataSyncStoreUrl: URI | undefined,
		@IProductService productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@IUserDataSyncLogService private readonly logService: IUserDataSyncLogService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IFileService fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.updateUserDataSyncStoreUrl(userDataSyncStoreUrl);
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
		this._register(toDisposable(() => {
			if (this.resetDonotMakeRequestsUntilPromise) {
				this.resetDonotMakeRequestsUntilPromise.cancel();
				this.resetDonotMakeRequestsUntilPromise = undefined;
			}
		}));
	}

	setAuthToken(token: string, type: string): void {
		this.authToken = { token, type };
	}

	protected updateUserDataSyncStoreUrl(userDataSyncStoreUrl: URI | undefined): void {
		this.userDataSyncStoreUrl = userDataSyncStoreUrl ? joinPath(userDataSyncStoreUrl, 'v1') : undefined;
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
				this.storageService.store(DONOT_MAKE_REQUESTS_UNTIL_KEY, this._donotMakeRequestsUntil.getTime(), StorageScope.GLOBAL, StorageTarget.MACHINE);
				this.resetDonotMakeRequestsUntilPromise = createCancelablePromise(token => timeout(this._donotMakeRequestsUntil!.getTime() - Date.now(), token).then(() => this.setDonotMakeRequestsUntil(undefined)));
				this.resetDonotMakeRequestsUntilPromise.then(null, e => null /* ignore error */);
			} else {
				this.storageService.remove(DONOT_MAKE_REQUESTS_UNTIL_KEY, StorageScope.GLOBAL);
			}

			this._onDidChangeDonotMakeRequestsUntil.fire();
		}
	}

	async getAllRefs(resource: ServerResource): Promise<IResourceRefHandle[]> {
		if (!this.userDataSyncStoreUrl) {
			throw new Error('No settings sync store url configured.');
		}

		const uri = joinPath(this.userDataSyncStoreUrl, 'resource', resource);
		const headers: IHeaders = {};

		const context = await this.request(uri.toString(), { type: 'GET', headers }, [], CancellationToken.None);

		const result = await asJson<{ url: string, created: number }[]>(context) || [];
		return result.map(({ url, created }) => ({ ref: relativePath(uri, uri.with({ path: url }))!, created: created * 1000 /* Server returns in seconds */ }));
	}

	async resolveContent(resource: ServerResource, ref: string): Promise<string | null> {
		if (!this.userDataSyncStoreUrl) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStoreUrl, 'resource', resource, ref).toString();
		const headers: IHeaders = {};
		headers['Cache-Control'] = 'no-cache';

		const context = await this.request(url, { type: 'GET', headers }, [], CancellationToken.None);
		const content = await asText(context);
		return content;
	}

	async delete(resource: ServerResource): Promise<void> {
		if (!this.userDataSyncStoreUrl) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStoreUrl, 'resource', resource).toString();
		const headers: IHeaders = {};

		await this.request(url, { type: 'DELETE', headers }, [], CancellationToken.None);
	}

	async read(resource: ServerResource, oldValue: IUserData | null, headers: IHeaders = {}): Promise<IUserData> {
		if (!this.userDataSyncStoreUrl) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStoreUrl, 'resource', resource, 'latest').toString();
		headers = { ...headers };
		// Disable caching as they are cached by synchronisers
		headers['Cache-Control'] = 'no-cache';
		if (oldValue) {
			headers['If-None-Match'] = oldValue.ref;
		}

		const context = await this.request(url, { type: 'GET', headers }, [304], CancellationToken.None);

		if (context.res.statusCode === 304) {
			// There is no new value. Hence return the old value.
			return oldValue!;
		}

		const ref = context.res.headers['etag'];
		if (!ref) {
			throw new UserDataSyncStoreError('Server did not return the ref', url, UserDataSyncErrorCode.NoRef, context.res.headers[HEADER_OPERATION_ID]);
		}
		const content = await asText(context);
		return { ref, content };
	}

	async write(resource: ServerResource, data: string, ref: string | null, headers: IHeaders = {}): Promise<string> {
		if (!this.userDataSyncStoreUrl) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStoreUrl, 'resource', resource).toString();
		headers = { ...headers };
		headers['Content-Type'] = 'text/plain';
		if (ref) {
			headers['If-Match'] = ref;
		}

		const context = await this.request(url, { type: 'POST', data, headers }, [], CancellationToken.None);

		const newRef = context.res.headers['etag'];
		if (!newRef) {
			throw new UserDataSyncStoreError('Server did not return the ref', url, UserDataSyncErrorCode.NoRef, context.res.headers[HEADER_OPERATION_ID]);
		}
		return newRef;
	}

	async manifest(headers: IHeaders = {}): Promise<IUserDataManifest | null> {
		if (!this.userDataSyncStoreUrl) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStoreUrl, 'manifest').toString();
		headers = { ...headers };
		headers['Content-Type'] = 'application/json';

		const context = await this.request(url, { type: 'GET', headers }, [], CancellationToken.None);

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
			this.storageService.store(USER_SESSION_ID_KEY, manifest.session, StorageScope.GLOBAL, StorageTarget.MACHINE);
		}

		return manifest;
	}

	async clear(): Promise<void> {
		if (!this.userDataSyncStoreUrl) {
			throw new Error('No settings sync store url configured.');
		}

		const url = joinPath(this.userDataSyncStoreUrl, 'resource').toString();
		const headers: IHeaders = { 'Content-Type': 'text/plain' };

		await this.request(url, { type: 'DELETE', headers }, [], CancellationToken.None);

		// clear cached session.
		this.clearSession();
	}

	private clearSession(): void {
		this.storageService.remove(USER_SESSION_ID_KEY, StorageScope.GLOBAL);
		this.storageService.remove(MACHINE_SESSION_ID_KEY, StorageScope.GLOBAL);
	}

	private async request(url: string, options: IRequestOptions, successCodes: number[], token: CancellationToken): Promise<IRequestContext> {
		if (!this.authToken) {
			throw new UserDataSyncStoreError('No Auth Token Available', url, UserDataSyncErrorCode.Unauthorized, undefined);
		}

		if (this._donotMakeRequestsUntil && Date.now() < this._donotMakeRequestsUntil.getTime()) {
			throw new UserDataSyncStoreError(`${options.type} request '${url}' failed because of too many requests (429).`, url, UserDataSyncErrorCode.TooManyRequestsAndRetryAfter, undefined);
		}
		this.setDonotMakeRequestsUntil(undefined);

		const commonHeaders = await this.commonHeadersPromise;
		options.headers = {
			...(options.headers || {}),
			...commonHeaders,
			'X-Account-Type': this.authToken.type,
			'authorization': `Bearer ${this.authToken.token}`,
		};

		// Add session headers
		this.addSessionHeaders(options.headers);

		this.logService.trace('Sending request to server', { url, type: options.type, headers: { ...options.headers, ...{ authorization: undefined } } });

		let context;
		try {
			context = await this.session.request(url, options, token);
		} catch (e) {
			if (!(e instanceof UserDataSyncStoreError)) {
				const code = isPromiseCanceledError(e) ? UserDataSyncErrorCode.RequestCanceled
					: getErrorMessage(e).startsWith('XHR timeout') ? UserDataSyncErrorCode.RequestTimeout : UserDataSyncErrorCode.RequestFailed;
				e = new UserDataSyncStoreError(`Connection refused for the request '${url}'.`, url, code, undefined);
			}
			this.logService.info('Request failed', url);
			throw e;
		}

		const operationId = context.res.headers[HEADER_OPERATION_ID];
		const requestInfo = { url, status: context.res.statusCode, 'execution-id': options.headers[HEADER_EXECUTION_ID], 'operation-id': operationId };
		const isSuccess = isSuccessContext(context) || (context.res.statusCode && successCodes.indexOf(context.res.statusCode) !== -1);
		if (isSuccess) {
			this.logService.trace('Request succeeded', requestInfo);
		} else {
			this.logService.info('Request failed', requestInfo);
		}

		if (context.res.statusCode === 401) {
			this.authToken = undefined;
			this._onTokenFailed.fire();
			throw new UserDataSyncStoreError(`Request '${url}' failed because of Unauthorized (401).`, url, UserDataSyncErrorCode.Unauthorized, operationId);
		}

		this._onTokenSucceed.fire();

		if (context.res.statusCode === 409) {
			throw new UserDataSyncStoreError(`${options.type} request '${url}' failed because of Conflict (409). There is new data for this resource. Make the request again with latest data.`, url, UserDataSyncErrorCode.Conflict, operationId);
		}

		if (context.res.statusCode === 410) {
			throw new UserDataSyncStoreError(`${options.type} request '${url}' failed because the requested resource is not longer available (410).`, url, UserDataSyncErrorCode.Gone, operationId);
		}

		if (context.res.statusCode === 412) {
			throw new UserDataSyncStoreError(`${options.type} request '${url}' failed because of Precondition Failed (412). There is new data for this resource. Make the request again with latest data.`, url, UserDataSyncErrorCode.PreconditionFailed, operationId);
		}

		if (context.res.statusCode === 413) {
			throw new UserDataSyncStoreError(`${options.type} request '${url}' failed because of too large payload (413).`, url, UserDataSyncErrorCode.TooLarge, operationId);
		}

		if (context.res.statusCode === 426) {
			throw new UserDataSyncStoreError(`${options.type} request '${url}' failed with status Upgrade Required (426). Please upgrade the client and try again.`, url, UserDataSyncErrorCode.UpgradeRequired, operationId);
		}

		if (context.res.statusCode === 429) {
			const retryAfter = context.res.headers['retry-after'];
			if (retryAfter) {
				this.setDonotMakeRequestsUntil(new Date(Date.now() + (parseInt(retryAfter) * 1000)));
				throw new UserDataSyncStoreError(`${options.type} request '${url}' failed because of too many requests (429).`, url, UserDataSyncErrorCode.TooManyRequestsAndRetryAfter, operationId);
			} else {
				throw new UserDataSyncStoreError(`${options.type} request '${url}' failed because of too many requests (429).`, url, UserDataSyncErrorCode.TooManyRequests, operationId);
			}
		}

		if (!isSuccess) {
			throw new UserDataSyncStoreError('Server returned ' + context.res.statusCode, url, UserDataSyncErrorCode.Unknown, operationId);
		}

		return context;
	}

	private addSessionHeaders(headers: IHeaders): void {
		let machineSessionId = this.storageService.get(MACHINE_SESSION_ID_KEY, StorageScope.GLOBAL);
		if (machineSessionId === undefined) {
			machineSessionId = generateUuid();
			this.storageService.store(MACHINE_SESSION_ID_KEY, machineSessionId, StorageScope.GLOBAL, StorageTarget.MACHINE);
		}
		headers['X-Machine-Session-Id'] = machineSessionId;

		const userSessionId = this.storageService.get(USER_SESSION_ID_KEY, StorageScope.GLOBAL);
		if (userSessionId !== undefined) {
			headers['X-User-Session-Id'] = userSessionId;
		}
	}

}

export class UserDataSyncStoreService extends UserDataSyncStoreClient implements IUserDataSyncStoreService {

	_serviceBrand: any;

	constructor(
		@IUserDataSyncStoreManagementService userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
		@IProductService productService: IProductService,
		@IRequestService requestService: IRequestService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
	) {
		super(userDataSyncStoreManagementService.userDataSyncStore?.url, productService, requestService, logService, environmentService, fileService, storageService);
		this._register(userDataSyncStoreManagementService.onDidChangeUserDataSyncStore(() => this.updateUserDataSyncStoreUrl(userDataSyncStoreManagementService.userDataSyncStore?.url)));
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

	request(url: string, options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
		if (this.isExpired()) {
			this.reset();
		}

		options.url = url;

		if (this.requests.length >= this.limit) {
			this.logService.info('Too many requests', ...this.requests);
			throw new UserDataSyncStoreError(`Too many requests. Only ${this.limit} requests allowed in ${this.interval / (1000 * 60)} minutes.`, url, UserDataSyncErrorCode.LocalTooManyRequests, undefined);
		}

		this.startTime = this.startTime || new Date();
		this.requests.push(url);

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
