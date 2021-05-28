/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getTopLeftOffset, getClientArea, addDisposableListener } from 'vs/base/browser/dom';
import { coalesce } from 'vs/base/common/arrays';
import { timeout } from 'vs/base/common/async';
import { IElement, IWindowDriver } from 'vs/platform/driver/common/driver';

function serializeElement(element: Element, recursive: boolean): IElement {
	const attributes = Object.create(null);

	for (let j = 0; j < element.attributes.length; j++) {
		const attr = element.attributes.item(j);
		if (attr) {
			attributes[attr.name] = attr.value;
		}
	}

	const children: IElement[] = [];

	if (recursive) {
		for (let i = 0; i < element.children.length; i++) {
			const child = element.children.item(i);
			if (child) {
				children.push(serializeElement(child, true));
			}
		}
	}

	const { left, top } = getTopLeftOffset(element as HTMLElement);

	return {
		tagName: element.tagName,
		className: element.className,
		textContent: element.textContent || '',
		attributes,
		children,
		left,
		top
	};
}

export abstract class BaseWindowDriver implements IWindowDriver {

	abstract click(selector: string, xoffset?: number, yoffset?: number): Promise<void>;
	abstract doubleClick(selector: string): Promise<void>;

	async setValue(selector: string, text: string): Promise<void> {
		const element = document.querySelector(selector);

		if (!element) {
			return Promise.reject(new Error(`Element not found: ${selector}`));
		}

		const inputElement = element as HTMLInputElement;
		inputElement.value = text;

		const event = new Event('input', { bubbles: true, cancelable: true });
		inputElement.dispatchEvent(event);
	}

	async getTitle(): Promise<string> {
		return document.title;
	}

	async isActiveElement(selector: string): Promise<boolean> {
		const element = document.querySelector(selector);

		if (element !== document.activeElement) {
			const chain: string[] = [];
			let el = document.activeElement;

			while (el) {
				const tagName = el.tagName;
				const id = el.id ? `#${el.id}` : '';
				const classes = coalesce(el.className.split(/\s+/g).map(c => c.trim())).map(c => `.${c}`).join('');
				chain.unshift(`${tagName}${id}${classes}`);

				el = el.parentElement;
			}

			throw new Error(`Active element not found. Current active element is '${chain.join(' > ')}'. Looking for ${selector}`);
		}

		return true;
	}

	async getElements(selector: string, recursive: boolean): Promise<IElement[]> {
		const query = document.querySelectorAll(selector);
		const result: IElement[] = [];

		for (let i = 0; i < query.length; i++) {
			const element = query.item(i);
			result.push(serializeElement(element, recursive));
		}

		return result;
	}

	async getElementXY(selector: string, xoffset?: number, yoffset?: number): Promise<{ x: number; y: number; }> {
		const offset = typeof xoffset === 'number' && typeof yoffset === 'number' ? { x: xoffset, y: yoffset } : undefined;
		return this._getElementXY(selector, offset);
	}

	async typeInEditor(selector: string, text: string): Promise<void> {
		const element = document.querySelector(selector);

		if (!element) {
			throw new Error(`Editor not found: ${selector}`);
		}

		const textarea = element as HTMLTextAreaElement;
		const start = textarea.selectionStart;
		const newStart = start + text.length;
		const value = textarea.value;
		const newValue = value.substr(0, start) + text + value.substr(start);

		textarea.value = newValue;
		textarea.setSelectionRange(newStart, newStart);

		const event = new Event('input', { 'bubbles': true, 'cancelable': true });
		textarea.dispatchEvent(event);
	}

	async getTerminalBuffer(selector: string): Promise<string[]> {
		const element = document.querySelector(selector);

		if (!element) {
			throw new Error(`Terminal not found: ${selector}`);
		}

		const xterm = (element as any).xterm;

		if (!xterm) {
			throw new Error(`Xterm not found: ${selector}`);
		}

		const lines: string[] = [];

		for (let i = 0; i < xterm.buffer.length; i++) {
			lines.push(xterm.buffer.getLine(i)!.translateToString(true));
		}

		return lines;
	}

	async writeInTerminal(selector: string, text: string): Promise<void> {
		const element = document.querySelector(selector);

		if (!element) {
			throw new Error(`Element not found: ${selector}`);
		}

		const xterm = (element as any).xterm;

		if (!xterm) {
			throw new Error(`Xterm not found: ${selector}`);
		}

		xterm._core._coreService.triggerDataEvent(text);
	}

	async getElementInWebview(iframeSelector: string, elementSelector: string): Promise<IElement> {
		const element = document.querySelector<HTMLIFrameElement>(iframeSelector);
		if (!element) {
			throw new Error(`Element not found: ${iframeSelector}`);
		}

		let resolve: (x: IElement) => void;
		const contentPromise = new Promise<IElement>(r => resolve = r);

		const listener = addDisposableListener(window, 'message', e => {
			if (e.data.channel === '$$getContents$$') {
				resolve(e.data);
				listener.dispose();
			}
		});

		element.contentWindow!.postMessage({
			channel: '$$getContents$$',
			args: {
				elementSelector
			}
		}, '*');

		const result = await Promise.race([
			timeout(5000),
			contentPromise
		]);
		listener.dispose();

		if (result) {
			return result;
		}

		throw new Error('Could not get webview contents');
	}

	protected async _getElementXY(selector: string, offset?: { x: number, y: number }): Promise<{ x: number; y: number; }> {
		const element = document.querySelector(selector);

		if (!element) {
			return Promise.reject(new Error(`Element not found: ${selector}`));
		}

		const { left, top } = getTopLeftOffset(element as HTMLElement);
		const { width, height } = getClientArea(element as HTMLElement);
		let x: number, y: number;

		if (offset) {
			x = left + offset.x;
			y = top + offset.y;
		} else {
			x = left + (width / 2);
			y = top + (height / 2);
		}

		x = Math.round(x);
		y = Math.round(y);

		return { x, y };
	}

	abstract openDevTools(): Promise<void>;
}
