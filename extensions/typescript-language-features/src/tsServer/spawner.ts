/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as vscode from 'vscode';
import { ClientCapabilities, ClientCapability } from '../typescriptService';
import API from '../utils/api';
import { SeparateSyntaxServerConfiguration, TsServerLogLevel, TypeScriptServiceConfiguration } from '../utils/configuration';
import * as electron from '../utils/electron';
import LogDirectoryProvider from '../utils/logDirectoryProvider';
import Logger from '../utils/logger';
import { TypeScriptPluginPathsProvider } from '../utils/pluginPathsProvider';
import { PluginManager } from '../utils/plugins';
import { ChildServerProcess } from '../utils/serverProcess';
import { TelemetryReporter } from '../utils/telemetry';
import Tracer from '../utils/tracer';
import { TypeScriptVersion, TypeScriptVersionProvider } from '../utils/versionProvider';
import { GetErrRoutingTsServer, ITypeScriptServer, PipeRequestCanceller, ProcessBasedTsServer, SyntaxRoutingTsServer, TsServerDelegate } from './server';

const enum ServerKind {
	Main = 'main',
	Syntax = 'syntax',
	Semantic = 'semantic',
	Diagnostics = 'diagnostics'
}

const enum CompositeServerType {
	/** Run a single server that handles all commands  */
	Single,

	/** Run a separate server for syntax commands */
	SeparateSyntax,

	/** Use a separate syntax server while the project is loading */
	DynamicSeparateSyntax,

	/** Only enable the syntax server */
	SyntaxOnly
}

export class TypeScriptServerSpawner {
	public constructor(
		private readonly _versionProvider: TypeScriptVersionProvider,
		private readonly _logDirectoryProvider: LogDirectoryProvider,
		private readonly _pluginPathsProvider: TypeScriptPluginPathsProvider,
		private readonly _logger: Logger,
		private readonly _telemetryReporter: TelemetryReporter,
		private readonly _tracer: Tracer,
	) { }

	public spawn(
		version: TypeScriptVersion,
		capabilities: ClientCapabilities,
		configuration: TypeScriptServiceConfiguration,
		pluginManager: PluginManager,
		delegate: TsServerDelegate,
	): ITypeScriptServer {
		let primaryServer: ITypeScriptServer;
		const serverType = this.getCompositeServerType(version, capabilities, configuration);
		switch (serverType) {
			case CompositeServerType.SeparateSyntax:
			case CompositeServerType.DynamicSeparateSyntax:
				{
					const enableDynamicRouting = serverType === CompositeServerType.DynamicSeparateSyntax;
					primaryServer = new SyntaxRoutingTsServer({
						syntax: this.spawnTsServer(ServerKind.Syntax, version, configuration, pluginManager),
						semantic: this.spawnTsServer(ServerKind.Semantic, version, configuration, pluginManager)
					}, delegate, enableDynamicRouting);
					break;
				}
			case CompositeServerType.Single:
				{
					primaryServer = this.spawnTsServer(ServerKind.Main, version, configuration, pluginManager);
					break;
				}
			case CompositeServerType.SyntaxOnly:
				{
					primaryServer = this.spawnTsServer(ServerKind.Syntax, version, configuration, pluginManager);
					break;
				}
		}

		if (this.shouldUseSeparateDiagnosticsServer(configuration)) {
			return new GetErrRoutingTsServer({
				getErr: this.spawnTsServer(ServerKind.Diagnostics, version, configuration, pluginManager),
				primary: primaryServer,
			}, delegate);
		}

		return primaryServer;
	}

	private getCompositeServerType(
		version: TypeScriptVersion,
		capabilities: ClientCapabilities,
		configuration: TypeScriptServiceConfiguration,
	): CompositeServerType {
		if (!capabilities.has(ClientCapability.Semantic)) {
			return CompositeServerType.SyntaxOnly;
		}

		switch (configuration.separateSyntaxServer) {
			case SeparateSyntaxServerConfiguration.Disabled:
				return CompositeServerType.Single;

			case SeparateSyntaxServerConfiguration.Enabled:
				if (version.apiVersion?.gte(API.v340)) {
					return version.apiVersion?.gte(API.v400)
						? CompositeServerType.DynamicSeparateSyntax
						: CompositeServerType.SeparateSyntax;
				}
				return CompositeServerType.Single;
		}
	}

	private shouldUseSeparateDiagnosticsServer(
		configuration: TypeScriptServiceConfiguration,
	): boolean {
		return configuration.enableProjectDiagnostics;
	}

