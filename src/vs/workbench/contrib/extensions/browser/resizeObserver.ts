/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Disposable } from 'vs/base/common/lifecycle';
import { ElementSizeObserver } from 'vs/editor/browser/config/elementSizeObserver';

declare class ResizeObserver {
	constructor(callback: (entries: any[]) => void);

	disconnect(): void;
	observe(target: Element, options?: { box: string }): void;
	unobserve(target: Element): void;
}

type ResizeListener = () => void;

/**
 * An interface the represents the required methods from ElementResizeObserver.
 */
export interface IResizeObserver extends Disposable {
	startObserving(): void;
	stopObserving(): void;
	getWidth(): number;
	getHeight(): number;
}

/**
 * An adapter for the browser's ResizeObserver class to match the ISizeObserver interface.
 */
class BrowserResizeObserver extends Disposable implements IResizeObserver {
	private readonly element: HTMLElement;
	private readonly observer: ResizeObserver;
	private width: number;
	private height: number;

	constructor(element: HTMLElement, callback: ResizeListener) {
		super();

		this.element = element;

		this.width = -1;
		this.height = -1;

		this.observer = new ResizeObserver(entries => {
			// precaution for preventing the observer from working on an another DOM element
			const entry = entries.find(entry => entry.target === element);
			if (!entry || !entry.contentRect) {
				return;
			}

			this.width = entry.contentRect.width;
			this.height = entry.contentRect.height;
			DOM.scheduleAtNextAnimationFrame(callback);
		});
	}

	startObserving(): void {
		this.observer.observe(this.element);
	}

	stopObserving(): void {
		this.observer.unobserve(this.element);
	}

	getWidth(): number {
		return this.width;
	}

	getHeight(): number {
		return this.height;
	}

	dispose(): void {
		this.observer.disconnect();
		super.dispose();
	}
}

export function getSizeObserver(element: HTMLElement, callback: ResizeListener): IResizeObserver {
	// If ResizeObserver is supported use BrowserResizeObserver otherwise fallback to ElementSizeObserver
	if (ResizeObserver) {
		return new BrowserResizeObserver(element, callback);
	} else {
		return new ElementSizeObserver(element, undefined, callback);
	}
}
