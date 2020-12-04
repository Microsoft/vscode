/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ScrollEvent } from 'vs/base/common/scrollable';
import { ConfigurationChangedEvent, EditorOption } from 'vs/editor/common/config/editorOptions';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { IModelDecorationsChangedEvent } from 'vs/editor/common/model/textModelEvents';

export const enum ViewEventType {
	ViewCompositionStart,
	ViewCompositionEnd,
	ViewConfigurationChanged,
	ViewCursorStateChanged,
	ViewDecorationsChanged,
	ViewFlushed,
	ViewFocusChanged,
	ViewLanguageConfigurationChanged,
	ViewLineMappingChanged,
	ViewLinesChanged,
	ViewLinesDeleted,
	ViewLinesInserted,
	ViewRevealRangeRequest,
	ViewScrollChanged,
	ViewThemeChanged,
	ViewTokensChanged,
	ViewTokensColorsChanged,
	ViewZonesChanged,
}

export class ViewCompositionStartEvent {
	public readonly type = ViewEventType.ViewCompositionStart;
	constructor() { }
}

export class ViewCompositionEndEvent {
	public readonly type = ViewEventType.ViewCompositionEnd;
	constructor() { }
}

export class ViewConfigurationChangedEvent {

	public readonly type = ViewEventType.ViewConfigurationChanged;

	public readonly _source: ConfigurationChangedEvent;

	constructor(source: ConfigurationChangedEvent) {
		this._source = source;
	}

	public hasChanged(id: EditorOption): boolean {
		return this._source.hasChanged(id);
	}
}

export class ViewCursorStateChangedEvent {

	public readonly type = ViewEventType.ViewCursorStateChanged;

	public readonly selections: Selection[];
	public readonly modelSelections: Selection[];

	constructor(selections: Selection[], modelSelections: Selection[]) {
		this.selections = selections;
		this.modelSelections = modelSelections;
	}
}

export class ViewDecorationsChangedEvent {

	public readonly type = ViewEventType.ViewDecorationsChanged;

	readonly affectsMinimap: boolean;
	readonly affectsOverviewRuler: boolean;

	constructor(source: IModelDecorationsChangedEvent | null) {
		if (source) {
			this.affectsMinimap = source.affectsMinimap;
			this.affectsOverviewRuler = source.affectsOverviewRuler;
		} else {
			this.affectsMinimap = true;
			this.affectsOverviewRuler = true;
		}
	}
}

export class ViewFlushedEvent {

	public readonly type = ViewEventType.ViewFlushed;

	constructor() {
		// Nothing to do
	}
}

export class ViewFocusChangedEvent {

	public readonly type = ViewEventType.ViewFocusChanged;

	public readonly isFocused: boolean;

	constructor(isFocused: boolean) {
		this.isFocused = isFocused;
	}
}

export class ViewLanguageConfigurationEvent {

	public readonly type = ViewEventType.ViewLanguageConfigurationChanged;
}

export class ViewLineMappingChangedEvent {

	public readonly type = ViewEventType.ViewLineMappingChanged;

	constructor() {
		// Nothing to do
	}
}

export class ViewLinesChangedEvent {

	public readonly type = ViewEventType.ViewLinesChanged;

	/**
	 * The first line that has changed.
	 */
	public readonly fromLineNumber: number;
	/**
	 * The last line that has changed.
	 */
	public readonly toLineNumber: number;

	constructor(fromLineNumber: number, toLineNumber: number) {
		this.fromLineNumber = fromLineNumber;
		this.toLineNumber = toLineNumber;
	}
}

export class ViewLinesDeletedEvent {

	public readonly type = ViewEventType.ViewLinesDeleted;

	/**
	 * At what line the deletion began (inclusive).
	 */
	public readonly fromLineNumber: number;
	/**
	 * At what line the deletion stopped (inclusive).
	 */
	public readonly toLineNumber: number;

	constructor(fromLineNumber: number, toLineNumber: number) {
		this.fromLineNumber = fromLineNumber;
		this.toLineNumber = toLineNumber;
	}
}

export class ViewLinesInsertedEvent {

	public readonly type = ViewEventType.ViewLinesInserted;

