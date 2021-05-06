/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FastDomNode } from 'vs/base/browser/fastDomNode';
import { RenderingContext, RestrictedRenderingContext } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import { ViewEventHandler } from 'vs/editor/common/viewModel/viewEventHandler';

export abstract class ViewPart extends ViewEventHandler {

	_context: ViewContext;

	constructor(context: ViewContext) {
		super();
		this._context = context;
		this._context.addEventHandler(this);
	}

	public override dispose(): void {
		this._context.removeEventHandler(this);
		super.dispose();
	}

	public abstract prepareRender(ctx: RenderingContext): void;
	public abstract render(ctx: RestrictedRenderingContext): void;
}

export const enum PartFingerprint {
	None,
	ContentWidgets,
	OverflowingContentWidgets,
	OverflowGuard,
	OverlayWidgets,
	ScrollableElement,
	TextArea,
	ViewLines,
	Minimap
}

export class PartFingerprints {

	public static write(target: Element | FastDomNode<HTMLElement>, partId: PartFingerprint) {
		if (target instanceof FastDomNode) {
			target.setAttribute('data-mprt', String(partId));
		} else {
			target.setAttribute('data-mprt', String(partId));
		}
	}

	public static read(target: Element): PartFingerprint {
		const r = target.getAttribute('data-mprt');
		if (r === null) {
			return PartFingerprint.None;
		}
		return parseInt(r, 10);
	}

	public static collect(child: Element | null, stopAt: Element): Uint8Array {
		let result: PartFingerprint[] = [], resultLen = 0;

		while (child && child !== document.body) {
			if (child === stopAt) {
				break;
			}
			if (child.nodeType === child.ELEMENT_NODE) {
				result[resultLen++] = this.read(child);
			}
			child = child.parentElement;
		}

		const r = new Uint8Array(resultLen);
		for (let i = 0; i < resultLen; i++) {
			r[i] = result[resultLen - i - 1];
		}
		return r;
	}
}
