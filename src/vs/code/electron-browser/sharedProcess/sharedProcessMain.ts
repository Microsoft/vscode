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
import { IEnvironmentService, INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { NativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { ExtensionManagementChannel, ExtensionTipsChannel } from 'vs/platform/extensionManagement/common/extensionManagementIpc';
import { IExtensionManagementService, IExtensionGalleryService, IGlobalExtensionEnablementService, IExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionManagementService } from 'vs/platform/extensionManagement/node/extensionManagementService';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionGalleryService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationService } from 'vs/platform/configuration/common/configurationService';
import { IRequestService } from 'vs/platform/request/common/request';
import { RequestService } from 'vs/platform/request/browser/requestService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { combinedAppender, NullTelemetryService, ITelemetryAppender, NullAppender } from 'vs/platform/telemetry/common/telemetryUtils';
import { resolveCommonProperties } from 'vs/platform/telemetry/node/commonProperties';
import { TelemetryAppenderChannel } from 'vs/platform/telemetry/node/telemetryIpc';
import { TelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { AppInsightsAppender } from 'vs/platform/telemetry/node/appInsightsAppender';
import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { ILogService, LogLevel, ILoggerService } from 'vs/platform/log/common/log';
import { LoggerChannelClient, FollowerLogService } from 'vs/platform/log/common/logIpc';
import { LocalizationsService } from 'vs/platform/localizations/node/localizations';
import { ILocalizationsService } from 'vs/platform/localizations/common/localizations';
import { combinedDisposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { DownloadService } from 'vs/platform/download/common/downloadService';
import { IDownloadService } from 'vs/platform/download/common/download';
import { IChannel, IServerChannel, StaticRouter, createChannelSender, createChannelReceiver } from 'vs/base/parts/ipc/common/ipc';
import { NodeCachedDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/nodeCachedDataCleaner';
import { LanguagePackCachedDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/languagePackCachedDataCleaner';
import { StorageDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/storageDataCleaner';
import { LogsDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/logsDataCleaner';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { SpdLogService } from 'vs/platform/log/node/spdlogService';
import { DiagnosticsService, IDiagnosticsService } from 'vs/platform/diagnostics/node/diagnosticsService';
import { FileService } from 'vs/platform/files/common/fileService';
import { IFileService } from 'vs/platform/files/common/files';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { IProductService } from 'vs/platform/product/common/productService';
import { IUserDataSyncService, IUserDataSyncStoreService, registerConfiguration, IUserDataSyncLogService, IUserDataSyncUtilService, IUserDataSyncResourceEnablementService, IUserDataSyncBackupStoreService, IUserDataSyncStoreManagementService, IUserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { UserDataSyncStoreService, UserDataSyncStoreManagementService } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { UserDataSyncChannel, UserDataSyncUtilServiceClient, UserDataAutoSyncChannel, UserDataSyncMachinesServiceChannel, UserDataSyncAccountServiceChannel, UserDataSyncStoreManagementServiceChannel } from 'vs/platform/userDataSync/common/userDataSyncIpc';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { LoggerService } from 'vs/platform/log/node/loggerService';
import { UserDataSyncLogService } from 'vs/platform/userDataSync/common/userDataSyncLog';
import { UserDataAutoSyncService } from 'vs/platform/userDataSync/electron-sandbox/userDataAutoSyncService';
import { NativeStorageService } from 'vs/platform/storage/node/storageService';
import { GlobalStorageDatabaseChannelClient } from 'vs/platform/storage/node/storageIpc';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { GlobalExtensionEnablementService } from 'vs/platform/extensionManagement/common/extensionEnablementService';
import { UserDataSyncResourceEnablementService } from 'vs/platform/userDataSync/common/userDataSyncResourceEnablementService';
import { IUserDataSyncAccountService, UserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { UserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSyncBackupStoreService';
import { ExtensionTipsService } from 'vs/platform/extensionManagement/electron-sandbox/extensionTipsService';
import { UserDataSyncMachinesService, IUserDataSyncMachinesService } from 'vs/platform/userDataSync/common/userDataSyncMachines';
import { IExtensionRecommendationNotificationService } from 'vs/platform/extensionRecommendations/common/extensionRecommendations';
import { ExtensionRecommendationNotificationServiceChannelClient } from 'vs/platform/extensionRecommendations/electron-sandbox/extensionRecommendationsIpc';
import { ActiveWindowManager } from 'vs/platform/windows/common/windowTracker';
import { TelemetryLogAppender } from 'vs/platform/telemetry/common/telemetryLogAppender';
import { UserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';
import { IgnoredExtensionsManagementService, IIgnoredExtensionsManagementService } from 'vs/platform/userDataSync/common/ignoredExtensions';
import { ExtensionsStorageSyncService, IExtensionsStorageSyncService } from 'vs/platform/userDataSync/common/extensionsStorageSync';

export interface ISharedProcessConfiguration {
	readonly machineId: string;
	readonly windowId: number;
}

export function startup(configuration: ISharedProcessConfiguration) {
	handshake(configuration);
}

interface ISharedProcessInitData {
	sharedIPCHandle: string;
	args: NativeParsedArgs;
	logLevel: LogLevel;
	nodeCachedDataDir?: string;
	backupWorkspacesPath: string;
}

const eventPrefix = 'monacoworkbench';

class MainProcessService implements IMainProcessService {

	constructor(
		private server: Server,
		private mainRouter: StaticRouter
	) { }

	declare readonly _serviceBrand: undefined;

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
	ipcRenderer.once('vscode:electron-main->shared-process=exit', onExit);

	disposables.add(server);

	const environmentService = new NativeEnvironmentService(initData.args);

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

	services.set(IEnvironmentService, environmentService);
	services.set(INativeEnvironmentService, environmentService);

	services.set(IProductService, { _serviceBrand: undefined, ...product });
	services.set(ILogService, logService);
	services.set(IConfigurationService, configurationService);
	services.set(IRequestService, new SyncDescriptor(RequestService));
	services.set(ILoggerService, new SyncDescriptor(LoggerService));

	const nativeHostService = createChannelSender<INativeHostService>(mainProcessService.getChannel('nativeHost'), { context: configuration.windowId });
	services.set(INativeHostService, nativeHostService);
	const activeWindowManager = new ActiveWindowManager(nativeHostService);
	const activeWindowRouter = new StaticRouter(ctx => activeWindowManager.getActiveClientId().then(id => ctx === id));

	services.set(IDownloadService, new SyncDescriptor(DownloadService));
	services.set(IExtensionRecommendationNotificationService, new ExtensionRecommendationNotificationServiceChannelClient(server.getChannel('IExtensionRecommendationNotificationService', activeWindowRouter)));

	const instantiationService = new InstantiationService(services);

	let telemetryService: ITelemetryService;
	instantiationService.invokeFunction(accessor => {
		const services = new ServiceCollection();
		const { appRoot, extensionsPath, extensionDevelopmentLocationURI, isBuilt, installSourcePath } = environmentService;

		let telemetryAppender: ITelemetryAppender = NullAppender;
		if (!extensionDevelopmentLocationURI && !environmentService.disableTelemetry && product.enableTelemetry) {
			telemetryAppender = new TelemetryLogAppender(accessor.get(ILoggerService), environmentService);
			if (product.aiConfig && product.aiConfig.asimovKey && isBuilt) {
				const appInsightsAppender = new AppInsightsAppender(eventPrefix, null, product.aiConfig.asimovKey);
				disposables.add(toDisposable(() => appInsightsAppender!.flush())); // Ensure the AI appender is disposed so that it flushes remaining data
				telemetryAppender = combinedAppender(appInsightsAppender, telemetryAppender);
			}
			const config: ITelemetryServiceConfig = {
				appender: telemetryAppender,
				commonProperties: resolveCommonProperties(product.commit, product.version, configuration.machineId, product.msftInternalDomains, installSourcePath),
				sendErrorTelemetry: true,
				piiPaths: [appRoot, extensionsPath]
			};

			telemetryService = new TelemetryService(config, configurationService);
			services.set(ITelemetryService, telemetryService);
		} else {
			telemetryService = NullTelemetryService;
			services.set(ITelemetryService, NullTelemetryService);
		}
		server.registerChannel('telemetryAppender', new TelemetryAppenderChannel(telemetryAppender));

		services.set(IExtensionManagementService, new SyncDescriptor(ExtensionManagementService));
		services.set(IExtensionGalleryService, new SyncDescriptor(ExtensionGalleryService));
		services.set(ILocalizationsService, new SyncDescriptor(LocalizationsService));
		services.set(IDiagnosticsService, new SyncDescriptor(DiagnosticsService));
		services.set(IExtensionTipsService, new SyncDescriptor(ExtensionTipsService));

		services.set(IUserDataSyncAccountService, new SyncDescriptor(UserDataSyncAccountService));
		services.set(IUserDataSyncLogService, new SyncDescriptor(UserDataSyncLogService));
		services.set(IUserDataSyncUtilService, new UserDataSyncUtilServiceClient(server.getChannel('userDataSyncUtil', client => client.ctx !== 'main')));
		services.set(IGlobalExtensionEnablementService, new SyncDescriptor(GlobalExtensionEnablementService));
		services.set(IIgnoredExtensionsManagementService, new SyncDescriptor(IgnoredExtensionsManagementService));
		services.set(IExtensionsStorageSyncService, new SyncDescriptor(ExtensionsStorageSyncService));
		services.set(IUserDataSyncStoreManagementService, new SyncDescriptor(UserDataSyncStoreManagementService));
		services.set(IUserDataSyncStoreService, new SyncDescriptor(UserDataSyncStoreService));
		services.set(IUserDataSyncMachinesService, new SyncDescriptor(UserDataSyncMachinesService));
		services.set(IUserDataSyncBackupStoreService, new SyncDescriptor(UserDataSyncBackupStoreService));
		services.set(IUserDataAutoSyncEnablementService, new SyncDescriptor(UserDataAutoSyncEnablementService));
		services.set(IUserDataSyncResourceEnablementService, new SyncDescriptor(UserDataSyncResourceEnablementService));
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
			const diagnosticsChannel = createChannelReceiver(diagnosticsService);
			server.registerChannel('diagnostics', diagnosticsChannel);

			const extensionTipsService = accessor.get(IExtensionTipsService);
			const extensionTipsChannel = new ExtensionTipsChannel(extensionTipsService);
			server.registerChannel('extensionTipsService', extensionTipsChannel);

			const userDataSyncMachinesService = accessor.get(IUserDataSyncMachinesService);
			const userDataSyncMachineChannel = new UserDataSyncMachinesServiceChannel(userDataSyncMachinesService);
			server.registerChannel('userDataSyncMachines', userDataSyncMachineChannel);

			const authTokenService = accessor.get(IUserDataSyncAccountService);
			const authTokenChannel = new UserDataSyncAccountServiceChannel(authTokenService);
			server.registerChannel('userDataSyncAccount', authTokenChannel);

			const userDataSyncStoreManagementService = accessor.get(IUserDataSyncStoreManagementService);
			const userDataSyncStoreManagementChannel = new UserDataSyncStoreManagementServiceChannel(userDataSyncStoreManagementService);
			server.registerChannel('userDataSyncStoreManagement', userDataSyncStoreManagementChannel);

			const userDataSyncService = accessor.get(IUserDataSyncService);
			const userDataSyncChannel = new UserDataSyncChannel(server, userDataSyncService, logService);
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
				new NodeCachedDataCleaner(initData.nodeCachedDataDir),
				instantiationService2.createInstance(LanguagePackCachedDataCleaner),
				instantiationService2.createInstance(StorageDataCleaner, initData.backupWorkspacesPath),
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
		ipcRenderer.once('vscode:electron-main->shared-process=payload', (event: unknown, r: ISharedProcessInitData) => c(r));

		// tell electron-main we are ready to receive payload
		ipcRenderer.send('vscode:shared-process->electron-main=ready-for-payload');
	});

	// await IPC connection and signal this back to electron-main
	const server = await setupIPC(data.sharedIPCHandle);
	ipcRenderer.send('vscode:shared-process->electron-main=ipc-ready');

	// await initialization and signal this back to electron-main
	await main(server, data, configuration);
	ipcRenderer.send('vscode:shared-process->electron-main=init-done');
}
