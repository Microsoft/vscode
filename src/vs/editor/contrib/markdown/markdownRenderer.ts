/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMarkdownString } from 'vs/base/common/htmlContent';
import { renderMarkdown, MarkdownRenderOptions } from 'vs/base/browser/markdownRenderer';
import { IOpenerService, NullOpenerService } from 'vs/platform/opener/common/opener';
import { IModeService } from 'vs/editor/common/services/modeService';
import { onUnexpectedError } from 'vs/base/common/errors';
import { tokenizeToString } from 'vs/editor/common/modes/textToHtmlTokenizer';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { optional } from 'vs/platform/instantiation/common/instantiation';
import { Event, Emitter } from 'vs/base/common/event';
import { IDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { TokenizationRegistry } from 'vs/editor/common/modes';
import { EditorOption } from 'vs/editor/common/config/editorOptions';

export interface IMarkdownRenderResult extends IDisposable {
	element: HTMLElement;
}

export class MarkdownRenderer extends Disposable {

	private _onDidRenderCodeBlock = this._register(new Emitter<void>());
	readonly onDidRenderCodeBlock: Event<void> = this._onDidRenderCodeBlock.event;

	constructor(
		private readonly _editor: ICodeEditor,
		@IModeService private readonly _modeService: IModeService,
		@optional(IOpenerService) private readonly _openerService: IOpenerService = NullOpenerService,
	) {
		super();
	}

	private getOptions(disposeables: DisposableStore): MarkdownRenderOptions {
		return {
			codeBlockRenderer: (languageAlias, value) => {
				// In markdown,
				// it is possible that we stumble upon language aliases (e.g.js instead of javascript)
				// it is possible no alias is given in which case we fall back to the current editor lang
				let modeId: string | null = null;
				if (languageAlias) {
					modeId = this._modeService.getModeIdForLanguageName(languageAlias);
				} else {
					const model = this._editor.getModel();
					if (model) {
						modeId = model.getLanguageIdentifier().language;
					}
				}

				this._modeService.triggerMode(modeId || '');
				return Promise.resolve(true).then(_ => {
					const promise = TokenizationRegistry.getPromise(modeId || '');
					if (promise) {
						return promise.then(support => tokenizeToString(value, support));
					}
					return tokenizeToString(value, undefined);
				}).then(code => {
					return `<span style="font-family: ${this._editor.getOption(EditorOption.fontInfo).fontFamily}">${code}</span>`;
				});
			},
			codeBlockRenderCallback: () => this._onDidRenderCodeBlock.fire(),
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
			element = renderMarkdown(markdown, this.getOptions(disposeables));
		}

		return {
			element,
			dispose: () => disposeables.dispose()
		};
	}
}
