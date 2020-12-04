/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import * as viewEvents from 'vs/editor/common/view/viewEvents';

export class ViewEventHandler extends Disposable {

	private _shouldRender: boolean;

	constructor() {
		super();
		this._shouldRender = true;
	}

	public shouldRender(): boolean {
		return this._shouldRender;
	}

	public forceShouldRender(): void {
		this._shouldRender = true;
	}

	protected setShouldRender(): void {
		this._shouldRender = true;
	}

	public onDidRender(): void {
		this._shouldRender = false;
	}

	// --- begin event handlers

	public onCompositionStart(e: viewEvents.ViewCompositionStartEvent): boolean {
		return false;
	}
	public onCompositionEnd(e: viewEvents.ViewCompositionEndEvent): boolean {
		return false;
	}
	public onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		return false;
	}
	public onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): boolean {
		return false;
	}
	public onDecorationsChanged(e: viewEvents.ViewDecorationsChangedEvent): boolean {
		return false;
	}
	public onFlushed(e: viewEvents.ViewFlushedEvent): boolean {
		return false;
	}
	public onFocusChanged(e: viewEvents.ViewFocusChangedEvent): boolean {
		return false;
	}
	public onLanguageConfigurationChanged(e: viewEvents.ViewLanguageConfigurationEvent): boolean {
		return false;
	}
	public onLineMappingChanged(e: viewEvents.ViewLineMappingChangedEvent): boolean {
		return false;
	}
	public onLinesChanged(e: viewEvents.ViewLinesChangedEvent): boolean {
		return false;
	}
	public onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		return false;
	}
	public onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		return false;
	}
	public onRevealRangeRequest(e: viewEvents.ViewRevealRangeRequestEvent): boolean {
		return false;
	}
	public onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		return false;
	}
	public onThemeChanged(e: viewEvents.ViewThemeChangedEvent): boolean {
		return false;
	}
	public onTokensChanged(e: viewEvents.ViewTokensChangedEvent): boolean {
		return false;
	}
	public onTokensColorsChanged(e: viewEvents.ViewTokensColorsChangedEvent): boolean {
		return false;
	}
	public onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		return false;
	}

	// --- end event handlers

	public handleEvents(events: viewEvents.ViewEvent[]): void {

		let shouldRender = false;

		for (let i = 0, len = events.length; i < len; i++) {
			let e = events[i];

			switch (e.type) {

				case viewEvents.ViewEventType.ViewCompositionStart:
					if (this.onCompositionStart(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewCompositionEnd:
					if (this.onCompositionEnd(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewConfigurationChanged:
					if (this.onConfigurationChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewCursorStateChanged:
					if (this.onCursorStateChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewDecorationsChanged:
					if (this.onDecorationsChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewFlushed:
					if (this.onFlushed(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewFocusChanged:
					if (this.onFocusChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewLanguageConfigurationChanged:
					if (this.onLanguageConfigurationChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewLineMappingChanged:
					if (this.onLineMappingChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewLinesChanged:
					if (this.onLinesChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewLinesDeleted:
					if (this.onLinesDeleted(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewLinesInserted:
					if (this.onLinesInserted(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewRevealRangeRequest:
					if (this.onRevealRangeRequest(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewScrollChanged:
					if (this.onScrollChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewTokensChanged:
					if (this.onTokensChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewThemeChanged:
					if (this.onThemeChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewTokensColorsChanged:
					if (this.onTokensColorsChanged(e)) {
						shouldRender = true;
					}
					break;

				case viewEvents.ViewEventType.ViewZonesChanged:
					if (this.onZonesChanged(e)) {
						shouldRender = true;
					}
					break;

				default:
					console.info('View received unknown event: ');
					console.info(e);
			}
		}

		if (shouldRender) {
			this._shouldRender = true;
		}
	}
}
