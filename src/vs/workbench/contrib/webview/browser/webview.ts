/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension } from 'vs/base/browser/dom';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import * as modes from 'vs/editor/common/modes';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

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
	readonly _serviceBrand: undefined;

	readonly activeWebview: Webview | undefined;

	createWebviewElement(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
	): WebviewElement;

	createWebviewOverlay(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
	): WebviewOverlay;

	setIcons(id: string, value: WebviewIcons | undefined): void;
}

export const enum WebviewContentPurpose {
	NotebookRenderer = 'notebookRenderer',
	CustomEditor = 'customEditor',
}

export interface WebviewOptions {
	// The purpose of the webview; this is (currently) only used for filtering in js-debug
	readonly purpose?: WebviewContentPurpose;
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

export interface IDataLinkClickEvent {
	dataURL: string;
	downloadName?: string;
}

export interface Webview extends IDisposable {

	readonly id: string;

	html: string;
	contentOptions: WebviewContentOptions;
	localResourcesRoot: URI[];
	extension: WebviewExtensionDescription | undefined;
	initialScrollProgress: number;
	state: string | undefined;

	readonly isFocused: boolean;

	readonly onDidFocus: Event<void>;
	readonly onDidBlur: Event<void>;
	readonly onDidDispose: Event<void>;

	readonly onDidClickLink: Event<string>;
	readonly onDidScroll: Event<{ scrollYPercentage: number }>;
	readonly onDidWheel: Event<IMouseWheelEvent>;
	readonly onDidUpdateState: Event<string | undefined>;
	readonly onDidReload: Event<void>;
	readonly onMessage: Event<any>;
	readonly onMissingCsp: Event<ExtensionIdentifier>;

	postMessage(data: any): void;

	focus(): void;
	reload(): void;

	showFind(): void;
	hideFind(): void;
	runFindAction(previous: boolean): void;

	selectAll(): void;
	copy(): void;
	paste(): void;
	cut(): void;
	undo(): void;
	redo(): void;

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

	claim(owner: any, scopedContextKeyService: IContextKeyService | undefined): void;
	release(owner: any): void;

	getInnerWebview(): Webview | undefined;

	layoutWebviewOverElement(element: HTMLElement, dimension?: Dimension): void;
}
