/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from 'vs/base/common/arrays';
import { UriComponents } from 'vs/base/common/uri';
import { escapeCodicons } from 'vs/base/common/codicons';
import { illegalArgument } from 'vs/base/common/errors';

export interface IMarkdownString {
	readonly value: string;
	readonly isTrusted?: boolean;
	readonly supportThemeIcons?: boolean;
	uris?: { [href: string]: UriComponents };
}

export class MarkdownString implements IMarkdownString {
	private readonly _isTrusted: boolean;
	private readonly _supportThemeIcons: boolean;

	constructor(
		private _value: string = '',
		isTrustedOrOptions: boolean | { isTrusted?: boolean, supportThemeIcons?: boolean } = false,
	) {
		if (typeof this._value !== 'string') {
			throw illegalArgument('value');
		}

		if (typeof isTrustedOrOptions === 'boolean') {
			this._isTrusted = isTrustedOrOptions;
			this._supportThemeIcons = false;
		}
		else {
			this._isTrusted = isTrustedOrOptions.isTrusted ?? false;
			this._supportThemeIcons = isTrustedOrOptions.supportThemeIcons ?? false;
		}
	}

	get value() { return this._value; }
	get isTrusted() { return this._isTrusted; }
	get supportThemeIcons() { return this._supportThemeIcons; }

	appendText(value: string): MarkdownString {
		// escape markdown syntax tokens: http://daringfireball.net/projects/markdown/syntax#backslash
		this._value += (this._supportThemeIcons ? escapeCodicons(value) : value)
			.replace(/[\\`*_{}[\]()#+\-.!]/g, '\\$&')
			.replace('\n', '\n\n');

		return this;
	}

	appendMarkdown(value: string): MarkdownString {
		this._value += value;

		return this;
	}

	appendCodeblock(langId: string, code: string): MarkdownString {
		this._value += '\n```';
		this._value += langId;
		this._value += '\n';
		this._value += code;
		this._value += '\n```\n';
		return this;
	}
}

export function isEmptyMarkdownString(oneOrMany: IMarkdownString | IMarkdownString[] | null | undefined): boolean {
	if (isMarkdownString(oneOrMany)) {
		return !oneOrMany.value;
	} else if (Array.isArray(oneOrMany)) {
		return oneOrMany.every(isEmptyMarkdownString);
	} else {
		return true;
	}
}

export function isMarkdownString(thing: any): thing is IMarkdownString {
	if (thing instanceof MarkdownString) {
		return true;
	} else if (thing && typeof thing === 'object') {
		return typeof (<IMarkdownString>thing).value === 'string'
			&& (typeof (<IMarkdownString>thing).isTrusted === 'boolean' || (<IMarkdownString>thing).isTrusted === undefined)
			&& (typeof (<IMarkdownString>thing).supportThemeIcons === 'boolean' || (<IMarkdownString>thing).supportThemeIcons === undefined);
	}
	return false;
}

export function markedStringsEquals(a: IMarkdownString | IMarkdownString[], b: IMarkdownString | IMarkdownString[]): boolean {
	if (!a && !b) {
		return true;
	} else if (!a || !b) {
		return false;
	} else if (Array.isArray(a) && Array.isArray(b)) {
		return equals(a, b, markdownStringEqual);
	} else if (isMarkdownString(a) && isMarkdownString(b)) {
		return markdownStringEqual(a, b);
	} else {
		return false;
	}
}

function markdownStringEqual(a: IMarkdownString, b: IMarkdownString): boolean {
	if (a === b) {
		return true;
	} else if (!a || !b) {
		return false;
	} else {
		return a.value === b.value && a.isTrusted === b.isTrusted && a.supportThemeIcons === b.supportThemeIcons;
	}
}

export function removeMarkdownEscapes(text: string): string {
	if (!text) {
		return text;
	}
	return text.replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');
}

export function parseHrefAndDimensions(href: string): { href: string, dimensions: string[] } {
	const dimensions: string[] = [];
	const splitted = href.split('|').map(s => s.trim());
	href = splitted[0];
	const parameters = splitted[1];
	if (parameters) {
		const heightFromParams = /height=(\d+)/.exec(parameters);
		const widthFromParams = /width=(\d+)/.exec(parameters);
		const height = heightFromParams ? heightFromParams[1] : '';
		const width = widthFromParams ? widthFromParams[1] : '';
		const widthIsFinite = isFinite(parseInt(width));
		const heightIsFinite = isFinite(parseInt(height));
		if (widthIsFinite) {
			dimensions.push(`width="${width}"`);
		}
		if (heightIsFinite) {
			dimensions.push(`height="${height}"`);
		}
	}
	return { href, dimensions };
}
