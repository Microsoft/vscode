/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as nls from 'vscode-nls';

const localize = nls.loadMessageBundle();

import {
	workspace, window, languages, commands, ExtensionContext, extensions, Uri, LanguageConfiguration,
	Diagnostic, StatusBarAlignment, TextEditor, TextDocument, FormattingOptions, CancellationToken,
	ProviderResult, TextEdit, Range, Position, Disposable, CompletionItem, CompletionList, CompletionContext, Hover, MarkdownString,
} from 'vscode';
import {
	LanguageClientOptions, RequestType, NotificationType,
	DidChangeConfigurationNotification, HandleDiagnosticsSignature, ResponseError, DocumentRangeFormattingParams,
	DocumentRangeFormattingRequest, ProvideCompletionItemsSignature, ProvideHoverSignature, CommonLanguageClient
} from 'vscode-languageclient';

import { hash } from './utils/hash';
import { RequestService, joinPath } from './requests';

namespace VSCodeContentRequest {
	export const type: RequestType<string, string, any, any> = new RequestType('vscode/content');
}

namespace SchemaContentChangeNotification {
	export const type: NotificationType<string, any> = new NotificationType('json/schemaContent');
}

namespace ForceValidateRequest {
	export const type: RequestType<string, Diagnostic[], any, any> = new RequestType('json/validate');
}

export interface ISchemaAssociations {
	[pattern: string]: string[];
}

export interface ISchemaAssociation {
	fileMatch: string[];
	uri: string;
}

namespace SchemaAssociationNotification {
	export const type: NotificationType<ISchemaAssociations | ISchemaAssociation[], any> = new NotificationType('json/schemaAssociations');
}

namespace ResultLimitReachedNotification {
	export const type: NotificationType<string, any> = new NotificationType('json/resultLimitReached');
}

interface Settings {
	json?: {
		schemas?: JSONSchemaSettings[];
		format?: { enable: boolean; };
		resultLimit?: number;
	};
	http?: {
		proxy?: string;
		proxyStrictSSL?: boolean;
	};
}

interface JSONSchemaSettings {
	fileMatch?: string[];
	url?: string;
	schema?: any;
}

namespace SettingIds {
	export const enableFormatter = 'json.format.enable';
	export const enableSchemaDownload = 'json.schemaDownload.enable';
	export const maxItemsComputed = 'json.maxItemsComputed';
}

export interface TelemetryReporter {
	sendTelemetryEvent(eventName: string, properties?: {
		[key: string]: string;
	}, measurements?: {
		[key: string]: number;
	}): void;
}

export type LanguageClientConstructor = (name: string, description: string, clientOptions: LanguageClientOptions) => CommonLanguageClient;

export interface Runtime {
	http: RequestService;
	telemetry?: TelemetryReporter
}

