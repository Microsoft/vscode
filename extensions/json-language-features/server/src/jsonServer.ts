/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	Connection,
	TextDocuments, InitializeParams, InitializeResult, NotificationType, RequestType,
	DocumentRangeFormattingRequest, Disposable, ServerCapabilities, TextDocumentSyncKind, TextEdit, DocumentFormattingRequest, TextDocumentIdentifier, FormattingOptions
} from 'vscode-languageserver';

import { formatError, runSafe, runSafeAsync } from './utils/runner';
import { TextDocument, JSONDocument, JSONSchema, getLanguageService, DocumentLanguageSettings, SchemaConfiguration, ClientCapabilities, Diagnostic, Range, Position } from 'vscode-json-languageservice';
import { getLanguageModelCache } from './languageModelCache';
import { RequestService, basename, resolvePath } from './requests';

type ISchemaAssociations = Record<string, string[]>;

namespace SchemaAssociationNotification {
	export const type: NotificationType<ISchemaAssociations | SchemaConfiguration[]> = new NotificationType('json/schemaAssociations');
}

namespace VSCodeContentRequest {
	export const type: RequestType<string, string, any> = new RequestType('vscode/content');
}

namespace SchemaContentChangeNotification {
	export const type: NotificationType<string> = new NotificationType('json/schemaContent');
}

namespace ResultLimitReachedNotification {
	export const type: NotificationType<string> = new NotificationType('json/resultLimitReached');
}

namespace ForceValidateRequest {
	export const type: RequestType<string, Diagnostic[], any> = new RequestType('json/validate');
}


const workspaceContext = {
	resolveRelativePath: (relativePath: string, resource: string) => {
		const base = resource.substr(0, resource.lastIndexOf('/') + 1);
		return resolvePath(base, relativePath);
	}
};

export interface RuntimeEnvironment {
	file?: RequestService;
	http?: RequestService
	configureHttpRequests?(proxy: string, strictSSL: boolean): void;
	readonly timer: {
		setImmediate(callback: (...args: any[]) => void, ...args: any[]): Disposable;
		setTimeout(callback: (...args: any[]) => void, ms: number, ...args: any[]): Disposable;
	}
}

