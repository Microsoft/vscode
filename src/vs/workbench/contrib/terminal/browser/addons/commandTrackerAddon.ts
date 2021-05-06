/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Terminal, IMarker, ITerminalAddon } from 'xterm';
import { ICommandTracker } from 'vs/workbench/contrib/terminal/common/terminal';

/**
 * The minimum size of the prompt in which to assume the line is a command.
 */
const MINIMUM_PROMPT_LENGTH = 2;

enum Boundary {
	Top,
	Bottom
}

export const enum ScrollPosition {
	Top,
	Middle
}

export class CommandTrackerAddon implements ICommandTracker, ITerminalAddon {
	private _currentMarker: IMarker | Boundary = Boundary.Bottom;
	private _selectionStart: IMarker | Boundary | null = null;
	private _isDisposable: boolean = false;
	private _terminal: Terminal | undefined;

	activate(terminal: Terminal): void {
		this._terminal = terminal;
		terminal.onKey(e => this._onKey(e.key));
	}

	dispose(): void {
	}

	private _onKey(key: string): void {
		if (key === '\x0d') {
			this._onEnter();
		}

		// Clear the current marker so successive focus/selection actions are performed from the
		// bottom of the buffer
		this._currentMarker = Boundary.Bottom;
		this._selectionStart = null;
	}

	private _onEnter(): void {
		if (!this._terminal) {
			return;
		}
		if (this._terminal.buffer.active.cursorX >= MINIMUM_PROMPT_LENGTH) {
			this._terminal.registerMarker(0);
		}
	}

	scrollToPreviousCommand(scrollPosition: ScrollPosition = ScrollPosition.Top, retainSelection: boolean = false): void {
		if (!this._terminal) {
			return;
		}
		if (!retainSelection) {
			this._selectionStart = null;
		}

		let markerIndex;
		const currentLineY = Math.min(this._getLine(this._terminal, this._currentMarker), this._terminal.buffer.active.baseY);
		const viewportY = this._terminal.buffer.active.viewportY;
		if (!retainSelection && currentLineY !== viewportY) {
			// The user has scrolled, find the line based on the current scroll position. This only
			// works when not retaining selection
			const markersBelowViewport = this._terminal.markers.filter(e => e.line >= viewportY).length;
			// -1 will scroll to the top
			markerIndex = this._terminal.markers.length - markersBelowViewport - 1;
		} else if (this._currentMarker === Boundary.Bottom) {
			markerIndex = this._terminal.markers.length - 1;
		} else if (this._currentMarker === Boundary.Top) {
			markerIndex = -1;
		} else if (this._isDisposable) {
			markerIndex = this._findPreviousCommand(this._terminal);
			this._currentMarker.dispose();
			this._isDisposable = false;
		} else {
			markerIndex = this._terminal.markers.indexOf(this._currentMarker) - 1;
		}

		if (markerIndex < 0) {
			this._currentMarker = Boundary.Top;
			this._terminal.scrollToTop();
			return;
		}

		this._currentMarker = this._terminal.markers[markerIndex];
		this._scrollToMarker(this._currentMarker, scrollPosition);
	}

	scrollToNextCommand(scrollPosition: ScrollPosition = ScrollPosition.Top, retainSelection: boolean = false): void {
		if (!this._terminal) {
			return;
		}
		if (!retainSelection) {
			this._selectionStart = null;
		}

		let markerIndex;
		const currentLineY = Math.min(this._getLine(this._terminal, this._currentMarker), this._terminal.buffer.active.baseY);
		const viewportY = this._terminal.buffer.active.viewportY;
		if (!retainSelection && currentLineY !== viewportY) {
			// The user has scrolled, find the line based on the current scroll position. This only
			// works when not retaining selection
			const markersAboveViewport = this._terminal.markers.filter(e => e.line <= viewportY).length;
			// markers.length will scroll to the bottom
			markerIndex = markersAboveViewport;
		} else if (this._currentMarker === Boundary.Bottom) {
			markerIndex = this._terminal.markers.length;
		} else if (this._currentMarker === Boundary.Top) {
			markerIndex = 0;
		} else if (this._isDisposable) {
			markerIndex = this._findNextCommand(this._terminal);
			this._currentMarker.dispose();
			this._isDisposable = false;
		} else {
			markerIndex = this._terminal.markers.indexOf(this._currentMarker) + 1;
		}

		if (markerIndex >= this._terminal.markers.length) {
			this._currentMarker = Boundary.Bottom;
			this._terminal.scrollToBottom();
			return;
		}

		this._currentMarker = this._terminal.markers[markerIndex];
		this._scrollToMarker(this._currentMarker, scrollPosition);
	}

	private _scrollToMarker(marker: IMarker, position: ScrollPosition): void {
		if (!this._terminal) {
			return;
		}
		let line = marker.line;
		if (position === ScrollPosition.Middle) {
			line = Math.max(line - Math.floor(this._terminal.rows / 2), 0);
		}
		this._terminal.scrollToLine(line);
	}

	selectToPreviousCommand(): void {
		if (!this._terminal) {
			return;
		}
		if (this._selectionStart === null) {
			this._selectionStart = this._currentMarker;
		}
		this.scrollToPreviousCommand(ScrollPosition.Middle, true);
		this._selectLines(this._terminal, this._currentMarker, this._selectionStart);
	}

