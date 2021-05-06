/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Extensions as ThemeingExtensions, IColorRegistry, ColorIdentifier } from 'vs/platform/theme/common/colorRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { ansiColorIdentifiers, registerColors } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { IColorTheme } from 'vs/platform/theme/common/themeService';
import { Color } from 'vs/base/common/color';
import { ColorScheme } from 'vs/platform/theme/common/theme';

registerColors();

const themingRegistry = Registry.as<IColorRegistry>(ThemeingExtensions.ColorContribution);
function getMockTheme(type: ColorScheme): IColorTheme {
	const theme = {
		selector: '',
		label: '',
		type: type,
		getColor: (colorId: ColorIdentifier): Color | undefined => themingRegistry.resolveDefaultColor(colorId, theme),
		defines: () => true,
		getTokenStyleMetadata: () => undefined,
		tokenColorMap: [],
		semanticHighlighting: false
	};
	return theme;
}

suite('Workbench - TerminalColorRegistry', () => {

	test('hc colors', function () {
		const theme = getMockTheme(ColorScheme.HIGH_CONTRAST);
		const colors = ansiColorIdentifiers.map(colorId => Color.Format.CSS.formatHexA(theme.getColor(colorId)!, true));

		assert.deepStrictEqual(colors, [
			'#000000',
			'#cd0000',
			'#00cd00',
			'#cdcd00',
			'#0000ee',
			'#cd00cd',
			'#00cdcd',
			'#e5e5e5',
			'#7f7f7f',
			'#ff0000',
			'#00ff00',
			'#ffff00',
			'#5c5cff',
			'#ff00ff',
			'#00ffff',
			'#ffffff'
		], 'The high contrast terminal colors should be used when the hc theme is active');

	});

	test('light colors', function () {
		const theme = getMockTheme(ColorScheme.LIGHT);
		const colors = ansiColorIdentifiers.map(colorId => Color.Format.CSS.formatHexA(theme.getColor(colorId)!, true));

		assert.deepStrictEqual(colors, [
			'#000000',
			'#cd3131',
			'#00bc00',
			'#949800',
			'#0451a5',
			'#bc05bc',
			'#0598bc',
			'#555555',
			'#666666',
			'#cd3131',
			'#14ce14',
			'#b5ba00',
			'#0451a5',
			'#bc05bc',
			'#0598bc',
			'#a5a5a5'
		], 'The light terminal colors should be used when the light theme is active');

	});

	test('dark colors', function () {
		const theme = getMockTheme(ColorScheme.DARK);
		const colors = ansiColorIdentifiers.map(colorId => Color.Format.CSS.formatHexA(theme.getColor(colorId)!, true));

		assert.deepStrictEqual(colors, [
			'#000000',
			'#cd3131',
			'#0dbc79',
			'#e5e510',
			'#2472c8',
			'#bc3fbc',
			'#11a8cd',
			'#e5e5e5',
			'#666666',
			'#f14c4c',
			'#23d18b',
			'#f5f543',
			'#3b8eea',
			'#d670d6',
			'#29b8db',
			'#e5e5e5'
		], 'The dark terminal colors should be used when a dark theme is active');
	});
});
