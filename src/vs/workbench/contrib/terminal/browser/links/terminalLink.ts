/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewportRange, IBufferRange, ILink, ILinkDecorations } from 'xterm';
import { DisposableStore } from 'vs/base/common/lifecycle';
import * as dom from 'vs/base/browser/dom';
import { RunOnceScheduler } from 'vs/base/common/async';
import { convertBufferRangeToViewport } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkHelpers';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { isMacintosh } from 'vs/base/common/platform';
import { localize } from 'vs/nls';
import { Emitter, Event } from 'vs/base/common/event';

export const OPEN_FILE_LABEL = localize('openFile', 'Open file in editor');
export const FOLDER_IN_WORKSPACE_LABEL = localize('focusFolder', 'Focus folder in explorer');
export const FOLDER_NOT_IN_WORKSPACE_LABEL = localize('openFolder', 'Open folder in new window');

export class TerminalLink extends DisposableStore implements ILink {
	decorations: ILinkDecorations;

	private _tooltipScheduler: RunOnceScheduler | undefined;
	private _hoverListeners: DisposableStore | undefined;

	private readonly _onLeave = new Emitter<void>();
	public get onLeave(): Event<void> { return this._onLeave.event; }

	constructor(
		public readonly range: IBufferRange,
		public readonly text: string,
		private readonly _viewportY: number,
		private readonly _activateCallback: (event: MouseEvent | undefined, uri: string) => void,
		private readonly _tooltipCallback: (link: TerminalLink, viewportRange: IViewportRange, modifierDownCallback?: () => void, modifierUpCallback?: () => void) => void,
		private readonly _isHighConfidenceLink: boolean,
		public readonly label: string | undefined,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super();
		this.decorations = {
			pointerCursor: false,
			underline: this._isHighConfidenceLink
		};
	}

	dispose(): void {
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
		this.add(dom.addDisposableListener(document, 'keydown', e => {
			if (this._isModifierDown(e)) {
				this._enableDecorations();
			}
		}));
		this.add(dom.addDisposableListener(document, 'keyup', e => {
			if (!this._isModifierDown(e)) {
				this._disableDecorations();
			}
		}));

		// Only show the tooltip and highlight for high confidence links (not word/search workspace
		// links). Feedback was that this makes using the terminal overly noisy.
		if (this._isHighConfidenceLink) {
			const timeout = this._configurationService.getValue<number>('editor.hover.delay');
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
			}, timeout);
			this.add(this._tooltipScheduler);
			this._tooltipScheduler.schedule();
		}

		const origin = { x: event.pageX, y: event.pageY };
		this._hoverListeners = new DisposableStore();
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
		this._onLeave.fire();
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
