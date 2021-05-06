/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { HoverPosition } from 'vs/base/browser/ui/hover/hoverWidget';

export const IHoverService = createDecorator<IHoverService>('hoverService');

/**
 * Enables the convenient display of rich markdown-based hovers in the workbench.
 */
export interface IHoverService {
	readonly _serviceBrand: undefined;

	/**
	 * Shows a hover, provided a hover with the same options object is not already visible.
	 * @param options A set of options defining the characteristics of the hover.
	 * @param focus Whether to focus the hover (useful for keyboard accessibility).
	 *
	 * **Example:** A simple usage with a single element target.
	 *
	 * ```typescript
	 * showHover({
	 *   text: new MarkdownString('Hello world'),
	 *   target: someElement
	 * });
	 * ```
	 */
	showHover(options: IHoverOptions, focus?: boolean): IDisposable | undefined;

	/**
	 * Hides the hover if it was visible.
	 */
	hideHover(): void;
}

export interface IHoverOptions {
	/**
	 * The text to display in the primary section of the hover. The type of text determines the
	 * default `hideOnHover` behavior.
	 */
	text: IMarkdownString | string;

	/**
	 * The target for the hover. This determines the position of the hover and it will only be
	 * hidden when the mouse leaves both the hover and the target. A HTMLElement can be used for
	 * simple cases and a IHoverTarget for more complex cases where multiple elements and/or a
	 * dispose method is required.
	 */
	target: IHoverTarget | HTMLElement;

	/**
	 * A set of actions for the hover's "status bar".
	 */
	actions?: IHoverAction[];

	/**
	 * An optional array of classes to add to the hover element.
	 */
	additionalClasses?: string[];

	/**
	 * An optional  link handler for markdown links, if this is not provided the IOpenerService will
	 * be used to open the links using its default options.
	 */
	linkHandler?(url: string): void;

	/**
	 * Whether to hide the hover when the mouse leaves the `target` and enters the actual hover.
	 * This is false by default when text is an `IMarkdownString` and true when `text` is a
	 * `string`. Note that this will be ignored if any `actions` are provided as hovering is
	 * required to make them accessible.
	 *
	 * In general hiding on hover is desired for:
	 * - Regular text where selection is not important
	 * - Markdown that contains no links where selection is not important
	 */
	hideOnHover?: boolean;

	/**
	 * Position of the hover. Default is to show above the target.
	 * It will be ignored if there is not enough room to layout the hover in the specified position.
	 */
	hoverPosition?: HoverPosition;

	/**
	 * Whether to show the hover pointer
	 */
	showPointer?: boolean;

	/**
	 * Whether to show a compact hover
	 */
	compact?: boolean;
}

export interface IHoverAction {
	/**
	 * The label to use in the hover's status bar.
	 */
	label: string;

	/**
	 * The command ID of the action, this is used to resolve the keybinding to display after the
	 * action label.
	 */
	commandId: string;

	/**
	 * An optional class of an icon that will be displayed before the label.
	 */
	iconClass?: string;

	/**
	 * The callback to run the action.
	 * @param target The action element that was activated.
	 */
	run(target: HTMLElement): void;
}

/**
 * A target for a hover.
 */
export interface IHoverTarget extends IDisposable {
	/**
	 * A set of target elements used to position the hover. If multiple elements are used the hover
	 * will try to not overlap any target element. An example use case for this is show a hover for
	 * wrapped text.
	 */
	readonly targetElements: readonly HTMLElement[];

	/**
	 * An optional absolute x coordinate to position the hover with, for example to position the
	 * hover using `MouseEvent.pageX`.
	 */
	x?: number;

	/**
	 * An optional absolute y coordinate to position the hover with, for example to position the
	 * hover using `MouseEvent.pageY`.
	 */
	y?: number;
}
