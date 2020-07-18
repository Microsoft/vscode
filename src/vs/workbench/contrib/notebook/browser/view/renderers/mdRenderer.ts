/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString } from 'vs/base/common/htmlContent';
import { renderMarkdown, MarkdownRenderOptions } from 'vs/base/browser/markdownRenderer';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IModeService } from 'vs/editor/common/services/modeService';
import { onUnexpectedError } from 'vs/base/common/errors';
import { tokenizeToString } from 'vs/editor/common/modes/textToHtmlTokenizer';
import { Event, Emitter } from 'vs/base/common/event';
import { IDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { TokenizationRegistry } from 'vs/editor/common/modes';
import { URI } from 'vs/base/common/uri';

export interface IMarkdownRenderResult extends IDisposable {
	element: HTMLElement;
}

export class MarkdownRenderer extends Disposable {

	private _onDidUpdateRender = this._register(new Emitter<void>());
	readonly onDidUpdateRender: Event<void> = this._onDidUpdateRender.event;

	constructor(
		private readonly _baseUrl: URI | undefined,
		@IModeService private readonly _modeService: IModeService,
		@IOpenerService private readonly _openerService: IOpenerService
	) {
		super();
	}

	private getOptions(disposeables: DisposableStore): MarkdownRenderOptions {
		return {
			baseUrl: this._baseUrl,
			codeBlockRenderer: (languageAlias, value) => {
				// In markdown,
				// it is possible that we stumble upon language aliases (e.g.js instead of javascript)
				// it is possible no alias is given in which case we fall back to the current editor lang
				let modeId: string | null = null;
				modeId = this._modeService.getModeIdForLanguageName(languageAlias || '');

				this._modeService.triggerMode(modeId || '');
				return Promise.resolve(true).then(_ => {
					const promise = TokenizationRegistry.getPromise(modeId || '');
					if (promise) {
						return promise.then(support => tokenizeToString(value, support));
					}
					return tokenizeToString(value, undefined);
				}).then(code => {
					return `<span>${code}</span>`;
				});
			},
			codeBlockRenderCallback: () => this._onDidUpdateRender.fire(),
			actionHandler: {
				callback: (content) => {
					this._openerService.open(content, { fromUserGesture: true }).catch(onUnexpectedError);
				},
				disposeables
			}
		};
	}

	render(markdown: IMarkdownString | undefined): IMarkdownRenderResult {
		const disposeables = new DisposableStore();

		let element: HTMLElement;
		if (!markdown) {
			element = document.createElement('span');
		} else {
			element = renderMarkdown(markdown, this.getOptions(disposeables), { gfm: true });
		}

		return {
			element,
			dispose: () => disposeables.dispose()
		};
	}
}

