/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Paths = require('vs/base/common/paths');
import Json = require('vs/base/common/json');
import { Color } from 'vs/base/common/color';
import { ExtensionData, ITokenColorizationRule, IColorTheme, IColorMap } from 'vs/workbench/services/themes/common/themeService';
import { initializeColorMapsFromSettings, generateStyleSheetContent } from 'vs/workbench/services/themes/electron-browser/stylesContributions';
import { TPromise } from 'vs/base/common/winjs.base';
import { getBaseThemeId, getSyntaxThemeId, isDarkTheme, isLightTheme } from 'vs/platform/theme/common/themes';
import nls = require('vs/nls');

import * as plist from 'fast-plist';
import pfs = require('vs/base/node/pfs');

export class ColorThemeData implements IColorTheme {

	id: string;
	label: string;
	settingsId: string;
	description?: string;
	tokenColors?: ITokenColorizationRule[];
	isLoaded: boolean;
	path?: string;
	styleSheetContent?: string;
	extensionData: ExtensionData;
	colorMap?: IColorMap;

	public ensureLoaded(): TPromise<void> {
		if (!this.isLoaded) {
			let tokenColors = [];
			let colorMap = {};
			return _loadThemeDocument(this.getBaseThemeId(), this.path, tokenColors, colorMap).then(_ => {
				let theme = {
					selector: this.getBaseThemeId() + '.' + this.getSyntaxThemeId(),
					getColor: (colorId) => colorMap[colorId]
				};
				this.styleSheetContent = generateStyleSheetContent(theme);
				this.tokenColors = tokenColors;
				this.colorMap = colorMap;
				this.isLoaded = true;
			});
		}
		return TPromise.as(null);
	}

	isLightTheme() {
		return isLightTheme(this.id);
	}

	isDarkTheme() {
		return isDarkTheme(this.id);
	}

	getSyntaxThemeId() {
		return getSyntaxThemeId(this.id);
	}

	getBaseThemeId() {
		return getBaseThemeId(this.id);
	}
}

let defaultThemeColors: { [baseTheme: string]: ITokenColorizationRule[] } = {
	'vs': [
		{ scope: 'token.info-token', settings: { foreground: '#316bcd' } },
		{ scope: 'token.warn-token', settings: { foreground: '#cd9731' } },
		{ scope: 'token.error-token', settings: { foreground: '#cd3131' } },
		{ scope: 'token.debug-token', settings: { foreground: 'purple' } }
	],
	'vs-dark': [
		{ scope: 'token.info-token', settings: { foreground: '#6796e6' } },
		{ scope: 'token.warn-token', settings: { foreground: '#cd9731' } },
		{ scope: 'token.error-token', settings: { foreground: '#f44747' } },
		{ scope: 'token.debug-token', settings: { foreground: '#b267e6' } }
	],
	'hc-black': [
		{ scope: 'token.info-token', settings: { foreground: '#6796e6' } },
		{ scope: 'token.warn-token', settings: { foreground: '#008000' } },
		{ scope: 'token.error-token', settings: { foreground: '#FF0000' } },
		{ scope: 'token.debug-token', settings: { foreground: '#b267e6' } }
	],
};

function _loadThemeDocument(baseTheme: string, themePath: string, resultRules: ITokenColorizationRule[], resultColors: IColorMap): TPromise<any> {
	return pfs.readFile(themePath).then(content => {
		let defaultRules = defaultThemeColors[baseTheme] || [];
		resultRules.push(...defaultRules);
		if (Paths.extname(themePath) === '.json') {
			let errors: Json.ParseError[] = [];
			let contentValue = Json.parse(content.toString(), errors);
			if (errors.length > 0) {
				return TPromise.wrapError(new Error(nls.localize('error.cannotparsejson', "Problems parsing JSON theme file: {0}", errors.map(e => Json.getParseErrorMessage(e.error)).join(', '))));
			}
			if (Array.isArray(contentValue.settings)) {
				// legacy information
				resultRules.push(...contentValue.settings);
				initializeColorMapsFromSettings(contentValue.settings, resultColors);
			} else {
				if (!Array.isArray(contentValue.syntaxTokens) && typeof contentValue.colors !== 'object') {
					return TPromise.wrapError(new Error(nls.localize({ key: 'error.invalidformat', comment: ['{0} will be replaced by a path. Values in quotes should not be translated.'] }, "Problem parsing JSON theme file: {0}. Expecting 'syntaxTokens' and 'colors'.")));
				}
				if (contentValue.syntaxTokens) {
					resultRules.push(...contentValue.syntaxTokens);
				}
				if (contentValue.colors) {
					for (let colorId in contentValue.colors) {
						let colorHex = contentValue.colors[colorId];
						resultColors[colorId] = Color.fromHex(colorHex);
					}
				}
			}

			if (contentValue.include) {
				return _loadThemeDocument(baseTheme, Paths.join(Paths.dirname(themePath), contentValue.include), resultRules, resultColors);
			}
			return TPromise.as(null);
		}
		try {
			let contentValue = plist.parse(content.toString());
			let settings: ITokenColorizationRule[] = contentValue.settings;
			if (!Array.isArray(settings)) {
				return TPromise.wrapError(new Error(nls.localize('error.plist.invalidformat', "Problem parsing theme file: {0}. 'settings' is not array.")));
			}
			resultRules.push(...settings);
			initializeColorMapsFromSettings(settings, resultColors);
			return TPromise.as(null);
		} catch (e) {
			return TPromise.wrapError(new Error(nls.localize('error.cannotparse', "Problems parsing theme file: {0}", e.message)));
		}
	});
}
