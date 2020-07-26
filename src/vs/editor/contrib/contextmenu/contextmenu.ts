/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IAnchor } from 'vs/base/browser/ui/contextview/contextview';
import { IAction, Separator, SubmenuAction } from 'vs/base/common/actions';
import { KeyCode, KeyMod, ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { ICodeEditor, IEditorMouseEvent, MouseTargetType } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { IEditorContribution, ScrollType } from 'vs/editor/common/editorCommon';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { IMenuService, MenuId, SubmenuItemAction } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ITextModel } from 'vs/editor/common/model';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';

export class ContextMenuController implements IEditorContribution {

	public static readonly ID = 'editor.contrib.contextmenu';

	public static get(editor: ICodeEditor): ContextMenuController {
		return editor.getContribution<ContextMenuController>(ContextMenuController.ID);
	}

	private readonly _toDispose = new DisposableStore();
	private _contextMenuIsBeingShownCount: number = 0;
	private readonly _editor: ICodeEditor;

	constructor(
		editor: ICodeEditor,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IMenuService private readonly _menuService: IMenuService
	) {
		this._editor = editor;

		this._toDispose.add(this._editor.onContextMenu((e: IEditorMouseEvent) => this._onContextMenu(e)));
		this._toDispose.add(this._editor.onMouseWheel((e: IMouseWheelEvent) => {
			if (this._contextMenuIsBeingShownCount > 0) {
				this._contextViewService.hideContextView();
			}
		}));
		this._toDispose.add(this._editor.onKeyDown((e: IKeyboardEvent) => {
			if (e.keyCode === KeyCode.ContextMenu) {
				// Chrome is funny like that
				e.preventDefault();
				e.stopPropagation();
				this.showContextMenu();
			}
		}));
	}

	private _onContextMenu(e: IEditorMouseEvent): void {
		if (!this._editor.hasModel()) {
			return;
		}

		if (!this._editor.getOption(EditorOption.contextmenu)) {
			this._editor.focus();
			// Ensure the cursor is at the position of the mouse click
			if (e.target.position && !this._editor.getSelection().containsPosition(e.target.position)) {
				this._editor.setPosition(e.target.position);
			}
			return; // Context menu is turned off through configuration
		}

		if (e.target.type === MouseTargetType.OVERLAY_WIDGET) {
			return; // allow native menu on widgets to support right click on input field for example in find
		}

		e.event.preventDefault();

		if (e.target.type !== MouseTargetType.CONTENT_TEXT && e.target.type !== MouseTargetType.CONTENT_EMPTY && e.target.type !== MouseTargetType.TEXTAREA) {
			return; // only support mouse click into text or native context menu key for now
		}

		// Ensure the editor gets focus if it hasn't, so the right events are being sent to other contributions
		this._editor.focus();

		// Ensure the cursor is at the position of the mouse click
		if (e.target.position) {
			let hasSelectionAtPosition = false;
			for (const selection of this._editor.getSelections()) {
				if (selection.containsPosition(e.target.position)) {
					hasSelectionAtPosition = true;
					break;
				}
			}

			if (!hasSelectionAtPosition) {
				this._editor.setPosition(e.target.position);
			}
		}

		// Unless the user triggerd the context menu through Shift+F10, use the mouse position as menu position
		let anchor: IAnchor | null = null;
		if (e.target.type !== MouseTargetType.TEXTAREA) {
			anchor = { x: e.event.posx - 1, width: 2, y: e.event.posy - 1, height: 2 };
		}

		// Show the context menu
		this.showContextMenu(anchor);
	}

	public showContextMenu(anchor?: IAnchor | null): void {
		if (!this._editor.getOption(EditorOption.contextmenu)) {
			return; // Context menu is turned off through configuration
		}
		if (!this._editor.hasModel()) {
			return;
		}

		if (!this._contextMenuService) {
			this._editor.focus();
			return;	// We need the context menu service to function
		}

		// Find actions available for menu
		const menuActions = this._getMenuActions(this._editor.getModel(), MenuId.EditorContext);

		// Show menu if we have actions to show
		if (menuActions.length > 0) {
			this._doShowContextMenu(menuActions, anchor);
		}
	}

