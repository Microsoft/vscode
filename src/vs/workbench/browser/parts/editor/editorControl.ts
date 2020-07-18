/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { EditorInput, EditorOptions, IVisibleEditorPane } from 'vs/workbench/common/editor';
import { Dimension, show, hide, addClass } from 'vs/base/browser/dom';
import { Registry } from 'vs/platform/registry/common/platform';
import { IEditorRegistry, Extensions as EditorExtensions, IEditorDescriptor } from 'vs/workbench/browser/editor';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorProgressService, LongRunningOperation } from 'vs/platform/progress/common/progress';
import { IEditorGroupView, DEFAULT_EDITOR_MIN_DIMENSIONS, DEFAULT_EDITOR_MAX_DIMENSIONS } from 'vs/workbench/browser/parts/editor/editor';
import { Emitter } from 'vs/base/common/event';
import { assertIsDefined } from 'vs/base/common/types';

export interface IOpenEditorResult {
	readonly editorPane: BaseEditor;
	readonly editorChanged: boolean;
}

export class EditorControl extends Disposable {

	get minimumWidth() { return this._activeEditorPane?.minimumWidth ?? DEFAULT_EDITOR_MIN_DIMENSIONS.width; }
	get minimumHeight() { return this._activeEditorPane?.minimumHeight ?? DEFAULT_EDITOR_MIN_DIMENSIONS.height; }
	get maximumWidth() { return this._activeEditorPane?.maximumWidth ?? DEFAULT_EDITOR_MAX_DIMENSIONS.width; }
	get maximumHeight() { return this._activeEditorPane?.maximumHeight ?? DEFAULT_EDITOR_MAX_DIMENSIONS.height; }

	private readonly _onDidFocus = this._register(new Emitter<void>());
	readonly onDidFocus = this._onDidFocus.event;

	private _onDidSizeConstraintsChange = this._register(new Emitter<{ width: number; height: number; } | undefined>());
	readonly onDidSizeConstraintsChange = this._onDidSizeConstraintsChange.event;

	private _activeEditorPane: BaseEditor | null = null;
	get activeEditorPane(): IVisibleEditorPane | null { return this._activeEditorPane as IVisibleEditorPane | null; }

	private readonly editorPanes: BaseEditor[] = [];

	private readonly activeEditorPaneDisposables = this._register(new DisposableStore());
	private dimension: Dimension | undefined;
	private readonly editorOperation = this._register(new LongRunningOperation(this.editorProgressService));

	constructor(
		private parent: HTMLElement,
		private groupView: IEditorGroupView,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEditorProgressService private readonly editorProgressService: IEditorProgressService
	) {
		super();
	}

	async openEditor(editor: EditorInput, options?: EditorOptions): Promise<IOpenEditorResult> {

		// Editor pane
		const descriptor = Registry.as<IEditorRegistry>(EditorExtensions.Editors).getEditor(editor);
		if (!descriptor) {
			throw new Error(`No editor descriptor found for input id ${editor.getTypeId()}`);
		}
		const editorPane = this.doShowEditorPane(descriptor);

		// Set input
		const editorChanged = await this.doSetInput(editorPane, editor, options);
		return { editorPane, editorChanged };
	}

	private doShowEditorPane(descriptor: IEditorDescriptor): BaseEditor {

		// Return early if the currently active editor pane can handle the input
		if (this._activeEditorPane && descriptor.describes(this._activeEditorPane)) {
			return this._activeEditorPane;
		}

		// Hide active one first
		this.doHideActiveEditorPane();

		// Create editor pane
		const editorPane = this.doCreateEditorPane(descriptor);

		// Set editor as active
		this.doSetActiveEditorPane(editorPane);

		// Show editor
		const container = assertIsDefined(editorPane.getContainer());
		this.parent.appendChild(container);
		show(container);

		// Indicate to editor that it is now visible
		editorPane.setVisible(true, this.groupView);

		// Layout
		if (this.dimension) {
			editorPane.layout(this.dimension);
		}

		return editorPane;
	}

