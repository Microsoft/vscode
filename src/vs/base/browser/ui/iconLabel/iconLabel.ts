/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./iconlabel';
import * as dom from 'vs/base/browser/dom';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IMatch } from 'vs/base/common/filters';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { Range } from 'vs/base/common/range';
import { equals } from 'vs/base/common/objects';
import { isMacintosh } from 'vs/base/common/platform';
import { IHoverDelegate, IHoverDelegateOptions, IHoverDelegateTarget } from 'vs/base/browser/ui/iconLabel/iconHoverDelegate';
import { AnchorPosition } from 'vs/base/browser/ui/contextview/contextview';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { isFunction, isString } from 'vs/base/common/types';
import { domEvent } from 'vs/base/browser/event';

export interface IIconLabelCreationOptions {
	supportHighlights?: boolean;
	supportDescriptionHighlights?: boolean;
	supportCodicons?: boolean;
	hoverDelegate?: IHoverDelegate;
}

export interface IIconLabelMarkdownString {
	markdown: IMarkdownString | string | undefined | (() => Promise<IMarkdownString | string | undefined>);
	markdownNotSupportedFallback: string | undefined;
}

export interface IIconLabelValueOptions {
	title?: string | IIconLabelMarkdownString;
	descriptionTitle?: string;
	hideIcon?: boolean;
	extraClasses?: string[];
	italic?: boolean;
	strikethrough?: boolean;
	matches?: IMatch[];
	labelEscapeNewLines?: boolean;
	descriptionMatches?: IMatch[];
	readonly separator?: string;
	readonly domId?: string;
}

class FastLabelNode {
	private disposed: boolean | undefined;
	private _textContent: string | undefined;
	private _className: string | undefined;
	private _empty: boolean | undefined;

	constructor(private _element: HTMLElement) {
	}

	get element(): HTMLElement {
		return this._element;
	}

	set textContent(content: string) {
		if (this.disposed || content === this._textContent) {
			return;
		}

		this._textContent = content;
		this._element.textContent = content;
	}

	set className(className: string) {
		if (this.disposed || className === this._className) {
			return;
		}

		this._className = className;
		this._element.className = className;
	}

	set empty(empty: boolean) {
		if (this.disposed || empty === this._empty) {
			return;
		}

		this._empty = empty;
		this._element.style.marginLeft = empty ? '0' : '';
	}

	dispose(): void {
		this.disposed = true;
	}
}

export class IconLabel extends Disposable {

	private domNode: FastLabelNode;

	private nameNode: Label | LabelWithHighlights;

	private descriptionContainer: FastLabelNode;
	private descriptionNode: FastLabelNode | HighlightedLabel | undefined;
	private descriptionNodeFactory: () => FastLabelNode | HighlightedLabel;

	private labelContainer: HTMLElement;

	private hoverDelegate: IHoverDelegate | undefined = undefined;
	private readonly customHovers: Map<HTMLElement, IDisposable> = new Map();

	constructor(container: HTMLElement, options?: IIconLabelCreationOptions) {
		super();

		this.domNode = this._register(new FastLabelNode(dom.append(container, dom.$('.monaco-icon-label'))));

		this.labelContainer = dom.append(this.domNode.element, dom.$('.monaco-icon-label-container'));

		const nameContainer = dom.append(this.labelContainer, dom.$('span.monaco-icon-name-container'));
		this.descriptionContainer = this._register(new FastLabelNode(dom.append(this.labelContainer, dom.$('span.monaco-icon-description-container'))));

		if (options?.supportHighlights) {
			this.nameNode = new LabelWithHighlights(nameContainer, !!options.supportCodicons);
		} else {
			this.nameNode = new Label(nameContainer);
		}

		if (options?.supportDescriptionHighlights) {
			this.descriptionNodeFactory = () => new HighlightedLabel(dom.append(this.descriptionContainer.element, dom.$('span.label-description')), !!options.supportCodicons);
		} else {
			this.descriptionNodeFactory = () => this._register(new FastLabelNode(dom.append(this.descriptionContainer.element, dom.$('span.label-description'))));
		}

		if (options?.hoverDelegate) {
			this.hoverDelegate = options.hoverDelegate;
		}
	}

	get element(): HTMLElement {
		return this.domNode.element;
	}

