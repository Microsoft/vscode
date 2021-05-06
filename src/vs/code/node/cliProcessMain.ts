/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { release, hostname } from 'os';
import * as fs from 'fs';
import { gracefulify } from 'graceful-fs';
import { isAbsolute, join } from 'vs/base/common/path';
import { raceTimeout } from 'vs/base/common/async';
import product from 'vs/platform/product/common/product';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { NativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IExtensionManagementService, IExtensionGalleryService, IExtensionManagementCLIService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionManagementService } from 'vs/platform/extensionManagement/node/extensionManagementService';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionGalleryService';
import { ITelemetryService, machineIdKey } from 'vs/platform/telemetry/common/telemetry';
import { combinedAppender, NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { TelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { resolveCommonProperties } from 'vs/platform/telemetry/common/commonProperties';
import { IRequestService } from 'vs/platform/request/common/request';
import { RequestService } from 'vs/platform/request/node/requestService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationService } from 'vs/platform/configuration/common/configurationService';
import { AppInsightsAppender } from 'vs/platform/telemetry/node/appInsightsAppender';
import { ILogService, getLogLevel, LogLevel, ConsoleLogger, MultiplexLogService, ILogger } from 'vs/platform/log/common/log';
import { Schemas } from 'vs/base/common/network';
import { SpdLogLogger } from 'vs/platform/log/node/spdlogLog';
import { buildTelemetryMessage } from 'vs/platform/telemetry/node/telemetry';
import { FileService } from 'vs/platform/files/common/fileService';
import { IFileService } from 'vs/platform/files/common/files';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { Disposable } from 'vs/base/common/lifecycle';
import { IProductService } from 'vs/platform/product/common/productService';
import { ExtensionManagementCLIService } from 'vs/platform/extensionManagement/common/extensionManagementCLIService';
import { URI } from 'vs/base/common/uri';
import { LocalizationsService } from 'vs/platform/localizations/node/localizations';
import { ILocalizationsService } from 'vs/platform/localizations/common/localizations';
import { setUnexpectedErrorHandler } from 'vs/base/common/errors';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { VSBuffer } from 'vs/base/common/buffer';
import { cwd } from 'vs/base/common/process';

class CliMain extends Disposable {

	constructor(
		private argv: NativeParsedArgs
	) {
		super();

		// Enable gracefulFs
		gracefulify(fs);

		this.registerListeners();
	}

	private registerListeners(): void {

		// Dispose on exit
		process.once('exit', () => this.dispose());
	}

	async run(): Promise<void> {

		// Services
		const [instantiationService, appenders] = await this.initServices();

		return instantiationService.invokeFunction(async accessor => {
			const logService = accessor.get(ILogService);
			const fileService = accessor.get(IFileService);
			const environmentService = accessor.get(INativeEnvironmentService);
			const extensionManagementCLIService = accessor.get(IExtensionManagementCLIService);

			// Log info
			logService.info('CLI main', this.argv);

			// Error handler
			this.registerErrorHandler(logService);

			// Run based on argv
			await this.doRun(environmentService, extensionManagementCLIService, fileService);

			// Flush the remaining data in AI adapter (with 1s timeout)
			return raceTimeout(combinedAppender(...appenders).flush(), 1000);
		});
	}

	private async initServices(): Promise<[IInstantiationService, AppInsightsAppender[]]> {
		const services = new ServiceCollection();

		// Product
		const productService = { _serviceBrand: undefined, ...product };
		services.set(IProductService, productService);

		// Environment
		const environmentService = new NativeEnvironmentService(this.argv, productService);
		services.set(INativeEnvironmentService, environmentService);

		// Init folders
		await Promise.all([environmentService.appSettingsHome.fsPath, environmentService.extensionsPath].map(path => path ? fs.promises.mkdir(path, { recursive: true }) : undefined));

		// Log
		const logLevel = getLogLevel(environmentService);
		const loggers: ILogger[] = [];
		loggers.push(new SpdLogLogger('cli', join(environmentService.logsPath, 'cli.log'), true, logLevel));
		if (logLevel === LogLevel.Trace) {
			loggers.push(new ConsoleLogger(logLevel));
		}

		const logService = this._register(new MultiplexLogService(loggers));
		services.set(ILogService, logService);

		// Files
		const fileService = this._register(new FileService(logService));
		services.set(IFileService, fileService);

		const diskFileSystemProvider = this._register(new DiskFileSystemProvider(logService));
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);

		// Configuration
		const configurationService = this._register(new ConfigurationService(environmentService.settingsResource, fileService));
		services.set(IConfigurationService, configurationService);

		// Init config
		await configurationService.initialize();

		// Request
		services.set(IRequestService, new SyncDescriptor(RequestService));

		// Extensions
		services.set(IExtensionManagementService, new SyncDescriptor(ExtensionManagementService));
		services.set(IExtensionGalleryService, new SyncDescriptor(ExtensionGalleryService));
		services.set(IExtensionManagementCLIService, new SyncDescriptor(ExtensionManagementCLIService));

		// Localizations
		services.set(ILocalizationsService, new SyncDescriptor(LocalizationsService));

		// Telemetry
		const appenders: AppInsightsAppender[] = [];
		if (environmentService.isBuilt && !environmentService.isExtensionDevelopment && !environmentService.disableTelemetry && productService.enableTelemetry) {
			if (productService.aiConfig && productService.aiConfig.asimovKey) {
				appenders.push(new AppInsightsAppender('monacoworkbench', null, productService.aiConfig.asimovKey));
			}

			const { appRoot, extensionsPath, installSourcePath } = environmentService;

			const config: ITelemetryServiceConfig = {
				appender: combinedAppender(...appenders),
				sendErrorTelemetry: false,
				commonProperties: (async () => {
					let machineId: string | undefined = undefined;
					try {
						const storageContents = await fs.promises.readFile(join(environmentService.userDataPath, 'storage.json'));
						machineId = JSON.parse(storageContents.toString())[machineIdKey];
					} catch (error) {
						if (error.code !== 'ENOENT') {
							logService.error(error);
						}
					}

					return resolveCommonProperties(fileService, release(), hostname(), process.arch, productService.commit, productService.version, machineId, productService.msftInternalDomains, installSourcePath);
				})(),
				piiPaths: [appRoot, extensionsPath]
			};

			services.set(ITelemetryService, new SyncDescriptor(TelemetryService, [config]));

		} else {
			services.set(ITelemetryService, NullTelemetryService);
		}

		return [new InstantiationService(services), appenders];
	}

	private registerErrorHandler(logService: ILogService): void {

		// Install handler for unexpected errors
		setUnexpectedErrorHandler(error => {
			const message = toErrorMessage(error, true);
			if (!message) {
				return;
			}

			logService.error(`[uncaught exception in CLI]: ${message}`);
		});
	}

	private async doRun(environmentService: INativeEnvironmentService, extensionManagementCLIService: IExtensionManagementCLIService, fileService: IFileService): Promise<void> {

		// Install Source
		if (this.argv['install-source']) {
			return this.setInstallSource(environmentService, fileService, this.argv['install-source']);
		}

		// List Extensions
		if (this.argv['list-extensions']) {
			return extensionManagementCLIService.listExtensions(!!this.argv['show-versions'], this.argv['category']);
		}

		// Install Extension
		else if (this.argv['install-extension'] || this.argv['install-builtin-extension']) {
			return extensionManagementCLIService.installExtensions(this.asExtensionIdOrVSIX(this.argv['install-extension'] || []), this.argv['install-builtin-extension'] || [], !!this.argv['do-not-sync'], !!this.argv['force']);
		}

		// Uninstall Extension
		else if (this.argv['uninstall-extension']) {
			return extensionManagementCLIService.uninstallExtensions(this.asExtensionIdOrVSIX(this.argv['uninstall-extension']), !!this.argv['force']);
		}

		// Locate Extension
		else if (this.argv['locate-extension']) {
			return extensionManagementCLIService.locateExtension(this.argv['locate-extension']);
		}

		// Telemetry
		else if (this.argv['telemetry']) {
			console.log(buildTelemetryMessage(environmentService.appRoot, environmentService.extensionsPath));
		}
	}

	private asExtensionIdOrVSIX(inputs: string[]): (string | URI)[] {
		return inputs.map(input => /\.vsix$/i.test(input) ? URI.file(isAbsolute(input) ? input : join(cwd(), input)) : input);
	}

	private async setInstallSource(environmentService: INativeEnvironmentService, fileService: IFileService, installSource: string): Promise<void> {
		await fileService.writeFile(URI.file(environmentService.installSourcePath), VSBuffer.fromString(installSource.slice(0, 30)));
	}
}

export async function main(argv: NativeParsedArgs): Promise<void> {
	const cliMain = new CliMain(argv);

	try {
		await cliMain.run();
	} finally {
		cliMain.dispose();
	}
}