	private _getMenuActions(model: ITextModel, menuId: MenuId): IAction[] {
		const result: IAction[] = [];

		// get menu groups
		const menu = this._menuService.createMenu(menuId, this._contextKeyService);
		const groups = menu.getActions({ arg: model.uri });
		menu.dispose();

		// translate them into other actions
		for (let group of groups) {
			const [, actions] = group;
			let addedItems = 0;
			for (const action of actions) {
				if (action instanceof SubmenuItemAction) {
					const subActions = this._getMenuActions(model, action.item.submenu);
					if (subActions.length > 0) {
						result.push(new SubmenuAction(action.id, action.label, subActions));
						addedItems++;
					}
				} else {
					result.push(action);
					addedItems++;
				}
			}

			if (addedItems) {
				result.push(new Separator());
			}
		}

		if (result.length) {
			result.pop(); // remove last separator
		}

		return result;
	}

	private _doShowContextMenu(actions: IAction[], anchor: IAnchor | null = null): void {
		if (!this._editor.hasModel()) {
			return;
		}

		// Disable hover
		const oldHoverSetting = this._editor.getOption(EditorOption.hover);
		this._editor.updateOptions({
			hover: {
				enabled: false
			}
		});

		if (!anchor) {
			// Ensure selection is visible
			this._editor.revealPosition(this._editor.getPosition(), ScrollType.Immediate);

			this._editor.render();
			const cursorCoords = this._editor.getScrolledVisiblePosition(this._editor.getPosition());

			// Translate to absolute editor position
			const editorCoords = dom.getDomNodePagePosition(this._editor.getDomNode());
			const posx = editorCoords.left + cursorCoords.left;
			const posy = editorCoords.top + cursorCoords.top + cursorCoords.height;

			anchor = { x: posx, y: posy };
		}

		// Show menu
		this._contextMenuIsBeingShownCount++;
		this._contextMenuService.showContextMenu({
			domForShadowRoot: this._editor.getDomNode(),

			getAnchor: () => anchor!,

			getActions: () => actions,

			getActionViewItem: (action) => {
				const keybinding = this._keybindingFor(action);
				if (keybinding) {
					return new ActionViewItem(action, action, { label: true, keybinding: keybinding.getLabel(), isMenu: true });
				}

				const customActionViewItem = <any>action;
				if (typeof customActionViewItem.getActionViewItem === 'function') {
					return customActionViewItem.getActionViewItem();
				}

				return new ActionViewItem(action, action, { icon: true, label: true, isMenu: true });
			},

			getKeyBinding: (action): ResolvedKeybinding | undefined => {
				return this._keybindingFor(action);
			},

			onHide: (wasCancelled: boolean) => {
				this._contextMenuIsBeingShownCount--;
				this._editor.focus();
				this._editor.updateOptions({
					hover: oldHoverSetting
				});
			}
		});
	}

	private _keybindingFor(action: IAction): ResolvedKeybinding | undefined {
		return this._keybindingService.lookupKeybinding(action.id);
	}

	public dispose(): void {
		if (this._contextMenuIsBeingShownCount > 0) {
			this._contextViewService.hideContextView();
		}

		this._toDispose.dispose();
	}
}

class ShowContextMenu extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.showContextMenu',
			label: nls.localize('action.showContextMenu.label', "Show Editor Context Menu"),
			alias: 'Show Editor Context Menu',
			precondition: undefined,
			kbOpts: {
				kbExpr: EditorContextKeys.textInputFocus,
				primary: KeyMod.Shift | KeyCode.F10,
				weight: KeybindingWeight.EditorContrib
			}
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		let contribution = ContextMenuController.get(editor);
		contribution.showContextMenu();
	}
}

registerEditorContribution(ContextMenuController.ID, ContextMenuController);
registerEditorAction(ShowContextMenu);
