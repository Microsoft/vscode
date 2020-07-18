/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { IContextMenuItem, ISerializableContextMenuItem, CONTEXT_MENU_CLOSE_CHANNEL, CONTEXT_MENU_CHANNEL, IPopupOptions, IContextMenuEvent } from 'vs/base/parts/contextmenu/common/contextmenu';

let contextMenuIdPool = 0;

export function popup(items: IContextMenuItem[], options?: IPopupOptions, onHide?: () => void): void {
	const processedItems: IContextMenuItem[] = [];

	const contextMenuId = contextMenuIdPool++;
	const onClickChannel = `vscode:onContextMenu${contextMenuId}`;
	const onClickChannelHandler = (event: unknown, itemId: number, context: IContextMenuEvent) => {
		const item = processedItems[itemId];
		if (item.click) {
			item.click(context);
		}
	};

	ipcRenderer.once(onClickChannel, onClickChannelHandler);
	ipcRenderer.once(CONTEXT_MENU_CLOSE_CHANNEL, (event: unknown, closedContextMenuId: number) => {
		if (closedContextMenuId !== contextMenuId) {
			return;
		}

		ipcRenderer.removeListener(onClickChannel, onClickChannelHandler);

		if (onHide) {
			onHide();
		}
	});

	ipcRenderer.send(CONTEXT_MENU_CHANNEL, contextMenuId, items.map(item => createItem(item, processedItems)), onClickChannel, options);
}

function createItem(item: IContextMenuItem, processedItems: IContextMenuItem[]): ISerializableContextMenuItem {
	const serializableItem: ISerializableContextMenuItem = {
		id: processedItems.length,
		label: item.label,
		type: item.type,
		accelerator: item.accelerator,
		checked: item.checked,
		enabled: typeof item.enabled === 'boolean' ? item.enabled : true,
		visible: typeof item.visible === 'boolean' ? item.visible : true
	};

	processedItems.push(item);

	// Submenu
	if (Array.isArray(item.submenu)) {
		serializableItem.submenu = item.submenu.map(submenuItem => createItem(submenuItem, processedItems));
	}

	return serializableItem;
}
