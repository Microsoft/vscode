/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import DocumentTracker from './documentTracker';
import CodeLensProvider from './codelensProvider';
import CommandHandler from './commandHandler';
import ContentProvider from './contentProvider';
import Decorator from './mergeDecorator';
import * as interfaces from './interfaces';

const ConfigurationSectionName = 'merge-conflict';

export default class ServiceWrapper implements vscode.Disposable {

	private services: vscode.Disposable[] = [];

	constructor(private context: vscode.ExtensionContext) {
	}

	begin() {

		let configuration = this.createExtensionConfiguration();
		const documentTracker = new DocumentTracker();

		this.services.push(
			documentTracker,
			new CommandHandler(documentTracker),
			new CodeLensProvider(documentTracker),
			new ContentProvider(this.context),
			new Decorator(this.context, documentTracker),
		);

		this.services.forEach((service: any) => {
			if (service.begin && service.begin instanceof Function) {
				service.begin(configuration);
			}
		});

		vscode.workspace.onDidChangeConfiguration(() => {
			this.services.forEach((service: any) => {
				if (service.configurationUpdated && service.configurationUpdated instanceof Function) {
					service.configurationUpdated(this.createExtensionConfiguration());
				}
			});
		});
	}

	createExtensionConfiguration(): interfaces.IExtensionConfiguration {
		const workspaceConfiguration = vscode.workspace.getConfiguration(ConfigurationSectionName);
		const codeLensEnabled: boolean = workspaceConfiguration.get('codeLens.enabled', true);
		const decoratorsEnabled: boolean = workspaceConfiguration.get('decorators.enabled', true);

		return {
			enableCodeLens: codeLensEnabled,
			enableDecorations: decoratorsEnabled,
			enableEditorOverview: decoratorsEnabled
		};
	}

	dispose() {
		this.services.forEach(disposable => disposable.dispose());
		this.services = [];
	}
}

