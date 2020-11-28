/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/platform/update/common/update.config.contribution';
import { app, dialog } from 'electron';
import * as fs from 'fs';
import { isWindows, IProcessEnvironment, isMacintosh } from 'vs/base/common/platform';
import product from 'vs/platform/product/common/product';
import { parseMainProcessArgv, addArg } from 'vs/platform/environment/node/argvHelper';
import { createWaitMarkerFile } from 'vs/platform/environment/node/waitMarkerFile';
import { mkdirp } from 'vs/base/node/pfs';
import { LifecycleMainService, ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { Server, serve, connect, XDG_RUNTIME_DIR } from 'vs/base/parts/ipc/node/ipc.net';
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
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationService } from 'vs/platform/configuration/common/configurationService';
import { IRequestService } from 'vs/platform/request/common/request';
import { RequestMainService } from 'vs/platform/request/electron-main/requestMainService';
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
import { IDiagnosticsService } from 'vs/platform/diagnostics/node/diagnosticsService';
import { FileService } from 'vs/platform/files/common/fileService';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { Schemas } from 'vs/base/common/network';
import { IFileService } from 'vs/platform/files/common/files';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { TunnelService } from 'vs/platform/remote/node/tunnelService';
import { IProductService } from 'vs/platform/product/common/productService';
import { IPathWithLineAndColumn, isValidBasename, parseLineAndColumnAware, sanitizeFilePath } from 'vs/base/common/extpath';
import { isNumber } from 'vs/base/common/types';
import { rtrim, trim } from 'vs/base/common/strings';
import { basename, resolve } from 'vs/base/common/path';
import { coalesce, distinct } from 'vs/base/common/arrays';
import { EnvironmentMainService, IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';

class ExpectedError extends Error {
	readonly isExpected = true;
}

class CodeMain {

	main(): void {

		// Set the error handler early enough so that we are not getting the
		// default electron error dialog popping up
		setUnexpectedErrorHandler(err => console.error(err));

		// Parse arguments
		let args: NativeParsedArgs;
		try {
			args = parseMainProcessArgv(process.argv);
			args = this.validatePaths(args);
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

	private async startup(args: NativeParsedArgs): Promise<void> {

		// We need to buffer the spdlog logs until we are sure
		// we are the only instance running, otherwise we'll have concurrent
		// log file access on Windows (https://github.com/microsoft/vscode/issues/41218)
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

	private createServices(args: NativeParsedArgs, bufferLogService: BufferLogService): [IInstantiationService, IProcessEnvironment, IEnvironmentMainService] {
		const services = new ServiceCollection();

		const environmentService = new EnvironmentMainService(args);
		const instanceEnvironment = this.patchEnvironment(environmentService); // Patch `process.env` with the instance's environment
		services.set(IEnvironmentService, environmentService);
		services.set(IEnvironmentMainService, environmentService);

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
		services.set(IProductService, { _serviceBrand: undefined, ...product });
		services.set(ITunnelService, new SyncDescriptor(TunnelService));

		return [new InstantiationService(services, true), instanceEnvironment, environmentService];
	}

	private initServices(environmentService: IEnvironmentMainService, configurationService: ConfigurationService, stateService: StateService): Promise<unknown> {

		// Environment service (paths)
		const environmentServiceInitialization = Promise.all<void | undefined>([
			environmentService.extensionsPath,
			environmentService.nodeCachedDataDir,
			environmentService.logsPath,
			environmentService.globalStorageHome.fsPath,
			environmentService.workspaceStorageHome.fsPath,
			environmentService.backupHome
		].map((path): undefined | Promise<void> => path ? mkdirp(path) : undefined));

		// Configuration service
		const configurationServiceInitialization = configurationService.initialize();

		// State service
		const stateServiceInitialization = stateService.init();

		return Promise.all([environmentServiceInitialization, configurationServiceInitialization, stateServiceInitialization]);
	}

	private patchEnvironment(environmentService: IEnvironmentMainService): IProcessEnvironment {
		const instanceEnvironment: IProcessEnvironment = {
			VSCODE_IPC_HOOK: environmentService.mainIPCHandle
		};

		['VSCODE_NLS_CONFIG', 'VSCODE_PORTABLE'].forEach(key => {
			const value = process.env[key];
			if (typeof value === 'string') {
				instanceEnvironment[key] = value;
			}
		});

		Object.assign(process.env, instanceEnvironment);

		return instanceEnvironment;
	}

	private async doStartup(args: NativeParsedArgs, logService: ILogService, environmentService: IEnvironmentMainService, lifecycleMainService: ILifecycleMainService, instantiationService: IInstantiationService, retry: boolean): Promise<Server> {

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
				return instantiationService.invokeFunction(async () => {

					// Create a diagnostic service connected to the existing shared process
					const sharedProcessClient = await connect(environmentService.sharedIPCHandle, 'main');
					const diagnosticsChannel = sharedProcessClient.getChannel('diagnostics');
					const diagnosticsService = createChannelSender<IDiagnosticsService>(diagnosticsChannel);
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

	private handleStartupDataDirError(environmentService: IEnvironmentMainService, error: NodeJS.ErrnoException): void {
		if (error.code === 'EACCES' || error.code === 'EPERM') {
			const directories = coalesce([environmentService.userDataPath, environmentService.extensionsPath, XDG_RUNTIME_DIR]);

			this.showStartupWarningDialog(
				localize('startupDataDirError', "Unable to write program user data."),
				localize('startupUserDataAndExtensionsDirErrorDetail', "Please make sure the following directories are writeable:\n\n{0}", directories.join('\n'))
			);
		}
	}

	private showStartupWarningDialog(message: string, detail: string): void {
		// use sync variant here because we likely exit after this method
		// due to startup issues and otherwise the dialog seems to disappear
		// https://github.com/microsoft/vscode/issues/104493
		dialog.showMessageBoxSync({
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

	//#region Helpers

	private validatePaths(args: NativeParsedArgs): NativeParsedArgs {

		// Track URLs if they're going to be used
		if (args['open-url']) {
			args._urls = args._;
			args._ = [];
		}

		// Normalize paths and watch out for goto line mode
		if (!args['remote']) {
			const paths = this.doValidatePaths(args._, args.goto);
			args._ = paths;
		}

		return args;
	}

	private doValidatePaths(args: string[], gotoLineMode?: boolean): string[] {
		const cwd = process.env['VSCODE_CWD'] || process.cwd();
		const result = args.map(arg => {
			let pathCandidate = String(arg);

			let parsedPath: IPathWithLineAndColumn | undefined = undefined;
			if (gotoLineMode) {
				parsedPath = parseLineAndColumnAware(pathCandidate);
				pathCandidate = parsedPath.path;
			}

			if (pathCandidate) {
				pathCandidate = this.preparePath(cwd, pathCandidate);
			}

			const sanitizedFilePath = sanitizeFilePath(pathCandidate, cwd);

			const filePathBasename = basename(sanitizedFilePath);
			if (filePathBasename /* can be empty if code is opened on root */ && !isValidBasename(filePathBasename)) {
				return null; // do not allow invalid file names
			}

			if (gotoLineMode && parsedPath) {
				parsedPath.path = sanitizedFilePath;

				return this.toPath(parsedPath);
			}

			return sanitizedFilePath;
		});

		const caseInsensitive = isWindows || isMacintosh;
		const distinctPaths = distinct(result, path => path && caseInsensitive ? path.toLowerCase() : (path || ''));

		return coalesce(distinctPaths);
	}

	private preparePath(cwd: string, path: string): string {

		// Trim trailing quotes
		if (isWindows) {
			path = rtrim(path, '"'); // https://github.com/microsoft/vscode/issues/1498
		}

		// Trim whitespaces
		path = trim(trim(path, ' '), '\t');

		if (isWindows) {

			// Resolve the path against cwd if it is relative
			path = resolve(cwd, path);

			// Trim trailing '.' chars on Windows to prevent invalid file names
			path = rtrim(path, '.');
		}

		return path;
	}

	private toPath(pathWithLineAndCol: IPathWithLineAndColumn): string {
		const segments = [pathWithLineAndCol.path];

		if (isNumber(pathWithLineAndCol.line)) {
			segments.push(String(pathWithLineAndCol.line));
		}

		if (isNumber(pathWithLineAndCol.column)) {
			segments.push(String(pathWithLineAndCol.column));
		}

		return segments.join(':');
	}

	//#endregion
}

// Main Startup
const code = new CodeMain();
code.main();
