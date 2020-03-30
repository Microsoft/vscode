/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { PieceTreeTextBufferFactory } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { CellKind, ICell, IOutput, NotebookCellOutputsSplice, CellUri, NotebookCellMetadata } from 'vs/workbench/services/notebook/common/notebookCommon';
import { NotebookViewModel, IModelDecorationsChangeAccessor, CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { NotebookEditorModel } from 'vs/workbench/services/notebook/browser/notebookEditorInput';
import { INotebookEditor, NotebookLayoutInfo, ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { Range } from 'vs/editor/common/core/range';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { NotebookTextModel } from 'vs/workbench/services/notebook/common/model/notebookTextModel';
import { NotebookCellTextModel } from 'vs/workbench/services/notebook/common/model/notebookCellTextModel';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';

export class TestCell implements ICell {
	uri: URI;
	private _onDidChangeContent = new Emitter<void>();
	onDidChangeContent: Event<void> = this._onDidChangeContent.event;

	private _onDidChangeOutputs = new Emitter<NotebookCellOutputsSplice[]>();
	onDidChangeOutputs: Event<NotebookCellOutputsSplice[]> = this._onDidChangeOutputs.event;
	private _onDidChangeLanguage = new Emitter<string>();
	onDidChangeLanguage: Event<string> = this._onDidChangeLanguage.event;
	private _onDidChangeMetadata = new Emitter<void>();
	onDidChangeMetadata: Event<void> = this._onDidChangeMetadata.event;
	private _isDirty: boolean = false;
	private _outputs: IOutput[];

	get metadata(): NotebookCellMetadata {
		return { editable: true };
	}

	get outputs(): IOutput[] {
		return this._outputs;
	}

	get isDirty() {
		return this._isDirty;
	}

	set isDirty(newState: boolean) {
		this._isDirty = newState;

	}

	constructor(
		public viewType: string,
		public handle: number,
		public source: string[],
		public language: string,
		public cellKind: CellKind,
		outputs: IOutput[]
	) {
		this._outputs = outputs;
		this.uri = CellUri.generate(URI.parse('test:///fake/notebook'), viewType, handle);
	}
	contentChange(): void {
		// throw new Error('Method not implemented.');
	}

	resolveTextBufferFactory(): PieceTreeTextBufferFactory {
		throw new Error('Method not implemented.');
	}
}

export class TestNotebookEditor implements INotebookEditor {

	get viewModel() {
		return undefined;
	}

	constructor(
	) { }

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

	moveCellDown(cell: CellViewModel): void {
		throw new Error('Method not implemented.');
	}

	moveCellUp(cell: CellViewModel): void {
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
	async insertNotebookCell(cell: CellViewModel, type: CellKind, direction: 'above' | 'below'): Promise<void> {
		// throw new Error('Method not implemented.');
	}
	deleteNotebookCell(cell: CellViewModel): void {
		// throw new Error('Method not implemented.');
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

export function withTestNotebook(instantiationService: IInstantiationService, blukEditService: IBulkEditService, undoRedoService: IUndoRedoService, cells: [string[], string, CellKind, IOutput[], NotebookCellMetadata][], callback: (editor: TestNotebookEditor, viewModel: NotebookViewModel) => void) {
	const viewType = 'notebook';
	const editor = new TestNotebookEditor();
	const notebook = new NotebookTextModel(0, viewType, URI.parse('test'));
	notebook.cells = cells.map((cell, index) => {
		return new NotebookCellTextModel(notebook.uri, index, cell[0], cell[1], cell[2], cell[3], cell[4]);
	});
	const model = new NotebookEditorModel(notebook);
	const eventDispatcher = new NotebookEventDispatcher();
	const viewModel = new NotebookViewModel(viewType, model, eventDispatcher, null, instantiationService, blukEditService, undoRedoService);

	callback(editor, viewModel);

	viewModel.dispose();
	return;
}
