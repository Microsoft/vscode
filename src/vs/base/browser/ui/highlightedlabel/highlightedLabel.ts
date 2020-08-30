/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as objects from 'vs/base/common/objects';
import { renderCodicons } from 'vs/base/common/codicons';
import { escape } from 'vs/base/common/strings';

export interface IHighlight {
	start: number;
	end: number;
	extraClasses?: string;
}

export class HighlightedLabel {

	private domNode: HTMLElement;
	private text: string = '';
	private title: string = '';
	private highlights: IHighlight[] = [];
	private didEverRender: boolean = false;

	constructor(container: HTMLElement, private supportCodicons: boolean) {
		this.domNode = document.createElement('span');
		this.domNode.className = 'monaco-highlighted-label';

		container.appendChild(this.domNode);
	}

	get element(): HTMLElement {
		return this.domNode;
	}

	set(text: string | undefined, highlights: IHighlight[] = [], title: string = '', escapeNewLines?: boolean) {
		if (!text) {
			text = '';
		}
		if (escapeNewLines) {
			// adjusts highlights inplace
			text = HighlightedLabel.escapeNewLines(text, highlights);
		}
		if (this.didEverRender && this.text === text && this.title === title && objects.equals(this.highlights, highlights)) {
			return;
		}

		if (!Array.isArray(highlights)) {
			highlights = [];
		}

		this.text = text;
		this.title = title;
		this.highlights = highlights;
		this.render();
	}

	private render(): void {

		let htmlContent = '';
		let pos = 0;

		for (const highlight of this.highlights) {
			if (highlight.end === highlight.start) {
				continue;
			}
			if (pos < highlight.start) {
				htmlContent += '<span>';
				const substring = this.text.substring(pos, highlight.start);
				htmlContent += this.supportCodicons ? renderCodicons(escape(substring)) : escape(substring);
				htmlContent += '</span>';
				pos = highlight.end;
			}
			if (highlight.extraClasses) {
				htmlContent += `<span class="highlight ${highlight.extraClasses}">`;
			} else {
				htmlContent += `<span class="highlight">`;
			}
			const substring = this.text.substring(highlight.start, highlight.end);
			htmlContent += this.supportCodicons ? renderCodicons(escape(substring)) : escape(substring);
			htmlContent += '</span>';
			pos = highlight.end;
		}

		if (pos < this.text.length) {
			htmlContent += '<span>';
			const substring = this.text.substring(pos);
			htmlContent += this.supportCodicons ? renderCodicons(escape(substring)) : escape(substring);
			htmlContent += '</span>';
		}

		this.domNode.innerHTML = htmlContent;
		if (this.title) {
			this.domNode.title = this.title;
		} else {
			this.domNode.removeAttribute('title');
		}
		this.didEverRender = true;
	}

	static escapeNewLines(text: string, highlights: IHighlight[]): string {

		let total = 0;
		let extra = 0;

		return text.replace(/\r\n|\r|\n/g, (match, offset) => {
			extra = match === '\r\n' ? -1 : 0;
			offset += total;

			for (const highlight of highlights) {
				if (highlight.end <= offset) {
					continue;
				}
				if (highlight.start >= offset) {
					highlight.start += extra;
				}
				if (highlight.end >= offset) {
					highlight.end += extra;
				}
			}

			total += extra;
			return '\u23CE';
		});
	}
}
