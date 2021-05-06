/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { darken, inputBackground, editorWidgetBackground, lighten, registerColor, textLinkForeground, widgetShadow } from 'vs/platform/theme/common/colorRegistry';
import { localize } from 'vs/nls';

// Seprate from main module to break dependency cycles between welcomePage and gettingStarted.
export const welcomeButtonBackground = registerColor('welcomePage.buttonBackground', { dark: null, light: null, hc: null }, localize('welcomePage.buttonBackground', 'Background color for the buttons on the Welcome page.'));
export const welcomeButtonHoverBackground = registerColor('welcomePage.buttonHoverBackground', { dark: null, light: null, hc: null }, localize('welcomePage.buttonHoverBackground', 'Hover background color for the buttons on the Welcome page.'));
export const welcomePageBackground = registerColor('welcomePage.background', { light: null, dark: null, hc: null }, localize('welcomePage.background', 'Background color for the Welcome page.'));

export const welcomePageTileBackground = registerColor('welcomePage.tileBackground', { dark: editorWidgetBackground, light: editorWidgetBackground, hc: '#000' }, localize('welcomePage.tileBackground', 'Background color for the tiles on the Get Started page.'));
export const welcomePageTileHoverBackground = registerColor('welcomePage.tileHoverBackground', { dark: lighten(editorWidgetBackground, .2), light: darken(editorWidgetBackground, .1), hc: null }, localize('welcomePage.tileHoverBackground', 'Hover background color for the tiles on the Get Started.'));
export const welcomePageTileShadow = registerColor('welcomePage.tileShadow.', { light: widgetShadow, dark: widgetShadow, hc: null }, localize('welcomePage.tileShadow', 'Shadow color for the Welcome page walkthrough category buttons.'));

export const welcomePageProgressBackground = registerColor('welcomePage.progress.background', { light: inputBackground, dark: inputBackground, hc: inputBackground }, localize('welcomePage.progress.background', 'Foreground color for the Welcome page progress bars.'));
export const welcomePageProgressForeground = registerColor('welcomePage.progress.foreground', { light: textLinkForeground, dark: textLinkForeground, hc: textLinkForeground }, localize('welcomePage.progress.foreground', 'Background color for the Welcome page progress bars.'));
