/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename } from 'vs/base/common/path';
import * as Json from 'vs/base/common/json';
import { Color } from 'vs/base/common/color';
import { ExtensionData, ITokenColorCustomizations, ITextMateThemingRule, IWorkbenchColorTheme, IColorMap, IThemeExtensionPoint, VS_LIGHT_THEME, VS_HC_THEME, IColorCustomizations, ISemanticTokenRules, ISemanticTokenColorizationSetting, ISemanticTokenColorCustomizations, IExperimentalSemanticTokenColorCustomizations } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { convertSettings } from 'vs/workbench/services/themes/common/themeCompatibility';
import * as nls from 'vs/nls';
import * as types from 'vs/base/common/types';
import * as resources from 'vs/base/common/resources';
import { Extensions as ColorRegistryExtensions, IColorRegistry, ColorIdentifier, editorBackground, editorForeground } from 'vs/platform/theme/common/colorRegistry';
import { ITokenStyle, getThemeTypeSelector } from 'vs/platform/theme/common/themeService';
import { Registry } from 'vs/platform/registry/common/platform';
import { getParseErrorMessage } from 'vs/base/common/jsonErrorMessages';
import { URI } from 'vs/base/common/uri';
import { parse as parsePList } from 'vs/workbench/services/themes/common/plistParser';
import { TokenStyle, SemanticTokenRule, ProbeScope, getTokenClassificationRegistry, TokenStyleValue, TokenStyleData, parseClassifierString } from 'vs/platform/theme/common/tokenClassificationRegistry';
import { MatcherWithPriority, Matcher, createMatchers } from 'vs/workbench/services/themes/common/textMateScopeMatcher';
import { IExtensionResourceLoaderService } from 'vs/workbench/services/extensionResourceLoader/common/extensionResourceLoader';
import { CharCode } from 'vs/base/common/charCode';
import { StorageScope, IStorageService, StorageTarget } from 'vs/platform/storage/common/storage';
import { ThemeConfiguration } from 'vs/workbench/services/themes/common/themeConfiguration';
import { ColorScheme } from 'vs/platform/theme/common/theme';

let colorRegistry = Registry.as<IColorRegistry>(ColorRegistryExtensions.ColorContribution);

let tokenClassificationRegistry = getTokenClassificationRegistry();

const tokenGroupToScopesMap = {
	comments: ['comment', 'punctuation.definition.comment'],
	strings: ['string', 'meta.embedded.assembly'],
	keywords: ['keyword - keyword.operator', 'keyword.control', 'storage', 'storage.type'],
	numbers: ['constant.numeric'],
	types: ['entity.name.type', 'entity.name.class', 'support.type', 'support.class'],
	functions: ['entity.name.function', 'support.function'],
	variables: ['variable', 'entity.name.variable']
};


export type TokenStyleDefinition = SemanticTokenRule | ProbeScope[] | TokenStyleValue;
export type TokenStyleDefinitions = { [P in keyof TokenStyleData]?: TokenStyleDefinition | undefined };

export type TextMateThemingRuleDefinitions = { [P in keyof TokenStyleData]?: ITextMateThemingRule | undefined; } & { scope?: ProbeScope; };

export class ColorThemeData implements IWorkbenchColorTheme {

	static readonly STORAGE_KEY = 'colorThemeData';

	id: string;
	label: string;
	settingsId: string;
	description?: string;
	isLoaded: boolean;
	location?: URI; // only set for extension from the registry, not for themes restored from the storage
	watch?: boolean;
	extensionData?: ExtensionData;

	private themeSemanticHighlighting: boolean | undefined;
	private customSemanticHighlighting: boolean | undefined;
	private customSemanticHighlightingDeprecated: boolean | undefined;

	private themeTokenColors: ITextMateThemingRule[] = [];
	private customTokenColors: ITextMateThemingRule[] = [];
	private colorMap: IColorMap = {};
	private customColorMap: IColorMap = {};

	private semanticTokenRules: SemanticTokenRule[] = [];
	private customSemanticTokenRules: SemanticTokenRule[] = [];

	private themeTokenScopeMatchers: Matcher<ProbeScope>[] | undefined;
	private customTokenScopeMatchers: Matcher<ProbeScope>[] | undefined;

	private textMateThemingRules: ITextMateThemingRule[] | undefined = undefined; // created on demand
	private tokenColorIndex: TokenColorIndex | undefined = undefined; // created on demand

	private constructor(id: string, label: string, settingsId: string) {
		this.id = id;
		this.label = label;
		this.settingsId = settingsId;
		this.isLoaded = false;
	}