export function startClient(context: ExtensionContext, newLanguageClient: LanguageClientConstructor, runtime: Runtime) {

	const toDispose = context.subscriptions;

	let rangeFormatting: Disposable | undefined = undefined;


	const documentSelector = ['json', 'jsonc'];

	const schemaResolutionErrorStatusBarItem = window.createStatusBarItem({
		id: 'status.json.resolveError',
		name: localize('json.resolveError', "JSON: Schema Resolution Error"),
		alignment: StatusBarAlignment.Right,
		priority: 0,
	});
	schemaResolutionErrorStatusBarItem.text = '$(alert)';
	toDispose.push(schemaResolutionErrorStatusBarItem);

	const fileSchemaErrors = new Map<string, string>();
	let schemaDownloadEnabled = true;

	// Options to control the language client
	const clientOptions: LanguageClientOptions = {
		// Register the server for json documents
		documentSelector,
		initializationOptions: {
			handledSchemaProtocols: ['file'], // language server only loads file-URI. Fetching schemas with other protocols ('http'...) are made on the client.
			provideFormatter: false, // tell the server to not provide formatting capability and ignore the `json.format.enable` setting.
			customCapabilities: { rangeFormatting: { editLimit: 1000 } }
		},
		synchronize: {
			// Synchronize the setting section 'json' to the server
			configurationSection: ['json', 'http'],
			fileEvents: workspace.createFileSystemWatcher('**/*.json')
		},
		middleware: {
			workspace: {
				didChangeConfiguration: () => client.sendNotification(DidChangeConfigurationNotification.type, { settings: getSettings() })
			},
			handleDiagnostics: (uri: Uri, diagnostics: Diagnostic[], next: HandleDiagnosticsSignature) => {
				const schemaErrorIndex = diagnostics.findIndex(isSchemaResolveError);

				if (schemaErrorIndex === -1) {
					fileSchemaErrors.delete(uri.toString());
					return next(uri, diagnostics);
				}

				const schemaResolveDiagnostic = diagnostics[schemaErrorIndex];
				fileSchemaErrors.set(uri.toString(), schemaResolveDiagnostic.message);

				if (!schemaDownloadEnabled) {
					diagnostics = diagnostics.filter(d => !isSchemaResolveError(d));
				}

				if (window.activeTextEditor && window.activeTextEditor.document.uri.toString() === uri.toString()) {
					schemaResolutionErrorStatusBarItem.show();
				}

				next(uri, diagnostics);
			},
			// testing the replace / insert mode
			provideCompletionItem(document: TextDocument, position: Position, context: CompletionContext, token: CancellationToken, next: ProvideCompletionItemsSignature): ProviderResult<CompletionItem[] | CompletionList> {
				function update(item: CompletionItem) {
					const range = item.range;
					if (range instanceof Range && range.end.isAfter(position) && range.start.isBeforeOrEqual(position)) {
						item.range = { inserting: new Range(range.start, position), replacing: range };
					}
					if (item.documentation instanceof MarkdownString) {
						item.documentation = updateMarkdownString(item.documentation);
					}

				}
				function updateProposals(r: CompletionItem[] | CompletionList | null | undefined): CompletionItem[] | CompletionList | null | undefined {
					if (r) {
						(Array.isArray(r) ? r : r.items).forEach(update);
					}
					return r;
				}

				const r = next(document, position, context, token);
				if (isThenable<CompletionItem[] | CompletionList | null | undefined>(r)) {
					return r.then(updateProposals);
				}
				return updateProposals(r);
			},
			provideHover(document: TextDocument, position: Position, token: CancellationToken, next: ProvideHoverSignature) {
				function updateHover(r: Hover | null | undefined): Hover | null | undefined {
					if (r && Array.isArray(r.contents)) {
						r.contents = r.contents.map(h => h instanceof MarkdownString ? updateMarkdownString(h) : h);
					}
					return r;
				}
				const r = next(document, position, token);
				if (isThenable<Hover | null | undefined>(r)) {
					return r.then(updateHover);
				}
				return updateHover(r);
			}
		}
	};

	// Create the language client and start the client.
	const client = newLanguageClient('json', localize('jsonserver.name', 'JSON Language Server'), clientOptions);
	client.registerProposedFeatures();

	const disposable = client.start();
	toDispose.push(disposable);
	client.onReady().then(() => {
		const schemaDocuments: { [uri: string]: boolean } = {};

		// handle content request
		client.onRequest(VSCodeContentRequest.type, (uriPath: string) => {
			const uri = Uri.parse(uriPath);
			if (uri.scheme === 'untitled') {
				return Promise.reject(new ResponseError(3, localize('untitled.schema', 'Unable to load {0}', uri.toString())));
			}
			if (uri.scheme !== 'http' && uri.scheme !== 'https') {
				return workspace.openTextDocument(uri).then(doc => {
					schemaDocuments[uri.toString()] = true;
					return doc.getText();
				}, error => {
					return Promise.reject(new ResponseError(2, error.toString()));
				});
			} else if (schemaDownloadEnabled) {
				if (runtime.telemetry && uri.authority === 'schema.management.azure.com') {
					/* __GDPR__
						"json.schema" : {
							"schemaURL" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
						}
					 */
					runtime.telemetry.sendTelemetryEvent('json.schema', { schemaURL: uriPath });
				}
				return runtime.http.getContent(uriPath);
			} else {
				return Promise.reject(new ResponseError(1, localize('schemaDownloadDisabled', 'Downloading schemas is disabled through setting \'{0}\'', SettingIds.enableSchemaDownload)));
			}
		});

		const handleContentChange = (uriString: string) => {
			if (schemaDocuments[uriString]) {
				client.sendNotification(SchemaContentChangeNotification.type, uriString);
				return true;
			}
			return false;
		};

		const handleActiveEditorChange = (activeEditor?: TextEditor) => {
			if (!activeEditor) {
				return;
			}

			const activeDocUri = activeEditor.document.uri.toString();

			if (activeDocUri && fileSchemaErrors.has(activeDocUri)) {
				schemaResolutionErrorStatusBarItem.show();
			} else {
				schemaResolutionErrorStatusBarItem.hide();
			}
		};

		toDispose.push(workspace.onDidChangeTextDocument(e => handleContentChange(e.document.uri.toString())));
		toDispose.push(workspace.onDidCloseTextDocument(d => {
			const uriString = d.uri.toString();
			if (handleContentChange(uriString)) {
				delete schemaDocuments[uriString];
			}
			fileSchemaErrors.delete(uriString);
		}));
		toDispose.push(window.onDidChangeActiveTextEditor(handleActiveEditorChange));

		const handleRetryResolveSchemaCommand = () => {
			if (window.activeTextEditor) {
				schemaResolutionErrorStatusBarItem.text = '$(watch)';
				const activeDocUri = window.activeTextEditor.document.uri.toString();
				client.sendRequest(ForceValidateRequest.type, activeDocUri).then((diagnostics) => {
					const schemaErrorIndex = diagnostics.findIndex(isSchemaResolveError);
					if (schemaErrorIndex !== -1) {
						// Show schema resolution errors in status bar only; ref: #51032
						const schemaResolveDiagnostic = diagnostics[schemaErrorIndex];
						fileSchemaErrors.set(activeDocUri, schemaResolveDiagnostic.message);
					} else {
						schemaResolutionErrorStatusBarItem.hide();
					}
					schemaResolutionErrorStatusBarItem.text = '$(alert)';
				});
			}
		};

		toDispose.push(commands.registerCommand('_json.retryResolveSchema', handleRetryResolveSchemaCommand));

		client.sendNotification(SchemaAssociationNotification.type, getSchemaAssociations(context));

		extensions.onDidChange(_ => {
			client.sendNotification(SchemaAssociationNotification.type, getSchemaAssociations(context));
		});

		// manually register / deregister format provider based on the `json.format.enable` setting avoiding issues with late registration. See #71652.
		updateFormatterRegistration();
		toDispose.push({ dispose: () => rangeFormatting && rangeFormatting.dispose() });

		updateSchemaDownloadSetting();

		toDispose.push(workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(SettingIds.enableFormatter)) {
				updateFormatterRegistration();
			} else if (e.affectsConfiguration(SettingIds.enableSchemaDownload)) {
				updateSchemaDownloadSetting();
			}
		}));

		client.onNotification(ResultLimitReachedNotification.type, message => {
			window.showInformationMessage(`${message}\n${localize('configureLimit', 'Use setting \'{0}\' to configure the limit.', SettingIds.maxItemsComputed)}`);
		});

		function updateFormatterRegistration() {
			const formatEnabled = workspace.getConfiguration().get(SettingIds.enableFormatter);
			if (!formatEnabled && rangeFormatting) {
				rangeFormatting.dispose();
				rangeFormatting = undefined;
			} else if (formatEnabled && !rangeFormatting) {
				rangeFormatting = languages.registerDocumentRangeFormattingEditProvider(documentSelector, {
					provideDocumentRangeFormattingEdits(document: TextDocument, range: Range, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]> {
						const params: DocumentRangeFormattingParams = {
							textDocument: client.code2ProtocolConverter.asTextDocumentIdentifier(document),
							range: client.code2ProtocolConverter.asRange(range),
							options: client.code2ProtocolConverter.asFormattingOptions(options)
						};
						return client.sendRequest(DocumentRangeFormattingRequest.type, params, token).then(
							client.protocol2CodeConverter.asTextEdits,
							(error) => {
								client.handleFailedRequest(DocumentRangeFormattingRequest.type, error, []);
								return Promise.resolve([]);
							}
						);
					}
				});
			}
		}

		function updateSchemaDownloadSetting() {
			schemaDownloadEnabled = workspace.getConfiguration().get(SettingIds.enableSchemaDownload) !== false;
			if (schemaDownloadEnabled) {
				schemaResolutionErrorStatusBarItem.tooltip = localize('json.schemaResolutionErrorMessage', 'Unable to resolve schema. Click to retry.');
				schemaResolutionErrorStatusBarItem.command = '_json.retryResolveSchema';
				handleRetryResolveSchemaCommand();
			} else {
				schemaResolutionErrorStatusBarItem.tooltip = localize('json.schemaResolutionDisabledMessage', 'Downloading schemas is disabled. Click to configure.');
				schemaResolutionErrorStatusBarItem.command = { command: 'workbench.action.openSettings', arguments: [SettingIds.enableSchemaDownload], title: '' };
			}
		}

	});

	const languageConfiguration: LanguageConfiguration = {
		wordPattern: /("(?:[^\\\"]*(?:\\.)?)*"?)|[^\s{}\[\],:]+/,
		indentationRules: {
			increaseIndentPattern: /({+(?=([^"]*"[^"]*")*[^"}]*$))|(\[+(?=([^"]*"[^"]*")*[^"\]]*$))/,
			decreaseIndentPattern: /^\s*[}\]],?\s*$/
		}
	};
	languages.setLanguageConfiguration('json', languageConfiguration);
	languages.setLanguageConfiguration('jsonc', languageConfiguration);

}

