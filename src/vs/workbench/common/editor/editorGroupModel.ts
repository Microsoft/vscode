/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { IEditorInputFactoryRegistry, EditorInput, IEditorIdentifier, IEditorCloseEvent, GroupIdentifier, SideBySideEditorInput, IEditorInput, EditorsOrder, EditorExtensions } from 'vs/workbench/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { dispose, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { coalesce } from 'vs/base/common/arrays';

const EditorOpenPositioning = {
	LEFT: 'left',
	RIGHT: 'right',
	FIRST: 'first',
	LAST: 'last'
};

export interface EditorCloseEvent extends IEditorCloseEvent {
	readonly editor: EditorInput;
}

export interface EditorIdentifier extends IEditorIdentifier {
	readonly groupId: GroupIdentifier;
	readonly editor: EditorInput;
}

export interface IEditorOpenOptions {
	readonly pinned?: boolean;
	sticky?: boolean;
	active?: boolean;
	readonly index?: number;
}

export interface IEditorOpenResult {
	readonly editor: EditorInput;
	readonly isNew: boolean;
}

export interface ISerializedEditorInput {
	readonly id: string;
	readonly value: string;
}

export interface ISerializedEditorGroupModel {
	readonly id: number;
	readonly editors: ISerializedEditorInput[];
	readonly mru: number[];
	readonly preview?: number;
	sticky?: number;
}

export function isSerializedEditorGroupModel(obj?: unknown): obj is ISerializedEditorGroupModel {
	const group = obj as ISerializedEditorGroupModel;

	return !!(obj && typeof obj === 'object' && Array.isArray(group.editors) && Array.isArray(group.mru));
}

export class EditorGroupModel extends Disposable {

	private static IDS = 0;

	//#region events

	private readonly _onDidActivateEditor = this._register(new Emitter<EditorInput>());
	readonly onDidActivateEditor = this._onDidActivateEditor.event;

	private readonly _onDidOpenEditor = this._register(new Emitter<EditorInput>());
	readonly onDidOpenEditor = this._onDidOpenEditor.event;

	private readonly _onDidCloseEditor = this._register(new Emitter<EditorCloseEvent>());
	readonly onDidCloseEditor = this._onDidCloseEditor.event;

	private readonly _onWillDisposeEditor = this._register(new Emitter<EditorInput>());
	readonly onWillDisposeEditor = this._onWillDisposeEditor.event;

	private readonly _onDidChangeEditorDirty = this._register(new Emitter<EditorInput>());
	readonly onDidChangeEditorDirty = this._onDidChangeEditorDirty.event;

	private readonly _onDidChangeEditorLabel = this._register(new Emitter<EditorInput>());
	readonly onDidEditorLabelChange = this._onDidChangeEditorLabel.event;

	private readonly _onDidMoveEditor = this._register(new Emitter<EditorInput>());
	readonly onDidMoveEditor = this._onDidMoveEditor.event;

	private readonly _onDidChangeEditorPinned = this._register(new Emitter<EditorInput>());
	readonly onDidChangeEditorPinned = this._onDidChangeEditorPinned.event;

	private readonly _onDidChangeEditorSticky = this._register(new Emitter<EditorInput>());
	readonly onDidChangeEditorSticky = this._onDidChangeEditorSticky.event;

	//#endregion

	private _id: GroupIdentifier;
	get id(): GroupIdentifier { return this._id; }

	private editors: EditorInput[] = [];
	private mru: EditorInput[] = [];

	private preview: EditorInput | null = null; // editor in preview state
	private active: EditorInput | null = null;  // editor in active state
	private sticky: number = -1; // index of first editor in sticky state

	private editorOpenPositioning: ('left' | 'right' | 'first' | 'last') | undefined;
	private focusRecentEditorAfterClose: boolean | undefined;

