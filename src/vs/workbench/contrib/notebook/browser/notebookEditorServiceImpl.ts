/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceMap } from 'vs/base/common/map';
import { NotebookEditorWidget } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { IEditorGroupsService, IEditorGroup, GroupChangeKind } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/common/notebookEditorInput';
import { IBorrowValue, INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/notebookEditorService';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { Emitter } from 'vs/base/common/event';
import { INotebookDecorationRenderOptions } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { GroupIdentifier } from 'vs/workbench/common/editor';

export class NotebookEditorWidgetService implements INotebookEditorService {

	readonly _serviceBrand: undefined;

	private _tokenPool = 1;

	private readonly _disposables = new DisposableStore();
	private readonly _notebookEditors = new Map<string, INotebookEditor>();
	private readonly _decorationOptionProviders = new Map<string, INotebookDecorationRenderOptions>();

	private readonly _onNotebookEditorAdd = new Emitter<INotebookEditor>();
	private readonly _onNotebookEditorsRemove = new Emitter<INotebookEditor>();
	readonly onDidAddNotebookEditor = this._onNotebookEditorAdd.event;
	readonly onDidRemoveNotebookEditor = this._onNotebookEditorsRemove.event;

	private readonly _borrowableEditors = new Map<number, ResourceMap<{ widget: NotebookEditorWidget, token: number | undefined }>>();

	constructor(
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
	) {

		const groupListener = new Map<number, IDisposable[]>();
		const onNewGroup = (group: IEditorGroup) => {
			const { id } = group;
			const listeners: IDisposable[] = [];
			listeners.push(group.onDidGroupChange(e => {
				const widgets = this._borrowableEditors.get(group.id);
				if (!widgets || e.kind !== GroupChangeKind.EDITOR_CLOSE || !(e.editor instanceof NotebookEditorInput)) {
					return;
				}
				const value = widgets.get(e.editor.resource);
				if (!value) {
					return;
				}
				value.token = undefined;
				this._disposeWidget(value.widget);
				widgets.delete(e.editor.resource);
				value.widget = (<any>undefined); // unset the widget so that others that still hold a reference don't harm us
			}));
			listeners.push(group.onWillMoveEditor(e => {
				if (e.editor instanceof NotebookEditorInput) {
					this._freeWidget(e.editor, e.groupId, e.target);
				}
			}));
			groupListener.set(id, listeners);
		};
		this._disposables.add(editorGroupService.onDidAddGroup(onNewGroup));
		editorGroupService.whenReady.then(() => editorGroupService.groups.forEach(onNewGroup));

		// group removed -> clean up listeners, clean up widgets
		this._disposables.add(editorGroupService.onDidRemoveGroup(group => {
			const listeners = groupListener.get(group.id);
			if (listeners) {
				listeners.forEach(listener => listener.dispose());
				groupListener.delete(group.id);
			}
			const widgets = this._borrowableEditors.get(group.id);
			this._borrowableEditors.delete(group.id);
			if (widgets) {
				for (const value of widgets.values()) {
					value.token = undefined;
					this._disposeWidget(value.widget);
				}
			}
		}));
	}

	dispose() {
		this._disposables.dispose();
		this._onNotebookEditorAdd.dispose();
		this._onNotebookEditorsRemove.dispose();
	}

	// --- group-based editor borrowing...

	private _disposeWidget(widget: NotebookEditorWidget): void {
		widget.onWillHide();
		const domNode = widget.getDomNode();
		widget.dispose();
		domNode.remove();
	}

	private _freeWidget(input: NotebookEditorInput, sourceID: GroupIdentifier, targetID: GroupIdentifier): void {
		const targetWidget = this._borrowableEditors.get(targetID)?.get(input.resource);
		if (targetWidget) {
			// not needed
			return;
		}

		const widget = this._borrowableEditors.get(sourceID)?.get(input.resource);
		if (!widget) {
			throw new Error('no widget at source group');
		}
		this._borrowableEditors.get(sourceID)?.delete(input.resource);
		widget.token = undefined;

		let targetMap = this._borrowableEditors.get(targetID);
		if (!targetMap) {
			targetMap = new ResourceMap();
			this._borrowableEditors.set(targetID, targetMap);
		}
		targetMap.set(input.resource, widget);
	}

	retrieveWidget(accessor: ServicesAccessor, group: IEditorGroup, input: NotebookEditorInput): IBorrowValue<NotebookEditorWidget> {

		let value = this._borrowableEditors.get(group.id)?.get(input.resource);

		if (!value) {
			// NEW widget
			const instantiationService = accessor.get(IInstantiationService);
			const widget = instantiationService.createInstance(NotebookEditorWidget, { isEmbedded: false });
			const token = this._tokenPool++;
			value = { widget, token };

			let map = this._borrowableEditors.get(group.id);
			if (!map) {
				map = new ResourceMap();
				this._borrowableEditors.set(group.id, map);
			}
			map.set(input.resource, value);

		} else {
			// reuse a widget which was either free'ed before or which
			// is simply being reused...
			value.token = this._tokenPool++;
		}

		return this._createBorrowValue(value.token!, value);
	}

	private _createBorrowValue(myToken: number, widget: { widget: NotebookEditorWidget, token: number | undefined }): IBorrowValue<NotebookEditorWidget> {
		return {
			get value() {
				return widget.token === myToken ? widget.widget : undefined;
			}
		};
	}

	// --- editor management

	addNotebookEditor(editor: INotebookEditor): void {
		this._notebookEditors.set(editor.getId(), editor);
		this._onNotebookEditorAdd.fire(editor);
	}

	removeNotebookEditor(editor: INotebookEditor): void {
		if (this._notebookEditors.has(editor.getId())) {
			this._notebookEditors.delete(editor.getId());
			this._onNotebookEditorsRemove.fire(editor);
		}
	}

	getNotebookEditor(editorId: string): INotebookEditor | undefined {
		return this._notebookEditors.get(editorId);
	}

	listNotebookEditors(): readonly INotebookEditor[] {
		return [...this._notebookEditors].map(e => e[1]);
	}

	// --- editor decorations

	registerEditorDecorationType(key: string, options: INotebookDecorationRenderOptions): void {
		if (!this._decorationOptionProviders.has(key)) {
			this._decorationOptionProviders.set(key, options);
		}
	}

	removeEditorDecorationType(key: string): void {
		this._decorationOptionProviders.delete(key);
		this.listNotebookEditors().forEach(editor => editor.removeEditorDecorations(key));
	}

	resolveEditorDecorationOptions(key: string): INotebookDecorationRenderOptions | undefined {
		return this._decorationOptionProviders.get(key);
	}
}
