/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./rulers';
import { FastDomNode, createFastDomNode } from 'vs/base/browser/fastDomNode';
import { ViewPart } from 'vs/editor/browser/view/viewPart';
import { editorRuler } from 'vs/editor/common/view/editorColorRegistry';
import { RenderingContext, RestrictedRenderingContext } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorOption, IRulerOption } from 'vs/editor/common/config/editorOptions';

export class Rulers extends ViewPart {

	public domNode: FastDomNode<HTMLElement>;
	private readonly _renderedRulers: FastDomNode<HTMLElement>[];
	private _rulers: IRulerOption[];
	private _typicalHalfwidthCharacterWidth: number;

	constructor(context: ViewContext) {
		super(context);
		this.domNode = createFastDomNode<HTMLElement>(document.createElement('div'));
		this.domNode.setAttribute('role', 'presentation');
		this.domNode.setAttribute('aria-hidden', 'true');
		this.domNode.setClassName('view-rulers');
		this._renderedRulers = [];
		const options = this._context.configuration.options;
		this._rulers = options.get(EditorOption.rulers);
		this._typicalHalfwidthCharacterWidth = options.get(EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
	}

	public override dispose(): void {
		super.dispose();
	}

	// --- begin event handlers

	public override onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		const options = this._context.configuration.options;
		this._rulers = options.get(EditorOption.rulers);
		this._typicalHalfwidthCharacterWidth = options.get(EditorOption.fontInfo).typicalHalfwidthCharacterWidth;
		return true;
	}
	public override onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		return e.scrollHeightChanged;
	}

	// --- end event handlers

	public prepareRender(ctx: RenderingContext): void {
		// Nothing to read
	}

	private _ensureRulersCount(): void {
		const currentCount = this._renderedRulers.length;
		const desiredCount = this._rulers.length;

		if (currentCount === desiredCount) {
			// Nothing to do
			return;
		}

		if (currentCount < desiredCount) {
			const { tabSize } = this._context.model.getTextModelOptions();
			const rulerWidth = tabSize;
			let addCount = desiredCount - currentCount;
			while (addCount > 0) {
				const node = createFastDomNode(document.createElement('div'));
				node.setClassName('view-ruler');
				node.setWidth(rulerWidth);
				this.domNode.appendChild(node);
				this._renderedRulers.push(node);
				addCount--;
			}
			return;
		}

		let removeCount = currentCount - desiredCount;
		while (removeCount > 0) {
			const node = this._renderedRulers.pop()!;
			this.domNode.removeChild(node);
			removeCount--;
		}
	}

	public render(ctx: RestrictedRenderingContext): void {

		this._ensureRulersCount();

		for (let i = 0, len = this._rulers.length; i < len; i++) {
			const node = this._renderedRulers[i];
			const ruler = this._rulers[i];

			node.setBoxShadow(ruler.color ? `1px 0 0 0 ${ruler.color} inset` : ``);
			node.setHeight(Math.min(ctx.scrollHeight, 1000000));
			node.setLeft(ruler.column * this._typicalHalfwidthCharacterWidth);
		}
	}
}

registerThemingParticipant((theme, collector) => {
	const rulerColor = theme.getColor(editorRuler);
	if (rulerColor) {
		collector.addRule(`.monaco-editor .view-ruler { box-shadow: 1px 0 0 0 ${rulerColor} inset; }`);
	}
});
