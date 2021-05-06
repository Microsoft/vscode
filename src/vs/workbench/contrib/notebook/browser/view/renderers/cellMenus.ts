/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMenu, IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

// TODO@roblourens Is this class overkill now?
export class CellMenus {
	constructor(
		@IMenuService private readonly menuService: IMenuService,
	) { }

	getNotebookToolbar(contextKeyService: IContextKeyService): IMenu {
		return this.getMenu(MenuId.NotebookToolbar, contextKeyService);
	}

	getCellTitleMenu(contextKeyService: IContextKeyService): IMenu {
		return this.getMenu(MenuId.NotebookCellTitle, contextKeyService);
	}

	getCellInsertionMenu(contextKeyService: IContextKeyService): IMenu {
		return this.getMenu(MenuId.NotebookCellBetween, contextKeyService);
	}

	getCellTopInsertionMenu(contextKeyService: IContextKeyService): IMenu {
		return this.getMenu(MenuId.NotebookCellListTop, contextKeyService);
	}

	getCellExecuteMenu(contextKeyService: IContextKeyService): IMenu {
		return this.getMenu(MenuId.NotebookCellExecute, contextKeyService);
	}

	private getMenu(menuId: MenuId, contextKeyService: IContextKeyService): IMenu {
		const menu = this.menuService.createMenu(menuId, contextKeyService);
		return menu;
	}
}
