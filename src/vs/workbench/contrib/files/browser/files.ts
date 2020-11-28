/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IListService } from 'vs/platform/list/browser/listService';
import { OpenEditor, SortOrder } from 'vs/workbench/contrib/files/common/files';
import { EditorResourceAccessor, SideBySideEditor, IEditorIdentifier } from 'vs/workbench/common/editor';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ExplorerItem } from 'vs/workbench/contrib/files/common/explorerModel';
import { coalesce } from 'vs/base/common/arrays';
import { AsyncDataTree } from 'vs/base/browser/ui/tree/asyncDataTree';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditableData } from 'vs/workbench/common/views';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ResourceFileEdit } from 'vs/editor/browser/services/bulkEditService';


export interface IExplorerService {
	readonly _serviceBrand: undefined;
	readonly roots: ExplorerItem[];
	readonly sortOrder: SortOrder;

	getContext(respectMultiSelection: boolean): ExplorerItem[];
	hasViewFocus(): boolean;
	setEditable(stat: ExplorerItem, data: IEditableData | null): Promise<void>;
	getEditable(): { stat: ExplorerItem, data: IEditableData } | undefined;
	getEditableData(stat: ExplorerItem): IEditableData | undefined;
	// If undefined is passed checks if any element is currently being edited.
	isEditable(stat: ExplorerItem | undefined): boolean;
	findClosest(resource: URI): ExplorerItem | null;
	refresh(): Promise<void>;
	setToCopy(stats: ExplorerItem[], cut: boolean): Promise<void>;
	isCut(stat: ExplorerItem): boolean;
	applyBulkEdit(edit: ResourceFileEdit[], options: { undoLabel: string, progressLabel: string }): Promise<void>;

	/**
	 * Selects and reveal the file element provided by the given resource if its found in the explorer.
	 * Will try to resolve the path in case the explorer is not yet expanded to the file yet.
	 */
	select(resource: URI, reveal?: boolean | string): Promise<void>;

	registerView(contextAndRefreshProvider: IExplorerView): void;
}

export const IExplorerService = createDecorator<IExplorerService>('explorerService');

export interface IExplorerView {
	getContext(respectMultiSelection: boolean): ExplorerItem[];
	refresh(recursive: boolean, item?: ExplorerItem): Promise<void>;
	selectResource(resource: URI | undefined, reveal?: boolean | string): Promise<void>;
	setTreeInput(): Promise<void>;
	itemsCopied(tats: ExplorerItem[], cut: boolean, previousCut: ExplorerItem[] | undefined): void;
	setEditable(stat: ExplorerItem, isEditing: boolean): Promise<void>;
	focusNeighbourIfItemFocused(item: ExplorerItem): void;
	isItemVisible(item: ExplorerItem): boolean;
	hasFocus(): boolean;
}

function getFocus(listService: IListService): unknown | undefined {
	let list = listService.lastFocusedList;
	if (list?.getHTMLElement() === document.activeElement) {
		let focus: unknown;
		if (list instanceof List) {
			const focused = list.getFocusedElements();
			if (focused.length) {
				focus = focused[0];
			}
		} else if (list instanceof AsyncDataTree) {
			const focused = list.getFocus();
			if (focused.length) {
				focus = focused[0];
			}
		}

		return focus;
	}

	return undefined;
}

// Commands can get executed from a command palette, from a context menu or from some list using a keybinding
// To cover all these cases we need to properly compute the resource on which the command is being executed
export function getResourceForCommand(resource: URI | object | undefined, listService: IListService, editorService: IEditorService): URI | undefined {
	if (URI.isUri(resource)) {
		return resource;
	}

	const focus = getFocus(listService);
	if (focus instanceof ExplorerItem) {
		return focus.resource;
	} else if (focus instanceof OpenEditor) {
		return focus.getResource();
	}

	return EditorResourceAccessor.getOriginalUri(editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
}

export function getMultiSelectedResources(resource: URI | object | undefined, listService: IListService, editorService: IEditorService, explorerService: IExplorerService): Array<URI> {
	const list = listService.lastFocusedList;
	if (list?.getHTMLElement() === document.activeElement) {
		// Explorer
		if (list instanceof AsyncDataTree && list.getFocus().every(item => item instanceof ExplorerItem)) {
			// Explorer
			const context = explorerService.getContext(true);
			if (context.length) {
				return context.map(c => c.resource);
			}
		}

		// Open editors view
		if (list instanceof List) {
			const selection = coalesce(list.getSelectedElements().filter(s => s instanceof OpenEditor).map((oe: OpenEditor) => oe.getResource()));
			const focusedElements = list.getFocusedElements();
			const focus = focusedElements.length ? focusedElements[0] : undefined;
			let mainUriStr: string | undefined = undefined;
			if (URI.isUri(resource)) {
				mainUriStr = resource.toString();
			} else if (focus instanceof OpenEditor) {
				const focusedResource = focus.getResource();
				mainUriStr = focusedResource ? focusedResource.toString() : undefined;
			}
			// We only respect the selection if it contains the main element.
			if (selection.some(s => s.toString() === mainUriStr)) {
				return selection;
			}
		}
	}

	const result = getResourceForCommand(resource, listService, editorService);
	return !!result ? [result] : [];
}

export function getOpenEditorsViewMultiSelection(listService: IListService, editorGroupService: IEditorGroupsService): Array<IEditorIdentifier> | undefined {
	const list = listService.lastFocusedList;
	if (list?.getHTMLElement() === document.activeElement) {
		// Open editors view
		if (list instanceof List) {
			const selection = coalesce(list.getSelectedElements().filter(s => s instanceof OpenEditor));
			const focusedElements = list.getFocusedElements();
			const focus = focusedElements.length ? focusedElements[0] : undefined;
			let mainEditor: IEditorIdentifier | undefined = undefined;
			if (focus instanceof OpenEditor) {
				mainEditor = focus;
			}
			// We only respect the selection if it contains the main element.
			if (selection.some(s => s === mainEditor)) {
				return selection;
			}
		}
	}

	return undefined;
}
