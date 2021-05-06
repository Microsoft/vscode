/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'vs/base/common/assert';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import { IDiffEditor } from 'vs/editor/browser/editorBrowser';
import { ICursorPositionChangedEvent } from 'vs/editor/common/controller/cursorEvents';
import { Range } from 'vs/editor/common/core/range';
import { ILineChange, ScrollType } from 'vs/editor/common/editorCommon';


interface IDiffRange {
	rhs: boolean;
	range: Range;
}

export interface Options {
	followsCaret?: boolean;
	ignoreCharChanges?: boolean;
	alwaysRevealFirst?: boolean;
}

const defaultOptions: Options = {
	followsCaret: true,
	ignoreCharChanges: true,
	alwaysRevealFirst: true
};

export interface IDiffNavigator {
	canNavigate(): boolean;
	next(): void;
	previous(): void;
	dispose(): void;
}

/**
 * Create a new diff navigator for the provided diff editor.
 */
export class DiffNavigator extends Disposable implements IDiffNavigator {

	private readonly _editor: IDiffEditor;
	private readonly _options: Options;
	private readonly _onDidUpdate = this._register(new Emitter<this>());

	readonly onDidUpdate: Event<this> = this._onDidUpdate.event;

	private disposed: boolean;
	private revealFirst: boolean;
	private nextIdx: number;
	private ranges: IDiffRange[];
	private ignoreSelectionChange: boolean;

	constructor(editor: IDiffEditor, options: Options = {}) {
		super();
		this._editor = editor;
		this._options = objects.mixin(options, defaultOptions, false);

		this.disposed = false;

		this.nextIdx = -1;
		this.ranges = [];
		this.ignoreSelectionChange = false;
		this.revealFirst = Boolean(this._options.alwaysRevealFirst);

		// hook up to diff editor for diff, disposal, and caret move
		this._register(this._editor.onDidDispose(() => this.dispose()));
		this._register(this._editor.onDidUpdateDiff(() => this._onDiffUpdated()));

		if (this._options.followsCaret) {
			this._register(this._editor.getModifiedEditor().onDidChangeCursorPosition((e: ICursorPositionChangedEvent) => {
				if (this.ignoreSelectionChange) {
					return;
				}
				this.nextIdx = -1;
			}));
		}
		if (this._options.alwaysRevealFirst) {
			this._register(this._editor.getModifiedEditor().onDidChangeModel((e) => {
				this.revealFirst = true;
			}));
		}

		// init things
		this._init();
	}

	private _init(): void {
		let changes = this._editor.getLineChanges();
		if (!changes) {
			return;
		}
	}

	private _onDiffUpdated(): void {
		this._init();

		this._compute(this._editor.getLineChanges());
		if (this.revealFirst) {
			// Only reveal first on first non-null changes
			if (this._editor.getLineChanges() !== null) {
				this.revealFirst = false;
				this.nextIdx = -1;
				this.next(ScrollType.Immediate);
			}
		}
	}

	private _compute(lineChanges: ILineChange[] | null): void {

		// new ranges
		this.ranges = [];

		if (lineChanges) {
			// create ranges from changes
			lineChanges.forEach((lineChange) => {

				if (!this._options.ignoreCharChanges && lineChange.charChanges) {

					lineChange.charChanges.forEach((charChange) => {
						this.ranges.push({
							rhs: true,
							range: new Range(
								charChange.modifiedStartLineNumber,
								charChange.modifiedStartColumn,
								charChange.modifiedEndLineNumber,
								charChange.modifiedEndColumn)
						});
					});

				} else {
					this.ranges.push({
						rhs: true,
						range: new Range(lineChange.modifiedStartLineNumber, 1, lineChange.modifiedStartLineNumber, 1)
					});
				}
			});
		}

		// sort
		this.ranges.sort((left, right) => {
			if (left.range.getStartPosition().isBeforeOrEqual(right.range.getStartPosition())) {
				return -1;
			} else if (right.range.getStartPosition().isBeforeOrEqual(left.range.getStartPosition())) {
				return 1;
			} else {
				return 0;
			}
		});
		this._onDidUpdate.fire(this);
	}

	private _initIdx(fwd: boolean): void {
		let found = false;
		let position = this._editor.getPosition();
		if (!position) {
			this.nextIdx = 0;
			return;
		}
		for (let i = 0, len = this.ranges.length; i < len && !found; i++) {
			let range = this.ranges[i].range;
			if (position.isBeforeOrEqual(range.getStartPosition())) {
				this.nextIdx = i + (fwd ? 0 : -1);
				found = true;
			}
		}
		if (!found) {
			// after the last change
			this.nextIdx = fwd ? 0 : this.ranges.length - 1;
		}
		if (this.nextIdx < 0) {
			this.nextIdx = this.ranges.length - 1;
		}
	}

	private _move(fwd: boolean, scrollType: ScrollType): void {
		assert.ok(!this.disposed, 'Illegal State - diff navigator has been disposed');

		if (!this.canNavigate()) {
			return;
		}

		if (this.nextIdx === -1) {
			this._initIdx(fwd);

		} else if (fwd) {
			this.nextIdx += 1;
			if (this.nextIdx >= this.ranges.length) {
				this.nextIdx = 0;
			}
		} else {
			this.nextIdx -= 1;
			if (this.nextIdx < 0) {
				this.nextIdx = this.ranges.length - 1;
			}
		}

		let info = this.ranges[this.nextIdx];
		this.ignoreSelectionChange = true;
		try {
			let pos = info.range.getStartPosition();
			this._editor.setPosition(pos);
			this._editor.revealPositionInCenter(pos, scrollType);
		} finally {
			this.ignoreSelectionChange = false;
		}
	}

	canNavigate(): boolean {
		return this.ranges && this.ranges.length > 0;
	}

	next(scrollType: ScrollType = ScrollType.Smooth): void {
		this._move(true, scrollType);
	}

	previous(scrollType: ScrollType = ScrollType.Smooth): void {
		this._move(false, scrollType);
	}

	override dispose(): void {
		super.dispose();
		this.ranges = [];
		this.disposed = true;
	}
}
