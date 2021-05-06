/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getCodiconAriaLabel } from 'vs/base/common/codicons';

suite('Codicon', () => {
	test('Can get proper aria labels', () => {
		// note, the spaces in the results are important
		const testCases = new Map<string, string>([
			['', ''],
			['asdf', 'asdf'],
			['asdf$(squirrel)asdf', 'asdf squirrel asdf'],
			['asdf $(squirrel) asdf', 'asdf  squirrel  asdf'],
			['$(rocket)asdf', 'rocket asdf'],
			['$(rocket) asdf', 'rocket  asdf'],
			['$(rocket)$(rocket)$(rocket)asdf', 'rocket  rocket  rocket asdf'],
			['$(rocket) asdf $(rocket)', 'rocket  asdf  rocket'],
			['$(rocket)asdf$(rocket)', 'rocket asdf rocket'],
		]);

		for (const [input, expected] of testCases) {
			assert.strictEqual(getCodiconAriaLabel(input), expected);
		}
	});
});
