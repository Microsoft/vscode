/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./list';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { range } from 'vs/base/common/arrays';
import { IListVirtualDelegate, IListRenderer, IListEvent, IListContextMenuEvent, IListMouseEvent } from './list';
import { List, IListStyles, IListOptions, IListAccessibilityProvider, IListOptionsUpdate } from './listWidget';
import { IPagedModel } from 'vs/base/common/paging';
import { Event } from 'vs/base/common/event';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { IThemable } from 'vs/base/common/styler';

export interface IPagedRenderer<TElement, TTemplateData> extends IListRenderer<TElement, TTemplateData> {
	renderPlaceholder(index: number, templateData: TTemplateData): void;
}

export interface ITemplateData<T> {
	data?: T;
	disposable?: IDisposable;
}

class PagedRenderer<TElement, TTemplateData> implements IListRenderer<number, ITemplateData<TTemplateData>> {

	get templateId(): string { return this.renderer.templateId; }

	constructor(
		private renderer: IPagedRenderer<TElement, TTemplateData>,
		private modelProvider: () => IPagedModel<TElement>
	) { }

	renderTemplate(container: HTMLElement): ITemplateData<TTemplateData> {
		const data = this.renderer.renderTemplate(container);
		return { data, disposable: Disposable.None };
	}

	renderElement(index: number, _: number, data: ITemplateData<TTemplateData>, height: number | undefined): void {
		if (data.disposable) {
			data.disposable.dispose();
		}

		if (!data.data) {
			return;
		}

		const model = this.modelProvider();

		if (model.isResolved(index)) {
			return this.renderer.renderElement(model.get(index), index, data.data, height);
		}

		const cts = new CancellationTokenSource();
		const promise = model.resolve(index, cts.token);
		data.disposable = { dispose: () => cts.cancel() };

		this.renderer.renderPlaceholder(index, data.data);
		promise.then(entry => this.renderer.renderElement(entry, index, data.data!, height));
	}

	disposeTemplate(data: ITemplateData<TTemplateData>): void {
		if (data.disposable) {
			data.disposable.dispose();
			data.disposable = undefined;
		}
		if (data.data) {
			this.renderer.disposeTemplate(data.data);
			data.data = undefined;
		}
	}
}

class PagedAccessibilityProvider<T> implements IListAccessibilityProvider<number> {

	constructor(
		private modelProvider: () => IPagedModel<T>,
		private accessibilityProvider: IListAccessibilityProvider<T>
	) { }

	getWidgetAriaLabel(): string {
		return this.accessibilityProvider.getWidgetAriaLabel();
	}

	getAriaLabel(index: number): string | null {
		const model = this.modelProvider();

		if (!model.isResolved(index)) {
			return null;
		}

		return this.accessibilityProvider.getAriaLabel(model.get(index));
	}
}

export interface IPagedListOptions<T> {
	readonly enableKeyboardNavigation?: boolean;
	readonly automaticKeyboardNavigation?: boolean;
	readonly ariaLabel?: string;
	readonly keyboardSupport?: boolean;
	readonly multipleSelectionSupport?: boolean;
	readonly accessibilityProvider?: IListAccessibilityProvider<T>;

	// list view options
	readonly useShadows?: boolean;
	readonly verticalScrollMode?: ScrollbarVisibility;
	readonly setRowLineHeight?: boolean;
	readonly setRowHeight?: boolean;
	readonly supportDynamicHeights?: boolean;
	readonly mouseSupport?: boolean;
	readonly horizontalScrolling?: boolean;
	readonly additionalScrollHeight?: number;
}

function fromPagedListOptions<T>(modelProvider: () => IPagedModel<T>, options: IPagedListOptions<T>): IListOptions<number> {
	return {
		...options,
		accessibilityProvider: options.accessibilityProvider && new PagedAccessibilityProvider(modelProvider, options.accessibilityProvider)
	};
}

export class PagedList<T> implements IThemable, IDisposable {

	private list: List<number>;
	private _model!: IPagedModel<T>;

	constructor(
		user: string,
		container: HTMLElement,
		virtualDelegate: IListVirtualDelegate<number>,
		renderers: IPagedRenderer<T, any>[],
		options: IPagedListOptions<T> = {}
	) {
		const modelProvider = () => this.model;
		const pagedRenderers = renderers.map(r => new PagedRenderer<T, ITemplateData<T>>(r, modelProvider));
		this.list = new List(user, container, virtualDelegate, pagedRenderers, fromPagedListOptions(modelProvider, options));
	}

	updateOptions(options: IListOptionsUpdate) {
		this.list.updateOptions(options);
	}