	get semanticHighlighting(): boolean {
		if (this.customSemanticHighlighting !== undefined) {
			return this.customSemanticHighlighting;
		}
		if (this.customSemanticHighlightingDeprecated !== undefined) {
			return this.customSemanticHighlightingDeprecated;
		}
		return !!this.themeSemanticHighlighting;
	}

	get tokenColors(): ITextMateThemingRule[] {
		if (!this.textMateThemingRules) {
			const result: ITextMateThemingRule[] = [];

			// the default rule (scope empty) is always the first rule. Ignore all other default rules.
			const foreground = this.getColor(editorForeground) || this.getDefault(editorForeground)!;
			const background = this.getColor(editorBackground) || this.getDefault(editorBackground)!;
			result.push({
				settings: {
					foreground: normalizeColor(foreground),
					background: normalizeColor(background)
				}
			});

			let hasDefaultTokens = false;

			function addRule(rule: ITextMateThemingRule) {
				if (rule.scope && rule.settings) {
					if (rule.scope === 'token.info-token') {
						hasDefaultTokens = true;
					}
					result.push({ scope: rule.scope, settings: { foreground: normalizeColor(rule.settings.foreground), background: normalizeColor(rule.settings.background), fontStyle: rule.settings.fontStyle } });
				}
			}

			this.themeTokenColors.forEach(addRule);
			// Add the custom colors after the theme colors
			// so that they will override them
			this.customTokenColors.forEach(addRule);

			if (!hasDefaultTokens) {
				defaultThemeColors[this.type].forEach(addRule);
			}
			this.textMateThemingRules = result;
		}
		return this.textMateThemingRules;
	}

	public getColor(colorId: ColorIdentifier, useDefault?: boolean): Color | undefined {
		let color: Color | undefined = this.customColorMap[colorId];
		if (color) {
			return color;
		}
		color = this.colorMap[colorId];
		if (useDefault !== false && types.isUndefined(color)) {
			color = this.getDefault(colorId);
		}
		return color;
	}

	private getTokenStyle(type: string, modifiers: string[], language: string, useDefault = true, definitions: TokenStyleDefinitions = {}): TokenStyle | undefined {
		let result: any = {
			foreground: undefined,
			bold: undefined,
			underline: undefined,
			italic: undefined
		};
		let score = {
			foreground: -1,
			bold: -1,
			underline: -1,
			italic: -1
		};

		function _processStyle(matchScore: number, style: TokenStyle, definition: TokenStyleDefinition) {
			if (style.foreground && score.foreground <= matchScore) {
				score.foreground = matchScore;
				result.foreground = style.foreground;
				definitions.foreground = definition;
			}
			for (let p of ['bold', 'underline', 'italic']) {
				const property = p as keyof TokenStyle;
				const info = style[property];
				if (info !== undefined) {
					if (score[property] <= matchScore) {
						score[property] = matchScore;
						result[property] = info;
						definitions[property] = definition;
					}
				}
			}
		}
		function _processSemanticTokenRule(rule: SemanticTokenRule) {
			const matchScore = rule.selector.match(type, modifiers, language);
			if (matchScore >= 0) {
				_processStyle(matchScore, rule.style, rule);
			}
		}

		this.semanticTokenRules.forEach(_processSemanticTokenRule);
		this.customSemanticTokenRules.forEach(_processSemanticTokenRule);

		let hasUndefinedStyleProperty = false;
		for (let k in score) {
			const key = k as keyof TokenStyle;
			if (score[key] === -1) {
				hasUndefinedStyleProperty = true;
			} else {
				score[key] = Number.MAX_VALUE; // set it to the max, so it won't be replaced by a default
			}
		}
		if (hasUndefinedStyleProperty) {
			for (const rule of tokenClassificationRegistry.getTokenStylingDefaultRules()) {
				const matchScore = rule.selector.match(type, modifiers, language);
				if (matchScore >= 0) {
					let style: TokenStyle | undefined;
					if (rule.defaults.scopesToProbe) {
						style = this.resolveScopes(rule.defaults.scopesToProbe);
						if (style) {
							_processStyle(matchScore, style, rule.defaults.scopesToProbe);
						}
					}
					if (!style && useDefault !== false) {
						const tokenStyleValue = rule.defaults[this.type];
						style = this.resolveTokenStyleValue(tokenStyleValue);
						if (style) {
							_processStyle(matchScore, style, tokenStyleValue!);
						}
					}
				}
			}
		}
		return TokenStyle.fromData(result);

	}