	selectToNextCommand(): void {
		if (!this._terminal) {
			return;
		}
		if (this._selectionStart === null) {
			this._selectionStart = this._currentMarker;
		}
		this.scrollToNextCommand(ScrollPosition.Middle, true);
		this._selectLines(this._terminal, this._currentMarker, this._selectionStart);
	}

	selectToPreviousLine(): void {
		if (!this._terminal) {
			return;
		}
		if (this._selectionStart === null) {
			this._selectionStart = this._currentMarker;
		}
		this.scrollToPreviousLine(this._terminal, ScrollPosition.Middle, true);
		this._selectLines(this._terminal, this._currentMarker, this._selectionStart);
	}

	selectToNextLine(): void {
		if (!this._terminal) {
			return;
		}
		if (this._selectionStart === null) {
			this._selectionStart = this._currentMarker;
		}
		this.scrollToNextLine(this._terminal, ScrollPosition.Middle, true);
		this._selectLines(this._terminal, this._currentMarker, this._selectionStart);
	}

	private _selectLines(xterm: Terminal, start: IMarker | Boundary, end: IMarker | Boundary | null): void {
		if (end === null) {
			end = Boundary.Bottom;
		}

		let startLine = this._getLine(xterm, start);
		let endLine = this._getLine(xterm, end);

		if (startLine > endLine) {
			const temp = startLine;
			startLine = endLine;
			endLine = temp;
		}

		// Subtract a line as the marker is on the line the command run, we do not want the next
		// command in the selection for the current command
		endLine -= 1;

		xterm.selectLines(startLine, endLine);
	}

	private _getLine(xterm: Terminal, marker: IMarker | Boundary): number {
		// Use the _second last_ row as the last row is likely the prompt
		if (marker === Boundary.Bottom) {
			return xterm.buffer.active.baseY + xterm.rows - 1;
		}

		if (marker === Boundary.Top) {
			return 0;
		}

		return marker.line;
	}

	scrollToPreviousLine(xterm: Terminal, scrollPosition: ScrollPosition = ScrollPosition.Top, retainSelection: boolean = false): void {
		if (!retainSelection) {
			this._selectionStart = null;
		}

		if (this._currentMarker === Boundary.Top) {
			xterm.scrollToTop();
			return;
		}

		if (this._currentMarker === Boundary.Bottom) {
			this._currentMarker = this._addMarkerOrThrow(xterm, this._getOffset(xterm) - 1);
		} else {
			const offset = this._getOffset(xterm);
			if (this._isDisposable) {
				this._currentMarker.dispose();
			}
			this._currentMarker = this._addMarkerOrThrow(xterm, offset - 1);
		}
		this._isDisposable = true;
		this._scrollToMarker(this._currentMarker, scrollPosition);
	}

	scrollToNextLine(xterm: Terminal, scrollPosition: ScrollPosition = ScrollPosition.Top, retainSelection: boolean = false): void {
		if (!retainSelection) {
			this._selectionStart = null;
		}

		if (this._currentMarker === Boundary.Bottom) {
			xterm.scrollToBottom();
			return;
		}

		if (this._currentMarker === Boundary.Top) {
			this._currentMarker = this._addMarkerOrThrow(xterm, this._getOffset(xterm) + 1);
		} else {
			const offset = this._getOffset(xterm);
			if (this._isDisposable) {
				this._currentMarker.dispose();
			}
			this._currentMarker = this._addMarkerOrThrow(xterm, offset + 1);
		}
		this._isDisposable = true;
		this._scrollToMarker(this._currentMarker, scrollPosition);
	}

	private _addMarkerOrThrow(xterm: Terminal, cursorYOffset: number): IMarker {
		const marker = xterm.addMarker(cursorYOffset);
		if (!marker) {
			throw new Error(`Could not create marker for ${cursorYOffset}`);
		}
		return marker;
	}

	private _getOffset(xterm: Terminal): number {
		if (this._currentMarker === Boundary.Bottom) {
			return 0;
		} else if (this._currentMarker === Boundary.Top) {
			return 0 - (xterm.buffer.active.baseY + xterm.buffer.active.cursorY);
		} else {
			let offset = this._getLine(xterm, this._currentMarker);
			offset -= xterm.buffer.active.baseY + xterm.buffer.active.cursorY;
			return offset;
		}
	}

	private _findPreviousCommand(xterm: Terminal): number {
		if (this._currentMarker === Boundary.Top) {
			return 0;
		} else if (this._currentMarker === Boundary.Bottom) {
			return xterm.markers.length - 1;
		}

		let i;
		for (i = xterm.markers.length - 1; i >= 0; i--) {
			if (xterm.markers[i].line < this._currentMarker.line) {
				return i;
			}
		}

		return -1;
	}

	private _findNextCommand(xterm: Terminal): number {
		if (this._currentMarker === Boundary.Top) {
			return 0;
		} else if (this._currentMarker === Boundary.Bottom) {
			return xterm.markers.length - 1;
		}

		let i;
		for (i = 0; i < xterm.markers.length; i++) {
			if (xterm.markers[i].line > this._currentMarker.line) {
				return i;
			}
		}

		return xterm.markers.length;
	}
}
