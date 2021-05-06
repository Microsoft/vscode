/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as marked from 'vs/base/common/marked/marked';
import { tokenizeToString } from 'vs/editor/common/modes/textToHtmlTokenizer';
import { ITokenizationSupport, TokenizationRegistry } from 'vs/editor/common/modes';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IModeService } from 'vs/editor/common/services/modeService';
import { insane } from 'vs/base/common/insane/insane';

export const DEFAULT_MARKDOWN_STYLES = `
body {
	padding: 10px 20px;
	line-height: 22px;
	max-width: 882px;
	margin: 0 auto;
}

img {
	max-width: 100%;
	max-height: 100%;
}

a {
	text-decoration: none;
}

a:hover {
	text-decoration: underline;
}

a:focus,
input:focus,
select:focus,
textarea:focus {
	outline: 1px solid -webkit-focus-ring-color;
	outline-offset: -1px;
}

hr {
	border: 0;
	height: 2px;
	border-bottom: 2px solid;
}

h1 {
	padding-bottom: 0.3em;
	line-height: 1.2;
	border-bottom-width: 1px;
	border-bottom-style: solid;
}

h1, h2, h3 {
	font-weight: normal;
}

table {
	border-collapse: collapse;
}

table > thead > tr > th {
	text-align: left;
	border-bottom: 1px solid;
}

table > thead > tr > th,
table > thead > tr > td,
table > tbody > tr > th,
table > tbody > tr > td {
	padding: 5px 10px;
}

table > tbody > tr + tr > td {
	border-top-width: 1px;
	border-top-style: solid;
}

blockquote {
	margin: 0 7px 0 5px;
	padding: 0 16px 0 10px;
	border-left-width: 5px;
	border-left-style: solid;
}

code {
	font-family: "SF Mono", Monaco, Menlo, Consolas, "Ubuntu Mono", "Liberation Mono", "DejaVu Sans Mono", "Courier New", monospace;
	font-size: 14px;
	line-height: 19px;
}

pre code {
	font-family: var(--vscode-editor-font-family);
	font-weight: var(--vscode-editor-font-weight);
	font-size: var(--vscode-editor-font-size);
	line-height: 1.5;
}

code > div {
	padding: 16px;
	border-radius: 3px;
	overflow: auto;
}

.monaco-tokenized-source {
	white-space: pre;
}

/** Theming */

.vscode-light code > div {
	background-color: rgba(220, 220, 220, 0.4);
}

.vscode-dark code > div {
	background-color: rgba(10, 10, 10, 0.4);
}

.vscode-high-contrast code > div {
	background-color: rgb(0, 0, 0);
}

.vscode-high-contrast h1 {
	border-color: rgb(0, 0, 0);
}

.vscode-light table > thead > tr > th {
	border-color: rgba(0, 0, 0, 0.69);
}

.vscode-dark table > thead > tr > th {
	border-color: rgba(255, 255, 255, 0.69);
}

.vscode-light h1,
.vscode-light hr,
.vscode-light table > tbody > tr + tr > td {
	border-color: rgba(0, 0, 0, 0.18);
}

.vscode-dark h1,
.vscode-dark hr,
.vscode-dark table > tbody > tr + tr > td {
	border-color: rgba(255, 255, 255, 0.18);
}

`;

function removeEmbeddedSVGs(documentContent: string): string {
	return insane(documentContent, {
		allowedTags: [
			'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7', 'h8', 'br', 'b', 'i', 'strong', 'em', 'a', 'pre', 'code', 'img', 'tt',
			'div', 'ins', 'del', 'sup', 'sub', 'p', 'ol', 'ul', 'table', 'thead', 'tbody', 'tfoot', 'blockquote', 'dl', 'dt',
			'dd', 'kbd', 'q', 'samp', 'var', 'hr', 'ruby', 'rt', 'rp', 'li', 'tr', 'td', 'th', 's', 'strike', 'summary', 'details',
			'caption', 'figure', 'figcaption', 'abbr', 'bdo', 'cite', 'dfn', 'mark', 'small', 'span', 'time', 'wbr'
		],
		allowedAttributes: {
			'*': [
				'align',
			],
			img: ['src', 'alt', 'title', 'aria-label', 'width', 'height'],
			span: ['class'],
		},
		allowedSchemes: ['http', 'https', 'command',],
		filter(token: { tag: string, attrs: { readonly [key: string]: string } }): boolean {
			return token.tag !== 'svg';
		}
	});
}

/**
 * Renders a string of markdown as a document.
 *
 * Uses VS Code's syntax highlighting code blocks.
 */
export async function renderMarkdownDocument(
	text: string,
	extensionService: IExtensionService,
	modeService: IModeService,
	shouldRemoveEmbeddedSVGs: boolean = true,
): Promise<string> {

	const highlight = (code: string, lang: string, callback: ((error: any, code: string) => void) | undefined): any => {
		if (!callback) {
			return code;
		}
		extensionService.whenInstalledExtensionsRegistered().then(async () => {
			let support: ITokenizationSupport | undefined;
			const modeId = modeService.getModeIdForLanguageName(lang);
			if (modeId) {
				modeService.triggerMode(modeId);
				support = await TokenizationRegistry.getPromise(modeId) ?? undefined;
			}
			callback(null, `<code>${tokenizeToString(code, support)}</code>`);
		});
		return '';
	};

	return new Promise<string>((resolve, reject) => {
		marked(text, { highlight }, (err, value) => err ? reject(err) : resolve(value));
	}).then(raw => {
		if (shouldRemoveEmbeddedSVGs) {
			return removeEmbeddedSVGs(raw);
		}
		else {
			return raw;
		}
	});
}
