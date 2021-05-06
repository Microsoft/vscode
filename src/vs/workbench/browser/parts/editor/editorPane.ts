/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Composite } from 'vs/workbench/browser/composite';
import { EditorInput, EditorOptions, IEditorPane, GroupIdentifier, IEditorMemento, IEditorOpenContext } from 'vs/workbench/common/editor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { LRUCache, Touch } from 'vs/base/common/map';
import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { isEmptyObject } from 'vs/base/common/types';
import { DEFAULT_EDITOR_MIN_DIMENSIONS, DEFAULT_EDITOR_MAX_DIMENSIONS } from 'vs/workbench/browser/parts/editor/editor';
import { MementoObject } from 'vs/workbench/common/memento';
import { joinPath, IExtUri, isEqual } from 'vs/base/common/resources';
import { indexOfPath } from 'vs/base/common/extpath';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

/**
 * The base class of editors in the workbench. Editors register themselves for specific editor inputs.
 * Editors are layed out in the editor part of the workbench in editor groups. Multiple editors can be
 * open at the same time. Each editor has a minimized representation that is good enough to provide some
 * information about the state of the editor data.
 *
 * The workbench will keep an editor alive after it has been created and show/hide it based on
 * user interaction. The lifecycle of a editor goes in the order:
 *
 * - `createEditor()`
 * - `setEditorVisible()`
 * - `layout()`
 * - `setInput()`
 * - `focus()`
 * - `dispose()`: when the editor group the editor is in closes
 *
 * During use of the workbench, a editor will often receive a `clearInput()`, `setEditorVisible()`, `layout()` and
 * `focus()` calls, but only one `create()` and `dispose()` call.
 *
 * This class is only intended to be subclassed and not instantiated.
 */
export abstract class EditorPane extends Composite implements IEditorPane {

	private static readonly EDITOR_MEMENTOS = new Map<string, EditorMemento<any>>();

	get minimumWidth() { return DEFAULT_EDITOR_MIN_DIMENSIONS.width; }
	get maximumWidth() { return DEFAULT_EDITOR_MAX_DIMENSIONS.width; }
	get minimumHeight() { return DEFAULT_EDITOR_MIN_DIMENSIONS.height; }
	get maximumHeight() { return DEFAULT_EDITOR_MAX_DIMENSIONS.height; }

	readonly onDidChangeSizeConstraints = Event.None;

	protected _input: EditorInput | undefined;
	get input(): EditorInput | undefined { return this._input; }

	protected _options: EditorOptions | undefined;
	get options(): EditorOptions | undefined { return this._options; }

	private _group: IEditorGroup | undefined;
	get group(): IEditorGroup | undefined { return this._group; }

	/**
	 * Should be overridden by editors that have their own ScopedContextKeyService
	 */
	get scopedContextKeyService(): IContextKeyService | undefined { return undefined; }

	constructor(
		id: string,
		telemetryService: ITelemetryService,
		themeService: IThemeService,
		storageService: IStorageService
	) {
		super(id, telemetryService, themeService, storageService);
	}

	override create(parent: HTMLElement): void {
		super.create(parent);

		// Create Editor
		this.createEditor(parent);
	}

	/**
	 * Called to create the editor in the parent HTMLElement. Subclasses implement
	 * this method to construct the editor widget.
	 */
	protected abstract createEditor(parent: HTMLElement): void;

	/**
	 * Note: Clients should not call this method, the workbench calls this
	 * method. Calling it otherwise may result in unexpected behavior.
	 *
	 * Sets the given input with the options to the editor. The input is guaranteed
	 * to be different from the previous input that was set using the `input.matches()`
	 * method.
	 *
	 * The provided context gives more information around how the editor was opened.
	 *
	 * The provided cancellation token should be used to test if the operation
	 * was cancelled.
	 */
	async setInput(input: EditorInput, options: EditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this._input = input;
		this._options = options;
	}

