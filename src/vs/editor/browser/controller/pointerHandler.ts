/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import * as platform from 'vs/base/common/platform';
import { EventType, Gesture, GestureEvent } from 'vs/base/browser/touch';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { IPointerHandlerHelper, MouseHandler, createMouseMoveEventMerger } from 'vs/editor/browser/controller/mouseHandler';
import { IMouseTarget } from 'vs/editor/browser/editorBrowser';
import { EditorMouseEvent, EditorPointerEventFactory } from 'vs/editor/browser/editorDom';
import { ViewController } from 'vs/editor/browser/view/viewController';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import { BrowserFeatures } from 'vs/base/browser/canIUse';

interface IThrottledGestureEvent {
	translationX: number;
	translationY: number;
}

function gestureChangeEventMerger(lastEvent: IThrottledGestureEvent | null, currentEvent: MSGestureEvent): IThrottledGestureEvent {
	const r = {
		translationY: currentEvent.translationY,
		translationX: currentEvent.translationX
	};
	if (lastEvent) {
		r.translationY += lastEvent.translationY;
		r.translationX += lastEvent.translationX;
	}
	return r;
}

/**
 * Basically Edge but should be modified to handle any pointerEnabled, even without support of MSGesture
 */
class StandardPointerHandler extends MouseHandler implements IDisposable {

	private _lastPointerType: string;
	private _installGestureHandlerTimeout: number;

	constructor(context: ViewContext, viewController: ViewController, viewHelper: IPointerHandlerHelper) {
		super(context, viewController, viewHelper);

		this.viewHelper.linesContentDomNode.style.touchAction = 'none';

		// TODO@Alex -> this expects that the view is added in 100 ms, might not be the case
		// This handler should be added when the dom node is in the dom tree
		this._installGestureHandlerTimeout = window.setTimeout(() => {
			this._installGestureHandlerTimeout = -1;

			// TODO@Alex: replace the usage of MSGesture here with something that works across all browsers
			if ((<any>window).MSGesture) {
				const touchGesture = new MSGesture();
				const penGesture = new MSGesture();
				touchGesture.target = this.viewHelper.linesContentDomNode;
				penGesture.target = this.viewHelper.linesContentDomNode;
				this.viewHelper.linesContentDomNode.addEventListener('pointerdown', (e: PointerEvent) => {
					const pointerType = <any>e.pointerType;
					if (pointerType === 'mouse') {
						this._lastPointerType = 'mouse';
						return;
					} else if (pointerType === 'touch') {
						this._lastPointerType = 'touch';
						touchGesture.addPointer(e.pointerId);
					} else {
						this._lastPointerType = 'pen';
						penGesture.addPointer(e.pointerId);
					}
				});
				this._register(dom.addDisposableThrottledListener<IThrottledGestureEvent, MSGestureEvent>(this.viewHelper.linesContentDomNode, 'MSGestureChange', (e) => this._onGestureChange(e), gestureChangeEventMerger));
				this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, 'MSGestureTap', (e) => this._onCaptureGestureTap(e), true));
			}
		}, 100);
		this._lastPointerType = 'mouse';
	}

	public _onMouseDown(e: EditorMouseEvent): void {
		if (this._lastPointerType === 'mouse') {
			super._onMouseDown(e);
		}
	}

	private _onCaptureGestureTap(rawEvent: MSGestureEvent): void {
		const e = new EditorMouseEvent(<MouseEvent><any>rawEvent, this.viewHelper.viewDomNode);
		const t = this._createMouseTarget(e, false);
		if (t.position) {
			this.viewController.moveTo(t.position);
		}
		// IE does not want to focus when coming in from the browser's address bar
		if ((<any>e.browserEvent).fromElement) {
			e.preventDefault();
			this.viewHelper.focusTextArea();
		} else {
			// TODO@Alex -> cancel this is focus is lost
			setTimeout(() => {
				this.viewHelper.focusTextArea();
			});
		}
	}

	private _onGestureChange(e: IThrottledGestureEvent): void {
		this._context.model.deltaScrollNow(-e.translationX, -e.translationY);
	}

	public dispose(): void {
		window.clearTimeout(this._installGestureHandlerTimeout);
		super.dispose();
	}
}

/**
 * Currently only tested on iOS 13/ iPadOS.
 */
