/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';
import { IEditor } from 'vs/editor/common/editorCommon';
import { ITextEditorOptions, IResourceEditorInput, TextEditorSelectionRevealType, IEditorOptions } from 'vs/platform/editor/common/editor';
import { IEditorInput, IEditorPane, Extensions as EditorExtensions, EditorInput, IEditorCloseEvent, IEditorInputFactoryRegistry, EditorResourceAccessor, IEditorIdentifier, GroupIdentifier, EditorsOrder, SideBySideEditor } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { FileChangesEvent, IFileService, FileChangeType, FILES_EXCLUDE_CONFIG } from 'vs/platform/files/common/files';
import { Selection } from 'vs/editor/common/core/selection';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { dispose, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { Registry } from 'vs/platform/registry/common/platform';
import { Event } from 'vs/base/common/event';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { getCodeEditor, ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { getExcludes, ISearchConfiguration, SEARCH_EXCLUDE_CONFIG } from 'vs/workbench/services/search/common/search';
import { ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EditorServiceImpl } from 'vs/workbench/browser/parts/editor/editor';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { coalesce, remove } from 'vs/base/common/arrays';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { withNullAsUndefined } from 'vs/base/common/types';
import { addDisposableListener, EventType, EventHelper } from 'vs/base/browser/dom';
import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { Schemas } from 'vs/base/common/network';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IdleValue } from 'vs/base/common/async';
import { ResourceGlobMatcher } from 'vs/workbench/common/resources';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

/**
 * Stores the selection & view state of an editor and allows to compare it to other selection states.
 */
export class TextEditorState {

	private static readonly EDITOR_SELECTION_THRESHOLD = 10; // number of lines to move in editor to justify for new state

	constructor(private _editorInput: IEditorInput, private _selection: Selection | null) { }

	get editorInput(): IEditorInput {
		return this._editorInput;
	}

	get selection(): Selection | undefined {
		return withNullAsUndefined(this._selection);
	}

	justifiesNewPushState(other: TextEditorState, event?: ICursorPositionChangedEvent): boolean {
		if (event?.source === 'api') {
			return true; // always let API source win (e.g. "Go to definition" should add a history entry)
		}

		if (!this._editorInput.matches(other._editorInput)) {
			return true; // different editor inputs
		}

		if (!Selection.isISelection(this._selection) || !Selection.isISelection(other._selection)) {
			return true; // unknown selections
		}

		const thisLineNumber = Math.min(this._selection.selectionStartLineNumber, this._selection.positionLineNumber);
		const otherLineNumber = Math.min(other._selection.selectionStartLineNumber, other._selection.positionLineNumber);

		if (Math.abs(thisLineNumber - otherLineNumber) < TextEditorState.EDITOR_SELECTION_THRESHOLD) {
			return false; // ignore selection changes in the range of EditorState.EDITOR_SELECTION_THRESHOLD lines
		}

		return true;
	}
}

interface ISerializedEditorHistoryEntry {
	resourceJSON?: object;
	editorInputJSON?: { typeId: string; deserialized: string; };
}

interface IStackEntry {
	input: IEditorInput | IResourceEditorInput;
	selection?: Selection;
}

interface IRecentlyClosedEditor {
	resource: URI | undefined;
	associatedResources: URI[];
	serialized: { typeId: string, value: string };
	index: number;
	sticky: boolean;
}

export class HistoryService extends Disposable implements IHistoryService {

	declare readonly _serviceBrand: undefined;

	private readonly activeEditorListeners = this._register(new DisposableStore());
	private lastActiveEditor?: IEditorIdentifier;

	private readonly editorHistoryListeners = new Map();
	private readonly editorStackListeners = new Map();

	private readonly editorInputFactory = Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories);

	constructor(
		@IEditorService private readonly editorService: EditorServiceImpl,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IPathService private readonly pathService: IPathService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.editorService.onDidActiveEditorChange(() => this.onActiveEditorChanged()));
		this._register(this.editorService.onDidOpenEditorFail(event => this.remove(event.editor)));
		this._register(this.editorService.onDidCloseEditor(event => this.onEditorClosed(event)));
		this._register(this.storageService.onWillSaveState(() => this.saveState()));
		this._register(this.fileService.onDidFilesChange(event => this.onDidFilesChange(event)));
		this._register(this.editorService.onDidMostRecentlyActiveEditorsChange(() => this.handleEditorEventInRecentEditorsStack()));

		// if the service is created late enough that an editor is already opened
		// make sure to trigger the onActiveEditorChanged() to track the editor
		// properly (fixes https://github.com/microsoft/vscode/issues/59908)
		if (this.editorService.activeEditorPane) {
			this.onActiveEditorChanged();
		}

		// Mouse back/forward support
		const mouseBackForwardSupportListener = this._register(new DisposableStore());
		const handleMouseBackForwardSupport = () => {
			mouseBackForwardSupportListener.clear();

			if (this.configurationService.getValue('workbench.editor.mouseBackForwardToNavigate')) {
				mouseBackForwardSupportListener.add(addDisposableListener(this.layoutService.container, EventType.MOUSE_DOWN, e => this.onMouseDown(e)));
			}
		};

		this._register(this.configurationService.onDidChangeConfiguration(event => {
			if (event.affectsConfiguration('workbench.editor.mouseBackForwardToNavigate')) {
				handleMouseBackForwardSupport();
			}
		}));

		handleMouseBackForwardSupport();
	}

	private onMouseDown(e: MouseEvent): void {

		// Support to navigate in history when mouse buttons 4/5 are pressed
		switch (e.button) {
			case 3:
				EventHelper.stop(e);
				this.back();
				break;
			case 4:
				EventHelper.stop(e);
				this.forward();
				break;
		}
	}

	private onActiveEditorChanged(): void {
		const activeEditorPane = this.editorService.activeEditorPane;
		if (this.lastActiveEditor && this.matchesEditor(this.lastActiveEditor, activeEditorPane)) {
			return; // return if the active editor is still the same
		}

		// Remember as last active editor (can be undefined if none opened)
		this.lastActiveEditor = activeEditorPane?.input && activeEditorPane.group ? { editor: activeEditorPane.input, groupId: activeEditorPane.group.id } : undefined;

		// Dispose old listeners
		this.activeEditorListeners.clear();

		// Propagate to history
		this.handleActiveEditorChange(activeEditorPane);

		// Apply listener for selection changes if this is a text editor
		const activeTextEditorControl = getCodeEditor(this.editorService.activeTextEditorControl);
		const activeEditor = this.editorService.activeEditor;
		if (activeTextEditorControl) {

			// Debounce the event with a timeout of 0ms so that multiple calls to
			// editor.setSelection() are folded into one. We do not want to record
			// subsequent history navigations for such API calls.
			this.activeEditorListeners.add(Event.debounce(activeTextEditorControl.onDidChangeCursorPosition, (last, event) => event, 0)((event => {
				this.handleEditorSelectionChangeEvent(activeEditorPane, event);
			})));

			// Track the last edit location by tracking model content change events
			// Use a debouncer to make sure to capture the correct cursor position
			// after the model content has changed.
			this.activeEditorListeners.add(Event.debounce(activeTextEditorControl.onDidChangeModelContent, (last, event) => event, 0)((event => {
				if (activeEditor) {
					this.rememberLastEditLocation(activeEditor, activeTextEditorControl);
				}
			})));
		}
	}

	private matchesEditor(identifier: IEditorIdentifier, editor?: IEditorPane): boolean {
		if (!editor || !editor.group) {
			return false;
		}

		if (identifier.groupId !== editor.group.id) {
			return false;
		}

		return identifier.editor.matches(editor.input);
	}

	private onDidFilesChange(e: FileChangesEvent): void {
		if (e.gotDeleted()) {
			this.remove(e); // remove from history files that got deleted or moved
		}
	}

	private handleEditorSelectionChangeEvent(editor?: IEditorPane, event?: ICursorPositionChangedEvent): void {
		this.handleEditorEventInNavigationStack(editor, event);
	}

	private handleActiveEditorChange(editor?: IEditorPane): void {
		this.handleEditorEventInHistory(editor);
		this.handleEditorEventInNavigationStack(editor);
	}

	private onEditorDispose(editor: EditorInput, listener: Function, mapEditorToDispose: Map<EditorInput, DisposableStore>): void {
		const toDispose = Event.once(editor.onDispose)(() => listener());

		let disposables = mapEditorToDispose.get(editor);
		if (!disposables) {
			disposables = new DisposableStore();
			mapEditorToDispose.set(editor, disposables);
		}

		disposables.add(toDispose);
	}

	private clearOnEditorDispose(editor: IEditorInput | IResourceEditorInput | FileChangesEvent, mapEditorToDispose: Map<EditorInput, DisposableStore>): void {
		if (editor instanceof EditorInput) {
			const disposables = mapEditorToDispose.get(editor);
			if (disposables) {
				dispose(disposables);
				mapEditorToDispose.delete(editor);
			}
		}
	}

	remove(input: IEditorInput | IResourceEditorInput): void;
	remove(input: FileChangesEvent): void;
	remove(arg1: IEditorInput | IResourceEditorInput | FileChangesEvent): void {
		this.removeFromHistory(arg1);
		this.removeFromNavigationStack(arg1);
		this.removeFromRecentlyClosedEditors(arg1);
		this.removeFromRecentlyOpened(arg1);
	}

	private removeFromRecentlyOpened(arg1: IEditorInput | IResourceEditorInput | FileChangesEvent): void {
		if (arg1 instanceof EditorInput || arg1 instanceof FileChangesEvent) {
			return; // for now do not delete from file events since recently open are likely out of workspace files for which there are no delete events
		}

		const input = arg1 as IResourceEditorInput;

		this.workspacesService.removeRecentlyOpened([input.resource]);
	}

	clear(): void {

		// History
		this.clearRecentlyOpened();

		// Navigation (next, previous)
		this.navigationStackIndex = -1;
		this.lastNavigationStackIndex = -1;
		this.navigationStack.splice(0);
		this.editorStackListeners.forEach(listeners => dispose(listeners));
		this.editorStackListeners.clear();

		// Recently closed editors
		this.recentlyClosedEditors = [];

		// Context Keys
		this.updateContextKeys();
	}

	//#region Navigation (Go Forward, Go Backward)

	private static readonly MAX_NAVIGATION_STACK_ITEMS = 50;

	private navigationStack: IStackEntry[] = [];
	private navigationStackIndex = -1;
	private lastNavigationStackIndex = -1;

	private navigatingInStack = false;

	private currentTextEditorState: TextEditorState | null = null;

	forward(): void {
		if (this.navigationStack.length > this.navigationStackIndex + 1) {
			this.setIndex(this.navigationStackIndex + 1);
			this.navigate();
		}
	}

	back(): void {
		if (this.navigationStackIndex > 0) {
			this.setIndex(this.navigationStackIndex - 1);
			this.navigate();
		}
	}

	last(): void {
		if (this.lastNavigationStackIndex === -1) {
			this.back();
		} else {
			this.setIndex(this.lastNavigationStackIndex);
			this.navigate();
		}
	}

	private setIndex(value: number): void {
		this.lastNavigationStackIndex = this.navigationStackIndex;
		this.navigationStackIndex = value;

		// Context Keys
		this.updateContextKeys();
	}

	private navigate(): void {
		this.navigatingInStack = true;

		const navigateToStackEntry = this.navigationStack[this.navigationStackIndex];

		this.doNavigate(navigateToStackEntry).finally(() => { this.navigatingInStack = false; });
	}

	private doNavigate(location: IStackEntry): Promise<IEditorPane | undefined> {
		const options: ITextEditorOptions = {
			revealIfOpened: true, // support to navigate across editor groups,
			selection: location.selection,
			selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport
		};

		if (location.input instanceof EditorInput) {
			return this.editorService.openEditor(location.input, options);
		}

		return this.editorService.openEditor({ resource: (location.input as IResourceEditorInput).resource, options });
	}

	private handleEditorEventInNavigationStack(control: IEditorPane | undefined, event?: ICursorPositionChangedEvent): void {
		const codeEditor = control ? getCodeEditor(control.getControl()) : undefined;

		// treat editor changes that happen as part of stack navigation specially
		// we do not want to add a new stack entry as a matter of navigating the
		// stack but we need to keep our currentTextEditorState up to date with
		// the navigtion that occurs.
		if (this.navigatingInStack) {
			if (codeEditor && control?.input && !control.input.isDisposed()) {
				this.currentTextEditorState = new TextEditorState(control.input, codeEditor.getSelection());
			} else {
				this.currentTextEditorState = null; // we navigated to a non text or disposed editor
			}
		}

		// normal navigation not part of history navigation
		else {

			// navigation inside text editor
			if (codeEditor && control?.input && !control.input.isDisposed()) {
				this.handleTextEditorEventInNavigationStack(control, codeEditor, event);
			}

			// navigation to non-text disposed editor
			else {
				this.currentTextEditorState = null; // at this time we have no active text editor view state

				if (control?.input && !control.input.isDisposed()) {
					this.handleNonTextEditorEventInNavigationStack(control);
				}
			}
		}
	}

	private handleTextEditorEventInNavigationStack(editor: IEditorPane, editorControl: IEditor, event?: ICursorPositionChangedEvent): void {
		if (!editor.input) {
			return;
		}

		const stateCandidate = new TextEditorState(editor.input, editorControl.getSelection());

		// Add to stack if we dont have a current state or this new state justifies a push
		if (!this.currentTextEditorState || this.currentTextEditorState.justifiesNewPushState(stateCandidate, event)) {
			this.addToNavigationStack(editor.input, stateCandidate.selection);
		}

		// Otherwise we replace the current stack entry with this one
		else {
			this.replaceInNavigationStack(editor.input, stateCandidate.selection);
		}

		// Update our current text editor state
		this.currentTextEditorState = stateCandidate;
	}

	private handleNonTextEditorEventInNavigationStack(editor: IEditorPane): void {
		if (!editor.input) {
			return;
		}

		const currentStack = this.navigationStack[this.navigationStackIndex];
		if (currentStack && this.matches(editor.input, currentStack.input)) {
			return; // do not push same editor input again
		}

		this.addToNavigationStack(editor.input);
	}

	private addToNavigationStack(input: IEditorInput, selection?: Selection): void {
		if (!this.navigatingInStack) {
			this.doAddOrReplaceInNavigationStack(input, selection);
		}
	}

	private replaceInNavigationStack(input: IEditorInput, selection?: Selection): void {
		if (!this.navigatingInStack) {
			this.doAddOrReplaceInNavigationStack(input, selection, true /* force replace */);
		}
	}

	private doAddOrReplaceInNavigationStack(input: IEditorInput, selection?: Selection, forceReplace?: boolean): void {

		// Overwrite an entry in the stack if we have a matching input that comes
		// with editor options to indicate that this entry is more specific. Also
		// prevent entries that have the exact same options. Finally, Overwrite
		// entries if we detect that the change came in very fast which indicates
		// that it was not coming in from a user change but rather rapid programmatic
		// changes. We just take the last of the changes to not cause too many entries
		// on the stack.
		// We can also be instructed to force replace the last entry.
		let replace = false;
		const currentEntry = this.navigationStack[this.navigationStackIndex];
		if (currentEntry) {
			if (forceReplace) {
				replace = true; // replace if we are forced to
			} else if (this.matches(input, currentEntry.input) && this.sameSelection(currentEntry.selection, selection)) {
				replace = true; // replace if the input is the same as the current one and the selection as well
			}
		}

		const stackEditorInput = this.preferResourceEditorInput(input);
		const entry = { input: stackEditorInput, selection };

		// Replace at current position
		let removedEntries: IStackEntry[] = [];
		if (replace) {
			removedEntries.push(this.navigationStack[this.navigationStackIndex]);
			this.navigationStack[this.navigationStackIndex] = entry;
		}

		// Add to stack at current position
		else {

			// If we are not at the end of history, we remove anything after
			if (this.navigationStack.length > this.navigationStackIndex + 1) {
				for (let i = this.navigationStackIndex + 1; i < this.navigationStack.length; i++) {
					removedEntries.push(this.navigationStack[i]);
				}

				this.navigationStack = this.navigationStack.slice(0, this.navigationStackIndex + 1);
			}

			// Insert entry at index
			this.navigationStack.splice(this.navigationStackIndex + 1, 0, entry);

			// Check for limit
			if (this.navigationStack.length > HistoryService.MAX_NAVIGATION_STACK_ITEMS) {
				removedEntries.push(this.navigationStack.shift()!); // remove first
				if (this.lastNavigationStackIndex >= 0) {
					this.lastNavigationStackIndex--;
				}
			} else {
				this.setIndex(this.navigationStackIndex + 1);
			}
		}

		// Clear editor listeners from removed entries
		removedEntries.forEach(removedEntry => this.clearOnEditorDispose(removedEntry.input, this.editorStackListeners));

		// Remove this from the stack unless the stack input is a resource
		// that can easily be restored even when the input gets disposed
		if (stackEditorInput instanceof EditorInput) {
			this.onEditorDispose(stackEditorInput, () => this.removeFromNavigationStack(stackEditorInput), this.editorStackListeners);
		}

		// Context Keys
		this.updateContextKeys();
	}

	private preferResourceEditorInput(input: IEditorInput): IEditorInput | IResourceEditorInput {
		const resource = EditorResourceAccessor.getOriginalUri(input);
		if (resource?.scheme === Schemas.file || resource?.scheme === Schemas.vscodeRemote || resource?.scheme === Schemas.userData || resource?.scheme === this.pathService.defaultUriScheme) {
			// for now, only prefer well known schemes that we control to prevent
			// issues such as https://github.com/microsoft/vscode/issues/85204
			return { resource };
		}

		return input;
	}

	private sameSelection(selectionA?: Selection, selectionB?: Selection): boolean {
		if (!selectionA && !selectionB) {
			return true;
		}

		if (!selectionA || !selectionB) {
			return false;
		}

		return selectionA.startLineNumber === selectionB.startLineNumber; // we consider the history entry same if we are on the same line
	}

	private removeFromNavigationStack(arg1: IEditorInput | IResourceEditorInput | FileChangesEvent): void {
		this.navigationStack = this.navigationStack.filter(e => {
			const matches = this.matches(arg1, e.input);

			// Cleanup any listeners associated with the input when removing
			if (matches) {
				this.clearOnEditorDispose(arg1, this.editorStackListeners);
			}

			return !matches;
		});
		this.navigationStackIndex = this.navigationStack.length - 1; // reset index
		this.lastNavigationStackIndex = -1;

		// Context Keys
		this.updateContextKeys();
	}

	private matches(arg1: IEditorInput | IResourceEditorInput | FileChangesEvent, inputB: IEditorInput | IResourceEditorInput): boolean {
		if (arg1 instanceof FileChangesEvent) {
			if (inputB instanceof EditorInput) {
				return false; // we only support this for IResourceEditorInput
			}

			const resourceEditorInputB = inputB as IResourceEditorInput;

			return arg1.contains(resourceEditorInputB.resource, FileChangeType.DELETED);
		}

		if (arg1 instanceof EditorInput && inputB instanceof EditorInput) {
			return arg1.matches(inputB);
		}

		if (arg1 instanceof EditorInput) {
			return this.matchesFile((inputB as IResourceEditorInput).resource, arg1);
		}

		if (inputB instanceof EditorInput) {
			return this.matchesFile((arg1 as IResourceEditorInput).resource, inputB);
		}

		const resourceEditorInputA = arg1 as IResourceEditorInput;
		const resourceEditorInputB = inputB as IResourceEditorInput;

		return resourceEditorInputA && resourceEditorInputB && this.uriIdentityService.extUri.isEqual(resourceEditorInputA.resource, resourceEditorInputB.resource);
	}

	private matchesFile(resource: URI, arg2: IEditorInput | IResourceEditorInput | FileChangesEvent): boolean {
		if (arg2 instanceof FileChangesEvent) {
			return arg2.contains(resource, FileChangeType.DELETED);
		}

		if (arg2 instanceof EditorInput) {
			const inputResource = arg2.resource;
			if (!inputResource) {
				return false;
			}

			if (this.layoutService.isRestored() && !this.fileService.canHandleResource(inputResource)) {
				return false; // make sure to only check this when workbench has restored (for https://github.com/microsoft/vscode/issues/48275)
			}

			return this.uriIdentityService.extUri.isEqual(inputResource, resource);
		}

		const resourceEditorInput = arg2 as IResourceEditorInput;

		return this.uriIdentityService.extUri.isEqual(resourceEditorInput?.resource, resource);
	}

	//#endregion

	//#region Recently Closed Editors

	private static readonly MAX_RECENTLY_CLOSED_EDITORS = 20;

	private recentlyClosedEditors: IRecentlyClosedEditor[] = [];
	private ignoreEditorCloseEvent = false;

	private onEditorClosed(event: IEditorCloseEvent): void {
		if (this.ignoreEditorCloseEvent) {
			return; // blocked
		}

		const { editor, replaced } = event;
		if (replaced) {
			return; // ignore if editor was replaced
		}

		const factory = this.editorInputFactory.getEditorInputFactory(editor.getTypeId());
		if (!factory || !factory.canSerialize(editor)) {
			return; // we need a factory from this point that can serialize this editor
		}

		const serialized = factory.serialize(editor);
		if (typeof serialized !== 'string') {
			return; // we need something to deserialize from
		}

		const associatedResources: URI[] = [];
		const editorResource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH });
		if (URI.isUri(editorResource)) {
			associatedResources.push(editorResource);
		} else if (editorResource) {
			associatedResources.push(...coalesce([editorResource.primary, editorResource.secondary]));
		}

		// Remove from list of recently closed before...
		this.removeFromRecentlyClosedEditors(editor);

		// ...adding it as last recently closed
		this.recentlyClosedEditors.push({
			resource: EditorResourceAccessor.getOriginalUri(editor),
			associatedResources,
			serialized: { typeId: editor.getTypeId(), value: serialized },
			index: event.index,
			sticky: event.sticky
		});

		// Bounding
		if (this.recentlyClosedEditors.length > HistoryService.MAX_RECENTLY_CLOSED_EDITORS) {
			this.recentlyClosedEditors.shift();
		}

		// Context
		this.canReopenClosedEditorContextKey.set(true);
	}

	reopenLastClosedEditor(): void {

		// Open editor if we have one
		const lastClosedEditor = this.recentlyClosedEditors.pop();
		if (lastClosedEditor) {
			this.doReopenLastClosedEditor(lastClosedEditor);
		}

		// Update context
		this.canReopenClosedEditorContextKey.set(this.recentlyClosedEditors.length > 0);
	}

	private async doReopenLastClosedEditor(lastClosedEditor: IRecentlyClosedEditor): Promise<void> {

		// Determine editor options
		let options: IEditorOptions;
		if (lastClosedEditor.sticky) {
			// Sticky: in case the target index is outside of the range of
			// sticky editors, we make sure to not provide the index as
			// option. Otherwise the index will cause the sticky flag to
			// be ignored.
			if (!this.editorGroupService.activeGroup.isSticky(lastClosedEditor.index)) {
				options = { pinned: true, sticky: true, ignoreError: true };
			} else {
				options = { pinned: true, sticky: true, index: lastClosedEditor.index, ignoreError: true };
			}
		} else {
			options = { pinned: true, index: lastClosedEditor.index, ignoreError: true };
		}

		// Deserialize and open editor unless already opened
		const restoredEditor = this.editorInputFactory.getEditorInputFactory(lastClosedEditor.serialized.typeId)?.deserialize(this.instantiationService, lastClosedEditor.serialized.value);
		let editorPane: IEditorPane | undefined = undefined;
		if (restoredEditor && !this.editorGroupService.activeGroup.isOpened(restoredEditor)) {
			// Fix for https://github.com/microsoft/vscode/issues/107850
			// If opening an editor fails, it is possible that we get
			// another editor-close event as a result. But we really do
			// want to ignore that in our list of recently closed editors
			//  to prevent endless loops.
			this.ignoreEditorCloseEvent = true;
			try {
				editorPane = await this.editorService.openEditor(restoredEditor, options);
			} finally {
				this.ignoreEditorCloseEvent = false;
			}
		}

		// If no editor was opened, try with the next one
		if (!editorPane) {
			// Fix for https://github.com/microsoft/vscode/issues/67882
			// If opening of the editor fails, make sure to try the next one
			// but make sure to remove this one from the list to prevent
			// endless loops.
			remove(this.recentlyClosedEditors, lastClosedEditor);

			// Try with next one
			this.reopenLastClosedEditor();
		}
	}

	private removeFromRecentlyClosedEditors(arg1: IEditorInput | IResourceEditorInput | FileChangesEvent): void {
		this.recentlyClosedEditors = this.recentlyClosedEditors.filter(recentlyClosedEditor => {
			if (recentlyClosedEditor.resource && this.matchesFile(recentlyClosedEditor.resource, arg1)) {
				return false; // editor matches directly
			}

			if (recentlyClosedEditor.associatedResources.some(associatedResource => this.matchesFile(associatedResource, arg1))) {
				return false; // an associated resource matches
			}

			return true;
		});

		// Update context
		this.canReopenClosedEditorContextKey.set(this.recentlyClosedEditors.length > 0);
	}

	//#endregion

	//#region Last Edit Location

	private lastEditLocation: IStackEntry | undefined;

	private rememberLastEditLocation(activeEditor: IEditorInput, activeTextEditorControl: ICodeEditor): void {
		this.lastEditLocation = { input: activeEditor };
		this.canNavigateToLastEditLocationContextKey.set(true);

		const position = activeTextEditorControl.getPosition();
		if (position) {
			this.lastEditLocation.selection = new Selection(position.lineNumber, position.column, position.lineNumber, position.column);
		}
	}

	openLastEditLocation(): void {
		if (this.lastEditLocation) {
			this.doNavigate(this.lastEditLocation);
		}
	}

	//#endregion

	//#region Context Keys

	private readonly canNavigateBackContextKey = (new RawContextKey<boolean>('canNavigateBack', false)).bindTo(this.contextKeyService);
	private readonly canNavigateForwardContextKey = (new RawContextKey<boolean>('canNavigateForward', false)).bindTo(this.contextKeyService);
	private readonly canNavigateToLastEditLocationContextKey = (new RawContextKey<boolean>('canNavigateToLastEditLocation', false)).bindTo(this.contextKeyService);
	private readonly canReopenClosedEditorContextKey = (new RawContextKey<boolean>('canReopenClosedEditor', false)).bindTo(this.contextKeyService);

	private updateContextKeys(): void {
		this.contextKeyService.bufferChangeEvents(() => {
			this.canNavigateBackContextKey.set(this.navigationStack.length > 0 && this.navigationStackIndex > 0);
			this.canNavigateForwardContextKey.set(this.navigationStack.length > 0 && this.navigationStackIndex < this.navigationStack.length - 1);
			this.canNavigateToLastEditLocationContextKey.set(!!this.lastEditLocation);
			this.canReopenClosedEditorContextKey.set(this.recentlyClosedEditors.length > 0);
		});
	}

	//#endregion

	//#region History

	private static readonly MAX_HISTORY_ITEMS = 200;
	private static readonly HISTORY_STORAGE_KEY = 'history.entries';

	private history: Array<IEditorInput | IResourceEditorInput> | undefined = undefined;

	private readonly resourceExcludeMatcher = this._register(new IdleValue(() => {
		const matcher = this._register(this.instantiationService.createInstance(
			ResourceGlobMatcher,
			root => getExcludes(root ? this.configurationService.getValue<ISearchConfiguration>({ resource: root }) : this.configurationService.getValue<ISearchConfiguration>()) || Object.create(null),
			event => event.affectsConfiguration(FILES_EXCLUDE_CONFIG) || event.affectsConfiguration(SEARCH_EXCLUDE_CONFIG)
		));

		this._register(matcher.onExpressionChange(() => this.removeExcludedFromHistory()));

		return matcher;
	}));

	private handleEditorEventInHistory(editor?: IEditorPane): void {

		// Ensure we have not configured to exclude input and don't track invalid inputs
		const input = editor?.input;
		if (!input || input.isDisposed() || !this.include(input)) {
			return;
		}

		const historyInput = this.preferResourceEditorInput(input);

		// Remove any existing entry and add to the beginning
		this.ensureHistoryLoaded(this.history);
		this.removeFromHistory(input);
		this.history.unshift(historyInput);

		// Respect max entries setting
		if (this.history.length > HistoryService.MAX_HISTORY_ITEMS) {
			this.clearOnEditorDispose(this.history.pop()!, this.editorHistoryListeners);
		}

		// Remove this from the history unless the history input is a resource
		// that can easily be restored even when the input gets disposed
		if (historyInput instanceof EditorInput) {
			this.onEditorDispose(historyInput, () => this.removeFromHistory(historyInput), this.editorHistoryListeners);
		}
	}

	private include(input: IEditorInput | IResourceEditorInput): boolean {
		if (input instanceof EditorInput) {
			return true; // include any non files
		}

		const resourceEditorInput = input as IResourceEditorInput;

		return !this.resourceExcludeMatcher.value.matches(resourceEditorInput.resource);
	}

	private removeExcludedFromHistory(): void {
		this.ensureHistoryLoaded(this.history);

		this.history = this.history.filter(e => {
			const include = this.include(e);

			// Cleanup any listeners associated with the input when removing from history
			if (!include) {
				this.clearOnEditorDispose(e, this.editorHistoryListeners);
			}

			return include;
		});
	}

	private removeFromHistory(arg1: IEditorInput | IResourceEditorInput | FileChangesEvent): void {
		this.ensureHistoryLoaded(this.history);

		this.history = this.history.filter(e => {
			const matches = this.matches(arg1, e);

			// Cleanup any listeners associated with the input when removing from history
			if (matches) {
				this.clearOnEditorDispose(arg1, this.editorHistoryListeners);
			}

			return !matches;
		});
	}

	clearRecentlyOpened(): void {
		this.history = [];

		this.editorHistoryListeners.forEach(listeners => dispose(listeners));
		this.editorHistoryListeners.clear();
	}

	getHistory(): ReadonlyArray<IEditorInput | IResourceEditorInput> {
		this.ensureHistoryLoaded(this.history);

		return this.history.slice(0);
	}

	private ensureHistoryLoaded(history: Array<IEditorInput | IResourceEditorInput> | undefined): asserts history {
		if (!this.history) {
			this.history = this.loadHistory();
		}
	}

	private loadHistory(): Array<IEditorInput | IResourceEditorInput> {
		let entries: ISerializedEditorHistoryEntry[] = [];

		const entriesRaw = this.storageService.get(HistoryService.HISTORY_STORAGE_KEY, StorageScope.WORKSPACE);
		if (entriesRaw) {
			try {
				entries = coalesce(JSON.parse(entriesRaw));
			} catch (error) {
				onUnexpectedError(error); // https://github.com/microsoft/vscode/issues/99075
			}
		}

		return coalesce(entries.map(entry => {
			try {
				return this.safeLoadHistoryEntry(entry);
			} catch (error) {
				return undefined; // https://github.com/microsoft/vscode/issues/60960
			}
		}));
	}

	private safeLoadHistoryEntry(entry: ISerializedEditorHistoryEntry): IEditorInput | IResourceEditorInput | undefined {
		const serializedEditorHistoryEntry = entry;

		// File resource: via URI.revive()
		if (serializedEditorHistoryEntry.resourceJSON) {
			return { resource: URI.revive(<UriComponents>serializedEditorHistoryEntry.resourceJSON) };
		}

		// Editor input: via factory
		const { editorInputJSON } = serializedEditorHistoryEntry;
		if (editorInputJSON?.deserialized) {
			const factory = this.editorInputFactory.getEditorInputFactory(editorInputJSON.typeId);
			if (factory) {
				const input = factory.deserialize(this.instantiationService, editorInputJSON.deserialized);
				if (input) {
					this.onEditorDispose(input, () => this.removeFromHistory(input), this.editorHistoryListeners);
				}

				return withNullAsUndefined(input);
			}
		}

		return undefined;
	}

	private saveState(): void {
		if (!this.history) {
			return; // nothing to save because history was not used
		}

		const entries: ISerializedEditorHistoryEntry[] = coalesce(this.history.map((input): ISerializedEditorHistoryEntry | undefined => {

			// Editor input: try via factory
			if (input instanceof EditorInput) {
				const factory = this.editorInputFactory.getEditorInputFactory(input.getTypeId());
				if (factory) {
					const deserialized = factory.serialize(input);
					if (deserialized) {
						return { editorInputJSON: { typeId: input.getTypeId(), deserialized } };
					}
				}
			}

			// File resource: via URI.toJSON()
			else {
				return { resourceJSON: (input as IResourceEditorInput).resource.toJSON() };
			}

			return undefined;
		}));

		this.storageService.store(HistoryService.HISTORY_STORAGE_KEY, JSON.stringify(entries), StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	//#endregion

	//#region Last Active Workspace/File

	getLastActiveWorkspaceRoot(schemeFilter?: string): URI | undefined {

		// No Folder: return early
		const folders = this.contextService.getWorkspace().folders;
		if (folders.length === 0) {
			return undefined;
		}

		// Single Folder: return early
		if (folders.length === 1) {
			const resource = folders[0].uri;
			if (!schemeFilter || resource.scheme === schemeFilter) {
				return resource;
			}

			return undefined;
		}

		// Multiple folders: find the last active one
		for (const input of this.getHistory()) {
			if (input instanceof EditorInput) {
				continue;
			}

			const resourceEditorInput = input as IResourceEditorInput;
			if (schemeFilter && resourceEditorInput.resource.scheme !== schemeFilter) {
				continue;
			}

			const resourceWorkspace = this.contextService.getWorkspaceFolder(resourceEditorInput.resource);
			if (resourceWorkspace) {
				return resourceWorkspace.uri;
			}
		}

		// fallback to first workspace matching scheme filter if any
		for (const folder of folders) {
			const resource = folder.uri;
			if (!schemeFilter || resource.scheme === schemeFilter) {
				return resource;
			}
		}

		return undefined;
	}

	getLastActiveFile(filterByScheme: string): URI | undefined {
		for (const input of this.getHistory()) {
			let resource: URI | undefined;
			if (input instanceof EditorInput) {
				resource = EditorResourceAccessor.getOriginalUri(input, { filterByScheme });
			} else {
				resource = (input as IResourceEditorInput).resource;
			}

			if (resource?.scheme === filterByScheme) {
				return resource;
			}
		}

		return undefined;
	}

	//#endregion

	//#region Editor Most Recently Used History

	private recentlyUsedEditorsStack: ReadonlyArray<IEditorIdentifier> | undefined = undefined;
	private recentlyUsedEditorsStackIndex = 0;

	private recentlyUsedEditorsInGroupStack: ReadonlyArray<IEditorIdentifier> | undefined = undefined;
	private recentlyUsedEditorsInGroupStackIndex = 0;

	private navigatingInRecentlyUsedEditorsStack = false;
	private navigatingInRecentlyUsedEditorsInGroupStack = false;

	openNextRecentlyUsedEditor(groupId?: GroupIdentifier): void {
		const [stack, index] = this.ensureRecentlyUsedStack(index => index - 1, groupId);

		this.doNavigateInRecentlyUsedEditorsStack(stack[index], groupId);
	}

	openPreviouslyUsedEditor(groupId?: GroupIdentifier): void {
		const [stack, index] = this.ensureRecentlyUsedStack(index => index + 1, groupId);

		this.doNavigateInRecentlyUsedEditorsStack(stack[index], groupId);
	}

	private doNavigateInRecentlyUsedEditorsStack(editorIdentifier: IEditorIdentifier | undefined, groupId?: GroupIdentifier): void {
		if (editorIdentifier) {
			const acrossGroups = typeof groupId !== 'number' || !this.editorGroupService.getGroup(groupId);

			if (acrossGroups) {
				this.navigatingInRecentlyUsedEditorsStack = true;
			} else {
				this.navigatingInRecentlyUsedEditorsInGroupStack = true;
			}

			this.editorService.openEditor(editorIdentifier.editor, undefined, editorIdentifier.groupId).finally(() => {
				if (acrossGroups) {
					this.navigatingInRecentlyUsedEditorsStack = false;
				} else {
					this.navigatingInRecentlyUsedEditorsInGroupStack = false;
				}
			});
		}
	}

	private ensureRecentlyUsedStack(indexModifier: (index: number) => number, groupId?: GroupIdentifier): [ReadonlyArray<IEditorIdentifier>, number] {
		let editors: ReadonlyArray<IEditorIdentifier>;
		let index: number;

		const group = typeof groupId === 'number' ? this.editorGroupService.getGroup(groupId) : undefined;

		// Across groups
		if (!group) {
			editors = this.recentlyUsedEditorsStack || this.editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE);
			index = this.recentlyUsedEditorsStackIndex;
		}

		// Within group
		else {
			editors = this.recentlyUsedEditorsInGroupStack || group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).map(editor => ({ groupId: group.id, editor }));
			index = this.recentlyUsedEditorsInGroupStackIndex;
		}

		// Adjust index
		let newIndex = indexModifier(index);
		if (newIndex < 0) {
			newIndex = 0;
		} else if (newIndex > editors.length - 1) {
			newIndex = editors.length - 1;
		}

		// Remember index and editors
		if (!group) {
			this.recentlyUsedEditorsStack = editors;
			this.recentlyUsedEditorsStackIndex = newIndex;
		} else {
			this.recentlyUsedEditorsInGroupStack = editors;
			this.recentlyUsedEditorsInGroupStackIndex = newIndex;
		}

		return [editors, newIndex];
	}

	private handleEditorEventInRecentEditorsStack(): void {

		// Drop all-editors stack unless navigating in all editors
		if (!this.navigatingInRecentlyUsedEditorsStack) {
			this.recentlyUsedEditorsStack = undefined;
			this.recentlyUsedEditorsStackIndex = 0;
		}

		// Drop in-group-editors stack unless navigating in group
		if (!this.navigatingInRecentlyUsedEditorsInGroupStack) {
			this.recentlyUsedEditorsInGroupStack = undefined;
			this.recentlyUsedEditorsInGroupStackIndex = 0;
		}
	}

	//#endregion
}

registerSingleton(IHistoryService, HistoryService);