	/**
	 * Called to indicate to the editor that the input should be cleared and
	 * resources associated with the input should be freed.
	 *
	 * This method can be called based on different contexts, e.g. when opening
	 * a different editor control or when closing all editors in a group.
	 *
	 * To monitor the lifecycle of editor inputs, you should not rely on this
	 * method, rather refer to the listeners on `IEditorGroup` via `IEditorGroupService`.
	 */
	clearInput(): void {
		this._input = undefined;
		this._options = undefined;
	}

	/**
	 * Note: Clients should not call this method, the workbench calls this
	 * method. Calling it otherwise may result in unexpected behavior.
	 *
	 * Sets the given options to the editor. Clients should apply the options
	 * to the current input.
	 */
	setOptions(options: EditorOptions | undefined): void {
		this._options = options;
	}

	override setVisible(visible: boolean, group?: IEditorGroup): void {
		super.setVisible(visible);

		// Propagate to Editor
		this.setEditorVisible(visible, group);
	}

	/**
	 * Indicates that the editor control got visible or hidden in a specific group. A
	 * editor instance will only ever be visible in one editor group.
	 *
	 * @param visible the state of visibility of this editor
	 * @param group the editor group this editor is in.
	 */
	protected setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		this._group = group;
	}

	protected getEditorMemento<T>(editorGroupService: IEditorGroupsService, key: string, limit: number = 10): IEditorMemento<T> {
		const mementoKey = `${this.getId()}${key}`;

		let editorMemento = EditorPane.EDITOR_MEMENTOS.get(mementoKey);
		if (!editorMemento) {
			editorMemento = new EditorMemento(this.getId(), key, this.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE), limit, editorGroupService);
			EditorPane.EDITOR_MEMENTOS.set(mementoKey, editorMemento);
		}

		return editorMemento;
	}

	protected override saveState(): void {

		// Save all editor memento for this editor type
		for (const [, editorMemento] of EditorPane.EDITOR_MEMENTOS) {
			if (editorMemento.id === this.getId()) {
				editorMemento.saveState();
			}
		}

		super.saveState();
	}

	override dispose(): void {
		this._input = undefined;
		this._options = undefined;

		super.dispose();
	}
}

interface MapGroupToMemento<T> {
	[group: number]: T;
}

export class EditorMemento<T> implements IEditorMemento<T> {
	private cache: LRUCache<string, MapGroupToMemento<T>> | undefined;
	private cleanedUp = false;
	private editorDisposables: Map<EditorInput, IDisposable> | undefined;

	constructor(
		public readonly id: string,
		private key: string,
		private memento: MementoObject,
		private limit: number,
		private editorGroupService: IEditorGroupsService
	) { }

	saveEditorState(group: IEditorGroup, resource: URI, state: T): void;
	saveEditorState(group: IEditorGroup, editor: EditorInput, state: T): void;
	saveEditorState(group: IEditorGroup, resourceOrEditor: URI | EditorInput, state: T): void {
		const resource = this.doGetResource(resourceOrEditor);
		if (!resource || !group) {
			return; // we are not in a good state to save any state for a resource
		}

		const cache = this.doLoad();

		let mementoForResource = cache.get(resource.toString());
		if (!mementoForResource) {
			mementoForResource = Object.create(null) as MapGroupToMemento<T>;
			cache.set(resource.toString(), mementoForResource);
		}

		mementoForResource[group.id] = state;

		// Automatically clear when editor input gets disposed if any
		if (resourceOrEditor instanceof EditorInput) {
			this.clearEditorStateOnDispose(resource, resourceOrEditor);
		}
	}

	loadEditorState(group: IEditorGroup, resource: URI): T | undefined;
	loadEditorState(group: IEditorGroup, editor: EditorInput): T | undefined;
	loadEditorState(group: IEditorGroup, resourceOrEditor: URI | EditorInput): T | undefined {
		const resource = this.doGetResource(resourceOrEditor);
		if (!resource || !group) {
			return; // we are not in a good state to load any state for a resource
		}

		const cache = this.doLoad();

		const mementoForResource = cache.get(resource.toString());
		if (mementoForResource) {
			return mementoForResource[group.id];
		}

		return;
	}

