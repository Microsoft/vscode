/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/platform/update/common/update.config.contribution';
import { app, dialog } from 'electron';
import { isWindows, IProcessEnvironment } from 'vs/base/common/platform';
import product from 'vs/platform/product/common/product';
import { parseMainProcessArgv, addArg } from 'vs/platform/environment/node/argvHelper';
import { createWaitMarkerFile } from 'vs/platform/environment/node/waitMarkerFile';
import { mkdirp } from 'vs/base/node/pfs';
import { validatePaths } from 'vs/code/node/paths';
import { LifecycleMainService, ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { Server, serve, connect } from 'vs/base/parts/ipc/node/ipc.net';
import { createChannelSender } from 'vs/base/parts/ipc/common/ipc';
import { ILaunchMainService } from 'vs/platform/launch/electron-main/launchMainService';
import { ServicesAccessor, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ILogService, ConsoleLogMainService, MultiplexLogService, getLogLevel } from 'vs/platform/log/common/log';
import { StateService } from 'vs/platform/state/node/stateService';
import { IStateService } from 'vs/platform/state/node/state';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ParsedArgs } from 'vs/platform/environment/node/argv';
import { EnvironmentService, xdgRuntimeDir, INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationService } from 'vs/platform/configuration/common/configurationService';
import { IRequestService } from 'vs/platform/request/common/request';
import { RequestMainService } from 'vs/platform/request/electron-main/requestMainService';
import * as fs from 'fs';
import { CodeApplication } from 'vs/code/electron-main/app';
import { localize } from 'vs/nls';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { SpdLogService } from 'vs/platform/log/node/spdlogService';
import { BufferLogService } from 'vs/platform/log/common/bufferLog';
import { setUnexpectedErrorHandler } from 'vs/base/common/errors';
import { IThemeMainService, ThemeMainService } from 'vs/platform/theme/electron-main/themeMainService';
import { Client } from 'vs/base/parts/ipc/common/ipc.net';
import { once } from 'vs/base/common/functional';
import { ISignService } from 'vs/platform/sign/common/sign';
import { SignService } from 'vs/platform/sign/node/signService';
import { DiagnosticsService } from 'vs/platform/diagnostics/node/diagnosticsIpc';
import { FileService } from 'vs/platform/files/common/fileService';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { IFileService } from 'vs/platform/files/common/files';
import { IStorageKeysSyncRegistryService, StorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { TunnelService } from 'vs/platform/remote/node/tunnelService';
import { IProductService } from 'vs/platform/product/common/productService';

class ExpectedError extends Error {
	readonly isExpected = true;
}

class CodeMain {

	main(): void {

		// Set the error handler early enough so that we are not getting the
		// default electron error dialog popping up
		setUnexpectedErrorHandler(err => console.error(err));

		// Parse arguments
		let args: ParsedArgs;
		try {
			args = parseMainProcessArgv(process.argv);
			args = validatePaths(args);
		} catch (err) {
			console.error(err.message);
			app.exit(1);

			return;
		}

		// If we are started with --wait create a random temporary file
		// and pass it over to the starting instance. We can use this file
		// to wait for it to be deleted to monitor that the edited file
		// is closed and then exit the waiting process.
		//
		// Note: we are not doing this if the wait marker has been already
		// added as argument. This can happen if Code was started from CLI.
		if (args.wait && !args.waitMarkerFilePath) {
			const waitMarkerFilePath = createWaitMarkerFile(args.verbose);
			if (waitMarkerFilePath) {
				addArg(process.argv, '--waitMarkerFilePath', waitMarkerFilePath);
				args.waitMarkerFilePath = waitMarkerFilePath;
			}
		}

		// Launch
		this.startup(args);
	}

	private async startup(args: ParsedArgs): Promise<void> {

		// We need to buffer the spdlog logs until we are sure
		// we are the only instance running, otherwise we'll have concurrent
		// log file access on Windows (https://github.com/Microsoft/vscode/issues/41218)
		const bufferLogService = new BufferLogService();

		const [instantiationService, instanceEnvironment, environmentService] = this.createServices(args, bufferLogService);
		try {

			// Init services
			await instantiationService.invokeFunction(async accessor => {
				const configurationService = accessor.get(IConfigurationService);
				const stateService = accessor.get(IStateService);

				try {
					await this.initServices(environmentService, configurationService as ConfigurationService, stateService as StateService);
				} catch (error) {

					// Show a dialog for errors that can be resolved by the user
					this.handleStartupDataDirError(environmentService, error);

					throw error;
				}
			});

			// Startup
			await instantiationService.invokeFunction(async accessor => {
				const logService = accessor.get(ILogService);
				const lifecycleMainService = accessor.get(ILifecycleMainService);
				const fileService = accessor.get(IFileService);
				const configurationService = accessor.get(IConfigurationService);

				const mainIpcServer = await this.doStartup(args, logService, environmentService, lifecycleMainService, instantiationService, true);

				bufferLogService.logger = new SpdLogService('main', environmentService.logsPath, bufferLogService.getLevel());
				once(lifecycleMainService.onWillShutdown)(() => {
					fileService.dispose();
					(configurationService as ConfigurationService).dispose();
				});

				return instantiationService.createInstance(CodeApplication, mainIpcServer, instanceEnvironment).startup();
			});
		} catch (error) {
			instantiationService.invokeFunction(this.quit, error);
		}
	}

	private createServices(args: ParsedArgs, bufferLogService: BufferLogService): [IInstantiationService, IProcessEnvironment, INativeEnvironmentService] {
		const services = new ServiceCollection();

		const environmentService = new EnvironmentService(args, process.execPath);
		const instanceEnvironment = this.patchEnvironment(environmentService); // Patch `process.env` with the instance's environment
		services.set(IEnvironmentService, environmentService);

		const logService = new MultiplexLogService([new ConsoleLogMainService(getLogLevel(environmentService)), bufferLogService]);
		process.once('exit', () => logService.dispose());
		services.set(ILogService, logService);

		const fileService = new FileService(logService);
		services.set(IFileService, fileService);
		const diskFileSystemProvider = new DiskFileSystemProvider(logService);
		fileService.registerProvider(Schemas.file, diskFileSystemProvider);

		services.set(IConfigurationService, new ConfigurationService(environmentService.settingsResource, fileService));
		services.set(ILifecycleMainService, new SyncDescriptor(LifecycleMainService));
		services.set(IStateService, new SyncDescriptor(StateService));
		services.set(IRequestService, new SyncDescriptor(RequestMainService));
		services.set(IThemeMainService, new SyncDescriptor(ThemeMainService));
		services.set(ISignService, new SyncDescriptor(SignService));
		services.set(IStorageKeysSyncRegistryService, new SyncDescriptor(StorageKeysSyncRegistryService));
		services.set(IProductService, { _serviceBrand: undefined, ...product });
		services.set(ITunnelService, new SyncDescriptor(TunnelService));

		return [new InstantiationService(services, true), instanceEnvironment, environmentService];
	}

	private initServices(environmentService: INativeEnvironmentService, configurationService: ConfigurationService, stateService: StateService): Promise<unknown> {

		// Environment service (paths)
		const environmentServiceInitialization = Promise.all<void | undefined>([
			environmentService.extensionsPath,
			environmentService.nodeCachedDataDir,
			environmentService.logsPath,
			environmentService.globalStorageHome.fsPath,
			environmentService.workspaceStorageHome.fsPath,
			environmentService.backupHome.fsPath
		].map((path): undefined | Promise<void> => path ? mkdirp(path) : undefined));

		// Configuration service
		const configurationServiceInitialization = configurationService.initialize();

		// State service
		const stateServiceInitialization = stateService.init();

		return Promise.all([environmentServiceInitialization, configurationServiceInitialization, stateServiceInitialization]);
	}

	private patchEnvironment(environmentService: INativeEnvironmentService): IProcessEnvironment {
		const instanceEnvironment: IProcessEnvironment = {
			VSCODE_IPC_HOOK: environmentService.mainIPCHandle
		};

		['VSCODE_NLS_CONFIG', 'VSCODE_LOGS', 'VSCODE_PORTABLE'].forEach(key => {
			const value = process.env[key];
			if (typeof value === 'string') {
				instanceEnvironment[key] = value;
			}
		});

		Object.assign(process.env, instanceEnvironment);

		return instanceEnvironment;
	}

	private async doStartup(args: ParsedArgs, logService: ILogService, environmentService: INativeEnvironmentService, lifecycleMainService: ILifecycleMainService, instantiationService: IInstantiationService, retry: boolean): Promise<Server> {

		// Try to setup a server for running. If that succeeds it means
		// we are the first instance to startup. Otherwise it is likely
		// that another instance is already running.
		let server: Server;
		try {
			server = await serve(environmentService.mainIPCHandle);
			once(lifecycleMainService.onWillShutdown)(() => server.dispose());
		} catch (error) {

			// Handle unexpected errors (the only expected error is EADDRINUSE that
			// indicates a second instance of Code is running)
			if (error.code !== 'EADDRINUSE') {

				// Show a dialog for errors that can be resolved by the user
				this.handleStartupDataDirError(environmentService, error);

				// Any other runtime error is just printed to the console
				throw error;
			}

			// there's a running instance, let's connect to it
			let client: Client<string>;
			try {
				client = await connect(environmentService.mainIPCHandle, 'main');
			} catch (error) {

				// Handle unexpected connection errors by showing a dialog to the user
				if (!retry || isWindows || error.code !== 'ECONNREFUSED') {
					if (error.code === 'EPERM') {
						this.showStartupWarningDialog(
							localize('secondInstanceAdmin', "A second instance of {0} is already running as administrator.", product.nameShort),
							localize('secondInstanceAdminDetail', "Please close the other instance and try again.")
						);
					}

					throw error;
				}

				// it happens on Linux and OS X that the pipe is left behind
				// let's delete it, since we can't connect to it and then
				// retry the whole thing
				try {
					fs.unlinkSync(environmentService.mainIPCHandle);
				} catch (error) {
					logService.warn('Could not delete obsolete instance handle', error);

					throw error;
				}

				return this.doStartup(args, logService, environmentService, lifecycleMainService, instantiationService, false);
			}

			// Tests from CLI require to be the only instance currently
			if (environmentService.extensionTestsLocationURI && !environmentService.debugExtensionHost.break) {
				const msg = 'Running extension tests from the command line is currently only supported if no other instance of Code is running.';
				logService.error(msg);
				client.dispose();

				throw new Error(msg);
			}

			// Show a warning dialog after some timeout if it takes long to talk to the other instance
			// Skip this if we are running with --wait where it is expected that we wait for a while.
			// Also skip when gathering diagnostics (--status) which can take a longer time.
			let startupWarningDialogHandle: NodeJS.Timeout | undefined = undefined;
			if (!args.wait && !args.status) {
				startupWarningDialogHandle = setTimeout(() => {
					this.showStartupWarningDialog(
						localize('secondInstanceNoResponse', "Another instance of {0} is running but not responding", product.nameShort),
						localize('secondInstanceNoResponseDetail', "Please close all other instances and try again.")
					);
				}, 10000);
			}

			const launchService = createChannelSender<ILaunchMainService>(client.getChannel('launch'), { disableMarshalling: true });

			// Process Info
			if (args.status) {
				return instantiationService.invokeFunction(async accessor => {
					// Create a diagnostic service connected to the existing shared process
					const sharedProcessClient = await connect(environmentService.sharedIPCHandle, 'main');
					const diagnosticsChannel = sharedProcessClient.getChannel('diagnostics');
					const diagnosticsService = new DiagnosticsService(diagnosticsChannel);
					const mainProcessInfo = await launchService.getMainProcessInfo();
					const remoteDiagnostics = await launchService.getRemoteDiagnostics({ includeProcesses: true, includeWorkspaceMetadata: true });
					const diagnostics = await diagnosticsService.getDiagnostics(mainProcessInfo, remoteDiagnostics);
					console.log(diagnostics);

					throw new ExpectedError();
				});
			}

			// Windows: allow to set foreground
			if (isWindows) {
				await this.windowsAllowSetForegroundWindow(launchService, logService);
			}

			// Send environment over...
			logService.trace('Sending env to running instance...');
			await launchService.start(args, process.env as IProcessEnvironment);

			// Cleanup
			client.dispose();

			// Now that we started, make sure the warning dialog is prevented
			if (startupWarningDialogHandle) {
				clearTimeout(startupWarningDialogHandle);
			}

			throw new ExpectedError('Sent env to running instance. Terminating...');
		}

		// Print --status usage info
		if (args.status) {
			logService.warn('Warning: The --status argument can only be used if Code is already running. Please run it again after Code has started.');

			throw new ExpectedError('Terminating...');
		}

		// Set the VSCODE_PID variable here when we are sure we are the first
		// instance to startup. Otherwise we would wrongly overwrite the PID
		process.env['VSCODE_PID'] = String(process.pid);

		return server;
	}

	private handleStartupDataDirError(environmentService: INativeEnvironmentService, error: NodeJS.ErrnoException): void {
		if (error.code === 'EACCES' || error.code === 'EPERM') {
			const directories = [environmentService.userDataPath];

			if (environmentService.extensionsPath) {
				directories.push(environmentService.extensionsPath);
			}

			if (xdgRuntimeDir) {
				directories.push(xdgRuntimeDir);
			}

			this.showStartupWarningDialog(
				localize('startupDataDirError', "Unable to write program user data."),
				localize('startupUserDataAndExtensionsDirErrorDetail', "Please make sure the following directories are writeable:\n\n{0}", directories.join('\n'))
			);
		}
	}

	private showStartupWarningDialog(message: string, detail: string): void {
		dialog.showMessageBox({
			title: product.nameLong,
			type: 'warning',
			buttons: [mnemonicButtonLabel(localize({ key: 'close', comment: ['&& denotes a mnemonic'] }, "&&Close"))],
			message,
			detail,
			noLink: true
		});
	}

	private async windowsAllowSetForegroundWindow(launchService: ILaunchMainService, logService: ILogService): Promise<void> {
		if (isWindows) {
			const processId = await launchService.getMainProcessId();

			logService.trace('Sending some foreground love to the running instance:', processId);

			try {
				(await import('windows-foreground-love')).allowSetForegroundWindow(processId);
			} catch (error) {
				logService.error(error);
			}
		}
	}

	private quit(accessor: ServicesAccessor, reason?: ExpectedError | Error): void {
		const logService = accessor.get(ILogService);
		const lifecycleMainService = accessor.get(ILifecycleMainService);

		let exitCode = 0;

		if (reason) {
			if ((reason as ExpectedError).isExpected) {
				if (reason.message) {
					logService.trace(reason.message);
				}
			} else {
				exitCode = 1; // signal error to the outside

				if (reason.stack) {
					logService.error(reason.stack);
				} else {
					logService.error(`Startup error: ${reason.toString()}`);
				}
			}
		}

		lifecycleMainService.kill(exitCode);
	}
}

// Main Startup
const code = new CodeMain();
code.main();