	getHTMLElement(): HTMLElement {
		return this.list.getHTMLElement();
	}

	isDOMFocused(): boolean {
		return this.list.getHTMLElement() === document.activeElement;
	}

	domFocus(): void {
		this.list.domFocus();
	}

	get onDidFocus(): Event<void> {
		return this.list.onDidFocus;
	}

	get onDidBlur(): Event<void> {
		return this.list.onDidBlur;
	}

	get widget(): List<number> {
		return this.list;
	}

	get onDidDispose(): Event<void> {
		return this.list.onDidDispose;
	}

	get onMouseClick(): Event<IListMouseEvent<T>> {
		return Event.map(this.list.onMouseClick, ({ element, index, browserEvent }) => ({ element: element === undefined ? undefined : this._model.get(element), index, browserEvent }));
	}

	get onMouseDblClick(): Event<IListMouseEvent<T>> {
		return Event.map(this.list.onMouseDblClick, ({ element, index, browserEvent }) => ({ element: element === undefined ? undefined : this._model.get(element), index, browserEvent }));
	}

	get onTap(): Event<IListMouseEvent<T>> {
		return Event.map(this.list.onTap, ({ element, index, browserEvent }) => ({ element: element === undefined ? undefined : this._model.get(element), index, browserEvent }));
	}

	get onPointer(): Event<IListMouseEvent<T>> {
		return Event.map(this.list.onPointer, ({ element, index, browserEvent }) => ({ element: element === undefined ? undefined : this._model.get(element), index, browserEvent }));
	}

	get onDidChangeFocus(): Event<IListEvent<T>> {
		return Event.map(this.list.onDidChangeFocus, ({ elements, indexes, browserEvent }) => ({ elements: elements.map(e => this._model.get(e)), indexes, browserEvent }));
	}

	get onDidChangeSelection(): Event<IListEvent<T>> {
		return Event.map(this.list.onDidChangeSelection, ({ elements, indexes, browserEvent }) => ({ elements: elements.map(e => this._model.get(e)), indexes, browserEvent }));
	}

	get onContextMenu(): Event<IListContextMenuEvent<T>> {
		return Event.map(this.list.onContextMenu, ({ element, index, anchor, browserEvent }) => (typeof element === 'undefined' ? { element, index, anchor, browserEvent } : { element: this._model.get(element), index, anchor, browserEvent }));
	}

	get model(): IPagedModel<T> {
		return this._model;
	}

	set model(model: IPagedModel<T>) {
		this._model = model;
		this.list.splice(0, this.list.length, range(model.length));
	}

	get length(): number {
		return this.list.length;
	}

	get scrollTop(): number {
		return this.list.scrollTop;
	}

	set scrollTop(scrollTop: number) {
		this.list.scrollTop = scrollTop;
	}

	get scrollLeft(): number {
		return this.list.scrollLeft;
	}

	set scrollLeft(scrollLeft: number) {
		this.list.scrollLeft = scrollLeft;
	}

	setAnchor(index: number | undefined): void {
		this.list.setAnchor(index);
	}

	getAnchor(): number | undefined {
		return this.list.getAnchor();
	}

	setFocus(indexes: number[]): void {
		this.list.setFocus(indexes);
	}

	focusNext(n?: number, loop?: boolean): void {
		this.list.focusNext(n, loop);
	}

	focusPrevious(n?: number, loop?: boolean): void {
		this.list.focusPrevious(n, loop);
	}

	focusNextPage(): Promise<void> {
		return this.list.focusNextPage();
	}

	focusPreviousPage(): Promise<void> {
		return this.list.focusPreviousPage();
	}

	focusLast(): void {
		this.list.focusLast();
	}

	focusFirst(): void {
		this.list.focusFirst();
	}

	getFocus(): number[] {
		return this.list.getFocus();
	}

	setSelection(indexes: number[], browserEvent?: UIEvent): void {
		this.list.setSelection(indexes, browserEvent);
	}

	getSelection(): number[] {
		return this.list.getSelection();
	}

	getSelectedElements(): T[] {
		return this.getSelection().map(i => this.model.get(i));
	}

	layout(height?: number, width?: number): void {
		this.list.layout(height, width);
	}

	toggleKeyboardNavigation(): void {
		this.list.toggleKeyboardNavigation();
	}

	reveal(index: number, relativeTop?: number): void {
		this.list.reveal(index, relativeTop);
	}

	style(styles: IListStyles): void {
		this.list.style(styles);
	}

	dispose(): void {
		this.list.dispose();
	}
}
