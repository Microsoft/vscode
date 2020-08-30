/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as Proto from '../protocol';

function replaceLinks(text: string): string {
	return text
		// Http(s) links
		.replace(/\{@(link|linkplain|linkcode) (https?:\/\/[^ |}]+?)(?:[| ]([^{}\n]+?))?\}/gi, (_, tag: string, link: string, text?: string) => {
			switch (tag) {
				case 'linkcode':
					return `[\`${text ? text.trim() : link}\`](${link})`;

				default:
					return `[${text ? text.trim() : link}](${link})`;
			}
		});
}

function processInlineTags(text: string): string {
	return replaceLinks(text);
}

function getTagBodyText(tag: Proto.JSDocTagInfo): string | undefined {
	if (!tag.text) {
		return undefined;
	}

	// Convert to markdown code block if it is not already one
	function makeCodeblock(text: string): string {
		if (text.match(/^\s*[~`]{3}/g)) {
			return text;
		}
		return '```\n' + text + '\n```';
	}

	switch (tag.name) {
		case 'example':
			// check for caption tags, fix for #79704
			const captionTagMatches = tag.text.match(/<caption>(.*?)<\/caption>\s*(\r\n|\n)/);
			if (captionTagMatches && captionTagMatches.index === 0) {
				return captionTagMatches[1] + '\n\n' + makeCodeblock(tag.text.substr(captionTagMatches[0].length));
			} else {
				return makeCodeblock(tag.text);
			}
		case 'author':
			// fix obsucated email address, #80898
			const emailMatch = tag.text.match(/(.+)\s<([-.\w]+@[-.\w]+)>/);

			if (emailMatch === null) {
				return tag.text;
			} else {
				return `${emailMatch[1]} ${emailMatch[2]}`;
			}
		case 'default':
			return makeCodeblock(tag.text);
	}

	return processInlineTags(tag.text);
}

function getTagDocumentation(tag: Proto.JSDocTagInfo): string | undefined {
	switch (tag.name) {
		case 'augments':
		case 'extends':
		case 'param':
		case 'template':
			const body = (tag.text || '').split(/^(\S+)\s*-?\s*/);
			if (body?.length === 3) {
				const param = body[1];
				const doc = body[2];
				const label = `*@${tag.name}* \`${param}\``;
				if (!doc) {
					return label;
				}
				return label + (doc.match(/\r\n|\n/g) ? '  \n' + processInlineTags(doc) : ` — ${processInlineTags(doc)}`);
			}
	}

	// Generic tag
	const label = `*@${tag.name}*`;
	const text = getTagBodyText(tag);
	if (!text) {
		return label;
	}
	return label + (text.match(/\r\n|\n/g) ? '  \n' + text : ` — ${text}`);
}

export function plain(parts: Proto.SymbolDisplayPart[] | string): string {
	return processInlineTags(
		typeof parts === 'string'
			? parts
			: parts.map(part => part.text).join(''));
}

export function tagsMarkdownPreview(tags: Proto.JSDocTagInfo[]): string {
	return tags.map(getTagDocumentation).join('  \n\n');
}

export function markdownDocumentation(
	documentation: Proto.SymbolDisplayPart[] | string,
	tags: Proto.JSDocTagInfo[]
): vscode.MarkdownString {
	const out = new vscode.MarkdownString();
	addMarkdownDocumentation(out, documentation, tags);
	return out;
}

export function addMarkdownDocumentation(
	out: vscode.MarkdownString,
	documentation: Proto.SymbolDisplayPart[] | string | undefined,
	tags: Proto.JSDocTagInfo[] | undefined
): vscode.MarkdownString {
	if (documentation) {
		out.appendMarkdown(plain(documentation));
	}

	if (tags) {
		const tagsPreview = tagsMarkdownPreview(tags);
		if (tagsPreview) {
			out.appendMarkdown('\n\n' + tagsPreview);
		}
	}
	return out;
}
