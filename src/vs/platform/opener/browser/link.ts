/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { $, EventHelper, EventLike } from 'vs/base/browser/dom';
import { domEvent } from 'vs/base/browser/event';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { Color } from 'vs/base/common/color';

export interface ILinkDescriptor {
	readonly label: string;
	readonly href: string;
	readonly title?: string;
}

export interface ILinkStyles {
	readonly textLinkForeground?: Color;
	readonly disabled?: boolean;
}

export class Link extends Disposable {

	readonly el: HTMLAnchorElement;
	private disabled: boolean;
	private styles: ILinkStyles = {
		textLinkForeground: Color.fromHex('#006AB1')
	};

	constructor(
		link: ILinkDescriptor,
		@IOpenerService openerService: IOpenerService
	) {
		super();

		this.el = $<HTMLAnchorElement>('a', {
			tabIndex: 0,
			href: link.href,
			title: link.title
		}, link.label);

		const onClick = domEvent(this.el, 'click');
		const onEnterPress = Event.chain(domEvent(this.el, 'keypress'))
			.map(e => new StandardKeyboardEvent(e))
			.filter(e => e.keyCode === KeyCode.Enter)
			.event;
		const onOpen = Event.any<EventLike>(onClick, onEnterPress);

		this._register(onOpen(e => {
			EventHelper.stop(e, true);
			if (!this.disabled) {
				openerService.open(link.href, { allowCommands: true });
			}
		}));

		this.disabled = false;
		this.applyStyles();
	}

	style(styles: ILinkStyles): void {
		this.styles = styles;
		this.applyStyles();
	}

	private applyStyles(): void {
		const color = this.styles.textLinkForeground?.toString();
		if (color) {
			this.el.style.color = color;
		}
		if (typeof this.styles.disabled === 'boolean' && this.styles.disabled !== this.disabled) {
			if (this.styles.disabled) {
				this.el.setAttribute('aria-disabled', 'true');
				this.el.tabIndex = -1;
				this.el.style.pointerEvents = 'none';
				this.el.style.opacity = '0.4';
				this.el.style.cursor = 'default';
				this.disabled = true;
			} else {
				this.el.setAttribute('aria-disabled', 'false');
				this.el.tabIndex = 0;
				this.el.style.pointerEvents = 'auto';
				this.el.style.opacity = '1';
				this.el.style.cursor = 'pointer';
				this.disabled = false;
			}
		}
	}
}
