/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
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
}

export class Link extends Disposable {

	readonly el: HTMLAnchorElement;
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
			openerService.open(link.href);
		}));

		this.applyStyles();
	}

	style(styles: ILinkStyles): void {
		this.styles = styles;
		this.applyStyles();
	}

	private applyStyles(): void {
		this.el.style.color = this.styles.textLinkForeground?.toString() || '';
	}
}
