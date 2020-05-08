/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getCSSLanguageService } from 'vscode-css-languageservice';
import {
	ClientCapabilities, DocumentContext, getLanguageService as getHTMLLanguageService, IHTMLDataProvider, SelectionRange,
	CompletionItem, CompletionList, Definition, Diagnostic, DocumentHighlight, DocumentLink, FoldingRange, FormattingOptions,
	Hover, Location, Position, Range, SignatureHelp, SymbolInformation, TextDocument, TextEdit,
	Color, ColorInformation, ColorPresentation, WorkspaceEdit
} from 'vscode-html-languageservice';
import { WorkspaceFolder } from 'vscode-languageserver';
import { getLanguageModelCache, LanguageModelCache } from '../languageModelCache';
import { getCSSMode } from './cssMode';
import { getDocumentRegions, HTMLDocumentRegions } from './embeddedSupport';
import { getHTMLMode } from './htmlMode';
import { getJavaScriptMode } from './javascriptMode';

export * from 'vscode-html-languageservice';
export { WorkspaceFolder } from 'vscode-languageserver';

export interface Settings {
	css?: any;
	html?: any;
	javascript?: any;
}

export interface Workspace {
	readonly settings: Settings;
	readonly folders: WorkspaceFolder[];
}

export interface SemanticTokenData {
	start: Position;
	length: number;
	typeIdx: number;
	modifierSet: number;
}

export interface LanguageMode {
	getId(): string;
	getSelectionRange?: (document: TextDocument, position: Position) => SelectionRange;
	doValidation?: (document: TextDocument, settings?: Settings) => Diagnostic[];
	doComplete?: (document: TextDocument, position: Position, settings?: Settings) => CompletionList;
	doResolve?: (document: TextDocument, item: CompletionItem) => CompletionItem;
	doHover?: (document: TextDocument, position: Position) => Hover | null;
	doSignatureHelp?: (document: TextDocument, position: Position) => SignatureHelp | null;
	doRename?: (document: TextDocument, position: Position, newName: string) => WorkspaceEdit | null;
	doOnTypeRename?: (document: TextDocument, position: Position) => Range[] | null;
	findDocumentHighlight?: (document: TextDocument, position: Position) => DocumentHighlight[];
	findDocumentSymbols?: (document: TextDocument) => SymbolInformation[];
	findDocumentLinks?: (document: TextDocument, documentContext: DocumentContext) => DocumentLink[];
	findDefinition?: (document: TextDocument, position: Position) => Definition | null;
	findReferences?: (document: TextDocument, position: Position) => Location[];
	format?: (document: TextDocument, range: Range, options: FormattingOptions, settings?: Settings) => TextEdit[];
	findDocumentColors?: (document: TextDocument) => ColorInformation[];
	getColorPresentations?: (document: TextDocument, color: Color, range: Range) => ColorPresentation[];
	doAutoClose?: (document: TextDocument, position: Position) => string | null;
	findMatchingTagPosition?: (document: TextDocument, position: Position) => Position | null;
	getFoldingRanges?: (document: TextDocument) => FoldingRange[];
	onDocumentRemoved(document: TextDocument): void;
	getSemanticTokens?(document: TextDocument): SemanticTokenData[];
	getSemanticTokenLegend?(): { types: string[], modifiers: string[] };
	dispose(): void;
}

export interface LanguageModes {
	getModeAtPosition(document: TextDocument, position: Position): LanguageMode | undefined;
	getModesInRange(document: TextDocument, range: Range): LanguageModeRange[];
	getAllModes(): LanguageMode[];
	getAllModesInDocument(document: TextDocument): LanguageMode[];
	getMode(languageId: string): LanguageMode | undefined;
	onDocumentRemoved(document: TextDocument): void;
	dispose(): void;
}

export interface LanguageModeRange extends Range {
	mode: LanguageMode | undefined;
	attributeValue?: boolean;
}

export function getLanguageModes(supportedLanguages: { [languageId: string]: boolean; }, workspace: Workspace, clientCapabilities: ClientCapabilities, customDataProviders?: IHTMLDataProvider[]): LanguageModes {
	const htmlLanguageService = getHTMLLanguageService({ customDataProviders, clientCapabilities });
	const cssLanguageService = getCSSLanguageService({ clientCapabilities });

	let documentRegions = getLanguageModelCache<HTMLDocumentRegions>(10, 60, document => getDocumentRegions(htmlLanguageService, document));

	let modelCaches: LanguageModelCache<any>[] = [];
	modelCaches.push(documentRegions);

	let modes = Object.create(null);
	modes['html'] = getHTMLMode(htmlLanguageService, workspace);
	if (supportedLanguages['css']) {
		modes['css'] = getCSSMode(cssLanguageService, documentRegions, workspace);
	}
	if (supportedLanguages['javascript']) {
		modes['javascript'] = getJavaScriptMode(documentRegions, 'javascript', workspace);
		modes['typescript'] = getJavaScriptMode(documentRegions, 'typescript', workspace);
	}
	return {
		getModeAtPosition(document: TextDocument, position: Position): LanguageMode | undefined {
			let languageId = documentRegions.get(document).getLanguageAtPosition(position);
			if (languageId) {
				return modes[languageId];
			}
			return undefined;
		},
		getModesInRange(document: TextDocument, range: Range): LanguageModeRange[] {
			return documentRegions.get(document).getLanguageRanges(range).map(r => {
				return <LanguageModeRange>{
					start: r.start,
					end: r.end,
					mode: r.languageId && modes[r.languageId],
					attributeValue: r.attributeValue
				};
			});
		},
		getAllModesInDocument(document: TextDocument): LanguageMode[] {
			let result = [];
			for (let languageId of documentRegions.get(document).getLanguagesInDocument()) {
				let mode = modes[languageId];
				if (mode) {
					result.push(mode);
				}
			}
			return result;
		},
		getAllModes(): LanguageMode[] {
			let result = [];
			for (let languageId in modes) {
				let mode = modes[languageId];
				if (mode) {
					result.push(mode);
				}
			}
			return result;
		},
		getMode(languageId: string): LanguageMode {
			return modes[languageId];
		},
		onDocumentRemoved(document: TextDocument) {
			modelCaches.forEach(mc => mc.onDocumentRemoved(document));
			for (let mode in modes) {
				modes[mode].onDocumentRemoved(document);
			}
		},
		dispose(): void {
			modelCaches.forEach(mc => mc.dispose());
			modelCaches = [];
			for (let mode in modes) {
				modes[mode].dispose();
			}
			modes = {};
		}
	};
}
