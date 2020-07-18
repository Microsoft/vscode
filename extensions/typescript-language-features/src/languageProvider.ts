/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'path';
import * as vscode from 'vscode';
import { CachedResponse } from './tsServer/cachedResponse';
import { DiagnosticKind } from './features/diagnostics';
import FileConfigurationManager from './features/fileConfigurationManager';
import TypeScriptServiceClient from './typescriptServiceClient';
import { CommandManager } from './utils/commandManager';
import { Disposable } from './utils/dispose';
import * as fileSchemes from './utils/fileSchemes';
import { LanguageDescription } from './utils/languageDescription';
import { memoize } from './utils/memoize';
import { TelemetryReporter } from './utils/telemetry';
import TypingsStatus from './utils/typingsStatus';


const validateSetting = 'validate.enable';
const suggestionSetting = 'suggestionActions.enabled';

export default class LanguageProvider extends Disposable {

	constructor(
		private readonly client: TypeScriptServiceClient,
		private readonly description: LanguageDescription,
		private readonly commandManager: CommandManager,
		private readonly telemetryReporter: TelemetryReporter,
		private readonly typingsStatus: TypingsStatus,
		private readonly fileConfigurationManager: FileConfigurationManager,
		private readonly onCompletionAccepted: (item: vscode.CompletionItem) => void,
	) {
		super();
		vscode.workspace.onDidChangeConfiguration(this.configurationChanged, this, this._disposables);
		this.configurationChanged();

		client.onReady(() => this.registerProviders());
	}

	@memoize
	private get documentSelector(): vscode.DocumentFilter[] {
		const documentSelector = [];
		for (const language of this.description.modeIds) {
			for (const scheme of fileSchemes.supportedSchemes) {
				documentSelector.push({ language, scheme });
			}
		}
		return documentSelector;
	}

	private async registerProviders(): Promise<void> {
		const selector = this.documentSelector;

		const cachedResponse = new CachedResponse();

		await Promise.all([
			import('./features/completions').then(provider => this._register(provider.register(selector, this.description.id, this.client, this.typingsStatus, this.fileConfigurationManager, this.commandManager, this.telemetryReporter, this.onCompletionAccepted))),
			import('./features/definitions').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/directiveCommentCompletions').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/documentHighlight').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/documentSymbol').then(provider => this._register(provider.register(selector, this.client, cachedResponse))),
			import('./features/folding').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/formatting').then(provider => this._register(provider.register(selector, this.description.id, this.client, this.fileConfigurationManager))),
			import('./features/hover').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/implementations').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/implementationsCodeLens').then(provider => this._register(provider.register(selector, this.description.id, this.client, cachedResponse))),
			import('./features/jsDocCompletions').then(provider => this._register(provider.register(selector, this.description.id, this.client))),
			import('./features/organizeImports').then(provider => this._register(provider.register(selector, this.client, this.commandManager, this.fileConfigurationManager, this.telemetryReporter))),
			import('./features/quickFix').then(provider => this._register(provider.register(selector, this.client, this.fileConfigurationManager, this.commandManager, this.client.diagnosticsManager, this.telemetryReporter))),
			import('./features/fixAll').then(provider => this._register(provider.register(selector, this.client, this.fileConfigurationManager, this.client.diagnosticsManager))),
			import('./features/refactor').then(provider => this._register(provider.register(selector, this.client, this.fileConfigurationManager, this.commandManager, this.telemetryReporter))),
			import('./features/references').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/referencesCodeLens').then(provider => this._register(provider.register(selector, this.description.id, this.client, cachedResponse))),
			import('./features/rename').then(provider => this._register(provider.register(selector, this.client, this.fileConfigurationManager))),
			import('./features/smartSelect').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/signatureHelp').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/tagClosing').then(provider => this._register(provider.register(selector, this.description.id, this.client))),
			import('./features/typeDefinitions').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/semanticTokens').then(provider => this._register(provider.register(selector, this.client))),
			import('./features/callHierarchy').then(provider => this._register(provider.register(selector, this.client))),
		]);
	}

	private configurationChanged(): void {
		const config = vscode.workspace.getConfiguration(this.id, null);
		this.updateValidate(config.get(validateSetting, true));
		this.updateSuggestionDiagnostics(config.get(suggestionSetting, true));
	}

	public handles(resource: vscode.Uri, doc: vscode.TextDocument): boolean {
		if (doc && this.description.modeIds.indexOf(doc.languageId) >= 0) {
			return true;
		}

		const base = basename(resource.fsPath);
		return !!base && (!!this.description.configFilePattern && this.description.configFilePattern.test(base));
	}

	private get id(): string {
		return this.description.id;
	}

	public get diagnosticSource(): string {
		return this.description.diagnosticSource;
	}

	private updateValidate(value: boolean) {
		this.client.diagnosticsManager.setValidate(this._diagnosticLanguage, value);
	}

	private updateSuggestionDiagnostics(value: boolean) {
		this.client.diagnosticsManager.setEnableSuggestions(this._diagnosticLanguage, value);
	}

	public reInitialize(): void {
		this.client.diagnosticsManager.reInitialize();
	}

	public triggerAllDiagnostics(): void {
		this.client.bufferSyncSupport.requestAllDiagnostics();
	}

	public diagnosticsReceived(diagnosticsKind: DiagnosticKind, file: vscode.Uri, diagnostics: (vscode.Diagnostic & { reportUnnecessary: any, reportDeprecated: any })[]): void {
		const config = vscode.workspace.getConfiguration(this.id, file);
		const reportUnnecessary = config.get<boolean>('showUnused', true);
		const reportDeprecated = config.get<boolean>('showDeprecated', true);
		this.client.diagnosticsManager.updateDiagnostics(file, this._diagnosticLanguage, diagnosticsKind, diagnostics.filter(diag => {
			// Don't both reporting diagnostics we know will not be rendered
			if (!reportUnnecessary) {
				if (diag.reportUnnecessary && diag.severity === vscode.DiagnosticSeverity.Hint) {
					return false;
				}
			}
			if (!reportDeprecated) {
				if (diag.reportDeprecated && diag.severity === vscode.DiagnosticSeverity.Hint) {
					return false;
				}
			}
			return true;
		}));
	}

	public configFileDiagnosticsReceived(file: vscode.Uri, diagnostics: vscode.Diagnostic[]): void {
		this.client.diagnosticsManager.configFileDiagnosticsReceived(file, diagnostics);
	}

	private get _diagnosticLanguage() {
		return this.description.diagnosticLanguage;
	}
}
