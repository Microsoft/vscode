/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import * as dom from 'vs/base/browser/dom';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IHoverTarget, IHoverOptions } from 'vs/workbench/services/hover/browser/hover';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { EDITOR_FONT_DEFAULTS, IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { HoverPosition, HoverWidget as BaseHoverWidget, renderHoverAction } from 'vs/base/browser/ui/hover/hoverWidget';
import { Widget } from 'vs/base/browser/ui/widget';
import { AnchorPosition } from 'vs/base/browser/ui/contextview/contextview';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';

const $ = dom.$;
type TargetRect = {
	left: number,
	right: number,
	top: number,
	bottom: number,
	width: number,
	height: number,
	center: { x: number, y: number },
};

export class HoverWidget extends Widget {
	private readonly _messageListeners = new DisposableStore();
	private readonly _mouseTracker: CompositeMouseTracker;

	private readonly _hover: BaseHoverWidget;
	private readonly _hoverPointer: HTMLElement | undefined;
	private readonly _target: IHoverTarget;
	private readonly _linkHandler: (url: string) => any;

	private _isDisposed: boolean = false;
	private _hoverPosition: HoverPosition;
	private _x: number = 0;
	private _y: number = 0;

	get isDisposed(): boolean { return this._isDisposed; }
	get domNode(): HTMLElement { return this._hover.containerDomNode; }

	private readonly _onDispose = this._register(new Emitter<void>());
	get onDispose(): Event<void> { return this._onDispose.event; }
	private readonly _onRequestLayout = this._register(new Emitter<void>());
	get onRequestLayout(): Event<void> { return this._onRequestLayout.event; }

	get anchor(): AnchorPosition { return this._hoverPosition === HoverPosition.BELOW ? AnchorPosition.BELOW : AnchorPosition.ABOVE; }
	get x(): number { return this._x; }
	get y(): number { return this._y; }

	constructor(
		options: IHoverOptions,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IOpenerService private readonly _openerService: IOpenerService,
		@IWorkbenchLayoutService private readonly _workbenchLayoutService: IWorkbenchLayoutService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
	) {
		super();

		this._linkHandler = options.linkHandler || this._openerService.open;

		this._target = 'targetElements' in options.target ? options.target : new ElementHoverTarget(options.target);

		this._hoverPointer = options.showPointer ? $('div.workbench-hover-pointer') : undefined;
		this._hover = this._register(new BaseHoverWidget());
		this._hover.containerDomNode.classList.add('workbench-hover', 'fadeIn');
		if (options.compact) {
			this._hover.containerDomNode.classList.add('workbench-hover', 'compact');
		}
		if (options.additionalClasses) {
			this._hover.containerDomNode.classList.add(...options.additionalClasses);
		}

		this._hoverPosition = options.hoverPosition ?? HoverPosition.ABOVE;

		// Don't allow mousedown out of the widget, otherwise preventDefault will call and text will
		// not be selected.
		this.onmousedown(this._hover.containerDomNode, e => e.stopPropagation());

		// Hide hover on escape
		this.onkeydown(this._hover.containerDomNode, e => {
			if (e.equals(KeyCode.Escape)) {
				this.dispose();
			}
		});

		const rowElement = $('div.hover-row.markdown-hover');
		const contentsElement = $('div.hover-contents');
		if (typeof options.text === 'string') {
			contentsElement.textContent = options.text;
			contentsElement.style.whiteSpace = 'pre-wrap';
		} else {
			const markdown = options.text;
			const mdRenderer = this._instantiationService.createInstance(
				MarkdownRenderer,
				{ codeBlockFontFamily: this._configurationService.getValue<IEditorOptions>('editor').fontFamily || EDITOR_FONT_DEFAULTS.fontFamily }
			);

			const { element } = mdRenderer.render(markdown, {
				actionHandler: {
					callback: (content) => this._linkHandler(content),
					disposeables: this._messageListeners
				},
				asyncRenderCallback: () => {
					contentsElement.classList.add('code-hover-contents');
					// This changes the dimensions of the hover so trigger a layout
					this._onRequestLayout.fire();
				}
			});
			contentsElement.appendChild(element);
		}
		rowElement.appendChild(contentsElement);
		this._hover.contentsDomNode.appendChild(rowElement);

		if (options.actions && options.actions.length > 0) {
			const statusBarElement = $('div.hover-row.status-bar');
			const actionsElement = $('div.actions');
			options.actions.forEach(action => {
				const keybinding = this._keybindingService.lookupKeybinding(action.commandId);
				const keybindingLabel = keybinding ? keybinding.getLabel() : null;
				renderHoverAction(actionsElement, {
					label: action.label,
					commandId: action.commandId,
					run: e => {
						action.run(e);
						this.dispose();
					},
					iconClass: action.iconClass
				}, keybindingLabel);
			});
			statusBarElement.appendChild(actionsElement);
			this._hover.containerDomNode.appendChild(statusBarElement);
		}

		const mouseTrackerTargets = [...this._target.targetElements];
		let hideOnHover: boolean;
		if (options.actions && options.actions.length > 0) {
			// If there are actions, require hover so they can be accessed
			hideOnHover = false;
		} else {
			if (options.hideOnHover === undefined) {
				// Defaults to true when string, false when markdown as it may contain links
				hideOnHover = typeof options.text === 'string';
			} else {
				// It's set explicitly
				hideOnHover = options.hideOnHover;
			}
		}
		if (!hideOnHover) {
			mouseTrackerTargets.push(this._hover.containerDomNode);
		}
		this._mouseTracker = new CompositeMouseTracker(mouseTrackerTargets);
		this._register(this._mouseTracker.onMouseOut(() => this.dispose()));
		this._register(this._mouseTracker);
	}

	public render(container?: HTMLElement): void {
		if (this._hoverPointer) {
			container?.appendChild(this._hoverPointer);
		}
		if (this._hover.containerDomNode.parentElement !== container) {
			container?.appendChild(this._hover.containerDomNode);
		}

		this.layout();
	}

	public layout() {
		this._hover.containerDomNode.classList.remove('right-aligned');
		this._hover.contentsDomNode.style.maxHeight = '';

		const targetBounds = this._target.targetElements.map(e => e.getBoundingClientRect());
		const top = Math.min(...targetBounds.map(e => e.top));
		const right = Math.max(...targetBounds.map(e => e.right));
		const bottom = Math.max(...targetBounds.map(e => e.bottom));
		const left = Math.min(...targetBounds.map(e => e.left));
		const width = right - left;
		const height = bottom - top;

		const targetRect: TargetRect = {
			top, right, bottom, left, width, height,
			center: {
				x: left + (width / 2),
				y: top + (height / 2)
			}
		};

		this.adjustHorizontalHoverPosition(targetRect);
		this.adjustVerticalHoverPosition(targetRect);
		this.computeXCordinate(targetRect);
		this.computeYCordinate(targetRect);

		if (this._hoverPointer) {
			// reset
			this._hoverPointer.classList.remove('top');
			this._hoverPointer.classList.remove('left');
			this._hoverPointer.classList.remove('right');
			this._hoverPointer.classList.remove('bottom');

			this.setHoverPointerPosition(targetRect);
		}

		this._hover.onContentsChanged();
	}

	private computeXCordinate(target: TargetRect): void {
		if (this._target.x !== undefined) {
			this._x = this._target.x;
		}

		else if (this._hoverPosition === HoverPosition.RIGHT) {
			this._x = target.right;
		}

		else if (this._hoverPosition === HoverPosition.LEFT) {
			this._x = target.left;
		}

		else {
			if (this._hoverPointer) {
				this._x = target.center.x - (this._hover.containerDomNode.clientWidth / 2);
			} else {
				if (target.left + this._hover.containerDomNode.clientWidth >= document.documentElement.clientWidth) {
					this._hover.containerDomNode.classList.add('right-aligned');
					this._x = document.documentElement.clientWidth - this._workbenchLayoutService.getWindowBorderWidth() - 1;
				} else {
					this._x = target.left;
				}
			}
		}

		// Hover on left is going beyond window
		if (this._x < document.documentElement.clientLeft) {
			this._x = target.left;
		}

	}

	private computeYCordinate(target: TargetRect): void {
		if (this._target.y !== undefined) {
			this._y = this._target.y;
		}

		else if (this._hoverPosition === HoverPosition.ABOVE) {
			this._y = target.top;
		}

		else if (this._hoverPosition === HoverPosition.BELOW) {
			this._y = target.bottom - 2;
		}

		else {
			if (this._hoverPointer) {
				this._y = target.center.y + (this._hover.containerDomNode.clientHeight / 2);
			} else {
				this._y = target.bottom;
			}
		}

		// Hover on bottom is going beyond window
		if (this._y > window.innerHeight) {
			this._y = target.bottom;
		}
	}

	private adjustHorizontalHoverPosition(target: TargetRect): void {
		// Do not adjust horizontal hover position if x cordiante is provided
		if (this._target.x !== undefined) {
			return;
		}

		// Position hover on right to target
		if (this._hoverPosition === HoverPosition.RIGHT) {
			// Hover on the right is going beyond window.
			if (target.right + this._hover.containerDomNode.clientWidth >= document.documentElement.clientWidth) {
				this._hoverPosition = HoverPosition.LEFT;
			}
		}

		// Position hover on left to target
		if (this._hoverPosition === HoverPosition.LEFT) {
			// Hover on the left is going beyond window.
			if (target.left - this._hover.containerDomNode.clientWidth <= document.documentElement.clientLeft) {
				this._hoverPosition = HoverPosition.RIGHT;
			}
		}
	}

	private adjustVerticalHoverPosition(target: TargetRect): void {
		// Do not adjust vertical hover position if y cordiante is provided
		if (this._target.y !== undefined) {
			return;
		}

		// Position hover on top of the target
		if (this._hoverPosition === HoverPosition.ABOVE) {
			// Hover on top is going beyond window
			if (target.top - this._hover.containerDomNode.clientHeight < 0) {
				this._hoverPosition = HoverPosition.BELOW;
			}
		}

		// Position hover below the target
		else if (this._hoverPosition === HoverPosition.BELOW) {
			// Hover on bottom is going beyond window
			if (target.bottom + this._hover.containerDomNode.clientHeight > window.innerHeight) {
				this._hoverPosition = HoverPosition.ABOVE;
			}
		}
	}

	private setHoverPointerPosition(target: TargetRect): void {
		if (!this._hoverPointer) {
			return;
		}

		switch (this._hoverPosition) {
			case HoverPosition.LEFT:
			case HoverPosition.RIGHT:
				this._hoverPointer.classList.add(this._hoverPosition === HoverPosition.LEFT ? 'right' : 'left');
				const hoverHeight = this._hover.containerDomNode.clientHeight;

				// If hover is taller than target and aligned with target's bottom, then show the pointer at the center of target
				if (hoverHeight > target.height && this._y === target.bottom) {
					this._hoverPointer.style.top = `${target.center.y - target.top - 3}px`;
				}

				// Otherwise show the pointer at the center of hover
				else {
					this._hoverPointer.style.top = `${Math.round((hoverHeight / 2)) - 3}px`;
				}

				break;
			case HoverPosition.ABOVE:
			case HoverPosition.BELOW:
				this._hoverPointer.classList.add(this._hoverPosition === HoverPosition.ABOVE ? 'bottom' : 'top');
				const hoverWidth = this._hover.containerDomNode.clientWidth;

				// If hover is wider than target and aligned with target's left, then show the pointer at the center of target
				if (hoverWidth > target.width && this._x === target.left) {
					this._hoverPointer.style.left = `${target.center.x - target.left - 3}px`;
				}

				// Otherwise show the pointer at the center of hover
				else {
					this._hoverPointer.style.left = `${Math.round((hoverWidth / 2)) - 3}px`;
				}
				break;
		}
	}

	public focus() {
		this._hover.containerDomNode.focus();
	}

	public hide(): void {
		this.dispose();
	}

	public override dispose(): void {
		if (!this._isDisposed) {
			this._onDispose.fire();
			if (this._hoverPointer) {
				this._hoverPointer.parentElement?.removeChild(this._hoverPointer);
			}
			this._hover.containerDomNode.parentElement?.removeChild(this._hover.containerDomNode);
			this._messageListeners.dispose();
			this._target.dispose();
			super.dispose();
		}
		this._isDisposed = true;
	}
}

class CompositeMouseTracker extends Widget {
	private _isMouseIn: boolean = false;
	private _mouseTimeout: number | undefined;

	private readonly _onMouseOut = new Emitter<void>();
	get onMouseOut(): Event<void> { return this._onMouseOut.event; }

	constructor(
		private _elements: HTMLElement[]
	) {
		super();
		this._elements.forEach(n => this.onmouseover(n, () => this._onTargetMouseOver()));
		this._elements.forEach(n => this.onnonbubblingmouseout(n, () => this._onTargetMouseOut()));
	}

	private _onTargetMouseOver(): void {
		this._isMouseIn = true;
		this._clearEvaluateMouseStateTimeout();
	}

	private _onTargetMouseOut(): void {
		this._isMouseIn = false;
		this._evaluateMouseState();
	}

	private _evaluateMouseState(): void {
		this._clearEvaluateMouseStateTimeout();
		// Evaluate whether the mouse is still outside asynchronously such that other mouse targets
		// have the opportunity to first their mouse in event.
		this._mouseTimeout = window.setTimeout(() => this._fireIfMouseOutside(), 0);
	}

	private _clearEvaluateMouseStateTimeout(): void {
		if (this._mouseTimeout) {
			clearTimeout(this._mouseTimeout);
			this._mouseTimeout = undefined;
		}
	}

	private _fireIfMouseOutside(): void {
		if (!this._isMouseIn) {
			this._onMouseOut.fire();
		}
	}
}

class ElementHoverTarget implements IHoverTarget {
	readonly targetElements: readonly HTMLElement[];

	constructor(
		private _element: HTMLElement
	) {
		this.targetElements = [this._element];
	}

	dispose(): void {
	}
}
