/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import 'vs/css!./media/notebook';
import { localize } from 'vs/nls';
import { IEditorOptions, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorOptions, IEditorInput, IEditorMemento } from 'vs/workbench/common/editor';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/browser/notebookEditorInput';
import { NotebookEditorOptions, NotebookEditorWidget } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { IBorrowValue, INotebookEditorWidgetService } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidgetService';
import { INotebookEditorViewState, NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { IEditorDropService } from 'vs/workbench/services/editor/browser/editorDropService';
import { IEditorGroup, IEditorGroupsService, GroupsOrder } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

const NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY = 'NotebookEditorViewState';

export class NotebookEditor extends BaseEditor {
	static readonly ID: string = 'workbench.editor.notebook';

	private readonly _editorMemento: IEditorMemento<INotebookEditorViewState>;
	private readonly _groupListener = this._register(new DisposableStore());
	private readonly _widgetDisposableStore: DisposableStore = new DisposableStore();
	private _widget: IBorrowValue<NotebookEditorWidget> = { value: undefined };
	private _rootElement!: HTMLElement;
	private _dimension?: DOM.Dimension;

	// todo@rebornix is there a reason that `super.fireOnDidFocus` isn't used?
	private readonly _onDidFocusWidget = this._register(new Emitter<void>());
	get onDidFocus(): Event<void> { return this._onDidFocusWidget.event; }

	private readonly _onDidChangeModel = this._register(new Emitter<void>());
	readonly onDidChangeModel: Event<void> = this._onDidChangeModel.event;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService,
		@IEditorDropService private readonly _editorDropService: IEditorDropService,
		@INotificationService private readonly _notificationService: INotificationService,
		@INotebookEditorWidgetService private readonly _notebookWidgetService: INotebookEditorWidgetService,
	) {
		super(NotebookEditor.ID, telemetryService, themeService, storageService);
		this._editorMemento = this.getEditorMemento<INotebookEditorViewState>(_editorGroupService, NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY);
	}

	set viewModel(newModel: NotebookViewModel | undefined) {
		if (this._widget.value) {
			this._widget.value.viewModel = newModel;
			this._onDidChangeModel.fire();
		}
	}

	get viewModel() {
		return this._widget.value?.viewModel;
	}

	get minimumWidth(): number { return 375; }
	get maximumWidth(): number { return Number.POSITIVE_INFINITY; }

	// these setters need to exist because this extends from BaseEditor
	set minimumWidth(value: number) { /*noop*/ }
	set maximumWidth(value: number) { /*noop*/ }

	//#region Editor Core

	get isNotebookEditor() {
		return true;
	}

	protected createEditor(parent: HTMLElement): void {
		this._rootElement = DOM.append(parent, DOM.$('.notebook-editor'));

		// this._widget.createEditor();
		this._register(this.onDidFocus(() => this._widget.value?.updateEditorFocus()));
		this._register(this.onDidBlur(() => this._widget.value?.updateEditorFocus()));
	}

	getDomNode() {
		return this._rootElement;
	}

	getControl(): NotebookEditorWidget | undefined {
		return this._widget.value;
	}

	setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		super.setEditorVisible(visible, group);
		if (group) {
			this._groupListener.clear();
			this._groupListener.add(group.onWillCloseEditor(e => this._saveEditorViewState(e.editor)));
			this._groupListener.add(group.onDidGroupChange(() => {
				if (this._editorGroupService.activeGroup !== group) {
					this._widget?.value?.updateEditorFocus();
				}
			}));
		}

		if (!visible) {
			this._saveEditorViewState(this.input);
			if (this.input && this._widget.value) {
				// the widget is not transfered to other editor inputs
				this._widget.value.onWillHide();
			}
		}
	}

	focus() {
		super.focus();
		this._widget.value?.focus();
	}

	async setInput(input: NotebookEditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {

		const group = this.group!;

		this._saveEditorViewState(this.input);
		await super.setInput(input, options, token);

		// Check for cancellation
		if (token.isCancellationRequested) {
			return undefined;
		}

		this._widgetDisposableStore.clear();

		// there currently is a widget which we still own so
		// we need to hide it before getting a new widget
		if (this._widget.value) {
			this._widget.value.onWillHide();
		}

		this._widget = this.instantiationService.invokeFunction(this._notebookWidgetService.retrieveWidget, group, input);

		if (this._dimension) {
			this._widget.value!.layout(this._dimension, this._rootElement);
		}

		const model = await input.resolve(this._widget.value!.getId());
		// Check for cancellation
		if (token.isCancellationRequested) {
			return undefined;
		}

		if (model === null) {
			this._notificationService.prompt(
				Severity.Error,
				localize('fail.noEditor', "Cannot open resource with notebook editor type '{0}', please check if you have the right extension installed or enabled.", input.viewType),
				[{
					label: localize('fail.reOpen', "Reopen file with VS Code standard text editor"),
					run: async () => {
						const fileEditorInput = this._editorService.createEditorInput({ resource: input.resource, forceFile: true });
						const textOptions: IEditorOptions | ITextEditorOptions = options ? { ...options, override: false } : { override: false };
						await this._editorService.openEditor(fileEditorInput, textOptions);
					}
				}]
			);
			return;
		}

		const viewState = this._loadNotebookEditorViewState(input);

		await this._widget.value!.setModel(model.notebook, viewState);
		await this._widget.value!.setOptions(options instanceof NotebookEditorOptions ? options : undefined);
		this._widgetDisposableStore.add(this._widget.value!.onDidFocus(() => this._onDidFocusWidget.fire()));

		this._widgetDisposableStore.add(this._editorDropService.createEditorDropTarget(this._widget.value!.getDomNode(), {
			containsGroup: (group) => this.group?.id === group.group.id
		}));
	}

	clearInput(): void {
		if (this._widget.value) {
			this._saveEditorViewState(this.input);
			this._widget.value.onWillHide();
		}
		super.clearInput();
	}

	setOptions(options: EditorOptions | undefined): void {
		if (options instanceof NotebookEditorOptions) {
			this._widget.value?.setOptions(options);
		}
		super.setOptions(options);
	}

	protected saveState(): void {
		this._saveEditorViewState(this.input);
		super.saveState();
	}

	private _saveEditorViewState(input: IEditorInput | undefined): void {
		if (this.group && this._widget.value && input instanceof NotebookEditorInput) {
			if (this._widget.value.isDisposed) {
				return;
			}

			const state = this._widget.value.getEditorViewState();
			this._editorMemento.saveEditorState(this.group, input.resource, state);
		}
	}

	private _loadNotebookEditorViewState(input: NotebookEditorInput): INotebookEditorViewState | undefined {
		let result: INotebookEditorViewState | undefined;
		if (this.group) {
			result = this._editorMemento.loadEditorState(this.group, input.resource);
		}
		if (result) {
			return result;
		}
		// when we don't have a view state for the group/input-tuple then we try to use an existing
		// editor for the same resource.
		for (const group of this._editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			if (group.activeEditorPane !== this && group.activeEditorPane instanceof NotebookEditor && group.activeEditor?.matches(input)) {
				return group.activeEditorPane._widget.value?.getEditorViewState();
			}
		}
		return;
	}

	layout(dimension: DOM.Dimension): void {
		this._rootElement.classList.toggle('mid-width', dimension.width < 1000 && dimension.width >= 600);
		this._rootElement.classList.toggle('narrow-width', dimension.width < 600);
		this._dimension = dimension;

		if (!this._widget.value || !(this._input instanceof NotebookEditorInput)) {
			return;
		}

		if (this._input.resource.toString() !== this._widget.value.viewModel?.uri.toString() && this._widget.value?.viewModel) {
			// input and widget mismatch
			// this happens when
			// 1. open document A, pin the document
			// 2. open document B
			// 3. close document B
			// 4. a layout is triggered
			return;
		}

		this._widget.value.layout(this._dimension, this._rootElement);
	}

	//#endregion

	//#region Editor Features

	//#endregion

	dispose() {
		super.dispose();
	}

	toJSON(): object {
		return {
			notebookHandle: this.viewModel?.handle
		};
	}
}
