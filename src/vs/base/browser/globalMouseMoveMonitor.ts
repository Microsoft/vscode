/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import * as platform from 'vs/base/common/platform';
import { IframeUtils } from 'vs/base/browser/iframe';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { BrowserFeatures } from 'vs/base/browser/canIUse';

export interface IStandardMouseMoveEventData {
	leftButton: boolean;
	buttons: number;
	posx: number;
	posy: number;
}

export interface IEventMerger<R> {
	(lastEvent: R | null, currentEvent: MouseEvent): R;
}

export interface IMouseMoveCallback<R> {
	(mouseMoveData: R): void;
}

export interface IOnStopCallback {
	(): void;
}

export function standardMouseMoveMerger(lastEvent: IStandardMouseMoveEventData | null, currentEvent: MouseEvent): IStandardMouseMoveEventData {
	let ev = new StandardMouseEvent(currentEvent);
	ev.preventDefault();
	return {
		leftButton: ev.leftButton,
		buttons: ev.buttons,
		posx: ev.posx,
		posy: ev.posy
	};
}

export class GlobalMouseMoveMonitor<R extends { buttons: number; }> implements IDisposable {

	private readonly _hooks = new DisposableStore();
	private _mouseMoveEventMerger: IEventMerger<R> | null = null;
	private _mouseMoveCallback: IMouseMoveCallback<R> | null = null;
	private _onStopCallback: IOnStopCallback | null = null;

	public dispose(): void {
		this.stopMonitoring(false);
		this._hooks.dispose();
	}

	public stopMonitoring(invokeStopCallback: boolean): void {
		if (!this.isMonitoring()) {
			// Not monitoring
			return;
		}

		// Unhook
		this._hooks.clear();
		this._mouseMoveEventMerger = null;
		this._mouseMoveCallback = null;
		const onStopCallback = this._onStopCallback;
		this._onStopCallback = null;

		if (invokeStopCallback && onStopCallback) {
			onStopCallback();
		}
	}

	public isMonitoring(): boolean {
		return !!this._mouseMoveEventMerger;
	}

	public startMonitoring(
		initialElement: HTMLElement,
		initialButtons: number,
		mouseMoveEventMerger: IEventMerger<R>,
		mouseMoveCallback: IMouseMoveCallback<R>,
		onStopCallback: IOnStopCallback
	): void {
		if (this.isMonitoring()) {
			// I am already hooked
			return;
		}
		this._mouseMoveEventMerger = mouseMoveEventMerger;
		this._mouseMoveCallback = mouseMoveCallback;
		this._onStopCallback = onStopCallback;

		const windowChain = IframeUtils.getSameOriginWindowChain();
		const mouseMove = platform.isIOS && BrowserFeatures.pointerEvents ? 'pointermove' : 'mousemove';
		const mouseUp = platform.isIOS && BrowserFeatures.pointerEvents ? 'pointerup' : 'mouseup';

		const listenTo: (Document | ShadowRoot)[] = windowChain.map(element => element.window.document);
		const shadowRoot = dom.getShadowRoot(initialElement);
		if (shadowRoot) {
			listenTo.unshift(shadowRoot);
		}

		for (const element of listenTo) {
			this._hooks.add(dom.addDisposableThrottledListener(element, mouseMove,
				(data: R) => {
					if (data.buttons !== initialButtons) {
						// Buttons state has changed in the meantime
						this.stopMonitoring(true);
						return;
					}
					this._mouseMoveCallback!(data);
				},
				(lastEvent: R | null, currentEvent) => this._mouseMoveEventMerger!(lastEvent, currentEvent as MouseEvent)
			));
			this._hooks.add(dom.addDisposableListener(element, mouseUp, (e: MouseEvent) => this.stopMonitoring(true)));
		}

		if (IframeUtils.hasDifferentOriginAncestor()) {
			let lastSameOriginAncestor = windowChain[windowChain.length - 1];
			// We might miss a mouse up if it happens outside the iframe
			// This one is for Chrome
			this._hooks.add(dom.addDisposableListener(lastSameOriginAncestor.window.document, 'mouseout', (browserEvent: MouseEvent) => {
				let e = new StandardMouseEvent(browserEvent);
				if (e.target.tagName.toLowerCase() === 'html') {
					this.stopMonitoring(true);
				}
			}));
			// This one is for FF
			this._hooks.add(dom.addDisposableListener(lastSameOriginAncestor.window.document, 'mouseover', (browserEvent: MouseEvent) => {
				let e = new StandardMouseEvent(browserEvent);
				if (e.target.tagName.toLowerCase() === 'html') {
					this.stopMonitoring(true);
				}
			}));
			// This one is for IE
			this._hooks.add(dom.addDisposableListener(lastSameOriginAncestor.window.document.body, 'mouseleave', (browserEvent: MouseEvent) => {
				this.stopMonitoring(true);
			}));
		}
	}
}
