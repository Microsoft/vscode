/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageModelCache, getLanguageModelCache } from '../languageModelCache';
import {
	SymbolInformation, SymbolKind, CompletionItem, Location, SignatureHelp, SignatureInformation, ParameterInformation,
	Definition, TextEdit, TextDocument, Diagnostic, DiagnosticSeverity, Range, CompletionItemKind, Hover,
	DocumentHighlight, DocumentHighlightKind, CompletionList, Position, FormattingOptions, FoldingRange, FoldingRangeKind, SelectionRange,
	LanguageMode, Settings, SemanticTokenData, Workspace, DocumentContext
} from './languageModes';
import { getWordAtText, isWhitespaceOnly, repeat } from '../utils/strings';
import { HTMLDocumentRegions } from './embeddedSupport';
import { normalize, sep } from 'path';

import * as ts from 'typescript';
import { getSemanticTokens, getSemanticTokenLegend } from './javascriptSemanticTokens';
import { statSync } from 'fs';

const JS_WORD_REGEX = /(-?\d*\.\d\w*)|([^\`\~\!\@\#\%\^\&\*\(\)\-\=\+\[\{\]\}\\\|\;\:\'\"\,\.\<\>\/\?\s]+)/g;

/** TypeScript does not handle schemes on file references, so normalize and remove the schemes when communicating with tsserver */
function deschemeURI(uri: string) {
	if (!uri.startsWith('file://')) {
		return uri;
	}

	// This function aims to replicate the logic in TypeScriptServiceClient.normalizedPath
	let newPath = normalize(uri.replace('file://', ''));

	// Both \ and / must be escaped in regular expressions
	newPath = newPath.replace(new RegExp('\\' + sep, 'g'), '/');

	if (process.platform !== 'win32') { return newPath; }

	// Windows URIs come in like '/c%3A/Users/orta/dev/...', we need to switch it to 'c:/Users/orta/dev/...'
	return newPath.slice(1).replace('%3A', ':');
}

function getLanguageServiceHost(scriptKind: ts.ScriptKind) {
	const compilerOptions: ts.CompilerOptions = { allowNonTsExtensions: true, allowJs: true, lib: ['lib.es6.d.ts'], target: ts.ScriptTarget.Latest, moduleResolution: ts.ModuleResolutionKind.Classic, experimentalDecorators: false };

	let currentTextDocument = TextDocument.create('init', 'javascript', 1, '');
	let currentWorkspace: Workspace = undefined!;
	const jsLanguageService = import(/* webpackChunkName: "javascriptLibs" */ './javascriptLibs').then(libs => {
		const host: ts.LanguageServiceHost = {
			getCompilationSettings: () => compilerOptions,
			getScriptFileNames: () => [deschemeURI(currentTextDocument.uri), 'jquery'],
			getScriptKind: (fileName) => {
				if (fileName === currentTextDocument.uri) {
					return scriptKind;
				}
				return fileName.substr(fileName.length - 2) === 'ts' ? ts.ScriptKind.TS : ts.ScriptKind.JS;
			},
			getScriptVersion: (fileName: string) => {
				// Let the outer TextDocument give the version
				if (fileName === deschemeURI(currentTextDocument.uri)) {
					return String(currentTextDocument.version);
				}
				// Default libs and jquery.d.ts are static.
				// Include node_modules as a perf win
				if (fileName.startsWith('lib.') || fileName === 'jquery' || fileName.includes('node_modules')) {
					return '1';
				}
				// Unsure how this could occur, but better to not raise with statSync
				if (!ts.sys.fileExists(fileName)) { return '1'; }
				// Use mtime from the fs
				return String(statSync(fileName).mtimeMs);
			},
			getScriptSnapshot: (fileName: string) => {
				let text = '';
				if (fileName === deschemeURI(currentTextDocument.uri)) {
					text = currentTextDocument.getText();
				} else if (ts.sys.fileExists(fileName)) {
					text = ts.sys.readFile(fileName, 'utf8')!;
				} else {
					text = libs.loadLibrary(fileName);
				}
				return {
					getText: (start, end) => text.substring(start, end),
					getLength: () => text.length,
					getChangeRange: () => undefined
				};
			},
			getCurrentDirectory: () => {
				const workspace = currentWorkspace && currentWorkspace.folders.find(ws => deschemeURI(currentTextDocument.uri).startsWith(deschemeURI(ws.uri)));
				return workspace ? deschemeURI(workspace.uri) : '';
			},
			getDefaultLibFileName: (_options: ts.CompilerOptions) => 'es6',
			fileExists: ts.sys.fileExists,
			readFile: ts.sys.readFile,
			readDirectory: ts.sys.readDirectory,
			directoryExists: ts.sys.directoryExists,
			getDirectories: ts.sys.getDirectories,
		};

		return ts.createLanguageService(host);
	});
	return {
		async getLanguageService(jsDocument: TextDocument, workspace: Workspace): Promise<ts.LanguageService> {
			currentTextDocument = jsDocument;
			currentWorkspace = workspace;
			return jsLanguageService;
		},
		getCompilationSettings() {
			return compilerOptions;
		},
		dispose() {
			jsLanguageService.then(s => s.dispose());
		}
	};
}


export function getJavaScriptMode(documentRegions: LanguageModelCache<HTMLDocumentRegions>, languageId: 'javascript' | 'typescript', workspace: Workspace): LanguageMode {
	let jsDocuments = getLanguageModelCache<TextDocument>(10, 60, document => documentRegions.get(document).getEmbeddedDocument(languageId));

	const host = getLanguageServiceHost(languageId === 'javascript' ? ts.ScriptKind.JS : ts.ScriptKind.TS);
	let globalSettings: Settings = {};

	return {
		getId() {
			return languageId;
		},
		async doValidation(document: TextDocument, settings = workspace.settings): Promise<Diagnostic[]> {
			host.getCompilationSettings()['experimentalDecorators'] = settings && settings.javascript && settings.javascript.implicitProjectConfig.experimentalDecorators;
			const jsDocument = jsDocuments.get(document);
			const languageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			const syntaxDiagnostics: ts.Diagnostic[] = languageService.getSyntacticDiagnostics(filePath);
			const semanticDiagnostics = languageService.getSemanticDiagnostics(filePath);
			return syntaxDiagnostics.concat(semanticDiagnostics).map((diag: ts.Diagnostic): Diagnostic => {
				return {
					range: convertRange(jsDocument, diag),
					severity: DiagnosticSeverity.Error,
					source: languageId,
					message: ts.flattenDiagnosticMessageText(diag.messageText, '\n')
				};
			});
		},
		async doComplete(document: TextDocument, position: Position, _documentContext: DocumentContext): Promise<CompletionList> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			let offset = jsDocument.offsetAt(position);
			let completions = jsLanguageService.getCompletionsAtPosition(filePath, offset, { includeExternalModuleExports: false, includeInsertTextCompletions: false, importModuleSpecifierEnding: 'js' });

			if (!completions) {
				return { isIncomplete: false, items: [] };
			}
			let replaceRange = convertRange(jsDocument, getWordAtText(jsDocument.getText(), offset, JS_WORD_REGEX));
			return {
				isIncomplete: false,
				items: completions.entries.map(entry => {
					return {
						uri: document.uri,
						position: position,
						label: entry.name,
						sortText: entry.sortText,
						kind: convertKind(entry.kind),
						textEdit: TextEdit.replace(replaceRange, entry.name),
						data: { // data used for resolving item details (see 'doResolve')
							languageId,
							uri: document.uri,
							offset: offset
						}
					};
				})
			};
		},
		async doResolve(document: TextDocument, item: CompletionItem): Promise<CompletionItem> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			// @ts-expect-error until 4.3 protocol update
			let details = jsLanguageService.getCompletionEntryDetails(filePath, item.data.offset, item.label, undefined, undefined, undefined, undefined);
			if (details) {
				item.detail = ts.displayPartsToString(details.displayParts);
				item.documentation = ts.displayPartsToString(details.documentation);
				delete item.data;
			}
			return item;
		},
		async doHover(document: TextDocument, position: Position): Promise<Hover | null> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			let info = jsLanguageService.getQuickInfoAtPosition(filePath, jsDocument.offsetAt(position));
			if (info) {
				const contents = ts.displayPartsToString(info.displayParts);
				return {
					range: convertRange(jsDocument, info.textSpan),
					contents: ['```typescript', contents, '```'].join('\n')
				};
			}
			return null;
		},
		async doSignatureHelp(document: TextDocument, position: Position): Promise<SignatureHelp | null> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			let signHelp = jsLanguageService.getSignatureHelpItems(filePath, jsDocument.offsetAt(position), undefined);
			if (signHelp) {
				let ret: SignatureHelp = {
					activeSignature: signHelp.selectedItemIndex,
					activeParameter: signHelp.argumentIndex,
					signatures: []
				};
				signHelp.items.forEach(item => {

					let signature: SignatureInformation = {
						label: '',
						documentation: undefined,
						parameters: []
					};

					signature.label += ts.displayPartsToString(item.prefixDisplayParts);
					item.parameters.forEach((p, i, a) => {
						let label = ts.displayPartsToString(p.displayParts);
						let parameter: ParameterInformation = {
							label: label,
							documentation: ts.displayPartsToString(p.documentation)
						};
						signature.label += label;
						signature.parameters!.push(parameter);
						if (i < a.length - 1) {
							signature.label += ts.displayPartsToString(item.separatorDisplayParts);
						}
					});
					signature.label += ts.displayPartsToString(item.suffixDisplayParts);
					ret.signatures.push(signature);
				});
				return ret;
			}
			return null;
		},
		async doRename(document: TextDocument, position: Position, newName: string) {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const jsDocumentPosition = jsDocument.offsetAt(position);
			const filePath = deschemeURI(jsDocument.uri);

			const { canRename } = jsLanguageService.getRenameInfo(filePath, jsDocumentPosition);
			if (!canRename) {
				return null;
			}
			const renameInfos = jsLanguageService.findRenameLocations(filePath, jsDocumentPosition, false, false);

			const edits: TextEdit[] = [];
			renameInfos?.map(renameInfo => {
				edits.push({
					range: convertRange(jsDocument, renameInfo.textSpan),
					newText: newName,
				});
			});

			return {
				changes: { [document.uri]: edits },
			};
		},
		async findDocumentHighlight(document: TextDocument, position: Position): Promise<DocumentHighlight[]> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			const highlights = jsLanguageService.getDocumentHighlights(filePath, jsDocument.offsetAt(position), [filePath]);
			const out: DocumentHighlight[] = [];
			for (const entry of highlights || []) {
				for (const highlight of entry.highlightSpans) {
					out.push({
						range: convertRange(jsDocument, highlight.textSpan),
						kind: highlight.kind === 'writtenReference' ? DocumentHighlightKind.Write : DocumentHighlightKind.Text
					});
				}
			}
			return out;
		},
		async findDocumentSymbols(document: TextDocument): Promise<SymbolInformation[]> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			let items = jsLanguageService.getNavigationBarItems(filePath);
			if (items) {
				let result: SymbolInformation[] = [];
				let existing = Object.create(null);
				let collectSymbols = (item: ts.NavigationBarItem, containerLabel?: string) => {
					let sig = item.text + item.kind + item.spans[0].start;
					if (item.kind !== 'script' && !existing[sig]) {
						let symbol: SymbolInformation = {
							name: item.text,
							kind: convertSymbolKind(item.kind),
							location: {
								uri: document.uri,
								range: convertRange(jsDocument, item.spans[0])
							},
							containerName: containerLabel
						};
						existing[sig] = true;
						result.push(symbol);
						containerLabel = item.text;
					}

					if (item.childItems && item.childItems.length > 0) {
						for (let child of item.childItems) {
							collectSymbols(child, containerLabel);
						}
					}

				};

				items.forEach(item => collectSymbols(item));
				return result;
			}
			return [];
		},
		async findDefinition(document: TextDocument, position: Position): Promise<Definition | null> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			let definition = jsLanguageService.getDefinitionAtPosition(filePath, jsDocument.offsetAt(position));
			if (definition) {
				return definition.filter(d => d.fileName === jsDocument.uri).map(d => {
					return {
						uri: document.uri,
						range: convertRange(jsDocument, d.textSpan)
					};
				});
			}
			return null;
		},
		async findReferences(document: TextDocument, position: Position): Promise<Location[]> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			let references = jsLanguageService.getReferencesAtPosition(filePath, jsDocument.offsetAt(position));
			if (references) {
				return references.filter(d => d.fileName === filePath).map(d => {
					return {
						uri: document.uri,
						range: convertRange(jsDocument, d.textSpan)
					};
				});
			}
			return [];
		},
		async getSelectionRange(document: TextDocument, position: Position): Promise<SelectionRange> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			function convertSelectionRange(selectionRange: ts.SelectionRange): SelectionRange {
				const parent = selectionRange.parent ? convertSelectionRange(selectionRange.parent) : undefined;
				return SelectionRange.create(convertRange(jsDocument, selectionRange.textSpan), parent);
			}
			const range = jsLanguageService.getSmartSelectionRange(filePath, jsDocument.offsetAt(position));
			return convertSelectionRange(range);
		},
		async format(document: TextDocument, range: Range, formatParams: FormattingOptions, settings: Settings = globalSettings): Promise<TextEdit[]> {
			const jsDocument = documentRegions.get(document).getEmbeddedDocument('javascript', true);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			let formatterSettings = settings && settings.javascript && settings.javascript.format;

			let initialIndentLevel = computeInitialIndent(document, range, formatParams);
			let formatSettings = convertOptions(formatParams, formatterSettings, initialIndentLevel + 1);
			let start = jsDocument.offsetAt(range.start);
			let end = jsDocument.offsetAt(range.end);
			let lastLineRange = null;
			if (range.end.line > range.start.line && (range.end.character === 0 || isWhitespaceOnly(jsDocument.getText().substr(end - range.end.character, range.end.character)))) {
				end -= range.end.character;
				lastLineRange = Range.create(Position.create(range.end.line, 0), range.end);
			}
			let edits = jsLanguageService.getFormattingEditsForRange(filePath, start, end, formatSettings);
			if (edits) {
				let result = [];
				for (let edit of edits) {
					if (edit.span.start >= start && edit.span.start + edit.span.length <= end) {
						result.push({
							range: convertRange(jsDocument, edit.span),
							newText: edit.newText
						});
					}
				}
				if (lastLineRange) {
					result.push({
						range: lastLineRange,
						newText: generateIndent(initialIndentLevel, formatParams)
					});
				}
				return result;
			}
			return [];
		},
		async getFoldingRanges(document: TextDocument): Promise<FoldingRange[]> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			let spans = jsLanguageService.getOutliningSpans(filePath);
			let ranges: FoldingRange[] = [];
			for (let span of spans) {
				let curr = convertRange(jsDocument, span.textSpan);
				let startLine = curr.start.line;
				let endLine = curr.end.line;
				if (startLine < endLine) {
					let foldingRange: FoldingRange = { startLine, endLine };
					let match = document.getText(curr).match(/^\s*\/(?:(\/\s*#(?:end)?region\b)|(\*|\/))/);
					if (match) {
						foldingRange.kind = match[1] ? FoldingRangeKind.Region : FoldingRangeKind.Comment;
					}
					ranges.push(foldingRange);
				}
			}
			return ranges;
		},
		onDocumentRemoved(document: TextDocument) {
			jsDocuments.onDocumentRemoved(document);
		},
		async getSemanticTokens(document: TextDocument): Promise<SemanticTokenData[]> {
			const jsDocument = jsDocuments.get(document);
			const jsLanguageService = await host.getLanguageService(jsDocument, workspace);
			const filePath = deschemeURI(jsDocument.uri);

			return getSemanticTokens(jsLanguageService, jsDocument, filePath);
		},
		getSemanticTokenLegend(): { types: string[], modifiers: string[] } {
			return getSemanticTokenLegend();
		},
		dispose() {
			host.dispose();
			jsDocuments.dispose();
		}
	};
}




function convertRange(document: TextDocument, span: { start: number | undefined, length: number | undefined }): Range {
	if (typeof span.start === 'undefined') {
		const pos = document.positionAt(0);
		return Range.create(pos, pos);
	}
	const startPosition = document.positionAt(span.start);
	const endPosition = document.positionAt(span.start + (span.length || 0));
	return Range.create(startPosition, endPosition);
}

function convertKind(kind: string): CompletionItemKind {
	switch (kind) {
		case 'primitive type':
		case 'keyword':
			return CompletionItemKind.Keyword;
		case 'var':
		case 'local var':
			return CompletionItemKind.Variable;
		case 'property':
		case 'getter':
		case 'setter':
			return CompletionItemKind.Field;
		case 'function':
		case 'method':
		case 'construct':
		case 'call':
		case 'index':
			return CompletionItemKind.Function;
		case 'enum':
			return CompletionItemKind.Enum;
		case 'module':
			return CompletionItemKind.Module;
		case 'class':
			return CompletionItemKind.Class;
		case 'interface':
			return CompletionItemKind.Interface;
		case 'warning':
			return CompletionItemKind.File;
	}

	return CompletionItemKind.Property;
}

function convertSymbolKind(kind: string): SymbolKind {
	switch (kind) {
		case 'var':
		case 'local var':
		case 'const':
			return SymbolKind.Variable;
		case 'function':
		case 'local function':
			return SymbolKind.Function;
		case 'enum':
			return SymbolKind.Enum;
		case 'module':
			return SymbolKind.Module;
		case 'class':
			return SymbolKind.Class;
		case 'interface':
			return SymbolKind.Interface;
		case 'method':
			return SymbolKind.Method;
		case 'property':
		case 'getter':
		case 'setter':
			return SymbolKind.Property;
	}
	return SymbolKind.Variable;
}

function convertOptions(options: FormattingOptions, formatSettings: any, initialIndentLevel: number): ts.FormatCodeOptions {
	return {
		ConvertTabsToSpaces: options.insertSpaces,
		TabSize: options.tabSize,
		IndentSize: options.tabSize,
		IndentStyle: ts.IndentStyle.Smart,
		NewLineCharacter: '\n',
		BaseIndentSize: options.tabSize * initialIndentLevel,
		InsertSpaceAfterCommaDelimiter: Boolean(!formatSettings || formatSettings.insertSpaceAfterCommaDelimiter),
		InsertSpaceAfterSemicolonInForStatements: Boolean(!formatSettings || formatSettings.insertSpaceAfterSemicolonInForStatements),
		InsertSpaceBeforeAndAfterBinaryOperators: Boolean(!formatSettings || formatSettings.insertSpaceBeforeAndAfterBinaryOperators),
		InsertSpaceAfterKeywordsInControlFlowStatements: Boolean(!formatSettings || formatSettings.insertSpaceAfterKeywordsInControlFlowStatements),
		InsertSpaceAfterFunctionKeywordForAnonymousFunctions: Boolean(!formatSettings || formatSettings.insertSpaceAfterFunctionKeywordForAnonymousFunctions),
		InsertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis: Boolean(formatSettings && formatSettings.insertSpaceAfterOpeningAndBeforeClosingNonemptyParenthesis),
		InsertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets: Boolean(formatSettings && formatSettings.insertSpaceAfterOpeningAndBeforeClosingNonemptyBrackets),
		InsertSpaceAfterOpeningAndBeforeClosingNonemptyBraces: Boolean(formatSettings && formatSettings.insertSpaceAfterOpeningAndBeforeClosingNonemptyBraces),
		InsertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces: Boolean(formatSettings && formatSettings.insertSpaceAfterOpeningAndBeforeClosingTemplateStringBraces),
		PlaceOpenBraceOnNewLineForControlBlocks: Boolean(formatSettings && formatSettings.placeOpenBraceOnNewLineForFunctions),
		PlaceOpenBraceOnNewLineForFunctions: Boolean(formatSettings && formatSettings.placeOpenBraceOnNewLineForControlBlocks)
	};
}

function computeInitialIndent(document: TextDocument, range: Range, options: FormattingOptions) {
	let lineStart = document.offsetAt(Position.create(range.start.line, 0));
	let content = document.getText();

	let i = lineStart;
	let nChars = 0;
	let tabSize = options.tabSize || 4;
	while (i < content.length) {
		let ch = content.charAt(i);
		if (ch === ' ') {
			nChars++;
		} else if (ch === '\t') {
			nChars += tabSize;
		} else {
			break;
		}
		i++;
	}
	return Math.floor(nChars / tabSize);
}

function generateIndent(level: number, options: FormattingOptions) {
	if (options.insertSpaces) {
		return repeat(' ', level * options.tabSize);
	} else {
		return repeat('\t', level);
	}
}
