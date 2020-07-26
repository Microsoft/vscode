/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import type * as Proto from '../protocol';
import { ClientCapability, ITypeScriptServiceClient } from '../typescriptService';
import API from '../utils/api';
import { nulToken } from '../utils/cancellation';
import { Command, CommandManager } from '../commands/commandManager';
import { conditionalRegistration, requireMinVersion, requireSomeCapability } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import { TelemetryReporter } from '../utils/telemetry';
import * as typeconverts from '../utils/typeConverters';
import FileConfigurationManager from './fileConfigurationManager';

const localize = nls.loadMessageBundle();


class OrganizeImportsCommand implements Command {
	public static readonly Id = '_typescript.organizeImports';

	public readonly id = OrganizeImportsCommand.Id;

	constructor(
		private readonly client: ITypeScriptServiceClient,
		private readonly telemetryReporter: TelemetryReporter,
	) { }

	public async execute(file: string): Promise<boolean> {
		/* __GDPR__
			"organizeImports.execute" : {
				"${include}": [
					"${TypeScriptCommonProperties}"
				]
			}
		*/
		this.telemetryReporter.logTelemetry('organizeImports.execute', {});

		const args: Proto.OrganizeImportsRequestArgs = {
			scope: {
				type: 'file',
				args: {
					file
				}
			}
		};
		const response = await this.client.interruptGetErr(() => this.client.execute('organizeImports', args, nulToken));
		if (response.type !== 'response' || !response.body) {
			return false;
		}

		const edits = typeconverts.WorkspaceEdit.fromFileCodeEdits(this.client, response.body);
		return vscode.workspace.applyEdit(edits);
	}
}

export class OrganizeImportsCodeActionProvider implements vscode.CodeActionProvider {
	public static readonly minVersion = API.v280;

	public constructor(
		private readonly client: ITypeScriptServiceClient,
		commandManager: CommandManager,
		private readonly fileConfigManager: FileConfigurationManager,
		telemetryReporter: TelemetryReporter,

	) {
		commandManager.register(new OrganizeImportsCommand(client, telemetryReporter));
	}

	public readonly metadata: vscode.CodeActionProviderMetadata = {
		providedCodeActionKinds: [vscode.CodeActionKind.SourceOrganizeImports]
	};

	public provideCodeActions(
		document: vscode.TextDocument,
		_range: vscode.Range,
		context: vscode.CodeActionContext,
		token: vscode.CancellationToken
	): vscode.CodeAction[] {
		const file = this.client.toOpenedFilePath(document);
		if (!file) {
			return [];
		}

		if (!context.only || !context.only.contains(vscode.CodeActionKind.SourceOrganizeImports)) {
			return [];
		}

		this.fileConfigManager.ensureConfigurationForDocument(document, token);

		const action = new vscode.CodeAction(
			localize('organizeImportsAction.title', "Organize Imports"),
			vscode.CodeActionKind.SourceOrganizeImports);
		action.command = { title: '', command: OrganizeImportsCommand.Id, arguments: [file] };
		return [action];
	}
}

export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient,
	commandManager: CommandManager,
	fileConfigurationManager: FileConfigurationManager,
	telemetryReporter: TelemetryReporter,
) {
	return conditionalRegistration([
		requireMinVersion(client, OrganizeImportsCodeActionProvider.minVersion),
		requireSomeCapability(client, ClientCapability.Semantic),
	], () => {
		const organizeImportsProvider = new OrganizeImportsCodeActionProvider(client, commandManager, fileConfigurationManager, telemetryReporter);
		return vscode.languages.registerCodeActionsProvider(selector.semantic,
			organizeImportsProvider,
			organizeImportsProvider.metadata);
	});
}
