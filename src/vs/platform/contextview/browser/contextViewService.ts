/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextViewService, IContextViewDelegate } from './contextView';
import { ContextView, ContextViewDOMPosition } from 'vs/base/browser/ui/contextview/contextview';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';

export class ContextViewService extends Disposable implements IContextViewService {
	declare readonly _serviceBrand: undefined;

	private currentViewDisposable: IDisposable = Disposable.None;
	private contextView: ContextView;
	private container: HTMLElement;

	constructor(
		@ILayoutService readonly layoutService: ILayoutService
	) {
		super();

		this.container = layoutService.container;
		this.contextView = this._register(new ContextView(this.container, ContextViewDOMPosition.ABSOLUTE));
		this.layout();

		this._register(layoutService.onLayout(() => this.layout()));
	}

	// ContextView

	setContainer(container: HTMLElement, domPosition?: ContextViewDOMPosition): void {
		this.contextView.setContainer(container, domPosition || ContextViewDOMPosition.ABSOLUTE);
	}

	showContextView(delegate: IContextViewDelegate, container?: HTMLElement, shadowRoot?: boolean): IDisposable {
		if (container) {
			if (container !== this.container) {
				this.container = container;
				this.setContainer(container, shadowRoot ? ContextViewDOMPosition.FIXED_SHADOW : ContextViewDOMPosition.FIXED);
			}
		} else {
			if (this.container !== this.layoutService.container) {
				this.container = this.layoutService.container;
				this.setContainer(this.container, ContextViewDOMPosition.ABSOLUTE);
			}
		}

		this.contextView.show(delegate);

		const disposable = toDisposable(() => {
			if (this.currentViewDisposable === disposable) {
				this.hideContextView();
			}
		});

		this.currentViewDisposable = disposable;
		return disposable;
	}

	layout(): void {
		this.contextView.layout();
	}

	hideContextView(data?: any): void {
		this.contextView.hide(data);
	}
}
