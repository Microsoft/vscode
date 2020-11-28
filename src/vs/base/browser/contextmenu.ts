/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction, IActionRunner, IActionViewItem } from 'vs/base/common/actions';
import { ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { AnchorAlignment, AnchorAxisAlignment } from 'vs/base/browser/ui/contextview/contextview';

export interface IContextMenuEvent {
	readonly shiftKey?: boolean;
	readonly ctrlKey?: boolean;
	readonly altKey?: boolean;
	readonly metaKey?: boolean;
}

export interface IContextMenuDelegate {
	getAnchor(): HTMLElement | { x: number; y: number; width?: number; height?: number; };
	getActions(): IAction[];
	getCheckedActionsRepresentation?(action: IAction): 'radio' | 'checkbox';
	getActionViewItem?(action: IAction): IActionViewItem | undefined;
	getActionsContext?(event?: IContextMenuEvent): any;
	getKeyBinding?(action: IAction): ResolvedKeybinding | undefined;
	getMenuClassName?(): string;
	onHide?(didCancel: boolean): void;
	actionRunner?: IActionRunner;
	autoSelectFirstItem?: boolean;
	anchorAlignment?: AnchorAlignment;
	anchorAxisAlignment?: AnchorAxisAlignment;
	domForShadowRoot?: HTMLElement;
}

export interface IContextMenuProvider {
	showContextMenu(delegate: IContextMenuDelegate): void;
}
