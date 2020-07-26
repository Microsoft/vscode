/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as rimraf from 'rimraf';
import * as vscode from 'vscode';
import { Api, getExtensionApi } from './api';
import { registerBaseCommands } from './commands/index';
import { LanguageConfigurationManager } from './languageFeatures/languageConfiguration';
import { createLazyClientHost, lazilyActivateClient } from './lazyClientHost';
import { nodeRequestCancellerFactory } from './tsServer/cancellation.electron';
import { NodeLogDirectoryProvider } from './tsServer/logDirectoryProvider.electron';
import { ChildServerProcess } from './tsServer/serverProcess.electron';
import { DiskTypeScriptVersionProvider } from './tsServer/versionProvider.electron';
import { CommandManager } from './commands/commandManager';
import { onCaseInsenitiveFileSystem } from './utils/fileSystem.electron';
import { PluginManager } from './utils/plugins';
import * as temp from './utils/temp.electron';

export function activate(
	context: vscode.ExtensionContext
): Api {
	const pluginManager = new PluginManager();
	context.subscriptions.push(pluginManager);

	const commandManager = new CommandManager();
	context.subscriptions.push(commandManager);

	const onCompletionAccepted = new vscode.EventEmitter<vscode.CompletionItem>();
	context.subscriptions.push(onCompletionAccepted);

	const logDirectoryProvider = new NodeLogDirectoryProvider(context);
	const versionProvider = new DiskTypeScriptVersionProvider();

	context.subscriptions.push(new LanguageConfigurationManager());

	const lazyClientHost = createLazyClientHost(context, onCaseInsenitiveFileSystem(), {
		pluginManager,
		commandManager,
		logDirectoryProvider,
		cancellerFactory: nodeRequestCancellerFactory,
		versionProvider,
		processFactory: ChildServerProcess,
	}, item => {
		onCompletionAccepted.fire(item);
	});

	registerBaseCommands(commandManager, lazyClientHost, pluginManager);

	import('./task/taskProvider').then(module => {
		context.subscriptions.push(module.register(lazyClientHost.map(x => x.serviceClient)));
	});

	import('./languageFeatures/tsconfig').then(module => {
		context.subscriptions.push(module.register());
	});

	context.subscriptions.push(lazilyActivateClient(lazyClientHost, pluginManager));

	return getExtensionApi(onCompletionAccepted.event, pluginManager);
}

export function deactivate() {
	rimraf.sync(temp.getInstanceTempDir());
}
