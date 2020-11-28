/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as pathUtils from 'path';

const FILE_LINE_REGEX = /^(\S.*):$/;
const RESULT_LINE_REGEX = /^(\s+)(\d+)(:| )(\s+)(.*)$/;
const ELISION_REGEX = /⟪ ([0-9]+) characters skipped ⟫/g;
const SEARCH_RESULT_SELECTOR = { language: 'search-result', exclusive: true };
const DIRECTIVES = ['# Query:', '# Flags:', '# Including:', '# Excluding:', '# ContextLines:'];
const FLAGS = ['RegExp', 'CaseSensitive', 'IgnoreExcludeSettings', 'WordMatch'];

let cachedLastParse: { version: number, parse: ParsedSearchResults, uri: vscode.Uri } | undefined;
let documentChangeListener: vscode.Disposable | undefined;


export function activate(context: vscode.ExtensionContext) {

	const contextLineDecorations = vscode.window.createTextEditorDecorationType({ opacity: '0.7' });
	const matchLineDecorations = vscode.window.createTextEditorDecorationType({ fontWeight: 'bold' });

	const decorate = (editor: vscode.TextEditor) => {
		const parsed = parseSearchResults(editor.document).filter(isResultLine);
		const contextRanges = parsed.filter(line => line.isContext).map(line => line.prefixRange);
		const matchRanges = parsed.filter(line => !line.isContext).map(line => line.prefixRange);
		editor.setDecorations(contextLineDecorations, contextRanges);
		editor.setDecorations(matchLineDecorations, matchRanges);
	};

	if (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.languageId === 'search-result') {
		decorate(vscode.window.activeTextEditor);
	}

	context.subscriptions.push(

		vscode.languages.registerDocumentSymbolProvider(SEARCH_RESULT_SELECTOR, {
			provideDocumentSymbols(document: vscode.TextDocument, token: vscode.CancellationToken): vscode.DocumentSymbol[] {
				const results = parseSearchResults(document, token)
					.filter(isFileLine)
					.map(line => new vscode.DocumentSymbol(
						line.path,
						'',
						vscode.SymbolKind.File,
						line.allLocations.map(({ originSelectionRange }) => originSelectionRange!).reduce((p, c) => p.union(c), line.location.originSelectionRange!),
						line.location.originSelectionRange!,
					));

				return results;
			}
		}),

		vscode.languages.registerCompletionItemProvider(SEARCH_RESULT_SELECTOR, {
			provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): vscode.CompletionItem[] {

				const line = document.lineAt(position.line);
				if (position.line > 3) { return []; }
				if (position.character === 0 || (position.character === 1 && line.text === '#')) {
					const header = Array.from({ length: DIRECTIVES.length }).map((_, i) => document.lineAt(i).text);

					return DIRECTIVES
						.filter(suggestion => header.every(line => line.indexOf(suggestion) === -1))
						.map(flag => ({ label: flag, insertText: (flag.slice(position.character)) + ' ' }));
				}

				if (line.text.indexOf('# Flags:') === -1) { return []; }

				return FLAGS
					.filter(flag => line.text.indexOf(flag) === -1)
					.map(flag => ({ label: flag, insertText: flag + ' ' }));
			}
		}, '#'),

		vscode.languages.registerDefinitionProvider(SEARCH_RESULT_SELECTOR, {
			provideDefinition(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken): vscode.DefinitionLink[] {
				const lineResult = parseSearchResults(document, token)[position.line];
				if (!lineResult) { return []; }
				if (lineResult.type === 'file') {
					return lineResult.allLocations;
				}

				const location = lineResult.locations.find(l => l.originSelectionRange.contains(position));
				if (!location) {
					return [];
				}

				const targetPos = new vscode.Position(
					location.targetSelectionRange.start.line,
					location.targetSelectionRange.start.character + (position.character - location.originSelectionRange.start.character)
				);
				return [{
					...location,
					targetSelectionRange: new vscode.Range(targetPos, targetPos),
				}];
			}
		}),

		vscode.languages.registerDocumentLinkProvider(SEARCH_RESULT_SELECTOR, {
			async provideDocumentLinks(document: vscode.TextDocument, token: vscode.CancellationToken): Promise<vscode.DocumentLink[]> {
				return parseSearchResults(document, token)
					.filter(isFileLine)
					.map(({ location }) => ({ range: location.originSelectionRange!, target: location.targetUri }));
			}
		}),

		vscode.window.onDidChangeActiveTextEditor(editor => {
			if (editor?.document.languageId === 'search-result') {
				// Clear the parse whenever we open a new editor.
				// Conservative because things like the URI might remain constant even if the contents change, and re-parsing even large files is relatively fast.
				cachedLastParse = undefined;

				documentChangeListener?.dispose();
				documentChangeListener = vscode.workspace.onDidChangeTextDocument(doc => {
					if (doc.document.uri === editor.document.uri) {
						decorate(editor);
					}
				});

				decorate(editor);
			}
		}),

		{ dispose() { cachedLastParse = undefined; documentChangeListener?.dispose(); } }
	);
}


