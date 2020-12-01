/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LanguageModelCache, getLanguageModelCache } from '../languageModelCache';
import { Stylesheet, LanguageService as CSSLanguageService } from 'vscode-css-languageservice';
import { LanguageMode, Workspace, Color, TextDocument, Position, Range, CompletionList, DocumentContext, Settings } from './languageModes';
import { HTMLDocumentRegions, CSS_STYLE_RULE } from './embeddedSupport';

export function getCSSMode(cssLanguageService: CSSLanguageService, documentRegions: LanguageModelCache<HTMLDocumentRegions>, workspace: Workspace): LanguageMode {
	let embeddedCSSDocuments = getLanguageModelCache<TextDocument>(10, 60, document => documentRegions.get(document).getEmbeddedDocument('css'));
	let cssStylesheets = getLanguageModelCache<Stylesheet>(10, 60, document => cssLanguageService.parseStylesheet(document));

	return {
		getId() {
			return 'css';
		},
		async doValidation(document: TextDocument, settings = workspace.settings) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.doValidation(embedded, cssStylesheets.get(embedded), settings && settings.css);
		},
		async doComplete(document: TextDocument, position: Position, documentContext: DocumentContext, _settings = workspace.settings) {
			let embedded = embeddedCSSDocuments.get(document);
			const stylesheet = cssStylesheets.get(embedded);
			return cssLanguageService.doComplete2(embedded, position, stylesheet, documentContext) || CompletionList.create();
		},
		async doHover(document: TextDocument, position: Position, settings?: Settings) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.doHover(embedded, position, cssStylesheets.get(embedded), settings?.html?.hover);
		},
		async findDocumentHighlight(document: TextDocument, position: Position) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.findDocumentHighlights(embedded, position, cssStylesheets.get(embedded));
		},
		async findDocumentSymbols(document: TextDocument) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.findDocumentSymbols(embedded, cssStylesheets.get(embedded)).filter(s => s.name !== CSS_STYLE_RULE);
		},
		async findDefinition(document: TextDocument, position: Position) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.findDefinition(embedded, position, cssStylesheets.get(embedded));
		},
		async findReferences(document: TextDocument, position: Position) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.findReferences(embedded, position, cssStylesheets.get(embedded));
		},
		async findDocumentColors(document: TextDocument) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.findDocumentColors(embedded, cssStylesheets.get(embedded));
		},
		async getColorPresentations(document: TextDocument, color: Color, range: Range) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.getColorPresentations(embedded, cssStylesheets.get(embedded), color, range);
		},
		async getFoldingRanges(document: TextDocument) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.getFoldingRanges(embedded, {});
		},
		async getSelectionRange(document: TextDocument, position: Position) {
			let embedded = embeddedCSSDocuments.get(document);
			return cssLanguageService.getSelectionRanges(embedded, [position], cssStylesheets.get(embedded))[0];
		},
		onDocumentRemoved(document: TextDocument) {
			embeddedCSSDocuments.onDocumentRemoved(document);
			cssStylesheets.onDocumentRemoved(document);
		},
		dispose() {
			embeddedCSSDocuments.dispose();
			cssStylesheets.dispose();
		}
	};
}