	/**
	 * @param tokenStyleValue Resolve a tokenStyleValue in the context of a theme
	 */
	public resolveTokenStyleValue(tokenStyleValue: TokenStyleValue | undefined): TokenStyle | undefined {
		if (tokenStyleValue === undefined) {
			return undefined;
		} else if (typeof tokenStyleValue === 'string') {
			const { type, modifiers, language } = parseClassifierString(tokenStyleValue, '');
			return this.getTokenStyle(type, modifiers, language);
		} else if (typeof tokenStyleValue === 'object') {
			return tokenStyleValue;
		}
		return undefined;
	}

	private getTokenColorIndex(): TokenColorIndex {
		// collect all colors that tokens can have
		if (!this.tokenColorIndex) {
			const index = new TokenColorIndex();
			this.tokenColors.forEach(rule => {
				index.add(rule.settings.foreground);
				index.add(rule.settings.background);
			});

			this.semanticTokenRules.forEach(r => index.add(r.style.foreground));
			tokenClassificationRegistry.getTokenStylingDefaultRules().forEach(r => {
				const defaultColor = r.defaults[this.type];
				if (defaultColor && typeof defaultColor === 'object') {
					index.add(defaultColor.foreground);
				}
			});
			this.customSemanticTokenRules.forEach(r => index.add(r.style.foreground));

			this.tokenColorIndex = index;
		}
		return this.tokenColorIndex;
	}

	public get tokenColorMap(): string[] {
		return this.getTokenColorIndex().asArray();
	}

	public getTokenStyleMetadata(typeWithLanguage: string, modifiers: string[], defaultLanguage: string, useDefault = true, definitions: TokenStyleDefinitions = {}): ITokenStyle | undefined {
		const { type, language } = parseClassifierString(typeWithLanguage, defaultLanguage);
		let style = this.getTokenStyle(type, modifiers, language, useDefault, definitions);
		if (!style) {
			return undefined;
		}

		return {
			foreground: this.getTokenColorIndex().get(style.foreground),
			bold: style.bold,
			underline: style.underline,
			italic: style.italic
		};
	}

	public getTokenStylingRuleScope(rule: SemanticTokenRule): 'setting' | 'theme' | undefined {
		if (this.customSemanticTokenRules.indexOf(rule) !== -1) {
			return 'setting';
		}
		if (this.semanticTokenRules.indexOf(rule) !== -1) {
			return 'theme';
		}
		return undefined;
	}

	public getDefault(colorId: ColorIdentifier): Color | undefined {
		return colorRegistry.resolveDefaultColor(colorId, this);
	}


	public resolveScopes(scopes: ProbeScope[], definitions?: TextMateThemingRuleDefinitions): TokenStyle | undefined {

		if (!this.themeTokenScopeMatchers) {
			this.themeTokenScopeMatchers = this.themeTokenColors.map(getScopeMatcher);
		}
		if (!this.customTokenScopeMatchers) {
			this.customTokenScopeMatchers = this.customTokenColors.map(getScopeMatcher);
		}

		for (let scope of scopes) {
			let foreground: string | undefined = undefined;
			let fontStyle: string | undefined = undefined;
			let foregroundScore = -1;
			let fontStyleScore = -1;
			let fontStyleThemingRule: ITextMateThemingRule | undefined = undefined;
			let foregroundThemingRule: ITextMateThemingRule | undefined = undefined;

			function findTokenStyleForScopeInScopes(scopeMatchers: Matcher<ProbeScope>[], themingRules: ITextMateThemingRule[]) {
				for (let i = 0; i < scopeMatchers.length; i++) {
					const score = scopeMatchers[i](scope);
					if (score >= 0) {
						const themingRule = themingRules[i];
						const settings = themingRules[i].settings;
						if (score >= foregroundScore && settings.foreground) {
							foreground = settings.foreground;
							foregroundScore = score;
							foregroundThemingRule = themingRule;
						}
						if (score >= fontStyleScore && types.isString(settings.fontStyle)) {
							fontStyle = settings.fontStyle;
							fontStyleScore = score;
							fontStyleThemingRule = themingRule;
						}
					}
				}
			}
			findTokenStyleForScopeInScopes(this.themeTokenScopeMatchers, this.themeTokenColors);
			findTokenStyleForScopeInScopes(this.customTokenScopeMatchers, this.customTokenColors);
			if (foreground !== undefined || fontStyle !== undefined) {
				if (definitions) {
					definitions.foreground = foregroundThemingRule;
					definitions.bold = definitions.italic = definitions.underline = fontStyleThemingRule;
					definitions.scope = scope;
				}

				return TokenStyle.fromSettings(foreground, fontStyle);
			}
		}
		return undefined;
	}

