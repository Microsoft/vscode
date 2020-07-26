/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { Range } from 'vs/editor/common/core/range';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { EditorModel } from 'vs/workbench/common/editor';
import { ICellRange, ICellViewModel, INotebookEditor, INotebookEditorContribution, INotebookEditorMouseEvent, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { CellViewModel, IModelDecorationsChangeAccessor, NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellKind, CellUri, INotebookEditorModel, IProcessedOutput, NotebookCellMetadata, INotebookKernelInfo } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Webview } from 'vs/workbench/contrib/webview/browser/webview';
import { ICompositeCodeEditor, IEditor } from 'vs/editor/common/editorCommon';
import { NotImplementedError } from 'vs/base/common/errors';
import { Schemas } from 'vs/base/common/network';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { TextModelResolverService } from 'vs/workbench/services/textmodelResolver/common/textModelResolverService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';

export class TestCell extends NotebookCellTextModel {
	constructor(
		public viewType: string,
		handle: number,
		public source: string[],
		language: string,
		cellKind: CellKind,
		outputs: IProcessedOutput[],
		modelService: ITextModelService
	) {
		super(CellUri.generate(URI.parse('test:///fake/notebook'), handle), handle, source, language, cellKind, outputs, undefined, modelService);
	}
}

export class TestNotebookEditor implements INotebookEditor {
	private _isDisposed = false;

	get isDisposed() {
		return this._isDisposed;
	}

	get viewModel() {
		return undefined;
	}

	constructor(
	) { }

	hideInset(output: IProcessedOutput): void {
		throw new Error('Method not implemented.');
	}

	multipleKernelsAvailable: boolean = false;
	onDidChangeAvailableKernels: Event<void> = new Emitter<void>().event;


	uri?: URI | undefined;
	textModel?: NotebookTextModel | undefined;

	hasModel(): boolean {
		return true;
	}

	onDidFocusEditorWidget: Event<void> = new Emitter<void>().event;
	hasFocus(): boolean {
		return true;
	}
	getId(): string {
		return 'notebook.testEditor';
	}

	cursorNavigationMode = false;
	activeKernel: INotebookKernelInfo | undefined;
	onDidChangeKernel: Event<void> = new Emitter<void>().event;
	onDidChangeActiveEditor: Event<ICompositeCodeEditor> = new Emitter<ICompositeCodeEditor>().event;
	activeCodeEditor: IEditor | undefined;
	getDomNode(): HTMLElement {
		throw new Error('Method not implemented.');
	}

	private _onDidChangeModel = new Emitter<NotebookTextModel | undefined>();
	onDidChangeModel: Event<NotebookTextModel | undefined> = this._onDidChangeModel.event;
	getContribution<T extends INotebookEditorContribution>(id: string): T {
		throw new Error('Method not implemented.');
	}
	onMouseUp(listener: (e: INotebookEditorMouseEvent) => void): IDisposable {
		throw new Error('Method not implemented.');
	}
	onMouseDown(listener: (e: INotebookEditorMouseEvent) => void): IDisposable {
		throw new Error('Method not implemented.');
	}

	setHiddenAreas(_ranges: ICellRange[]): boolean {
		throw new Error('Method not implemented.');
	}

	getInnerWebview(): Webview | undefined {
		throw new Error('Method not implemented.');
	}

	cancelNotebookCellExecution(cell: ICellViewModel): void {
		throw new Error('Method not implemented.');
	}

	executeNotebook(): Promise<void> {
		throw new Error('Method not implemented.');
	}

	cancelNotebookExecution(): void {
		throw new Error('Method not implemented.');
	}

	executeNotebookCell(cell: ICellViewModel): Promise<void> {
		throw new Error('Method not implemented.');
	}

	isNotebookEditor = true;

	postMessage(): void {
		throw new Error('Method not implemented.');
	}

	toggleClassName(className: string): void {
		throw new Error('Method not implemented.');
	}

	addClassName(className: string): void {
		throw new Error('Method not implemented.');
	}

	removeClassName(className: string): void {
		throw new Error('Method not implemented.');
	}

	setCellSelection(cell: CellViewModel, selection: Range): void {
		throw new Error('Method not implemented.');
	}

	selectElement(cell: CellViewModel): void {
		throw new Error('Method not implemented.');
	}

	moveCellDown(cell: CellViewModel): Promise<ICellViewModel | null> {
		throw new Error('Method not implemented.');
	}

	moveCellUp(cell: CellViewModel): Promise<ICellViewModel | null> {
		throw new Error('Method not implemented.');
	}

	moveCellToIdx(cell: ICellViewModel, index: number): Promise<ICellViewModel | null> {
		throw new Error('Method not implemented.');
	}

	moveCell(cell: ICellViewModel, relativeToCell: ICellViewModel, direction: 'above' | 'below'): Promise<ICellViewModel | null> {
		throw new Error('Method not implemented.');
	}

	splitNotebookCell(cell: ICellViewModel): Promise<CellViewModel[] | null> {
		throw new Error('Method not implemented.');
	}

	joinNotebookCells(cell: ICellViewModel, direction: 'above' | 'below', constraint?: CellKind): Promise<ICellViewModel | null> {
		throw new Error('Method not implemented.');
	}

	setSelection(cell: CellViewModel, selection: Range): void {
		throw new Error('Method not implemented.');
	}
	revealRangeInViewAsync(cell: CellViewModel, range: Range): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealRangeInCenterAsync(cell: CellViewModel, range: Range): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealRangeInCenterIfOutsideViewportAsync(cell: CellViewModel, range: Range): Promise<void> {
		throw new Error('Method not implemented.');
	}