export function startServer(connection: Connection, runtime: RuntimeEnvironment) {

	function getSchemaRequestService(handledSchemas: string[] = ['https', 'http', 'file']) {
		const builtInHandlers: { [protocol: string]: RequestService | undefined } = {};
		for (let protocol of handledSchemas) {
			if (protocol === 'file') {
				builtInHandlers[protocol] = runtime.file;
			} else if (protocol === 'http' || protocol === 'https') {
				builtInHandlers[protocol] = runtime.http;
			}
		}
		return (uri: string): Thenable<string> => {
			const protocol = uri.substr(0, uri.indexOf(':'));

			const builtInHandler = builtInHandlers[protocol];
			if (builtInHandler) {
				return builtInHandler.getContent(uri);
			}
			return connection.sendRequest(VSCodeContentRequest.type, uri).then(responseText => {
				return responseText;
			}, error => {
				return Promise.reject(error.message);
			});
		};
	}

	// create the JSON language service
	let languageService = getLanguageService({
		workspaceContext,
		contributions: [],
		clientCapabilities: ClientCapabilities.LATEST
	});

	// Create a text document manager.
	const documents = new TextDocuments(TextDocument);

	// Make the text document manager listen on the connection
	// for open, change and close text document events
	documents.listen(connection);

	let clientSnippetSupport = false;
	let dynamicFormatterRegistration = false;
	let hierarchicalDocumentSymbolSupport = false;

	let foldingRangeLimitDefault = Number.MAX_VALUE;
	let foldingRangeLimit = Number.MAX_VALUE;
	let resultLimit = Number.MAX_VALUE;
	let formatterMaxNumberOfEdits = Number.MAX_VALUE;

	// After the server has started the client sends an initialize request. The server receives
	// in the passed params the rootPath of the workspace plus the client capabilities.
	connection.onInitialize((params: InitializeParams): InitializeResult => {

		const handledProtocols = params.initializationOptions?.handledSchemaProtocols;

		languageService = getLanguageService({
			schemaRequestService: getSchemaRequestService(handledProtocols),
			workspaceContext,
			contributions: [],
			clientCapabilities: params.capabilities
		});

		function getClientCapability<T>(name: string, def: T) {
			const keys = name.split('.');
			let c: any = params.capabilities;
			for (let i = 0; c && i < keys.length; i++) {
				if (!c.hasOwnProperty(keys[i])) {
					return def;
				}
				c = c[keys[i]];
			}
			return c;
		}

		clientSnippetSupport = getClientCapability('textDocument.completion.completionItem.snippetSupport', false);
		dynamicFormatterRegistration = getClientCapability('textDocument.rangeFormatting.dynamicRegistration', false) && (typeof params.initializationOptions?.provideFormatter !== 'boolean');
		foldingRangeLimitDefault = getClientCapability('textDocument.foldingRange.rangeLimit', Number.MAX_VALUE);
		hierarchicalDocumentSymbolSupport = getClientCapability('textDocument.documentSymbol.hierarchicalDocumentSymbolSupport', false);
		formatterMaxNumberOfEdits = params.initializationOptions?.customCapabilities?.rangeFormatting?.editLimit || Number.MAX_VALUE;
		const capabilities: ServerCapabilities = {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: clientSnippetSupport ? {
				resolveProvider: false, // turn off resolving as the current language service doesn't do anything on resolve. Also fixes #91747
				triggerCharacters: ['"', ':']
			} : undefined,
			hoverProvider: true,
			documentSymbolProvider: true,
			documentRangeFormattingProvider: params.initializationOptions?.provideFormatter === true,
			documentFormattingProvider: params.initializationOptions?.provideFormatter === true,
			colorProvider: {},
			foldingRangeProvider: true,
			selectionRangeProvider: true,
			documentLinkProvider: {}
		};

		return { capabilities };
	});



	// The settings interface describes the server relevant settings part
	interface Settings {
		json: {
			schemas: JSONSchemaSettings[];
			format: { enable: boolean; };
			resultLimit?: number;
		};
		http: {
			proxy: string;
			proxyStrictSSL: boolean;
		};
	}

	interface JSONSchemaSettings {
		fileMatch?: string[];
		url?: string;
		schema?: JSONSchema;
	}


	const limitExceededWarnings = function () {
		const pendingWarnings: { [uri: string]: { features: { [name: string]: string }; timeout?: Disposable; } } = {};

		const showLimitedNotification = (uri: string, resultLimit: number) => {
			const warning = pendingWarnings[uri];
			connection.sendNotification(ResultLimitReachedNotification.type, `${basename(uri)}: For performance reasons, ${Object.keys(warning.features).join(' and ')} have been limited to ${resultLimit} items.`);
			warning.timeout = undefined;
		};

		return {
			cancel(uri: string) {
				const warning = pendingWarnings[uri];
				if (warning && warning.timeout) {
					warning.timeout.dispose();
					delete pendingWarnings[uri];
				}
			},

			onResultLimitExceeded(uri: string, resultLimit: number, name: string) {
				return () => {
					let warning = pendingWarnings[uri];
					if (warning) {
						if (!warning.timeout) {
							// already shown
							return;
						}
						warning.features[name] = name;
						warning.timeout.dispose();
						warning.timeout = runtime.timer.setTimeout(() => showLimitedNotification(uri, resultLimit), 2000);
					} else {
						warning = { features: { [name]: name } };
						warning.timeout = runtime.timer.setTimeout(() => showLimitedNotification(uri, resultLimit), 2000);
						pendingWarnings[uri] = warning;
					}
				};
			}
		};
	}();

	let jsonConfigurationSettings: JSONSchemaSettings[] | undefined = undefined;
	let schemaAssociations: ISchemaAssociations | SchemaConfiguration[] | undefined = undefined;
	let formatterRegistrations: Thenable<Disposable>[] | null = null;

	// The settings have changed. Is send on server activation as well.
	connection.onDidChangeConfiguration((change) => {
		let settings = <Settings>change.settings;
		if (runtime.configureHttpRequests) {
			runtime.configureHttpRequests(settings.http && settings.http.proxy, settings.http && settings.http.proxyStrictSSL);
		}
		jsonConfigurationSettings = settings.json && settings.json.schemas;
		updateConfiguration();

		foldingRangeLimit = Math.trunc(Math.max(settings.json && settings.json.resultLimit || foldingRangeLimitDefault, 0));
		resultLimit = Math.trunc(Math.max(settings.json && settings.json.resultLimit || Number.MAX_VALUE, 0));

		// dynamically enable & disable the formatter
		if (dynamicFormatterRegistration) {
			const enableFormatter = settings && settings.json && settings.json.format && settings.json.format.enable;
			if (enableFormatter) {
				if (!formatterRegistrations) {
					const documentSelector = [{ language: 'json' }, { language: 'jsonc' }];
					formatterRegistrations = [
						connection.client.register(DocumentRangeFormattingRequest.type, { documentSelector }),
						connection.client.register(DocumentFormattingRequest.type, { documentSelector })
					];
				}
			} else if (formatterRegistrations) {
				formatterRegistrations.forEach(p => p.then(r => r.dispose()));
				formatterRegistrations = null;
			}
		}
	});

	// The jsonValidation extension configuration has changed
	connection.onNotification(SchemaAssociationNotification.type, associations => {
		schemaAssociations = associations;
		updateConfiguration();
	});

	// A schema has changed
	connection.onNotification(SchemaContentChangeNotification.type, uri => {
		languageService.resetSchema(uri);
	});

	// Retry schema validation on all open documents
	connection.onRequest(ForceValidateRequest.type, uri => {
		return new Promise<Diagnostic[]>(resolve => {
			const document = documents.get(uri);
			if (document) {
				updateConfiguration();
				validateTextDocument(document, diagnostics => {
					resolve(diagnostics);
				});
			} else {
				resolve([]);
			}
		});
	});

	function updateConfiguration() {
		const languageSettings = {
			validate: true,
			allowComments: true,
			schemas: new Array<SchemaConfiguration>()
		};
		if (schemaAssociations) {
			if (Array.isArray(schemaAssociations)) {
				Array.prototype.push.apply(languageSettings.schemas, schemaAssociations);
			} else {
				for (const pattern in schemaAssociations) {
					const association = schemaAssociations[pattern];
					if (Array.isArray(association)) {
						association.forEach(uri => {
							languageSettings.schemas.push({ uri, fileMatch: [pattern] });
						});
					}
				}
			}
		}
		if (jsonConfigurationSettings) {
			jsonConfigurationSettings.forEach((schema, index) => {
				let uri = schema.url;
				if (!uri && schema.schema) {
					uri = schema.schema.id || `vscode://schemas/custom/${index}`;
				}
				if (uri) {
					languageSettings.schemas.push({ uri, fileMatch: schema.fileMatch, schema: schema.schema });
				}
			});
		}
		languageService.configure(languageSettings);

		// Revalidate any open text documents
		documents.all().forEach(triggerValidation);
	}

	// The content of a text document has changed. This event is emitted
	// when the text document first opened or when its content has changed.
	documents.onDidChangeContent((change) => {
		limitExceededWarnings.cancel(change.document.uri);
		triggerValidation(change.document);
	});

	// a document has closed: clear all diagnostics
	documents.onDidClose(event => {
		limitExceededWarnings.cancel(event.document.uri);
		cleanPendingValidation(event.document);
		connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	});

	const pendingValidationRequests: { [uri: string]: Disposable; } = {};
	const validationDelayMs = 300;

	function cleanPendingValidation(textDocument: TextDocument): void {
		const request = pendingValidationRequests[textDocument.uri];
		if (request) {
			request.dispose();
			delete pendingValidationRequests[textDocument.uri];
		}
	}

	function triggerValidation(textDocument: TextDocument): void {
		cleanPendingValidation(textDocument);
		pendingValidationRequests[textDocument.uri] = runtime.timer.setTimeout(() => {
			delete pendingValidationRequests[textDocument.uri];
			validateTextDocument(textDocument);
		}, validationDelayMs);
	}

	function validateTextDocument(textDocument: TextDocument, callback?: (diagnostics: Diagnostic[]) => void): void {
		const respond = (diagnostics: Diagnostic[]) => {
			connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
			if (callback) {
				callback(diagnostics);
			}
		};
		if (textDocument.getText().length === 0) {
			respond([]); // ignore empty documents
			return;
		}
		const jsonDocument = getJSONDocument(textDocument);
		const version = textDocument.version;

		const documentSettings: DocumentLanguageSettings = textDocument.languageId === 'jsonc' ? { comments: 'ignore', trailingCommas: 'warning' } : { comments: 'error', trailingCommas: 'error' };
		languageService.doValidation(textDocument, jsonDocument, documentSettings).then(diagnostics => {
			runtime.timer.setImmediate(() => {
				const currDocument = documents.get(textDocument.uri);
				if (currDocument && currDocument.version === version) {
					respond(diagnostics); // Send the computed diagnostics to VSCode.
				}
			});
		}, error => {
			connection.console.error(formatError(`Error while validating ${textDocument.uri}`, error));
		});
	}

	connection.onDidChangeWatchedFiles((change) => {
		// Monitored files have changed in VSCode
		let hasChanges = false;
		change.changes.forEach(c => {
			if (languageService.resetSchema(c.uri)) {
				hasChanges = true;
			}
		});
		if (hasChanges) {
			documents.all().forEach(triggerValidation);
		}
	});

	const jsonDocuments = getLanguageModelCache<JSONDocument>(10, 60, document => languageService.parseJSONDocument(document));
	documents.onDidClose(e => {
		jsonDocuments.onDocumentRemoved(e.document);
	});
	connection.onShutdown(() => {
		jsonDocuments.dispose();
	});

	function getJSONDocument(document: TextDocument): JSONDocument {
		return jsonDocuments.get(document);
	}

	connection.onCompletion((textDocumentPosition, token) => {
		return runSafeAsync(runtime, async () => {
			const document = documents.get(textDocumentPosition.textDocument.uri);
			if (document) {
				const jsonDocument = getJSONDocument(document);
				return languageService.doComplete(document, textDocumentPosition.position, jsonDocument);
			}
			return null;
		}, null, `Error while computing completions for ${textDocumentPosition.textDocument.uri}`, token);
	});

	connection.onHover((textDocumentPositionParams, token) => {
		return runSafeAsync(runtime, async () => {
			const document = documents.get(textDocumentPositionParams.textDocument.uri);
			if (document) {
				const jsonDocument = getJSONDocument(document);
				return languageService.doHover(document, textDocumentPositionParams.position, jsonDocument);
			}
			return null;
		}, null, `Error while computing hover for ${textDocumentPositionParams.textDocument.uri}`, token);
	});

	connection.onDocumentSymbol((documentSymbolParams, token) => {
		return runSafe(runtime, () => {
			const document = documents.get(documentSymbolParams.textDocument.uri);
			if (document) {
				const jsonDocument = getJSONDocument(document);
				const onResultLimitExceeded = limitExceededWarnings.onResultLimitExceeded(document.uri, resultLimit, 'document symbols');
				if (hierarchicalDocumentSymbolSupport) {
					return languageService.findDocumentSymbols2(document, jsonDocument, { resultLimit, onResultLimitExceeded });
				} else {
					return languageService.findDocumentSymbols(document, jsonDocument, { resultLimit, onResultLimitExceeded });
				}
			}
			return [];
		}, [], `Error while computing document symbols for ${documentSymbolParams.textDocument.uri}`, token);
	});

	function onFormat(textDocument: TextDocumentIdentifier, range: Range | undefined, options: FormattingOptions): TextEdit[] {
		const document = documents.get(textDocument.uri);
		if (document) {
			const edits = languageService.format(document, range ?? getFullRange(document), options);
			if (edits.length > formatterMaxNumberOfEdits) {
				const newText = TextDocument.applyEdits(document, edits);
				return [TextEdit.replace(getFullRange(document), newText)];
			}
			return edits;
		}
		return [];
	}

	connection.onDocumentRangeFormatting((formatParams, token) => {
		return runSafe(runtime, () => onFormat(formatParams.textDocument, formatParams.range, formatParams.options), [], `Error while formatting range for ${formatParams.textDocument.uri}`, token);
	});

	connection.onDocumentFormatting((formatParams, token) => {
		return runSafe(runtime, () => onFormat(formatParams.textDocument, undefined, formatParams.options), [], `Error while formatting ${formatParams.textDocument.uri}`, token);
	});

	connection.onDocumentColor((params, token) => {
		return runSafeAsync(runtime, async () => {
			const document = documents.get(params.textDocument.uri);
			if (document) {
				const onResultLimitExceeded = limitExceededWarnings.onResultLimitExceeded(document.uri, resultLimit, 'document colors');
				const jsonDocument = getJSONDocument(document);
				return languageService.findDocumentColors(document, jsonDocument, { resultLimit, onResultLimitExceeded });
			}
			return [];
		}, [], `Error while computing document colors for ${params.textDocument.uri}`, token);
	});

	connection.onColorPresentation((params, token) => {
		return runSafe(runtime, () => {
			const document = documents.get(params.textDocument.uri);
			if (document) {
				const jsonDocument = getJSONDocument(document);
				return languageService.getColorPresentations(document, jsonDocument, params.color, params.range);
			}
			return [];
		}, [], `Error while computing color presentations for ${params.textDocument.uri}`, token);
	});

	connection.onFoldingRanges((params, token) => {
		return runSafe(runtime, () => {
			const document = documents.get(params.textDocument.uri);
			if (document) {
				const onRangeLimitExceeded = limitExceededWarnings.onResultLimitExceeded(document.uri, foldingRangeLimit, 'folding ranges');
				return languageService.getFoldingRanges(document, { rangeLimit: foldingRangeLimit, onRangeLimitExceeded });
			}
			return null;
		}, null, `Error while computing folding ranges for ${params.textDocument.uri}`, token);
	});


	connection.onSelectionRanges((params, token) => {
		return runSafe(runtime, () => {
			const document = documents.get(params.textDocument.uri);
			if (document) {
				const jsonDocument = getJSONDocument(document);
				return languageService.getSelectionRanges(document, params.positions, jsonDocument);
			}
			return [];
		}, [], `Error while computing selection ranges for ${params.textDocument.uri}`, token);
	});

	connection.onDocumentLinks((params, token) => {
		return runSafeAsync(runtime, async () => {
			const document = documents.get(params.textDocument.uri);
			if (document) {
				const jsonDocument = getJSONDocument(document);
				return languageService.findLinks(document, jsonDocument);
			}
			return [];
		}, [], `Error while computing links for ${params.textDocument.uri}`, token);
	});

	// Listen on the connection
	connection.listen();
}

function getFullRange(document: TextDocument): Range {
	return Range.create(Position.create(0, 0), document.positionAt(document.getText().length));
}