	public defines(colorId: ColorIdentifier): boolean {
		return this.customColorMap.hasOwnProperty(colorId) || this.colorMap.hasOwnProperty(colorId);
	}

	public setCustomizations(settings: ThemeConfiguration) {
		this.setCustomColors(settings.colorCustomizations);
		this.setCustomTokenColors(settings.tokenColorCustomizations);
		this.setCustomSemanticTokenColors(settings.semanticTokenColorCustomizations, settings.experimentalSemanticTokenColorCustomizations);
	}

	public setCustomColors(colors: IColorCustomizations) {
		this.customColorMap = {};
		this.overwriteCustomColors(colors);

		const themeSpecificColors = colors[`[${this.settingsId}]`] as IColorCustomizations;
		if (types.isObject(themeSpecificColors)) {
			this.overwriteCustomColors(themeSpecificColors);
		}

		this.tokenColorIndex = undefined;
		this.textMateThemingRules = undefined;
		this.customTokenScopeMatchers = undefined;
	}

	private overwriteCustomColors(colors: IColorCustomizations) {
		for (let id in colors) {
			let colorVal = colors[id];
			if (typeof colorVal === 'string') {
				this.customColorMap[id] = Color.fromHex(colorVal);
			}
		}
	}

	public setCustomTokenColors(customTokenColors: ITokenColorCustomizations) {
		this.customTokenColors = [];
		this.customSemanticHighlightingDeprecated = undefined;

		// first add the non-theme specific settings
		this.addCustomTokenColors(customTokenColors);

		// append theme specific settings. Last rules will win.
		const themeSpecificTokenColors = customTokenColors[`[${this.settingsId}]`] as ITokenColorCustomizations;
		if (types.isObject(themeSpecificTokenColors)) {
			this.addCustomTokenColors(themeSpecificTokenColors);
		}

		this.tokenColorIndex = undefined;
		this.textMateThemingRules = undefined;
		this.customTokenScopeMatchers = undefined;
	}

	public setCustomSemanticTokenColors(semanticTokenColors: ISemanticTokenColorCustomizations | undefined, experimental?: IExperimentalSemanticTokenColorCustomizations) {
		this.customSemanticTokenRules = [];
		this.customSemanticHighlighting = undefined;

		if (experimental) { // apply deprecated settings first
			this.readSemanticTokenRules(experimental);
			const themeSpecificColors = experimental[`[${this.settingsId}]`] as IExperimentalSemanticTokenColorCustomizations;
			if (types.isObject(themeSpecificColors)) {
				this.readSemanticTokenRules(themeSpecificColors);
			}
		}
		if (semanticTokenColors) {
			this.customSemanticHighlighting = semanticTokenColors.enabled;
			if (semanticTokenColors.rules) {
				this.readSemanticTokenRules(semanticTokenColors.rules);
			}
			const themeSpecificColors = semanticTokenColors[`[${this.settingsId}]`] as ISemanticTokenColorCustomizations;
			if (types.isObject(themeSpecificColors)) {
				if (themeSpecificColors.enabled !== undefined) {
					this.customSemanticHighlighting = themeSpecificColors.enabled;
				}
				if (themeSpecificColors.rules) {
					this.readSemanticTokenRules(themeSpecificColors.rules);
				}
			}
		}

		this.tokenColorIndex = undefined;
		this.textMateThemingRules = undefined;
	}


	private readSemanticTokenRules(tokenStylingRuleSection: ISemanticTokenRules) {
		for (let key in tokenStylingRuleSection) {
			if (key[0] !== '[') { // still do this test until experimental settings are gone
				try {
					const rule = readSemanticTokenRule(key, tokenStylingRuleSection[key]);
					if (rule) {
						this.customSemanticTokenRules.push(rule);
					}
				} catch (e) {
					// invalid selector, ignore
				}
			}
		}
	}