	/**
	 * Before what line did the insertion begin
	 */
	public readonly fromLineNumber: number;
	/**
	 * `toLineNumber` - `fromLineNumber` + 1 denotes the number of lines that were inserted
	 */
	public readonly toLineNumber: number;

	constructor(fromLineNumber: number, toLineNumber: number) {
		this.fromLineNumber = fromLineNumber;
		this.toLineNumber = toLineNumber;
	}
}

export const enum VerticalRevealType {
	Simple = 0,
	Center = 1,
	CenterIfOutsideViewport = 2,
	Top = 3,
	Bottom = 4,
	NearTop = 5,
	NearTopIfOutsideViewport = 6,
}

export class ViewRevealRangeRequestEvent {

	public readonly type = ViewEventType.ViewRevealRangeRequest;

	/**
	 * Range to be reavealed.
	 */
	public readonly range: Range | null;

	/**
	 * Selections to be revealed.
	 */
	public readonly selections: Selection[] | null;

	public readonly verticalType: VerticalRevealType;
	/**
	 * If true: there should be a horizontal & vertical revealing
	 * If false: there should be just a vertical revealing
	 */
	public readonly revealHorizontal: boolean;

	public readonly scrollType: ScrollType;

	/**
	 * Source of the call that caused the event.
	 */
	readonly source: string | null | undefined;

	constructor(source: string | null | undefined, range: Range | null, selections: Selection[] | null, verticalType: VerticalRevealType, revealHorizontal: boolean, scrollType: ScrollType) {
		this.source = source;
		this.range = range;
		this.selections = selections;
		this.verticalType = verticalType;
		this.revealHorizontal = revealHorizontal;
		this.scrollType = scrollType;
	}
}

export class ViewScrollChangedEvent {

	public readonly type = ViewEventType.ViewScrollChanged;

	public readonly scrollWidth: number;
	public readonly scrollLeft: number;
	public readonly scrollHeight: number;
	public readonly scrollTop: number;

	public readonly scrollWidthChanged: boolean;
	public readonly scrollLeftChanged: boolean;
	public readonly scrollHeightChanged: boolean;
	public readonly scrollTopChanged: boolean;

	constructor(source: ScrollEvent) {
		this.scrollWidth = source.scrollWidth;
		this.scrollLeft = source.scrollLeft;
		this.scrollHeight = source.scrollHeight;
		this.scrollTop = source.scrollTop;

		this.scrollWidthChanged = source.scrollWidthChanged;
		this.scrollLeftChanged = source.scrollLeftChanged;
		this.scrollHeightChanged = source.scrollHeightChanged;
		this.scrollTopChanged = source.scrollTopChanged;
	}
}

export class ViewThemeChangedEvent {

	public readonly type = ViewEventType.ViewThemeChanged;
}

export class ViewTokensChangedEvent {

	public readonly type = ViewEventType.ViewTokensChanged;

	public readonly ranges: {
		/**
		 * Start line number of range
		 */
		readonly fromLineNumber: number;
		/**
		 * End line number of range
		 */
		readonly toLineNumber: number;
	}[];

	constructor(ranges: { fromLineNumber: number; toLineNumber: number; }[]) {
		this.ranges = ranges;
	}
}

export class ViewTokensColorsChangedEvent {

	public readonly type = ViewEventType.ViewTokensColorsChanged;

	constructor() {
		// Nothing to do
	}
}

export class ViewZonesChangedEvent {

	public readonly type = ViewEventType.ViewZonesChanged;

	constructor() {
		// Nothing to do
	}
}

export type ViewEvent = (
	ViewCompositionStartEvent
	| ViewCompositionEndEvent
	| ViewConfigurationChangedEvent
	| ViewCursorStateChangedEvent
	| ViewDecorationsChangedEvent
	| ViewFlushedEvent
	| ViewFocusChangedEvent
	| ViewLanguageConfigurationEvent
	| ViewLineMappingChangedEvent
	| ViewLinesChangedEvent
	| ViewLinesDeletedEvent
	| ViewLinesInsertedEvent
	| ViewRevealRangeRequestEvent
	| ViewScrollChangedEvent
	| ViewThemeChangedEvent
	| ViewTokensChangedEvent
	| ViewTokensColorsChangedEvent
	| ViewZonesChangedEvent
);