	setLabel(label: string | string[], description?: string, options?: IIconLabelValueOptions): void {
		const classes = ['monaco-icon-label'];
		if (options) {
			if (options.extraClasses) {
				classes.push(...options.extraClasses);
			}

			if (options.italic) {
				classes.push('italic');
			}

			if (options.strikethrough) {
				classes.push('strikethrough');
			}
		}

		this.domNode.className = classes.join(' ');
		this.setupHover(this.labelContainer, options?.title);

		this.nameNode.setLabel(label, options);

		if (description || this.descriptionNode) {
			if (!this.descriptionNode) {
				this.descriptionNode = this.descriptionNodeFactory(); // description node is created lazily on demand
			}

			if (this.descriptionNode instanceof HighlightedLabel) {
				this.descriptionNode.set(description || '', options ? options.descriptionMatches : undefined);
				this.setupHover(this.descriptionNode.element, options?.descriptionTitle);
			} else {
				this.descriptionNode.textContent = description || '';
				this.setupHover(this.descriptionNode.element, options?.descriptionTitle || '');
				this.descriptionNode.empty = !description;
			}
		}
	}

	private setupHover(htmlElement: HTMLElement, tooltip: string | IIconLabelMarkdownString | undefined): void {
		const previousCustomHover = this.customHovers.get(htmlElement);
		if (previousCustomHover) {
			previousCustomHover.dispose();
			this.customHovers.delete(htmlElement);
		}

		if (!tooltip) {
			htmlElement.removeAttribute('title');
			return;
		}

		if (!this.hoverDelegate) {
			return this.setupNativeHover(htmlElement, tooltip);
		} else {
			return this.setupCustomHover(this.hoverDelegate, htmlElement, tooltip);
		}
	}

	private setupCustomHover(hoverDelegate: IHoverDelegate, htmlElement: HTMLElement, markdownTooltip: string | IIconLabelMarkdownString): void {
		htmlElement.removeAttribute('title');
		let tooltip: () => Promise<string | IMarkdownString | undefined>;
		if (isString(markdownTooltip)) {
			tooltip = async () => markdownTooltip;
		} else if (isFunction(markdownTooltip.markdown)) {
			tooltip = markdownTooltip.markdown;
		} else {
			const markdown = markdownTooltip.markdown;
			tooltip = async () => markdown;
		}
		// Testing has indicated that on Windows and Linux 500 ms matches the native hovers most closely.
		// On Mac, the delay is 1500.
		const hoverDelay = isMacintosh ? 1500 : 500;
		let hoverOptions: IHoverDelegateOptions | undefined;
		let mouseX: number | undefined;
		let isHovering = false;
		function mouseOver(this: HTMLElement, e: MouseEvent): any {
			if (isHovering) {
				return;
			}
			function mouseLeaveOrDown(this: HTMLElement, e: MouseEvent): any {
				isHovering = false;
				mouseLeaveDisposable.dispose();
				mouseDownDisposable.dispose();
			}
			const mouseLeaveDisposable = domEvent(htmlElement, dom.EventType.MOUSE_LEAVE, true)(mouseLeaveOrDown.bind(htmlElement));
			const mouseDownDisposable = domEvent(htmlElement, dom.EventType.MOUSE_DOWN, true)(mouseLeaveOrDown.bind(htmlElement));
			isHovering = true;

			function mouseMove(this: HTMLElement, e: MouseEvent): any {
				mouseX = e.x;
			}
			const mouseMoveDisposable = domEvent(htmlElement, dom.EventType.MOUSE_MOVE, true)(mouseMove.bind(htmlElement));
			setTimeout(async () => {
				if (isHovering && tooltip) {
					// Re-use the already computed hover options if they exist.
					if (!hoverOptions) {
						const target: IHoverDelegateTarget = {
							targetElements: [this],
							dispose: () => { }
						};
						const resolvedTooltip = await tooltip();
						if (resolvedTooltip) {
							hoverOptions = {
								text: resolvedTooltip,
								target,
								anchorPosition: AnchorPosition.BELOW
							};
						}
					}
					// awaiting the tooltip could take a while. Make sure we're still hovering.
					if (hoverOptions && isHovering) {
						if (mouseX !== undefined) {
							(<IHoverDelegateTarget>hoverOptions.target).x = mouseX + 10;
						}
						hoverDelegate.showHover(hoverOptions);
					}
				}
				mouseMoveDisposable.dispose();
			}, hoverDelay);
		}
		const mouseOverDisposable = this._register(domEvent(htmlElement, dom.EventType.MOUSE_OVER, true)(mouseOver.bind(htmlElement)));
		this.customHovers.set(htmlElement, mouseOverDisposable);
	}

