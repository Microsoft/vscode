/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Composite } from 'vs/workbench/browser/composite';
import { EditorInput, EditorOptions, IEditorPane, GroupIdentifier, IEditorMemento } from 'vs/workbench/common/editor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { LRUCache } from 'vs/base/common/map';
import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { isEmptyObject } from 'vs/base/common/types';
import { DEFAULT_EDITOR_MIN_DIMENSIONS, DEFAULT_EDITOR_MAX_DIMENSIONS } from 'vs/workbench/browser/parts/editor/editor';
import { MementoObject } from 'vs/workbench/common/memento';
import { isEqualOrParent, joinPath } from 'vs/base/common/resources';
import { isLinux } from 'vs/base/common/platform';
import { indexOfPath } from 'vs/base/common/extpath';
import { IDisposable } from 'vs/base/common/lifecycle';

/**
 * The base class of editors in the workbench. Editors register themselves for specific editor inputs.
 * Editors are layed out in the editor part of the workbench in editor groups. Multiple editors can be
 * open at the same time. Each editor has a minimized representation that is good enough to provide some
 * information about the state of the editor data.
 *
 * The workbench will keep an editor alive after it has been created and show/hide it based on
 * user interaction. The lifecycle of a editor goes in the order create(), setVisible(true|false),
 * layout(), setInput(), focus(), dispose(). During use of the workbench, a editor will often receive a
 * clearInput, setVisible, layout and focus call, but only one create and dispose call.
 *
 * This class is only intended to be subclassed and not instantiated.
 */
export abstract class BaseEditor extends Composite implements IEditorPane {

	private static readonly EDITOR_MEMENTOS = new Map<string, EditorMemento<any>>();

	readonly minimumWidth = DEFAULT_EDITOR_MIN_DIMENSIONS.width;
	readonly maximumWidth = DEFAULT_EDITOR_MAX_DIMENSIONS.width;
	readonly minimumHeight = DEFAULT_EDITOR_MIN_DIMENSIONS.height;
	readonly maximumHeight = DEFAULT_EDITOR_MAX_DIMENSIONS.height;

	readonly onDidSizeConstraintsChange = Event.None;

	protected _input: EditorInput | undefined;
	get input(): EditorInput | undefined { return this._input; }

	protected _options: EditorOptions | undefined;
	get options(): EditorOptions | undefined { return this._options; }

	private _group?: IEditorGroup;
	get group(): IEditorGroup | undefined { return this._group; }

	constructor(
		id: string,
		telemetryService: ITelemetryService,
		themeService: IThemeService,
		storageService: IStorageService
	) {
		super(id, telemetryService, themeService, storageService);
	}

	/**
	 * Note: Clients should not call this method, the workbench calls this
	 * method. Calling it otherwise may result in unexpected behavior.
	 *
	 * Sets the given input with the options to the editor. The input is guaranteed
	 * to be different from the previous input that was set using the input.matches()
	 * method.
	 *
	 * The provided cancellation token should be used to test if the operation
	 * was cancelled.
	 */
	async setInput(input: EditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {
		this._input = input;
		this._options = options;
	}

	/**
	 * Called to indicate to the editor that the input should be cleared and
	 * resources associated with the input should be freed.
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

	create(parent: HTMLElement): void {
		super.create(parent);

		// Create Editor
		this.createEditor(parent);
	}

	onHide() { }

	onWillHide() { }

	/**
	 * Called to create the editor in the parent HTMLElement.
	 */
	protected abstract createEditor(parent: HTMLElement): void;

	setVisible(visible: boolean, group?: IEditorGroup): void {
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

		let editorMemento = BaseEditor.EDITOR_MEMENTOS.get(mementoKey);
		if (!editorMemento) {
			editorMemento = new EditorMemento(this.getId(), key, this.getMemento(StorageScope.WORKSPACE), limit, editorGroupService);
			BaseEditor.EDITOR_MEMENTOS.set(mementoKey, editorMemento);
		}

		return editorMemento;
	}

	protected saveState(): void {

		// Save all editor memento for this editor type
		BaseEditor.EDITOR_MEMENTOS.forEach(editorMemento => {
			if (editorMemento.id === this.getId()) {
				editorMemento.saveState();
			}
		});

		super.saveState();
	}

	dispose(): void {
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
			const editor = resourceOrEditor;

			if (!this.editorDisposables) {
				this.editorDisposables = new Map<EditorInput, IDisposable>();
			}

			if (!this.editorDisposables.has(editor)) {
				this.editorDisposables.set(editor, Event.once(resourceOrEditor.onDispose)(() => {
					this.clearEditorState(resource);
					this.editorDisposables?.delete(editor);
				}));
			}
		}
	}

	loadEditorState(group: IEditorGroup, resource: URI): T | undefined;
	loadEditorState(group: IEditorGroup, editor: EditorInput): T | undefined;
	loadEditorState(group: IEditorGroup, resourceOrEditor: URI | EditorInput): T | undefined {
		const resource = this.doGetResource(resourceOrEditor);
		if (!resource || !group) {
			return undefined; // we are not in a good state to load any state for a resource
		}

		const cache = this.doLoad();

		const mementoForResource = cache.get(resource.toString());
		if (mementoForResource) {
			return mementoForResource[group.id];
		}

		return undefined;
	}

	clearEditorState(resource: URI, group?: IEditorGroup): void;
	clearEditorState(editor: EditorInput, group?: IEditorGroup): void;
	clearEditorState(resourceOrEditor: URI | EditorInput, group?: IEditorGroup): void {
		const resource = this.doGetResource(resourceOrEditor);
		if (resource) {
			const cache = this.doLoad();

			if (group) {
				const resourceViewState = cache.get(resource.toString());
				if (resourceViewState) {
					delete resourceViewState[group.id];
				}
			} else {
				cache.delete(resource.toString());
			}
		}
	}

	moveEditorState(source: URI, target: URI): void {
		const cache = this.doLoad();

		const cacheKeys = cache.keys();
		for (const cacheKey of cacheKeys) {
			const resource = URI.parse(cacheKey);

			if (!isEqualOrParent(resource, source)) {
				continue; // not matching our resource
			}

			// Determine new resulting target resource
			let targetResource: URI;
			if (source.toString() === resource.toString()) {
				targetResource = target; // file got moved
			} else {
				const index = indexOfPath(resource.path, source.path, !isLinux);
				targetResource = joinPath(target, resource.path.substr(index + source.path.length + 1)); // parent folder got moved
			}

			const value = cache.get(cacheKey);
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

		// Cleanup once during shutdown
		if (!this.cleanedUp) {
			this.cleanUp();
			this.cleanedUp = true;
		}

		this.memento[this.key] = cache.toJSON();
	}

	private cleanUp(): void {
		const cache = this.doLoad();

		// Remove groups from states that no longer exist
		cache.forEach((mapGroupToMemento, resource) => {
			Object.keys(mapGroupToMemento).forEach(group => {
				const groupId: GroupIdentifier = Number(group);
				if (!this.editorGroupService.getGroup(groupId)) {
					delete mapGroupToMemento[groupId];

					if (isEmptyObject(mapGroupToMemento)) {
						cache.delete(resource);
					}
				}
			});
		});
	}
}
