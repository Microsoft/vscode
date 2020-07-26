/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import TypeScriptServiceClientHost from '../typeScriptServiceClientHost';
import { Lazy } from '../utils/lazy';
import { PluginManager } from '../utils/plugins';
import { CommandManager } from './commandManager';
import { ConfigurePluginCommand } from './configurePlugin';
import { JavaScriptGoToProjectConfigCommand, TypeScriptGoToProjectConfigCommand } from './goToProjectConfiguration';
import { LearnMoreAboutRefactoringsCommand } from './learnMoreAboutRefactorings';
import { OpenTsServerLogCommand } from './openTsServerLog';
import { ReloadJavaScriptProjectsCommand, ReloadTypeScriptProjectsCommand } from './reloadProject';
import { RestartTsServerCommand } from './restartTsServer';
import { SelectTypeScriptVersionCommand } from './selectTypeScriptVersion';

export function registerBaseCommands(
	commandManager: CommandManager,
	lazyClientHost: Lazy<TypeScriptServiceClientHost>,
	pluginManager: PluginManager
): void {
	commandManager.register(new ReloadTypeScriptProjectsCommand(lazyClientHost));
	commandManager.register(new ReloadJavaScriptProjectsCommand(lazyClientHost));
	commandManager.register(new SelectTypeScriptVersionCommand(lazyClientHost));
	commandManager.register(new OpenTsServerLogCommand(lazyClientHost));
	commandManager.register(new RestartTsServerCommand(lazyClientHost));
	commandManager.register(new TypeScriptGoToProjectConfigCommand(lazyClientHost));
	commandManager.register(new JavaScriptGoToProjectConfigCommand(lazyClientHost));
	commandManager.register(new ConfigurePluginCommand(pluginManager));
	commandManager.register(new LearnMoreAboutRefactoringsCommand());
}