	revealLineInViewAsync(cell: CellViewModel, line: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	getLayoutInfo(): NotebookLayoutInfo {
		throw new Error('Method not implemented.');
	}
	revealLineInCenterIfOutsideViewportAsync(cell: CellViewModel, line: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	revealLineInCenterAsync(cell: CellViewModel, line: number): Promise<void> {
		throw new Error('Method not implemented.');
	}
	focus(): void {
		throw new Error('Method not implemented.');
	}
	showFind(): void {
		throw new Error('Method not implemented.');
	}
	hideFind(): void {
		throw new Error('Method not implemented.');
	}
	revealInView(cell: CellViewModel): void {
		throw new Error('Method not implemented.');
	}
	revealInCenter(cell: CellViewModel): void {
		throw new Error('Method not implemented.');
	}
	revealInCenterIfOutsideViewport(cell: CellViewModel): void {
		throw new Error('Method not implemented.');
	}
	insertNotebookCell(cell: CellViewModel, type: CellKind, direction: 'above' | 'below'): CellViewModel {
		throw new Error('Method not implemented.');
	}
	deleteNotebookCell(cell: CellViewModel): Promise<boolean> {
		throw new Error('Method not implemented.');
	}
	focusNotebookCell(cell: CellViewModel, focusItem: 'editor' | 'container' | 'output'): void {
		// throw new Error('Method not implemented.');
	}
	getActiveCell(): CellViewModel | undefined {
		// throw new Error('Method not implemented.');
		return;
	}
	async layoutNotebookCell(cell: CellViewModel, height: number): Promise<void> {
		// throw new Error('Method not implemented.');
		return;
	}
	createInset(cell: CellViewModel, output: IProcessedOutput, shadowContent: string, offset: number): Promise<void> {
		return Promise.resolve();
	}
	removeInset(output: IProcessedOutput): void {
		// throw new Error('Method not implemented.');
	}
	triggerScroll(event: IMouseWheelEvent): void {
		// throw new Error('Method not implemented.');
	}
	getFontInfo(): BareFontInfo | undefined {
		return BareFontInfo.createFromRawSettings({
			fontFamily: 'Monaco',
		}, 1, true);
	}
	getOutputRenderer(): OutputRenderer {
		throw new Error('Method not implemented.');
	}

	changeModelDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T | null {
		throw new Error('Method not implemented.');
	}

	deltaCellOutputContainerClassNames(cellId: string, added: string[], removed: string[]): void {
		throw new Error('Method not implemented.');
	}

	dispose() {
		this._isDisposed = true;
	}
}

// export function createTestCellViewModel(instantiationService: IInstantiationService, viewType: string, notebookHandle: number, cellhandle: number, source: string[], language: string, cellKind: CellKind, outputs: IOutput[]) {
// 	const mockCell = new TestCell(viewType, cellhandle, source, language, cellKind, outputs);
// 	return createCellViewModel(instantiationService, viewType, notebookHandle, mockCell);
// }

export class NotebookEditorTestModel extends EditorModel implements INotebookEditorModel {
	private _dirty = false;

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

		if (_notebook && _notebook.onDidChangeCells) {
			this._register(_notebook.onDidChangeContent(() => {
				this._dirty = true;
				this._onDidChangeDirty.fire();
				this._onDidChangeContent.fire();
			}));
		}
	}

	isDirty() {
		return this._dirty;
	}

	isUntitled() {
		return this._notebook.uri.scheme === Schemas.untitled;
	}

	getNotebook(): NotebookTextModel {
		return this._notebook;
	}

	async save(): Promise<boolean> {
		if (this._notebook) {
			this._dirty = false;
			this._onDidChangeDirty.fire();
			// todo, flush all states
			return true;
		}

		return false;
	}

	saveAs(): Promise<boolean> {
		throw new NotImplementedError();
	}

	revert(): Promise<void> {
		throw new NotImplementedError();
	}
}

export function setupInstantiationService() {
	const instantiationService = new TestInstantiationService();

	instantiationService.stub(IUndoRedoService, instantiationService.createInstance(UndoRedoService));
	instantiationService.stub(IConfigurationService, new TestConfigurationService());
	instantiationService.stub(IThemeService, new TestThemeService());
	instantiationService.stub(IModelService, instantiationService.createInstance(ModelServiceImpl));
	instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));

	return instantiationService;
}

export function withTestNotebook(instantiationService: TestInstantiationService, blukEditService: IBulkEditService, undoRedoService: IUndoRedoService, cells: [string[], string, CellKind, IProcessedOutput[], NotebookCellMetadata][], callback: (editor: TestNotebookEditor, viewModel: NotebookViewModel, textModel: NotebookTextModel) => void) {
	const textModelService = instantiationService.get(ITextModelService);

	const viewType = 'notebook';
	const editor = new TestNotebookEditor();
	const notebook = new NotebookTextModel(0, viewType, false, URI.parse('test'), undoRedoService, textModelService);
	notebook.cells = cells.map((cell, index) => {
		return new NotebookCellTextModel(notebook.uri, index, cell[0], cell[1], cell[2], cell[3], cell[4], textModelService);
	});
	const model = new NotebookEditorTestModel(notebook);
	const eventDispatcher = new NotebookEventDispatcher();
	const viewModel = new NotebookViewModel(viewType, model.notebook, eventDispatcher, null, instantiationService, blukEditService, undoRedoService);

	callback(editor, viewModel, notebook);

	viewModel.dispose();
	return;
}
