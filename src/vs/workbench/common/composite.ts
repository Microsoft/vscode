/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';

export interface IComposite {

	/**
	 * An event when the composite gained focus.
	 */
	readonly onDidFocus: Event<void>;

	/**
	 * An event when the composite lost focus.
	 */
	readonly onDidBlur: Event<void>;

	/**
	 * Returns true if the composite has focus.
	 */
	hasFocus(): boolean;

	/**
	 * Returns the unique identifier of this composite.
	 */
	getId(): string;

	/**
	 * Returns the name of this composite to show in the title area.
	 */
	getTitle(): string | undefined;

	/**
	 * Returns the underlying control of this composite.
	 */
	getControl(): ICompositeControl | undefined;

	/**
	 * Asks the underlying control to focus.
	 */
	focus(): void;
}

/**
 * Marker interface for the composite control
 */
export interface ICompositeControl { }
