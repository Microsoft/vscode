/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./keybindingLabel';
import { equals } from 'vs/base/common/objects';
import { OperatingSystem } from 'vs/base/common/platform';
import { ResolvedKeybinding, ResolvedKeybindingPart } from 'vs/base/common/keyCodes';
import { UILabelProvider } from 'vs/base/common/keybindingLabels';
import * as dom from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { IThemable } from 'vs/base/common/styler';
import { Color } from 'vs/base/common/color';

const $ = dom.$;

export interface PartMatches {
	ctrlKey?: boolean;
	shiftKey?: boolean;
	altKey?: boolean;
	metaKey?: boolean;
	keyCode?: boolean;
}

export interface Matches {
	firstPart: PartMatches;
	chordPart: PartMatches;
}

export interface KeybindingLabelOptions extends IKeybindingLabelStyles {
	renderUnboundKeybindings?: boolean;
}

export interface IKeybindingLabelStyles {
	keybindingLabelBackground?: Color;
	keybindingLabelForeground?: Color;
	keybindingLabelBorder?: Color;
	keybindingLabelBottomBorder?: Color;
	keybindingLabelShadow?: Color;
}

export class KeybindingLabel implements IThemable {

	private domNode: HTMLElement;
	private options: KeybindingLabelOptions;

	private readonly keyElements = new Set<HTMLSpanElement>();

	private keybinding: ResolvedKeybinding | undefined;
	private matches: Matches | undefined;
	private didEverRender: boolean;

	private labelBackground: Color | undefined;
	private labelForeground: Color | undefined;
	private labelBorder: Color | undefined;
	private labelBottomBorder: Color | undefined;
	private labelShadow: Color | undefined;

	constructor(container: HTMLElement, private os: OperatingSystem, options?: KeybindingLabelOptions) {
		this.options = options || Object.create(null);

		this.labelBackground = this.options.keybindingLabelBackground;
		this.labelForeground = this.options.keybindingLabelForeground;
		this.labelBorder = this.options.keybindingLabelBorder;
		this.labelBottomBorder = this.options.keybindingLabelBottomBorder;
		this.labelShadow = this.options.keybindingLabelShadow;

		this.domNode = dom.append(container, $('.monaco-keybinding'));
		this.didEverRender = false;
		container.appendChild(this.domNode);
	}

	get element(): HTMLElement {
		return this.domNode;
	}

	set(keybinding: ResolvedKeybinding | undefined, matches?: Matches) {
		if (this.didEverRender && this.keybinding === keybinding && KeybindingLabel.areSame(this.matches, matches)) {
			return;
		}

		this.keybinding = keybinding;
		this.matches = matches;
		this.render();
	}

	private render() {
		this.clear();

		if (this.keybinding) {
			let [firstPart, chordPart] = this.keybinding.getParts();
			if (firstPart) {
				this.renderPart(this.domNode, firstPart, this.matches ? this.matches.firstPart : null);
			}
			if (chordPart) {
				dom.append(this.domNode, $('span.monaco-keybinding-key-chord-separator', undefined, ' '));
				this.renderPart(this.domNode, chordPart, this.matches ? this.matches.chordPart : null);
			}
			this.domNode.title = this.keybinding.getAriaLabel() || '';
		} else if (this.options && this.options.renderUnboundKeybindings) {
			this.renderUnbound(this.domNode);
		}

		this.applyStyles();

		this.didEverRender = true;
	}

	private clear(): void {
		dom.clearNode(this.domNode);
		this.keyElements.clear();
	}

	private renderPart(parent: HTMLElement, part: ResolvedKeybindingPart, match: PartMatches | null) {
		const modifierLabels = UILabelProvider.modifierLabels[this.os];
		if (part.ctrlKey) {
			this.renderKey(parent, modifierLabels.ctrlKey, Boolean(match?.ctrlKey), modifierLabels.separator);
		}
		if (part.shiftKey) {
			this.renderKey(parent, modifierLabels.shiftKey, Boolean(match?.shiftKey), modifierLabels.separator);
		}
		if (part.altKey) {
			this.renderKey(parent, modifierLabels.altKey, Boolean(match?.altKey), modifierLabels.separator);
		}
		if (part.metaKey) {
			this.renderKey(parent, modifierLabels.metaKey, Boolean(match?.metaKey), modifierLabels.separator);
		}
		const keyLabel = part.keyLabel;
		if (keyLabel) {
			this.renderKey(parent, keyLabel, Boolean(match?.keyCode), '');
		}
	}

	private renderKey(parent: HTMLElement, label: string, highlight: boolean, separator: string): void {
		dom.append(parent, this.createKeyElement(label, highlight ? '.highlight' : ''));
		if (separator) {
			dom.append(parent, $('span.monaco-keybinding-key-separator', undefined, separator));
		}
	}

	private renderUnbound(parent: HTMLElement): void {
		dom.append(parent, this.createKeyElement(localize('unbound', "Unbound")));
	}

	private createKeyElement(label: string, extraClass = ''): HTMLElement {
		const keyElement = $('span.monaco-keybinding-key' + extraClass, undefined, label);
		this.keyElements.add(keyElement);

		return keyElement;
	}

	style(styles: IKeybindingLabelStyles): void {
		this.labelBackground = styles.keybindingLabelBackground;
		this.labelForeground = styles.keybindingLabelForeground;
		this.labelBorder = styles.keybindingLabelBorder;
		this.labelBottomBorder = styles.keybindingLabelBottomBorder;
		this.labelShadow = styles.keybindingLabelShadow;

		this.applyStyles();
	}

	private applyStyles() {
		if (this.element) {
			for (const keyElement of this.keyElements) {
				if (this.labelBackground) {
					keyElement.style.backgroundColor = this.labelBackground?.toString();
				}
				if (this.labelBorder) {
					keyElement.style.borderColor = this.labelBorder.toString();
				}
				if (this.labelBottomBorder) {
					keyElement.style.borderBottomColor = this.labelBottomBorder.toString();
				}
				if (this.labelShadow) {
					keyElement.style.boxShadow = `inset 0 -1px 0 ${this.labelShadow}`;
				}
			}

			if (this.labelForeground) {
				this.element.style.color = this.labelForeground.toString();
			}
		}
	}

	private static areSame(a: Matches | undefined, b: Matches | undefined): boolean {
		if (a === b || (!a && !b)) {
			return true;
		}
		return !!a && !!b && equals(a.firstPart, b.firstPart) && equals(a.chordPart, b.chordPart);
	}
}
