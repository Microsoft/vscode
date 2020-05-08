/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as platform from 'vs/base/common/platform';
import product from 'vs/platform/product/common/product';
import { serve, Server, connect } from 'vs/base/parts/ipc/node/ipc.net';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ParsedArgs } from 'vs/platform/environment/node/argv';
import { EnvironmentService } from 'vs/platform/environment/node/environmentService';
import { ExtensionManagementChannel, ExtensionTipsChannel } from 'vs/platform/extensionManagement/common/extensionManagementIpc';
import { IExtensionManagementService, IExtensionGalleryService, IGlobalExtensionEnablementService, IExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionManagementService } from 'vs/platform/extensionManagement/node/extensionManagementService';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionGalleryService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationService } from 'vs/platform/configuration/common/configurationService';
import { IRequestService } from 'vs/platform/request/common/request';
import { RequestService } from 'vs/platform/request/browser/requestService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { combinedAppender, NullTelemetryService, ITelemetryAppender, NullAppender, LogAppender } from 'vs/platform/telemetry/common/telemetryUtils';
import { resolveCommonProperties } from 'vs/platform/telemetry/node/commonProperties';
import { TelemetryAppenderChannel } from 'vs/platform/telemetry/node/telemetryIpc';
import { TelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { AppInsightsAppender } from 'vs/platform/telemetry/node/appInsightsAppender';
import { ipcRenderer } from 'electron';
import { ILogService, LogLevel, ILoggerService } from 'vs/platform/log/common/log';
import { LoggerChannelClient, FollowerLogService } from 'vs/platform/log/common/logIpc';
import { LocalizationsService } from 'vs/platform/localizations/node/localizations';
import { ILocalizationsService } from 'vs/platform/localizations/common/localizations';
import { combinedDisposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { DownloadService } from 'vs/platform/download/common/downloadService';
import { IDownloadService } from 'vs/platform/download/common/download';
import { IChannel, IServerChannel, StaticRouter } from 'vs/base/parts/ipc/common/ipc';
import { createChannelSender, createChannelReceiver } from 'vs/base/parts/ipc/node/ipc';
import { NodeCachedDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/nodeCachedDataCleaner';
import { LanguagePackCachedDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/languagePackCachedDataCleaner';
import { StorageDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/storageDataCleaner';
import { LogsDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/logsDataCleaner';
import { IMainProcessService } from 'vs/platform/ipc/electron-browser/mainProcessService';
import { SpdLogService } from 'vs/platform/log/node/spdlogService';
import { DiagnosticsService, IDiagnosticsService } from 'vs/platform/diagnostics/node/diagnosticsService';
import { DiagnosticsChannel } from 'vs/platform/diagnostics/node/diagnosticsIpc';
import { FileService } from 'vs/platform/files/common/fileService';
import { IFileService } from 'vs/platform/files/common/files';
import { DiskFileSystemProvider } from 'vs/platform/files/electron-browser/diskFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { IProductService } from 'vs/platform/product/common/productService';
import { IUserDataSyncService, IUserDataSyncStoreService, registerConfiguration, IUserDataSyncLogService, IUserDataSyncUtilService, IUserDataSyncEnablementService, IUserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { UserDataSyncStoreService } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { UserDataSyncChannel, UserDataSyncUtilServiceClient, UserDataAutoSyncChannel, StorageKeysSyncRegistryChannelClient } from 'vs/platform/userDataSync/common/userDataSyncIpc';
import { IElectronService } from 'vs/platform/electron/node/electron';
import { LoggerService } from 'vs/platform/log/node/loggerService';
import { UserDataSyncLogService } from 'vs/platform/userDataSync/common/userDataSyncLog';
import { ICredentialsService } from 'vs/platform/credentials/common/credentials';
import { KeytarCredentialsService } from 'vs/platform/credentials/node/credentialsService';
import { UserDataAutoSyncService } from 'vs/platform/userDataSync/electron-browser/userDataAutoSyncService';
import { NativeStorageService } from 'vs/platform/storage/node/storageService';
import { GlobalStorageDatabaseChannelClient } from 'vs/platform/storage/node/storageIpc';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { GlobalExtensionEnablementService } from 'vs/platform/extensionManagement/common/extensionEnablementService';
import { UserDataSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSyncEnablementService';
import { IAuthenticationTokenService, AuthenticationTokenService } from 'vs/platform/authentication/common/authentication';
import { AuthenticationTokenServiceChannel } from 'vs/platform/authentication/common/authenticationIpc';
import { UserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSyncBackupStoreService';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { ExtensionTipsService } from 'vs/platform/extensionManagement/node/extensionTipsService';

export interface ISharedProcessConfiguration {
	readonly machineId: string;
	readonly windowId: number;
}

export function startup(configuration: ISharedProcessConfiguration) {
	handshake(configuration);
}

interface ISharedProcessInitData {
	sharedIPCHandle: string;
	args: ParsedArgs;
	logLevel: LogLevel;
}

const eventPrefix = 'monacoworkbench';

class MainProcessService implements IMainProcessService {
	constructor(private server: Server, private mainRouter: StaticRouter) { }

	_serviceBrand: undefined;

	getChannel(channelName: string): IChannel {
		return this.server.getChannel(channelName, this.mainRouter);
	}

	registerChannel(channelName: string, channel: IServerChannel<string>): void {
		this.server.registerChannel(channelName, channel);
	}
}

async function main(server: Server, initData: ISharedProcessInitData, configuration: ISharedProcessConfiguration): Promise<void> {
	const services = new ServiceCollection();

	const disposables = new DisposableStore();

	const onExit = () => disposables.dispose();
	process.once('exit', onExit);
	ipcRenderer.once('electron-main->shared-process: exit', onExit);

	disposables.add(server);

	const environmentService = new EnvironmentService(initData.args, process.execPath);

	const mainRouter = new StaticRouter(ctx => ctx === 'main');
	const loggerClient = new LoggerChannelClient(server.getChannel('logger', mainRouter));
	const logService = new FollowerLogService(loggerClient, new SpdLogService('sharedprocess', environmentService.logsPath, initData.logLevel));
	disposables.add(logService);
	logService.info('main', JSON.stringify(configuration));

	const mainProcessService = new MainProcessService(server, mainRouter);
	services.set(IMainProcessService, mainProcessService);

	// Files
	const fileService = new FileService(logService);
	services.set(IFileService, fileService);
	disposables.add(fileService);
	const diskFileSystemProvider = new DiskFileSystemProvider(logService);
	disposables.add(diskFileSystemProvider);
	fileService.registerProvider(Schemas.file, diskFileSystemProvider);

	// Configuration
	const configurationService = new ConfigurationService(environmentService.settingsResource, fileService);
	disposables.add(configurationService);
	await configurationService.initialize();

	// Storage
	const storageService = new NativeStorageService(new GlobalStorageDatabaseChannelClient(mainProcessService.getChannel('storage')), logService, environmentService);
	await storageService.initialize();
	services.set(IStorageService, storageService);
	disposables.add(toDisposable(() => storageService.flush()));

	services.set(IStorageKeysSyncRegistryService, new StorageKeysSyncRegistryChannelClient(mainProcessService.getChannel('storageKeysSyncRegistryService')));

	services.set(IEnvironmentService, environmentService);
	services.set(IProductService, { _serviceBrand: undefined, ...product });
	services.set(ILogService, logService);
	services.set(IConfigurationService, configurationService);
	services.set(IRequestService, new SyncDescriptor(RequestService));
	services.set(ILoggerService, new SyncDescriptor(LoggerService));

	const electronService = createChannelSender<IElectronService>(mainProcessService.getChannel('electron'), { context: configuration.windowId });
	services.set(IElectronService, electronService);

	services.set(IDownloadService, new SyncDescriptor(DownloadService));

	const instantiationService = new InstantiationService(services);

	let telemetryService: ITelemetryService;
	instantiationService.invokeFunction(accessor => {
		const services = new ServiceCollection();
		const { appRoot, extensionsPath, extensionDevelopmentLocationURI, isBuilt, installSourcePath } = environmentService;
		const telemetryLogService = new FollowerLogService(loggerClient, new SpdLogService('telemetry', environmentService.logsPath, initData.logLevel));
		telemetryLogService.info('The below are logs for every telemetry event sent from VS Code once the log level is set to trace.');
		telemetryLogService.info('===========================================================');

		let appInsightsAppender: ITelemetryAppender | null = NullAppender;
		if (!extensionDevelopmentLocationURI && !environmentService.disableTelemetry && product.enableTelemetry) {
			if (product.aiConfig && product.aiConfig.asimovKey && isBuilt) {
				appInsightsAppender = new AppInsightsAppender(eventPrefix, null, product.aiConfig.asimovKey, telemetryLogService);
				disposables.add(toDisposable(() => appInsightsAppender!.flush())); // Ensure the AI appender is disposed so that it flushes remaining data
			}
			const config: ITelemetryServiceConfig = {
				appender: combinedAppender(appInsightsAppender, new LogAppender(logService)),
				commonProperties: resolveCommonProperties(product.commit, product.version, configuration.machineId, product.msftInternalDomains, installSourcePath),
				sendErrorTelemetry: true,
				piiPaths: extensionsPath ? [appRoot, extensionsPath] : [appRoot]
			};

			telemetryService = new TelemetryService(config, configurationService);
			services.set(ITelemetryService, telemetryService);
		} else {
			telemetryService = NullTelemetryService;
			services.set(ITelemetryService, NullTelemetryService);
		}
		server.registerChannel('telemetryAppender', new TelemetryAppenderChannel(appInsightsAppender));

		services.set(IExtensionManagementService, new SyncDescriptor(ExtensionManagementService));
		services.set(IExtensionGalleryService, new SyncDescriptor(ExtensionGalleryService));
		services.set(ILocalizationsService, new SyncDescriptor(LocalizationsService));
		services.set(IDiagnosticsService, new SyncDescriptor(DiagnosticsService));
		services.set(IExtensionTipsService, new SyncDescriptor(ExtensionTipsService));

		services.set(ICredentialsService, new SyncDescriptor(KeytarCredentialsService));
		services.set(IAuthenticationTokenService, new SyncDescriptor(AuthenticationTokenService));
		services.set(IUserDataSyncLogService, new SyncDescriptor(UserDataSyncLogService));
		services.set(IUserDataSyncUtilService, new UserDataSyncUtilServiceClient(server.getChannel('userDataSyncUtil', client => client.ctx !== 'main')));
		services.set(IGlobalExtensionEnablementService, new SyncDescriptor(GlobalExtensionEnablementService));
		services.set(IUserDataSyncStoreService, new SyncDescriptor(UserDataSyncStoreService));
		services.set(IUserDataSyncBackupStoreService, new SyncDescriptor(UserDataSyncBackupStoreService));
		services.set(IUserDataSyncEnablementService, new SyncDescriptor(UserDataSyncEnablementService));
		services.set(IUserDataSyncService, new SyncDescriptor(UserDataSyncService));
		registerConfiguration();

		const instantiationService2 = instantiationService.createChild(services);

		instantiationService2.invokeFunction(accessor => {

			const extensionManagementService = accessor.get(IExtensionManagementService);
			const channel = new ExtensionManagementChannel(extensionManagementService, () => null);
			server.registerChannel('extensions', channel);

			const localizationsService = accessor.get(ILocalizationsService);
			const localizationsChannel = createChannelReceiver(localizationsService);
			server.registerChannel('localizations', localizationsChannel);

			const diagnosticsService = accessor.get(IDiagnosticsService);
			const diagnosticsChannel = new DiagnosticsChannel(diagnosticsService);
			server.registerChannel('diagnostics', diagnosticsChannel);

			const extensionTipsService = accessor.get(IExtensionTipsService);
			const extensionTipsChannel = new ExtensionTipsChannel(extensionTipsService);
			server.registerChannel('extensionTipsService', extensionTipsChannel);

			const authTokenService = accessor.get(IAuthenticationTokenService);
			const authTokenChannel = new AuthenticationTokenServiceChannel(authTokenService);
			server.registerChannel('authToken', authTokenChannel);

			const userDataSyncService = accessor.get(IUserDataSyncService);
			const userDataSyncChannel = new UserDataSyncChannel(userDataSyncService);
			server.registerChannel('userDataSync', userDataSyncChannel);

			const userDataAutoSync = instantiationService2.createInstance(UserDataAutoSyncService);
			const userDataAutoSyncChannel = new UserDataAutoSyncChannel(userDataAutoSync);
			server.registerChannel('userDataAutoSync', userDataAutoSyncChannel);

			// clean up deprecated extensions
			(extensionManagementService as ExtensionManagementService).removeDeprecatedExtensions();
			// update localizations cache
			(localizationsService as LocalizationsService).update();
			// cache clean ups
			disposables.add(combinedDisposable(
				instantiationService2.createInstance(NodeCachedDataCleaner),
				instantiationService2.createInstance(LanguagePackCachedDataCleaner),
				instantiationService2.createInstance(StorageDataCleaner),
				instantiationService2.createInstance(LogsDataCleaner),
				userDataAutoSync
			));
			disposables.add(extensionManagementService as ExtensionManagementService);
		});
	});
}

function setupIPC(hook: string): Promise<Server> {
	function setup(retry: boolean): Promise<Server> {
		return serve(hook).then(null, err => {
			if (!retry || platform.isWindows || err.code !== 'EADDRINUSE') {
				return Promise.reject(err);
			}

			// should retry, not windows and eaddrinuse

			return connect(hook, '').then(
				client => {
					// we could connect to a running instance. this is not good, abort
					client.dispose();
					return Promise.reject(new Error('There is an instance already running.'));
				},
				err => {
					// it happens on Linux and OS X that the pipe is left behind
					// let's delete it, since we can't connect to it
					// and the retry the whole thing
					try {
						fs.unlinkSync(hook);
					} catch (e) {
						return Promise.reject(new Error('Error deleting the shared ipc hook.'));
					}

					return setup(false);
				}
			);
		});
	}

	return setup(true);
}

async function handshake(configuration: ISharedProcessConfiguration): Promise<void> {

	// receive payload from electron-main to start things
	const data = await new Promise<ISharedProcessInitData>(c => {
		ipcRenderer.once('electron-main->shared-process: payload', (_: any, r: ISharedProcessInitData) => c(r));

		// tell electron-main we are ready to receive payload
		ipcRenderer.send('shared-process->electron-main: ready-for-payload');
	});

	// await IPC connection and signal this back to electron-main
	const server = await setupIPC(data.sharedIPCHandle);
	ipcRenderer.send('shared-process->electron-main: ipc-ready');

	// await initialization and signal this back to electron-main
	await main(server, data, configuration);
	ipcRenderer.send('shared-process->electron-main: init-done');
}
