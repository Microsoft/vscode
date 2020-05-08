/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';

export interface ITerminalWidget extends IDisposable {
	/**
	 * Only one widget of each ID can be displayed at once.
	 */
	id: string;
	attach(container: HTMLElement): void;
}

export enum HorizontalAnchorSide {
	Left,
	Right
}

export enum VerticalAnchorSide {
	Top,
	Bottom
}

export interface IHoverAnchor {
	x: number;
	y: number;
	horizontalAnchorSide: HorizontalAnchorSide;
	verticalAnchorSide: VerticalAnchorSide;
	/**
	 * Fallback Y value to try with opposite VerticalAlignment if the hover does not fit vertically.
	 */
	fallbackY: number;
}

/**
 * A target for a hover which can know about domain-specific locations.
 */
export interface IHoverTarget extends IDisposable {
	readonly targetElements: readonly HTMLElement[];
	readonly anchor: IHoverAnchor;
}
