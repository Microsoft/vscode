/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IDimension } from 'vs/editor/common/editorCommon';

interface ResizeObserver {
	observe(target: Element): void;
	unobserve(target: Element): void;
	disconnect(): void;
}

interface ResizeObserverSize {
	inlineSize: number;
	blockSize: number;
}

interface ResizeObserverEntry {
	readonly target: Element;
	readonly contentRect: DOMRectReadOnly;
	readonly borderBoxSize: ResizeObserverSize;
	readonly contentBoxSize: ResizeObserverSize;
}

type ResizeObserverCallback = (entries: ReadonlyArray<ResizeObserverEntry>, observer: ResizeObserver) => void;

declare const ResizeObserver: {
	prototype: ResizeObserver;
	new(callback: ResizeObserverCallback): ResizeObserver;
};


export class ElementSizeObserver extends Disposable {

	private readonly referenceDomElement: HTMLElement | null;
	private readonly changeCallback: () => void;
	private width: number;
	private height: number;
	private resizeObserver: ResizeObserver | null;
	private measureReferenceDomElementToken: number;

	constructor(referenceDomElement: HTMLElement | null, dimension: IDimension | undefined, changeCallback: () => void) {
		super();
		this.referenceDomElement = referenceDomElement;
		this.changeCallback = changeCallback;
		this.width = -1;
		this.height = -1;
		this.resizeObserver = null;
		this.measureReferenceDomElementToken = -1;
		this.measureReferenceDomElement(false, dimension);
	}

	public override dispose(): void {
		this.stopObserving();
		super.dispose();
	}

	public getWidth(): number {
		return this.width;
	}

	public getHeight(): number {
		return this.height;
	}

	public startObserving(): void {
		if (typeof ResizeObserver !== 'undefined') {
			if (!this.resizeObserver && this.referenceDomElement) {
				this.resizeObserver = new ResizeObserver((entries) => {
					if (entries && entries[0] && entries[0].contentRect) {
						this.observe({ width: entries[0].contentRect.width, height: entries[0].contentRect.height });
					} else {
						this.observe();
					}
				});
				this.resizeObserver.observe(this.referenceDomElement);
			}
		} else {
			if (this.measureReferenceDomElementToken === -1) {
				// setInterval type defaults to NodeJS.Timeout instead of number, so specify it as a number
				this.measureReferenceDomElementToken = <number><any>setInterval(() => this.observe(), 100);
			}
		}
	}

	public stopObserving(): void {
		if (this.resizeObserver) {
			this.resizeObserver.disconnect();
			this.resizeObserver = null;
		}
		if (this.measureReferenceDomElementToken !== -1) {
			clearInterval(this.measureReferenceDomElementToken);
			this.measureReferenceDomElementToken = -1;
		}
	}

	public observe(dimension?: IDimension): void {
		this.measureReferenceDomElement(true, dimension);
	}

	private measureReferenceDomElement(callChangeCallback: boolean, dimension?: IDimension): void {
		let observedWidth = 0;
		let observedHeight = 0;
		if (dimension) {
			observedWidth = dimension.width;
			observedHeight = dimension.height;
		} else if (this.referenceDomElement) {
			observedWidth = this.referenceDomElement.clientWidth;
			observedHeight = this.referenceDomElement.clientHeight;
		}
		observedWidth = Math.max(5, observedWidth);
		observedHeight = Math.max(5, observedHeight);
		if (this.width !== observedWidth || this.height !== observedHeight) {
			this.width = observedWidth;
			this.height = observedHeight;
			if (callChangeCallback) {
				this.changeCallback();
			}
		}
	}

}
