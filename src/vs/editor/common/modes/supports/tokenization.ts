/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color } from 'vs/base/common/color';
import { ColorId, FontStyle, LanguageId, MetadataConsts, StandardTokenType } from 'vs/editor/common/modes';

export interface ITokenThemeRule {
	token: string;
	foreground?: string;
	background?: string;
	fontStyle?: string;
}

export class ParsedTokenThemeRule {
	_parsedThemeRuleBrand: void;

	readonly token: string;
	readonly index: number;

	/**
	 * -1 if not set. An or mask of `FontStyle` otherwise.
	 */
	readonly fontStyle: FontStyle;
	readonly foreground: string | null;
	readonly background: string | null;

	constructor(
		token: string,
		index: number,
		fontStyle: number,
		foreground: string | null,
		background: string | null,
	) {
		this.token = token;
		this.index = index;
		this.fontStyle = fontStyle;
		this.foreground = foreground;
		this.background = background;
	}
}

/**
 * Parse a raw theme into rules.
 */
export function parseTokenTheme(source: ITokenThemeRule[]): ParsedTokenThemeRule[] {
	if (!source || !Array.isArray(source)) {
		return [];
	}
	let result: ParsedTokenThemeRule[] = [], resultLen = 0;
	for (let i = 0, len = source.length; i < len; i++) {
		let entry = source[i];

		let fontStyle: number = FontStyle.NotSet;
		if (typeof entry.fontStyle === 'string') {
			fontStyle = FontStyle.None;

			let segments = entry.fontStyle.split(' ');
			for (let j = 0, lenJ = segments.length; j < lenJ; j++) {
				let segment = segments[j];
				switch (segment) {
					case 'italic':
						fontStyle = fontStyle | FontStyle.Italic;
						break;
					case 'bold':
						fontStyle = fontStyle | FontStyle.Bold;
						break;
					case 'underline':
						fontStyle = fontStyle | FontStyle.Underline;
						break;
				}
			}
		}

		let foreground: string | null = null;
		if (typeof entry.foreground === 'string') {
			foreground = entry.foreground;
		}

		let background: string | null = null;
		if (typeof entry.background === 'string') {
			background = entry.background;
		}

		result[resultLen++] = new ParsedTokenThemeRule(
			entry.token || '',
			i,
			fontStyle,
			foreground,
			background
		);
	}

	return result;
}

/**
 * Resolve rules (i.e. inheritance).
 */
function resolveParsedTokenThemeRules(parsedThemeRules: ParsedTokenThemeRule[], customTokenColors: string[]): TokenTheme {

	// Sort rules lexicographically, and then by index if necessary
	parsedThemeRules.sort((a, b) => {
		let r = strcmp(a.token, b.token);
		if (r !== 0) {
			return r;
		}
		return a.index - b.index;
	});

	// Determine defaults
	let defaultFontStyle = FontStyle.None;
	let defaultForeground = '000000';
	let defaultBackground = 'ffffff';
	while (parsedThemeRules.length >= 1 && parsedThemeRules[0].token === '') {
		let incomingDefaults = parsedThemeRules.shift()!;
		if (incomingDefaults.fontStyle !== FontStyle.NotSet) {
			defaultFontStyle = incomingDefaults.fontStyle;
		}
		if (incomingDefaults.foreground !== null) {
			defaultForeground = incomingDefaults.foreground;
		}
		if (incomingDefaults.background !== null) {
			defaultBackground = incomingDefaults.background;
		}
	}
	let colorMap = new ColorMap();

	// start with token colors from custom token themes
	for (let color of customTokenColors) {
		colorMap.getId(color);
	}


	let foregroundColorId = colorMap.getId(defaultForeground);
	let backgroundColorId = colorMap.getId(defaultBackground);

	let defaults = new ThemeTrieElementRule(defaultFontStyle, foregroundColorId, backgroundColorId);
	let root = new ThemeTrieElement(defaults);
	for (let i = 0, len = parsedThemeRules.length; i < len; i++) {
		let rule = parsedThemeRules[i];
		root.insert(rule.token, rule.fontStyle, colorMap.getId(rule.foreground), colorMap.getId(rule.background));
	}

	return new TokenTheme(colorMap, root);
}

