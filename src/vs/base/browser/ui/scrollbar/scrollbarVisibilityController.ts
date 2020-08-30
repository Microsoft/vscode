/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FastDomNode } from 'vs/base/browser/fastDomNode';
import { TimeoutTimer } from 'vs/base/common/async';
import { Disposable } from 'vs/base/common/lifecycle';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';

export class ScrollbarVisibilityController extends Disposable {
	private _visibility: ScrollbarVisibility;
	private _visibleClassName: string;
	private _invisibleClassName: string;
	private _domNode: FastDomNode<HTMLElement> | null;
	private _shouldBeVisible: boolean;
	private _isNeeded: boolean;
	private _isVisible: boolean;
	private _revealTimer: TimeoutTimer;

	constructor(visibility: ScrollbarVisibility, visibleClassName: string, invisibleClassName: string) {
		super();
		this._visibility = visibility;
		this._visibleClassName = visibleClassName;
		this._invisibleClassName = invisibleClassName;
		this._domNode = null;
		this._isVisible = false;
		this._isNeeded = false;
		this._shouldBeVisible = false;
		this._revealTimer = this._register(new TimeoutTimer());
	}

	// ----------------- Hide / Reveal

	private applyVisibilitySetting(shouldBeVisible: boolean): boolean {
		if (this._visibility === ScrollbarVisibility.Hidden) {
			return false;
		}
		if (this._visibility === ScrollbarVisibility.Visible) {
			return true;
		}
		return shouldBeVisible;
	}

	public setShouldBeVisible(rawShouldBeVisible: boolean): void {
		let shouldBeVisible = this.applyVisibilitySetting(rawShouldBeVisible);

		if (this._shouldBeVisible !== shouldBeVisible) {
			this._shouldBeVisible = shouldBeVisible;
			this.ensureVisibility();
		}
	}

	public setIsNeeded(isNeeded: boolean): void {
		if (this._isNeeded !== isNeeded) {
			this._isNeeded = isNeeded;
			this.ensureVisibility();
		}
	}

	public setDomNode(domNode: FastDomNode<HTMLElement>): void {
		this._domNode = domNode;
		this._domNode.setClassName(this._invisibleClassName);

		// Now that the flags & the dom node are in a consistent state, ensure the Hidden/Visible configuration
		this.setShouldBeVisible(false);
	}

	public ensureVisibility(): void {

		if (!this._isNeeded) {
			// Nothing to be rendered
			this._hide(false);
			return;
		}

		if (this._shouldBeVisible) {
			this._reveal();
		} else {
			this._hide(true);
		}
	}

	private _reveal(): void {
		if (this._isVisible) {
			return;
		}
		this._isVisible = true;

		// The CSS animation doesn't play otherwise
		this._revealTimer.setIfNotSet(() => {
			if (this._domNode) {
				this._domNode.setClassName(this._visibleClassName);
			}
		}, 0);
	}

	private _hide(withFadeAway: boolean): void {
		this._revealTimer.cancel();
		if (!this._isVisible) {
			return;
		}
		this._isVisible = false;
		if (this._domNode) {
			this._domNode.setClassName(this._invisibleClassName + (withFadeAway ? ' fade' : ''));
		}
	}
}