	private addCustomTokenColors(customTokenColors: ITokenColorCustomizations) {
		// Put the general customizations such as comments, strings, etc. first so that
		// they can be overridden by specific customizations like "string.interpolated"
		for (let tokenGroup in tokenGroupToScopesMap) {
			const group = <keyof typeof tokenGroupToScopesMap>tokenGroup; // TS doesn't type 'tokenGroup' properly
			let value = customTokenColors[group];
			if (value) {
				let settings = typeof value === 'string' ? { foreground: value } : value;
				let scopes = tokenGroupToScopesMap[group];
				for (let scope of scopes) {
					this.customTokenColors.push({ scope, settings });
				}
			}
		}

		// specific customizations
		if (Array.isArray(customTokenColors.textMateRules)) {
			for (let rule of customTokenColors.textMateRules) {
				if (rule.scope && rule.settings) {
					this.customTokenColors.push(rule);
				}
			}
		}
		if (customTokenColors.semanticHighlighting !== undefined) {
			this.customSemanticHighlightingDeprecated = customTokenColors.semanticHighlighting;
		}
	}

	public ensureLoaded(extensionResourceLoaderService: IExtensionResourceLoaderService): Promise<void> {
		return !this.isLoaded ? this.load(extensionResourceLoaderService) : Promise.resolve(undefined);
	}

	public reload(extensionResourceLoaderService: IExtensionResourceLoaderService): Promise<void> {
		return this.load(extensionResourceLoaderService);
	}

	private load(extensionResourceLoaderService: IExtensionResourceLoaderService): Promise<void> {
		if (!this.location) {
			return Promise.resolve(undefined);
		}
		this.themeTokenColors = [];
		this.clearCaches();

		const result = {
			colors: {},
			textMateRules: [],
			semanticTokenRules: [],
			semanticHighlighting: false
		};
		return _loadColorTheme(extensionResourceLoaderService, this.location, result).then(_ => {
			this.isLoaded = true;
			this.semanticTokenRules = result.semanticTokenRules;
			this.colorMap = result.colors;
			this.themeTokenColors = result.textMateRules;
			this.themeSemanticHighlighting = result.semanticHighlighting;
		});
	}

	public clearCaches() {
		this.tokenColorIndex = undefined;
		this.textMateThemingRules = undefined;
		this.themeTokenScopeMatchers = undefined;
		this.customTokenScopeMatchers = undefined;
	}

	toStorage(storageService: IStorageService) {
		let colorMapData: { [key: string]: string } = {};
		for (let key in this.colorMap) {
			colorMapData[key] = Color.Format.CSS.formatHexA(this.colorMap[key], true);
		}
		// no need to persist custom colors, they will be taken from the settings
		const value = JSON.stringify({
			id: this.id,
			label: this.label,
			settingsId: this.settingsId,
			themeTokenColors: this.themeTokenColors.map(tc => ({ settings: tc.settings, scope: tc.scope })), // don't pesist names
			semanticTokenRules: this.semanticTokenRules.map(SemanticTokenRule.toJSONObject),
			extensionData: ExtensionData.toJSONObject(this.extensionData),
			themeSemanticHighlighting: this.themeSemanticHighlighting,
			colorMap: colorMapData,
			watch: this.watch
		});

		// roam persisted color theme colors. Don't enable for icons as they contain references to fonts and images.
		storageService.store(ColorThemeData.STORAGE_KEY, value, StorageScope.GLOBAL, StorageTarget.USER);
	}

	get baseTheme(): string {
		return this.classNames[0];
	}

	get classNames(): string[] {
		return this.id.split(' ');
	}

	get type(): ColorScheme {
		switch (this.baseTheme) {
			case VS_LIGHT_THEME: return ColorScheme.LIGHT;
			case VS_HC_THEME: return ColorScheme.HIGH_CONTRAST;
			default: return ColorScheme.DARK;
		}
	}

	// constructors

	static createUnloadedThemeForThemeType(themeType: ColorScheme, colorMap?: { [id: string]: string }): ColorThemeData {
		return ColorThemeData.createUnloadedTheme(getThemeTypeSelector(themeType), colorMap);
	}

	static createUnloadedTheme(id: string, colorMap?: { [id: string]: string }): ColorThemeData {
		let themeData = new ColorThemeData(id, '', '__' + id);
		themeData.isLoaded = false;
		themeData.themeTokenColors = [];
		themeData.watch = false;
		if (colorMap) {
			for (let id in colorMap) {
				themeData.colorMap[id] = Color.fromHex(colorMap[id]);
			}
		}
		return themeData;
	}

	static createLoadedEmptyTheme(id: string, settingsId: string): ColorThemeData {
		let themeData = new ColorThemeData(id, '', settingsId);
		themeData.isLoaded = true;
		themeData.themeTokenColors = [];
		themeData.watch = false;
		return themeData;
	}

