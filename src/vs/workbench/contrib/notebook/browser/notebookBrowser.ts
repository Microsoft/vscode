/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { Range } from 'vs/editor/common/core/range';
import { FindMatch } from 'vs/editor/common/model';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { IModelDecorationsChangeAccessor, NotebookViewModel, CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { CellKind, IOutput, IRenderOutput, NotebookCellMetadata, NotebookDocumentMetadata } from 'vs/workbench/services/notebook/common/notebookCommon';
import { NOTEBOOK_EDITABLE_CONTEXT_KEY } from 'vs/workbench/contrib/notebook/browser/constants';

export const KEYBINDING_CONTEXT_NOTEBOOK_FIND_WIDGET_FOCUSED = new RawContextKey<boolean>('notebookFindWidgetFocused', false);

export const NOTEBOOK_EDITOR_FOCUSED = new RawContextKey<boolean>('notebookEditorFocused', false);
export const NOTEBOOK_EDITOR_EDITABLE = new RawContextKey<boolean>(NOTEBOOK_EDITABLE_CONTEXT_KEY, true);

export interface NotebookLayoutInfo {
	width: number;
	height: number;
	fontInfo: BareFontInfo;
}

export interface NotebookLayoutChangeEvent {
	width?: boolean;
	height?: boolean;
	fontInfo?: boolean;
}

export interface CodeCellLayoutInfo {
	readonly fontInfo: BareFontInfo | null;
	readonly editorHeight: number;
	readonly editorWidth: number;
	readonly totalHeight: number;
	readonly outputContainerOffset: number;
	readonly outputTotalHeight: number;
	readonly indicatorHeight: number;
}

export interface CodeCellLayoutChangeEvent {
	editorHeight?: boolean;
	outputHeight?: boolean;
	totalHeight?: boolean;
	outerWidth?: number;
	font?: BareFontInfo;
}

export interface MarkdownCellLayoutInfo {
	readonly fontInfo: BareFontInfo | null;
	readonly editorWidth: number;
}

export interface MarkdownCellLayoutChangeEvent {
	font?: BareFontInfo;
	outerWidth?: number;
}

export interface ICellViewModel {
	readonly id: string;
	handle: number;
	uri: URI;
	cellKind: CellKind;
	editState: CellEditState;
	runState: CellRunState;
	focusMode: CellFocusMode;
	getText(): string;
	metadata: NotebookCellMetadata | undefined;
	getEvaluatedMetadata(documentMetadata: NotebookDocumentMetadata | undefined): NotebookCellMetadata;
}

export interface INotebookEditor {

	/**
	 * Notebook view model attached to the current editor
	 */
	viewModel: NotebookViewModel | undefined;

	isNotebookEditor: boolean;

	/**
	 * Focus the notebook editor cell list
	 */
	focus(): void;

	/**
	 * Select & focus cell
	 */
	selectElement(cell: ICellViewModel): void;

	/**
	 * Layout info for the notebook editor
	 */
	getLayoutInfo(): NotebookLayoutInfo;
	/**
	 * Fetch the output renderers for notebook outputs.
	 */
	getOutputRenderer(): OutputRenderer;

	/**
	 * Insert a new cell around `cell`
	 */
	insertNotebookCell(cell: ICellViewModel, type: CellKind, direction: 'above' | 'below', initialText?: string): Promise<void>;

	/**
	 * Delete a cell from the notebook
	 */
	deleteNotebookCell(cell: ICellViewModel): void;

	/**
	 * Move a cell up one spot
	 */
	moveCellUp(cell: ICellViewModel): void;

	/**
	 * Move a cell down one spot
	 */
	moveCellDown(cell: ICellViewModel): void;

	/**
	 * Switch the cell into editing mode.
	 *
	 * For code cell, the monaco editor will be focused.
	 * For markdown cell, it will switch from preview mode to editing mode, which focuses the monaco editor.
	 */
	editNotebookCell(cell: ICellViewModel): void;

	/**
	 * Quit cell editing mode.
	 */
	saveNotebookCell(cell: ICellViewModel): void;

	/**
	 * Focus the container of a cell (the monaco editor inside is not focused).
	 */
	focusNotebookCell(cell: ICellViewModel, focusEditor: boolean): void;

	/**
	 * Execute the given notebook cell
	 */
	executeNotebookCell(cell: ICellViewModel): Promise<void>;

	/**
	 * Get current active cell
	 */
	getActiveCell(): ICellViewModel | undefined;

	/**
	 * Layout the cell with a new height
	 */
	layoutNotebookCell(cell: ICellViewModel, height: number): Promise<void>;

	/**
	 * Render the output in webview layer
	 */
	createInset(cell: ICellViewModel, output: IOutput, shadowContent: string, offset: number): void;

	/**
	 * Remove the output from the webview layer
	 */
	removeInset(output: IOutput): void;

	/**
	 * Send message to the webview for outputs.
	 */
	postMessage(message: any): void;

	/**
	 * Trigger the editor to scroll from scroll event programmatically
	 */
	triggerScroll(event: IMouseWheelEvent): void;

	/**
	 * Reveal cell into viewport.
	 */
	revealInView(cell: ICellViewModel): void;

	/**
	 * Reveal cell into viewport center.
	 */
	revealInCenter(cell: ICellViewModel): void;

	/**
	 * Reveal cell into viewport center if cell is currently out of the viewport.
	 */
	revealInCenterIfOutsideViewport(cell: ICellViewModel): void;

	/**
	 * Reveal a line in notebook cell into viewport with minimal scrolling.
	 */
	revealLineInView(cell: ICellViewModel, line: number): void;

	/**
	 * Reveal a line in notebook cell into viewport center.
	 */
	revealLineInCenter(cell: ICellViewModel, line: number): void;

	/**
	 * Reveal a line in notebook cell into viewport center.
	 */
	revealLineInCenterIfOutsideViewport(cell: ICellViewModel, line: number): void;

	/**
	 * Reveal a range in notebook cell into viewport with minimal scrolling.
	 */
	revealRangeInView(cell: ICellViewModel, range: Range): void;

	/**
	 * Reveal a range in notebook cell into viewport center.
	 */
	revealRangeInCenter(cell: ICellViewModel, range: Range): void;

	/**
	 * Reveal a range in notebook cell into viewport center.
	 */
	revealRangeInCenterIfOutsideViewport(cell: ICellViewModel, range: Range): void;

	setCellSelection(cell: ICellViewModel, selection: Range): void;

	/**
	 * Change the decorations on cells.
	 * The notebook is virtualized and this method should be called to create/delete editor decorations safely.
	 */
	changeDecorations(callback: (changeAccessor: IModelDecorationsChangeAccessor) => any): any;

	/**
	 * Show Find Widget.
	 *
	 * Currently Find is still part of the NotebookEditor core
	 */
	showFind(): void;

	/**
	 * Hide Find Widget
	 */
	hideFind(): void;
}

export interface CellRenderTemplate {
	container: HTMLElement;
	cellContainer: HTMLElement;
	editorContainer?: HTMLElement;
	toolbar: ToolBar;
	focusIndicator?: HTMLElement;
	runToolbar?: ToolBar;
	runButtonContainer?: HTMLElement;
	executionOrderLabel?: HTMLElement;
	editingContainer?: HTMLElement;
	outputContainer?: HTMLElement;
	editor?: CodeEditorWidget;
	progressBar?: ProgressBar;
	disposables: DisposableStore;
	toJSON(): void;
}

export interface IOutputTransformContribution {
	/**
	 * Dispose this contribution.
	 */
	dispose(): void;

	render(output: IOutput, container: HTMLElement, preferredMimeType: string | undefined): IRenderOutput;
}

export interface CellFindMatch {
	cell: CellViewModel;
	matches: FindMatch[];
}

export enum CellRevealType {
	Line,
	Range
}

export enum CellRevealPosition {
	Top,
	Center
}

export enum CellRunState {
	Idle,
	Running
}

export enum CellEditState {
	/**
	 * Default state.
	 * For markdown cell, it's Markdown preview.
	 * For code cell, the browser focus should be on the container instead of the editor
	 */
	Preview,


	/**
	 * Eding mode. Source for markdown or code is rendered in editors and the state will be persistent.
	 */
	Editing
}

export enum CellFocusMode {
	Container,
	Editor
}

export enum CursorAtBoundary {
	None,
	Top,
	Bottom,
	Both
}
