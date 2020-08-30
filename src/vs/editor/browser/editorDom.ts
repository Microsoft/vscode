/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { GlobalMouseMoveMonitor } from 'vs/base/browser/globalMouseMoveMonitor';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';

/**
 * Coordinates relative to the whole document (e.g. mouse event's pageX and pageY)
 */
export class PageCoordinates {
	_pageCoordinatesBrand: void;

	constructor(
		public readonly x: number,
		public readonly y: number
	) { }

	public toClientCoordinates(): ClientCoordinates {
		return new ClientCoordinates(this.x - dom.StandardWindow.scrollX, this.y - dom.StandardWindow.scrollY);
	}
}

/**
 * Coordinates within the application's client area (i.e. origin is document's scroll position).
 *
 * For example, clicking in the top-left corner of the client area will
 * always result in a mouse event with a client.x value of 0, regardless
 * of whether the page is scrolled horizontally.
 */
export class ClientCoordinates {
	_clientCoordinatesBrand: void;

	constructor(
		public readonly clientX: number,
		public readonly clientY: number
	) { }

	public toPageCoordinates(): PageCoordinates {
		return new PageCoordinates(this.clientX + dom.StandardWindow.scrollX, this.clientY + dom.StandardWindow.scrollY);
	}
}

/**
 * The position of the editor in the page.
 */
export class EditorPagePosition {
	_editorPagePositionBrand: void;

	constructor(
		public readonly x: number,
		public readonly y: number,
		public readonly width: number,
		public readonly height: number
	) { }
}

export function createEditorPagePosition(editorViewDomNode: HTMLElement): EditorPagePosition {
	const editorPos = dom.getDomNodePagePosition(editorViewDomNode);
	return new EditorPagePosition(editorPos.left, editorPos.top, editorPos.width, editorPos.height);
}

export class EditorMouseEvent extends StandardMouseEvent {
	_editorMouseEventBrand: void;

	/**
	 * Coordinates relative to the whole document.
	 */
	public readonly pos: PageCoordinates;

	/**
	 * Editor's coordinates relative to the whole document.
	 */
	public readonly editorPos: EditorPagePosition;

	constructor(e: MouseEvent, editorViewDomNode: HTMLElement) {
		super(e);
		this.pos = new PageCoordinates(this.posx, this.posy);
		this.editorPos = createEditorPagePosition(editorViewDomNode);
	}
}

export interface EditorMouseEventMerger {
	(lastEvent: EditorMouseEvent | null, currentEvent: EditorMouseEvent): EditorMouseEvent;
}

export class EditorMouseEventFactory {

	private readonly _editorViewDomNode: HTMLElement;

	constructor(editorViewDomNode: HTMLElement) {
		this._editorViewDomNode = editorViewDomNode;
	}

	private _create(e: MouseEvent): EditorMouseEvent {
		return new EditorMouseEvent(e, this._editorViewDomNode);
	}

	public onContextMenu(target: HTMLElement, callback: (e: EditorMouseEvent) => void): IDisposable {
		return dom.addDisposableListener(target, 'contextmenu', (e: MouseEvent) => {
			callback(this._create(e));
		});
	}

	public onMouseUp(target: HTMLElement, callback: (e: EditorMouseEvent) => void): IDisposable {
		return dom.addDisposableListener(target, 'mouseup', (e: MouseEvent) => {
			callback(this._create(e));
		});
	}

	public onMouseDown(target: HTMLElement, callback: (e: EditorMouseEvent) => void): IDisposable {
		return dom.addDisposableListener(target, 'mousedown', (e: MouseEvent) => {
			callback(this._create(e));
		});
	}

	public onMouseLeave(target: HTMLElement, callback: (e: EditorMouseEvent) => void): IDisposable {
		return dom.addDisposableNonBubblingMouseOutListener(target, (e: MouseEvent) => {
			callback(this._create(e));
		});
	}