	private setupNativeHover(htmlElement: HTMLElement, tooltip: string | IIconLabelMarkdownString | undefined): void {
		let stringTooltip: string = '';
		if (isString(tooltip)) {
			stringTooltip = tooltip;
		} else if (tooltip?.markdownNotSupportedFallback) {
			stringTooltip = tooltip.markdownNotSupportedFallback;
		}
		htmlElement.title = stringTooltip;
	}
}

class Label {

	private label: string | string[] | undefined = undefined;
	private singleLabel: HTMLElement | undefined = undefined;
	private options: IIconLabelValueOptions | undefined;

	constructor(private container: HTMLElement) { }

	setLabel(label: string | string[], options?: IIconLabelValueOptions): void {
		if (this.label === label && equals(this.options, options)) {
			return;
		}

		this.label = label;
		this.options = options;

		if (typeof label === 'string') {
			if (!this.singleLabel) {
				this.container.innerText = '';
				this.container.classList.remove('multiple');
				this.singleLabel = dom.append(this.container, dom.$('a.label-name', { id: options?.domId }));
			}

			this.singleLabel.textContent = label;
		} else {
			this.container.innerText = '';
			this.container.classList.add('multiple');
			this.singleLabel = undefined;

			for (let i = 0; i < label.length; i++) {
				const l = label[i];
				const id = options?.domId && `${options?.domId}_${i}`;

				dom.append(this.container, dom.$('a.label-name', { id, 'data-icon-label-count': label.length, 'data-icon-label-index': i, 'role': 'treeitem' }, l));

				if (i < label.length - 1) {
					dom.append(this.container, dom.$('span.label-separator', undefined, options?.separator || '/'));
				}
			}
		}
	}
}

function splitMatches(labels: string[], separator: string, matches: IMatch[] | undefined): IMatch[][] | undefined {
	if (!matches) {
		return undefined;
	}

	let labelStart = 0;

	return labels.map(label => {
		const labelRange = { start: labelStart, end: labelStart + label.length };

		const result = matches
			.map(match => Range.intersect(labelRange, match))
			.filter(range => !Range.isEmpty(range))
			.map(({ start, end }) => ({ start: start - labelStart, end: end - labelStart }));

		labelStart = labelRange.end + separator.length;
		return result;
	});
}

class LabelWithHighlights {

	private label: string | string[] | undefined = undefined;
	private singleLabel: HighlightedLabel | undefined = undefined;
	private options: IIconLabelValueOptions | undefined;

	constructor(private container: HTMLElement, private supportCodicons: boolean) { }

	setLabel(label: string | string[], options?: IIconLabelValueOptions): void {
		if (this.label === label && equals(this.options, options)) {
			return;
		}

		this.label = label;
		this.options = options;

		if (typeof label === 'string') {
			if (!this.singleLabel) {
				this.container.innerText = '';
				this.container.classList.remove('multiple');
				this.singleLabel = new HighlightedLabel(dom.append(this.container, dom.$('a.label-name', { id: options?.domId })), this.supportCodicons);
			}

			this.singleLabel.set(label, options?.matches, undefined, options?.labelEscapeNewLines);
		} else {
			this.container.innerText = '';
			this.container.classList.add('multiple');
			this.singleLabel = undefined;

			const separator = options?.separator || '/';
			const matches = splitMatches(label, separator, options?.matches);

			for (let i = 0; i < label.length; i++) {
				const l = label[i];
				const m = matches ? matches[i] : undefined;
				const id = options?.domId && `${options?.domId}_${i}`;

				const name = dom.$('a.label-name', { id, 'data-icon-label-count': label.length, 'data-icon-label-index': i, 'role': 'treeitem' });
				const highlightedLabel = new HighlightedLabel(dom.append(this.container, name), this.supportCodicons);
				highlightedLabel.set(l, m, undefined, options?.labelEscapeNewLines);

				if (i < label.length - 1) {
					dom.append(name, dom.$('span.label-separator', undefined, separator));
				}
			}
		}
	}
}
