/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ModeServiceImpl } from 'vs/editor/common/services/modeServiceImpl';
import { IModeService } from 'vs/editor/common/services/modeService';
import { MonarchTokenizer } from 'vs/editor/standalone/common/monarch/monarchLexer';
import { compile } from 'vs/editor/standalone/common/monarch/monarchCompile';
import { Token } from 'vs/editor/common/core/token';
import { TokenizationRegistry } from 'vs/editor/common/modes';
import { IMonarchLanguage } from 'vs/editor/standalone/common/monarch/monarchTypes';
import { ModesRegistry } from 'vs/editor/common/modes/modesRegistry';

suite('Monarch', () => {

	function createMonarchTokenizer(modeService: IModeService, languageId: string, language: IMonarchLanguage): MonarchTokenizer {
		return new MonarchTokenizer(modeService, null!, languageId, compile(languageId, language));
	}

	test('Ensure @rematch and nextEmbedded can be used together in Monarch grammar', () => {
		const modeService = new ModeServiceImpl();
		const innerModeRegistration = ModesRegistry.registerLanguage({
			id: 'sql'
		});
		const innerModeTokenizationRegistration = TokenizationRegistry.register('sql', createMonarchTokenizer(modeService, 'sql', {
			tokenizer: {
				root: [
					[/./, 'token']
				]
			}
		}));
		const SQL_QUERY_START = '(SELECT|INSERT|UPDATE|DELETE|CREATE|REPLACE|ALTER|WITH)';
		const tokenizer = createMonarchTokenizer(modeService, 'test1', {
			tokenizer: {
				root: [
					[`(\"\"\")${SQL_QUERY_START}`, [{ 'token': 'string.quote', }, { token: '@rematch', next: '@endStringWithSQL', nextEmbedded: 'sql', },]],
					[/(""")$/, [{ token: 'string.quote', next: '@maybeStringIsSQL', },]],
				],
				maybeStringIsSQL: [
					[/(.*)/, {
						cases: {
							[`${SQL_QUERY_START}\\b.*`]: { token: '@rematch', next: '@endStringWithSQL', nextEmbedded: 'sql', },
							'@default': { token: '@rematch', switchTo: '@endDblDocString', },
						}
					}],
				],
				endDblDocString: [
					['[^\']+', 'string'],
					['\\\\\'', 'string'],
					['\'\'\'', 'string', '@popall'],
					['\'', 'string']
				],
				endStringWithSQL: [[/"""/, { token: 'string.quote', next: '@popall', nextEmbedded: '@pop', },]],
			}
		});

		const lines = [
			`mysql_query("""SELECT * FROM table_name WHERE ds = '<DATEID>'""")`,
			`mysql_query("""`,
			`SELECT *`,
			`FROM table_name`,
			`WHERE ds = '<DATEID>'`,
			`""")`,
		];

		const actualTokens: Token[][] = [];
		let state = tokenizer.getInitialState();
		for (const line of lines) {
			const result = tokenizer.tokenize(line, state, 0);
			actualTokens.push(result.tokens);
			state = result.endState;
		}

		assert.deepEqual(actualTokens, [
			[
				{ 'offset': 0, 'type': 'source.test1', 'language': 'test1' },
				{ 'offset': 12, 'type': 'string.quote.test1', 'language': 'test1' },
				{ 'offset': 15, 'type': 'token.sql', 'language': 'sql' },
				{ 'offset': 61, 'type': 'string.quote.test1', 'language': 'test1' },
				{ 'offset': 64, 'type': 'source.test1', 'language': 'test1' }
			],
			[
				{ 'offset': 0, 'type': 'source.test1', 'language': 'test1' },
				{ 'offset': 12, 'type': 'string.quote.test1', 'language': 'test1' }
			],
			[
				{ 'offset': 0, 'type': 'token.sql', 'language': 'sql' }
			],
			[
				{ 'offset': 0, 'type': 'token.sql', 'language': 'sql' }
			],
			[
				{ 'offset': 0, 'type': 'token.sql', 'language': 'sql' }
			],
			[
				{ 'offset': 0, 'type': 'string.quote.test1', 'language': 'test1' },
				{ 'offset': 3, 'type': 'source.test1', 'language': 'test1' }
			]
		]);
		innerModeTokenizationRegistration.dispose();
		innerModeRegistration.dispose();
	});

});
