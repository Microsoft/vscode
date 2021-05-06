/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { NotImplementedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ContextKeyService } from 'vs/platform/contextkey/browser/contextKeyService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IListService, ListService } from 'vs/platform/list/browser/listService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { EditorModel, IEditorInput } from 'vs/workbench/common/editor';
import { ICellViewModel, IActiveNotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { CellViewModel, NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellKind, CellUri, INotebookDiffEditorModel, INotebookEditorModel, IOutputDto, IResolvedNotebookEditorModel, NotebookCellMetadata, notebookDocumentMetadataDefaults } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookRange';
import { TextModelResolverService } from 'vs/workbench/services/textmodelResolver/common/textModelResolverService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { NotebookCellList } from 'vs/workbench/contrib/notebook/browser/view/notebookCellList';
import { ListViewInfoAccessor } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { mock } from 'vs/base/test/common/mock';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { BrowserClipboardService } from 'vs/platform/clipboard/browser/clipboardService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ModeServiceImpl } from 'vs/editor/common/services/modeServiceImpl';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { IWorkspaceTrustRequestService } from 'vs/platform/workspace/common/workspaceTrust';
import { TestWorkspaceTrustRequestService } from 'vs/workbench/services/workspaces/test/common/testWorkspaceTrustService';

export class TestCell extends NotebookCellTextModel {
	constructor(
		public viewType: string,
		handle: number,
		public source: string,
		language: string,
		cellKind: CellKind,
		outputs: IOutputDto[],
		modeService: IModeService,
	) {
		super(CellUri.generate(URI.parse('test:///fake/notebook'), handle), handle, source, language, cellKind, outputs, undefined, { transientCellMetadata: {}, transientDocumentMetadata: {}, transientOutputs: false }, modeService);
	}
}

export class NotebookEditorTestModel extends EditorModel implements INotebookEditorModel {
	private _dirty = false;

	protected readonly _onDidSave = this._register(new Emitter<void>());
	readonly onDidSave = this._onDidSave.event;

	protected readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;


	get viewType() {
		return this._notebook.viewType;
	}

	get resource() {
		return this._notebook.uri;
	}

	get notebook() {
		return this._notebook;
	}

	constructor(
		private _notebook: NotebookTextModel
	) {
		super();

		if (_notebook && _notebook.onDidChangeContent) {
			this._register(_notebook.onDidChangeContent(() => {
				this._dirty = true;
				this._onDidChangeDirty.fire();
				this._onDidChangeContent.fire();
			}));
		}
	}
	isReadonly(): boolean {
		return false;
	}

	isDirty() {
		return this._dirty;
	}

	getNotebook(): NotebookTextModel {
		return this._notebook;
	}

	async load(): Promise<IResolvedNotebookEditorModel> {
		return this;
	}

	async save(): Promise<boolean> {
		if (this._notebook) {
			this._dirty = false;
			this._onDidChangeDirty.fire();
			this._onDidSave.fire();
			// todo, flush all states
			return true;
		}

		return false;
	}

	saveAs(): Promise<IEditorInput | undefined> {
		throw new NotImplementedError();
	}

	revert(): Promise<void> {
		throw new NotImplementedError();
	}
}

export function setupInstantiationService() {
	const instantiationService = new TestInstantiationService();
	instantiationService.stub(IModeService, new ModeServiceImpl());
	instantiationService.stub(IUndoRedoService, instantiationService.createInstance(UndoRedoService));
	instantiationService.stub(IConfigurationService, new TestConfigurationService());
	instantiationService.stub(IThemeService, new TestThemeService());
	instantiationService.stub(IModelService, instantiationService.createInstance(ModelServiceImpl));
	instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
	instantiationService.stub(IContextKeyService, instantiationService.createInstance(ContextKeyService));
	instantiationService.stub(IListService, instantiationService.createInstance(ListService));
	instantiationService.stub(IClipboardService, new BrowserClipboardService());
	instantiationService.stub(ILogService, new NullLogService());
	instantiationService.stub(IStorageService, new TestStorageService());
	instantiationService.stub(IWorkspaceTrustRequestService, new TestWorkspaceTrustRequestService(true));

	return instantiationService;
}

function _createTestNotebookEditor(instantiationService: TestInstantiationService, cells: [source: string, lang: string, kind: CellKind, output?: IOutputDto[], metadata?: NotebookCellMetadata][]): IActiveNotebookEditor {

	const viewType = 'notebook';
	const notebook = instantiationService.createInstance(NotebookTextModel, viewType, URI.parse('test'), cells.map(cell => {
		return {
			source: cell[0],
			language: cell[1],
			cellKind: cell[2],
			outputs: cell[3] ?? [],
			metadata: cell[4]
		};
	}), notebookDocumentMetadataDefaults, { transientCellMetadata: {}, transientDocumentMetadata: {}, transientOutputs: false });

	const model = new NotebookEditorTestModel(notebook);
	const eventDispatcher = new NotebookEventDispatcher();
	const viewModel: NotebookViewModel = instantiationService.createInstance(NotebookViewModel, viewType, model.notebook, eventDispatcher, null);

	const cellList = createNotebookCellList(instantiationService);
	cellList.attachViewModel(viewModel);
	const listViewInfoAccessor = new ListViewInfoAccessor(cellList);

	const notebookEditor: IActiveNotebookEditor = new class extends mock<IActiveNotebookEditor>() {
		override dispose() {
			viewModel.dispose();
		}
		override onDidChangeModel: Event<NotebookTextModel | undefined> = new Emitter<NotebookTextModel | undefined>().event;
		override get viewModel() { return viewModel; }
		override get textModel() { return viewModel.notebookDocument; }
		override hasModel(): this is IActiveNotebookEditor {
			return !!this.viewModel;
		}
		override getFocus() { return viewModel.getFocus(); }
		override getSelections() { return viewModel.getSelections(); }
		override getViewIndex(cell: ICellViewModel) { return listViewInfoAccessor.getViewIndex(cell); }
		override getCellRangeFromViewRange(startIndex: number, endIndex: number) { return listViewInfoAccessor.getCellRangeFromViewRange(startIndex, endIndex); }
		override revealCellRangeInView() { }
		override setHiddenAreas(_ranges: ICellRange[]): boolean {
			return cellList.setHiddenAreas(_ranges, true);
		}
		override getActiveCell() {
			const elements = cellList.getFocusedElements();

			if (elements && elements.length) {
				return elements[0];
			}

			return undefined;
		}
		override hasOutputTextSelection() {
			return false;
		}
		override changeModelDecorations() { return null; }
		override focusElement() { }
		override setCellEditorSelection() { }
		override async revealRangeInCenterIfOutsideViewportAsync() { }
	};

	return notebookEditor;
}

export function createTestNotebookEditor(cells: [source: string, lang: string, kind: CellKind, output?: IOutputDto[], metadata?: NotebookCellMetadata][]): IActiveNotebookEditor {
	return _createTestNotebookEditor(setupInstantiationService(), cells);
}

export async function withTestNotebookDiffModel<R = any>(originalCells: [source: string, lang: string, kind: CellKind, output?: IOutputDto[], metadata?: NotebookCellMetadata][], modifiedCells: [source: string, lang: string, kind: CellKind, output?: IOutputDto[], metadata?: NotebookCellMetadata][], callback: (diffModel: INotebookDiffEditorModel, accessor: TestInstantiationService) => Promise<R> | R): Promise<R> {
	const instantiationService = setupInstantiationService();
	const originalNotebook = createTestNotebookEditor(originalCells);
	const modifiedNotebook = createTestNotebookEditor(modifiedCells);
	const originalResource = new class extends mock<IResolvedNotebookEditorModel>() {
		override get notebook() {
			return originalNotebook.viewModel.notebookDocument;
		}
	};

	const modifiedResource = new class extends mock<IResolvedNotebookEditorModel>() {
		override get notebook() {
			return modifiedNotebook.viewModel.notebookDocument;
		}
	};

	const model = new class extends mock<INotebookDiffEditorModel>() {
		override get original() {
			return originalResource;
		}
		override get modified() {
			return modifiedResource;
		}
	};

	const res = await callback(model, instantiationService);
	if (res instanceof Promise) {
		res.finally(() => {
			originalNotebook.dispose();
			modifiedNotebook.dispose();
		});
	} else {
		originalNotebook.dispose();
		modifiedNotebook.dispose();
	}
	return res;
}

export async function withTestNotebook<R = any>(cells: [source: string, lang: string, kind: CellKind, output?: IOutputDto[], metadata?: NotebookCellMetadata][], callback: (editor: IActiveNotebookEditor, accessor: TestInstantiationService) => Promise<R> | R): Promise<R> {
	const instantiationService = setupInstantiationService();
	const notebookEditor = _createTestNotebookEditor(instantiationService, cells);

	const res = await callback(notebookEditor, instantiationService);
	if (res instanceof Promise) {
		res.finally(() => notebookEditor.dispose());
	} else {
		notebookEditor.dispose();
	}
	return res;
}

export function createNotebookCellList(instantiationService: TestInstantiationService) {
	const delegate: IListVirtualDelegate<CellViewModel> = {
		getHeight(element: CellViewModel) { return element.getHeight(17); },
		getTemplateId() { return 'template'; }
	};

	const renderer: IListRenderer<number, void> = {
		templateId: 'template',
		renderTemplate() { },
		renderElement() { },
		disposeTemplate() { }
	};

	const cellList: NotebookCellList = instantiationService.createInstance(
		NotebookCellList,
		'NotebookCellList',
		DOM.$('container'),
		DOM.$('body'),
		delegate,
		[renderer],
		instantiationService.get<IContextKeyService>(IContextKeyService),
		{
			supportDynamicHeights: true,
			multipleSelectionSupport: true,
			enableKeyboardNavigation: true,
			focusNextPreviousDelegate: {
				onFocusNext: (applyFocusNext: () => void) => { applyFocusNext(); },
				onFocusPrevious: (applyFocusPrevious: () => void) => { applyFocusPrevious(); },
			}
		}
	);

	return cellList;
}