function relativePathToUri(path: string, resultsUri: vscode.Uri): vscode.Uri | undefined {
	if (pathUtils.isAbsolute(path)) {
		return vscode.Uri
			.file(path)
			.with({ scheme: process.env.HOME ? 'file' : 'vscode-userdata' });
	}

	if (path.indexOf('~/') === 0) {
		return vscode.Uri
			.file(pathUtils.join(process.env.HOME ?? '', path.slice(2)))
			.with({ scheme: process.env.HOME ? 'file' : 'vscode-userdata' });
	}

	const uriFromFolderWithPath = (folder: vscode.WorkspaceFolder, path: string): vscode.Uri =>
		vscode.Uri.joinPath(folder.uri, path);

	if (vscode.workspace.workspaceFolders) {
		const multiRootFormattedPath = /^(.*) • (.*)$/.exec(path);
		if (multiRootFormattedPath) {
			const [, workspaceName, workspacePath] = multiRootFormattedPath;
			const folder = vscode.workspace.workspaceFolders.filter(wf => wf.name === workspaceName)[0];
			if (folder) {
				return uriFromFolderWithPath(folder, workspacePath);
			}
		}
		else if (vscode.workspace.workspaceFolders.length === 1) {
			return uriFromFolderWithPath(vscode.workspace.workspaceFolders[0], path);
		} else if (resultsUri.scheme !== 'untitled') {
			// We're in a multi-root workspace, but the path is not multi-root formatted
			// Possibly a saved search from a single root session. Try checking if the search result document's URI is in a current workspace folder.
			const prefixMatch = vscode.workspace.workspaceFolders.filter(wf => resultsUri.toString().startsWith(wf.uri.toString()))[0];
			if (prefixMatch) {
				return uriFromFolderWithPath(prefixMatch, path);
			}
		}
	}

	console.error(`Unable to resolve path ${path}`);
	return undefined;
}

type ParsedSearchFileLine = { type: 'file', location: vscode.LocationLink, allLocations: vscode.LocationLink[], path: string };
type ParsedSearchResultLine = { type: 'result', locations: Required<vscode.LocationLink>[], isContext: boolean, prefixRange: vscode.Range };
type ParsedSearchResults = Array<ParsedSearchFileLine | ParsedSearchResultLine>;
const isFileLine = (line: ParsedSearchResultLine | ParsedSearchFileLine): line is ParsedSearchFileLine => line.type === 'file';
const isResultLine = (line: ParsedSearchResultLine | ParsedSearchFileLine): line is ParsedSearchResultLine => line.type === 'result';


function parseSearchResults(document: vscode.TextDocument, token?: vscode.CancellationToken): ParsedSearchResults {

	if (cachedLastParse && cachedLastParse.uri === document.uri && cachedLastParse.version === document.version) {
		return cachedLastParse.parse;
	}

	const lines = document.getText().split(/\r?\n/);
	const links: ParsedSearchResults = [];

	let currentTarget: vscode.Uri | undefined = undefined;
	let currentTargetLocations: vscode.LocationLink[] | undefined = undefined;

	for (let i = 0; i < lines.length; i++) {
		// TODO: This is probably always false, given we're pegging the thread...
		if (token?.isCancellationRequested) { return []; }
		const line = lines[i];

		const fileLine = FILE_LINE_REGEX.exec(line);
		if (fileLine) {
			const [, path] = fileLine;

			currentTarget = relativePathToUri(path, document.uri);
			if (!currentTarget) { continue; }
			currentTargetLocations = [];

			const location: vscode.LocationLink = {
				targetRange: new vscode.Range(0, 0, 0, 1),
				targetUri: currentTarget,
				originSelectionRange: new vscode.Range(i, 0, i, line.length),
			};


			links[i] = { type: 'file', location, allLocations: currentTargetLocations, path };
		}

		if (!currentTarget) { continue; }

		const resultLine = RESULT_LINE_REGEX.exec(line);
		if (resultLine) {
			const [, indentation, _lineNumber, seperator, resultIndentation] = resultLine;
			const lineNumber = +_lineNumber - 1;
			const resultStart = (indentation + _lineNumber + seperator + resultIndentation).length;
			const metadataOffset = (indentation + _lineNumber + seperator).length;
			const targetRange = new vscode.Range(Math.max(lineNumber - 3, 0), 0, lineNumber + 3, line.length);

			let lastEnd = resultStart;
			let offset = 0;
			let locations: Required<vscode.LocationLink>[] = [];
			ELISION_REGEX.lastIndex = resultStart;
			for (let match: RegExpExecArray | null; (match = ELISION_REGEX.exec(line));) {
				locations.push({
					targetRange,
					targetSelectionRange: new vscode.Range(lineNumber, offset, lineNumber, offset),
					targetUri: currentTarget,
					originSelectionRange: new vscode.Range(i, lastEnd, i, ELISION_REGEX.lastIndex - match[0].length),
				});

				offset += (ELISION_REGEX.lastIndex - lastEnd - match[0].length) + Number(match[1]);
				lastEnd = ELISION_REGEX.lastIndex;
			}

			if (lastEnd < line.length) {
				locations.push({
					targetRange,
					targetSelectionRange: new vscode.Range(lineNumber, offset, lineNumber, offset),
					targetUri: currentTarget,
					originSelectionRange: new vscode.Range(i, lastEnd, i, line.length),
				});
			}

			currentTargetLocations?.push(...locations);
			links[i] = { type: 'result', locations, isContext: seperator === ' ', prefixRange: new vscode.Range(i, 0, i, metadataOffset) };
		}
	}

	cachedLastParse = {
		version: document.version,
		parse: links,
		uri: document.uri
	};

	return links;
}
