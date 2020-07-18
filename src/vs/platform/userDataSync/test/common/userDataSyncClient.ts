/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRequestService } from 'vs/platform/request/common/request';
import { IRequestOptions, IRequestContext, IHeaders } from 'vs/base/parts/request/common/request';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IUserData, IUserDataManifest, ALL_SYNC_RESOURCES, IUserDataSyncLogService, IUserDataSyncStoreService, IUserDataSyncUtilService, IUserDataSyncResourceEnablementService, IUserDataSyncService, getDefaultIgnoredSettings, IUserDataSyncBackupStoreService, SyncResource, ServerResource } from 'vs/platform/userDataSync/common/userDataSync';
import { bufferToStream, VSBuffer } from 'vs/base/common/buffer';
import { generateUuid } from 'vs/base/common/uuid';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { NullLogService, ILogService } from 'vs/platform/log/common/log';
import { UserDataSyncStoreService } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IFileService } from 'vs/platform/files/common/files';
import { FileService } from 'vs/platform/files/common/fileService';
import { Schemas } from 'vs/base/common/network';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IStorageService, InMemoryStorageService } from 'vs/platform/storage/common/storage';
import { URI } from 'vs/base/common/uri';
import { joinPath } from 'vs/base/common/resources';
import { IStringDictionary } from 'vs/base/common/collections';
import { FormattingOptions } from 'vs/base/common/jsonFormatter';
import { UserDataSyncResourceEnablementService } from 'vs/platform/userDataSync/common/userDataSyncResourceEnablementService';
import { IGlobalExtensionEnablementService, IExtensionManagementService, IExtensionGalleryService, DidInstallExtensionEvent, DidUninstallExtensionEvent } from 'vs/platform/extensionManagement/common/extensionManagement';
import { GlobalExtensionEnablementService } from 'vs/platform/extensionManagement/common/extensionEnablementService';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { ConfigurationService } from 'vs/platform/configuration/common/configurationService';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { IUserDataSyncAccountService, UserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import product from 'vs/platform/product/common/product';
import { IProductService } from 'vs/platform/product/common/productService';
import { UserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSyncBackupStoreService';
import { IStorageKeysSyncRegistryService, StorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { IUserDataSyncMachinesService, UserDataSyncMachinesService } from 'vs/platform/userDataSync/common/userDataSyncMachines';

export class UserDataSyncClient extends Disposable {

	readonly instantiationService: TestInstantiationService;

	constructor(readonly testServer: UserDataSyncTestServer = new UserDataSyncTestServer()) {
		super();
		this.instantiationService = new TestInstantiationService();
	}

	async setUp(empty: boolean = false): Promise<void> {
		const userDataDirectory = URI.file('userdata').with({ scheme: Schemas.inMemory });
		const userDataSyncHome = joinPath(userDataDirectory, '.sync');
		const environmentService = this.instantiationService.stub(IEnvironmentService, <Partial<IEnvironmentService>>{
			userDataSyncHome,
			settingsResource: joinPath(userDataDirectory, 'settings.json'),
			keybindingsResource: joinPath(userDataDirectory, 'keybindings.json'),
			snippetsHome: joinPath(userDataDirectory, 'snippets'),
			argvResource: joinPath(userDataDirectory, 'argv.json'),
			sync: 'on',
		});

		const logService = new NullLogService();
		this.instantiationService.stub(ILogService, logService);

		this.instantiationService.stub(IProductService, {
			_serviceBrand: undefined, ...product, ...{
				'configurationSync.store': {
					url: this.testServer.url,
					authenticationProviders: { 'test': { scopes: [] } }
				}
			}
		});

		const fileService = this._register(new FileService(logService));
		fileService.registerProvider(Schemas.inMemory, new InMemoryFileSystemProvider());
		this.instantiationService.stub(IFileService, fileService);

		this.instantiationService.stub(IStorageService, new InMemoryStorageService());

		const configurationService = new ConfigurationService(environmentService.settingsResource, fileService);
		await configurationService.initialize();
		this.instantiationService.stub(IConfigurationService, configurationService);

		this.instantiationService.stub(IRequestService, this.testServer);

		this.instantiationService.stub(IUserDataSyncLogService, logService);
		this.instantiationService.stub(ITelemetryService, NullTelemetryService);
		this.instantiationService.stub(IUserDataSyncStoreService, this.instantiationService.createInstance(UserDataSyncStoreService));

		const userDataSyncAccountService: IUserDataSyncAccountService = this.instantiationService.createInstance(UserDataSyncAccountService);
		await userDataSyncAccountService.updateAccount({ authenticationProviderId: 'authenticationProviderId', token: 'token' });
		this.instantiationService.stub(IUserDataSyncAccountService, userDataSyncAccountService);

		this.instantiationService.stub(IUserDataSyncMachinesService, this.instantiationService.createInstance(UserDataSyncMachinesService));
		this.instantiationService.stub(IUserDataSyncBackupStoreService, this.instantiationService.createInstance(UserDataSyncBackupStoreService));
		this.instantiationService.stub(IUserDataSyncUtilService, new TestUserDataSyncUtilService());
		this.instantiationService.stub(IUserDataSyncResourceEnablementService, this.instantiationService.createInstance(UserDataSyncResourceEnablementService));
		this.instantiationService.stub(IStorageKeysSyncRegistryService, this.instantiationService.createInstance(StorageKeysSyncRegistryService));

		this.instantiationService.stub(IGlobalExtensionEnablementService, this.instantiationService.createInstance(GlobalExtensionEnablementService));
		this.instantiationService.stub(IExtensionManagementService, <Partial<IExtensionManagementService>>{
			async getInstalled() { return []; },
			onDidInstallExtension: new Emitter<DidInstallExtensionEvent>().event,
			onDidUninstallExtension: new Emitter<DidUninstallExtensionEvent>().event,
		});
		this.instantiationService.stub(IExtensionGalleryService, <Partial<IExtensionGalleryService>>{
			isEnabled() { return true; },
			async getCompatibleExtension() { return null; }
		});

		this.instantiationService.stub(IUserDataSyncService, this.instantiationService.createInstance(UserDataSyncService));

		if (!empty) {
			await fileService.writeFile(environmentService.settingsResource, VSBuffer.fromString(JSON.stringify({})));
			await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString(JSON.stringify([])));
			await fileService.writeFile(joinPath(environmentService.snippetsHome, 'c.json'), VSBuffer.fromString(`{}`));
			await fileService.writeFile(environmentService.argvResource, VSBuffer.fromString(JSON.stringify({ 'locale': 'en' })));
		}
		await configurationService.reloadConfiguration();
	}

	async sync(): Promise<void> {
		await (await this.instantiationService.get(IUserDataSyncService).createSyncTask()).run();
	}

	read(resource: SyncResource): Promise<IUserData> {
		return this.instantiationService.get(IUserDataSyncStoreService).read(resource, null);
	}

	manifest(): Promise<IUserDataManifest | null> {
		return this.instantiationService.get(IUserDataSyncStoreService).manifest();
	}

}

const ALL_SERVER_RESOURCES: ServerResource[] = [...ALL_SYNC_RESOURCES, 'machines'];

export class UserDataSyncTestServer implements IRequestService {

	_serviceBrand: any;

	readonly url: string = 'http://host:3000';
	private session: string | null = null;
	private readonly data: Map<ServerResource, IUserData> = new Map<SyncResource, IUserData>();

	private _requests: { url: string, type: string, headers?: IHeaders }[] = [];
	get requests(): { url: string, type: string, headers?: IHeaders }[] { return this._requests; }

	private _requestsWithAllHeaders: { url: string, type: string, headers?: IHeaders }[] = [];
	get requestsWithAllHeaders(): { url: string, type: string, headers?: IHeaders }[] { return this._requestsWithAllHeaders; }

	private _responses: { status: number }[] = [];
	get responses(): { status: number }[] { return this._responses; }
	reset(): void { this._requests = []; this._responses = []; this._requestsWithAllHeaders = []; }

	constructor(private readonly rateLimit = Number.MAX_SAFE_INTEGER) { }

	async resolveProxy(url: string): Promise<string | undefined> { return url; }

	async request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
		if (this._requests.length === this.rateLimit) {
			return this.toResponse(429);
		}
		const headers: IHeaders = {};
		if (options.headers) {
			if (options.headers['If-None-Match']) {
				headers['If-None-Match'] = options.headers['If-None-Match'];
			}
			if (options.headers['If-Match']) {
				headers['If-Match'] = options.headers['If-Match'];
			}
		}
		this._requests.push({ url: options.url!, type: options.type!, headers });
		this._requestsWithAllHeaders.push({ url: options.url!, type: options.type!, headers: options.headers });
		const requestContext = await this.doRequest(options);
		this._responses.push({ status: requestContext.res.statusCode! });
		return requestContext;
	}

	private async doRequest(options: IRequestOptions): Promise<IRequestContext> {
		const versionUrl = `${this.url}/v1/`;
		const relativePath = options.url!.indexOf(versionUrl) === 0 ? options.url!.substring(versionUrl.length) : undefined;
		const segments = relativePath ? relativePath.split('/') : [];
		if (options.type === 'GET' && segments.length === 1 && segments[0] === 'manifest') {
			return this.getManifest(options.headers);
		}
		if (options.type === 'GET' && segments.length === 3 && segments[0] === 'resource' && segments[2] === 'latest') {
			return this.getLatestData(segments[1], options.headers);
		}
		if (options.type === 'POST' && segments.length === 2 && segments[0] === 'resource') {
			return this.writeData(segments[1], options.data, options.headers);
		}
		if (options.type === 'DELETE' && segments.length === 1 && segments[0] === 'resource') {
			return this.clear(options.headers);
		}
		return this.toResponse(501);
	}

	private async getManifest(headers?: IHeaders): Promise<IRequestContext> {
		if (this.session) {
			const latest: Record<ServerResource, string> = Object.create({});
			const manifest: IUserDataManifest = { session: this.session, latest };
			this.data.forEach((value, key) => latest[key] = value.ref);
			return this.toResponse(200, { 'Content-Type': 'application/json' }, JSON.stringify(manifest));
		}
		return this.toResponse(204);
	}

	private async getLatestData(resource: string, headers: IHeaders = {}): Promise<IRequestContext> {
		const resourceKey = ALL_SERVER_RESOURCES.find(key => key === resource);
		if (resourceKey) {
			const data = this.data.get(resourceKey);
			if (!data) {
				return this.toResponse(204, { etag: '0' });
			}
			if (headers['If-None-Match'] === data.ref) {
				return this.toResponse(304);
			}
			return this.toResponse(200, { etag: data.ref }, data.content || '');
		}
		return this.toResponse(204);
	}

	private async writeData(resource: string, content: string = '', headers: IHeaders = {}): Promise<IRequestContext> {
		if (!this.session) {
			this.session = generateUuid();
		}
		const resourceKey = ALL_SERVER_RESOURCES.find(key => key === resource);
		if (resourceKey) {
			const data = this.data.get(resourceKey);
			if (headers['If-Match'] !== undefined && headers['If-Match'] !== (data ? data.ref : '0')) {
				return this.toResponse(412);
			}
			const ref = `${parseInt(data?.ref || '0') + 1}`;
			this.data.set(resourceKey, { ref, content });
			return this.toResponse(200, { etag: ref });
		}
		return this.toResponse(204);
	}

	async clear(headers?: IHeaders): Promise<IRequestContext> {
		this.data.clear();
		this.session = null;
		return this.toResponse(204);
	}

	private toResponse(statusCode: number, headers?: IHeaders, data?: string): IRequestContext {
		return {
			res: {
				headers: headers || {},
				statusCode
			},
			stream: bufferToStream(VSBuffer.fromString(data || ''))
		};
	}
}

export class TestUserDataSyncUtilService implements IUserDataSyncUtilService {

	_serviceBrand: any;

	async resolveDefaultIgnoredSettings(): Promise<string[]> {
		return getDefaultIgnoredSettings();
	}

	async resolveUserBindings(userbindings: string[]): Promise<IStringDictionary<string>> {
		const keys: IStringDictionary<string> = {};
		for (const keybinding of userbindings) {
			keys[keybinding] = keybinding;
		}
		return keys;
	}

	async resolveFormattingOptions(file?: URI): Promise<FormattingOptions> {
		return { eol: '\n', insertSpaces: false, tabSize: 4 };
	}

}