function getSchemaAssociations(_context: ExtensionContext): ISchemaAssociation[] {
	const associations: ISchemaAssociation[] = [];
	extensions.all.forEach(extension => {
		const packageJSON = extension.packageJSON;
		if (packageJSON && packageJSON.contributes && packageJSON.contributes.jsonValidation) {
			const jsonValidation = packageJSON.contributes.jsonValidation;
			if (Array.isArray(jsonValidation)) {
				jsonValidation.forEach(jv => {
					let { fileMatch, url } = jv;
					if (typeof fileMatch === 'string') {
						fileMatch = [fileMatch];
					}
					if (Array.isArray(fileMatch) && typeof url === 'string') {
						let uri: string = url;
						if (uri[0] === '.' && uri[1] === '/') {
							uri = joinPath(extension.extensionUri, uri).toString();
						}
						fileMatch = fileMatch.map(fm => {
							if (fm[0] === '%') {
								fm = fm.replace(/%APP_SETTINGS_HOME%/, '/User');
								fm = fm.replace(/%MACHINE_SETTINGS_HOME%/, '/Machine');
								fm = fm.replace(/%APP_WORKSPACES_HOME%/, '/Workspaces');
							} else if (!fm.match(/^(\w+:\/\/|\/|!)/)) {
								fm = '/' + fm;
							}
							return fm;
						});
						associations.push({ fileMatch, uri });
					}
				});
			}
		}
	});
	return associations;
}

