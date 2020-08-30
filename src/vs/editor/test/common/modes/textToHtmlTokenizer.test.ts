/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TokenizationResult2 } from 'vs/editor/common/core/token';
import { ColorId, FontStyle, IState, LanguageIdentifier, MetadataConsts, TokenizationRegistry } from 'vs/editor/common/modes';
import { tokenizeLineToHTML, tokenizeToString } from 'vs/editor/common/modes/textToHtmlTokenizer';
import { ViewLineToken, ViewLineTokens } from 'vs/editor/test/common/core/viewLineToken';
import { MockMode } from 'vs/editor/test/common/mocks/mockMode';

suite('Editor Modes - textToHtmlTokenizer', () => {
	function toStr(pieces: { className: string; text: string }[]): string {
		let resultArr = pieces.map((t) => `<span class="${t.className}">${t.text}</span>`);
		return resultArr.join('');
	}

	test('TextToHtmlTokenizer 1', () => {
		let mode = new Mode();
		let support = TokenizationRegistry.get(mode.getId())!;

		let actual = tokenizeToString('.abc..def...gh', support);
		let expected = [
			{ className: 'mtk7', text: '.' },
			{ className: 'mtk9', text: 'abc' },
			{ className: 'mtk7', text: '..' },
			{ className: 'mtk9', text: 'def' },
			{ className: 'mtk7', text: '...' },
			{ className: 'mtk9', text: 'gh' },
		];
		let expectedStr = `<div class="monaco-tokenized-source">${toStr(expected)}</div>`;

		assert.equal(actual, expectedStr);

		mode.dispose();
	});

	test('TextToHtmlTokenizer 2', () => {
		let mode = new Mode();
		let support = TokenizationRegistry.get(mode.getId())!;

		let actual = tokenizeToString('.abc..def...gh\n.abc..def...gh', support);
		let expected1 = [
			{ className: 'mtk7', text: '.' },
			{ className: 'mtk9', text: 'abc' },
			{ className: 'mtk7', text: '..' },
			{ className: 'mtk9', text: 'def' },
			{ className: 'mtk7', text: '...' },
			{ className: 'mtk9', text: 'gh' },
		];
		let expected2 = [
			{ className: 'mtk7', text: '.' },
			{ className: 'mtk9', text: 'abc' },
			{ className: 'mtk7', text: '..' },
			{ className: 'mtk9', text: 'def' },
			{ className: 'mtk7', text: '...' },
			{ className: 'mtk9', text: 'gh' },
		];
		let expectedStr1 = toStr(expected1);
		let expectedStr2 = toStr(expected2);
		let expectedStr = `<div class="monaco-tokenized-source">${expectedStr1}<br/>${expectedStr2}</div>`;

		assert.equal(actual, expectedStr);

		mode.dispose();
	});

	test('tokenizeLineToHTML', () => {
		const text = 'Ciao hello world!';
		const lineTokens = new ViewLineTokens([
			new ViewLineToken(
				4,
				(
					(3 << MetadataConsts.FOREGROUND_OFFSET)
					| ((FontStyle.Bold | FontStyle.Italic) << MetadataConsts.FONT_STYLE_OFFSET)
				) >>> 0
			),
			new ViewLineToken(
				5,
				(
					(1 << MetadataConsts.FOREGROUND_OFFSET)
				) >>> 0
			),
			new ViewLineToken(
				10,
				(
					(4 << MetadataConsts.FOREGROUND_OFFSET)
				) >>> 0
			),
			new ViewLineToken(
				11,
				(
					(1 << MetadataConsts.FOREGROUND_OFFSET)
				) >>> 0
			),
			new ViewLineToken(
				17,
				(
					(5 << MetadataConsts.FOREGROUND_OFFSET)
					| ((FontStyle.Underline) << MetadataConsts.FONT_STYLE_OFFSET)
				) >>> 0
			)
		]);
		const colorMap = [null!, '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'];

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 0, 17, 4, true),
			[
				'<div>',
				'<span style="color: #ff0000;font-style: italic;font-weight: bold;">Ciao</span>',
				'<span style="color: #000000;">&#160;</span>',
				'<span style="color: #00ff00;">hello</span>',
				'<span style="color: #000000;">&#160;</span>',
				'<span style="color: #0000ff;text-decoration: underline;">world!</span>',
				'</div>'
			].join('')
		);

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 0, 12, 4, true),
			[
				'<div>',
				'<span style="color: #ff0000;font-style: italic;font-weight: bold;">Ciao</span>',
				'<span style="color: #000000;">&#160;</span>',
				'<span style="color: #00ff00;">hello</span>',
				'<span style="color: #000000;">&#160;</span>',
				'<span style="color: #0000ff;text-decoration: underline;">w</span>',
				'</div>'
			].join('')
		);

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 0, 11, 4, true),
			[
				'<div>',
				'<span style="color: #ff0000;font-style: italic;font-weight: bold;">Ciao</span>',
				'<span style="color: #000000;">&#160;</span>',
				'<span style="color: #00ff00;">hello</span>',
				'<span style="color: #000000;">&#160;</span>',
				'</div>'
			].join('')
		);

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 1, 11, 4, true),
			[
				'<div>',
				'<span style="color: #ff0000;font-style: italic;font-weight: bold;">iao</span>',
				'<span style="color: #000000;">&#160;</span>',
				'<span style="color: #00ff00;">hello</span>',
				'<span style="color: #000000;">&#160;</span>',
				'</div>'
			].join('')
		);

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 4, 11, 4, true),
			[
				'<div>',
				'<span style="color: #000000;">&#160;</span>',
				'<span style="color: #00ff00;">hello</span>',
				'<span style="color: #000000;">&#160;</span>',
				'</div>'
			].join('')
		);

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 5, 11, 4, true),
			[
				'<div>',
				'<span style="color: #00ff00;">hello</span>',
				'<span style="color: #000000;">&#160;</span>',
				'</div>'
			].join('')
		);

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 5, 10, 4, true),
			[
				'<div>',
				'<span style="color: #00ff00;">hello</span>',
				'</div>'
			].join('')
		);

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 6, 9, 4, true),
			[
				'<div>',
				'<span style="color: #00ff00;">ell</span>',
				'</div>'
			].join('')
		);
	});
	test('tokenizeLineToHTML handle spaces #35954', () => {
		const text = '  Ciao   hello world!';
		const lineTokens = new ViewLineTokens([
			new ViewLineToken(
				2,
				(
					(1 << MetadataConsts.FOREGROUND_OFFSET)
				) >>> 0
			),
			new ViewLineToken(
				6,
				(
					(3 << MetadataConsts.FOREGROUND_OFFSET)
					| ((FontStyle.Bold | FontStyle.Italic) << MetadataConsts.FONT_STYLE_OFFSET)
				) >>> 0
			),
			new ViewLineToken(
				9,
				(
					(1 << MetadataConsts.FOREGROUND_OFFSET)
				) >>> 0
			),
			new ViewLineToken(
				14,
				(
					(4 << MetadataConsts.FOREGROUND_OFFSET)
				) >>> 0
			),
			new ViewLineToken(
				15,
				(
					(1 << MetadataConsts.FOREGROUND_OFFSET)
				) >>> 0
			),
			new ViewLineToken(
				21,
				(
					(5 << MetadataConsts.FOREGROUND_OFFSET)
					| ((FontStyle.Underline) << MetadataConsts.FONT_STYLE_OFFSET)
				) >>> 0
			)
		]);
		const colorMap = [null!, '#000000', '#ffffff', '#ff0000', '#00ff00', '#0000ff'];

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 0, 21, 4, true),
			[
				'<div>',
				'<span style="color: #000000;">&#160;&#160;</span>',
				'<span style="color: #ff0000;font-style: italic;font-weight: bold;">Ciao</span>',
				'<span style="color: #000000;">&#160;&#160;&#160;</span>',
				'<span style="color: #00ff00;">hello</span>',
				'<span style="color: #000000;">&#160;</span>',
				'<span style="color: #0000ff;text-decoration: underline;">world!</span>',
				'</div>'
			].join('')
		);

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 0, 17, 4, true),
			[
				'<div>',
				'<span style="color: #000000;">&#160;&#160;</span>',
				'<span style="color: #ff0000;font-style: italic;font-weight: bold;">Ciao</span>',
				'<span style="color: #000000;">&#160;&#160;&#160;</span>',
				'<span style="color: #00ff00;">hello</span>',
				'<span style="color: #000000;">&#160;</span>',
				'<span style="color: #0000ff;text-decoration: underline;">wo</span>',
				'</div>'
			].join('')
		);

		assert.equal(
			tokenizeLineToHTML(text, lineTokens, colorMap, 0, 3, 4, true),
			[
				'<div>',
				'<span style="color: #000000;">&#160;&#160;</span>',
				'<span style="color: #ff0000;font-style: italic;font-weight: bold;">C</span>',
				'</div>'
			].join('')
		);
	});

});

class Mode extends MockMode {

	private static readonly _id = new LanguageIdentifier('textToHtmlTokenizerMode', 3);

	constructor() {
		super(Mode._id);
		this._register(TokenizationRegistry.register(this.getId(), {
			getInitialState: (): IState => null!,
			tokenize: undefined!,
			tokenize2: (line: string, state: IState): TokenizationResult2 => {
				let tokensArr: number[] = [];
				let prevColor: ColorId = -1;
				for (let i = 0; i < line.length; i++) {
					let colorId = line.charAt(i) === '.' ? 7 : 9;
					if (prevColor !== colorId) {
						tokensArr.push(i);
						tokensArr.push((
							colorId << MetadataConsts.FOREGROUND_OFFSET
						) >>> 0);
					}
					prevColor = colorId;
				}

				let tokens = new Uint32Array(tokensArr.length);
				for (let i = 0; i < tokens.length; i++) {
					tokens[i] = tokensArr[i];
				}
				return new TokenizationResult2(tokens, null!);
			}
		}));
	}
}