	constructor(
		labelOrSerializedGroup: ISerializedEditorGroupModel | undefined,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		if (isSerializedEditorGroupModel(labelOrSerializedGroup)) {
			this._id = this.deserialize(labelOrSerializedGroup);
		} else {
			this._id = EditorGroupModel.IDS++;
		}

		this.onConfigurationUpdated();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.configurationService.onDidChangeConfiguration(() => this.onConfigurationUpdated()));
	}

	private onConfigurationUpdated(): void {
		this.editorOpenPositioning = this.configurationService.getValue('workbench.editor.openPositioning');
		this.focusRecentEditorAfterClose = this.configurationService.getValue('workbench.editor.focusRecentEditorAfterClose');
	}

	get count(): number {
		return this.editors.length;
	}

	get stickyCount(): number {
		return this.sticky + 1;
	}

	getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): EditorInput[] {
		const editors = order === EditorsOrder.MOST_RECENTLY_ACTIVE ? this.mru.slice(0) : this.editors.slice(0);

		if (options?.excludeSticky) {

			// MRU: need to check for index on each
			if (order === EditorsOrder.MOST_RECENTLY_ACTIVE) {
				return editors.filter(editor => !this.isSticky(editor));
			}

			// Sequential: simply start after sticky index
			return editors.slice(this.sticky + 1);
		}

		return editors;
	}

	getEditorByIndex(index: number): EditorInput | undefined {
		return this.editors[index];
	}

	get activeEditor(): EditorInput | null {
		return this.active;
	}

	isActive(editor: EditorInput): boolean {
		return this.matches(this.active, editor);
	}

	get previewEditor(): EditorInput | null {
		return this.preview;
	}

	openEditor(candidate: EditorInput, options?: IEditorOpenOptions): IEditorOpenResult {
		const makeSticky = options?.sticky || (typeof options?.index === 'number' && this.isSticky(options.index));
		const makePinned = options?.pinned || options?.sticky;
		const makeActive = options?.active || !this.activeEditor || (!makePinned && this.matches(this.preview, this.activeEditor));

		const existingEditorAndIndex = this.findEditor(candidate);

		// New editor
		if (!existingEditorAndIndex) {
			const newEditor = candidate;
			const indexOfActive = this.indexOf(this.active);

			// Insert into specific position
			let targetIndex: number;
			if (options && typeof options.index === 'number') {
				targetIndex = options.index;
			}

			// Insert to the BEGINNING
			else if (this.editorOpenPositioning === EditorOpenPositioning.FIRST) {
				targetIndex = 0;

				// Always make sure targetIndex is after sticky editors
				// unless we are explicitly told to make the editor sticky
				if (!makeSticky && this.isSticky(targetIndex)) {
					targetIndex = this.sticky + 1;
				}
			}

			// Insert to the END
			else if (this.editorOpenPositioning === EditorOpenPositioning.LAST) {
				targetIndex = this.editors.length;
			}

			// Insert to LEFT or RIGHT of active editor
			else {

				// Insert to the LEFT of active editor
				if (this.editorOpenPositioning === EditorOpenPositioning.LEFT) {
					if (indexOfActive === 0 || !this.editors.length) {
						targetIndex = 0; // to the left becoming first editor in list
					} else {
						targetIndex = indexOfActive; // to the left of active editor
					}
				}

				// Insert to the RIGHT of active editor
				else {
					targetIndex = indexOfActive + 1;
				}

				// Always make sure targetIndex is after sticky editors
				// unless we are explicitly told to make the editor sticky
				if (!makeSticky && this.isSticky(targetIndex)) {
					targetIndex = this.sticky + 1;
				}
			}

			// If the editor becomes sticky, increment the sticky index and adjust
			// the targetIndex to be at the end of sticky editors unless already.
			if (makeSticky) {
				this.sticky++;

				if (!this.isSticky(targetIndex)) {
					targetIndex = this.sticky;
				}
			}

			// Insert into our list of editors if pinned or we have no preview editor
			if (makePinned || !this.preview) {
				this.splice(targetIndex, false, newEditor);
			}

			// Handle preview
			if (!makePinned) {

				// Replace existing preview with this editor if we have a preview
				if (this.preview) {
					const indexOfPreview = this.indexOf(this.preview);
					if (targetIndex > indexOfPreview) {
						targetIndex--; // accomodate for the fact that the preview editor closes
					}

					this.replaceEditor(this.preview, newEditor, targetIndex, !makeActive);
				}

				this.preview = newEditor;
			}

			// Listeners
			this.registerEditorListeners(newEditor);

			// Event
			this._onDidOpenEditor.fire(newEditor);

			// Handle active
			if (makeActive) {
				this.doSetActive(newEditor);
			}

			return {
				editor: newEditor,
				isNew: true
			};
		}

		// Existing editor
		else {
			const [existingEditor] = existingEditorAndIndex;

			// Pin it
			if (makePinned) {
				this.doPin(existingEditor);
			}

			// Activate it
			if (makeActive) {
				this.doSetActive(existingEditor);
			}

			// Respect index
			if (options && typeof options.index === 'number') {
				this.moveEditor(existingEditor, options.index);
			}

			// Stick it (intentionally after the moveEditor call in case
			// the editor was already moved into the sticky range)
			if (makeSticky) {
				this.doStick(existingEditor, this.indexOf(existingEditor));
			}

			return {
				editor: existingEditor,
				isNew: false
			};
		}
	}

	private registerEditorListeners(editor: EditorInput): void {
		const listeners = new DisposableStore();

		// Re-emit disposal of editor input as our own event
		listeners.add(Event.once(editor.onWillDispose)(() => {
			if (this.indexOf(editor) >= 0) {
				this._onWillDisposeEditor.fire(editor);
			}
		}));

		// Re-Emit dirty state changes
		listeners.add(editor.onDidChangeDirty(() => {
			this._onDidChangeEditorDirty.fire(editor);
		}));

		// Re-Emit label changes
		listeners.add(editor.onDidChangeLabel(() => {
			this._onDidChangeEditorLabel.fire(editor);
		}));

		// Clean up dispose listeners once the editor gets closed
		listeners.add(this.onDidCloseEditor(event => {
			if (event.editor.matches(editor)) {
				dispose(listeners);
			}
		}));
	}

	private replaceEditor(toReplace: EditorInput, replaceWith: EditorInput, replaceIndex: number, openNext = true): void {
		const event = this.doCloseEditor(toReplace, openNext, true); // optimization to prevent multiple setActive() in one call

		// We want to first add the new editor into our model before emitting the close event because
		// firing the close event can trigger a dispose on the same editor that is now being added.
		// This can lead into opening a disposed editor which is not what we want.
		this.splice(replaceIndex, false, replaceWith);

		if (event) {
			this._onDidCloseEditor.fire(event);
		}
	}

	closeEditor(candidate: EditorInput, openNext = true): EditorInput | undefined {
		const event = this.doCloseEditor(candidate, openNext, false);

		if (event) {
			this._onDidCloseEditor.fire(event);

			return event.editor;
		}

		return undefined;
	}

	private doCloseEditor(candidate: EditorInput, openNext: boolean, replaced: boolean): EditorCloseEvent | undefined {
		const index = this.indexOf(candidate);
		if (index === -1) {
			return undefined; // not found
		}

		const editor = this.editors[index];
		const sticky = this.isSticky(index);

		// Active Editor closed
		if (openNext && this.matches(this.active, editor)) {

			// More than one editor
			if (this.mru.length > 1) {
				let newActive: EditorInput;
				if (this.focusRecentEditorAfterClose) {
					newActive = this.mru[1]; // active editor is always first in MRU, so pick second editor after as new active
				} else {
					if (index === this.editors.length - 1) {
						newActive = this.editors[index - 1]; // last editor is closed, pick previous as new active
					} else {
						newActive = this.editors[index + 1]; // pick next editor as new active
					}
				}

				this.doSetActive(newActive);
			}

			// One Editor
			else {
				this.active = null;
			}
		}

		// Preview Editor closed
		if (this.matches(this.preview, editor)) {
			this.preview = null;
		}

		// Remove from arrays
		this.splice(index, true);

		// Event
		return { editor, replaced, sticky, index, groupId: this.id };
	}

	moveEditor(candidate: EditorInput, toIndex: number): EditorInput | undefined {

		// Ensure toIndex is in bounds of our model
		if (toIndex >= this.editors.length) {
			toIndex = this.editors.length - 1;
		} else if (toIndex < 0) {
			toIndex = 0;
		}

		const index = this.indexOf(candidate);
		if (index < 0 || toIndex === index) {
			return;
		}

		const editor = this.editors[index];

		// Adjust sticky index: editor moved out of sticky state into unsticky state
		if (this.isSticky(index) && toIndex > this.sticky) {
			this.sticky--;
		}

		// ...or editor moved into sticky state from unsticky state
		else if (!this.isSticky(index) && toIndex <= this.sticky) {
			this.sticky++;
		}

		// Move
		this.editors.splice(index, 1);
		this.editors.splice(toIndex, 0, editor);

		// Event
		this._onDidMoveEditor.fire(editor);

		return editor;
	}

	setActive(candidate: EditorInput): EditorInput | undefined {
		const res = this.findEditor(candidate);
		if (!res) {
			return; // not found
		}

		const [editor] = res;

		this.doSetActive(editor);

		return editor;
	}

	private doSetActive(editor: EditorInput): void {
		if (this.matches(this.active, editor)) {
			return; // already active
		}

		this.active = editor;

		// Bring to front in MRU list
		const mruIndex = this.indexOf(editor, this.mru);
		this.mru.splice(mruIndex, 1);
		this.mru.unshift(editor);

		// Event
		this._onDidActivateEditor.fire(editor);
	}

	pin(candidate: EditorInput): EditorInput | undefined {
		const res = this.findEditor(candidate);
		if (!res) {
			return; // not found
		}

		const [editor] = res;

		this.doPin(editor);

		return editor;
	}

	private doPin(editor: EditorInput): void {
		if (this.isPinned(editor)) {
			return; // can only pin a preview editor
		}

		// Convert the preview editor to be a pinned editor
		this.preview = null;

		// Event
		this._onDidChangeEditorPinned.fire(editor);
	}

	unpin(candidate: EditorInput): EditorInput | undefined {
		const res = this.findEditor(candidate);
		if (!res) {
			return; // not found
		}

		const [editor] = res;

		this.doUnpin(editor);

		return editor;
	}

	private doUnpin(editor: EditorInput): void {
		if (!this.isPinned(editor)) {
			return; // can only unpin a pinned editor
		}

		// Set new
		const oldPreview = this.preview;
		this.preview = editor;

		// Event
		this._onDidChangeEditorPinned.fire(editor);

		// Close old preview editor if any
		if (oldPreview) {
			this.closeEditor(oldPreview);
		}
	}

	isPinned(editorOrIndex: EditorInput | number): boolean {
		let editor: EditorInput;
		if (typeof editorOrIndex === 'number') {
			editor = this.editors[editorOrIndex];
		} else {
			editor = editorOrIndex;
		}

		return !this.matches(this.preview, editor);
	}

	stick(candidate: EditorInput): EditorInput | undefined {
		const res = this.findEditor(candidate);
		if (!res) {
			return; // not found
		}

		const [editor, index] = res;

		this.doStick(editor, index);

		return editor;
	}

	private doStick(editor: EditorInput, index: number): void {
		if (this.isSticky(index)) {
			return; // can only stick a non-sticky editor
		}

		// Pin editor
		this.pin(editor);

		// Move editor to be the last sticky editor
		this.moveEditor(editor, this.sticky + 1);

		// Adjust sticky index
		this.sticky++;

		// Event
		this._onDidChangeEditorSticky.fire(editor);
	}

	unstick(candidate: EditorInput): EditorInput | undefined {
		const res = this.findEditor(candidate);
		if (!res) {
			return; // not found
		}

		const [editor, index] = res;

		this.doUnstick(editor, index);

		return editor;
	}

	private doUnstick(editor: EditorInput, index: number): void {
		if (!this.isSticky(index)) {
			return; // can only unstick a sticky editor
		}

		// Move editor to be the first non-sticky editor
		this.moveEditor(editor, this.sticky);

		// Adjust sticky index
		this.sticky--;

		// Event
		this._onDidChangeEditorSticky.fire(editor);
	}

	isSticky(candidateOrIndex: EditorInput | number): boolean {
		if (this.sticky < 0) {
			return false; // no sticky editor
		}

		let index: number;
		if (typeof candidateOrIndex === 'number') {
			index = candidateOrIndex;
		} else {
			index = this.indexOf(candidateOrIndex);
		}

		if (index < 0) {
			return false;
		}

		return index <= this.sticky;
	}

	private splice(index: number, del: boolean, editor?: EditorInput): void {
		const editorToDeleteOrReplace = this.editors[index];

		// Perform on sticky index
		if (del && this.isSticky(index)) {
			this.sticky--;
		}

		// Perform on editors array
		if (editor) {
			this.editors.splice(index, del ? 1 : 0, editor);
		} else {
			this.editors.splice(index, del ? 1 : 0);
		}

		// Perform on MRU
		{
			// Add
			if (!del && editor) {
				if (this.mru.length === 0) {
					// the list of most recent editors is empty
					// so this editor can only be the most recent
					this.mru.push(editor);
				} else {
					// we have most recent editors. as such we
					// put this newly opened editor right after
					// the current most recent one because it cannot
					// be the most recently active one unless
					// it becomes active. but it is still more
					// active then any other editor in the list.
					this.mru.splice(1, 0, editor);
				}
			}

			// Remove / Replace
			else {
				const indexInMRU = this.indexOf(editorToDeleteOrReplace, this.mru);

				// Remove
				if (del && !editor) {
					this.mru.splice(indexInMRU, 1); // remove from MRU
				}

				// Replace
				else if (del && editor) {
					this.mru.splice(indexInMRU, 1, editor); // replace MRU at location
				}
			}
		}
	}

	indexOf(candidate: IEditorInput | null, editors = this.editors): number {
		if (!candidate) {
			return -1;
		}

		for (let i = 0; i < editors.length; i++) {
			if (this.matches(editors[i], candidate)) {
				return i;
			}
		}

		return -1;
	}

	private findEditor(candidate: EditorInput | null): [EditorInput, number /* index */] | undefined {
		const index = this.indexOf(candidate, this.editors);
		if (index === -1) {
			return undefined;
		}

		return [this.editors[index], index];
	}

	contains(candidate: EditorInput, options?: { supportSideBySide?: boolean, strictEquals?: boolean }): boolean {
		for (const editor of this.editors) {
			if (this.matches(editor, candidate, options?.strictEquals)) {
				return true;
			}

			if (options?.supportSideBySide && editor instanceof SideBySideEditorInput) {
				if (this.matches(editor.primary, candidate, options?.strictEquals) || this.matches(editor.secondary, candidate, options?.strictEquals)) {
					return true;
				}
			}
		}

		return false;
	}

	private matches(editor: IEditorInput | null, candidate: IEditorInput | null, strictEquals?: boolean): boolean {
		if (!editor || !candidate) {
			return false;
		}

		if (strictEquals) {
			return editor === candidate;
		}

		return editor.matches(candidate);
	}

	clone(): EditorGroupModel {
		const clone = this.instantiationService.createInstance(EditorGroupModel, undefined);

		// Copy over group properties
		clone.editors = this.editors.slice(0);
		clone.mru = this.mru.slice(0);
		clone.preview = this.preview;
		clone.active = this.active;
		clone.sticky = this.sticky;

		// Ensure to register listeners for each editor
		for (const editor of clone.editors) {
			clone.registerEditorListeners(editor);
		}

		return clone;
	}

	serialize(): ISerializedEditorGroupModel {
		const registry = Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories);

		// Serialize all editor inputs so that we can store them.
		// Editors that cannot be serialized need to be ignored
		// from mru, active, preview and sticky if any.
		let serializableEditors: EditorInput[] = [];
		let serializedEditors: ISerializedEditorInput[] = [];
		let serializablePreviewIndex: number | undefined;
		let serializableSticky = this.sticky;

		for (let i = 0; i < this.editors.length; i++) {
			const editor = this.editors[i];
			let canSerializeEditor = false;

			const editorSerializer = registry.getEditorInputSerializer(editor);
			if (editorSerializer) {
				const value = editorSerializer.serialize(editor);

				// Editor can be serialized
				if (typeof value === 'string') {
					canSerializeEditor = true;

					serializedEditors.push({ id: editor.typeId, value });
					serializableEditors.push(editor);

					if (this.preview === editor) {
						serializablePreviewIndex = serializableEditors.length - 1;
					}
				}

				// Editor cannot be serialized
				else {
					canSerializeEditor = false;
				}
			}

			// Adjust index of sticky editors if the editor cannot be serialized and is pinned
			if (!canSerializeEditor && this.isSticky(i)) {
				serializableSticky--;
			}
		}

		const serializableMru = this.mru.map(editor => this.indexOf(editor, serializableEditors)).filter(i => i >= 0);

		return {
			id: this.id,
			editors: serializedEditors,
			mru: serializableMru,
			preview: serializablePreviewIndex,
			sticky: serializableSticky >= 0 ? serializableSticky : undefined
		};
	}

	private deserialize(data: ISerializedEditorGroupModel): number {
		const registry = Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories);

		if (typeof data.id === 'number') {
			this._id = data.id;

			EditorGroupModel.IDS = Math.max(data.id + 1, EditorGroupModel.IDS); // make sure our ID generator is always larger
		} else {
			this._id = EditorGroupModel.IDS++; // backwards compatibility
		}

		this.editors = coalesce(data.editors.map((e, index) => {
			let editor: EditorInput | undefined = undefined;

			const editorSerializer = registry.getEditorInputSerializer(e.id);
			if (editorSerializer) {
				editor = editorSerializer.deserialize(this.instantiationService, e.value);
				if (editor) {
					this.registerEditorListeners(editor);
				}
			}

			if (!editor && typeof data.sticky === 'number' && index <= data.sticky) {
				data.sticky--; // if editor cannot be deserialized but was sticky, we need to decrease sticky index
			}

			return editor;
		}));

		this.mru = coalesce(data.mru.map(i => this.editors[i]));

		this.active = this.mru[0];

		if (typeof data.preview === 'number') {
			this.preview = this.editors[data.preview];
		}

		if (typeof data.sticky === 'number') {
			this.sticky = data.sticky;
		}

		return this._id;
	}
}