function getSettings(): Settings {
	const httpSettings = workspace.getConfiguration('http');

	const resultLimit: number = Math.trunc(Math.max(0, Number(workspace.getConfiguration().get(SettingIds.maxItemsComputed)))) || 5000;

	const settings: Settings = {
		http: {
			proxy: httpSettings.get('proxy'),
			proxyStrictSSL: httpSettings.get('proxyStrictSSL')
		},
		json: {
			schemas: [],
			resultLimit
		}
	};
	const schemaSettingsById: { [schemaId: string]: JSONSchemaSettings } = Object.create(null);
	const collectSchemaSettings = (schemaSettings: JSONSchemaSettings[], folderUri?: Uri, isMultiRoot?: boolean) => {

		let fileMatchPrefix = undefined;
		if (folderUri && isMultiRoot) {
			fileMatchPrefix = folderUri.toString();
			if (fileMatchPrefix[fileMatchPrefix.length - 1] === '/') {
				fileMatchPrefix = fileMatchPrefix.substr(0, fileMatchPrefix.length - 1);
			}
		}
		for (const setting of schemaSettings) {
			const url = getSchemaId(setting, folderUri);
			if (!url) {
				continue;
			}
			let schemaSetting = schemaSettingsById[url];
			if (!schemaSetting) {
				schemaSetting = schemaSettingsById[url] = { url, fileMatch: [] };
				settings.json!.schemas!.push(schemaSetting);
			}
			const fileMatches = setting.fileMatch;
			if (Array.isArray(fileMatches)) {
				const resultingFileMatches = schemaSetting.fileMatch || [];
				schemaSetting.fileMatch = resultingFileMatches;
				const addMatch = (pattern: string) => { //  filter duplicates
					if (resultingFileMatches.indexOf(pattern) === -1) {
						resultingFileMatches.push(pattern);
					}
				};
				for (const fileMatch of fileMatches) {
					if (fileMatchPrefix) {
						if (fileMatch[0] === '/') {
							addMatch(fileMatchPrefix + fileMatch);
							addMatch(fileMatchPrefix + '/*' + fileMatch);
						} else {
							addMatch(fileMatchPrefix + '/' + fileMatch);
							addMatch(fileMatchPrefix + '/*/' + fileMatch);
						}
					} else {
						addMatch(fileMatch);
					}
				}
			}
			if (setting.schema && !schemaSetting.schema) {
				schemaSetting.schema = setting.schema;
			}
		}
	};

	const folders = workspace.workspaceFolders;

	// merge global and folder settings. Qualify all file matches with the folder path.
	const globalSettings = workspace.getConfiguration('json', null).get<JSONSchemaSettings[]>('schemas');
	if (Array.isArray(globalSettings)) {
		if (!folders) {
			collectSchemaSettings(globalSettings);
		}
	}
	if (folders) {
		const isMultiRoot = folders.length > 1;
		for (const folder of folders) {
			const folderUri = folder.uri;

			const schemaConfigInfo = workspace.getConfiguration('json', folderUri).inspect<JSONSchemaSettings[]>('schemas');

			const folderSchemas = schemaConfigInfo!.workspaceFolderValue;
			if (Array.isArray(folderSchemas)) {
				collectSchemaSettings(folderSchemas, folderUri, isMultiRoot);
			}
			if (Array.isArray(globalSettings)) {
				collectSchemaSettings(globalSettings, folderUri, isMultiRoot);
			}

		}
	}
	return settings;
}

function getSchemaId(schema: JSONSchemaSettings, folderUri?: Uri): string | undefined {
	let url = schema.url;
	if (!url) {
		if (schema.schema) {
			url = schema.schema.id || `vscode://schemas/custom/${encodeURIComponent(hash(schema.schema).toString(16))}`;
		}
	} else if (folderUri && (url[0] === '.' || url[0] === '/')) {
		url = joinPath(folderUri, url).toString();
	}
	return url;
}

function isThenable<T>(obj: ProviderResult<T>): obj is Thenable<T> {
	return obj && (<any>obj)['then'];
}

function updateMarkdownString(h: MarkdownString): MarkdownString {
	const n = new MarkdownString(h.value, true);
	n.isTrusted = h.isTrusted;
	return n;
}

function isSchemaResolveError(d: Diagnostic) {
	return d.code === /* SchemaResolveError */ 0x300;
}
