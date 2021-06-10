/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension } from 'vs/base/browser/dom';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { equals } from 'vs/base/common/arrays';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IWebviewPortMapping } from 'vs/platform/webview/common/webviewPortMapping';

/**
 * Set when the find widget in a webview is visible.
 */
export const KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_VISIBLE = new RawContextKey<boolean>('webviewFindWidgetVisible', false);
export const KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_FOCUSED = new RawContextKey<boolean>('webviewFindWidgetFocused', false);
export const KEYBINDING_CONTEXT_WEBVIEW_FIND_WIDGET_ENABLED = new RawContextKey<boolean>('webviewFindWidgetEnabled', false);

export const IWebviewService = createDecorator<IWebviewService>('webviewService');

export interface IWebviewService {
	readonly _serviceBrand: undefined;

	/**
	 * The currently focused webview.
	 */
	readonly activeWebview: Webview | undefined;

	/**
	 * All webviews.
	 */
	readonly webviews: Iterable<Webview>;

	/**
	 * Fired when the currently focused webview changes.
	 */
	readonly onDidChangeActiveWebview: Event<Webview | undefined>;

	/**
	 * Create a basic webview dom element.
	 */
	createWebviewElement(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
	): WebviewElement;

	/**
	 * Create a lazily created webview element that is overlaid on top of another element.
	 *
	 * Allows us to avoid re-parenting the webview (which destroys its contents) when
	 * moving webview around the workbench.
	 */
	createWebviewOverlay(
		id: string,
		options: WebviewOptions,
		contentOptions: WebviewContentOptions,
		extension: WebviewExtensionDescription | undefined,
	): WebviewOverlay;
}

export const enum WebviewContentPurpose {
	NotebookRenderer = 'notebookRenderer',
	CustomEditor = 'customEditor',
}

export type WebviewStyles = { [key: string]: string | number; };

export interface WebviewOptions {
	// The purpose of the webview; this is (currently) only used for filtering in js-debug
	readonly purpose?: WebviewContentPurpose;
	readonly customClasses?: string;
	readonly enableFindWidget?: boolean;
	readonly tryRestoreScrollPosition?: boolean;
	readonly retainContextWhenHidden?: boolean;
	transformCssVariables?(styles: Readonly<WebviewStyles>): Readonly<WebviewStyles>;
}

export interface WebviewContentOptions {
	readonly allowMultipleAPIAcquire?: boolean;
	readonly allowScripts?: boolean;
	readonly allowWebUSB?: boolean;
	readonly localResourceRoots?: ReadonlyArray<URI>;
	readonly portMapping?: ReadonlyArray<IWebviewPortMapping>;
	readonly enableCommandUris?: boolean;
}

export function areWebviewContentOptionsEqual(a: WebviewContentOptions, b: WebviewContentOptions): boolean {
	return (
		a.allowMultipleAPIAcquire === b.allowMultipleAPIAcquire
		&& a.allowScripts === b.allowScripts
		&& a.allowWebUSB === b.allowWebUSB
		&& equals(a.localResourceRoots, b.localResourceRoots, isEqual)
		&& equals(a.portMapping, b.portMapping, (a, b) => a.extensionHostPort === b.extensionHostPort && a.webviewPort === b.webviewPort)
		&& a.enableCommandUris === b.enableCommandUris
	);
}

export interface WebviewExtensionDescription {
	readonly location: URI;
	readonly id: ExtensionIdentifier;
}

export interface IDataLinkClickEvent {
	dataURL: string;
	downloadName?: string;
}

export interface WebviewMessageReceivedEvent {
	readonly message: any;
	readonly transfer?: readonly ArrayBuffer[];
}

export interface Webview extends IDisposable {

	readonly id: string;

	html: string;
	contentOptions: WebviewContentOptions;
	localResourcesRoot: readonly URI[];
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
	readonly onMessage: Event<WebviewMessageReceivedEvent>;
	readonly onMissingCsp: Event<ExtensionIdentifier>;

	postMessage(message: any, transfer?: readonly ArrayBuffer[]): void;

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

	setContextKeyService(scopedContextKeyService: IContextKeyService): void;
}

/**
 * Basic webview rendered directly in the dom
 */
export interface WebviewElement extends Webview {
	/**
	 * Append the webview to a HTML element.
	 *
	 * Note that the webview content will be destroyed if any part of the parent hierarchy
	 * changes. You can avoid this by using a {@link WebviewOverlay} instead.
	 *
	 * @param parent Element to append the webview to.
	 */
	mountTo(parent: HTMLElement): void;
}

/**
 * Lazily created {@link Webview} that is absolutely positioned over another element.
 *
 * Absolute positioning lets us avoid having the webview be re-parented, which would destroy the
 * webview's content.
 *
 * Note that the underlying webview owned by a `WebviewOverlay` can be dynamically created
 * and destroyed depending on who has {@link WebviewOverlay.claim claimed} or {@link WebviewOverlay.release released} it.
 */
export interface WebviewOverlay extends Webview {
	/**
	 * The HTML element that holds the webview.
	 */
	readonly container: HTMLElement;

	options: WebviewOptions;

	/**
	 * Take ownership of the webview.
	 *
	 * This will create the underlying webview element.
	 *
	 * @param claimant Identifier for the object claiming the webview.
	 *   This must match the `claimant` passed to {@link WebviewOverlay.release}.
	 */
	claim(claimant: any, scopedContextKeyService: IContextKeyService | undefined): void;

	/**
	 * Release ownership of the webview.
	 *
	 * If the {@link claimant} is still the current owner of the webview, this will
	 * cause the underlying webview element to be destoryed.
	 *
	 * @param claimant Identifier for the object releasing its claim on the webview.
	 *   This must match the `claimant` passed to {@link WebviewOverlay.claim}.
	 */
	release(claimant: any): void;

	/**
	 * Absolutely position the webview on top of another element in the DOM.
	 *
	 * @param element Element to position the webview on top of. This element should
	 *   be an placeholder for the webview since the webview will entirely cover it.
	 * @param dimension Optional explicit dimensions to use for sizing the webview.
	 */
	layoutWebviewOverElement(element: HTMLElement, dimension?: Dimension): void;
}