	private doCreateEditorPane(descriptor: IEditorDescriptor): BaseEditor {

		// Instantiate editor
		const editorPane = this.doInstantiateEditorPane(descriptor);

		// Create editor container as needed
		if (!editorPane.getContainer()) {
			const editorPaneContainer = document.createElement('div');
			addClass(editorPaneContainer, 'editor-instance');
			editorPaneContainer.setAttribute('data-editor-id', descriptor.getId());

			editorPane.create(editorPaneContainer);
		}

		return editorPane;
	}

	private doInstantiateEditorPane(descriptor: IEditorDescriptor): BaseEditor {

		// Return early if already instantiated
		const existingEditorPane = this.editorPanes.find(editorPane => descriptor.describes(editorPane));
		if (existingEditorPane) {
			return existingEditorPane;
		}

		// Otherwise instantiate new
		const editorPane = this._register(descriptor.instantiate(this.instantiationService));
		this.editorPanes.push(editorPane);

		return editorPane;
	}

	private doSetActiveEditorPane(editorPane: BaseEditor | null) {
		this._activeEditorPane = editorPane;

		// Clear out previous active editor pane listeners
		this.activeEditorPaneDisposables.clear();

		// Listen to editor pane changes
		if (editorPane) {
			this.activeEditorPaneDisposables.add(editorPane.onDidSizeConstraintsChange(e => this._onDidSizeConstraintsChange.fire(e)));
			this.activeEditorPaneDisposables.add(editorPane.onDidFocus(() => this._onDidFocus.fire()));
		}

		// Indicate that size constraints could have changed due to new editor
		this._onDidSizeConstraintsChange.fire(undefined);
	}

	private async doSetInput(editorPane: BaseEditor, editor: EditorInput, options: EditorOptions | undefined): Promise<boolean> {

		// If the input did not change, return early and only apply the options
		// unless the options instruct us to force open it even if it is the same
		const forceReload = options?.forceReload;
		const inputMatches = editorPane.input && editorPane.input.matches(editor);
		if (inputMatches && !forceReload) {

			// Forward options
			editorPane.setOptions(options);

			// Still focus as needed
			const focus = !options || !options.preserveFocus;
			if (focus) {
				editorPane.focus();
			}

			return false;
		}

		// Show progress while setting input after a certain timeout. If the workbench is opening
		// be more relaxed about progress showing by increasing the delay a little bit to reduce flicker.
		const operation = this.editorOperation.start(this.layoutService.isRestored() ? 800 : 3200);

		// Call into editor pane
		const editorWillChange = !inputMatches;
		try {
			await editorPane.setInput(editor, options, operation.token);

			// Focus (unless prevented or another operation is running)
			if (operation.isCurrent()) {
				const focus = !options || !options.preserveFocus;
				if (focus) {
					editorPane.focus();
				}
			}

			return editorWillChange;
		} finally {
			operation.stop();
		}
	}

	private doHideActiveEditorPane(): void {
		if (!this._activeEditorPane) {
			return;
		}

		// Stop any running operation
		this.editorOperation.stop();

		// Indicate to editor pane before removing the editor from
		// the DOM to give a chance to persist certain state that
		// might depend on still being the active DOM element.
		this._activeEditorPane.clearInput();
		this._activeEditorPane.setVisible(false, this.groupView);

		// Remove editor pane from parent
		const editorPaneContainer = this._activeEditorPane.getContainer();
		if (editorPaneContainer) {
			this.parent.removeChild(editorPaneContainer);
			hide(editorPaneContainer);
		}

		// Clear active editor pane
		this.doSetActiveEditorPane(null);
	}

	closeEditor(editor: EditorInput): void {
		if (this._activeEditorPane && editor.matches(this._activeEditorPane.input)) {
			this.doHideActiveEditorPane();
		}
	}

	setVisible(visible: boolean): void {
		this._activeEditorPane?.setVisible(visible, this.groupView);
	}

	layout(dimension: Dimension): void {
		this.dimension = dimension;

		this._activeEditorPane?.layout(dimension);
	}
}
