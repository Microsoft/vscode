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
import { extname } from 'vs/base/common/resources';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { EditorOverride } from 'vs/platform/editor/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { EditorOptions, IEditorInput, IEditorMemento, IEditorOpenContext } from 'vs/workbench/common/editor';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/common/notebookEditorInput';
import { NotebookEditorWidget } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { INotebookEditorViewState, NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { IEditorDropService } from 'vs/workbench/services/editor/browser/editorDropService';
import { IEditorGroup, IEditorGroupsService, GroupsOrder } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { NotebookEditorOptions, NOTEBOOK_EDITOR_ID } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IBorrowValue, INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/notebookEditorService';
import { clearMarks, getAndClearMarks, mark } from 'vs/workbench/contrib/notebook/common/notebookPerformance';
import { IFileService } from 'vs/platform/files/common/files';

const NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY = 'NotebookEditorViewState';

export class NotebookEditor extends EditorPane {
	static readonly ID: string = NOTEBOOK_EDITOR_ID;

	private readonly _editorMemento: IEditorMemento<INotebookEditorViewState>;
	private readonly _groupListener = this._register(new DisposableStore());
	private readonly _widgetDisposableStore: DisposableStore = new DisposableStore();
	private _widget: IBorrowValue<NotebookEditorWidget> = { value: undefined };
	private _rootElement!: HTMLElement;
	private _dimension?: DOM.Dimension;

	// todo@rebornix is there a reason that `super.fireOnDidFocus` isn't used?
	private readonly _onDidFocusWidget = this._register(new Emitter<void>());
	override get onDidFocus(): Event<void> { return this._onDidFocusWidget.event; }

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
		@INotebookEditorService private readonly _notebookWidgetService: INotebookEditorService,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IFileService private readonly fileService: IFileService,
	) {
		super(NotebookEditor.ID, telemetryService, themeService, storageService);
		this._editorMemento = this.getEditorMemento<INotebookEditorViewState>(_editorGroupService, NOTEBOOK_EDITOR_VIEW_STATE_PREFERENCE_KEY);

		this._register(this.fileService.onDidChangeFileSystemProviderCapabilities(e => this.onDidFileSystemProviderChange(e.scheme)));
		this._register(this.fileService.onDidChangeFileSystemProviderRegistrations(e => this.onDidFileSystemProviderChange(e.scheme)));
	}

	private onDidFileSystemProviderChange(scheme: string): void {
		if (this.input?.resource?.scheme === scheme && this._widget.value) {
			this._widget.value.setOptions(new NotebookEditorOptions({ isReadOnly: this.input.isReadonly() }));
		}
	}

	get viewModel(): NotebookViewModel | undefined {
		return this._widget.value?.viewModel;
	}

	override get minimumWidth(): number { return 375; }
	override get maximumWidth(): number { return Number.POSITIVE_INFINITY; }

	// these setters need to exist because this extends from EditorPane
	override set minimumWidth(value: number) { /*noop*/ }
	override set maximumWidth(value: number) { /*noop*/ }

	//#region Editor Core
	override get scopedContextKeyService(): IContextKeyService | undefined {
		return this._widget.value?.scopedContextKeyService;
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

	override getControl(): NotebookEditorWidget | undefined {
		return this._widget.value;
	}

	override setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
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

	override focus() {
		super.focus();
		this._widget.value?.focus();
	}

	override hasFocus(): boolean {
		const activeElement = document.activeElement;
		const value = this._widget.value;

		return !!value && (DOM.isAncestor(activeElement, value.getDomNode() || DOM.isAncestor(activeElement, value.getOverflowContainerDomNode())));
	}

	override async setInput(input: NotebookEditorInput, options: EditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		clearMarks(input.resource);
		mark(input.resource, 'startTime');
		const group = this.group!;

		this._saveEditorViewState(this.input);

		this._widgetDisposableStore.clear();

		// there currently is a widget which we still own so
		// we need to hide it before getting a new widget
		if (this._widget.value) {
			this._widget.value.onWillHide();
		}

		this._widget = this.instantiationService.invokeFunction(this._notebookWidgetService.retrieveWidget, group, input);
		this._widgetDisposableStore.add(this._widget.value!.onDidChangeModel(() => this._onDidChangeModel.fire()));

		if (this._dimension) {
			this._widget.value!.layout(this._dimension, this._rootElement);
		}

		// only now `setInput` and yield/await. this is AFTER the actual widget is ready. This is very important
		// so that others synchronously receive a notebook editor with the correct widget being set
		await super.setInput(input, options, context, token);
		const model = await input.resolve();
		mark(input.resource, 'inputLoaded');

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
						await this._editorService.openEditor({ resource: input.resource, forceFile: true, options: { ...options, override: EditorOverride.DISABLED } });
					}
				}]
			);
			return;
		}



		const viewState = this._loadNotebookEditorViewState(input);

		this._widget.value?.setParentContextKeyService(this._contextKeyService);
		await this._widget.value!.setModel(model.notebook, viewState);
		const isReadonly = input.isReadonly();
		await this._widget.value!.setOptions(options instanceof NotebookEditorOptions ? options.with({ isReadOnly: isReadonly }) : new NotebookEditorOptions({ isReadOnly: isReadonly }));
		this._widgetDisposableStore.add(this._widget.value!.onDidFocus(() => this._onDidFocusWidget.fire()));

		this._widgetDisposableStore.add(this._editorDropService.createEditorDropTarget(this._widget.value!.getDomNode(), {
			containsGroup: (group) => this.group?.id === group.id
		}));

		mark(input.resource, 'editorLoaded');

		type WorkbenchNotebookOpenClassification = {
			scheme: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			ext: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			viewType: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			extensionActivated: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			inputLoaded: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			webviewCommLoaded: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			customMarkdownLoaded: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
			editorLoaded: { classification: 'SystemMetaData', purpose: 'FeatureInsight'; };
		};

		type WorkbenchNotebookOpenEvent = {
			scheme: string;
			ext: string;
			viewType: string;
			extensionActivated: number;
			inputLoaded: number;
			webviewCommLoaded: number;
			customMarkdownLoaded: number;
			editorLoaded: number;
		};

		const perfMarks = getAndClearMarks(input.resource);

		if (perfMarks) {
			const startTime = perfMarks['startTime'];
			const extensionActivated = perfMarks['extensionActivated'];
			const inputLoaded = perfMarks['inputLoaded'];
			const webviewCommLoaded = perfMarks['webviewCommLoaded'];
			const customMarkdownLoaded = perfMarks['customMarkdownLoaded'];
			const editorLoaded = perfMarks['editorLoaded'];

			if (
				startTime !== undefined
				&& extensionActivated !== undefined
				&& inputLoaded !== undefined
				&& webviewCommLoaded !== undefined
				&& customMarkdownLoaded !== undefined
				&& editorLoaded !== undefined
			) {
				this.telemetryService.publicLog2<WorkbenchNotebookOpenEvent, WorkbenchNotebookOpenClassification>('notebook/editorOpenPerf', {
					scheme: model.notebook.uri.scheme,
					ext: extname(model.notebook.uri),
					viewType: model.notebook.viewType,
					extensionActivated: extensionActivated - startTime,
					inputLoaded: inputLoaded - startTime,
					webviewCommLoaded: webviewCommLoaded - startTime,
					customMarkdownLoaded: customMarkdownLoaded - startTime,
					editorLoaded: editorLoaded - startTime
				});
			}
		}
	}

	override clearInput(): void {
		if (this._widget.value) {
			this._saveEditorViewState(this.input);
			this._widget.value.onWillHide();
		}
		super.clearInput();
	}

	override setOptions(options: EditorOptions | undefined): void {
		if (options instanceof NotebookEditorOptions) {
			this._widget.value?.setOptions(options);
		}
		super.setOptions(options);
	}

	protected override saveState(): void {
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

	override dispose() {
		super.dispose();
	}

	// toJSON(): object {
	// 	return {
	// 		notebookHandle: this.viewModel?.handle
	// 	};
	// }
}