	clearEditorState(resource: URI, group?: IEditorGroup): void;
	clearEditorState(editor: EditorInput, group?: IEditorGroup): void;
	clearEditorState(resourceOrEditor: URI | EditorInput, group?: IEditorGroup): void {
		if (resourceOrEditor instanceof EditorInput) {
			this.editorDisposables?.delete(resourceOrEditor);
		}

		const resource = this.doGetResource(resourceOrEditor);
		if (resource) {
			const cache = this.doLoad();

			if (group) {
				const resourceViewState = cache.get(resource.toString());
				if (resourceViewState) {
					delete resourceViewState[group.id];

					if (isEmptyObject(resourceViewState)) {
						cache.delete(resource.toString());
					}
				}
			} else {
				cache.delete(resource.toString());
			}
		}
	}

	clearEditorStateOnDispose(resource: URI, editor: EditorInput): void {
		if (!this.editorDisposables) {
			this.editorDisposables = new Map<EditorInput, IDisposable>();
		}

		if (!this.editorDisposables.has(editor)) {
			this.editorDisposables.set(editor, Event.once(editor.onWillDispose)(() => {
				this.clearEditorState(resource);
				this.editorDisposables?.delete(editor);
			}));
		}
	}

	moveEditorState(source: URI, target: URI, comparer: IExtUri): void {
		const cache = this.doLoad();

		// We need a copy of the keys to not iterate over
		// newly inserted elements.
		const cacheKeys = [...cache.keys()];
		for (const cacheKey of cacheKeys) {
			const resource = URI.parse(cacheKey);

			if (!comparer.isEqualOrParent(resource, source)) {
				continue; // not matching our resource
			}

			// Determine new resulting target resource
			let targetResource: URI;
			if (isEqual(source, resource)) {
				targetResource = target; // file got moved
			} else {
				const index = indexOfPath(resource.path, source.path);
				targetResource = joinPath(target, resource.path.substr(index + source.path.length + 1)); // parent folder got moved
			}

			// Don't modify LRU state.
			const value = cache.get(cacheKey, Touch.None);
			if (value) {
				cache.delete(cacheKey);
				cache.set(targetResource.toString(), value);
			}
		}
	}

	private doGetResource(resourceOrEditor: URI | EditorInput): URI | undefined {
		if (resourceOrEditor instanceof EditorInput) {
			return resourceOrEditor.resource;
		}

		return resourceOrEditor;
	}

	private doLoad(): LRUCache<string, MapGroupToMemento<T>> {
		if (!this.cache) {
			this.cache = new LRUCache<string, MapGroupToMemento<T>>(this.limit);

			// Restore from serialized map state
			const rawEditorMemento = this.memento[this.key];
			if (Array.isArray(rawEditorMemento)) {
				this.cache.fromJSON(rawEditorMemento);
			}
		}

		return this.cache;
	}

	saveState(): void {
		const cache = this.doLoad();

		// Cleanup once during session
		if (!this.cleanedUp) {
			this.cleanUp();
			this.cleanedUp = true;
		}

		this.memento[this.key] = cache.toJSON();
	}

	private cleanUp(): void {
		const cache = this.doLoad();

		// Remove groups from states that no longer exist. Since we modify the
		// cache and its is a LRU cache make a copy to ensure iteration succeeds
		const entries = [...cache.entries()];
		for (const [resource, mapGroupToMemento] of entries) {
			for (const group of Object.keys(mapGroupToMemento)) {
				const groupId: GroupIdentifier = Number(group);
				if (!this.editorGroupService.getGroup(groupId)) {
					delete mapGroupToMemento[groupId];
					if (isEmptyObject(mapGroupToMemento)) {
						cache.delete(resource);
					}
				}
			}
		}
	}
}
