/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { localize } from 'vs/nls';

// Seprate from main module to break dependency cycles between welcomePage and gettingStarted.
export const buttonBackground = registerColor('welcomePage.buttonBackground', { dark: null, light: null, hc: null }, localize('welcomePage.buttonBackground', 'Background color for the buttons on the Welcome page.'));
export const buttonHoverBackground = registerColor('welcomePage.buttonHoverBackground', { dark: null, light: null, hc: null }, localize('welcomePage.buttonHoverBackground', 'Hover background color for the buttons on the Welcome page.'));
export const welcomePageBackground = registerColor('welcomePage.background', { light: null, dark: null, hc: null }, localize('welcomePage.background', 'Background color for the Welcome page.'));
