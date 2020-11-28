/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import * as DOM from 'vs/base/browser/dom';
import { domEvent } from 'vs/base/browser/event';
import { Delayer } from 'vs/base/common/async';
import { Disposable } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import { BOTTOM_CELL_TOOLBAR_GAP } from 'vs/workbench/contrib/notebook/browser/constants';
import { BaseCellRenderTemplate, CellEditState, ICellViewModel, INotebookCellList, INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';

const $ = DOM.$;

export const DRAGGING_CLASS = 'cell-dragging';
export const GLOBAL_DRAG_CLASS = 'global-drag-active';

type DragImageProvider = () => HTMLElement;

interface CellDragEvent {
	browserEvent: DragEvent;
	draggedOverCell: ICellViewModel;
	cellTop: number;
	cellHeight: number;
	dragPosRatio: number;
}

export class CellDragAndDropController extends Disposable {
	// TODO@roblourens - should probably use dataTransfer here, but any dataTransfer set makes the editor think I am dropping a file, need
	// to figure out how to prevent that
	private currentDraggedCell: ICellViewModel | undefined;

	private listInsertionIndicator: HTMLElement;

	private list!: INotebookCellList;

	private isScrolling = false;
	private scrollingDelayer: Delayer<void>;

	constructor(
		private readonly notebookEditor: INotebookEditor,
		insertionIndicatorContainer: HTMLElement
	) {
		super();

		this.listInsertionIndicator = DOM.append(insertionIndicatorContainer, $('.cell-list-insertion-indicator'));

		this._register(domEvent(document.body, DOM.EventType.DRAG_START, true)(this.onGlobalDragStart.bind(this)));
		this._register(domEvent(document.body, DOM.EventType.DRAG_END, true)(this.onGlobalDragEnd.bind(this)));

		const addCellDragListener = (eventType: string, handler: (e: CellDragEvent) => void) => {
			this._register(DOM.addDisposableListener(
				notebookEditor.getDomNode(),
				eventType,
				e => {
					const cellDragEvent = this.toCellDragEvent(e);
					if (cellDragEvent) {
						handler(cellDragEvent);
					}
				}));
		};

		addCellDragListener(DOM.EventType.DRAG_OVER, event => {
			event.browserEvent.preventDefault();
			this.onCellDragover(event);
		});
		addCellDragListener(DOM.EventType.DROP, event => {
			event.browserEvent.preventDefault();
			this.onCellDrop(event);
		});
		addCellDragListener(DOM.EventType.DRAG_LEAVE, event => {
			event.browserEvent.preventDefault();
			this.onCellDragLeave(event);
		});

		this.scrollingDelayer = new Delayer(200);
	}

	setList(value: INotebookCellList) {
		this.list = value;

		this.list.onWillScroll(e => {
			if (!e.scrollTopChanged) {
				return;
			}

			this.setInsertIndicatorVisibility(false);
			this.isScrolling = true;
			this.scrollingDelayer.trigger(() => {
				this.isScrolling = false;
			});
		});
	}

	private setInsertIndicatorVisibility(visible: boolean) {
		this.listInsertionIndicator.style.opacity = visible ? '1' : '0';
	}

	private toCellDragEvent(event: DragEvent): CellDragEvent | undefined {
		const targetTop = this.notebookEditor.getDomNode().getBoundingClientRect().top;
		const dragOffset = this.list.scrollTop + event.clientY - targetTop;
		const draggedOverCell = this.list.elementAt(dragOffset);
		if (!draggedOverCell) {
			return undefined;
		}

		const cellTop = this.list.getAbsoluteTopOfElement(draggedOverCell);
		const cellHeight = this.list.elementHeight(draggedOverCell);

		const dragPosInElement = dragOffset - cellTop;
		const dragPosRatio = dragPosInElement / cellHeight;

		return <CellDragEvent>{
			browserEvent: event,
			draggedOverCell,
			cellTop,
			cellHeight,
			dragPosRatio
		};
	}

	clearGlobalDragState() {
		this.notebookEditor.getDomNode().classList.remove(GLOBAL_DRAG_CLASS);
	}

	private onGlobalDragStart() {
		this.notebookEditor.getDomNode().classList.add(GLOBAL_DRAG_CLASS);
	}

	private onGlobalDragEnd() {
		this.notebookEditor.getDomNode().classList.remove(GLOBAL_DRAG_CLASS);
	}

	private onCellDragover(event: CellDragEvent): void {
		if (!event.browserEvent.dataTransfer) {
			return;
		}

		if (!this.currentDraggedCell) {
			event.browserEvent.dataTransfer.dropEffect = 'none';
			return;
		}

		if (this.isScrolling || this.currentDraggedCell === event.draggedOverCell) {
			this.setInsertIndicatorVisibility(false);
			return;
		}

		const dropDirection = this.getDropInsertDirection(event);
		const insertionIndicatorAbsolutePos = dropDirection === 'above' ? event.cellTop : event.cellTop + event.cellHeight;
		const insertionIndicatorTop = insertionIndicatorAbsolutePos - this.list.scrollTop + BOTTOM_CELL_TOOLBAR_GAP / 2;
		if (insertionIndicatorTop >= 0) {
			this.listInsertionIndicator.style.top = `${insertionIndicatorTop}px`;
			this.setInsertIndicatorVisibility(true);
		} else {
			this.setInsertIndicatorVisibility(false);
		}
	}

	private getDropInsertDirection(event: CellDragEvent): 'above' | 'below' {
		return event.dragPosRatio < 0.5 ? 'above' : 'below';
	}

	private onCellDrop(event: CellDragEvent): void {
		const draggedCell = this.currentDraggedCell!;

		if (this.isScrolling || this.currentDraggedCell === event.draggedOverCell) {
			return;
		}

		let draggedCells: ICellViewModel[] = [draggedCell];
		let draggedCellRange: [number, number] = [this.notebookEditor.viewModel!.getCellIndex(draggedCell), 1];

		if (draggedCell.cellKind === CellKind.Markdown) {
			const currCellIndex = this.notebookEditor.viewModel!.getCellIndex(draggedCell);
			const nextVisibleCellIndex = this.notebookEditor.viewModel!.getNextVisibleCellIndex(currCellIndex);

			if (nextVisibleCellIndex > currCellIndex + 1) {
				// folding ;)
				draggedCells = this.notebookEditor.viewModel!.viewCells.slice(currCellIndex, nextVisibleCellIndex);
				draggedCellRange = [currCellIndex, nextVisibleCellIndex - currCellIndex];
			}
		}

		this.dragCleanup();

		const isCopy = (event.browserEvent.ctrlKey && !platform.isMacintosh) || (event.browserEvent.altKey && platform.isMacintosh);

		const dropDirection = this.getDropInsertDirection(event);
		const insertionIndicatorAbsolutePos = dropDirection === 'above' ? event.cellTop : event.cellTop + event.cellHeight;
		const insertionIndicatorTop = insertionIndicatorAbsolutePos - this.list.scrollTop + BOTTOM_CELL_TOOLBAR_GAP / 2;
		const editorHeight = this.notebookEditor.getDomNode().getBoundingClientRect().height;
		if (insertionIndicatorTop < 0 || insertionIndicatorTop > editorHeight) {
			// Ignore drop, insertion point is off-screen
			return;
		}

		if (isCopy) {
			this.copyCells(draggedCells, event.draggedOverCell, dropDirection);
		} else {
			const viewModel = this.notebookEditor.viewModel!;
			let originalToIdx = viewModel.getCellIndex(event.draggedOverCell);
			if (dropDirection === 'below') {
				const relativeToIndex = viewModel.getCellIndex(event.draggedOverCell);
				const newIdx = viewModel.getNextVisibleCellIndex(relativeToIndex);
				originalToIdx = newIdx;
			}

			this.notebookEditor.moveCellsToIdx(draggedCellRange[0], draggedCellRange[1], originalToIdx);
		}
	}

	private onCellDragLeave(event: CellDragEvent): void {
		if (!event.browserEvent.relatedTarget || !DOM.isAncestor(event.browserEvent.relatedTarget as HTMLElement, this.notebookEditor.getDomNode())) {
			this.setInsertIndicatorVisibility(false);
		}
	}

	private dragCleanup(): void {
		if (this.currentDraggedCell) {
			this.currentDraggedCell.dragging = false;
			this.currentDraggedCell = undefined;
		}

		this.setInsertIndicatorVisibility(false);
	}

	registerDragHandle(templateData: BaseCellRenderTemplate, cellRoot: HTMLElement, dragHandle: HTMLElement, dragImageProvider: DragImageProvider): void {
		const container = templateData.container;
		dragHandle.setAttribute('draggable', 'true');

		templateData.disposables.add(domEvent(dragHandle, DOM.EventType.DRAG_END)(() => {
			// Note, templateData may have a different element rendered into it by now
			container.classList.remove(DRAGGING_CLASS);
			this.dragCleanup();
		}));

		templateData.disposables.add(domEvent(dragHandle, DOM.EventType.DRAG_START)(event => {
			if (!event.dataTransfer) {
				return;
			}

			this.currentDraggedCell = templateData.currentRenderedCell!;
			this.currentDraggedCell.dragging = true;

			const dragImage = dragImageProvider();
			cellRoot.parentElement!.appendChild(dragImage);
			event.dataTransfer.setDragImage(dragImage, 0, 0);
			setTimeout(() => cellRoot.parentElement!.removeChild(dragImage!), 0); // Comment this out to debug drag image layout

			container.classList.add(DRAGGING_CLASS);
		}));
	}

	private copyCells(draggedCells: ICellViewModel[], ontoCell: ICellViewModel, direction: 'above' | 'below') {
		this.notebookEditor.textModel!.pushStackElement('Copy Cells', undefined, undefined);
		let firstNewCell: ICellViewModel | undefined = undefined;
		let firstNewCellState: CellEditState = CellEditState.Preview;
		for (let i = 0; i < draggedCells.length; i++) {
			const draggedCell = draggedCells[i];
			const newCell = this.notebookEditor.insertNotebookCell(ontoCell, draggedCell.cellKind, direction, draggedCell.getText());

			if (newCell && !firstNewCell) {
				firstNewCell = newCell;
				firstNewCellState = draggedCell.editState;
			}
		}

		if (firstNewCell) {
			this.notebookEditor.focusNotebookCell(firstNewCell, firstNewCellState === CellEditState.Editing ? 'editor' : 'container');
		}

		this.notebookEditor.textModel!.pushStackElement('Copy Cells', undefined, undefined);
	}
}
