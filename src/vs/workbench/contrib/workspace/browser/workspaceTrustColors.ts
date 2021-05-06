/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { editorErrorForeground, registerColor } from 'vs/platform/theme/common/colorRegistry';
import { debugIconStartForeground } from 'vs/workbench/contrib/debug/browser/debugColors';
import { welcomePageTileBackground } from 'vs/workbench/contrib/welcome/page/browser/welcomePageColors';

export const trustedForegroundColor = registerColor('workspaceTrust.trustedForegound', { dark: debugIconStartForeground, light: debugIconStartForeground, hc: debugIconStartForeground }, localize('workspaceTrustTrustedColor', 'Color used when indicating a workspace is trusted.'));
export const untrustedForegroundColor = registerColor('workspaceTrust.untrustedForeground', { dark: editorErrorForeground, light: editorErrorForeground, hc: editorErrorForeground }, localize('workspaceTrustUntrustedColor', 'Color used when indicating a workspace is not trusted.'));

export const trustEditorTileBackgroundColor = registerColor('workspaceTrust.tileBackground', { dark: welcomePageTileBackground, light: welcomePageTileBackground, hc: welcomePageTileBackground }, localize('workspaceTrust.tileBackground', 'Background color for the tiles on the Workspace Trust page.'));
