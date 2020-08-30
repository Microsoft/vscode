/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IColorTheme } from 'vs/platform/theme/common/themeService';
import { editorBackground, ColorDefaults, ColorValue } from 'vs/platform/theme/common/colorRegistry';

export function getExtraColor(theme: IColorTheme, colorId: string, defaults: ColorDefaults & { extra_dark: string }): ColorValue | null {
	const color = theme.getColor(colorId);
	if (color) {
		return color;
	}

	if (theme.type === 'dark') {
		const background = theme.getColor(editorBackground);
		if (background && background.getRelativeLuminance() < 0.004) {
			return defaults.extra_dark;
		}
	}

	return defaults[theme.type];
}
