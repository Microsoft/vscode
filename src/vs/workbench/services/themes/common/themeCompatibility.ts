/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextMateThemingRule, IColorMap } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { Color } from 'vs/base/common/color';
import * as colorRegistry from 'vs/platform/theme/common/colorRegistry';

import * as editorColorRegistry from 'vs/editor/common/view/editorColorRegistry';

const settingToColorIdMapping: { [settingId: string]: string[] } = {};
function addSettingMapping(settingId: string, colorId: string) {
	let colorIds = settingToColorIdMapping[settingId];
	if (!colorIds) {
		settingToColorIdMapping[settingId] = colorIds = [];
	}
	colorIds.push(colorId);
}

export function convertSettings(oldSettings: ITextMateThemingRule[], result: { textMateRules: ITextMateThemingRule[], colors: IColorMap }): void {
	for (let rule of oldSettings) {
		result.textMateRules.push(rule);
		if (!rule.scope) {
			let settings = rule.settings;
			if (!settings) {
				rule.settings = {};
			} else {
				for (const settingKey in settings) {
					const key = <keyof typeof settings>settingKey;
					let mappings = settingToColorIdMapping[key];
					if (mappings) {
						let colorHex = settings[key];
						if (typeof colorHex === 'string') {
							let color = Color.fromHex(colorHex);
							for (let colorId of mappings) {
								result.colors[colorId] = color;
							}
						}
					}
					if (key !== 'foreground' && key !== 'background' && key !== 'fontStyle') {
						delete settings[key];
					}
				}
			}
		}
	}
}

addSettingMapping('background', colorRegistry.editorBackground);
addSettingMapping('foreground', colorRegistry.editorForeground);
addSettingMapping('selection', colorRegistry.editorSelectionBackground);
addSettingMapping('inactiveSelection', colorRegistry.editorInactiveSelection);
addSettingMapping('selectionHighlightColor', colorRegistry.editorSelectionHighlight);
addSettingMapping('findMatchHighlight', colorRegistry.editorFindMatchHighlight);
addSettingMapping('currentFindMatchHighlight', colorRegistry.editorFindMatch);
addSettingMapping('hoverHighlight', colorRegistry.editorHoverHighlight);
addSettingMapping('wordHighlight', 'editor.wordHighlightBackground'); // inlined to avoid editor/contrib dependenies
addSettingMapping('wordHighlightStrong', 'editor.wordHighlightStrongBackground');
addSettingMapping('findRangeHighlight', colorRegistry.editorFindRangeHighlight);
addSettingMapping('findMatchHighlight', 'peekViewResult.matchHighlightBackground');
addSettingMapping('referenceHighlight', 'peekViewEditor.matchHighlightBackground');
addSettingMapping('lineHighlight', editorColorRegistry.editorLineHighlight);
addSettingMapping('rangeHighlight', editorColorRegistry.editorRangeHighlight);
addSettingMapping('caret', editorColorRegistry.editorCursorForeground);
addSettingMapping('invisibles', editorColorRegistry.editorWhitespaces);
addSettingMapping('guide', editorColorRegistry.editorIndentGuides);
addSettingMapping('activeGuide', editorColorRegistry.editorActiveIndentGuides);

const ansiColorMap = ['ansiBlack', 'ansiRed', 'ansiGreen', 'ansiYellow', 'ansiBlue', 'ansiMagenta', 'ansiCyan', 'ansiWhite',
	'ansiBrightBlack', 'ansiBrightRed', 'ansiBrightGreen', 'ansiBrightYellow', 'ansiBrightBlue', 'ansiBrightMagenta', 'ansiBrightCyan', 'ansiBrightWhite'
];

for (const color of ansiColorMap) {
	addSettingMapping(color, 'terminal.' + color);
}
