/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./iconlabel';
import * as dom from 'vs/base/browser/dom';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IMatch } from 'vs/base/common/filters';
import { Disposable } from 'vs/base/common/lifecycle';
import { Range } from 'vs/base/common/range';
import { equals } from 'vs/base/common/objects';

export interface IIconLabelCreationOptions {
	supportHighlights?: boolean;
	supportDescriptionHighlights?: boolean;
	supportCodicons?: boolean;
}

export interface IIconLabelValueOptions {
	title?: string;
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
	private _title: string | undefined;
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

	set title(title: string) {
		if (this.disposed || title === this._title) {
			return;
		}

		this._title = title;
		if (this._title) {
			this._element.title = title;
		} else {
			this._element.removeAttribute('title');
		}
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

	constructor(container: HTMLElement, options?: IIconLabelCreationOptions) {
		super();

		this.domNode = this._register(new FastLabelNode(dom.append(container, dom.$('.monaco-icon-label'))));

		const labelContainer = dom.append(this.domNode.element, dom.$('.monaco-icon-label-container'));

		const nameContainer = dom.append(labelContainer, dom.$('span.monaco-icon-name-container'));
		this.descriptionContainer = this._register(new FastLabelNode(dom.append(labelContainer, dom.$('span.monaco-icon-description-container'))));

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
		this.domNode.title = options?.title || '';

		this.nameNode.setLabel(label, options);

		if (description || this.descriptionNode) {
			if (!this.descriptionNode) {
				this.descriptionNode = this.descriptionNodeFactory(); // description node is created lazily on demand
			}

			if (this.descriptionNode instanceof HighlightedLabel) {
				this.descriptionNode.set(description || '', options ? options.descriptionMatches : undefined);
				if (options?.descriptionTitle) {
					this.descriptionNode.element.title = options.descriptionTitle;
				} else {
					this.descriptionNode.element.removeAttribute('title');
				}
			} else {
				this.descriptionNode.textContent = description || '';
				this.descriptionNode.title = options?.descriptionTitle || '';
				this.descriptionNode.empty = !description;
			}
		}
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
				dom.removeClass(this.container, 'multiple');
				this.singleLabel = dom.append(this.container, dom.$('a.label-name', { id: options?.domId }));
			}

			this.singleLabel.textContent = label;
		} else {
			this.container.innerText = '';
			dom.addClass(this.container, 'multiple');
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
				dom.removeClass(this.container, 'multiple');
				this.singleLabel = new HighlightedLabel(dom.append(this.container, dom.$('a.label-name', { id: options?.domId })), this.supportCodicons);
			}

			this.singleLabel.set(label, options?.matches, options?.title, options?.labelEscapeNewLines);
		} else {

			this.container.innerText = '';
			dom.addClass(this.container, 'multiple');
			this.singleLabel = undefined;

			const separator = options?.separator || '/';
			const matches = splitMatches(label, separator, options?.matches);

			for (let i = 0; i < label.length; i++) {
				const l = label[i];
				const m = matches ? matches[i] : undefined;
				const id = options?.domId && `${options?.domId}_${i}`;

				const name = dom.$('a.label-name', { id, 'data-icon-label-count': label.length, 'data-icon-label-index': i, 'role': 'treeitem' });
				const highlightedLabel = new HighlightedLabel(dom.append(this.container, name), this.supportCodicons);
				highlightedLabel.set(l, m, options?.title, options?.labelEscapeNewLines);

				if (i < label.length - 1) {
					dom.append(name, dom.$('span.label-separator', undefined, separator));
				}
			}
		}
	}
}
