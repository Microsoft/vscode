/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { createElement, FormattedTextRenderOptions } from 'vs/base/browser/formattedTextRenderer';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IMarkdownString, parseHrefAndDimensions, removeMarkdownEscapes } from 'vs/base/common/htmlContent';
import { defaultGenerator } from 'vs/base/common/idGenerator';
import * as marked from 'vs/base/common/marked/marked';
import { insane, InsaneOptions } from 'vs/base/common/insane/insane';
import { parse } from 'vs/base/common/marshalling';
import { cloneAndChange } from 'vs/base/common/objects';
import { escape } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { markdownEscapeEscapedCodicons } from 'vs/base/common/codicons';
import { resolvePath } from 'vs/base/common/resources';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { renderCodicons } from 'vs/base/browser/codicons';
import { Event } from 'vs/base/common/event';
import { domEvent } from 'vs/base/browser/event';

export interface MarkedOptions extends marked.MarkedOptions {
	baseUrl?: never;
}

export interface MarkdownRenderOptions extends FormattedTextRenderOptions {
	codeBlockRenderer?: (modeId: string, value: string) => Promise<HTMLElement>;
	asyncRenderCallback?: () => void;
	baseUrl?: URI;
}

const _ttpInsane = window.trustedTypes?.createPolicy('insane', {
	createHTML(value, options: InsaneOptions): string {
		return insane(value, options);
	}
});

/**
 * Low-level way create a html element from a markdown string.
 *
 * **Note** that for most cases you should be using [`MarkdownRenderer`](./src/vs/editor/browser/core/markdownRenderer.ts)
 * which comes with support for pretty code block rendering and which uses the default way of handling links.
 */
