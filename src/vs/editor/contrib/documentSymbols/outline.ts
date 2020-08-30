/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export const OutlineViewId = 'outline';

export const OutlineViewFiltered = new RawContextKey('outlineFiltered', false);
export const OutlineViewFocused = new RawContextKey('outlineFocused', false);

export const enum OutlineConfigKeys {
	'icons' = 'outline.icons',
	'problemsEnabled' = 'outline.problems.enabled',
	'problemsColors' = 'outline.problems.colors',
	'problemsBadges' = 'outline.problems.badges'
}