	static fromStorageData(storageService: IStorageService): ColorThemeData | undefined {
		const input = storageService.get(ColorThemeData.STORAGE_KEY, StorageScope.GLOBAL);
		if (!input) {
			return undefined;
		}
		try {
			let data = JSON.parse(input);
			let theme = new ColorThemeData('', '', '');
			for (let key in data) {
				switch (key) {
					case 'colorMap':
						let colorMapData = data[key];
						for (let id in colorMapData) {
							theme.colorMap[id] = Color.fromHex(colorMapData[id]);
						}
						break;
					case 'themeTokenColors':
					case 'id': case 'label': case 'settingsId': case 'watch': case 'themeSemanticHighlighting':
						(theme as any)[key] = data[key];
						break;
					case 'semanticTokenRules':
						const rulesData = data[key];
						if (Array.isArray(rulesData)) {
							for (let d of rulesData) {
								const rule = SemanticTokenRule.fromJSONObject(tokenClassificationRegistry, d);
								if (rule) {
									theme.semanticTokenRules.push(rule);
								}
							}
						}
						break;
					case 'location':
						// ignore, no longer restore
						break;
					case 'extensionData':
						theme.extensionData = ExtensionData.fromJSONObject(data.extensionData);
						break;
				}
			}
			if (!theme.id || !theme.settingsId) {
				return undefined;
			}
			return theme;
		} catch (e) {
			return undefined;
		}
	}

	static fromExtensionTheme(theme: IThemeExtensionPoint, colorThemeLocation: URI, extensionData: ExtensionData): ColorThemeData {
		const baseTheme: string = theme['uiTheme'] || 'vs-dark';
		const themeSelector = toCSSSelector(extensionData.extensionId, theme.path);
		const id = `${baseTheme} ${themeSelector}`;
		const label = theme.label || basename(theme.path);
		const settingsId = theme.id || label;
		const themeData = new ColorThemeData(id, label, settingsId);
		themeData.description = theme.description;
		themeData.watch = theme._watch === true;
		themeData.location = colorThemeLocation;
		themeData.extensionData = extensionData;
		themeData.isLoaded = false;
		return themeData;
	}
}

function toCSSSelector(extensionId: string, path: string) {
	if (path.startsWith('./')) {
		path = path.substr(2);
	}
	let str = `${extensionId}-${path}`;

	//remove all characters that are not allowed in css
	str = str.replace(/[^_\-a-zA-Z0-9]/g, '-');
	if (str.charAt(0).match(/[0-9\-]/)) {
		str = '_' + str;
	}
	return str;
}

async function _loadColorTheme(extensionResourceLoaderService: IExtensionResourceLoaderService, themeLocation: URI, result: { textMateRules: ITextMateThemingRule[], colors: IColorMap, semanticTokenRules: SemanticTokenRule[], semanticHighlighting: boolean }): Promise<any> {
	if (resources.extname(themeLocation) === '.json') {
		const content = await extensionResourceLoaderService.readExtensionResource(themeLocation);
		let errors: Json.ParseError[] = [];
		let contentValue = Json.parse(content, errors);
		if (errors.length > 0) {
			return Promise.reject(new Error(nls.localize('error.cannotparsejson', "Problems parsing JSON theme file: {0}", errors.map(e => getParseErrorMessage(e.error)).join(', '))));
		} else if (Json.getNodeType(contentValue) !== 'object') {
			return Promise.reject(new Error(nls.localize('error.invalidformat', "Invalid format for JSON theme file: Object expected.")));
		}
		if (contentValue.include) {
			await _loadColorTheme(extensionResourceLoaderService, resources.joinPath(resources.dirname(themeLocation), contentValue.include), result);
		}
		if (Array.isArray(contentValue.settings)) {
			convertSettings(contentValue.settings, result);
			return null;
		}
		result.semanticHighlighting = result.semanticHighlighting || contentValue.semanticHighlighting;
		let colors = contentValue.colors;
		if (colors) {
			if (typeof colors !== 'object') {
				return Promise.reject(new Error(nls.localize({ key: 'error.invalidformat.colors', comment: ['{0} will be replaced by a path. Values in quotes should not be translated.'] }, "Problem parsing color theme file: {0}. Property 'colors' is not of type 'object'.", themeLocation.toString())));
			}
			// new JSON color themes format
			for (let colorId in colors) {
				let colorHex = colors[colorId];
				if (typeof colorHex === 'string') { // ignore colors tht are null
					result.colors[colorId] = Color.fromHex(colors[colorId]);
				}
			}
		}
		let tokenColors = contentValue.tokenColors;
		if (tokenColors) {
			if (Array.isArray(tokenColors)) {
				result.textMateRules.push(...tokenColors);
			} else if (typeof tokenColors === 'string') {
				await _loadSyntaxTokens(extensionResourceLoaderService, resources.joinPath(resources.dirname(themeLocation), tokenColors), result);
			} else {
				return Promise.reject(new Error(nls.localize({ key: 'error.invalidformat.tokenColors', comment: ['{0} will be replaced by a path. Values in quotes should not be translated.'] }, "Problem parsing color theme file: {0}. Property 'tokenColors' should be either an array specifying colors or a path to a TextMate theme file", themeLocation.toString())));
			}
		}
		let semanticTokenColors = contentValue.semanticTokenColors;
		if (semanticTokenColors && typeof semanticTokenColors === 'object') {
			for (let key in semanticTokenColors) {
				try {
					const rule = readSemanticTokenRule(key, semanticTokenColors[key]);
					if (rule) {
						result.semanticTokenRules.push(rule);
					}
				} catch (e) {
					return Promise.reject(new Error(nls.localize({ key: 'error.invalidformat.semanticTokenColors', comment: ['{0} will be replaced by a path. Values in quotes should not be translated.'] }, "Problem parsing color theme file: {0}. Property 'semanticTokenColors' contains a invalid selector", themeLocation.toString())));
				}
			}
		}
	} else {
		return _loadSyntaxTokens(extensionResourceLoaderService, themeLocation, result);
	}
}

