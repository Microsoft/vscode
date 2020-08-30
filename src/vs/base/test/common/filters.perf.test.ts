/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as filters from 'vs/base/common/filters';
import { data } from './filters.perf.data';

const patterns = ['cci', 'ida', 'pos', 'CCI', 'enbled', 'callback', 'gGame', 'cons', 'zyx', 'aBc'];

const _enablePerf = false;

function perfSuite(name: string, callback: (this: Mocha.ISuiteCallbackContext) => void) {
	if (_enablePerf) {
		suite(name, callback);
	}
}

perfSuite('Performance - fuzzyMatch', function () {

	console.log(`Matching ${data.length} items against ${patterns.length} patterns (${data.length * patterns.length} operations) `);

	function perfTest(name: string, match: filters.FuzzyScorer) {
		test(name, () => {

			const t1 = Date.now();
			let count = 0;
			for (let i = 0; i < 2; i++) {
				for (const pattern of patterns) {
					const patternLow = pattern.toLowerCase();
					for (const item of data) {
						count += 1;
						match(pattern, patternLow, 0, item, item.toLowerCase(), 0, false);
					}
				}
			}
			const d = Date.now() - t1;
			console.log(name, `${d}ms, ${Math.round(count / d) * 15}/15ms, ${Math.round(count / d)}/1ms`);
		});
	}

	perfTest('fuzzyScore', filters.fuzzyScore);
	perfTest('fuzzyScoreGraceful', filters.fuzzyScoreGraceful);
	perfTest('fuzzyScoreGracefulAggressive', filters.fuzzyScoreGracefulAggressive);
});


perfSuite('Performance - IFilter', function () {

	function perfTest(name: string, match: filters.IFilter) {
		test(name, () => {

			const t1 = Date.now();
			let count = 0;
			for (let i = 0; i < 2; i++) {
				for (const pattern of patterns) {
					for (const item of data) {
						count += 1;
						match(pattern, item);
					}
				}
			}
			const d = Date.now() - t1;
			console.log(name, `${d}ms, ${Math.round(count / d) * 15}/15ms, ${Math.round(count / d)}/1ms`);
		});
	}

	perfTest('matchesFuzzy', filters.matchesFuzzy);
	perfTest('matchesFuzzy2', filters.matchesFuzzy2);
	perfTest('matchesPrefix', filters.matchesPrefix);
	perfTest('matchesContiguousSubString', filters.matchesContiguousSubString);
	perfTest('matchesCamelCase', filters.matchesCamelCase);
});
