/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IPaneComposite } from 'vs/workbench/common/panecomposite';

export const SideBarVisibleContext = new RawContextKey<boolean>('sideBarVisible', false, localize('sideBarVisible', "Whether the sidebar is visible"));
export const ThirdPanelVisibleContext = new RawContextKey<boolean>('thirdPanelVisible', false, localize('thirdPanelVisible', "Whether the third panel is visible"));
export const SidebarFocusContext = new RawContextKey<boolean>('sideBarFocus', false, localize('sideBarFocus', "Whether the sidebar has keyboard focus"));
export const ActiveViewletContext = new RawContextKey<string>('activeViewlet', '', localize('activeViewlet', "The identifier of the active viewlet"));

export interface IViewlet extends IPaneComposite {

	/**
	 * Returns the minimal width needed to avoid any content horizontal truncation
	 */
	getOptimalWidth(): number | undefined;
}
