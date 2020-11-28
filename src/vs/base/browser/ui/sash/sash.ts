/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./sash';
import { IDisposable, dispose, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { isMacintosh } from 'vs/base/common/platform';
import * as types from 'vs/base/common/types';
import { EventType, GestureEvent, Gesture } from 'vs/base/browser/touch';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { Event, Emitter } from 'vs/base/common/event';
import { getElementsByTagName, EventHelper, createStyleSheet, addDisposableListener, append, $ } from 'vs/base/browser/dom';
import { domEvent } from 'vs/base/browser/event';

const DEBUG = false;

export interface ISashLayoutProvider { }

export interface IVerticalSashLayoutProvider extends ISashLayoutProvider {
	getVerticalSashLeft(sash: Sash): number;
	getVerticalSashTop?(sash: Sash): number;
	getVerticalSashHeight?(sash: Sash): number;
}

export interface IHorizontalSashLayoutProvider extends ISashLayoutProvider {
	getHorizontalSashTop(sash: Sash): number;
	getHorizontalSashLeft?(sash: Sash): number;
	getHorizontalSashWidth?(sash: Sash): number;
}

export interface ISashEvent {
	startX: number;
	currentX: number;
	startY: number;
	currentY: number;
	altKey: boolean;
}

export enum OrthogonalEdge {
	North = 'north',
	South = 'south',
	East = 'east',
	West = 'west'
}

export interface ISashOptions {
	readonly orientation: Orientation;
	readonly orthogonalStartSash?: Sash;
	readonly orthogonalEndSash?: Sash;
	readonly size?: number;
	readonly orthogonalEdge?: OrthogonalEdge;
}

export interface IVerticalSashOptions extends ISashOptions {
	readonly orientation: Orientation.VERTICAL;
}

export interface IHorizontalSashOptions extends ISashOptions {
	readonly orientation: Orientation.HORIZONTAL;
}

export const enum Orientation {
	VERTICAL,
	HORIZONTAL
}

export const enum SashState {
	Disabled,
	Minimum,
	Maximum,
	Enabled
}

let globalSize = 4;
const onDidChangeGlobalSize = new Emitter<number>();
export function setGlobalSashSize(size: number): void {
	globalSize = size;
	onDidChangeGlobalSize.fire(size);
}

export class Sash extends Disposable {

	private el: HTMLElement;
	private layoutProvider: ISashLayoutProvider;
	private hidden: boolean;
	private orientation!: Orientation;
	private size: number;

	private _state: SashState = SashState.Enabled;
	get state(): SashState { return this._state; }
	set state(state: SashState) {
		if (this._state === state) {
			return;
		}

		this.el.classList.toggle('disabled', state === SashState.Disabled);
		this.el.classList.toggle('minimum', state === SashState.Minimum);
		this.el.classList.toggle('maximum', state === SashState.Maximum);

		this._state = state;
		this._onDidEnablementChange.fire(state);
	}

	private readonly _onDidEnablementChange = this._register(new Emitter<SashState>());
	readonly onDidEnablementChange: Event<SashState> = this._onDidEnablementChange.event;

	private readonly _onDidStart = this._register(new Emitter<ISashEvent>());
	readonly onDidStart: Event<ISashEvent> = this._onDidStart.event;

	private readonly _onDidChange = this._register(new Emitter<ISashEvent>());
	readonly onDidChange: Event<ISashEvent> = this._onDidChange.event;

	private readonly _onDidReset = this._register(new Emitter<void>());
	readonly onDidReset: Event<void> = this._onDidReset.event;

	private readonly _onDidEnd = this._register(new Emitter<void>());
	readonly onDidEnd: Event<void> = this._onDidEnd.event;

	linkedSash: Sash | undefined = undefined;

	private readonly orthogonalStartSashDisposables = this._register(new DisposableStore());
	private _orthogonalStartSash: Sash | undefined;
	get orthogonalStartSash(): Sash | undefined { return this._orthogonalStartSash; }
	set orthogonalStartSash(sash: Sash | undefined) {
		this.orthogonalStartSashDisposables.clear();

		if (sash) {
			this.orthogonalStartSashDisposables.add(sash.onDidEnablementChange(this.onOrthogonalStartSashEnablementChange, this));
			this.onOrthogonalStartSashEnablementChange(sash.state);
		} else {
			this.onOrthogonalStartSashEnablementChange(SashState.Disabled);
		}

		this._orthogonalStartSash = sash;
	}

	private readonly orthogonalEndSashDisposables = this._register(new DisposableStore());
	private _orthogonalEndSash: Sash | undefined;
	get orthogonalEndSash(): Sash | undefined { return this._orthogonalEndSash; }
	set orthogonalEndSash(sash: Sash | undefined) {
		this.orthogonalEndSashDisposables.clear();

		if (sash) {
			this.orthogonalEndSashDisposables.add(sash.onDidEnablementChange(this.onOrthogonalEndSashEnablementChange, this));
			this.onOrthogonalEndSashEnablementChange(sash.state);
		} else {
			this.onOrthogonalEndSashEnablementChange(SashState.Disabled);
		}

		this._orthogonalEndSash = sash;
	}

	constructor(container: HTMLElement, layoutProvider: IVerticalSashLayoutProvider, options: ISashOptions);
	constructor(container: HTMLElement, layoutProvider: IHorizontalSashLayoutProvider, options: ISashOptions);
	constructor(container: HTMLElement, layoutProvider: ISashLayoutProvider, options: ISashOptions) {
		super();

		this.el = append(container, $('.monaco-sash'));

		if (options.orthogonalEdge) {
			this.el.classList.add(`orthogonal-edge-${options.orthogonalEdge}`);
		}

		if (isMacintosh) {
			this.el.classList.add('mac');
		}

		this._register(domEvent(this.el, 'mousedown')(this.onMouseDown, this));
		this._register(domEvent(this.el, 'dblclick')(this.onMouseDoubleClick, this));

		this._register(Gesture.addTarget(this.el));
		this._register(domEvent(this.el, EventType.Start)(this.onTouchStart, this));

		if (typeof options.size === 'number') {
			this.size = options.size;

			if (options.orientation === Orientation.VERTICAL) {
				this.el.style.width = `${this.size}px`;
			} else {
				this.el.style.height = `${this.size}px`;
			}
		} else {
			this.size = globalSize;
			this._register(onDidChangeGlobalSize.event(size => {
				this.size = size;
				this.layout();
			}));
		}

		this.hidden = false;
		this.layoutProvider = layoutProvider;

		this.orthogonalStartSash = options.orthogonalStartSash;
		this.orthogonalEndSash = options.orthogonalEndSash;

		this.orientation = options.orientation || Orientation.VERTICAL;

		if (this.orientation === Orientation.HORIZONTAL) {
			this.el.classList.add('horizontal');
			this.el.classList.remove('vertical');
		} else {
			this.el.classList.remove('horizontal');
			this.el.classList.add('vertical');
		}

		this.el.classList.toggle('debug', DEBUG);

		this.layout();
	}

	private onMouseDown(e: MouseEvent): void {
		EventHelper.stop(e, false);

		let isMultisashResize = false;

		if (!(e as any).__orthogonalSashEvent) {
			const orthogonalSash = this.getOrthogonalSash(e);

			if (orthogonalSash) {
				isMultisashResize = true;
				(e as any).__orthogonalSashEvent = true;
				orthogonalSash.onMouseDown(e);
			}
		}

		if (this.linkedSash && !(e as any).__linkedSashEvent) {
			(e as any).__linkedSashEvent = true;
			this.linkedSash.onMouseDown(e);
		}

		if (!this.state) {
			return;
		}

		// Select both iframes and webviews; internally Electron nests an iframe
		// in its <webview> component, but this isn't queryable.
		const iframes = [
			...getElementsByTagName('iframe'),
			...getElementsByTagName('webview'),
		];

		for (const iframe of iframes) {
			iframe.style.pointerEvents = 'none'; // disable mouse events on iframes as long as we drag the sash
		}

		const mouseDownEvent = new StandardMouseEvent(e);
		const startX = mouseDownEvent.posx;
		const startY = mouseDownEvent.posy;
		const altKey = mouseDownEvent.altKey;
		const startEvent: ISashEvent = { startX, currentX: startX, startY, currentY: startY, altKey };

		this.el.classList.add('active');
		this._onDidStart.fire(startEvent);

		// fix https://github.com/microsoft/vscode/issues/21675
		const style = createStyleSheet(this.el);
		const updateStyle = () => {
			let cursor = '';

			if (isMultisashResize) {
				cursor = 'all-scroll';
			} else if (this.orientation === Orientation.HORIZONTAL) {
				if (this.state === SashState.Minimum) {
					cursor = 's-resize';
				} else if (this.state === SashState.Maximum) {
					cursor = 'n-resize';
				} else {
					cursor = isMacintosh ? 'row-resize' : 'ns-resize';
				}
			} else {
				if (this.state === SashState.Minimum) {
					cursor = 'e-resize';
				} else if (this.state === SashState.Maximum) {
					cursor = 'w-resize';
				} else {
					cursor = isMacintosh ? 'col-resize' : 'ew-resize';
				}
			}

			style.textContent = `* { cursor: ${cursor} !important; }`;
		};

		const disposables = new DisposableStore();

		updateStyle();

		if (!isMultisashResize) {
			this.onDidEnablementChange(updateStyle, null, disposables);
		}

		const onMouseMove = (e: MouseEvent) => {
			EventHelper.stop(e, false);
			const mouseMoveEvent = new StandardMouseEvent(e);
			const event: ISashEvent = { startX, currentX: mouseMoveEvent.posx, startY, currentY: mouseMoveEvent.posy, altKey };

			this._onDidChange.fire(event);
		};

		const onMouseUp = (e: MouseEvent) => {
			EventHelper.stop(e, false);

			this.el.removeChild(style);

			this.el.classList.remove('active');
			this._onDidEnd.fire();

			disposables.dispose();

			for (const iframe of iframes) {
				iframe.style.pointerEvents = 'auto';
			}
		};

		domEvent(window, 'mousemove')(onMouseMove, null, disposables);
		domEvent(window, 'mouseup')(onMouseUp, null, disposables);
	}

	private onMouseDoubleClick(e: MouseEvent): void {
		const orthogonalSash = this.getOrthogonalSash(e);

		if (orthogonalSash) {
			orthogonalSash._onDidReset.fire();
		}

		if (this.linkedSash) {
			this.linkedSash._onDidReset.fire();
		}

		this._onDidReset.fire();
	}

	private onTouchStart(event: GestureEvent): void {
		EventHelper.stop(event);

		const listeners: IDisposable[] = [];

		const startX = event.pageX;
		const startY = event.pageY;
		const altKey = event.altKey;

		this._onDidStart.fire({
			startX: startX,
			currentX: startX,
			startY: startY,
			currentY: startY,
			altKey
		});

		listeners.push(addDisposableListener(this.el, EventType.Change, (event: GestureEvent) => {
			if (types.isNumber(event.pageX) && types.isNumber(event.pageY)) {
				this._onDidChange.fire({
					startX: startX,
					currentX: event.pageX,
					startY: startY,
					currentY: event.pageY,
					altKey
				});
			}
		}));

		listeners.push(addDisposableListener(this.el, EventType.End, (event: GestureEvent) => {
			this._onDidEnd.fire();
			dispose(listeners);
		}));
	}

	layout(): void {
		if (this.orientation === Orientation.VERTICAL) {
			const verticalProvider = (<IVerticalSashLayoutProvider>this.layoutProvider);
			this.el.style.left = verticalProvider.getVerticalSashLeft(this) - (this.size / 2) + 'px';

			if (verticalProvider.getVerticalSashTop) {
				this.el.style.top = verticalProvider.getVerticalSashTop(this) + 'px';
			}

			if (verticalProvider.getVerticalSashHeight) {
				this.el.style.height = verticalProvider.getVerticalSashHeight(this) + 'px';
			}
		} else {
			const horizontalProvider = (<IHorizontalSashLayoutProvider>this.layoutProvider);
			this.el.style.top = horizontalProvider.getHorizontalSashTop(this) - (this.size / 2) + 'px';

			if (horizontalProvider.getHorizontalSashLeft) {
				this.el.style.left = horizontalProvider.getHorizontalSashLeft(this) + 'px';
			}

			if (horizontalProvider.getHorizontalSashWidth) {
				this.el.style.width = horizontalProvider.getHorizontalSashWidth(this) + 'px';
			}
		}
	}

	show(): void {
		this.hidden = false;
		this.el.style.removeProperty('display');
		this.el.setAttribute('aria-hidden', 'false');
	}

	hide(): void {
		this.hidden = true;
		this.el.style.display = 'none';
		this.el.setAttribute('aria-hidden', 'true');
	}

	isHidden(): boolean {
		return this.hidden;
	}

	private onOrthogonalStartSashEnablementChange(state: SashState): void {
		this.el.classList.toggle('orthogonal-start', state !== SashState.Disabled);
	}

	private onOrthogonalEndSashEnablementChange(state: SashState): void {
		this.el.classList.toggle('orthogonal-end', state !== SashState.Disabled);
	}

	private getOrthogonalSash(e: MouseEvent): Sash | undefined {
		if (this.orientation === Orientation.VERTICAL) {
			if (e.offsetY <= this.size) {
				return this.orthogonalStartSash;
			} else if (e.offsetY >= this.el.clientHeight - this.size) {
				return this.orthogonalEndSash;
			}
		} else {
			if (e.offsetX <= this.size) {
				return this.orthogonalStartSash;
			} else if (e.offsetX >= this.el.clientWidth - this.size) {
				return this.orthogonalEndSash;
			}
		}

		return undefined;
	}

	dispose(): void {
		super.dispose();
		this.el.remove();
	}
}
