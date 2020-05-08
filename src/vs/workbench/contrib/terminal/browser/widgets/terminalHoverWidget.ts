/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { Widget } from 'vs/base/browser/ui/widget';
import { ITerminalWidget, IHoverAnchor, IHoverTarget, HorizontalAnchorSide, VerticalAnchorSide } from 'vs/workbench/contrib/terminal/browser/widgets/widgets';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { HoverWidget } from 'vs/workbench/contrib/terminal/browser/widgets/hoverWidget';
import * as dom from 'vs/base/browser/dom';
import { IViewportRange } from 'xterm';

const $ = dom.$;

export interface ILinkHoverTargetOptions {
	readonly viewportRange: IViewportRange;
	readonly cellDimensions: { width: number, height: number };
	readonly terminalDimensions: { width: number, height: number };
	readonly modifierDownCallback?: () => void;
	readonly modifierUpCallback?: () => void;
}

export class TerminalHover extends Disposable implements ITerminalWidget {
	readonly id = 'hover';

	constructor(
		private readonly _targetOptions: ILinkHoverTargetOptions,
		private readonly _text: IMarkdownString,
		private readonly _linkHandler: (url: string) => void,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
	}

	dispose() {
		super.dispose();
	}

	attach(container: HTMLElement): void {
		const target = new CellHoverTarget(container, this._targetOptions);
		this._register(this._instantiationService.createInstance(HoverWidget, container, target, this._text, this._linkHandler, []));
	}
}

class CellHoverTarget extends Widget implements IHoverTarget {
	private _domNode: HTMLElement;
	private _isDisposed: boolean = false;

	readonly targetElements: readonly HTMLElement[];

	constructor(
		private readonly _container: HTMLElement,
		o: ILinkHoverTargetOptions
	) {
		super();

		this._domNode = $('div.terminal-hover-targets');
		const targets: HTMLElement[] = [];
		const rowCount = o.viewportRange.end.y - o.viewportRange.start.y + 1;

		// Add top target row
		const width = (o.viewportRange.end.y > o.viewportRange.start.y ? o.terminalDimensions.width - o.viewportRange.start.x : o.viewportRange.end.x - o.viewportRange.start.x + 1) * o.cellDimensions.width;
		const topTarget = $('div.terminal-hover-target.hoverHighlight');
		topTarget.style.left = `${o.viewportRange.start.x * o.cellDimensions.width}px`;
		topTarget.style.bottom = `${(o.terminalDimensions.height - o.viewportRange.start.y - 1) * o.cellDimensions.height}px`;
		topTarget.style.width = `${width}px`;
		topTarget.style.height = `${o.cellDimensions.height}px`;
		targets.push(this._domNode.appendChild(topTarget));

		// Add middle target rows
		if (rowCount > 2) {
			const middleTarget = $('div.terminal-hover-target.hoverHighlight');
			middleTarget.style.left = `0px`;
			middleTarget.style.bottom = `${(o.terminalDimensions.height - o.viewportRange.start.y - 1 - (rowCount - 2)) * o.cellDimensions.height}px`;
			middleTarget.style.width = `${o.terminalDimensions.width * o.cellDimensions.width}px`;
			middleTarget.style.height = `${(rowCount - 2) * o.cellDimensions.height}px`;
			targets.push(this._domNode.appendChild(middleTarget));
		}

		// Add bottom target row
		if (rowCount > 1) {
			const bottomTarget = $('div.terminal-hover-target.hoverHighlight');
			bottomTarget.style.left = `0px`;
			bottomTarget.style.bottom = `${(o.terminalDimensions.height - o.viewportRange.end.y - 1) * o.cellDimensions.height}px`;
			bottomTarget.style.width = `${(o.viewportRange.end.x + 1) * o.cellDimensions.width}px`;
			bottomTarget.style.height = `${o.cellDimensions.height}px`;
			targets.push(this._domNode.appendChild(bottomTarget));
		}

		this.targetElements = targets;

		if (o.modifierDownCallback && o.modifierUpCallback) {
			let down = false;
			this._register(dom.addDisposableListener(document, 'keydown', e => {
				if (e.ctrlKey && !down) {
					down = true;
					o.modifierDownCallback!();
				}
			}));
			this._register(dom.addDisposableListener(document, 'keyup', e => {
				if (!e.ctrlKey) {
					down = false;
					o.modifierUpCallback!();
				}
			}));
		}

		this._container.appendChild(this._domNode);
	}

	dispose(): void {
		if (!this._isDisposed) {
			this._container.removeChild(this._domNode);
		}
		this._isDisposed = true;
		super.dispose();
	}

	get anchor(): IHoverAnchor {
		const firstPosition = dom.getDomNodePagePosition(this.targetElements[0]);
		return {
			x: firstPosition.left,
			horizontalAnchorSide: HorizontalAnchorSide.Left,
			y: document.documentElement.clientHeight - firstPosition.top - 1,
			verticalAnchorSide: VerticalAnchorSide.Bottom,
			fallbackY: firstPosition.top + firstPosition.height - 1
		};
	}
}
