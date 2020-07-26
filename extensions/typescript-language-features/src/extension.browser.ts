/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Api, getExtensionApi } from './api';
import { registerBaseCommands } from './commands/index';
import { LanguageConfigurationManager } from './languageFeatures/languageConfiguration';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { noopRequestCancellerFactory } from './tsServer/cancellation';
import { noopLogDirectoryProvider } from './tsServer/logDirectoryProvider';
import { ITypeScriptVersionProvider, TypeScriptVersion, TypeScriptVersionSource } from './tsServer/versionProvider';
import { WorkerServerProcess } from './tsServer/serverProcess.browser';
import API from './utils/api';
import { CommandManager } from './commands/commandManager';
import { TypeScriptServiceConfiguration } from './utils/configuration';
import { PluginManager } from './utils/plugins';

class StaticVersionProvider implements ITypeScriptVersionProvider {

	constructor(
		private readonly _version: TypeScriptVersion
	) { }

	updateConfiguration(_configuration: TypeScriptServiceConfiguration): void {
		// noop
	}

	get defaultVersion() { return this._version; }
	get bundledVersion() { return this._version; }

	readonly globalVersion = undefined;
	readonly localVersion = undefined;
	readonly localVersions = [];
}

export function activate(
	context: vscode.ExtensionContext
): Api {
	const pluginManager = new PluginManager();
	context.subscriptions.push(pluginManager);

	const commandManager = new CommandManager();
	context.subscriptions.push(commandManager);

	context.subscriptions.push(new LanguageConfigurationManager());

	const onCompletionAccepted = new vscode.EventEmitter<vscode.CompletionItem>();
	context.subscriptions.push(onCompletionAccepted);

	const versionProvider = new StaticVersionProvider(
		new TypeScriptVersion(
			TypeScriptVersionSource.Bundled,
			context.asAbsolutePath('dist/browser/typescript-web/tsserver.web.js'),
			API.v400));

	const lazyClientHost = createLazyClientHost(context, false, {
		pluginManager,
		commandManager,
		logDirectoryProvider: noopLogDirectoryProvider,
		cancellerFactory: noopRequestCancellerFactory,
		versionProvider,
		processFactory: WorkerServerProcess
	}, item => {
		onCompletionAccepted.fire(item);
	});

	registerBaseCommands(commandManager, lazyClientHost, pluginManager);

	// context.subscriptions.push(task.register(lazyClientHost.map(x => x.serviceClient)));

	import('./languageFeatures/tsconfig').then(module => {
		context.subscriptions.push(module.register());
	});

	context.subscriptions.push(lazilyActivateClient(lazyClientHost, pluginManager));

	return getExtensionApi(onCompletionAccepted.event, pluginManager);
}

