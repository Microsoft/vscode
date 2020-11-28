/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TimeoutTimer } from 'vs/base/common/async';
import { IDisposable } from 'vs/base/common/lifecycle';
import * as strings from 'vs/base/common/strings';
import { IViewLineTokens, LineTokens } from 'vs/editor/common/core/lineTokens';
import { ITextModel } from 'vs/editor/common/model';
import { ColorId, FontStyle, ITokenizationSupport, MetadataConsts, TokenizationRegistry } from 'vs/editor/common/modes';
import { IModeService } from 'vs/editor/common/services/modeService';
import { RenderLineInput, renderViewLine2 as renderViewLine } from 'vs/editor/common/viewLayout/viewLineRenderer';
import { ViewLineRenderingData } from 'vs/editor/common/viewModel/viewModel';
import { IStandaloneThemeService } from 'vs/editor/standalone/common/standaloneThemeService';
import { MonarchTokenizer } from 'vs/editor/standalone/common/monarch/monarchLexer';

const ttPolicy = window.trustedTypes?.createPolicy('standaloneColorizer', { createHTML: value => value });

export interface IColorizerOptions {
	tabSize?: number;
}

export interface IColorizerElementOptions extends IColorizerOptions {
	theme?: string;
	mimeType?: string;
}

export class Colorizer {

	public static colorizeElement(themeService: IStandaloneThemeService, modeService: IModeService, domNode: HTMLElement, options: IColorizerElementOptions): Promise<void> {
		options = options || {};
		let theme = options.theme || 'vs';
		let mimeType = options.mimeType || domNode.getAttribute('lang') || domNode.getAttribute('data-lang');
		if (!mimeType) {
			console.error('Mode not detected');
			return Promise.resolve();
		}

		themeService.setTheme(theme);

		let text = domNode.firstChild ? domNode.firstChild.nodeValue : '';
		domNode.className += ' ' + theme;
		let render = (str: string) => {
			const trustedhtml = ttPolicy ? ttPolicy.createHTML(str) : str;
			domNode.innerHTML = trustedhtml as unknown as string;
		};
		return this.colorize(modeService, text || '', mimeType, options).then(render, (err) => console.error(err));
	}

	public static colorize(modeService: IModeService, text: string, mimeType: string, options: IColorizerOptions | null | undefined): Promise<string> {
		let tabSize = 4;
		if (options && typeof options.tabSize === 'number') {
			tabSize = options.tabSize;
		}

		if (strings.startsWithUTF8BOM(text)) {
			text = text.substr(1);
		}
		let lines = strings.splitLines(text);
		let language = modeService.getModeId(mimeType);
		if (!language) {
			return Promise.resolve(_fakeColorize(lines, tabSize));
		}

		// Send out the event to create the mode
		modeService.triggerMode(language);

		const tokenizationSupport = TokenizationRegistry.get(language);
		if (tokenizationSupport) {
			return _colorize(lines, tabSize, tokenizationSupport);
		}

		const tokenizationSupportPromise = TokenizationRegistry.getPromise(language);
		if (tokenizationSupportPromise) {
			// A tokenizer will be registered soon
			return new Promise<string>((resolve, reject) => {
				tokenizationSupportPromise.then(tokenizationSupport => {
					_colorize(lines, tabSize, tokenizationSupport).then(resolve, reject);
				}, reject);
			});
		}

		return new Promise<string>((resolve, reject) => {
			let listener: IDisposable | null = null;
			let timeout: TimeoutTimer | null = null;

			const execute = () => {
				if (listener) {
					listener.dispose();
					listener = null;
				}
				if (timeout) {
					timeout.dispose();
					timeout = null;
				}
				const tokenizationSupport = TokenizationRegistry.get(language!);
				if (tokenizationSupport) {
					_colorize(lines, tabSize, tokenizationSupport).then(resolve, reject);
					return;
				}
				resolve(_fakeColorize(lines, tabSize));
			};

			// wait 500ms for mode to load, then give up
			timeout = new TimeoutTimer();
			timeout.cancelAndSet(execute, 500);
			listener = TokenizationRegistry.onDidChange((e) => {
				if (e.changedLanguages.indexOf(language!) >= 0) {
					execute();
				}
			});
		});
	}

