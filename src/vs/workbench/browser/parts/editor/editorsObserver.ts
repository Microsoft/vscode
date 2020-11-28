/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorInput, IEditorInputFactoryRegistry, IEditorIdentifier, GroupIdentifier, Extensions, IEditorPartOptionsChangeEvent, EditorsOrder, EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { dispose, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { Registry } from 'vs/platform/registry/common/platform';
import { Event, Emitter } from 'vs/base/common/event';
import { IEditorGroupsService, IEditorGroup, GroupChangeKind, GroupsOrder } from 'vs/workbench/services/editor/common/editorGroupsService';
import { coalesce } from 'vs/base/common/arrays';
import { LinkedMap, Touch, ResourceMap } from 'vs/base/common/map';
import { equals } from 'vs/base/common/objects';
import { URI } from 'vs/base/common/uri';

interface ISerializedEditorsList {
	entries: ISerializedEditorIdentifier[];
}

interface ISerializedEditorIdentifier {
	groupId: GroupIdentifier;
	index: number;
}

/**
 * A observer of opened editors across all editor groups by most recently used.
 * Rules:
 * - the last editor in the list is the one most recently activated
 * - the first editor in the list is the one that was activated the longest time ago
 * - an editor that opens inactive will be placed behind the currently active editor
 *
 * The observer may start to close editors based on the workbench.editor.limit setting.
 */
export class EditorsObserver extends Disposable {

	private static readonly STORAGE_KEY = 'editors.mru';

	private readonly keyMap = new Map<GroupIdentifier, Map<IEditorInput, IEditorIdentifier>>();
	private readonly mostRecentEditorsMap = new LinkedMap<IEditorIdentifier, IEditorIdentifier>();
	private readonly editorResourcesMap = new ResourceMap<number>();

	private readonly _onDidMostRecentlyActiveEditorsChange = this._register(new Emitter<void>());
	readonly onDidMostRecentlyActiveEditorsChange = this._onDidMostRecentlyActiveEditorsChange.event;

	get count(): number {
		return this.mostRecentEditorsMap.size;
	}

	get editors(): IEditorIdentifier[] {
		return [...this.mostRecentEditorsMap.values()];
	}

	hasEditor(resource: URI): boolean {
		return this.editorResourcesMap.has(resource);
	}

	constructor(
		@IEditorGroupsService private editorGroupsService: IEditorGroupsService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.storageService.onWillSaveState(() => this.saveState()));
		this._register(this.editorGroupsService.onDidAddGroup(group => this.onGroupAdded(group)));
		this._register(this.editorGroupsService.onDidEditorPartOptionsChange(e => this.onDidEditorPartOptionsChange(e)));

		this.editorGroupsService.whenRestored.then(() => this.loadState());
	}

	private onGroupAdded(group: IEditorGroup): void {

		// Make sure to add any already existing editor
		// of the new group into our list in LRU order
		const groupEditorsMru = group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE);
		for (let i = groupEditorsMru.length - 1; i >= 0; i--) {
			this.addMostRecentEditor(group, groupEditorsMru[i], false /* is not active */, true /* is new */);
		}

		// Make sure that active editor is put as first if group is active
		if (this.editorGroupsService.activeGroup === group && group.activeEditor) {
			this.addMostRecentEditor(group, group.activeEditor, true /* is active */, false /* already added before */);
		}

		// Group Listeners
		this.registerGroupListeners(group);
	}

	private registerGroupListeners(group: IEditorGroup): void {
		const groupDisposables = new DisposableStore();
		groupDisposables.add(group.onDidGroupChange(e => {
			switch (e.kind) {

				// Group gets active: put active editor as most recent
				case GroupChangeKind.GROUP_ACTIVE: {
					if (this.editorGroupsService.activeGroup === group && group.activeEditor) {
						this.addMostRecentEditor(group, group.activeEditor, true /* is active */, false /* editor already opened */);
					}

					break;
				}

				// Editor gets active: put active editor as most recent
				// if group is active, otherwise second most recent
				case GroupChangeKind.EDITOR_ACTIVE: {
					if (e.editor) {
						this.addMostRecentEditor(group, e.editor, this.editorGroupsService.activeGroup === group, false /* editor already opened */);
					}

					break;
				}

				// Editor opens: put it as second most recent
				//
				// Also check for maximum allowed number of editors and
				// start to close oldest ones if needed.
				case GroupChangeKind.EDITOR_OPEN: {
					if (e.editor) {
						this.addMostRecentEditor(group, e.editor, false /* is not active */, true /* is new */);
						this.ensureOpenedEditorsLimit({ groupId: group.id, editor: e.editor }, group.id);
					}

					break;
				}

				// Editor closes: remove from recently opened
				case GroupChangeKind.EDITOR_CLOSE: {
					if (e.editor) {
						this.removeMostRecentEditor(group, e.editor);
					}

					break;
				}
			}
		}));

		// Make sure to cleanup on dispose
		Event.once(group.onWillDispose)(() => dispose(groupDisposables));
	}

	private onDidEditorPartOptionsChange(event: IEditorPartOptionsChangeEvent): void {
		if (!equals(event.newPartOptions.limit, event.oldPartOptions.limit)) {
			const activeGroup = this.editorGroupsService.activeGroup;
			let exclude: IEditorIdentifier | undefined = undefined;
			if (activeGroup.activeEditor) {
				exclude = { editor: activeGroup.activeEditor, groupId: activeGroup.id };
			}

			this.ensureOpenedEditorsLimit(exclude);
		}
	}

	private addMostRecentEditor(group: IEditorGroup, editor: IEditorInput, isActive: boolean, isNew: boolean): void {
		const key = this.ensureKey(group, editor);
		const mostRecentEditor = this.mostRecentEditorsMap.first;

		// Active or first entry: add to end of map
		if (isActive || !mostRecentEditor) {
			this.mostRecentEditorsMap.set(key, key, mostRecentEditor ? Touch.AsOld /* make first */ : undefined);
		}

		// Otherwise: insert before most recent
		else {
			// we have most recent editors. as such we
			// put this newly opened editor right before
			// the current most recent one because it cannot
			// be the most recently active one unless
			// it becomes active. but it is still more
			// active then any other editor in the list.
			this.mostRecentEditorsMap.set(key, key, Touch.AsOld /* make first */);
			this.mostRecentEditorsMap.set(mostRecentEditor, mostRecentEditor, Touch.AsOld /* make first */);
		}

		// Update in resource map if this is a new editor
		if (isNew) {
			this.updateEditorResourcesMap(editor, true);
		}

		// Event
		this._onDidMostRecentlyActiveEditorsChange.fire();
	}

	private updateEditorResourcesMap(editor: IEditorInput, add: boolean): void {
		const resource = EditorResourceAccessor.getCanonicalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (!resource) {
			return; // require a resource
		}

		if (add) {
			this.editorResourcesMap.set(resource, (this.editorResourcesMap.get(resource) ?? 0) + 1);
		} else {
			const counter = this.editorResourcesMap.get(resource) ?? 0;
			if (counter > 1) {
				this.editorResourcesMap.set(resource, counter - 1);
			} else {
				this.editorResourcesMap.delete(resource);
			}
		}
	}

	private removeMostRecentEditor(group: IEditorGroup, editor: IEditorInput): void {

		// Update in resource map
		this.updateEditorResourcesMap(editor, false);

		// Update in MRU list
		const key = this.findKey(group, editor);
		if (key) {

			// Remove from most recent editors
			this.mostRecentEditorsMap.delete(key);

			// Remove from key map
			const map = this.keyMap.get(group.id);
			if (map && map.delete(key.editor) && map.size === 0) {
				this.keyMap.delete(group.id);
			}

			// Event
			this._onDidMostRecentlyActiveEditorsChange.fire();
		}
	}

	private findKey(group: IEditorGroup, editor: IEditorInput): IEditorIdentifier | undefined {
		const groupMap = this.keyMap.get(group.id);
		if (!groupMap) {
			return undefined;
		}

		return groupMap.get(editor);
	}

	private ensureKey(group: IEditorGroup, editor: IEditorInput): IEditorIdentifier {
		let groupMap = this.keyMap.get(group.id);
		if (!groupMap) {
			groupMap = new Map();

			this.keyMap.set(group.id, groupMap);
		}

		let key = groupMap.get(editor);
		if (!key) {
			key = { groupId: group.id, editor };
			groupMap.set(editor, key);
		}

		return key;
	}

	private async ensureOpenedEditorsLimit(exclude: IEditorIdentifier | undefined, groupId?: GroupIdentifier): Promise<void> {
		if (
			!this.editorGroupsService.partOptions.limit?.enabled ||
			typeof this.editorGroupsService.partOptions.limit.value !== 'number' ||
			this.editorGroupsService.partOptions.limit.value <= 0
		) {
			return; // return early if not enabled or invalid
		}

		const limit = this.editorGroupsService.partOptions.limit.value;

		// In editor group
		if (this.editorGroupsService.partOptions.limit?.perEditorGroup) {

			// For specific editor groups
			if (typeof groupId === 'number') {
				const group = this.editorGroupsService.getGroup(groupId);
				if (group) {
					await this.doEnsureOpenedEditorsLimit(limit, group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).map(editor => ({ editor, groupId })), exclude);
				}
			}

			// For all editor groups
			else {
				for (const group of this.editorGroupsService.groups) {
					await this.ensureOpenedEditorsLimit(exclude, group.id);
				}
			}
		}

		// Across all editor groups
		else {
			await this.doEnsureOpenedEditorsLimit(limit, [...this.mostRecentEditorsMap.values()], exclude);
		}
	}

	private async doEnsureOpenedEditorsLimit(limit: number, mostRecentEditors: IEditorIdentifier[], exclude?: IEditorIdentifier): Promise<void> {
		if (limit >= mostRecentEditors.length) {
			return; // only if opened editors exceed setting and is valid and enabled
		}

		// Extract least recently used editors that can be closed
		const leastRecentlyClosableEditors = mostRecentEditors.reverse().filter(({ editor, groupId }) => {
			if (editor.isDirty() && !editor.isSaving()) {
				return false; // not dirty editors (unless in the process of saving)
			}

			if (exclude && editor === exclude.editor && groupId === exclude.groupId) {
				return false; // never the editor that should be excluded
			}

			if (this.editorGroupsService.getGroup(groupId)?.isSticky(editor)) {
				return false; // never sticky editors
			}

			return true;
		});

		// Close editors until we reached the limit again
		let editorsToCloseCount = mostRecentEditors.length - limit;
		const mapGroupToEditorsToClose = new Map<GroupIdentifier, IEditorInput[]>();
		for (const { groupId, editor } of leastRecentlyClosableEditors) {
			let editorsInGroupToClose = mapGroupToEditorsToClose.get(groupId);
			if (!editorsInGroupToClose) {
				editorsInGroupToClose = [];
				mapGroupToEditorsToClose.set(groupId, editorsInGroupToClose);
			}

			editorsInGroupToClose.push(editor);
			editorsToCloseCount--;

			if (editorsToCloseCount === 0) {
				break; // limit reached
			}
		}

		for (const [groupId, editors] of mapGroupToEditorsToClose) {
			const group = this.editorGroupsService.getGroup(groupId);
			if (group) {
				await group.closeEditors(editors, { preserveFocus: true });
			}
		}
	}

	private saveState(): void {
		if (this.mostRecentEditorsMap.isEmpty()) {
			this.storageService.remove(EditorsObserver.STORAGE_KEY, StorageScope.WORKSPACE);
		} else {
			this.storageService.store(EditorsObserver.STORAGE_KEY, JSON.stringify(this.serialize()), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
	}

	private serialize(): ISerializedEditorsList {
		const registry = Registry.as<IEditorInputFactoryRegistry>(Extensions.EditorInputFactories);

		const entries = [...this.mostRecentEditorsMap.values()];
		const mapGroupToSerializableEditorsOfGroup = new Map<IEditorGroup, IEditorInput[]>();

		return {
			entries: coalesce(entries.map(({ editor, groupId }) => {

				// Find group for entry
				const group = this.editorGroupsService.getGroup(groupId);
				if (!group) {
					return undefined;
				}

				// Find serializable editors of group
				let serializableEditorsOfGroup = mapGroupToSerializableEditorsOfGroup.get(group);
				if (!serializableEditorsOfGroup) {
					serializableEditorsOfGroup = group.getEditors(EditorsOrder.SEQUENTIAL).filter(editor => {
						const factory = registry.getEditorInputFactory(editor.getTypeId());

						return factory?.canSerialize(editor);
					});
					mapGroupToSerializableEditorsOfGroup.set(group, serializableEditorsOfGroup);
				}

				// Only store the index of the editor of that group
				// which can be undefined if the editor is not serializable
				const index = serializableEditorsOfGroup.indexOf(editor);
				if (index === -1) {
					return undefined;
				}

				return { groupId, index };
			}))
		};
	}

	private loadState(): void {
		const serialized = this.storageService.get(EditorsObserver.STORAGE_KEY, StorageScope.WORKSPACE);

		// Previous state:
		if (serialized) {

			// Load editors map from persisted state
			this.deserialize(JSON.parse(serialized));
		}

		// No previous state: best we can do is add each editor
		// from oldest to most recently used editor group
		else {
			const groups = this.editorGroupsService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
			for (let i = groups.length - 1; i >= 0; i--) {
				const group = groups[i];
				const groupEditorsMru = group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE);
				for (let i = groupEditorsMru.length - 1; i >= 0; i--) {
					this.addMostRecentEditor(group, groupEditorsMru[i], true /* enforce as active to preserve order */, true /* is new */);
				}
			}
		}

		// Ensure we listen on group changes for those that exist on startup
		for (const group of this.editorGroupsService.groups) {
			this.registerGroupListeners(group);
		}
	}

	private deserialize(serialized: ISerializedEditorsList): void {
		const mapValues: [IEditorIdentifier, IEditorIdentifier][] = [];

		for (const { groupId, index } of serialized.entries) {

			// Find group for entry
			const group = this.editorGroupsService.getGroup(groupId);
			if (!group) {
				continue;
			}

			// Find editor for entry
			const editor = group.getEditorByIndex(index);
			if (!editor) {
				continue;
			}

			// Make sure key is registered as well
			const editorIdentifier = this.ensureKey(group, editor);
			mapValues.push([editorIdentifier, editorIdentifier]);

			// Update in resource map
			this.updateEditorResourcesMap(editor, true);
		}

		// Fill map with deserialized values
		this.mostRecentEditorsMap.fromJSON(mapValues);
	}
}
