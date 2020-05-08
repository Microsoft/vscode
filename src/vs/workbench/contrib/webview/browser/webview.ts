/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension } from 'vs/base/browser/dom';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import * as modes from 'vs/editor/common/modes';
import * as nls from 'vs/nls';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';

/**
 * Set when the find widget in a webview is visible.
 */
export const KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_VISIBLE = new RawContextKey<boolean>('webviewFindWidgetVisible', false);
export const KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_FOCUSED = new RawContextKey<boolean>('webviewFindWidgetFocused', false);

export const webviewHasOwnEditFunctionsContextKey = 'webviewHasOwnEditFunctions';
export const webviewHasOwnEditFunctionsContext = new RawContextKey<boolean>(webviewHasOwnEditFunctionsContextKey, false);

export const IWebviewService = createDecorator<IWebviewService>('webviewService');

export interface WebviewIcons {
	readonly light: URI;
	readonly dark: URI;
}

/**
 * Handles the creation of webview elements.
 */
export interface IWebviewService {
	_serviceBrand: undefined;

	createWebviewElement(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
	): WebviewElement;

	createWebviewOverlay(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
	): WebviewOverlay;

	setIcons(id: string, value: WebviewIcons | undefined): void;
}

export interface WebviewOptions {
	readonly customClasses?: string;
	readonly enableFindWidget?: boolean;
	readonly tryRestoreScrollPosition?: boolean;
	readonly retainContextWhenHidden?: boolean;
}

export interface WebviewContentOptions {
	readonly allowMultipleAPIAcquire?: boolean;
	readonly allowScripts?: boolean;
	readonly localResourceRoots?: ReadonlyArray<URI>;
	readonly portMapping?: ReadonlyArray<modes.IWebviewPortMapping>;
	readonly enableCommandUris?: boolean;
}

export interface WebviewExtensionDescription {
	readonly location: URI;
	readonly id: ExtensionIdentifier;
}

export interface Webview extends IDisposable {
	html: string;
	contentOptions: WebviewContentOptions;
	extension: WebviewExtensionDescription | undefined;
	initialScrollProgress: number;
	state: string | undefined;

	readonly onDidFocus: Event<void>;
	readonly onDidBlur: Event<void>;
	readonly onDidClickLink: Event<string>;
	readonly onDidScroll: Event<{ scrollYPercentage: number }>;
	readonly onDidWheel: Event<IMouseWheelEvent>;
	readonly onDidUpdateState: Event<string | undefined>;
	readonly onMessage: Event<any>;
	readonly onMissingCsp: Event<ExtensionIdentifier>;

	sendMessage(data: any): void;

	focus(): void;
	reload(): void;

	showFind(): void;
	hideFind(): void;
	runFindAction(previous: boolean): void;

	selectAll(): void;

	windowDidDragStart(): void;
	windowDidDragEnd(): void;
}

/**
 * Basic webview rendered in the dom
 */
export interface WebviewElement extends Webview {
	mountTo(parent: HTMLElement): void;
}

/**
 * Dynamically created webview drawn over another element.
 */
export interface WebviewOverlay extends Webview {
	readonly container: HTMLElement;
	options: WebviewOptions;

	readonly onDispose: Event<void>;

	claim(owner: any): void;
	release(owner: any): void;

	getInnerWebview(): Webview | undefined;

	layoutWebviewOverElement(element: HTMLElement, dimension?: Dimension): void;
}

export const webviewDeveloperCategory = nls.localize('developer', "Developer");
