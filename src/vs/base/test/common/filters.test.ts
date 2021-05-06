/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { IFilter, or, matchesPrefix, matchesStrictPrefix, matchesCamelCase, matchesSubString, matchesContiguousSubString, matchesWords, fuzzyScore, IMatch, fuzzyScoreGraceful, fuzzyScoreGracefulAggressive, FuzzyScorer, createMatches, anyScore } from 'vs/base/common/filters';

function filterOk(filter: IFilter, word: string, wordToMatchAgainst: string, highlights?: { start: number; end: number; }[]) {
	let r = filter(word, wordToMatchAgainst);
	assert(r, `${word} didn't match ${wordToMatchAgainst}`);
	if (highlights) {
		assert.deepStrictEqual(r, highlights);
	}
}

function filterNotOk(filter: IFilter, word: string, wordToMatchAgainst: string) {
	assert(!filter(word, wordToMatchAgainst), `${word} matched ${wordToMatchAgainst}`);
}

suite('Filters', () => {
	test('or', () => {
		let filter: IFilter;
		let counters: number[];
		let newFilter = function (i: number, r: boolean): IFilter {
			return function (): IMatch[] { counters[i]++; return r as any; };
		};

		counters = [0, 0];
		filter = or(newFilter(0, false), newFilter(1, false));
		filterNotOk(filter, 'anything', 'anything');
		assert.deepStrictEqual(counters, [1, 1]);

		counters = [0, 0];
		filter = or(newFilter(0, true), newFilter(1, false));
		filterOk(filter, 'anything', 'anything');
		assert.deepStrictEqual(counters, [1, 0]);

		counters = [0, 0];
		filter = or(newFilter(0, true), newFilter(1, true));
		filterOk(filter, 'anything', 'anything');
		assert.deepStrictEqual(counters, [1, 0]);

		counters = [0, 0];
		filter = or(newFilter(0, false), newFilter(1, true));
		filterOk(filter, 'anything', 'anything');
		assert.deepStrictEqual(counters, [1, 1]);
	});

	test('PrefixFilter - case sensitive', function () {
		filterNotOk(matchesStrictPrefix, '', '');
		filterOk(matchesStrictPrefix, '', 'anything', []);
		filterOk(matchesStrictPrefix, 'alpha', 'alpha', [{ start: 0, end: 5 }]);
		filterOk(matchesStrictPrefix, 'alpha', 'alphasomething', [{ start: 0, end: 5 }]);
		filterNotOk(matchesStrictPrefix, 'alpha', 'alp');
		filterOk(matchesStrictPrefix, 'a', 'alpha', [{ start: 0, end: 1 }]);
		filterNotOk(matchesStrictPrefix, 'x', 'alpha');
		filterNotOk(matchesStrictPrefix, 'A', 'alpha');
		filterNotOk(matchesStrictPrefix, 'AlPh', 'alPHA');
	});

	test('PrefixFilter - ignore case', function () {
		filterOk(matchesPrefix, 'alpha', 'alpha', [{ start: 0, end: 5 }]);
		filterOk(matchesPrefix, 'alpha', 'alphasomething', [{ start: 0, end: 5 }]);
		filterNotOk(matchesPrefix, 'alpha', 'alp');
		filterOk(matchesPrefix, 'a', 'alpha', [{ start: 0, end: 1 }]);
		filterOk(matchesPrefix, 'ä', 'Älpha', [{ start: 0, end: 1 }]);
		filterNotOk(matchesPrefix, 'x', 'alpha');
		filterOk(matchesPrefix, 'A', 'alpha', [{ start: 0, end: 1 }]);
		filterOk(matchesPrefix, 'AlPh', 'alPHA', [{ start: 0, end: 4 }]);
		filterNotOk(matchesPrefix, 'T', '4'); // see https://github.com/microsoft/vscode/issues/22401
	});

	test('CamelCaseFilter', () => {
		filterNotOk(matchesCamelCase, '', '');
		filterOk(matchesCamelCase, '', 'anything', []);
		filterOk(matchesCamelCase, 'alpha', 'alpha', [{ start: 0, end: 5 }]);
		filterOk(matchesCamelCase, 'AlPhA', 'alpha', [{ start: 0, end: 5 }]);
		filterOk(matchesCamelCase, 'alpha', 'alphasomething', [{ start: 0, end: 5 }]);
		filterNotOk(matchesCamelCase, 'alpha', 'alp');

		filterOk(matchesCamelCase, 'c', 'CamelCaseRocks', [
			{ start: 0, end: 1 }
		]);
		filterOk(matchesCamelCase, 'cc', 'CamelCaseRocks', [
			{ start: 0, end: 1 },
			{ start: 5, end: 6 }
		]);
		filterOk(matchesCamelCase, 'ccr', 'CamelCaseRocks', [
			{ start: 0, end: 1 },
			{ start: 5, end: 6 },
			{ start: 9, end: 10 }
		]);
		filterOk(matchesCamelCase, 'cacr', 'CamelCaseRocks', [
			{ start: 0, end: 2 },
			{ start: 5, end: 6 },
			{ start: 9, end: 10 }
		]);
		filterOk(matchesCamelCase, 'cacar', 'CamelCaseRocks', [
			{ start: 0, end: 2 },
			{ start: 5, end: 7 },
			{ start: 9, end: 10 }
		]);
		filterOk(matchesCamelCase, 'ccarocks', 'CamelCaseRocks', [
			{ start: 0, end: 1 },
			{ start: 5, end: 7 },
			{ start: 9, end: 14 }
		]);
		filterOk(matchesCamelCase, 'cr', 'CamelCaseRocks', [
			{ start: 0, end: 1 },
			{ start: 9, end: 10 }
		]);
		filterOk(matchesCamelCase, 'fba', 'FooBarAbe', [
			{ start: 0, end: 1 },
			{ start: 3, end: 5 }
		]);
		filterOk(matchesCamelCase, 'fbar', 'FooBarAbe', [
			{ start: 0, end: 1 },
			{ start: 3, end: 6 }
		]);
		filterOk(matchesCamelCase, 'fbara', 'FooBarAbe', [
			{ start: 0, end: 1 },
			{ start: 3, end: 7 }
		]);
		filterOk(matchesCamelCase, 'fbaa', 'FooBarAbe', [
			{ start: 0, end: 1 },
			{ start: 3, end: 5 },
			{ start: 6, end: 7 }
		]);
		filterOk(matchesCamelCase, 'fbaab', 'FooBarAbe', [
			{ start: 0, end: 1 },
			{ start: 3, end: 5 },
			{ start: 6, end: 8 }
		]);
		filterOk(matchesCamelCase, 'c2d', 'canvasCreation2D', [
			{ start: 0, end: 1 },
			{ start: 14, end: 16 }
		]);
		filterOk(matchesCamelCase, 'cce', '_canvasCreationEvent', [
			{ start: 1, end: 2 },
			{ start: 7, end: 8 },
			{ start: 15, end: 16 }
		]);
	});

	test('CamelCaseFilter - #19256', function () {
		assert(matchesCamelCase('Debug Console', 'Open: Debug Console'));
		assert(matchesCamelCase('Debug console', 'Open: Debug Console'));
		assert(matchesCamelCase('debug console', 'Open: Debug Console'));
	});

	test('matchesContiguousSubString', () => {
		filterOk(matchesContiguousSubString, 'cela', 'cancelAnimationFrame()', [
			{ start: 3, end: 7 }
		]);
	});

	test('matchesSubString', () => {
		filterOk(matchesSubString, 'cmm', 'cancelAnimationFrame()', [
			{ start: 0, end: 1 },
			{ start: 9, end: 10 },
			{ start: 18, end: 19 }
		]);
		filterOk(matchesSubString, 'abc', 'abcabc', [
			{ start: 0, end: 3 },
		]);
		filterOk(matchesSubString, 'abc', 'aaabbbccc', [
			{ start: 0, end: 1 },
			{ start: 3, end: 4 },
			{ start: 6, end: 7 },
		]);
	});

	test('matchesSubString performance (#35346)', function () {
		filterNotOk(matchesSubString, 'aaaaaaaaaaaaaaaaaaaax', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
	});

	test('WordFilter', () => {
		filterOk(matchesWords, 'alpha', 'alpha', [{ start: 0, end: 5 }]);
		filterOk(matchesWords, 'alpha', 'alphasomething', [{ start: 0, end: 5 }]);
		filterNotOk(matchesWords, 'alpha', 'alp');
		filterOk(matchesWords, 'a', 'alpha', [{ start: 0, end: 1 }]);
		filterNotOk(matchesWords, 'x', 'alpha');
		filterOk(matchesWords, 'A', 'alpha', [{ start: 0, end: 1 }]);
		filterOk(matchesWords, 'AlPh', 'alPHA', [{ start: 0, end: 4 }]);
		assert(matchesWords('Debug Console', 'Open: Debug Console'));

		filterOk(matchesWords, 'gp', 'Git: Pull', [{ start: 0, end: 1 }, { start: 5, end: 6 }]);
		filterOk(matchesWords, 'g p', 'Git: Pull', [{ start: 0, end: 1 }, { start: 3, end: 4 }, { start: 5, end: 6 }]);
		filterOk(matchesWords, 'gipu', 'Git: Pull', [{ start: 0, end: 2 }, { start: 5, end: 7 }]);

		filterOk(matchesWords, 'gp', 'Category: Git: Pull', [{ start: 10, end: 11 }, { start: 15, end: 16 }]);
		filterOk(matchesWords, 'g p', 'Category: Git: Pull', [{ start: 10, end: 11 }, { start: 13, end: 14 }, { start: 15, end: 16 }]);
		filterOk(matchesWords, 'gipu', 'Category: Git: Pull', [{ start: 10, end: 12 }, { start: 15, end: 17 }]);

		filterNotOk(matchesWords, 'it', 'Git: Pull');
		filterNotOk(matchesWords, 'll', 'Git: Pull');

		filterOk(matchesWords, 'git: プル', 'git: プル', [{ start: 0, end: 7 }]);
		filterOk(matchesWords, 'git プル', 'git: プル', [{ start: 0, end: 4 }, { start: 5, end: 7 }]);

		filterOk(matchesWords, 'öäk', 'Öhm: Älles Klar', [{ start: 0, end: 1 }, { start: 5, end: 6 }, { start: 11, end: 12 }]);

		// assert.ok(matchesWords('gipu', 'Category: Git: Pull', true) === null);
		// assert.deepStrictEqual(matchesWords('pu', 'Category: Git: Pull', true), [{ start: 15, end: 17 }]);

		filterOk(matchesWords, 'bar', 'foo-bar');
		filterOk(matchesWords, 'bar test', 'foo-bar test');
		filterOk(matchesWords, 'fbt', 'foo-bar test');
		filterOk(matchesWords, 'bar test', 'foo-bar (test)');
		filterOk(matchesWords, 'foo bar', 'foo (bar)');

		filterNotOk(matchesWords, 'bar est', 'foo-bar test');
		filterNotOk(matchesWords, 'fo ar', 'foo-bar test');
		filterNotOk(matchesWords, 'for', 'foo-bar test');

		filterOk(matchesWords, 'foo bar', 'foo-bar');
		filterOk(matchesWords, 'foo bar', '123 foo-bar 456');
		filterOk(matchesWords, 'foo+bar', 'foo-bar');
		filterOk(matchesWords, 'foo-bar', 'foo bar');
		filterOk(matchesWords, 'foo:bar', 'foo:bar');
	});

	function assertMatches(pattern: string, word: string, decoratedWord: string | undefined, filter: FuzzyScorer, opts: { patternPos?: number, wordPos?: number, firstMatchCanBeWeak?: boolean } = {}) {
		let r = filter(pattern, pattern.toLowerCase(), opts.patternPos || 0, word, word.toLowerCase(), opts.wordPos || 0, opts.firstMatchCanBeWeak || false);
		assert.ok(!decoratedWord === !r);
		if (r) {
			let matches = createMatches(r);
			let actualWord = '';
			let pos = 0;
			for (const match of matches) {
				actualWord += word.substring(pos, match.start);
				actualWord += '^' + word.substring(match.start, match.end).split('').join('^');
				pos = match.end;
			}
			actualWord += word.substring(pos);
			assert.strictEqual(actualWord, decoratedWord);
		}
	}

	test('fuzzyScore, #23215', function () {
		assertMatches('tit', 'win.tit', 'win.^t^i^t', fuzzyScore);
		assertMatches('title', 'win.title', 'win.^t^i^t^l^e', fuzzyScore);
		assertMatches('WordCla', 'WordCharacterClassifier', '^W^o^r^dCharacter^C^l^assifier', fuzzyScore);
		assertMatches('WordCCla', 'WordCharacterClassifier', '^W^o^r^d^Character^C^l^assifier', fuzzyScore);
	});

	test('fuzzyScore, #23332', function () {
		assertMatches('dete', '"editor.quickSuggestionsDelay"', undefined, fuzzyScore);
	});

	test('fuzzyScore, #23190', function () {
		assertMatches('c:\\do', '& \'C:\\Documents and Settings\'', '& \'^C^:^\\^D^ocuments and Settings\'', fuzzyScore);
		assertMatches('c:\\do', '& \'c:\\Documents and Settings\'', '& \'^c^:^\\^D^ocuments and Settings\'', fuzzyScore);
	});

	test('fuzzyScore, #23581', function () {
		assertMatches('close', 'css.lint.importStatement', '^css.^lint.imp^ort^Stat^ement', fuzzyScore);
		assertMatches('close', 'css.colorDecorators.enable', '^css.co^l^orDecorator^s.^enable', fuzzyScore);
		assertMatches('close', 'workbench.quickOpen.closeOnFocusOut', 'workbench.quickOpen.^c^l^o^s^eOnFocusOut', fuzzyScore);
		assertTopScore(fuzzyScore, 'close', 2, 'css.lint.importStatement', 'css.colorDecorators.enable', 'workbench.quickOpen.closeOnFocusOut');
	});

	test('fuzzyScore, #23458', function () {
		assertMatches('highlight', 'editorHoverHighlight', 'editorHover^H^i^g^h^l^i^g^h^t', fuzzyScore);
		assertMatches('hhighlight', 'editorHoverHighlight', 'editor^Hover^H^i^g^h^l^i^g^h^t', fuzzyScore);
		assertMatches('dhhighlight', 'editorHoverHighlight', undefined, fuzzyScore);
	});
	test('fuzzyScore, #23746', function () {
		assertMatches('-moz', '-moz-foo', '^-^m^o^z-foo', fuzzyScore);
		assertMatches('moz', '-moz-foo', '-^m^o^z-foo', fuzzyScore);
		assertMatches('moz', '-moz-animation', '-^m^o^z-animation', fuzzyScore);
		assertMatches('moza', '-moz-animation', '-^m^o^z-^animation', fuzzyScore);
	});

	test('fuzzyScore', () => {
		assertMatches('ab', 'abA', '^a^bA', fuzzyScore);
		assertMatches('ccm', 'cacmelCase', '^ca^c^melCase', fuzzyScore);
		assertMatches('bti', 'the_black_knight', undefined, fuzzyScore);
		assertMatches('ccm', 'camelCase', undefined, fuzzyScore);
		assertMatches('cmcm', 'camelCase', undefined, fuzzyScore);
		assertMatches('BK', 'the_black_knight', 'the_^black_^knight', fuzzyScore);
		assertMatches('KeyboardLayout=', 'KeyboardLayout', undefined, fuzzyScore);
		assertMatches('LLL', 'SVisualLoggerLogsList', 'SVisual^Logger^Logs^List', fuzzyScore);
		assertMatches('LLLL', 'SVilLoLosLi', undefined, fuzzyScore);
		assertMatches('LLLL', 'SVisualLoggerLogsList', undefined, fuzzyScore);
		assertMatches('TEdit', 'TextEdit', '^Text^E^d^i^t', fuzzyScore);
		assertMatches('TEdit', 'TextEditor', '^Text^E^d^i^tor', fuzzyScore);
		assertMatches('TEdit', 'Textedit', '^Text^e^d^i^t', fuzzyScore);
		assertMatches('TEdit', 'text_edit', '^text_^e^d^i^t', fuzzyScore);
		assertMatches('TEditDit', 'TextEditorDecorationType', '^Text^E^d^i^tor^Decorat^ion^Type', fuzzyScore);
		assertMatches('TEdit', 'TextEditorDecorationType', '^Text^E^d^i^torDecorationType', fuzzyScore);
		assertMatches('Tedit', 'TextEdit', '^Text^E^d^i^t', fuzzyScore);
		assertMatches('ba', '?AB?', undefined, fuzzyScore);
		assertMatches('bkn', 'the_black_knight', 'the_^black_^k^night', fuzzyScore);
		assertMatches('bt', 'the_black_knight', 'the_^black_knigh^t', fuzzyScore);
		assertMatches('ccm', 'camelCasecm', '^camel^Casec^m', fuzzyScore);
		assertMatches('fdm', 'findModel', '^fin^d^Model', fuzzyScore);
		assertMatches('fob', 'foobar', '^f^oo^bar', fuzzyScore);
		assertMatches('fobz', 'foobar', undefined, fuzzyScore);
		assertMatches('foobar', 'foobar', '^f^o^o^b^a^r', fuzzyScore);
		assertMatches('form', 'editor.formatOnSave', 'editor.^f^o^r^matOnSave', fuzzyScore);
		assertMatches('g p', 'Git: Pull', '^Git:^ ^Pull', fuzzyScore);
		assertMatches('g p', 'Git: Pull', '^Git:^ ^Pull', fuzzyScore);
		assertMatches('gip', 'Git: Pull', '^G^it: ^Pull', fuzzyScore);
		assertMatches('gip', 'Git: Pull', '^G^it: ^Pull', fuzzyScore);
		assertMatches('gp', 'Git: Pull', '^Git: ^Pull', fuzzyScore);
		assertMatches('gp', 'Git_Git_Pull', '^Git_Git_^Pull', fuzzyScore);
		assertMatches('is', 'ImportStatement', '^Import^Statement', fuzzyScore);
		assertMatches('is', 'isValid', '^i^sValid', fuzzyScore);
		assertMatches('lowrd', 'lowWord', '^l^o^wWo^r^d', fuzzyScore);
		assertMatches('myvable', 'myvariable', '^m^y^v^aria^b^l^e', fuzzyScore);
		assertMatches('no', '', undefined, fuzzyScore);
		assertMatches('no', 'match', undefined, fuzzyScore);
		assertMatches('ob', 'foobar', undefined, fuzzyScore);
		assertMatches('sl', 'SVisualLoggerLogsList', '^SVisual^LoggerLogsList', fuzzyScore);
		assertMatches('sllll', 'SVisualLoggerLogsList', '^SVisua^l^Logger^Logs^List', fuzzyScore);
		assertMatches('Three', 'HTMLHRElement', undefined, fuzzyScore);
		assertMatches('Three', 'Three', '^T^h^r^e^e', fuzzyScore);
		assertMatches('fo', 'barfoo', undefined, fuzzyScore);
		assertMatches('fo', 'bar_foo', 'bar_^f^oo', fuzzyScore);
		assertMatches('fo', 'bar_Foo', 'bar_^F^oo', fuzzyScore);
		assertMatches('fo', 'bar foo', 'bar ^f^oo', fuzzyScore);
		assertMatches('fo', 'bar.foo', 'bar.^f^oo', fuzzyScore);
		assertMatches('fo', 'bar/foo', 'bar/^f^oo', fuzzyScore);
		assertMatches('fo', 'bar\\foo', 'bar\\^f^oo', fuzzyScore);
	});

	test('fuzzyScore (first match can be weak)', function () {

		assertMatches('Three', 'HTMLHRElement', 'H^TML^H^R^El^ement', fuzzyScore, { firstMatchCanBeWeak: true });
		assertMatches('tor', 'constructor', 'construc^t^o^r', fuzzyScore, { firstMatchCanBeWeak: true });
		assertMatches('ur', 'constructor', 'constr^ucto^r', fuzzyScore, { firstMatchCanBeWeak: true });
		assertTopScore(fuzzyScore, 'tor', 2, 'constructor', 'Thor', 'cTor');
	});

	test('fuzzyScore, many matches', function () {

		assertMatches(
			'aaaaaa',
			'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			'^a^a^a^a^a^aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
			fuzzyScore
		);
	});

	test('Freeze when fjfj -> jfjf, https://github.com/microsoft/vscode/issues/91807', function () {
		assertMatches(
			'jfjfj',
			'fjfjfjfjfjfjfjfjfjfjfj',
			undefined, fuzzyScore
		);
		assertMatches(
			'jfjfjfjfjfjfjfjfjfj',
			'fjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj',
			undefined, fuzzyScore
		);
		assertMatches(
			'jfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfjjfjfjfjfjfjfjfjfjfj',
			'fjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj',
			undefined, fuzzyScore
		);
		assertMatches(
			'jfjfjfjfjfjfjfjfjfj',
			'fJfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj',
			'f^J^f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^jfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj', // strong match
			fuzzyScore
		);
		assertMatches(
			'jfjfjfjfjfjfjfjfjfj',
			'fjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj',
			'f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^j^f^jfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfjfj', // any match
			fuzzyScore, { firstMatchCanBeWeak: true }
		);
	});

	test('fuzzyScore, issue #26423', function () {

		assertMatches('baba', 'abababab', undefined, fuzzyScore);

		assertMatches(
			'fsfsfs',
			'dsafdsafdsafdsafdsafdsafdsafasdfdsa',
			undefined,
			fuzzyScore
		);
		assertMatches(
			'fsfsfsfsfsfsfsf',
			'dsafdsafdsafdsafdsafdsafdsafasdfdsafdsafdsafdsafdsfdsafdsfdfdfasdnfdsajfndsjnafjndsajlknfdsa',
			undefined,
			fuzzyScore
		);
	});

	test('Fuzzy IntelliSense matching vs Haxe metadata completion, #26995', function () {
		assertMatches('f', ':Foo', ':^Foo', fuzzyScore);
		assertMatches('f', ':foo', ':^foo', fuzzyScore);
	});

	test('Separator only match should not be weak #79558', function () {
		assertMatches('.', 'foo.bar', 'foo^.bar', fuzzyScore);
	});

	test('Cannot set property \'1\' of undefined, #26511', function () {
		let word = new Array<void>(123).join('a');
		let pattern = new Array<void>(120).join('a');
		fuzzyScore(pattern, pattern.toLowerCase(), 0, word, word.toLowerCase(), 0, false);
		assert.ok(true); // must not explode
	});

	test('Vscode 1.12 no longer obeys \'sortText\' in completion items (from language server), #26096', function () {
		assertMatches('  ', '  group', undefined, fuzzyScore, { patternPos: 2 });
		assertMatches('  g', '  group', '  ^group', fuzzyScore, { patternPos: 2 });
		assertMatches('g', '  group', '  ^group', fuzzyScore);
		assertMatches('g g', '  groupGroup', undefined, fuzzyScore);
		assertMatches('g g', '  group Group', '  ^group^ ^Group', fuzzyScore);
		assertMatches(' g g', '  group Group', '  ^group^ ^Group', fuzzyScore, { patternPos: 1 });
		assertMatches('zz', 'zzGroup', '^z^zGroup', fuzzyScore);
		assertMatches('zzg', 'zzGroup', '^z^z^Group', fuzzyScore);
		assertMatches('g', 'zzGroup', 'zz^Group', fuzzyScore);
	});

	test('patternPos isn\'t working correctly #79815', function () {
		assertMatches(':p'.substr(1), 'prop', '^prop', fuzzyScore, { patternPos: 0 });
		assertMatches(':p', 'prop', '^prop', fuzzyScore, { patternPos: 1 });
		assertMatches(':p', 'prop', undefined, fuzzyScore, { patternPos: 2 });
		assertMatches(':p', 'proP', 'pro^P', fuzzyScore, { patternPos: 1, wordPos: 1 });
		assertMatches(':p', 'aprop', 'a^prop', fuzzyScore, { patternPos: 1, firstMatchCanBeWeak: true });
		assertMatches(':p', 'aprop', undefined, fuzzyScore, { patternPos: 1, firstMatchCanBeWeak: false });
	});

	function assertTopScore(filter: typeof fuzzyScore, pattern: string, expected: number, ...words: string[]) {
		let topScore = -(100 * 10);
		let topIdx = 0;
		for (let i = 0; i < words.length; i++) {
			const word = words[i];
			const m = filter(pattern, pattern.toLowerCase(), 0, word, word.toLowerCase(), 0, false);
			if (m) {
				const [score] = m;
				if (score > topScore) {
					topScore = score;
					topIdx = i;
				}
			}
		}
		assert.strictEqual(topIdx, expected, `${pattern} -> actual=${words[topIdx]} <> expected=${words[expected]}`);
	}

	test('topScore - fuzzyScore', function () {

		assertTopScore(fuzzyScore, 'cons', 2, 'ArrayBufferConstructor', 'Console', 'console');
		assertTopScore(fuzzyScore, 'Foo', 1, 'foo', 'Foo', 'foo');

		// #24904
		assertTopScore(fuzzyScore, 'onMess', 1, 'onmessage', 'onMessage', 'onThisMegaEscape');

		assertTopScore(fuzzyScore, 'CC', 1, 'camelCase', 'CamelCase');
		assertTopScore(fuzzyScore, 'cC', 0, 'camelCase', 'CamelCase');
		// assertTopScore(fuzzyScore, 'cC', 1, 'ccfoo', 'camelCase');
		// assertTopScore(fuzzyScore, 'cC', 1, 'ccfoo', 'camelCase', 'foo-cC-bar');

		// issue #17836
		// assertTopScore(fuzzyScore, 'TEdit', 1, 'TextEditorDecorationType', 'TextEdit', 'TextEditor');
		assertTopScore(fuzzyScore, 'p', 4, 'parse', 'posix', 'pafdsa', 'path', 'p');
		assertTopScore(fuzzyScore, 'pa', 0, 'parse', 'pafdsa', 'path');

		// issue #14583
		assertTopScore(fuzzyScore, 'log', 3, 'HTMLOptGroupElement', 'ScrollLogicalPosition', 'SVGFEMorphologyElement', 'log', 'logger');
		assertTopScore(fuzzyScore, 'e', 2, 'AbstractWorker', 'ActiveXObject', 'else');

		// issue #14446
		assertTopScore(fuzzyScore, 'workbench.sideb', 1, 'workbench.editor.defaultSideBySideLayout', 'workbench.sideBar.location');

		// issue #11423
		assertTopScore(fuzzyScore, 'editor.r', 2, 'diffEditor.renderSideBySide', 'editor.overviewRulerlanes', 'editor.renderControlCharacter', 'editor.renderWhitespace');
		// assertTopScore(fuzzyScore, 'editor.R', 1, 'diffEditor.renderSideBySide', 'editor.overviewRulerlanes', 'editor.renderControlCharacter', 'editor.renderWhitespace');
		// assertTopScore(fuzzyScore, 'Editor.r', 0, 'diffEditor.renderSideBySide', 'editor.overviewRulerlanes', 'editor.renderControlCharacter', 'editor.renderWhitespace');

		assertTopScore(fuzzyScore, '-mo', 1, '-ms-ime-mode', '-moz-columns');
		// dupe, issue #14861
		assertTopScore(fuzzyScore, 'convertModelPosition', 0, 'convertModelPositionToViewPosition', 'convertViewToModelPosition');
		// dupe, issue #14942
		assertTopScore(fuzzyScore, 'is', 0, 'isValidViewletId', 'import statement');

		assertTopScore(fuzzyScore, 'title', 1, 'files.trimTrailingWhitespace', 'window.title');

		assertTopScore(fuzzyScore, 'const', 1, 'constructor', 'const', 'cuOnstrul');
	});

	test('Unexpected suggestion scoring, #28791', function () {
		assertTopScore(fuzzyScore, '_lines', 1, '_lineStarts', '_lines');
		assertTopScore(fuzzyScore, '_lines', 1, '_lineS', '_lines');
		assertTopScore(fuzzyScore, '_lineS', 0, '_lineS', '_lines');
	});

	test('HTML closing tag proposal filtered out #38880', function () {
		assertMatches('\t\t<', '\t\t</body>', '^\t^\t^</body>', fuzzyScore, { patternPos: 0 });
		assertMatches('\t\t<', '\t\t</body>', '\t\t^</body>', fuzzyScore, { patternPos: 2 });
		assertMatches('\t<', '\t</body>', '\t^</body>', fuzzyScore, { patternPos: 1 });
	});

	test('fuzzyScoreGraceful', () => {

		assertMatches('rlut', 'result', undefined, fuzzyScore);
		assertMatches('rlut', 'result', '^res^u^l^t', fuzzyScoreGraceful);

		assertMatches('cno', 'console', '^co^ns^ole', fuzzyScore);
		assertMatches('cno', 'console', '^co^ns^ole', fuzzyScoreGraceful);
		assertMatches('cno', 'console', '^c^o^nsole', fuzzyScoreGracefulAggressive);
		assertMatches('cno', 'co_new', '^c^o_^new', fuzzyScoreGraceful);
		assertMatches('cno', 'co_new', '^c^o_^new', fuzzyScoreGracefulAggressive);
	});

	test('List highlight filter: Not all characters from match are highlighterd #66923', () => {
		assertMatches('foo', 'barbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_foo', 'barbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_^f^o^o', fuzzyScore);
	});

	test('Autocompletion is matched against truncated filterText to 54 characters #74133', () => {
		assertMatches(
			'foo',
			'ffffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_foo',
			'ffffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_^f^o^o',
			fuzzyScore
		);
		assertMatches(
			'Aoo',
			'Affffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_foo',
			'^Affffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_f^o^o',
			fuzzyScore
		);
		assertMatches(
			'foo',
			'Gffffffffffffffffffffffffffffbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbarbar_foo',
			undefined,
			fuzzyScore
		);
	});

	test('"Go to Symbol" with the exact method name doesn\'t work as expected #84787', function () {
		const match = fuzzyScore(':get', ':get', 1, 'get', 'get', 0, true);
		assert.ok(Boolean(match));
	});

	test('Wrong highlight after emoji #113404', function () {
		assertMatches('di', '✨div classname=""></div>', '✨^d^iv classname=""></div>', fuzzyScore);
		assertMatches('di', 'adiv classname=""></div>', 'adiv classname=""></^d^iv>', fuzzyScore);
	});

	test('Suggestion is not highlighted #85826', function () {
		assertMatches('SemanticTokens', 'SemanticTokensEdits', '^S^e^m^a^n^t^i^c^T^o^k^e^n^sEdits', fuzzyScore);
		assertMatches('SemanticTokens', 'SemanticTokensEdits', '^S^e^m^a^n^t^i^c^T^o^k^e^n^sEdits', fuzzyScoreGracefulAggressive);
	});

	test('IntelliSense completion not correctly highlighting text in front of cursor #115250', function () {
		assertMatches('lo', 'log', '^l^og', fuzzyScore);
		assertMatches('.lo', 'log', '^l^og', anyScore);
		assertMatches('.', 'log', 'log', anyScore);
	});
});
