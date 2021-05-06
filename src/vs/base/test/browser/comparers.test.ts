/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareFileNames, compareFileExtensions, compareFileNamesDefault, compareFileExtensionsDefault } from 'vs/base/common/comparers';
import * as assert from 'assert';

const compareLocale = (a: string, b: string) => a.localeCompare(b);
const compareLocaleNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });


suite('Comparers', () => {

	test('compareFileNames', () => {

		//
		// Comparisons with the same results as compareFileNamesDefault
		//

		// name-only comparisons
		assert(compareFileNames(null, null) === 0, 'null should be equal');
		assert(compareFileNames(null, 'abc') < 0, 'null should be come before real values');
		assert(compareFileNames('', '') === 0, 'empty should be equal');
		assert(compareFileNames('abc', 'abc') === 0, 'equal names should be equal');
		assert(compareFileNames('z', 'A') > 0, 'z comes is after A regardless of case');
		assert(compareFileNames('Z', 'a') > 0, 'Z comes after a regardless of case');

		// name plus extension comparisons
		assert(compareFileNames('bbb.aaa', 'aaa.bbb') > 0, 'files with extensions are compared first by filename');
		assert(compareFileNames('aggregate.go', 'aggregate_repo.go') > 0, 'compares the whole name all at once by locale');

		// dotfile comparisons
		assert(compareFileNames('.abc', '.abc') === 0, 'equal dotfile names should be equal');
		assert(compareFileNames('.env.', '.gitattributes') < 0, 'filenames starting with dots and with extensions should still sort properly');
		assert(compareFileNames('.env', '.aaa.env') > 0, 'dotfiles sort alphabetically when they contain multiple dots');
		assert(compareFileNames('.env', '.env.aaa') < 0, 'dotfiles with the same root sort shortest first');
		assert(compareFileNames('.aaa_env', '.aaa.env') < 0, 'and underscore in a dotfile name will sort before a dot');

		// dotfile vs non-dotfile comparisons
		assert(compareFileNames(null, '.abc') < 0, 'null should come before dotfiles');
		assert(compareFileNames('.env', 'aaa') < 0, 'dotfiles come before filenames without extensions');
		assert(compareFileNames('.env', 'aaa.env') < 0, 'dotfiles come before filenames with extensions');
		assert(compareFileNames('.md', 'A.MD') < 0, 'dotfiles sort before uppercase files');
		assert(compareFileNames('.MD', 'a.md') < 0, 'dotfiles sort before lowercase files');

		// numeric comparisons
		assert(compareFileNames('1', '1') === 0, 'numerically equal full names should be equal');
		assert(compareFileNames('abc1.txt', 'abc1.txt') === 0, 'equal filenames with numbers should be equal');
		assert(compareFileNames('abc1.txt', 'abc2.txt') < 0, 'filenames with numbers should be in numerical order, not alphabetical order');
		assert(compareFileNames('abc2.txt', 'abc10.txt') < 0, 'filenames with numbers should be in numerical order even when they are multiple digits long');
		assert(compareFileNames('abc02.txt', 'abc010.txt') < 0, 'filenames with numbers that have leading zeros sort numerically');
		assert(compareFileNames('abc1.10.txt', 'abc1.2.txt') > 0, 'numbers with dots between them are treated as two separate numbers, not one decimal number');

		//
		// Comparisons with different results than compareFileNamesDefault
		//

		// name-only comparisons
		assert(compareFileNames('a', 'A') !== compareLocale('a', 'A'), 'the same letter does not sort by locale');
		assert(compareFileNames('â', 'Â') !== compareLocale('â', 'Â'), 'the same accented letter does not sort by locale');
		assert.notDeepStrictEqual(['artichoke', 'Artichoke', 'art', 'Art'].sort(compareFileNames), ['artichoke', 'Artichoke', 'art', 'Art'].sort(compareLocale), 'words with the same root and different cases do not sort in locale order');
		assert.notDeepStrictEqual(['email', 'Email', 'émail', 'Émail'].sort(compareFileNames), ['email', 'Email', 'émail', 'Émail'].sort(compareLocale), 'the same base characters with different case or accents do not sort in locale order');

		// numeric comparisons
		assert(compareFileNames('abc02.txt', 'abc002.txt') > 0, 'filenames with equivalent numbers and leading zeros sort in unicode order');
		assert(compareFileNames('abc.txt1', 'abc.txt01') > 0, 'same name plus extensions with equal numbers sort in unicode order');
		assert(compareFileNames('art01', 'Art01') !== 'art01'.localeCompare('Art01', undefined, { numeric: true }),
			'a numerically equivalent word of a different case does not compare numerically based on locale');

	});

	test('compareFileExtensions', () => {

		//
		// Comparisons with the same results as compareFileExtensionsDefault
		//

		// name-only comparisons
		assert(compareFileExtensions(null, null) === 0, 'null should be equal');
		assert(compareFileExtensions(null, 'abc') < 0, 'null should come before real files without extension');
		assert(compareFileExtensions('', '') === 0, 'empty should be equal');
		assert(compareFileExtensions('abc', 'abc') === 0, 'equal names should be equal');
		assert(compareFileExtensions('z', 'A') > 0, 'z comes after A');
		assert(compareFileExtensions('Z', 'a') > 0, 'Z comes after a');

		// name plus extension comparisons
		assert(compareFileExtensions('file.ext', 'file.ext') === 0, 'equal full names should be equal');
		assert(compareFileExtensions('a.ext', 'b.ext') < 0, 'if equal extensions, filenames should be compared');
		assert(compareFileExtensions('file.aaa', 'file.bbb') < 0, 'files with equal names should be compared by extensions');
		assert(compareFileExtensions('bbb.aaa', 'aaa.bbb') < 0, 'files should be compared by extensions even if filenames compare differently');
		assert(compareFileExtensions('agg.go', 'aggrepo.go') < 0, 'shorter names sort before longer names');
		assert(compareFileExtensions('agg.go', 'agg_repo.go') < 0, 'shorter names short before longer names even when the longer name contains an underscore');
		assert(compareFileExtensions('a.MD', 'b.md') < 0, 'when extensions are the same except for case, the files sort by name');

		// dotfile comparisons
		assert(compareFileExtensions('.abc', '.abc') === 0, 'equal dotfiles should be equal');
		assert(compareFileExtensions('.md', '.Gitattributes') > 0, 'dotfiles sort alphabetically regardless of case');

		// dotfile vs non-dotfile comparisons
		assert(compareFileExtensions(null, '.abc') < 0, 'null should come before dotfiles');
		assert(compareFileExtensions('.env', 'aaa.env') < 0, 'if equal extensions, filenames should be compared, empty filename should come before others');
		assert(compareFileExtensions('.MD', 'a.md') < 0, 'if extensions differ in case, files sort by extension in unicode order');

		// numeric comparisons
		assert(compareFileExtensions('1', '1') === 0, 'numerically equal full names should be equal');
		assert(compareFileExtensions('abc1.txt', 'abc1.txt') === 0, 'equal filenames with numbers should be equal');
		assert(compareFileExtensions('abc1.txt', 'abc2.txt') < 0, 'filenames with numbers should be in numerical order, not alphabetical order');
		assert(compareFileExtensions('abc2.txt', 'abc10.txt') < 0, 'filenames with numbers should be in numerical order even when they are multiple digits long');
		assert(compareFileExtensions('abc02.txt', 'abc010.txt') < 0, 'filenames with numbers that have leading zeros sort numerically');
		assert(compareFileExtensions('abc1.10.txt', 'abc1.2.txt') > 0, 'numbers with dots between them are treated as two separate numbers, not one decimal number');
		assert(compareFileExtensions('abc2.txt2', 'abc1.txt10') < 0, 'extensions with numbers should be in numerical order, not alphabetical order');
		assert(compareFileExtensions('txt.abc1', 'txt.abc1') === 0, 'equal extensions with numbers should be equal');
		assert(compareFileExtensions('txt.abc1', 'txt.abc2') < 0, 'extensions with numbers should be in numerical order, not alphabetical order');
		assert(compareFileExtensions('txt.abc2', 'txt.abc10') < 0, 'extensions with numbers should be in numerical order even when they are multiple digits long');
		assert(compareFileExtensions('a.ext1', 'b.ext1') < 0, 'if equal extensions with numbers, filenames should be compared');
		assert(compareFileExtensions('a10.txt', 'A2.txt') > 0, 'filenames with number and case differences compare numerically');

		//
		// Comparisons with different results from compareFileExtensionsDefault
		//

		// name-only comparisions
		assert(compareFileExtensions('a', 'A') !== compareLocale('a', 'A'), 'the same letter of different case does not sort by locale');
		assert(compareFileExtensions('â', 'Â') !== compareLocale('â', 'Â'), 'the same accented letter of different case does not sort by locale');
		assert.notDeepStrictEqual(['artichoke', 'Artichoke', 'art', 'Art'].sort(compareFileExtensions), ['artichoke', 'Artichoke', 'art', 'Art'].sort(compareLocale), 'words with the same root and different cases do not sort in locale order');
		assert.notDeepStrictEqual(['email', 'Email', 'émail', 'Émail'].sort(compareFileExtensions), ['email', 'Email', 'émail', 'Émail'].sort((a, b) => a.localeCompare(b)), 'the same base characters with different case or accents do not sort in locale order');

		// name plus extension comparisons
		assert(compareFileExtensions('a.MD', 'a.md') !== compareLocale('MD', 'md'), 'case differences in extensions do not sort by locale');
		assert(compareFileExtensions('a.md', 'A.md') !== compareLocale('a', 'A'), 'case differences in names do not sort by locale');
		assert(compareFileExtensions('aggregate.go', 'aggregate_repo.go') < 0, 'when extensions are equal, names sort in dictionary order');

		// dotfile comparisons
		assert(compareFileExtensions('.env', '.aaa.env') < 0, 'a dotfile with an extension is treated as a name plus an extension - equal extensions');
		assert(compareFileExtensions('.env', '.env.aaa') > 0, 'a dotfile with an extension is treated as a name plus an extension - unequal extensions');

		// dotfile vs non-dotfile comparisons
		assert(compareFileExtensions('.env', 'aaa') > 0, 'filenames without extensions come before dotfiles');
		assert(compareFileExtensions('.md', 'A.MD') > 0, 'a file with an uppercase extension sorts before a dotfile of the same lowercase extension');

		// numeric comparisons
		assert(compareFileExtensions('abc.txt01', 'abc.txt1') < 0, 'extensions with equal numbers sort in unicode order');
		assert(compareFileExtensions('art01', 'Art01') !== compareLocaleNumeric('art01', 'Art01'), 'a numerically equivalent word of a different case does not compare by locale');
		assert(compareFileExtensions('abc02.txt', 'abc002.txt') > 0, 'filenames with equivalent numbers and leading zeros sort in unicode order');
		assert(compareFileExtensions('txt.abc01', 'txt.abc1') < 0, 'extensions with equivalent numbers sort in unicode order');

	});

	test('compareFileNamesDefault', () => {

		//
		// Comparisons with the same results as compareFileNames
		//

		// name-only comparisons
		assert(compareFileNamesDefault(null, null) === 0, 'null should be equal');
		assert(compareFileNamesDefault(null, 'abc') < 0, 'null should be come before real values');
		assert(compareFileNamesDefault('', '') === 0, 'empty should be equal');
		assert(compareFileNamesDefault('abc', 'abc') === 0, 'equal names should be equal');
		assert(compareFileNamesDefault('z', 'A') > 0, 'z comes is after A regardless of case');
		assert(compareFileNamesDefault('Z', 'a') > 0, 'Z comes after a regardless of case');

		// name plus extension comparisons
		assert(compareFileNamesDefault('file.ext', 'file.ext') === 0, 'equal full names should be equal');
		assert(compareFileNamesDefault('a.ext', 'b.ext') < 0, 'if equal extensions, filenames should be compared');
		assert(compareFileNamesDefault('file.aaa', 'file.bbb') < 0, 'files with equal names should be compared by extensions');
		assert(compareFileNamesDefault('bbb.aaa', 'aaa.bbb') > 0, 'files should be compared by names even if extensions compare differently');
		assert(compareFileNamesDefault('aggregate.go', 'aggregate_repo.go') > 0, 'compares the whole filename in locale order');

		// dotfile comparisons
		assert(compareFileNamesDefault('.abc', '.abc') === 0, 'equal dotfile names should be equal');
		assert(compareFileNamesDefault('.env.', '.gitattributes') < 0, 'filenames starting with dots and with extensions should still sort properly');
		assert(compareFileNamesDefault('.env', '.aaa.env') > 0, 'dotfiles sort alphabetically when they contain multiple dots');
		assert(compareFileNamesDefault('.env', '.env.aaa') < 0, 'dotfiles with the same root sort shortest first');
		assert(compareFileNamesDefault('.aaa_env', '.aaa.env') < 0, 'and underscore in a dotfile name will sort before a dot');

		// dotfile vs non-dotfile comparisons
		assert(compareFileNamesDefault(null, '.abc') < 0, 'null should come before dotfiles');
		assert(compareFileNamesDefault('.env', 'aaa') < 0, 'dotfiles come before filenames without extensions');
		assert(compareFileNamesDefault('.env', 'aaa.env') < 0, 'dotfiles come before filenames with extensions');
		assert(compareFileNamesDefault('.md', 'A.MD') < 0, 'dotfiles sort before uppercase files');
		assert(compareFileNamesDefault('.MD', 'a.md') < 0, 'dotfiles sort before lowercase files');

		// numeric comparisons
		assert(compareFileNamesDefault('1', '1') === 0, 'numerically equal full names should be equal');
		assert(compareFileNamesDefault('abc1.txt', 'abc1.txt') === 0, 'equal filenames with numbers should be equal');
		assert(compareFileNamesDefault('abc1.txt', 'abc2.txt') < 0, 'filenames with numbers should be in numerical order, not alphabetical order');
		assert(compareFileNamesDefault('abc2.txt', 'abc10.txt') < 0, 'filenames with numbers should be in numerical order even when they are multiple digits long');
		assert(compareFileNamesDefault('abc02.txt', 'abc010.txt') < 0, 'filenames with numbers that have leading zeros sort numerically');
		assert(compareFileNamesDefault('abc1.10.txt', 'abc1.2.txt') > 0, 'numbers with dots between them are treated as two separate numbers, not one decimal number');

		//
		// Comparisons with different results than compareFileNames
		//

		// name-only comparisons
		assert(compareFileNamesDefault('a', 'A') === compareLocale('a', 'A'), 'the same letter sorts by locale');
		assert(compareFileNamesDefault('â', 'Â') === compareLocale('â', 'Â'), 'the same accented letter sorts by locale');
		assert.deepStrictEqual(['email', 'Email', 'émail', 'Émail'].sort(compareFileNamesDefault), ['email', 'Email', 'émail', 'Émail'].sort(compareLocale), 'the same base characters with different case or accents sort in locale order');

		// numeric comparisons
		assert(compareFileNamesDefault('abc02.txt', 'abc002.txt') < 0, 'filenames with equivalent numbers and leading zeros sort shortest number first');
		assert(compareFileNamesDefault('abc.txt1', 'abc.txt01') < 0, 'same name plus extensions with equal numbers sort shortest number first');
		assert(compareFileNamesDefault('art01', 'Art01') === compareLocaleNumeric('art01', 'Art01'), 'a numerically equivalent word of a different case compares numerically based on locale');

	});

	test('compareFileExtensionsDefault', () => {

		//
		// Comparisons with the same result as compareFileExtensions
		//

		// name-only comparisons
		assert(compareFileExtensionsDefault(null, null) === 0, 'null should be equal');
		assert(compareFileExtensionsDefault(null, 'abc') < 0, 'null should come before real files without extensions');
		assert(compareFileExtensionsDefault('', '') === 0, 'empty should be equal');
		assert(compareFileExtensionsDefault('abc', 'abc') === 0, 'equal names should be equal');
		assert(compareFileExtensionsDefault('z', 'A') > 0, 'z comes after A');
		assert(compareFileExtensionsDefault('Z', 'a') > 0, 'Z comes after a');

		// name plus extension comparisons
		assert(compareFileExtensionsDefault('file.ext', 'file.ext') === 0, 'equal full filenames should be equal');
		assert(compareFileExtensionsDefault('a.ext', 'b.ext') < 0, 'if equal extensions, filenames should be compared');
		assert(compareFileExtensionsDefault('file.aaa', 'file.bbb') < 0, 'files with equal names should be compared by extensions');
		assert(compareFileExtensionsDefault('bbb.aaa', 'aaa.bbb') < 0, 'files should be compared by extension first');
		assert(compareFileExtensionsDefault('agg.go', 'aggrepo.go') < 0, 'shorter names sort before longer names');
		assert(compareFileExtensionsDefault('a.MD', 'b.md') < 0, 'when extensions are the same except for case, the files sort by name');

		// dotfile comparisons
		assert(compareFileExtensionsDefault('.abc', '.abc') === 0, 'equal dotfiles should be equal');
		assert(compareFileExtensionsDefault('.md', '.Gitattributes') > 0, 'dotfiles sort alphabetically regardless of case');

		// dotfile vs non-dotfile comparisons
		assert(compareFileExtensionsDefault(null, '.abc') < 0, 'null should come before dotfiles');
		assert(compareFileExtensionsDefault('.env', 'aaa.env') < 0, 'dotfiles come before filenames with extensions');
		assert(compareFileExtensionsDefault('.MD', 'a.md') < 0, 'dotfiles sort before lowercase files');

		// numeric comparisons
		assert(compareFileExtensionsDefault('1', '1') === 0, 'numerically equal full names should be equal');
		assert(compareFileExtensionsDefault('abc1.txt', 'abc1.txt') === 0, 'equal filenames with numbers should be equal');
		assert(compareFileExtensionsDefault('abc1.txt', 'abc2.txt') < 0, 'filenames with numbers should be in numerical order, not alphabetical order');
		assert(compareFileExtensionsDefault('abc2.txt', 'abc10.txt') < 0, 'filenames with numbers should be in numerical order');
		assert(compareFileExtensionsDefault('abc02.txt', 'abc010.txt') < 0, 'filenames with numbers that have leading zeros sort numerically');
		assert(compareFileExtensionsDefault('abc1.10.txt', 'abc1.2.txt') > 0, 'numbers with dots between them are treated as two separate numbers, not one decimal number');
		assert(compareFileExtensionsDefault('abc2.txt2', 'abc1.txt10') < 0, 'extensions with numbers should be in numerical order, not alphabetical order');
		assert(compareFileExtensionsDefault('txt.abc1', 'txt.abc1') === 0, 'equal extensions with numbers should be equal');
		assert(compareFileExtensionsDefault('txt.abc1', 'txt.abc2') < 0, 'extensions with numbers should be in numerical order, not alphabetical order');
		assert(compareFileExtensionsDefault('txt.abc2', 'txt.abc10') < 0, 'extensions with numbers should be in numerical order even when they are multiple digits long');
		assert(compareFileExtensionsDefault('a.ext1', 'b.ext1') < 0, 'if equal extensions with numbers, filenames should be compared');
		assert(compareFileExtensionsDefault('a10.txt', 'A2.txt') > 0, 'filenames with number and case differences compare numerically');

		//
		// Comparisons with different results than compareFileExtensions
		//

		// name-only comparisons
		assert(compareFileExtensionsDefault('a', 'A') === compareLocale('a', 'A'), 'the same letter of different case sorts by locale');
		assert(compareFileExtensionsDefault('â', 'Â') === compareLocale('â', 'Â'), 'the same accented letter of different case sorts by locale');
		assert.deepStrictEqual(['email', 'Email', 'émail', 'Émail'].sort(compareFileExtensionsDefault), ['email', 'Email', 'émail', 'Émail'].sort((a, b) => a.localeCompare(b)), 'the same base characters with different case or accents sort in locale order');

		// name plus extension comparisons
		assert(compareFileExtensionsDefault('a.MD', 'a.md') === compareLocale('MD', 'md'), 'case differences in extensions sort by locale');
		assert(compareFileExtensionsDefault('a.md', 'A.md') === compareLocale('a', 'A'), 'case differences in names sort by locale');
		assert(compareFileExtensionsDefault('aggregate.go', 'aggregate_repo.go') > 0, 'names with the same extension sort in full filename locale order');

		// dotfile comparisons
		assert(compareFileExtensionsDefault('.env', '.aaa.env') > 0, 'dotfiles sort alphabetically when they contain multiple dots');
		assert(compareFileExtensionsDefault('.env', '.env.aaa') < 0, 'dotfiles with the same root sort shortest first');

		// dotfile vs non-dotfile comparisons
		assert(compareFileExtensionsDefault('.env', 'aaa') < 0, 'dotfiles come before filenames without extensions');
		assert(compareFileExtensionsDefault('.md', 'A.MD') < 0, 'dotfiles sort before uppercase files');

		// numeric comparisons
		assert(compareFileExtensionsDefault('abc.txt01', 'abc.txt1') > 0, 'extensions with equal numbers should be in shortest-first order');
		assert(compareFileExtensionsDefault('art01', 'Art01') === compareLocaleNumeric('art01', 'Art01'), 'a numerically equivalent word of a different case compares numerically based on locale');
		assert(compareFileExtensionsDefault('abc02.txt', 'abc002.txt') < 0, 'filenames with equivalent numbers and leading zeros sort shortest string first');
		assert(compareFileExtensionsDefault('txt.abc01', 'txt.abc1') > 0, 'extensions with equivalent numbers sort shortest extension first');

	});
});
