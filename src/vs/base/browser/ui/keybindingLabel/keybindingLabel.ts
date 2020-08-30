/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./keybindingLabel';
import { equals } from 'vs/base/common/objects';
import { OperatingSystem } from 'vs/base/common/platform';
import { ResolvedKeybinding, ResolvedKeybindingPart } from 'vs/base/common/keyCodes';
import { UILabelProvider } from 'vs/base/common/keybindingLabels';
import * as dom from 'vs/base/browser/dom';
import { localize } from 'vs/nls';

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

export interface KeybindingLabelOptions {
	renderUnboundKeybindings: boolean;
}

export class KeybindingLabel {

	private domNode: HTMLElement;
	private keybinding: ResolvedKeybinding | undefined;
	private matches: Matches | undefined;
	private didEverRender: boolean;

	constructor(container: HTMLElement, private os: OperatingSystem, private options?: KeybindingLabelOptions) {
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
		dom.clearNode(this.domNode);

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

		this.didEverRender = true;
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
		dom.append(parent, $('span.monaco-keybinding-key' + (highlight ? '.highlight' : ''), undefined, label));
		if (separator) {
			dom.append(parent, $('span.monaco-keybinding-key-separator', undefined, separator));
		}
	}

	private renderUnbound(parent: HTMLElement): void {
		dom.append(parent, $('span.monaco-keybinding-key', undefined, localize('unbound', "Unbound")));
	}

	private static areSame(a: Matches | undefined, b: Matches | undefined): boolean {
		if (a === b || (!a && !b)) {
			return true;
		}
		return !!a && !!b && equals(a.firstPart, b.firstPart) && equals(a.chordPart, b.chordPart);
	}
}
