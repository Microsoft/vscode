/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./paneview';
import { IDisposable, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { domEvent } from 'vs/base/browser/event';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { $, append, trackFocus, EventHelper, clearNode } from 'vs/base/browser/dom';
import { Color, RGBA } from 'vs/base/common/color';
import { SplitView, IView } from './splitview';
import { isFirefox } from 'vs/base/browser/browser';
import { DataTransfers } from 'vs/base/browser/dnd';
import { Orientation } from 'vs/base/browser/ui/sash/sash';
import { localize } from 'vs/nls';

export interface IPaneOptions {
	minimumBodySize?: number;
	maximumBodySize?: number;
	expanded?: boolean;
	orientation?: Orientation;
	title: string;
	titleDescription?: string;
}

export interface IPaneStyles {
	dropBackground?: Color;
	headerForeground?: Color;
	headerBackground?: Color;
	headerBorder?: Color;
	leftBorder?: Color;
}

/**
 * A Pane is a structured SplitView view.
 *
 * WARNING: You must call `render()` after you contruct it.
 * It can't be done automatically at the end of the ctor
 * because of the order of property initialization in TypeScript.
 * Subclasses wouldn't be able to set own properties
 * before the `render()` call, thus forbiding their use.
 */
export abstract class Pane extends Disposable implements IView {

	private static readonly HEADER_SIZE = 22;

	readonly element: HTMLElement;
	private header!: HTMLElement;
	private body!: HTMLElement;

	protected _expanded: boolean;
	protected _orientation: Orientation;

	private expandedSize: number | undefined = undefined;
	private _headerVisible = true;
	private _minimumBodySize: number;
	private _maximumBodySize: number;
	private ariaHeaderLabel: string;
	private styles: IPaneStyles = {};
	private animationTimer: number | undefined = undefined;

	private readonly _onDidChange = this._register(new Emitter<number | undefined>());
	readonly onDidChange: Event<number | undefined> = this._onDidChange.event;

	private readonly _onDidChangeExpansionState = this._register(new Emitter<boolean>());
	readonly onDidChangeExpansionState: Event<boolean> = this._onDidChangeExpansionState.event;

	get draggableElement(): HTMLElement {
		return this.header;
	}

	get dropTargetElement(): HTMLElement {
		return this.element;
	}

	private _dropBackground: Color | undefined;
	get dropBackground(): Color | undefined {
		return this._dropBackground;
	}

	get minimumBodySize(): number {
		return this._minimumBodySize;
	}

	set minimumBodySize(size: number) {
		this._minimumBodySize = size;
		this._onDidChange.fire(undefined);
	}

	get maximumBodySize(): number {
		return this._maximumBodySize;
	}

	set maximumBodySize(size: number) {
		this._maximumBodySize = size;
		this._onDidChange.fire(undefined);
	}

	private get headerSize(): number {
		return this.headerVisible ? Pane.HEADER_SIZE : 0;
	}

	get minimumSize(): number {
		const headerSize = this.headerSize;
		const expanded = !this.headerVisible || this.isExpanded();
		const minimumBodySize = expanded ? this.minimumBodySize : 0;

		return headerSize + minimumBodySize;
	}

	get maximumSize(): number {
		const headerSize = this.headerSize;
		const expanded = !this.headerVisible || this.isExpanded();
		const maximumBodySize = expanded ? this.maximumBodySize : 0;

		return headerSize + maximumBodySize;
	}

	orthogonalSize: number = 0;

	constructor(options: IPaneOptions) {
		super();
		this._expanded = typeof options.expanded === 'undefined' ? true : !!options.expanded;
		this._orientation = typeof options.orientation === 'undefined' ? Orientation.VERTICAL : options.orientation;
		this.ariaHeaderLabel = localize('viewSection', "{0} Section", options.title);
		this._minimumBodySize = typeof options.minimumBodySize === 'number' ? options.minimumBodySize : this._orientation === Orientation.HORIZONTAL ? 200 : 120;
		this._maximumBodySize = typeof options.maximumBodySize === 'number' ? options.maximumBodySize : Number.POSITIVE_INFINITY;

		this.element = $('.pane');
	}

	isExpanded(): boolean {
		return this._expanded;
	}

	setExpanded(expanded: boolean): boolean {
		if (this._expanded === !!expanded) {
			return false;
		}

		if (this.element) {
			this.element.classList.toggle('expanded', expanded);
		}

		this._expanded = !!expanded;
		this.updateHeader();

		if (expanded) {
			if (typeof this.animationTimer === 'number') {
				clearTimeout(this.animationTimer);
			}
			append(this.element, this.body);
		} else {
			this.animationTimer = window.setTimeout(() => {
				this.body.remove();
			}, 200);
		}

		this._onDidChangeExpansionState.fire(expanded);
		this._onDidChange.fire(expanded ? this.expandedSize : undefined);
		return true;
	}

	get headerVisible(): boolean {
		return this._headerVisible;
	}

	set headerVisible(visible: boolean) {
		if (this._headerVisible === !!visible) {
			return;
		}

		this._headerVisible = !!visible;
		this.updateHeader();
		this._onDidChange.fire(undefined);
	}

	get orientation(): Orientation {
		return this._orientation;
	}

	set orientation(orientation: Orientation) {
		if (this._orientation === orientation) {
			return;
		}

		this._orientation = orientation;

		if (this.element) {
			this.element.classList.toggle('horizontal', this.orientation === Orientation.HORIZONTAL);
			this.element.classList.toggle('vertical', this.orientation === Orientation.VERTICAL);
		}

		if (this.header) {
			this.updateHeader();
		}
	}

	render(): void {
		this.element.classList.toggle('expanded', this.isExpanded());
		this.element.classList.toggle('horizontal', this.orientation === Orientation.HORIZONTAL);
		this.element.classList.toggle('vertical', this.orientation === Orientation.VERTICAL);

		this.header = $('.pane-header');
		append(this.element, this.header);
		this.header.setAttribute('tabindex', '0');
		// Use role button so the aria-expanded state gets read https://github.com/microsoft/vscode/issues/95996
		this.header.setAttribute('role', 'button');
		this.header.setAttribute('aria-label', this.ariaHeaderLabel);
		this.renderHeader(this.header);

		const focusTracker = trackFocus(this.header);
		this._register(focusTracker);
		this._register(focusTracker.onDidFocus(() => this.header.classList.add('focused'), null));
		this._register(focusTracker.onDidBlur(() => this.header.classList.remove('focused'), null));

		this.updateHeader();


		const onHeaderKeyDown = Event.chain(domEvent(this.header, 'keydown'))
			.map(e => new StandardKeyboardEvent(e));

		this._register(onHeaderKeyDown.filter(e => e.keyCode === KeyCode.Enter || e.keyCode === KeyCode.Space)
			.event(() => this.setExpanded(!this.isExpanded()), null));

		this._register(onHeaderKeyDown.filter(e => e.keyCode === KeyCode.LeftArrow)
			.event(() => this.setExpanded(false), null));

		this._register(onHeaderKeyDown.filter(e => e.keyCode === KeyCode.RightArrow)
			.event(() => this.setExpanded(true), null));

		this._register(domEvent(this.header, 'click')
			(e => {
				if (!e.defaultPrevented) {
					this.setExpanded(!this.isExpanded());
				}
			}, null));

		this.body = append(this.element, $('.pane-body'));
		this.renderBody(this.body);

		if (!this.isExpanded()) {
			this.body.remove();
		}
	}

	layout(size: number): void {
		const headerSize = this.headerVisible ? Pane.HEADER_SIZE : 0;

		const width = this._orientation === Orientation.VERTICAL ? this.orthogonalSize : size;
		const height = this._orientation === Orientation.VERTICAL ? size - headerSize : this.orthogonalSize - headerSize;

		if (this.isExpanded()) {
			this.body.classList.toggle('wide', width >= 600);
			this.layoutBody(height, width);
			this.expandedSize = size;
		}
	}

	style(styles: IPaneStyles): void {
		this.styles = styles;

		if (!this.header) {
			return;
		}

		this.updateHeader();
	}

	protected updateHeader(): void {
		const expanded = !this.headerVisible || this.isExpanded();

		this.header.style.lineHeight = `${this.headerSize}px`;
		this.header.classList.toggle('hidden', !this.headerVisible);
		this.header.classList.toggle('expanded', expanded);
		this.header.setAttribute('aria-expanded', String(expanded));

		this.header.style.color = this.styles.headerForeground ? this.styles.headerForeground.toString() : '';
		this.header.style.backgroundColor = this.styles.headerBackground ? this.styles.headerBackground.toString() : '';
		this.header.style.borderTop = this.styles.headerBorder && this.orientation === Orientation.VERTICAL ? `1px solid ${this.styles.headerBorder}` : '';
		this._dropBackground = this.styles.dropBackground;
		this.element.style.borderLeft = this.styles.leftBorder && this.orientation === Orientation.HORIZONTAL ? `1px solid ${this.styles.leftBorder}` : '';
	}

	protected abstract renderHeader(container: HTMLElement): void;
	protected abstract renderBody(container: HTMLElement): void;
	protected abstract layoutBody(height: number, width: number): void;
}

interface IDndContext {
	draggable: PaneDraggable | null;
}

class PaneDraggable extends Disposable {

	private static readonly DefaultDragOverBackgroundColor = new Color(new RGBA(128, 128, 128, 0.5));

	private dragOverCounter = 0; // see https://github.com/microsoft/vscode/issues/14470

	private _onDidDrop = this._register(new Emitter<{ from: Pane, to: Pane }>());
	readonly onDidDrop = this._onDidDrop.event;

	constructor(private pane: Pane, private dnd: IPaneDndController, private context: IDndContext) {
		super();

		pane.draggableElement.draggable = true;
		this._register(domEvent(pane.draggableElement, 'dragstart')(this.onDragStart, this));
		this._register(domEvent(pane.dropTargetElement, 'dragenter')(this.onDragEnter, this));
		this._register(domEvent(pane.dropTargetElement, 'dragleave')(this.onDragLeave, this));
		this._register(domEvent(pane.dropTargetElement, 'dragend')(this.onDragEnd, this));
		this._register(domEvent(pane.dropTargetElement, 'drop')(this.onDrop, this));
	}

	private onDragStart(e: DragEvent): void {
		if (!this.dnd.canDrag(this.pane) || !e.dataTransfer) {
			e.preventDefault();
			e.stopPropagation();
			return;
		}

		e.dataTransfer.effectAllowed = 'move';

		if (isFirefox) {
			// Firefox: requires to set a text data transfer to get going
			e.dataTransfer?.setData(DataTransfers.TEXT, this.pane.draggableElement.textContent || '');
		}

		const dragImage = append(document.body, $('.monaco-drag-image', {}, this.pane.draggableElement.textContent || ''));
		e.dataTransfer.setDragImage(dragImage, -10, -10);
		setTimeout(() => document.body.removeChild(dragImage), 0);

		this.context.draggable = this;
	}

	private onDragEnter(e: DragEvent): void {
		if (!this.context.draggable || this.context.draggable === this) {
			return;
		}

		if (!this.dnd.canDrop(this.context.draggable.pane, this.pane)) {
			return;
		}

		this.dragOverCounter++;
		this.render();
	}

	private onDragLeave(e: DragEvent): void {
		if (!this.context.draggable || this.context.draggable === this) {
			return;
		}

		if (!this.dnd.canDrop(this.context.draggable.pane, this.pane)) {
			return;
		}

		this.dragOverCounter--;

		if (this.dragOverCounter === 0) {
			this.render();
		}
	}

	private onDragEnd(e: DragEvent): void {
		if (!this.context.draggable) {
			return;
		}

		this.dragOverCounter = 0;
		this.render();
		this.context.draggable = null;
	}

	private onDrop(e: DragEvent): void {
		if (!this.context.draggable) {
			return;
		}

		EventHelper.stop(e);

		this.dragOverCounter = 0;
		this.render();

		if (this.dnd.canDrop(this.context.draggable.pane, this.pane) && this.context.draggable !== this) {
			this._onDidDrop.fire({ from: this.context.draggable.pane, to: this.pane });
		}

		this.context.draggable = null;
	}

	private render(): void {
		let backgroundColor: string | null = null;

		if (this.dragOverCounter > 0) {
			backgroundColor = (this.pane.dropBackground || PaneDraggable.DefaultDragOverBackgroundColor).toString();
		}

		this.pane.dropTargetElement.style.backgroundColor = backgroundColor || '';
	}
}

export interface IPaneDndController {
	canDrag(pane: Pane): boolean;
	canDrop(pane: Pane, overPane: Pane): boolean;
}

export class DefaultPaneDndController implements IPaneDndController {

	canDrag(pane: Pane): boolean {
		return true;
	}

	canDrop(pane: Pane, overPane: Pane): boolean {
		return true;
	}
}

export interface IPaneViewOptions {
	dnd?: IPaneDndController;
	orientation?: Orientation;
}

interface IPaneItem {
	pane: Pane;
	disposable: IDisposable;
}

export class PaneView extends Disposable {

	private dnd: IPaneDndController | undefined;
	private dndContext: IDndContext = { draggable: null };
	readonly element: HTMLElement;
	private paneItems: IPaneItem[] = [];
	private orthogonalSize: number = 0;
	private size: number = 0;
	private splitview: SplitView;
	private animationTimer: number | undefined = undefined;

	private _onDidDrop = this._register(new Emitter<{ from: Pane, to: Pane }>());
	readonly onDidDrop: Event<{ from: Pane, to: Pane }> = this._onDidDrop.event;

	orientation: Orientation;
	readonly onDidSashChange: Event<number>;

	constructor(container: HTMLElement, options: IPaneViewOptions = {}) {
		super();

		this.dnd = options.dnd;
		this.orientation = options.orientation ?? Orientation.VERTICAL;
		this.element = append(container, $('.monaco-pane-view'));
		this.splitview = this._register(new SplitView(this.element, { orientation: this.orientation }));
		this.onDidSashChange = this.splitview.onDidSashChange;
	}

	addPane(pane: Pane, size: number, index = this.splitview.length): void {
		const disposables = new DisposableStore();
		pane.onDidChangeExpansionState(this.setupAnimation, this, disposables);

		const paneItem = { pane: pane, disposable: disposables };
		this.paneItems.splice(index, 0, paneItem);
		pane.orientation = this.orientation;
		pane.orthogonalSize = this.orthogonalSize;
		this.splitview.addView(pane, size, index);

		if (this.dnd) {
			const draggable = new PaneDraggable(pane, this.dnd, this.dndContext);
			disposables.add(draggable);
			disposables.add(draggable.onDidDrop(this._onDidDrop.fire, this._onDidDrop));
		}
	}

	removePane(pane: Pane): void {
		const index = this.paneItems.findIndex(item => item.pane === pane);

		if (index === -1) {
			return;
		}

		this.splitview.removeView(index);
		const paneItem = this.paneItems.splice(index, 1)[0];
		paneItem.disposable.dispose();
	}

	movePane(from: Pane, to: Pane): void {
		const fromIndex = this.paneItems.findIndex(item => item.pane === from);
		const toIndex = this.paneItems.findIndex(item => item.pane === to);

		if (fromIndex === -1 || toIndex === -1) {
			return;
		}

		const [paneItem] = this.paneItems.splice(fromIndex, 1);
		this.paneItems.splice(toIndex, 0, paneItem);

		this.splitview.moveView(fromIndex, toIndex);
	}

	resizePane(pane: Pane, size: number): void {
		const index = this.paneItems.findIndex(item => item.pane === pane);

		if (index === -1) {
			return;
		}

		this.splitview.resizeView(index, size);
	}

	getPaneSize(pane: Pane): number {
		const index = this.paneItems.findIndex(item => item.pane === pane);

		if (index === -1) {
			return -1;
		}

		return this.splitview.getViewSize(index);
	}

	layout(height: number, width: number): void {
		this.orthogonalSize = this.orientation === Orientation.VERTICAL ? width : height;
		this.size = this.orientation === Orientation.HORIZONTAL ? width : height;

		for (const paneItem of this.paneItems) {
			paneItem.pane.orthogonalSize = this.orthogonalSize;
		}

		this.splitview.layout(this.size);
	}

	flipOrientation(height: number, width: number): void {
		this.orientation = this.orientation === Orientation.VERTICAL ? Orientation.HORIZONTAL : Orientation.VERTICAL;
		const paneSizes = this.paneItems.map(pane => this.getPaneSize(pane.pane));

		this.splitview.dispose();
		clearNode(this.element);

		this.splitview = this._register(new SplitView(this.element, { orientation: this.orientation }));

		const newOrthogonalSize = this.orientation === Orientation.VERTICAL ? width : height;
		const newSize = this.orientation === Orientation.HORIZONTAL ? width : height;

		this.paneItems.forEach((pane, index) => {
			pane.pane.orthogonalSize = newOrthogonalSize;
			pane.pane.orientation = this.orientation;

			const viewSize = this.size === 0 ? 0 : (newSize * paneSizes[index]) / this.size;
			this.splitview.addView(pane.pane, viewSize, index);
		});

		this.size = newSize;
		this.orthogonalSize = newOrthogonalSize;

		this.splitview.layout(this.size);
	}

	private setupAnimation(): void {
		if (typeof this.animationTimer === 'number') {
			window.clearTimeout(this.animationTimer);
		}

		this.element.classList.add('animated');

		this.animationTimer = window.setTimeout(() => {
			this.animationTimer = undefined;
			this.element.classList.remove('animated');
		}, 200);
	}

	override dispose(): void {
		super.dispose();

		this.paneItems.forEach(i => i.disposable.dispose());
	}
}