export function renderMarkdown(markdown: IMarkdownString, options: MarkdownRenderOptions = {}, markedOptions: MarkedOptions = {}): HTMLElement {
	const element = createElement(options);

	const _uriMassage = function (part: string): string {
		let data: any;
		try {
			data = parse(decodeURIComponent(part));
		} catch (e) {
			// ignore
		}
		if (!data) {
			return part;
		}
		data = cloneAndChange(data, value => {
			if (markdown.uris && markdown.uris[value]) {
				return URI.revive(markdown.uris[value]);
			} else {
				return undefined;
			}
		});
		return encodeURIComponent(JSON.stringify(data));
	};

	const _href = function (href: string, isDomUri: boolean): string {
		const data = markdown.uris && markdown.uris[href];
		if (!data) {
			return href; // no uri exists
		}
		let uri = URI.revive(data);
		if (URI.parse(href).toString() === uri.toString()) {
			return href; // no tranformation performed
		}
		if (isDomUri) {
			// this URI will end up as "src"-attribute of a dom node
			// and because of that special rewriting needs to be done
			// so that the URI uses a protocol that's understood by
			// browsers (like http or https)
			return FileAccess.asBrowserUri(uri).toString(true);
		}
		if (uri.query) {
			uri = uri.with({ query: _uriMassage(uri.query) });
		}
		return uri.toString();
	};

	// signal to code-block render that the
	// element has been created
	let signalInnerHTML: () => void;
	const withInnerHTML = new Promise<void>(c => signalInnerHTML = c);

	const renderer = new marked.Renderer();
	renderer.image = (href: string, title: string, text: string) => {
		let dimensions: string[] = [];
		let attributes: string[] = [];
		if (href) {
			({ href, dimensions } = parseHrefAndDimensions(href));
			href = _href(href, true);
			try {
				const hrefAsUri = URI.parse(href);
				if (options.baseUrl && hrefAsUri.scheme === Schemas.file) { // absolute or relative local path, or file: uri
					href = resolvePath(options.baseUrl, href).toString();
				}
			} catch (err) { }

			attributes.push(`src="${href}"`);
		}
		if (text) {
			attributes.push(`alt="${text}"`);
		}
		if (title) {
			attributes.push(`title="${title}"`);
		}
		if (dimensions.length) {
			attributes = attributes.concat(dimensions);
		}
		return '<img ' + attributes.join(' ') + '>';
	};
	renderer.link = (href, title, text): string => {
		// Remove markdown escapes. Workaround for https://github.com/chjj/marked/issues/829
		if (href === text) { // raw link case
			text = removeMarkdownEscapes(text);
		}
		href = _href(href, false);
		if (options.baseUrl) {
			const hasScheme = /^\w[\w\d+.-]*:/.test(href);
			if (!hasScheme) {
				href = resolvePath(options.baseUrl, href).toString();
			}
		}
		title = removeMarkdownEscapes(title);
		href = removeMarkdownEscapes(href);
		if (
			!href
			|| href.match(/^data:|javascript:/i)
			|| (href.match(/^command:/i) && !markdown.isTrusted)
			|| href.match(/^command:(\/\/\/)?_workbench\.downloadResource/i)
		) {
			// drop the link
			return text;

		} else {
			// HTML Encode href
			href = href.replace(/&/g, '&amp;')
				.replace(/</g, '&lt;')
				.replace(/>/g, '&gt;')
				.replace(/"/g, '&quot;')
				.replace(/'/g, '&#39;');
			return `<a href="#" data-href="${href}" title="${title || href}">${text}</a>`;
		}
	};
	renderer.paragraph = (text): string => {
		if (markdown.supportThemeIcons) {
			const elements = renderCodicons(text);
			text = elements.map(e => typeof e === 'string' ? e : e.outerHTML).join('');
		}
		return `<p>${text}</p>`;
	};

	if (options.codeBlockRenderer) {
		renderer.code = (code, lang) => {
			const value = options.codeBlockRenderer!(lang, code);
			// when code-block rendering is async we return sync
			// but update the node with the real result later.
			const id = defaultGenerator.nextId();
			const promise = Promise.all([value, withInnerHTML]).then(values => {
				const span = <HTMLDivElement>element.querySelector(`div[data-code="${id}"]`);
				if (span) {
					DOM.reset(span, values[0]);
				}
			}).catch(_err => {
				// ignore
			});

			if (options.asyncRenderCallback) {
				promise.then(options.asyncRenderCallback);
			}

			return `<div class="code" data-code="${id}">${escape(code)}</div>`;
		};
	}

	if (options.actionHandler) {
		options.actionHandler.disposeables.add(Event.any<MouseEvent>(domEvent(element, 'click'), domEvent(element, 'auxclick'))(e => {
			const mouseEvent = new StandardMouseEvent(e);
			if (!mouseEvent.leftButton && !mouseEvent.middleButton) {
				return;
			}

			let target: HTMLElement | null = mouseEvent.target;
			if (target.tagName !== 'A') {
				target = target.parentElement;
				if (!target || target.tagName !== 'A') {
					return;
				}
			}
			try {
				const href = target.dataset['href'];
				if (href) {
					options.actionHandler!.callback(href, mouseEvent);
				}
			} catch (err) {
				onUnexpectedError(err);
			} finally {
				mouseEvent.preventDefault();
			}
		}));
	}

	// Use our own sanitizer so that we can let through only spans.
	// Otherwise, we'd be letting all html be rendered.
	// If we want to allow markdown permitted tags, then we can delete sanitizer and sanitize.
	// We always pass the output through insane after this so that we don't rely on
	// marked for sanitization.
	markedOptions.sanitizer = (html: string): string => {
		const match = markdown.isTrusted ? html.match(/^(<span[^<]+>)|(<\/\s*span>)$/) : undefined;
		return match ? html : '';
	};
	markedOptions.sanitize = true;
	markedOptions.silent = true;

	markedOptions.renderer = renderer;

	// values that are too long will freeze the UI
	let value = markdown.value ?? '';
	if (value.length > 100_000) {
		value = `${value.substr(0, 100_000)}…`;
	}
	// escape theme icons
	if (markdown.supportThemeIcons) {
		value = markdownEscapeEscapedCodicons(value);
	}

	const renderedMarkdown = marked.parse(value, markedOptions);

	// sanitize with insane
	element.innerHTML = sanitizeRenderedMarkdown(markdown, renderedMarkdown);

	// signal that async code blocks can be now be inserted
	signalInnerHTML!();

	// signal size changes for image tags
	if (options.asyncRenderCallback) {
		for (const img of element.getElementsByTagName('img')) {
			const listener = DOM.addDisposableListener(img, 'load', () => {
				listener.dispose();
				options.asyncRenderCallback!();
			});
		}
	}


	return element;
}

function sanitizeRenderedMarkdown(
	options: { isTrusted?: boolean },
	renderedMarkdown: string,
): string {
	const insaneOptions = getInsaneOptions(options);
	if (_ttpInsane) {
		return _ttpInsane.createHTML(renderedMarkdown, insaneOptions) as unknown as string;
	} else {
		return insane(renderedMarkdown, insaneOptions);
	}
}

function getInsaneOptions(options: { readonly isTrusted?: boolean }): InsaneOptions {
	const allowedSchemes = [
		Schemas.http,
		Schemas.https,
		Schemas.mailto,
		Schemas.data,
		Schemas.file,
		Schemas.vscodeRemote,
		Schemas.vscodeRemoteResource,
	];

	if (options.isTrusted) {
		allowedSchemes.push(Schemas.command);
	}

	return {
		allowedSchemes,
		// allowedTags should included everything that markdown renders to.
		// Since we have our own sanitize function for marked, it's possible we missed some tag so let insane make sure.
		// HTML tags that can result from markdown are from reading https://spec.commonmark.org/0.29/
		// HTML table tags that can result from markdown are from https://github.github.com/gfm/#tables-extension-
		allowedTags: ['ul', 'li', 'p', 'code', 'blockquote', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'em', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'div', 'del', 'a', 'strong', 'br', 'img', 'span'],
		allowedAttributes: {
			'a': ['href', 'name', 'target', 'data-href'],
			'img': ['src', 'title', 'alt', 'width', 'height'],
			'div': ['class', 'data-code'],
			'span': ['class', 'style'],
			// https://github.com/microsoft/vscode/issues/95937
			'th': ['align'],
			'td': ['align']
		},
		filter(token: { tag: string; attrs: { readonly [key: string]: string; }; }): boolean {
			if (token.tag === 'span' && options.isTrusted && (Object.keys(token.attrs).length === 1)) {
				if (token.attrs['style']) {
					return !!token.attrs['style'].match(/^(color\:#[0-9a-fA-F]+;)?(background-color\:#[0-9a-fA-F]+;)?$/);
				} else if (token.attrs['class']) {
					// The class should match codicon rendering in src\vs\base\common\codicons.ts
					return !!token.attrs['class'].match(/^codicon codicon-[a-z\-]+( codicon-animation-[a-z\-]+)?$/);
				}
				return false;
			}
			return true;
		}
	};
}

/**
 * Strips all markdown from `markdown`. For example `# Header` would be output as `Header`.
 */
export function renderMarkdownAsPlaintext(markdown: IMarkdownString) {
	const renderer = new marked.Renderer();

	renderer.code = (code: string): string => {
		return code;
	};
	renderer.blockquote = (quote: string): string => {
		return quote;
	};
	renderer.html = (_html: string): string => {
		return '';
	};
	renderer.heading = (text: string, _level: 1 | 2 | 3 | 4 | 5 | 6, _raw: string): string => {
		return text + '\n';
	};
	renderer.hr = (): string => {
		return '';
	};
	renderer.list = (body: string, _ordered: boolean): string => {
		return body;
	};
	renderer.listitem = (text: string): string => {
		return text + '\n';
	};
	renderer.paragraph = (text: string): string => {
		return text + '\n';
	};
	renderer.table = (header: string, body: string): string => {
		return header + body + '\n';
	};
	renderer.tablerow = (content: string): string => {
		return content;
	};
	renderer.tablecell = (content: string, _flags: {
		header: boolean;
		align: 'center' | 'left' | 'right' | null;
	}): string => {
		return content + ' ';
	};
	renderer.strong = (text: string): string => {
		return text;
	};
	renderer.em = (text: string): string => {
		return text;
	};
	renderer.codespan = (code: string): string => {
		return code;
	};
	renderer.br = (): string => {
		return '\n';
	};
	renderer.del = (text: string): string => {
		return text;
	};
	renderer.image = (_href: string, _title: string, _text: string): string => {
		return '';
	};
	renderer.text = (text: string): string => {
		return text;
	};
	renderer.link = (_href: string, _title: string, text: string): string => {
		return text;
	};
	// values that are too long will freeze the UI
	let value = markdown.value ?? '';
	if (value.length > 100_000) {
		value = `${value.substr(0, 100_000)}…`;
	}
	return sanitizeRenderedMarkdown({ isTrusted: false }, marked.parse(value, { renderer })).toString();
}