	public onMouseMoveThrottled(target: HTMLElement, callback: (e: EditorMouseEvent) => void, merger: EditorMouseEventMerger, minimumTimeMs: number): IDisposable {
		const myMerger: dom.IEventMerger<EditorMouseEvent, MouseEvent> = (lastEvent: EditorMouseEvent | null, currentEvent: MouseEvent): EditorMouseEvent => {
			return merger(lastEvent, this._create(currentEvent));
		};
		return dom.addDisposableThrottledListener<EditorMouseEvent, MouseEvent>(target, 'mousemove', callback, myMerger, minimumTimeMs);
	}
}

export class EditorPointerEventFactory {

	private readonly _editorViewDomNode: HTMLElement;

	constructor(editorViewDomNode: HTMLElement) {
		this._editorViewDomNode = editorViewDomNode;
	}

	private _create(e: MouseEvent): EditorMouseEvent {
		return new EditorMouseEvent(e, this._editorViewDomNode);
	}

	public onPointerUp(target: HTMLElement, callback: (e: EditorMouseEvent) => void): IDisposable {
		return dom.addDisposableListener(target, 'pointerup', (e: MouseEvent) => {
			callback(this._create(e));
		});
	}

	public onPointerDown(target: HTMLElement, callback: (e: EditorMouseEvent) => void): IDisposable {
		return dom.addDisposableListener(target, 'pointerdown', (e: MouseEvent) => {
			callback(this._create(e));
		});
	}

	public onPointerLeave(target: HTMLElement, callback: (e: EditorMouseEvent) => void): IDisposable {
		return dom.addDisposableNonBubblingPointerOutListener(target, (e: MouseEvent) => {
			callback(this._create(e));
		});
	}

	public onPointerMoveThrottled(target: HTMLElement, callback: (e: EditorMouseEvent) => void, merger: EditorMouseEventMerger, minimumTimeMs: number): IDisposable {
		const myMerger: dom.IEventMerger<EditorMouseEvent, MouseEvent> = (lastEvent: EditorMouseEvent | null, currentEvent: MouseEvent): EditorMouseEvent => {
			return merger(lastEvent, this._create(currentEvent));
		};
		return dom.addDisposableThrottledListener<EditorMouseEvent, MouseEvent>(target, 'pointermove', callback, myMerger, minimumTimeMs);
	}
}

export class GlobalEditorMouseMoveMonitor extends Disposable {

	private readonly _editorViewDomNode: HTMLElement;
	private readonly _globalMouseMoveMonitor: GlobalMouseMoveMonitor<EditorMouseEvent>;
	private _keydownListener: IDisposable | null;

	constructor(editorViewDomNode: HTMLElement) {
		super();
		this._editorViewDomNode = editorViewDomNode;
		this._globalMouseMoveMonitor = this._register(new GlobalMouseMoveMonitor<EditorMouseEvent>());
		this._keydownListener = null;
	}

	public startMonitoring(
		initialElement: HTMLElement,
		initialButtons: number,
		merger: EditorMouseEventMerger,
		mouseMoveCallback: (e: EditorMouseEvent) => void,
		onStopCallback: () => void
	): void {

		// Add a <<capture>> keydown event listener that will cancel the monitoring
		// if something other than a modifier key is pressed
		this._keydownListener = dom.addStandardDisposableListener(<any>document, 'keydown', (e) => {
			const kb = e.toKeybinding();
			if (kb.isModifierKey()) {
				// Allow modifier keys
				return;
			}
			this._globalMouseMoveMonitor.stopMonitoring(true);
		}, true);

		const myMerger: dom.IEventMerger<EditorMouseEvent, MouseEvent> = (lastEvent: EditorMouseEvent | null, currentEvent: MouseEvent): EditorMouseEvent => {
			return merger(lastEvent, new EditorMouseEvent(currentEvent, this._editorViewDomNode));
		};

		this._globalMouseMoveMonitor.startMonitoring(initialElement, initialButtons, myMerger, mouseMoveCallback, () => {
			this._keydownListener!.dispose();
			onStopCallback();
		});
	}
}