	private spawnTsServer(
		kind: ServerKind,
		version: TypeScriptVersion,
		configuration: TypeScriptServiceConfiguration,
		pluginManager: PluginManager,
	): ITypeScriptServer {
		const apiVersion = version.apiVersion || API.defaultVersion;

		const { args, cancellationPipeName, tsServerLogFile } = this.getTsServerArgs(kind, configuration, version, apiVersion, pluginManager);

		if (TypeScriptServerSpawner.isLoggingEnabled(configuration)) {
			if (tsServerLogFile) {
				this._logger.info(`<${kind}> Log file: ${tsServerLogFile}`);
			} else {
				this._logger.error(`<${kind}> Could not create log directory`);
			}
		}

		this._logger.info(`<${kind}> Forking...`);
		const childProcess = electron.fork(version.tsServerPath, args, this.getForkOptions(kind, configuration));
		this._logger.info(`<${kind}> Starting...`);

		return new ProcessBasedTsServer(
			kind,
			new ChildServerProcess(childProcess),
			tsServerLogFile,
			new PipeRequestCanceller(kind, cancellationPipeName, this._tracer),
			version,
			this._telemetryReporter,
			this._tracer);
	}

	private getForkOptions(kind: ServerKind, configuration: TypeScriptServiceConfiguration) {
		const debugPort = TypeScriptServerSpawner.getDebugPort(kind);
		const inspectFlag = process.env['TSS_DEBUG_BRK'] ? '--inspect-brk' : '--inspect';
		const tsServerForkOptions: electron.ForkOptions = {
			execArgv: [
				...(debugPort ? [`${inspectFlag}=${debugPort}`] : []),
				...(configuration.maxTsServerMemory ? [`--max-old-space-size=${configuration.maxTsServerMemory}`] : [])
			]
		};
		return tsServerForkOptions;
	}

	private getTsServerArgs(
		kind: ServerKind,
		configuration: TypeScriptServiceConfiguration,
		currentVersion: TypeScriptVersion,
		apiVersion: API,
		pluginManager: PluginManager,
	): { args: string[], cancellationPipeName: string, tsServerLogFile: string | undefined } {
		const args: string[] = [];
		let tsServerLogFile: string | undefined;

		if (kind === ServerKind.Syntax) {
			args.push('--syntaxOnly');
		}

		if (apiVersion.gte(API.v250)) {
			args.push('--useInferredProjectPerProjectRoot');
		} else {
			args.push('--useSingleInferredProject');
		}

		if (configuration.disableAutomaticTypeAcquisition || kind === ServerKind.Syntax || kind === ServerKind.Diagnostics) {
			args.push('--disableAutomaticTypingAcquisition');
		}

		if (kind === ServerKind.Semantic || kind === ServerKind.Main) {
			args.push('--enableTelemetry');
		}

		const cancellationPipeName = electron.getTempFile('tscancellation');
		args.push('--cancellationPipeName', cancellationPipeName + '*');

		if (TypeScriptServerSpawner.isLoggingEnabled(configuration)) {
			const logDir = this._logDirectoryProvider.getNewLogDirectory();
			if (logDir) {
				tsServerLogFile = path.join(logDir, `tsserver.log`);
				args.push('--logVerbosity', TsServerLogLevel.toString(configuration.tsServerLogLevel));
				args.push('--logFile', tsServerLogFile);
			}
		}

		const pluginPaths = this._pluginPathsProvider.getPluginPaths();

		if (pluginManager.plugins.length) {
			args.push('--globalPlugins', pluginManager.plugins.map(x => x.name).join(','));

			const isUsingBundledTypeScriptVersion = currentVersion.path === this._versionProvider.defaultVersion.path;
			for (const plugin of pluginManager.plugins) {
				if (isUsingBundledTypeScriptVersion || plugin.enableForWorkspaceTypeScriptVersions) {
					pluginPaths.push(plugin.path);
				}
			}
		}

		if (pluginPaths.length !== 0) {
			args.push('--pluginProbeLocations', pluginPaths.join(','));
		}

		if (configuration.npmLocation) {
			args.push('--npmLocation', `"${configuration.npmLocation}"`);
		}

		if (apiVersion.gte(API.v260)) {
			args.push('--locale', TypeScriptServerSpawner.getTsLocale(configuration));
		}

		if (apiVersion.gte(API.v291)) {
			args.push('--noGetErrOnBackgroundUpdate');
		}

		if (apiVersion.gte(API.v345)) {
			args.push('--validateDefaultNpmLocation');
		}

		return { args, cancellationPipeName, tsServerLogFile };
	}

	private static getDebugPort(kind: ServerKind): number | undefined {
		if (kind === 'syntax') {
			// We typically only want to debug the main semantic server
			return undefined;
		}
		const value = process.env['TSS_DEBUG_BRK'] || process.env['TSS_DEBUG'];
		if (value) {
			const port = parseInt(value);
			if (!isNaN(port)) {
				return port;
			}
		}
		return undefined;
	}

	private static isLoggingEnabled(configuration: TypeScriptServiceConfiguration) {
		return configuration.tsServerLogLevel !== TsServerLogLevel.Off;
	}

	private static getTsLocale(configuration: TypeScriptServiceConfiguration): string {
		return configuration.locale
			? configuration.locale
			: vscode.env.language;
	}
}