	public static colorizeLine(line: string, mightContainNonBasicASCII: boolean, mightContainRTL: boolean, tokens: IViewLineTokens, tabSize: number = 4): string {
		const isBasicASCII = ViewLineRenderingData.isBasicASCII(line, mightContainNonBasicASCII);
		const containsRTL = ViewLineRenderingData.containsRTL(line, isBasicASCII, mightContainRTL);
		let renderResult = renderViewLine(new RenderLineInput(
			false,
			true,
			line,
			false,
			isBasicASCII,
			containsRTL,
			0,
			tokens,
			[],
			tabSize,
			0,
			0,
			0,
			0,
			-1,
			'none',
			false,
			false,
			null
		));
		return renderResult.html;
	}

	public static colorizeModelLine(model: ITextModel, lineNumber: number, tabSize: number = 4): string {
		let content = model.getLineContent(lineNumber);
		model.forceTokenization(lineNumber);
		let tokens = model.getLineTokens(lineNumber);
		let inflatedTokens = tokens.inflate();
		return this.colorizeLine(content, model.mightContainNonBasicASCII(), model.mightContainRTL(), inflatedTokens, tabSize);
	}
}

function _colorize(lines: string[], tabSize: number, tokenizationSupport: ITokenizationSupport): Promise<string> {
	return new Promise<string>((c, e) => {
		const execute = () => {
			const result = _actualColorize(lines, tabSize, tokenizationSupport);
			if (tokenizationSupport instanceof MonarchTokenizer) {
				const status = tokenizationSupport.getLoadStatus();
				if (status.loaded === false) {
					status.promise.then(execute, e);
					return;
				}
			}
			c(result);
		};
		execute();
	});
}

function _fakeColorize(lines: string[], tabSize: number): string {
	let html: string[] = [];

	const defaultMetadata = (
		(FontStyle.None << MetadataConsts.FONT_STYLE_OFFSET)
		| (ColorId.DefaultForeground << MetadataConsts.FOREGROUND_OFFSET)
		| (ColorId.DefaultBackground << MetadataConsts.BACKGROUND_OFFSET)
	) >>> 0;

	const tokens = new Uint32Array(2);
	tokens[0] = 0;
	tokens[1] = defaultMetadata;

	for (let i = 0, length = lines.length; i < length; i++) {
		let line = lines[i];

		tokens[0] = line.length;
		const lineTokens = new LineTokens(tokens, line);

		const isBasicASCII = ViewLineRenderingData.isBasicASCII(line, /* check for basic ASCII */true);
		const containsRTL = ViewLineRenderingData.containsRTL(line, isBasicASCII, /* check for RTL */true);
		let renderResult = renderViewLine(new RenderLineInput(
			false,
			true,
			line,
			false,
			isBasicASCII,
			containsRTL,
			0,
			lineTokens,
			[],
			tabSize,
			0,
			0,
			0,
			0,
			-1,
			'none',
			false,
			false,
			null
		));

		html = html.concat(renderResult.html);
		html.push('<br/>');
	}

	return html.join('');
}

function _actualColorize(lines: string[], tabSize: number, tokenizationSupport: ITokenizationSupport): string {
	let html: string[] = [];
	let state = tokenizationSupport.getInitialState();

	for (let i = 0, length = lines.length; i < length; i++) {
		let line = lines[i];
		let tokenizeResult = tokenizationSupport.tokenize2(line, state, 0);
		LineTokens.convertToEndOffset(tokenizeResult.tokens, line.length);
		let lineTokens = new LineTokens(tokenizeResult.tokens, line);
		const isBasicASCII = ViewLineRenderingData.isBasicASCII(line, /* check for basic ASCII */true);
		const containsRTL = ViewLineRenderingData.containsRTL(line, isBasicASCII, /* check for RTL */true);
		let renderResult = renderViewLine(new RenderLineInput(
			false,
			true,
			line,
			false,
			isBasicASCII,
			containsRTL,
			0,
			lineTokens.inflate(),
			[],
			tabSize,
			0,
			0,
			0,
			0,
			-1,
			'none',
			false,
			false,
			null
		));

		html = html.concat(renderResult.html);
		html.push('<br/>');

		state = tokenizeResult.endState;
	}

	return html.join('');
}
