/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';

/**
 * Describes the reason the cursor has changed its position.
 */
export const enum CursorChangeReason {
	/**
	 * Unknown or not set.
	 */
	NotSet = 0,
	/**
	 * A `model.setValue()` was called.
	 */
	ContentFlush = 1,
	/**
	 * The `model` has been changed outside of this cursor and the cursor recovers its position from associated markers.
	 */
	RecoverFromMarkers = 2,
	/**
	 * There was an explicit user gesture.
	 */
	Explicit = 3,
	/**
	 * There was a Paste.
	 */
	Paste = 4,
	/**
	 * There was an Undo.
	 */
	Undo = 5,
	/**
	 * There was a Redo.
	 */
	Redo = 6,
}
/**
 * An event describing that the cursor position has changed.
 */
export interface ICursorPositionChangedEvent {
	/**
	 * Primary cursor's position.
	 */
	readonly position: Position;
	/**
	 * Secondary cursors' position.
	 */
	readonly secondaryPositions: Position[];
	/**
	 * Reason.
	 */
	readonly reason: CursorChangeReason;
	/**
	 * Source of the call that caused the event.
	 */
	readonly source: string;
}
/**
 * An event describing that the cursor selection has changed.
 */
export interface ICursorSelectionChangedEvent {
	/**
	 * The primary selection.
	 */
	readonly selection: Selection;
	/**
	 * The secondary selections.
	 */
	readonly secondarySelections: Selection[];
	/**
	 * The model version id.
	 */
	readonly modelVersionId: number;
	/**
	 * The old selections.
	 */
	readonly oldSelections: Selection[] | null;
	/**
	 * The model version id the that `oldSelections` refer to.
	 */
	readonly oldModelVersionId: number;
	/**
	 * Source of the call that caused the event.
	 */
	readonly source: string;
	/**
	 * Reason.
	 */
	readonly reason: CursorChangeReason;
}
