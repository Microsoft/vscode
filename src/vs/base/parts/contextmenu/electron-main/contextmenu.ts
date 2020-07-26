/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Menu, MenuItem, BrowserWindow, ipcMain, IpcMainEvent } from 'electron';
import { ISerializableContextMenuItem, CONTEXT_MENU_CLOSE_CHANNEL, CONTEXT_MENU_CHANNEL, IPopupOptions } from 'vs/base/parts/contextmenu/common/contextmenu';
import { withNullAsUndefined } from 'vs/base/common/types';

export function registerContextMenuListener(): void {
	ipcMain.on(CONTEXT_MENU_CHANNEL, (event: IpcMainEvent, contextMenuId: number, items: ISerializableContextMenuItem[], onClickChannel: string, options?: IPopupOptions) => {
		const menu = createMenu(event, onClickChannel, items);

		menu.popup({
			window: withNullAsUndefined(BrowserWindow.fromWebContents(event.sender)),
			x: options ? options.x : undefined,
			y: options ? options.y : undefined,
			positioningItem: options ? options.positioningItem : undefined,
			callback: () => {
				// Workaround for https://github.com/Microsoft/vscode/issues/72447
				// It turns out that the menu gets GC'ed if not referenced anymore
				// As such we drag it into this scope so that it is not being GC'ed
				if (menu) {
					event.sender.send(CONTEXT_MENU_CLOSE_CHANNEL, contextMenuId);
				}
			}
		});
	});
}

function createMenu(event: IpcMainEvent, onClickChannel: string, items: ISerializableContextMenuItem[]): Menu {
	const menu = new Menu();

	items.forEach(item => {
		let menuitem: MenuItem;

		// Separator
		if (item.type === 'separator') {
			menuitem = new MenuItem({
				type: item.type,
			});
		}

		// Sub Menu
		else if (Array.isArray(item.submenu)) {
			menuitem = new MenuItem({
				submenu: createMenu(event, onClickChannel, item.submenu),
				label: item.label
			});
		}

		// Normal Menu Item
		else {
			menuitem = new MenuItem({
				label: item.label,
				type: item.type,
				accelerator: item.accelerator,
				checked: item.checked,
				enabled: item.enabled,
				visible: item.visible,
				click: (menuItem, win, contextmenuEvent) => event.sender.send(onClickChannel, item.id, contextmenuEvent)
			});
		}

		menu.append(menuitem);
	});

	return menu;
}
