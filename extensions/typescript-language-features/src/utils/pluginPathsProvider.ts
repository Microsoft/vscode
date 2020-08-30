/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as path from 'path';
import * as vscode from 'vscode';
import { TypeScriptServiceConfiguration } from './configuration';
import { RelativeWorkspacePathResolver } from './relativePathResolver';


export class TypeScriptPluginPathsProvider {

	public constructor(
		private configuration: TypeScriptServiceConfiguration
	) { }

	public updateConfiguration(configuration: TypeScriptServiceConfiguration): void {
		this.configuration = configuration;
	}

	public getPluginPaths(): string[] {
		const pluginPaths = [];
		for (const pluginPath of this.configuration.tsServerPluginPaths) {
			pluginPaths.push(...this.resolvePluginPath(pluginPath));
		}
		return pluginPaths;
	}

	private resolvePluginPath(pluginPath: string): string[] {
		if (path.isAbsolute(pluginPath)) {
			return [pluginPath];
		}

		const workspacePath = RelativeWorkspacePathResolver.asAbsoluteWorkspacePath(pluginPath);
		if (workspacePath !== undefined) {
			return [workspacePath];
		}

		return (vscode.workspace.workspaceFolders || [])
			.map(workspaceFolder => path.join(workspaceFolder.uri.fsPath, pluginPath));
	}
}