const colorRegExp = /^#?([0-9A-Fa-f]{6})([0-9A-Fa-f]{2})?$/;

export class ColorMap {

	private _lastColorId: number;
	private readonly _id2color: Color[];
	private readonly _color2id: Map<string, ColorId>;

	constructor() {
		this._lastColorId = 0;
		this._id2color = [];
		this._color2id = new Map<string, ColorId>();
	}

	public getId(color: string | null): ColorId {
		if (color === null) {
			return 0;
		}
		const match = color.match(colorRegExp);
		if (!match) {
			throw new Error('Illegal value for token color: ' + color);
		}
		color = match[1].toUpperCase();
		let value = this._color2id.get(color);
		if (value) {
			return value;
		}
		value = ++this._lastColorId;
		this._color2id.set(color, value);
		this._id2color[value] = Color.fromHex('#' + color);
		return value;
	}

	public getColorMap(): Color[] {
		return this._id2color.slice(0);
	}

}

export class TokenTheme {

	public static createFromRawTokenTheme(source: ITokenThemeRule[], customTokenColors: string[]): TokenTheme {
		return this.createFromParsedTokenTheme(parseTokenTheme(source), customTokenColors);
	}

	public static createFromParsedTokenTheme(source: ParsedTokenThemeRule[], customTokenColors: string[]): TokenTheme {
		return resolveParsedTokenThemeRules(source, customTokenColors);
	}

	private readonly _colorMap: ColorMap;
	private readonly _root: ThemeTrieElement;
	private readonly _cache: Map<string, number>;

	constructor(colorMap: ColorMap, root: ThemeTrieElement) {
		this._colorMap = colorMap;
		this._root = root;
		this._cache = new Map<string, number>();
	}

	public getColorMap(): Color[] {
		return this._colorMap.getColorMap();
	}

	/**
	 * used for testing purposes
	 */
	public getThemeTrieElement(): ExternalThemeTrieElement {
		return this._root.toExternalThemeTrieElement();
	}

	public _match(token: string): ThemeTrieElementRule {
		return this._root.match(token);
	}

	public match(languageId: LanguageId, token: string): number {
		// The cache contains the metadata without the language bits set.
		let result = this._cache.get(token);
		if (typeof result === 'undefined') {
			let rule = this._match(token);
			let standardToken = toStandardTokenType(token);
			result = (
				rule.metadata
				| (standardToken << MetadataConsts.TOKEN_TYPE_OFFSET)
			) >>> 0;
			this._cache.set(token, result);
		}

		return (
			result
			| (languageId << MetadataConsts.LANGUAGEID_OFFSET)
		) >>> 0;
	}
}

const STANDARD_TOKEN_TYPE_REGEXP = /\b(comment|string|regex|regexp)\b/;
export function toStandardTokenType(tokenType: string): StandardTokenType {
	let m = tokenType.match(STANDARD_TOKEN_TYPE_REGEXP);
	if (!m) {
		return StandardTokenType.Other;
	}
	switch (m[1]) {
		case 'comment':
			return StandardTokenType.Comment;
		case 'string':
			return StandardTokenType.String;
		case 'regex':
			return StandardTokenType.RegEx;
		case 'regexp':
			return StandardTokenType.RegEx;
	}
	throw new Error('Unexpected match for standard token type!');
}

export function strcmp(a: string, b: string): number {
	if (a < b) {
		return -1;
	}
	if (a > b) {
		return 1;
	}
	return 0;
}

export class ThemeTrieElementRule {
	_themeTrieElementRuleBrand: void;

	private _fontStyle: FontStyle;
	private _foreground: ColorId;
	private _background: ColorId;
	public metadata: number;

	constructor(fontStyle: FontStyle, foreground: ColorId, background: ColorId) {
		this._fontStyle = fontStyle;
		this._foreground = foreground;
		this._background = background;
		this.metadata = (
			(this._fontStyle << MetadataConsts.FONT_STYLE_OFFSET)
			| (this._foreground << MetadataConsts.FOREGROUND_OFFSET)
			| (this._background << MetadataConsts.BACKGROUND_OFFSET)
		) >>> 0;
	}

