/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import * as platform from 'vs/base/common/platform';
import { EventType, Gesture, GestureEvent } from 'vs/base/browser/touch';
import { Disposable } from 'vs/base/common/lifecycle';
import { IPointerHandlerHelper, MouseHandler, createMouseMoveEventMerger } from 'vs/editor/browser/controller/mouseHandler';
import { IMouseTarget } from 'vs/editor/browser/editorBrowser';
import { EditorMouseEvent, EditorPointerEventFactory } from 'vs/editor/browser/editorDom';
import { ViewController } from 'vs/editor/browser/view/viewController';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import { BrowserFeatures } from 'vs/base/browser/canIUse';
import { TextAreaSyntethicEvents } from 'vs/editor/browser/controller/textAreaInput';

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

	public override _onMouseDown(e: EditorMouseEvent): void {
		if ((e.browserEvent as any).pointerType === 'touch') {
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
			// Send the tap event also to the <textarea> (for input purposes)
			const event = document.createEvent('CustomEvent');
			event.initEvent(TextAreaSyntethicEvents.Tap, false, true);
			this.viewHelper.dispatchTextAreaEvent(event);

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
		} else if (window.TouchEvent) {
			this.handler = this._register(new TouchHandler(context, viewController, viewHelper));
		} else {
			this.handler = this._register(new MouseHandler(context, viewController, viewHelper));
		}
	}

	public getTargetAtClientPoint(clientX: number, clientY: number): IMouseTarget | null {
		return this.handler.getTargetAtClientPoint(clientX, clientY);
	}
}