export class PointerEventHandler extends MouseHandler {
	private _lastPointerType: string;
	constructor(context: ViewContext, viewController: ViewController, viewHelper: IPointerHandlerHelper) {
		super(context, viewController, viewHelper);

		this._register(Gesture.addTarget(this.viewHelper.linesContentDomNode));
		this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Tap, (e) => this.onTap(e)));
		this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Change, (e) => this.onChange(e)));
		this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Contextmenu, (e: MouseEvent) => this._onContextMenu(new EditorMouseEvent(e, this.viewHelper.viewDomNode), false)));

		this._lastPointerType = 'mouse';

		this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, 'pointerdown', (e: any) => {
			const pointerType = <any>e.pointerType;
			if (pointerType === 'mouse') {
				this._lastPointerType = 'mouse';
				return;
			} else if (pointerType === 'touch') {
				this._lastPointerType = 'touch';
			} else {
				this._lastPointerType = 'pen';
			}
		}));

		// PonterEvents
		const pointerEvents = new EditorPointerEventFactory(this.viewHelper.viewDomNode);

		this._register(pointerEvents.onPointerMoveThrottled(this.viewHelper.viewDomNode,
			(e) => this._onMouseMove(e),
			createMouseMoveEventMerger(this.mouseTargetFactory), MouseHandler.MOUSE_MOVE_MINIMUM_TIME));
		this._register(pointerEvents.onPointerUp(this.viewHelper.viewDomNode, (e) => this._onMouseUp(e)));
		this._register(pointerEvents.onPointerLeave(this.viewHelper.viewDomNode, (e) => this._onMouseLeave(e)));
		this._register(pointerEvents.onPointerDown(this.viewHelper.viewDomNode, (e) => this._onMouseDown(e)));
	}

	private onTap(event: GestureEvent): void {
		if (!event.initialTarget || !this.viewHelper.linesContentDomNode.contains(<any>event.initialTarget)) {
			return;
		}

		event.preventDefault();
		this.viewHelper.focusTextArea();
		const target = this._createMouseTarget(new EditorMouseEvent(event, this.viewHelper.viewDomNode), false);

		if (target.position) {
			// this.viewController.moveTo(target.position);
			this.viewController.dispatchMouse({
				position: target.position,
				mouseColumn: target.position.column,
				startedOnLineNumbers: false,
				mouseDownCount: event.tapCount,
				inSelectionMode: false,
				altKey: false,
				ctrlKey: false,
				metaKey: false,
				shiftKey: false,

				leftButton: false,
				middleButton: false,
			});
		}
	}

	private onChange(e: GestureEvent): void {
		if (this._lastPointerType === 'touch') {
			this._context.model.deltaScrollNow(-e.translationX, -e.translationY);
		}
	}

	public _onMouseDown(e: EditorMouseEvent): void {
		if (e.target && this.viewHelper.linesContentDomNode.contains(e.target) && this._lastPointerType === 'touch') {
			return;
		}

		super._onMouseDown(e);
	}
}

class TouchHandler extends MouseHandler {

	constructor(context: ViewContext, viewController: ViewController, viewHelper: IPointerHandlerHelper) {
		super(context, viewController, viewHelper);

		this._register(Gesture.addTarget(this.viewHelper.linesContentDomNode));

		this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Tap, (e) => this.onTap(e)));
		this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Change, (e) => this.onChange(e)));
		this._register(dom.addDisposableListener(this.viewHelper.linesContentDomNode, EventType.Contextmenu, (e: MouseEvent) => this._onContextMenu(new EditorMouseEvent(e, this.viewHelper.viewDomNode), false)));
	}

	private onTap(event: GestureEvent): void {
		event.preventDefault();

		this.viewHelper.focusTextArea();

		const target = this._createMouseTarget(new EditorMouseEvent(event, this.viewHelper.viewDomNode), false);

		if (target.position) {
			this.viewController.moveTo(target.position);
		}
	}

	private onChange(e: GestureEvent): void {
		this._context.model.deltaScrollNow(-e.translationX, -e.translationY);
	}
}

export class PointerHandler extends Disposable {
	private readonly handler: MouseHandler;

	constructor(context: ViewContext, viewController: ViewController, viewHelper: IPointerHandlerHelper) {
		super();
		if ((platform.isIOS && BrowserFeatures.pointerEvents)) {
			this.handler = this._register(new PointerEventHandler(context, viewController, viewHelper));
		} else if ((<any>window).TouchEvent) {
			this.handler = this._register(new TouchHandler(context, viewController, viewHelper));
		} else if (window.navigator.pointerEnabled || (<any>window).PointerEvent) {
			this.handler = this._register(new StandardPointerHandler(context, viewController, viewHelper));
		} else {
			this.handler = this._register(new MouseHandler(context, viewController, viewHelper));
		}
	}

	public getTargetAtClientPoint(clientX: number, clientY: number): IMouseTarget | null {
		return this.handler.getTargetAtClientPoint(clientX, clientY);
	}
}