function _loadSyntaxTokens(extensionResourceLoaderService: IExtensionResourceLoaderService, themeLocation: URI, result: { textMateRules: ITextMateThemingRule[], colors: IColorMap }): Promise<any> {
	return extensionResourceLoaderService.readExtensionResource(themeLocation).then(content => {
		try {
			let contentValue = parsePList(content);
			let settings: ITextMateThemingRule[] = contentValue.settings;
			if (!Array.isArray(settings)) {
				return Promise.reject(new Error(nls.localize('error.plist.invalidformat', "Problem parsing tmTheme file: {0}. 'settings' is not array.")));
			}
			convertSettings(settings, result);
			return Promise.resolve(null);
		} catch (e) {
			return Promise.reject(new Error(nls.localize('error.cannotparse', "Problems parsing tmTheme file: {0}", e.message)));
		}
	}, error => {
		return Promise.reject(new Error(nls.localize('error.cannotload', "Problems loading tmTheme file {0}: {1}", themeLocation.toString(), error.message)));
	});
}

let defaultThemeColors: { [baseTheme: string]: ITextMateThemingRule[] } = {
	'light': [
		{ scope: 'token.info-token', settings: { foreground: '#316bcd' } },
		{ scope: 'token.warn-token', settings: { foreground: '#cd9731' } },
		{ scope: 'token.error-token', settings: { foreground: '#cd3131' } },
		{ scope: 'token.debug-token', settings: { foreground: '#800080' } }
	],
	'dark': [
		{ scope: 'token.info-token', settings: { foreground: '#6796e6' } },
		{ scope: 'token.warn-token', settings: { foreground: '#cd9731' } },
		{ scope: 'token.error-token', settings: { foreground: '#f44747' } },
		{ scope: 'token.debug-token', settings: { foreground: '#b267e6' } }
	],
	'hc': [
		{ scope: 'token.info-token', settings: { foreground: '#6796e6' } },
		{ scope: 'token.warn-token', settings: { foreground: '#008000' } },
		{ scope: 'token.error-token', settings: { foreground: '#FF0000' } },
		{ scope: 'token.debug-token', settings: { foreground: '#b267e6' } }
	],
};

const noMatch = (_scope: ProbeScope) => -1;

function nameMatcher(identifers: string[], scope: ProbeScope): number {
	function findInIdents(s: string, lastIndent: number): number {
		for (let i = lastIndent - 1; i >= 0; i--) {
			if (scopesAreMatching(s, identifers[i])) {
				return i;
			}
		}
		return -1;
	}
	if (scope.length < identifers.length) {
		return -1;
	}
	let lastScopeIndex = scope.length - 1;
	let lastIdentifierIndex = findInIdents(scope[lastScopeIndex--], identifers.length);
	if (lastIdentifierIndex >= 0) {
		const score = (lastIdentifierIndex + 1) * 0x10000 + identifers[lastIdentifierIndex].length;
		while (lastScopeIndex >= 0) {
			lastIdentifierIndex = findInIdents(scope[lastScopeIndex--], lastIdentifierIndex);
			if (lastIdentifierIndex === -1) {
				return -1;
			}
		}
		return score;
	}
	return -1;
}