	public clone(): ThemeTrieElementRule {
		return new ThemeTrieElementRule(this._fontStyle, this._foreground, this._background);
	}

	public acceptOverwrite(fontStyle: FontStyle, foreground: ColorId, background: ColorId): void {
		if (fontStyle !== FontStyle.NotSet) {
			this._fontStyle = fontStyle;
		}
		if (foreground !== ColorId.None) {
			this._foreground = foreground;
		}
		if (background !== ColorId.None) {
			this._background = background;
		}
		this.metadata = (
			(this._fontStyle << MetadataConsts.FONT_STYLE_OFFSET)
			| (this._foreground << MetadataConsts.FOREGROUND_OFFSET)
			| (this._background << MetadataConsts.BACKGROUND_OFFSET)
		) >>> 0;
	}
}

export class ExternalThemeTrieElement {

	public readonly mainRule: ThemeTrieElementRule;
	public readonly children: Map<string, ExternalThemeTrieElement>;

	constructor(
		mainRule: ThemeTrieElementRule,
		children: Map<string, ExternalThemeTrieElement> | { [key: string]: ExternalThemeTrieElement } = new Map<string, ExternalThemeTrieElement>()
	) {
		this.mainRule = mainRule;
		if (children instanceof Map) {
			this.children = children;
		} else {
			this.children = new Map<string, ExternalThemeTrieElement>();
			for (const key in children) {
				this.children.set(key, children[key]);
			}
		}
	}
}

export class ThemeTrieElement {
	_themeTrieElementBrand: void;

	private readonly _mainRule: ThemeTrieElementRule;
	private readonly _children: Map<string, ThemeTrieElement>;

	constructor(mainRule: ThemeTrieElementRule) {
		this._mainRule = mainRule;
		this._children = new Map<string, ThemeTrieElement>();
	}

	/**
	 * used for testing purposes
	 */
	public toExternalThemeTrieElement(): ExternalThemeTrieElement {
		const children = new Map<string, ExternalThemeTrieElement>();
		this._children.forEach((element, index) => {
			children.set(index, element.toExternalThemeTrieElement());
		});
		return new ExternalThemeTrieElement(this._mainRule, children);
	}

	public match(token: string): ThemeTrieElementRule {
		if (token === '') {
			return this._mainRule;
		}

		let dotIndex = token.indexOf('.');
		let head: string;
		let tail: string;
		if (dotIndex === -1) {
			head = token;
			tail = '';
		} else {
			head = token.substring(0, dotIndex);
			tail = token.substring(dotIndex + 1);
		}

		let child = this._children.get(head);
		if (typeof child !== 'undefined') {
			return child.match(tail);
		}

		return this._mainRule;
	}

	public insert(token: string, fontStyle: FontStyle, foreground: ColorId, background: ColorId): void {
		if (token === '') {
			// Merge into the main rule
			this._mainRule.acceptOverwrite(fontStyle, foreground, background);
			return;
		}

		let dotIndex = token.indexOf('.');
		let head: string;
		let tail: string;
		if (dotIndex === -1) {
			head = token;
			tail = '';
		} else {
			head = token.substring(0, dotIndex);
			tail = token.substring(dotIndex + 1);
		}

		let child = this._children.get(head);
		if (typeof child === 'undefined') {
			child = new ThemeTrieElement(this._mainRule.clone());
			this._children.set(head, child);
		}

		child.insert(tail, fontStyle, foreground, background);
	}
}

export function generateTokensCSSForColorMap(colorMap: readonly Color[]): string {
	let rules: string[] = [];
	for (let i = 1, len = colorMap.length; i < len; i++) {
		let color = colorMap[i];
		rules[i] = `.mtk${i} { color: ${color}; }`;
	}
	rules.push('.mtki { font-style: italic; }');
	rules.push('.mtkb { font-weight: bold; }');
	rules.push('.mtku { text-decoration: underline; text-underline-position: under; }');
	return rules.join('\n');
}
