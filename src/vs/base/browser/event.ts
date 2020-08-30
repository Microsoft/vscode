/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event as BaseEvent, Emitter } from 'vs/base/common/event';

export type EventHandler = HTMLElement | HTMLDocument | Window;

export interface IDomEvent {
	<K extends keyof HTMLElementEventMap>(element: EventHandler, type: K, useCapture?: boolean): BaseEvent<HTMLElementEventMap[K]>;
	(element: EventHandler, type: string, useCapture?: boolean): BaseEvent<any>;
}

export const domEvent: IDomEvent = (element: EventHandler, type: string, useCapture?: boolean) => {
	const fn = (e: Event) => emitter.fire(e);
	const emitter = new Emitter<Event>({
		onFirstListenerAdd: () => {
			element.addEventListener(type, fn, useCapture);
		},
		onLastListenerRemove: () => {
			element.removeEventListener(type, fn, useCapture);
		}
	});

	return emitter.event;
};

export interface CancellableEvent {
	preventDefault(): void;
	stopPropagation(): void;
}

export function stop<T extends CancellableEvent>(event: BaseEvent<T>): BaseEvent<T> {
	return BaseEvent.map(event, e => {
		e.preventDefault();
		e.stopPropagation();
		return e;
	});
}
