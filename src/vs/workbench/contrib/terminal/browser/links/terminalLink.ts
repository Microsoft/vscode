/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IViewportRange, IBufferRange, ILink, ILinkDecorations, Terminal } from 'xterm';
import { DisposableStore } from 'vs/base/common/lifecycle';
import * as dom from 'vs/base/browser/dom';
import { RunOnceScheduler } from 'vs/base/common/async';
import { convertBufferRangeToViewport } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkHelpers';
import { isMacintosh } from 'vs/base/common/platform';
import { localize } from 'vs/nls';
import { Emitter, Event } from 'vs/base/common/event';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export const OPEN_FILE_LABEL = localize('openFile', 'Open file in editor');
export const FOLDER_IN_WORKSPACE_LABEL = localize('focusFolder', 'Focus folder in explorer');
export const FOLDER_NOT_IN_WORKSPACE_LABEL = localize('openFolder', 'Open folder in new window');

export class TerminalLink extends DisposableStore implements ILink {
	decorations: ILinkDecorations;

	private _tooltipScheduler: RunOnceScheduler | undefined;
	private _hoverListeners: DisposableStore | undefined;

	private readonly _onInvalidated = new Emitter<void>();
	get onInvalidated(): Event<void> { return this._onInvalidated.event; }

	constructor(
		private readonly _xterm: Terminal,
		readonly range: IBufferRange,
		readonly text: string,
		private readonly _viewportY: number,
		private readonly _activateCallback: (event: MouseEvent | undefined, uri: string) => void,
		private readonly _tooltipCallback: (link: TerminalLink, viewportRange: IViewportRange, modifierDownCallback?: () => void, modifierUpCallback?: () => void) => void,
		private readonly _isHighConfidenceLink: boolean,
		readonly label: string | undefined,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();
		this.decorations = {
			pointerCursor: false,
			underline: this._isHighConfidenceLink
		};
	}

	override dispose(): void {
		super.dispose();
		this._hoverListeners?.dispose();
		this._hoverListeners = undefined;
		this._tooltipScheduler?.dispose();
		this._tooltipScheduler = undefined;
	}

	activate(event: MouseEvent | undefined, text: string): void {
		this._activateCallback(event, text);
	}

	hover(event: MouseEvent, text: string): void {
		// Listen for modifier before handing it off to the hover to handle so it gets disposed correctly
		this._hoverListeners = new DisposableStore();
		this._hoverListeners.add(dom.addDisposableListener(document, 'keydown', e => {
			if (!e.repeat && this._isModifierDown(e)) {
				this._enableDecorations();
			}
		}));
		this._hoverListeners.add(dom.addDisposableListener(document, 'keyup', e => {
			if (!e.repeat && !this._isModifierDown(e)) {
				this._disableDecorations();
			}
		}));

		// Listen for when the terminal renders on the same line as the link
		this._hoverListeners.add(this._xterm.onRender(e => {
			const viewportRangeY = this.range.start.y - this._viewportY;
			if (viewportRangeY >= e.start && viewportRangeY <= e.end) {
				this._onInvalidated.fire();
			}
		}));

		// Only show the tooltip and highlight for high confidence links (not word/search workspace
		// links). Feedback was that this makes using the terminal overly noisy.
		if (this._isHighConfidenceLink) {
			this._tooltipScheduler = new RunOnceScheduler(() => {
				this._tooltipCallback(
					this,
					convertBufferRangeToViewport(this.range, this._viewportY),
					this._isHighConfidenceLink ? () => this._enableDecorations() : undefined,
					this._isHighConfidenceLink ? () => this._disableDecorations() : undefined
				);
				// Clear out scheduler until next hover event
				this._tooltipScheduler?.dispose();
				this._tooltipScheduler = undefined;
			}, this._configurationService.getValue<number>('workbench.hover.delay'));
			this.add(this._tooltipScheduler);
			this._tooltipScheduler.schedule();
		}

		const origin = { x: event.pageX, y: event.pageY };
		this._hoverListeners.add(dom.addDisposableListener(document, dom.EventType.MOUSE_MOVE, e => {
			// Update decorations
			if (this._isModifierDown(e)) {
				this._enableDecorations();
			} else {
				this._disableDecorations();
			}

			// Reset the scheduler if the mouse moves too much
			if (Math.abs(e.pageX - origin.x) > window.devicePixelRatio * 2 || Math.abs(e.pageY - origin.y) > window.devicePixelRatio * 2) {
				origin.x = e.pageX;
				origin.y = e.pageY;
				this._tooltipScheduler?.schedule();
			}
		}));
	}

	leave(): void {
		this._hoverListeners?.dispose();
		this._hoverListeners = undefined;
		this._tooltipScheduler?.dispose();
		this._tooltipScheduler = undefined;
	}

	private _enableDecorations(): void {
		if (!this.decorations.pointerCursor) {
			this.decorations.pointerCursor = true;
		}
		if (!this.decorations.underline) {
			this.decorations.underline = true;
		}
	}

	private _disableDecorations(): void {
		if (this.decorations.pointerCursor) {
			this.decorations.pointerCursor = false;
		}
		if (this.decorations.underline !== this._isHighConfidenceLink) {
			this.decorations.underline = this._isHighConfidenceLink;
		}
	}

	private _isModifierDown(event: MouseEvent | KeyboardEvent): boolean {
		const multiCursorModifier = this._configurationService.getValue<'ctrlCmd' | 'alt'>('editor.multiCursorModifier');
		if (multiCursorModifier === 'ctrlCmd') {
			return !!event.altKey;
		}
		return isMacintosh ? event.metaKey : event.ctrlKey;
	}
}
