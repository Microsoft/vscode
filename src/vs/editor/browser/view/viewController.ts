/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { CoreNavigationCommands } from 'vs/editor/browser/controller/coreCommands';
import { IEditorMouseEvent, IPartialEditorMouseEvent } from 'vs/editor/browser/editorBrowser';
import { ViewUserInputEvents } from 'vs/editor/browser/view/viewUserInputEvents';
import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';
import { IConfiguration } from 'vs/editor/common/editorCommon';
import { IViewModel } from 'vs/editor/common/viewModel/viewModel';
import { IMouseWheelEvent } from 'vs/base/browser/mouseEvent';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import * as platform from 'vs/base/common/platform';

export interface IMouseDispatchData {
	position: Position;
	/**
	 * Desired mouse column (e.g. when position.column gets clamped to text length -- clicking after text on a line).
	 */
	mouseColumn: number;
	startedOnLineNumbers: boolean;

	inSelectionMode: boolean;
	mouseDownCount: number;
	altKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;

	leftButton: boolean;
	middleButton: boolean;
}

export interface ICommandDelegate {
	paste(text: string, pasteOnNewLine: boolean, multicursorText: string[] | null, mode: string | null): void;
	type(text: string): void;
	replacePreviousChar(text: string, replaceCharCnt: number): void;
	startComposition(): void;
	endComposition(): void;
	cut(): void;
}

export class ViewController {

	private readonly configuration: IConfiguration;
	private readonly viewModel: IViewModel;
	private readonly userInputEvents: ViewUserInputEvents;
	private readonly commandDelegate: ICommandDelegate;

	constructor(
		configuration: IConfiguration,
		viewModel: IViewModel,
		userInputEvents: ViewUserInputEvents,
		commandDelegate: ICommandDelegate
	) {
		this.configuration = configuration;
		this.viewModel = viewModel;
		this.userInputEvents = userInputEvents;
		this.commandDelegate = commandDelegate;
	}

	public paste(text: string, pasteOnNewLine: boolean, multicursorText: string[] | null, mode: string | null): void {
		this.commandDelegate.paste(text, pasteOnNewLine, multicursorText, mode);
	}

	public type(text: string): void {
		this.commandDelegate.type(text);
	}

	public replacePreviousChar(text: string, replaceCharCnt: number): void {
		this.commandDelegate.replacePreviousChar(text, replaceCharCnt);
	}

	public compositionStart(): void {
		this.commandDelegate.startComposition();
	}

	public compositionEnd(): void {
		this.commandDelegate.endComposition();
	}

	public cut(): void {
		this.commandDelegate.cut();
	}

	public setSelection(modelSelection: Selection): void {
		CoreNavigationCommands.SetSelection.runCoreEditorCommand(this.viewModel, {
			source: 'keyboard',
			selection: modelSelection
		});
	}

	private _validateViewColumn(viewPosition: Position): Position {
		const minColumn = this.viewModel.getLineMinColumn(viewPosition.lineNumber);
		if (viewPosition.column < minColumn) {
			return new Position(viewPosition.lineNumber, minColumn);
		}
		return viewPosition;
	}

	private _hasMulticursorModifier(data: IMouseDispatchData): boolean {
		switch (this.configuration.options.get(EditorOption.multiCursorModifier)) {
			case 'altKey':
				return data.altKey;
			case 'ctrlKey':
				return data.ctrlKey;
			case 'metaKey':
				return data.metaKey;
		}
		return false;
	}

	private _hasNonMulticursorModifier(data: IMouseDispatchData): boolean {
		switch (this.configuration.options.get(EditorOption.multiCursorModifier)) {
			case 'altKey':
				return data.ctrlKey || data.metaKey;
			case 'ctrlKey':
				return data.altKey || data.metaKey;
			case 'metaKey':
				return data.ctrlKey || data.altKey;
		}
		return false;
	}

	public dispatchMouse(data: IMouseDispatchData): void {
		const options = this.configuration.options;
		const selectionClipboardIsOn = (platform.isLinux && options.get(EditorOption.selectionClipboard));
		const columnSelection = options.get(EditorOption.columnSelection);
		if (data.middleButton && !selectionClipboardIsOn) {
			this._columnSelect(data.position, data.mouseColumn, data.inSelectionMode);
		} else if (data.startedOnLineNumbers) {
			// If the dragging started on the gutter, then have operations work on the entire line
			if (this._hasMulticursorModifier(data)) {
				if (data.inSelectionMode) {
					this._lastCursorLineSelect(data.position);
				} else {
					this._createCursor(data.position, true);
				}
			} else {
				if (data.inSelectionMode) {
					this._lineSelectDrag(data.position);
				} else {
					this._lineSelect(data.position);
				}
			}
		} else if (data.mouseDownCount >= 4) {
			this._selectAll();
		} else if (data.mouseDownCount === 3) {
			if (this._hasMulticursorModifier(data)) {
				if (data.inSelectionMode) {
					this._lastCursorLineSelectDrag(data.position);
				} else {
					this._lastCursorLineSelect(data.position);
				}
			} else {
				if (data.inSelectionMode) {
					this._lineSelectDrag(data.position);
				} else {
					this._lineSelect(data.position);
				}
			}
		} else if (data.mouseDownCount === 2) {
			if (this._hasMulticursorModifier(data)) {
				this._lastCursorWordSelect(data.position);
			} else {
				if (data.inSelectionMode) {
					this._wordSelectDrag(data.position);
				} else {
					this._wordSelect(data.position);
				}
			}
		} else {
			if (this._hasMulticursorModifier(data)) {
				if (!this._hasNonMulticursorModifier(data)) {
					if (data.shiftKey) {
						this._columnSelect(data.position, data.mouseColumn, true);
					} else {
						// Do multi-cursor operations only when purely alt is pressed
						if (data.inSelectionMode) {
							this._lastCursorMoveToSelect(data.position);
						} else {
							this._createCursor(data.position, false);
						}
					}
				}
			} else {
				if (data.inSelectionMode) {
					if (data.altKey) {
						this._columnSelect(data.position, data.mouseColumn, true);
					} else {
						if (columnSelection) {
							this._columnSelect(data.position, data.mouseColumn, true);
						} else {
							this._moveToSelect(data.position);
						}
					}
				} else {
					this.moveTo(data.position);
				}
			}
		}
	}

