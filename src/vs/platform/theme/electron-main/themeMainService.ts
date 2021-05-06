/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, nativeTheme } from 'electron';
import { isWindows, isMacintosh } from 'vs/base/common/platform';
import { IStateMainService } from 'vs/platform/state/electron-main/state';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IPartsSplash } from 'vs/platform/windows/common/windows';

const DEFAULT_BG_LIGHT = '#FFFFFF';
const DEFAULT_BG_DARK = '#1E1E1E';
const DEFAULT_BG_HC_BLACK = '#000000';

const THEME_STORAGE_KEY = 'theme';
const THEME_BG_STORAGE_KEY = 'themeBackground';
const THEME_WINDOW_SPLASH = 'windowSplash';

export const IThemeMainService = createDecorator<IThemeMainService>('themeMainService');

export interface IThemeMainService {

	readonly _serviceBrand: undefined;

	getBackgroundColor(): string;

	saveWindowSplash(windowId: number | undefined, splash: IPartsSplash): void;
	getWindowSplash(): IPartsSplash | undefined;
}

export class ThemeMainService implements IThemeMainService {

	declare readonly _serviceBrand: undefined;

	constructor(@IStateMainService private stateMainService: IStateMainService) { }

	getBackgroundColor(): string {
		if ((isWindows || isMacintosh) && nativeTheme.shouldUseInvertedColorScheme) {
			return DEFAULT_BG_HC_BLACK;
		}

		let background = this.stateMainService.getItem<string | null>(THEME_BG_STORAGE_KEY, null);
		if (!background) {
			let baseTheme: string;
			if ((isWindows || isMacintosh) && nativeTheme.shouldUseInvertedColorScheme) {
				baseTheme = 'hc-black';
			} else {
				baseTheme = this.stateMainService.getItem<string>(THEME_STORAGE_KEY, 'vs-dark').split(' ')[0];
			}

			background = (baseTheme === 'hc-black') ? DEFAULT_BG_HC_BLACK : (baseTheme === 'vs' ? DEFAULT_BG_LIGHT : DEFAULT_BG_DARK);
		}

		if (isMacintosh && background.toUpperCase() === DEFAULT_BG_DARK) {
			background = '#171717'; // https://github.com/electron/electron/issues/5150
		}

		return background;
	}

	saveWindowSplash(windowId: number | undefined, splash: IPartsSplash): void {

		// Update in storage
		this.stateMainService.setItems([
			{ key: THEME_STORAGE_KEY, data: splash.baseTheme },
			{ key: THEME_BG_STORAGE_KEY, data: splash.colorInfo.background },
			{ key: THEME_WINDOW_SPLASH, data: splash }
		]);

		// Update in opened windows
		if (typeof windowId === 'number') {
			this.updateBackgroundColor(windowId, splash);
		}
	}

	private updateBackgroundColor(windowId: number, splash: IPartsSplash): void {
		for (const window of BrowserWindow.getAllWindows()) {
			if (window.id === windowId) {
				window.setBackgroundColor(splash.colorInfo.background);
				break;
			}
		}
	}

	getWindowSplash(): IPartsSplash | undefined {
		return this.stateMainService.getItem<IPartsSplash>(THEME_WINDOW_SPLASH);
	}
}
