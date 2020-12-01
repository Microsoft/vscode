/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getLanguageModelCache } from '../languageModelCache';
import {
	LanguageService as HTMLLanguageService, HTMLDocument, DocumentContext, FormattingOptions,
	HTMLFormatConfiguration, SelectionRange,
	TextDocument, Position, Range, FoldingRange,
	LanguageMode, Workspace, Settings
} from './languageModes';

export function getHTMLMode(htmlLanguageService: HTMLLanguageService, workspace: Workspace): LanguageMode {
	let htmlDocuments = getLanguageModelCache<HTMLDocument>(10, 60, document => htmlLanguageService.parseHTMLDocument(document));
	return {
		getId() {
			return 'html';
		},
		async getSelectionRange(document: TextDocument, position: Position): Promise<SelectionRange> {
			return htmlLanguageService.getSelectionRanges(document, [position])[0];
		},
		doComplete(document: TextDocument, position: Position, documentContext: DocumentContext, settings = workspace.settings) {
			let options = settings && settings.html && settings.html.suggest;
			let doAutoComplete = settings && settings.html && settings.html.autoClosingTags;
			if (doAutoComplete) {
				options.hideAutoCompleteProposals = true;
			}

			const htmlDocument = htmlDocuments.get(document);
			let completionList = htmlLanguageService.doComplete2(document, position, htmlDocument, documentContext, options);
			return completionList;
		},
		async doHover(document: TextDocument, position: Position, settings?: Settings) {
			return htmlLanguageService.doHover(document, position, htmlDocuments.get(document), settings?.html?.hover);
		},
		async findDocumentHighlight(document: TextDocument, position: Position) {
			return htmlLanguageService.findDocumentHighlights(document, position, htmlDocuments.get(document));
		},
		async findDocumentLinks(document: TextDocument, documentContext: DocumentContext) {
			return htmlLanguageService.findDocumentLinks(document, documentContext);
		},
		async findDocumentSymbols(document: TextDocument) {
			return htmlLanguageService.findDocumentSymbols(document, htmlDocuments.get(document));
		},
		async format(document: TextDocument, range: Range, formatParams: FormattingOptions, settings = workspace.settings) {
			let formatSettings: HTMLFormatConfiguration = settings && settings.html && settings.html.format;
			if (formatSettings) {
				formatSettings = merge(formatSettings, {});
			} else {
				formatSettings = {};
			}
			if (formatSettings.contentUnformatted) {
				formatSettings.contentUnformatted = formatSettings.contentUnformatted + ',script';
			} else {
				formatSettings.contentUnformatted = 'script';
			}
			formatSettings = merge(formatParams, formatSettings);
			return htmlLanguageService.format(document, range, formatSettings);
		},
		async getFoldingRanges(document: TextDocument): Promise<FoldingRange[]> {
			return htmlLanguageService.getFoldingRanges(document);
		},
		async doAutoClose(document: TextDocument, position: Position) {
			let offset = document.offsetAt(position);
			let text = document.getText();
			if (offset > 0 && text.charAt(offset - 1).match(/[>\/]/g)) {
				return htmlLanguageService.doTagComplete(document, position, htmlDocuments.get(document));
			}
			return null;
		},
		async doRename(document: TextDocument, position: Position, newName: string) {
			const htmlDocument = htmlDocuments.get(document);
			return htmlLanguageService.doRename(document, position, newName, htmlDocument);
		},
		async onDocumentRemoved(document: TextDocument) {
			htmlDocuments.onDocumentRemoved(document);
		},
		async findMatchingTagPosition(document: TextDocument, position: Position) {
			const htmlDocument = htmlDocuments.get(document);
			return htmlLanguageService.findMatchingTagPosition(document, position, htmlDocument);
		},
		async doLinkedEditing(document: TextDocument, position: Position) {
			const htmlDocument = htmlDocuments.get(document);
			return htmlLanguageService.findLinkedEditingRanges(document, position, htmlDocument);
		},
		dispose() {
			htmlDocuments.dispose();
		}
	};
}

function merge(src: any, dst: any): any {
	for (const key in src) {
		if (src.hasOwnProperty(key)) {
			dst[key] = src[key];
		}
	}
	return dst;
}
