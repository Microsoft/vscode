/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IMenubarMenu, IMenubarMenuItemSeparator, IMenubarMenuItemSubmenu, IMenubarMenuRecentItemAction, isMenubarMenuItemRecentAction, isMenubarMenuItemSubmenu, MenubarMenuItem } from 'vs/platform/menubar/common/menubar';

const menuItemSeparator: IMenubarMenuItemSeparator = {
	id: 'vscode.menubar.separator'
};

const menuItemTypesOrdering: Record<string, number> = {
	'openRecentWorkspace': 0,
	'openRecentFolder': 1,
	'openRecentFile': 2,
};

export const buildMacDockRecentSubmenu = (menubarMenu?: IMenubarMenu | null): IMenubarMenuItemSubmenu => ({
	id: 'Mac.Dock.RecentMenu',
	label: localize({ key: 'miOpenRecent', comment: ['&& denotes a mnemonic'] }, "Open &&Recent"),
	submenu: {
		items: buildMacDockRecentMenuSubmenuItems(menubarMenu)
	}
});

const buildMacDockRecentMenuSubmenuItems = (menubarMenu?: IMenubarMenu | null): Array<IMenubarMenuRecentItemAction | IMenubarMenuItemSeparator> => {
	const recentMenuItems = findRecentMenuItems(menubarMenu);
	const groupedRecentMenuItems = groupRecentMenuItemsByType(recentMenuItems);

	return Object.keys(groupedRecentMenuItems)
		.sort(byItemTypeOrder)
		.reduce((out: Array<IMenubarMenuRecentItemAction | IMenubarMenuItemSeparator>, key: string) => {
			const group = groupedRecentMenuItems[key];
			return out.length === 0 ? [...group] : [...out, menuItemSeparator, ...group];
		}, []);
};

const findRecentMenuItems = (menubarMenu?: IMenubarMenu | null): Array<IMenubarMenuRecentItemAction> =>
	menubarMenu?.items.reduce((out: Array<IMenubarMenuRecentItemAction>, item: MenubarMenuItem) => {
		if (isMenubarMenuItemSubmenu(item)) {
			return [...out, ...findRecentMenuItems(item.submenu)];
		}
		if (isMenubarMenuItemRecentAction(item)) {
			return [...out, item];
		}

		return out;
	}, []) ?? [];


const groupRecentMenuItemsByType = (recentMenuItems: Array<IMenubarMenuRecentItemAction>): Record<string, Array<IMenubarMenuRecentItemAction>> =>
	recentMenuItems.reduce((record: Record<string, Array<IMenubarMenuRecentItemAction>>, item: IMenubarMenuRecentItemAction) => {
		const { id } = item;

		if (record[id]) {
			record[id] = [...record[id], item];
		} else {
			record[id] = [item];
		}

		return record;
	}, {});

const byItemTypeOrder = (l: string, r: string): number => {
	const lOrder = menuItemTypesOrdering[l] ?? -1;
	const rOrder = menuItemTypesOrdering[r] ?? -1;

	if (lOrder === rOrder) {
		return 0;
	}

	if (lOrder === -1) { return -1; }
	if (rOrder === -1) { return 1; }

	return lOrder > rOrder ? 1 : -1;
};
