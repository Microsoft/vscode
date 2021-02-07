/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import product from 'vs/platform/product/common/product';
import * as fs from 'fs';
import { release } from 'os';
import { gracefulify } from 'graceful-fs';
import { Server as MessagePortServer } from 'vs/base/parts/ipc/electron-sandbox/ipc.mp';
import { StaticRouter, createChannelSender, createChannelReceiver } from 'vs/base/parts/ipc/common/ipc';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { IEnvironmentService, INativeEnvironmentService } from 'vs/platform/environment/common/environment';
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
import { resolveCommonProperties } from 'vs/platform/telemetry/common/commonProperties';
import { TelemetryAppenderChannel } from 'vs/platform/telemetry/common/telemetryIpc';
import { TelemetryService } from 'vs/platform/telemetry/common/telemetryService';
import { AppInsightsAppender } from 'vs/platform/telemetry/node/appInsightsAppender';
import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { ILogService, ILoggerService, MultiplexLogService, ConsoleLogger } from 'vs/platform/log/common/log';
import { LoggerChannelClient, FollowerLogService } from 'vs/platform/log/common/logIpc';
import { LocalizationsService } from 'vs/platform/localizations/node/localizations';
import { ILocalizationsService } from 'vs/platform/localizations/common/localizations';
import { combinedDisposable, Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { DownloadService } from 'vs/platform/download/common/downloadService';
import { IDownloadService } from 'vs/platform/download/common/download';
import { NodeCachedDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/nodeCachedDataCleaner';
import { LanguagePackCachedDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/languagePackCachedDataCleaner';
import { StorageDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/storageDataCleaner';
import { LogsDataCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/logsDataCleaner';
import { IMainProcessService, MessagePortMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { SpdLogLogger } from 'vs/platform/log/node/spdlogLog';
import { DiagnosticsService, IDiagnosticsService } from 'vs/platform/diagnostics/node/diagnosticsService';
import { FileService } from 'vs/platform/files/common/fileService';
import { IFileService } from 'vs/platform/files/common/files';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { IProductService } from 'vs/platform/product/common/productService';
import { IUserDataSyncService, IUserDataSyncStoreService, registerConfiguration as registerUserDataSyncConfiguration, IUserDataSyncLogService, IUserDataSyncUtilService, IUserDataSyncResourceEnablementService, IUserDataSyncBackupStoreService, IUserDataSyncStoreManagementService, IUserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
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
import { ActiveWindowManager } from 'vs/platform/windows/node/windowTracker';
import { TelemetryLogAppender } from 'vs/platform/telemetry/common/telemetryLogAppender';
import { UserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';
import { IgnoredExtensionsManagementService, IIgnoredExtensionsManagementService } from 'vs/platform/userDataSync/common/ignoredExtensions';
import { ExtensionsStorageSyncService, IExtensionsStorageSyncService } from 'vs/platform/userDataSync/common/extensionsStorageSync';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ISharedProcessConfiguration } from 'vs/platform/sharedProcess/node/sharedProcess';
import { LocalizationsUpdater } from 'vs/code/electron-browser/sharedProcess/contrib/localizationsUpdater';
import { DeprecatedExtensionsCleaner } from 'vs/code/electron-browser/sharedProcess/contrib/deprecatedExtensionsCleaner';
import { onUnexpectedError, setUnexpectedErrorHandler } from 'vs/base/common/errors';
import { toErrorMessage } from 'vs/base/common/errorMessage';

class SharedProcessMain extends Disposable {

	private server = this._register(new MessagePortServer());

	constructor(private configuration: ISharedProcessConfiguration) {
		super();

		// Enable gracefulFs
		gracefulify(fs);

		this.registerListeners();
	}

	private registerListeners(): void {

		// Dispose on exit
		const onExit = () => this.dispose();
		process.once('exit', onExit);
		ipcRenderer.once('vscode:electron-main->shared-process=exit', onExit);
	}

	async open(): Promise<void> {

		// Services
		const instantiationService = await this.initServices();

		// Config
		registerUserDataSyncConfiguration();

		instantiationService.invokeFunction(accessor => {
			const logService = accessor.get(ILogService);

			// Log info
			logService.trace('sharedProcess configuration', JSON.stringify(this.configuration));

			// Channels
			this.initChannels(accessor);

			// Error handler
			this.registerErrorHandler(logService);
		});

		// Instantiate Contributions
		this._register(combinedDisposable(
			new NodeCachedDataCleaner(this.configuration.nodeCachedDataDir),
			instantiationService.createInstance(LanguagePackCachedDataCleaner),
			instantiationService.createInstance(StorageDataCleaner, this.configuration.backupWorkspacesPath),
			instantiationService.createInstance(LogsDataCleaner),
			instantiationService.createInstance(LocalizationsUpdater),
			instantiationService.createInstance(DeprecatedExtensionsCleaner)
		));
	}

	private async initServices(): Promise<IInstantiationService> {
		const services = new ServiceCollection();

		// Environment
		const environmentService = new NativeEnvironmentService(this.configuration.args);
		services.set(IEnvironmentService, environmentService);
		services.set(INativeEnvironmentService, environmentService);

		// Log
		const mainRouter = new StaticRouter(ctx => ctx === 'main');
		const loggerClient = new LoggerChannelClient(this.server.getChannel('logger', mainRouter)); // we only use this for log levels
		const multiplexLogger = this._register(new MultiplexLogService([
			this._register(new ConsoleLogger(this.configuration.logLevel)),
			this._register(new SpdLogLogger('sharedprocess', environmentService.logsPath, this.configuration.logLevel))
		]));

		const logService = this._register(new FollowerLogService(loggerClient, multiplexLogger));
		services.set(ILogService, logService);

		// Main Process
		const mainProcessService = new MessagePortMainProcessService(this.server, mainRouter);
		services.set(IMainProcessService, mainProcessService);

		// Files
		const fileService = this._register(new FileService(logService));
		services.set(IFileService, fileService);

		const diskFileSystemProvider = this._register(new DiskFileSystemProvider(logService));
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);

		// Configuration
		const configurationService = this._register(new ConfigurationService(environmentService.settingsResource, fileService));
		services.set(IConfigurationService, configurationService);

		await configurationService.initialize();

		// Storage
		const storageService = new NativeStorageService(new GlobalStorageDatabaseChannelClient(mainProcessService.getChannel('storage')), logService, environmentService);
		services.set(IStorageService, storageService);

		await storageService.initialize();
		this._register(toDisposable(() => storageService.flush()));

		// Product
		services.set(IProductService, { _serviceBrand: undefined, ...product });

		// Request
		services.set(IRequestService, new SyncDescriptor(RequestService));

		// Native Host
		const nativeHostService = createChannelSender<INativeHostService>(mainProcessService.getChannel('nativeHost'), { context: this.configuration.windowId });
		services.set(INativeHostService, nativeHostService);

		// Download
		services.set(IDownloadService, new SyncDescriptor(DownloadService));

		// Extension recommendations
		const activeWindowManager = this._register(new ActiveWindowManager(nativeHostService));
		const activeWindowRouter = new StaticRouter(ctx => activeWindowManager.getActiveClientId().then(id => ctx === id));
		services.set(IExtensionRecommendationNotificationService, new ExtensionRecommendationNotificationServiceChannelClient(this.server.getChannel('extensionRecommendationNotification', activeWindowRouter)));

		// Logger
		const loggerService = this._register(new LoggerService(logService, fileService));
		services.set(ILoggerService, loggerService);

		// Telemetry
		const { appRoot, extensionsPath, extensionDevelopmentLocationURI, isBuilt, installSourcePath } = environmentService;

		let telemetryService: ITelemetryService;
		let telemetryAppender: ITelemetryAppender;
		if (!extensionDevelopmentLocationURI && !environmentService.disableTelemetry && product.enableTelemetry) {
			telemetryAppender = new TelemetryLogAppender(loggerService, environmentService);

			// Application Insights
			if (product.aiConfig && product.aiConfig.asimovKey && isBuilt) {
				const appInsightsAppender = new AppInsightsAppender('monacoworkbench', null, product.aiConfig.asimovKey);
				this._register(toDisposable(() => appInsightsAppender.flush())); // Ensure the AI appender is disposed so that it flushes remaining data
				telemetryAppender = combinedAppender(appInsightsAppender, telemetryAppender);
			}

			telemetryService = new TelemetryService({
				appender: telemetryAppender,
				commonProperties: resolveCommonProperties(fileService, release(), process.arch, product.commit, product.version, this.configuration.machineId, product.msftInternalDomains, installSourcePath),
				sendErrorTelemetry: true,
				piiPaths: [appRoot, extensionsPath]
			}, configurationService);
		} else {
			telemetryService = NullTelemetryService;
			telemetryAppender = NullAppender;
		}

		this.server.registerChannel('telemetryAppender', new TelemetryAppenderChannel(telemetryAppender));
		services.set(ITelemetryService, telemetryService);

		// Extension Management
		services.set(IExtensionManagementService, new SyncDescriptor(ExtensionManagementService));

		// Extension Gallery
		services.set(IExtensionGalleryService, new SyncDescriptor(ExtensionGalleryService));

		// Extension Tips
		services.set(IExtensionTipsService, new SyncDescriptor(ExtensionTipsService));

		// Localizations
		services.set(ILocalizationsService, new SyncDescriptor(LocalizationsService));

		// Diagnostics
		services.set(IDiagnosticsService, new SyncDescriptor(DiagnosticsService));

		// Settings Sync
		services.set(IUserDataSyncAccountService, new SyncDescriptor(UserDataSyncAccountService));
		services.set(IUserDataSyncLogService, new SyncDescriptor(UserDataSyncLogService));
		services.set(IUserDataSyncUtilService, new UserDataSyncUtilServiceClient(this.server.getChannel('userDataSyncUtil', client => client.ctx !== 'main')));
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

		return new InstantiationService(services);
	}

	private initChannels(accessor: ServicesAccessor): void {

		// Extensions Management
		const extensionManagementService = accessor.get(IExtensionManagementService);
		const channel = new ExtensionManagementChannel(extensionManagementService, () => null);
		this.server.registerChannel('extensions', channel);

		// Localizations
		const localizationsService = accessor.get(ILocalizationsService);
		const localizationsChannel = createChannelReceiver(localizationsService);
		this.server.registerChannel('localizations', localizationsChannel);

		// Diagnostics
		const diagnosticsService = accessor.get(IDiagnosticsService);
		const diagnosticsChannel = createChannelReceiver(diagnosticsService);
		this.server.registerChannel('diagnostics', diagnosticsChannel);

		// Extension Tips
		const extensionTipsService = accessor.get(IExtensionTipsService);
		const extensionTipsChannel = new ExtensionTipsChannel(extensionTipsService);
		this.server.registerChannel('extensionTipsService', extensionTipsChannel);

		// Settings Sync
		const userDataSyncMachinesService = accessor.get(IUserDataSyncMachinesService);
		const userDataSyncMachineChannel = new UserDataSyncMachinesServiceChannel(userDataSyncMachinesService);
		this.server.registerChannel('userDataSyncMachines', userDataSyncMachineChannel);

		const authTokenService = accessor.get(IUserDataSyncAccountService);
		const authTokenChannel = new UserDataSyncAccountServiceChannel(authTokenService);
		this.server.registerChannel('userDataSyncAccount', authTokenChannel);

		const userDataSyncStoreManagementService = accessor.get(IUserDataSyncStoreManagementService);
		const userDataSyncStoreManagementChannel = new UserDataSyncStoreManagementServiceChannel(userDataSyncStoreManagementService);
		this.server.registerChannel('userDataSyncStoreManagement', userDataSyncStoreManagementChannel);

		const userDataSyncService = accessor.get(IUserDataSyncService);
		const userDataSyncChannel = new UserDataSyncChannel(this.server, userDataSyncService, accessor.get(ILogService));
		this.server.registerChannel('userDataSync', userDataSyncChannel);

		const userDataAutoSync = this._register(accessor.get(IInstantiationService).createInstance(UserDataAutoSyncService));
		const userDataAutoSyncChannel = new UserDataAutoSyncChannel(userDataAutoSync);
		this.server.registerChannel('userDataAutoSync', userDataAutoSyncChannel);
	}

	private registerErrorHandler(logService: ILogService): void {

		// Listen on unhandled rejection events
		window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {

			// See https://developer.mozilla.org/en-US/docs/Web/API/PromiseRejectionEvent
			onUnexpectedError(event.reason);

			// Prevent the printing of this event to the console
			event.preventDefault();
		});

		// Install handler for unexpected errors
		setUnexpectedErrorHandler(error => {
			const message = toErrorMessage(error, true);
			if (!message) {
				return;
			}

			logService.error(`[uncaught exception in sharedProcess]: ${message}`);
		});
	}
}

export async function main(configuration: ISharedProcessConfiguration): Promise<void> {

	// create shared process and signal back to main that we are
	// ready to accept message ports as client connections
	const sharedProcess = new SharedProcessMain(configuration);
	ipcRenderer.send('vscode:shared-process->electron-main=ipc-ready');

	// await initialization and signal this back to electron-main
	await sharedProcess.open();
	ipcRenderer.send('vscode:shared-process->electron-main=init-done');
}
