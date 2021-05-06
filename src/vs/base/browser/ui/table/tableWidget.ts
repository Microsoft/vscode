/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./table';
import { IListOptions, IListOptionsUpdate, IListStyles, List } from 'vs/base/browser/ui/list/listWidget';
import { ITableColumn, ITableContextMenuEvent, ITableEvent, ITableGestureEvent, ITableMouseEvent, ITableRenderer, ITableTouchEvent, ITableVirtualDelegate } from 'vs/base/browser/ui/table/table';
import { ISpliceable } from 'vs/base/common/sequence';
import { IThemable } from 'vs/base/common/styler';
import { IDisposable } from 'vs/base/common/lifecycle';
import { $, append, clearNode, createStyleSheet, getContentHeight, getContentWidth } from 'vs/base/browser/dom';
import { ISplitViewDescriptor, IView, Orientation, SplitView } from 'vs/base/browser/ui/splitview/splitview';
import { IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { Emitter, Event } from 'vs/base/common/event';
import { ScrollbarVisibility, ScrollEvent } from 'vs/base/common/scrollable';

// TODO@joao
type TCell = any;

interface RowTemplateData {
	readonly container: HTMLElement;
	readonly cellContainers: HTMLElement[];
	readonly cellTemplateData: unknown[];
}

class TableListRenderer<TRow> implements IListRenderer<TRow, RowTemplateData> {

	static TemplateId = 'row';
	readonly templateId = TableListRenderer.TemplateId;
	private renderers: ITableRenderer<TCell, unknown>[];
	private renderedTemplates = new Set<RowTemplateData>();

	constructor(
		private columns: ITableColumn<TRow, TCell>[],
		renderers: ITableRenderer<TCell, unknown>[],
		private getColumnSize: (index: number) => number
	) {
		const rendererMap = new Map(renderers.map(r => [r.templateId, r]));
		this.renderers = [];

		for (const column of columns) {
			const renderer = rendererMap.get(column.templateId);

			if (!renderer) {
				throw new Error(`Table cell renderer for template id ${column.templateId} not found.`);
			}

			this.renderers.push(renderer);
		}
	}

	renderTemplate(container: HTMLElement) {
		const rowContainer = append(container, $('.monaco-table-tr'));
		const cellContainers: HTMLElement[] = [];
		const cellTemplateData: unknown[] = [];

		for (let i = 0; i < this.columns.length; i++) {
			const renderer = this.renderers[i];
			const cellContainer = append(rowContainer, $('.monaco-table-td', { 'data-col-index': i }));

			cellContainer.style.width = `${this.getColumnSize(i)}px`;
			cellContainers.push(cellContainer);
			cellTemplateData.push(renderer.renderTemplate(cellContainer));
		}

		const result = { container, cellContainers, cellTemplateData };
		this.renderedTemplates.add(result);

		return result;
	}

	renderElement(element: TRow, index: number, templateData: RowTemplateData, height: number | undefined): void {
		for (let i = 0; i < this.columns.length; i++) {
			const column = this.columns[i];
			const cell = column.project(element);
			const renderer = this.renderers[i];
			renderer.renderElement(cell, index, templateData.cellTemplateData[i], height);
		}
	}

	disposeElement(element: TRow, index: number, templateData: RowTemplateData, height: number | undefined): void {
		for (let i = 0; i < this.columns.length; i++) {
			const renderer = this.renderers[i];

			if (renderer.disposeElement) {
				const column = this.columns[i];
				const cell = column.project(element);

				renderer.disposeElement(cell, index, templateData.cellTemplateData[i], height);
			}
		}
	}

	disposeTemplate(templateData: RowTemplateData): void {
		for (let i = 0; i < this.columns.length; i++) {
			const renderer = this.renderers[i];
			renderer.disposeTemplate(templateData.cellTemplateData[i]);
		}

		clearNode(templateData.container);
		this.renderedTemplates.delete(templateData);
	}

	layoutColumn(index: number, size: number): void {
		for (const { cellContainers } of this.renderedTemplates) {
			cellContainers[index].style.width = `${size}px`;
		}
	}
}

function asListVirtualDelegate<TRow>(delegate: ITableVirtualDelegate<TRow>): IListVirtualDelegate<TRow> {
	return {
		getHeight(row) { return delegate.getHeight(row); },
		getTemplateId() { return TableListRenderer.TemplateId; },
	};
}

class ColumnHeader<TRow, TCell> implements IView {

	readonly element: HTMLElement;

	get minimumSize() { return this.column.minimumWidth ?? 120; }
	get maximumSize() { return this.column.maximumWidth ?? Number.POSITIVE_INFINITY; }
	get onDidChange() { return this.column.onDidChangeWidthConstraints ?? Event.None; }

	private _onDidLayout = new Emitter<[number, number]>();
	readonly onDidLayout = this._onDidLayout.event;

	constructor(readonly column: ITableColumn<TRow, TCell>, private index: number) {
		this.element = $('.monaco-table-th', { 'data-col-index': index, title: column.tooltip }, column.label);
	}

	layout(size: number): void {
		this._onDidLayout.fire([this.index, size]);
	}
}

export interface ITableOptions<TRow> extends IListOptions<TRow> { }
export interface ITableOptionsUpdate extends IListOptionsUpdate { }
export interface ITableStyles extends IListStyles { }

export class Table<TRow> implements ISpliceable<TRow>, IThemable, IDisposable {

	private static InstanceCount = 0;
	readonly domId = `table_id_${++Table.InstanceCount}`;

	readonly domNode: HTMLElement;
	private splitview: SplitView;
	private list: List<TRow>;
	private columnLayoutDisposable: IDisposable;
	private cachedHeight: number = 0;
	private styleElement: HTMLStyleElement;

	get onDidChangeFocus(): Event<ITableEvent<TRow>> { return this.list.onDidChangeFocus; }
	get onDidChangeSelection(): Event<ITableEvent<TRow>> { return this.list.onDidChangeSelection; }

	get onDidScroll(): Event<ScrollEvent> { return this.list.onDidScroll; }
	get onMouseClick(): Event<ITableMouseEvent<TRow>> { return this.list.onMouseClick; }
	get onMouseDblClick(): Event<ITableMouseEvent<TRow>> { return this.list.onMouseDblClick; }
	get onMouseMiddleClick(): Event<ITableMouseEvent<TRow>> { return this.list.onMouseMiddleClick; }
	get onPointer(): Event<ITableMouseEvent<TRow>> { return this.list.onPointer; }
	get onMouseUp(): Event<ITableMouseEvent<TRow>> { return this.list.onMouseUp; }
	get onMouseDown(): Event<ITableMouseEvent<TRow>> { return this.list.onMouseDown; }
	get onMouseOver(): Event<ITableMouseEvent<TRow>> { return this.list.onMouseOver; }
	get onMouseMove(): Event<ITableMouseEvent<TRow>> { return this.list.onMouseMove; }
	get onMouseOut(): Event<ITableMouseEvent<TRow>> { return this.list.onMouseOut; }
	get onTouchStart(): Event<ITableTouchEvent<TRow>> { return this.list.onTouchStart; }
	get onTap(): Event<ITableGestureEvent<TRow>> { return this.list.onTap; }
	get onContextMenu(): Event<ITableContextMenuEvent<TRow>> { return this.list.onContextMenu; }

	get onDidFocus(): Event<void> { return this.list.onDidFocus; }
	get onDidBlur(): Event<void> { return this.list.onDidBlur; }

	get scrollTop(): number { return this.list.scrollTop; }
	set scrollTop(scrollTop: number) { this.list.scrollTop = scrollTop; }
	get scrollLeft(): number { return this.list.scrollLeft; }
	set scrollLeft(scrollLeft: number) { this.list.scrollLeft = scrollLeft; }
	get scrollHeight(): number { return this.list.scrollHeight; }
	get renderHeight(): number { return this.list.renderHeight; }
	get onDidDispose(): Event<void> { return this.list.onDidDispose; }

	constructor(
		user: string,
		container: HTMLElement,
		private virtualDelegate: ITableVirtualDelegate<TRow>,
		columns: ITableColumn<TRow, TCell>[],
		renderers: ITableRenderer<TCell, unknown>[],
		_options?: ITableOptions<TRow>
	) {
		this.domNode = append(container, $(`.monaco-table.${this.domId}`));

		const headers = columns.map((c, i) => new ColumnHeader(c, i));
		const descriptor: ISplitViewDescriptor = {
			size: headers.reduce((a, b) => a + b.column.weight, 0),
			views: headers.map(view => ({ size: view.column.weight, view }))
		};

		this.splitview = new SplitView(this.domNode, {
			orientation: Orientation.HORIZONTAL,
			scrollbarVisibility: ScrollbarVisibility.Hidden,
			getSashOrthogonalSize: () => this.cachedHeight,
			descriptor
		});

		this.splitview.el.style.height = `${virtualDelegate.headerRowHeight}px`;
		this.splitview.el.style.lineHeight = `${virtualDelegate.headerRowHeight}px`;

		const renderer = new TableListRenderer(columns, renderers, i => this.splitview.getViewSize(i));
		this.list = new List(user, this.domNode, asListVirtualDelegate(virtualDelegate), [renderer], _options);

		this.columnLayoutDisposable = Event.any(...headers.map(h => h.onDidLayout))
			(([index, size]) => renderer.layoutColumn(index, size));

		this.styleElement = createStyleSheet(this.domNode);
		this.style({});
	}

	updateOptions(options: ITableOptionsUpdate): void {
		this.list.updateOptions(options);
	}

	splice(start: number, deleteCount: number, elements: TRow[] = []): void {
		this.list.splice(start, deleteCount, elements);
	}

	rerender(): void {
		this.list.rerender();
	}

	row(index: number): TRow {
		return this.list.element(index);
	}

	indexOf(element: TRow): number {
		return this.list.indexOf(element);
	}

	get length(): number {
		return this.list.length;
	}

	getHTMLElement(): HTMLElement {
		return this.domNode;
	}

	layout(height?: number, width?: number): void {
		height = height ?? getContentHeight(this.domNode);
		width = width ?? getContentWidth(this.domNode);

		this.cachedHeight = height;
		this.splitview.layout(width);

		const listHeight = height - this.virtualDelegate.headerRowHeight;
		this.list.getHTMLElement().style.height = `${listHeight}px`;
		this.list.layout(listHeight, width);
	}

	toggleKeyboardNavigation(): void {
		this.list.toggleKeyboardNavigation();
	}

	style(styles: ITableStyles): void {
		const content: string[] = [];

		content.push(`.monaco-table.${this.domId} > .monaco-split-view2 .monaco-sash.vertical::before {
			top: ${this.virtualDelegate.headerRowHeight + 1}px;
			height: calc(100% - ${this.virtualDelegate.headerRowHeight}px);
		}`);

		this.styleElement.textContent = content.join('\n');
		this.list.style(styles);
	}

	domFocus(): void {
		this.list.domFocus();
	}

	setAnchor(index: number | undefined): void {
		this.list.setAnchor(index);
	}

	getAnchor(): number | undefined {
		return this.list.getAnchor();
	}

	getSelectedElements(): TRow[] {
		return this.list.getSelectedElements();
	}

	setSelection(indexes: number[], browserEvent?: UIEvent): void {
		this.list.setSelection(indexes, browserEvent);
	}

	getSelection(): number[] {
		return this.list.getSelection();
	}

	setFocus(indexes: number[], browserEvent?: UIEvent): void {
		this.list.setFocus(indexes, browserEvent);
	}

	focusNext(n = 1, loop = false, browserEvent?: UIEvent): void {
		this.list.focusNext(n, loop, browserEvent);
	}

	focusPrevious(n = 1, loop = false, browserEvent?: UIEvent): void {
		this.list.focusPrevious(n, loop, browserEvent);
	}

	focusNextPage(browserEvent?: UIEvent): Promise<void> {
		return this.list.focusNextPage(browserEvent);
	}

	focusPreviousPage(browserEvent?: UIEvent): Promise<void> {
		return this.list.focusPreviousPage(browserEvent);
	}

	focusFirst(browserEvent?: UIEvent): void {
		this.list.focusFirst(browserEvent);
	}

	focusLast(browserEvent?: UIEvent): void {
		this.list.focusLast(browserEvent);
	}

	getFocus(): number[] {
		return this.list.getFocus();
	}

	getFocusedElements(): TRow[] {
		return this.list.getFocusedElements();
	}

	reveal(index: number, relativeTop?: number): void {
		this.list.reveal(index, relativeTop);
	}

	dispose(): void {
		this.splitview.dispose();
		this.list.dispose();
		this.columnLayoutDisposable.dispose();
	}
}