	private _usualArgs(viewPosition: Position) {
		viewPosition = this._validateViewColumn(viewPosition);
		return {
			source: 'mouse',
			position: this._convertViewToModelPosition(viewPosition),
			viewPosition: viewPosition
		};
	}

	public moveTo(viewPosition: Position): void {
		CoreNavigationCommands.MoveTo.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _moveToSelect(viewPosition: Position): void {
		CoreNavigationCommands.MoveToSelect.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _columnSelect(viewPosition: Position, mouseColumn: number, doColumnSelect: boolean): void {
		viewPosition = this._validateViewColumn(viewPosition);
		CoreNavigationCommands.ColumnSelect.runCoreEditorCommand(this.viewModel, {
			source: 'mouse',
			position: this._convertViewToModelPosition(viewPosition),
			viewPosition: viewPosition,
			mouseColumn: mouseColumn,
			doColumnSelect: doColumnSelect
		});
	}

	private _createCursor(viewPosition: Position, wholeLine: boolean): void {
		viewPosition = this._validateViewColumn(viewPosition);
		CoreNavigationCommands.CreateCursor.runCoreEditorCommand(this.viewModel, {
			source: 'mouse',
			position: this._convertViewToModelPosition(viewPosition),
			viewPosition: viewPosition,
			wholeLine: wholeLine
		});
	}

	private _lastCursorMoveToSelect(viewPosition: Position): void {
		CoreNavigationCommands.LastCursorMoveToSelect.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _wordSelect(viewPosition: Position): void {
		CoreNavigationCommands.WordSelect.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _wordSelectDrag(viewPosition: Position): void {
		CoreNavigationCommands.WordSelectDrag.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _lastCursorWordSelect(viewPosition: Position): void {
		CoreNavigationCommands.LastCursorWordSelect.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _lineSelect(viewPosition: Position): void {
		CoreNavigationCommands.LineSelect.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _lineSelectDrag(viewPosition: Position): void {
		CoreNavigationCommands.LineSelectDrag.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _lastCursorLineSelect(viewPosition: Position): void {
		CoreNavigationCommands.LastCursorLineSelect.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _lastCursorLineSelectDrag(viewPosition: Position): void {
		CoreNavigationCommands.LastCursorLineSelectDrag.runCoreEditorCommand(this.viewModel, this._usualArgs(viewPosition));
	}

	private _selectAll(): void {
		CoreNavigationCommands.SelectAll.runCoreEditorCommand(this.viewModel, { source: 'mouse' });
	}

	// ----------------------

	private _convertViewToModelPosition(viewPosition: Position): Position {
		return this.viewModel.coordinatesConverter.convertViewPositionToModelPosition(viewPosition);
	}

	public emitKeyDown(e: IKeyboardEvent): void {
		this.userInputEvents.emitKeyDown(e);
	}

	public emitKeyUp(e: IKeyboardEvent): void {
		this.userInputEvents.emitKeyUp(e);
	}

	public emitContextMenu(e: IEditorMouseEvent): void {
		this.userInputEvents.emitContextMenu(e);
	}

	public emitMouseMove(e: IEditorMouseEvent): void {
		this.userInputEvents.emitMouseMove(e);
	}

	public emitMouseLeave(e: IPartialEditorMouseEvent): void {
		this.userInputEvents.emitMouseLeave(e);
	}

	public emitMouseUp(e: IEditorMouseEvent): void {
		this.userInputEvents.emitMouseUp(e);
	}

	public emitMouseDown(e: IEditorMouseEvent): void {
		this.userInputEvents.emitMouseDown(e);
	}

	public emitMouseDrag(e: IEditorMouseEvent): void {
		this.userInputEvents.emitMouseDrag(e);
	}

	public emitMouseDrop(e: IPartialEditorMouseEvent): void {
		this.userInputEvents.emitMouseDrop(e);
	}

	public emitMouseWheel(e: IMouseWheelEvent): void {
		this.userInputEvents.emitMouseWheel(e);
	}
}
