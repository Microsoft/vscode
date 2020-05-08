/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { CellKind, IOutput, CellUri, NotebookCellMetadata, INotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookViewModel, IModelDecorationsChangeAccessor, CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotebookEditor, NotebookLayoutInfo, ICellViewModel, ICellRange, INotebookEditorMouseEvent, INotebookEditorContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { Range } from 'vs/editor/common/core/range';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { Webview } from 'vs/workbench/contrib/webview/browser/webview';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { EditorModel } from 'vs/workbench/common/editor';
export class TestCell extends NotebookCellTextModel {
	constructor(
		public viewType: string,
		handle: number,
		public source: string[],
		language: string,
		cellKind: CellKind,
		outputs: IOutput[]
	) {
		super(CellUri.generate(URI.parse('test:///fake/notebook'), handle), handle, source, language, cellKind, outputs, undefined);
	}
}

export class TestNotebookEditor implements INotebookEditor {

	get viewModel() {
		return undefined;
	}

	constructor(
	) { }
	getDomNode(): HTMLElement {
		throw new Error('Method not implemented.');
	}

	private _onDidChangeModel = new Emitter<void>();
	onDidChangeModel: Event<void> = this._onDidChangeModel.event;
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

	postMessage(message: any): void {
		throw new Error('Method not implemented.');
	}

	setCellSelection(cell: CellViewModel, selection: Range): void {
		throw new Error('Method not implemented.');
	}

	selectElement(cell: CellViewModel): void {
		throw new Error('Method not implemented.');
	}

	moveCellDown(cell: CellViewModel): Promise<boolean> {
		throw new Error('Method not implemented.');
	}

	moveCellUp(cell: CellViewModel): Promise<boolean> {
		throw new Error('Method not implemented.');
	}

	moveCell(cell: ICellViewModel, relativeToCell: ICellViewModel, direction: 'above' | 'below'): Promise<boolean> {
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
	revealRangeInView(cell: CellViewModel, range: Range): void {
		throw new Error('Method not implemented.');
	}
	revealRangeInCenter(cell: CellViewModel, range: Range): void {
		throw new Error('Method not implemented.');
	}
	revealRangeInCenterIfOutsideViewport(cell: CellViewModel, range: Range): void {
		throw new Error('Method not implemented.');
	}

	revealLineInView(cell: CellViewModel, line: number): void {
		throw new Error('Method not implemented.');
	}
	getLayoutInfo(): NotebookLayoutInfo {
		throw new Error('Method not implemented.');
	}
	revealLineInCenterIfOutsideViewport(cell: CellViewModel, line: number): void {
		throw new Error('Method not implemented.');
	}
	revealLineInCenter(cell: CellViewModel, line: number): void {
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
	editNotebookCell(cell: CellViewModel): void {
		// throw new Error('Method not implemented.');
	}
	saveNotebookCell(cell: CellViewModel): void {
		// throw new Error('Method not implemented.');
	}
	focusNotebookCell(cell: CellViewModel, focusEditor: boolean): void {
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
	createInset(cell: CellViewModel, output: IOutput, shadowContent: string, offset: number): void {
		// throw new Error('Method not implemented.');
	}
	removeInset(output: IOutput): void {
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

	changeDecorations(callback: (changeAccessor: IModelDecorationsChangeAccessor) => any): any {
		throw new Error('Method not implemented.');
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
}

export function withTestNotebook(instantiationService: IInstantiationService, blukEditService: IBulkEditService, undoRedoService: IUndoRedoService, cells: [string[], string, CellKind, IOutput[], NotebookCellMetadata][], callback: (editor: TestNotebookEditor, viewModel: NotebookViewModel, textModel: NotebookTextModel) => void) {
	const viewType = 'notebook';
	const editor = new TestNotebookEditor();
	const notebook = new NotebookTextModel(0, viewType, URI.parse('test'));
	notebook.cells = cells.map((cell, index) => {
		return new NotebookCellTextModel(notebook.uri, index, cell[0], cell[1], cell[2], cell[3], cell[4]);
	});
	const model = new NotebookEditorTestModel(notebook);
	const eventDispatcher = new NotebookEventDispatcher();
	const viewModel = new NotebookViewModel(viewType, model.notebook, eventDispatcher, null, instantiationService, blukEditService, undoRedoService);

	callback(editor, viewModel, notebook);

	viewModel.dispose();
	return;
}
