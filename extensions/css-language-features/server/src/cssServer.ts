/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	Connection, TextDocuments, InitializeParams, InitializeResult, ServerCapabilities, ConfigurationRequest, WorkspaceFolder, TextDocumentSyncKind, NotificationType
} from 'vscode-languageserver';
import { URI } from 'vscode-uri';
import { getCSSLanguageService, getSCSSLanguageService, getLESSLanguageService, LanguageSettings, LanguageService, Stylesheet, TextDocument, Position } from 'vscode-css-languageservice';
import { getLanguageModelCache } from './languageModelCache';
import { formatError, runSafeAsync } from './utils/runner';
import { getDocumentContext } from './utils/documentContext';
import { fetchDataProviders } from './customData';
import { RequestService, getRequestService } from './requests';

namespace CustomDataChangedNotification {
	export const type: NotificationType<string[]> = new NotificationType('css/customDataChanged');
}

export interface Settings {
	css: LanguageSettings;
	less: LanguageSettings;
	scss: LanguageSettings;
}

export interface RuntimeEnvironment {
	file?: RequestService;
	http?: RequestService
}

export function startServer(connection: Connection, runtime: RuntimeEnvironment) {

	// Create a text document manager.
	const documents = new TextDocuments(TextDocument);
	// Make the text document manager listen on the connection
	// for open, change and close text document events
	documents.listen(connection);

	const stylesheets = getLanguageModelCache<Stylesheet>(10, 60, document => getLanguageService(document).parseStylesheet(document));
	documents.onDidClose(e => {
		stylesheets.onDocumentRemoved(e.document);
	});
	connection.onShutdown(() => {
		stylesheets.dispose();
	});

	let scopedSettingsSupport = false;
	let foldingRangeLimit = Number.MAX_VALUE;
	let workspaceFolders: WorkspaceFolder[];

	let dataProvidersReady: Promise<any> = Promise.resolve();

	const languageServices: { [id: string]: LanguageService } = {};

	const notReady = () => Promise.reject('Not Ready');
	let requestService: RequestService = { getContent: notReady, stat: notReady, readDirectory: notReady };

	// After the server has started the client sends an initialize request. The server receives
	// in the passed params the rootPath of the workspace plus the client capabilities.
	connection.onInitialize((params: InitializeParams): InitializeResult => {
		workspaceFolders = (<any>params).workspaceFolders;
		if (!Array.isArray(workspaceFolders)) {
			workspaceFolders = [];
			if (params.rootPath) {
				workspaceFolders.push({ name: '', uri: URI.file(params.rootPath).toString() });
			}
		}

		requestService = getRequestService(params.initializationOptions?.handledSchemas || ['file'], connection, runtime);

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
		const snippetSupport = !!getClientCapability('textDocument.completion.completionItem.snippetSupport', false);
		scopedSettingsSupport = !!getClientCapability('workspace.configuration', false);
		foldingRangeLimit = getClientCapability('textDocument.foldingRange.rangeLimit', Number.MAX_VALUE);

		languageServices.css = getCSSLanguageService({ fileSystemProvider: requestService, clientCapabilities: params.capabilities });
		languageServices.scss = getSCSSLanguageService({ fileSystemProvider: requestService, clientCapabilities: params.capabilities });
		languageServices.less = getLESSLanguageService({ fileSystemProvider: requestService, clientCapabilities: params.capabilities });

		const capabilities: ServerCapabilities = {
			textDocumentSync: TextDocumentSyncKind.Incremental,
			completionProvider: snippetSupport ? { resolveProvider: false, triggerCharacters: ['/', '-', ':'] } : undefined,
			hoverProvider: true,
			documentSymbolProvider: true,
			referencesProvider: true,
			definitionProvider: true,
			documentHighlightProvider: true,
			documentLinkProvider: {
				resolveProvider: false
			},
			codeActionProvider: true,
			renameProvider: true,
			colorProvider: {},
			foldingRangeProvider: true,
			selectionRangeProvider: true
		};
		return { capabilities };
	});

	function getLanguageService(document: TextDocument) {
		let service = languageServices[document.languageId];
		if (!service) {
			connection.console.log('Document type is ' + document.languageId + ', using css instead.');
			service = languageServices['css'];
		}
		return service;
	}

	let documentSettings: { [key: string]: Thenable<LanguageSettings | undefined> } = {};
	// remove document settings on close
	documents.onDidClose(e => {
		delete documentSettings[e.document.uri];
	});
	function getDocumentSettings(textDocument: TextDocument): Thenable<LanguageSettings | undefined> {
		if (scopedSettingsSupport) {
			let promise = documentSettings[textDocument.uri];
			if (!promise) {
				const configRequestParam = { items: [{ scopeUri: textDocument.uri, section: textDocument.languageId }] };
				promise = connection.sendRequest(ConfigurationRequest.type, configRequestParam).then(s => s[0]);
				documentSettings[textDocument.uri] = promise;
			}
			return promise;
		}
		return Promise.resolve(undefined);
	}

	// The settings have changed. Is send on server activation as well.
	connection.onDidChangeConfiguration(change => {
		updateConfiguration(<Settings>change.settings);
	});

	function updateConfiguration(settings: Settings) {
		for (const languageId in languageServices) {
			languageServices[languageId].configure((settings as any)[languageId]);
		}
		// reset all document settings
		documentSettings = {};
		// Revalidate any open text documents
		documents.all().forEach(triggerValidation);
	}

	const pendingValidationRequests: { [uri: string]: NodeJS.Timer } = {};
	const validationDelayMs = 500;

	// The content of a text document has changed. This event is emitted
	// when the text document first opened or when its content has changed.
	documents.onDidChangeContent(change => {
		triggerValidation(change.document);
	});

	// a document has closed: clear all diagnostics
	documents.onDidClose(event => {
		cleanPendingValidation(event.document);
		connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
	});

	function cleanPendingValidation(textDocument: TextDocument): void {
		const request = pendingValidationRequests[textDocument.uri];
		if (request) {
			clearTimeout(request);
			delete pendingValidationRequests[textDocument.uri];
		}
	}

	function triggerValidation(textDocument: TextDocument): void {
		cleanPendingValidation(textDocument);
		pendingValidationRequests[textDocument.uri] = setTimeout(() => {
			delete pendingValidationRequests[textDocument.uri];
			validateTextDocument(textDocument);
		}, validationDelayMs);
	}

	function validateTextDocument(textDocument: TextDocument): void {
		const settingsPromise = getDocumentSettings(textDocument);
		Promise.all([settingsPromise, dataProvidersReady]).then(async ([settings]) => {
			const stylesheet = stylesheets.get(textDocument);
			const diagnostics = getLanguageService(textDocument).doValidation(textDocument, stylesheet, settings);
			// Send the computed diagnostics to VSCode.
			connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
		}, e => {
			connection.console.error(formatError(`Error while validating ${textDocument.uri}`, e));
		});
	}


	function updateDataProviders(dataPaths: string[]) {
		dataProvidersReady = fetchDataProviders(dataPaths, requestService).then(customDataProviders => {
			for (const lang in languageServices) {
				languageServices[lang].setDataProviders(true, customDataProviders);
			}
		});
	}

	connection.onCompletion((textDocumentPosition, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(textDocumentPosition.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const styleSheet = stylesheets.get(document);
				const documentContext = getDocumentContext(document.uri, workspaceFolders);
				return getLanguageService(document).doComplete2(document, textDocumentPosition.position, styleSheet, documentContext);
			}
			return null;
		}, null, `Error while computing completions for ${textDocumentPosition.textDocument.uri}`, token);
	});

	connection.onHover((textDocumentPosition, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(textDocumentPosition.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const styleSheet = stylesheets.get(document);
				return getLanguageService(document).doHover(document, textDocumentPosition.position, styleSheet);
			}
			return null;
		}, null, `Error while computing hover for ${textDocumentPosition.textDocument.uri}`, token);
	});

	connection.onDocumentSymbol((documentSymbolParams, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(documentSymbolParams.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).findDocumentSymbols(document, stylesheet);
			}
			return [];
		}, [], `Error while computing document symbols for ${documentSymbolParams.textDocument.uri}`, token);
	});

	connection.onDefinition((documentDefinitionParams, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(documentDefinitionParams.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).findDefinition(document, documentDefinitionParams.position, stylesheet);
			}
			return null;
		}, null, `Error while computing definitions for ${documentDefinitionParams.textDocument.uri}`, token);
	});

	connection.onDocumentHighlight((documentHighlightParams, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(documentHighlightParams.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).findDocumentHighlights(document, documentHighlightParams.position, stylesheet);
			}
			return [];
		}, [], `Error while computing document highlights for ${documentHighlightParams.textDocument.uri}`, token);
	});


	connection.onDocumentLinks(async (documentLinkParams, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(documentLinkParams.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const documentContext = getDocumentContext(document.uri, workspaceFolders);
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).findDocumentLinks2(document, stylesheet, documentContext);
			}
			return [];
		}, [], `Error while computing document links for ${documentLinkParams.textDocument.uri}`, token);
	});


	connection.onReferences((referenceParams, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(referenceParams.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).findReferences(document, referenceParams.position, stylesheet);
			}
			return [];
		}, [], `Error while computing references for ${referenceParams.textDocument.uri}`, token);
	});

	connection.onCodeAction((codeActionParams, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(codeActionParams.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).doCodeActions(document, codeActionParams.range, codeActionParams.context, stylesheet);
			}
			return [];
		}, [], `Error while computing code actions for ${codeActionParams.textDocument.uri}`, token);
	});

	connection.onDocumentColor((params, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(params.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).findDocumentColors(document, stylesheet);
			}
			return [];
		}, [], `Error while computing document colors for ${params.textDocument.uri}`, token);
	});

	connection.onColorPresentation((params, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(params.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).getColorPresentations(document, stylesheet, params.color, params.range);
			}
			return [];
		}, [], `Error while computing color presentations for ${params.textDocument.uri}`, token);
	});

	connection.onRenameRequest((renameParameters, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(renameParameters.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).doRename(document, renameParameters.position, renameParameters.newName, stylesheet);
			}
			return null;
		}, null, `Error while computing renames for ${renameParameters.textDocument.uri}`, token);
	});

	connection.onFoldingRanges((params, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(params.textDocument.uri);
			if (document) {
				await dataProvidersReady;
				return getLanguageService(document).getFoldingRanges(document, { rangeLimit: foldingRangeLimit });
			}
			return null;
		}, null, `Error while computing folding ranges for ${params.textDocument.uri}`, token);
	});

	connection.onSelectionRanges((params, token) => {
		return runSafeAsync(async () => {
			const document = documents.get(params.textDocument.uri);
			const positions: Position[] = params.positions;

			if (document) {
				await dataProvidersReady;
				const stylesheet = stylesheets.get(document);
				return getLanguageService(document).getSelectionRanges(document, positions, stylesheet);
			}
			return [];
		}, [], `Error while computing selection ranges for ${params.textDocument.uri}`, token);
	});

	connection.onNotification(CustomDataChangedNotification.type, updateDataProviders);

	// Listen on the connection
	connection.listen();

}