function scopesAreMatching(thisScopeName: string, scopeName: string): boolean {
	if (!thisScopeName) {
		return false;
	}
	if (thisScopeName === scopeName) {
		return true;
	}
	const len = scopeName.length;
	return thisScopeName.length > len && thisScopeName.substr(0, len) === scopeName && thisScopeName[len] === '.';
}

function getScopeMatcher(rule: ITextMateThemingRule): Matcher<ProbeScope> {
	const ruleScope = rule.scope;
	if (!ruleScope || !rule.settings) {
		return noMatch;
	}
	const matchers: MatcherWithPriority<ProbeScope>[] = [];
	if (Array.isArray(ruleScope)) {
		for (let rs of ruleScope) {
			createMatchers(rs, nameMatcher, matchers);
		}
	} else {
		createMatchers(ruleScope, nameMatcher, matchers);
	}

	if (matchers.length === 0) {
		return noMatch;
	}
	return (scope: ProbeScope) => {
		let max = matchers[0].matcher(scope);
		for (let i = 1; i < matchers.length; i++) {
			max = Math.max(max, matchers[i].matcher(scope));
		}
		return max;
	};
}

function readSemanticTokenRule(selectorString: string, settings: ISemanticTokenColorizationSetting | string | boolean | undefined): SemanticTokenRule | undefined {
	const selector = tokenClassificationRegistry.parseTokenSelector(selectorString);
	let style: TokenStyle | undefined;
	if (typeof settings === 'string') {
		style = TokenStyle.fromSettings(settings, undefined);
	} else if (isSemanticTokenColorizationSetting(settings)) {
		style = TokenStyle.fromSettings(settings.foreground, settings.fontStyle, settings.bold, settings.underline, settings.italic);
	}
	if (style) {
		return { selector, style };
	}
	return undefined;
}

function isSemanticTokenColorizationSetting(style: any): style is ISemanticTokenColorizationSetting {
	return style && (types.isString(style.foreground) || types.isString(style.fontStyle) || types.isBoolean(style.italic)
		|| types.isBoolean(style.underline) || types.isBoolean(style.bold));
}


class TokenColorIndex {

	private _lastColorId: number;
	private _id2color: string[];
	private _color2id: { [color: string]: number; };

	constructor() {
		this._lastColorId = 0;
		this._id2color = [];
		this._color2id = Object.create(null);
	}

	public add(color: string | Color | undefined): number {
		color = normalizeColor(color);
		if (color === undefined) {
			return 0;
		}

		let value = this._color2id[color];
		if (value) {
			return value;
		}
		value = ++this._lastColorId;
		this._color2id[color] = value;
		this._id2color[value] = color;
		return value;
	}

	public get(color: string | Color | undefined): number {
		color = normalizeColor(color);
		if (color === undefined) {
			return 0;
		}
		let value = this._color2id[color];
		if (value) {
			return value;
		}
		console.log(`Color ${color} not in index.`);
		return 0;
	}

	public asArray(): string[] {
		return this._id2color.slice(0);
	}

}

function normalizeColor(color: string | Color | undefined | null): string | undefined {
	if (!color) {
		return undefined;
	}
	if (typeof color !== 'string') {
		color = Color.Format.CSS.formatHexA(color, true);
	}
	const len = color.length;
	if (color.charCodeAt(0) !== CharCode.Hash || (len !== 4 && len !== 5 && len !== 7 && len !== 9)) {
		return undefined;
	}
	let result = [CharCode.Hash];

	for (let i = 1; i < len; i++) {
		const upper = hexUpper(color.charCodeAt(i));
		if (!upper) {
			return undefined;
		}
		result.push(upper);
		if (len === 4 || len === 5) {
			result.push(upper);
		}
	}

	if (result.length === 9 && result[7] === CharCode.F && result[8] === CharCode.F) {
		result.length = 7;
	}
	return String.fromCharCode(...result);
}

function hexUpper(charCode: CharCode): number {
	if (charCode >= CharCode.Digit0 && charCode <= CharCode.Digit9 || charCode >= CharCode.A && charCode <= CharCode.F) {
		return charCode;
	} else if (charCode >= CharCode.a && charCode <= CharCode.f) {
		return charCode - CharCode.a + CharCode.A;
	}
	return 0;
}
