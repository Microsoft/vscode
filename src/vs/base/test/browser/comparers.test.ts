/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { compareFileNames, compareFileExtensions, compareFileNamesNumeric, compareFileExtensionsNumeric } from 'vs/base/common/comparers';
import * as assert from 'assert';

const compareLocale = (a: string, b: string) => a.localeCompare(b);
const compareLocaleNumeric = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });


suite('Comparers', () => {

	test('compareFileNames', () => {

		//
		// Comparisons with the same results as compareFileNamesNumeric
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
		// Comparisons with different results than compareFileNamesNumeric
		//

		// name-only comparisons
		assert(compareFileNames('a', 'A') !== compareLocale('a', 'A'), 'the same letter does not sort by locale');
		assert(compareFileNames('â', 'Â') !== compareLocale('â', 'Â'), 'the same accented letter does not sort by locale');
		assert.notDeepEqual(['artichoke', 'Artichoke', 'art', 'Art'].sort(compareFileNames), ['artichoke', 'Artichoke', 'art', 'Art'].sort(compareLocale), 'words with the same root and different cases do not sort in locale order');
		assert.notDeepEqual(['email', 'Email', 'émail', 'Émail'].sort(compareFileNames), ['email', 'Email', 'émail', 'Émail'].sort(compareLocale), 'the same base characters with different case or accents do not sort in locale order');

		// name plus extension comparisons
		assert(compareFileNames('aggregate.go', 'aggregate_repo.go') > 0, 'compares the whole name all at once by locale');

		// numeric comparisons
		assert(compareFileNames('abc02.txt', 'abc002.txt') > 0, 'filenames with equivalent numbers and leading zeros sort in unicode order');
		assert(compareFileNames('abc.txt1', 'abc.txt01') > 0, 'same name plus extensions with equal numbers sort in unicode order');
		assert(compareFileNames('art01', 'Art01') !== 'art01'.localeCompare('Art01', undefined, { numeric: true }),
			'a numerically equivalent word of a different case does not compare numerically based on locale');

	});

	test('compareFileExtensions', () => {

		//
		// Comparisons with the same results as compareFileExtensionsNumeric
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

		// Same extension comparison that has the same result as compareFileExtensionsNumeric, but a different result than compareFileNames
		// This is an edge case caused by compareFileNames comparing the whole name all at once instead of the name and then the extension.
		assert(compareFileExtensions('aggregate.go', 'aggregate_repo.go') < 0, 'when extensions are equal, names sort in dictionary order');

		//
		// Comparisons with different results from compareFileExtensionsNumeric
		//

		// name-only comparisions
		assert(compareFileExtensions('a', 'A') !== compareLocale('a', 'A'), 'the same letter of different case does not sort by locale');
		assert(compareFileExtensions('â', 'Â') !== compareLocale('â', 'Â'), 'the same accented letter of different case does not sort by locale');
		assert.notDeepEqual(['artichoke', 'Artichoke', 'art', 'Art'].sort(compareFileExtensions), ['artichoke', 'Artichoke', 'art', 'Art'].sort(compareLocale), 'words with the same root and different cases do not sort in locale order');
		assert.notDeepEqual(['email', 'Email', 'émail', 'Émail'].sort(compareFileExtensions), ['email', 'Email', 'émail', 'Émail'].sort((a, b) => a.localeCompare(b)), 'the same base characters with different case or accents do not sort in locale order');

		// name plus extension comparisons
		assert(compareFileExtensions('a.MD', 'a.md') !== compareLocale('MD', 'md'), 'case differences in extensions do not sort by locale');
		assert(compareFileExtensions('a.md', 'A.md') !== compareLocale('a', 'A'), 'case differences in names do not sort by locale');

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

	test('compareFileNamesNumeric', () => {

		//
		// Comparisons with the same results as compareFileNames
		//

		// name-only comparisons
		assert(compareFileNamesNumeric(null, null) === 0, 'null should be equal');
		assert(compareFileNamesNumeric(null, 'abc') < 0, 'null should be come before real values');
		assert(compareFileNamesNumeric('', '') === 0, 'empty should be equal');
		assert(compareFileNamesNumeric('abc', 'abc') === 0, 'equal names should be equal');
		assert(compareFileNamesNumeric('z', 'A') > 0, 'z comes is after A regardless of case');
		assert(compareFileNamesNumeric('Z', 'a') > 0, 'Z comes after a regardless of case');

		// name plus extension comparisons
		assert(compareFileNamesNumeric('file.ext', 'file.ext') === 0, 'equal full names should be equal');
		assert(compareFileNamesNumeric('a.ext', 'b.ext') < 0, 'if equal extensions, filenames should be compared');
		assert(compareFileNamesNumeric('file.aaa', 'file.bbb') < 0, 'files with equal names should be compared by extensions');
		assert(compareFileNamesNumeric('bbb.aaa', 'aaa.bbb') > 0, 'files should be compared by names even if extensions compare differently');

		// dotfile comparisons
		assert(compareFileNamesNumeric('.abc', '.abc') === 0, 'equal dotfile names should be equal');
		assert(compareFileNamesNumeric('.env.', '.gitattributes') < 0, 'filenames starting with dots and with extensions should still sort properly');
		assert(compareFileNamesNumeric('.env', '.aaa.env') > 0, 'dotfiles sort alphabetically when they contain multiple dots');
		assert(compareFileNamesNumeric('.env', '.env.aaa') < 0, 'dotfiles with the same root sort shortest first');
		assert(compareFileNamesNumeric('.aaa_env', '.aaa.env') < 0, 'and underscore in a dotfile name will sort before a dot');

		// dotfile vs non-dotfile comparisons
		assert(compareFileNamesNumeric(null, '.abc') < 0, 'null should come before dotfiles');
		assert(compareFileNamesNumeric('.env', 'aaa') < 0, 'dotfiles come before filenames without extensions');
		assert(compareFileNamesNumeric('.env', 'aaa.env') < 0, 'dotfiles come before filenames with extensions');
		assert(compareFileNamesNumeric('.md', 'A.MD') < 0, 'dotfiles sort before uppercase files');
		assert(compareFileNamesNumeric('.MD', 'a.md') < 0, 'dotfiles sort before lowercase files');

		// numeric comparisons
		assert(compareFileNamesNumeric('1', '1') === 0, 'numerically equal full names should be equal');
		assert(compareFileNamesNumeric('abc1.txt', 'abc1.txt') === 0, 'equal filenames with numbers should be equal');
		assert(compareFileNamesNumeric('abc1.txt', 'abc2.txt') < 0, 'filenames with numbers should be in numerical order, not alphabetical order');
		assert(compareFileNamesNumeric('abc2.txt', 'abc10.txt') < 0, 'filenames with numbers should be in numerical order even when they are multiple digits long');
		assert(compareFileNamesNumeric('abc02.txt', 'abc010.txt') < 0, 'filenames with numbers that have leading zeros sort numerically');
		assert(compareFileNamesNumeric('abc1.10.txt', 'abc1.2.txt') > 0, 'numbers with dots between them are treated as two separate numbers, not one decimal number');

		//
		// Comparisons with different results than compareFileNames
		//

		// name-only comparisons
		assert(compareFileNamesNumeric('a', 'A') === compareLocale('a', 'A'), 'the same letter sorts by locale');
		assert(compareFileNamesNumeric('â', 'Â') === compareLocale('â', 'Â'), 'the same accented letter sorts by locale');
		assert.deepEqual(['artichoke', 'Artichoke', 'art', 'Art'].sort(compareFileNamesNumeric), ['artichoke', 'Artichoke', 'art', 'Art'].sort(compareLocale), 'words with the same root and different cases sort in locale order');
		assert.deepEqual(['email', 'Email', 'émail', 'Émail'].sort(compareFileNamesNumeric), ['email', 'Email', 'émail', 'Émail'].sort(compareLocale), 'the same base characters with different case or accents sort in locale order');

		// name plus extensions comparisons
		assert(compareFileNamesNumeric('aggregate.go', 'aggregate_repo.go') < 0, 'compares the name first, then the extension');

		// numeric comparisons
		assert(compareFileNamesNumeric('abc02.txt', 'abc002.txt') < 0, 'filenames with equivalent numbers and leading zeros sort shortest number first');
		assert(compareFileNamesNumeric('abc.txt1', 'abc.txt01') < 0, 'same name plus extensions with equal numbers sort shortest number first');
		assert(compareFileNamesNumeric('art01', 'Art01') === compareLocaleNumeric('art01', 'Art01'), 'a numerically equivalent word of a different case compares numerically based on locale');

	});

	test('compareFileExtensionsNumeric', () => {

		//
		// Comparisons with the same result as compareFileExtensions
		//

		// name-only comparisons
		assert(compareFileExtensionsNumeric(null, null) === 0, 'null should be equal');
		assert(compareFileExtensionsNumeric(null, 'abc') < 0, 'null should come before real files without extensions');
		assert(compareFileExtensionsNumeric('', '') === 0, 'empty should be equal');
		assert(compareFileExtensionsNumeric('abc', 'abc') === 0, 'equal names should be equal');
		assert(compareFileExtensionsNumeric('z', 'A') > 0, 'z comes after A');
		assert(compareFileExtensionsNumeric('Z', 'a') > 0, 'Z comes after a');

		// name plus extension comparisons
		assert(compareFileExtensionsNumeric('file.ext', 'file.ext') === 0, 'equal full filenames should be equal');
		assert(compareFileExtensionsNumeric('a.ext', 'b.ext') < 0, 'if equal extensions, filenames should be compared');
		assert(compareFileExtensionsNumeric('file.aaa', 'file.bbb') < 0, 'files with equal names should be compared by extensions');
		assert(compareFileExtensionsNumeric('bbb.aaa', 'aaa.bbb') < 0, 'files should be compared by extension first');
		assert(compareFileExtensionsNumeric('agg.go', 'aggrepo.go') < 0, 'shorter names sort before longer names');
		assert(compareFileExtensionsNumeric('agg.go', 'agg_repo.go') < 0, 'shorter names short before longer names even when the longer name contains an underscore');
		assert(compareFileExtensionsNumeric('a.MD', 'b.md') < 0, 'when extensions are the same except for case, the files sort by name');

		// dotfile comparisons
		assert(compareFileExtensionsNumeric('.abc', '.abc') === 0, 'equal dotfiles should be equal');
		assert(compareFileExtensionsNumeric('.md', '.Gitattributes') > 0, 'dotfiles sort alphabetically regardless of case');

		// dotfile vs non-dotfile comparisons
		assert(compareFileExtensionsNumeric(null, '.abc') < 0, 'null should come before dotfiles');
		assert(compareFileExtensionsNumeric('.env', 'aaa.env') < 0, 'dotfiles come before filenames with extensions');
		assert(compareFileExtensionsNumeric('.MD', 'a.md') < 0, 'dotfiles sort before lowercase files');

		// numeric comparisons
		assert(compareFileExtensionsNumeric('1', '1') === 0, 'numerically equal full names should be equal');
		assert(compareFileExtensionsNumeric('abc1.txt', 'abc1.txt') === 0, 'equal filenames with numbers should be equal');
		assert(compareFileExtensionsNumeric('abc1.txt', 'abc2.txt') < 0, 'filenames with numbers should be in numerical order, not alphabetical order');
		assert(compareFileExtensionsNumeric('abc2.txt', 'abc10.txt') < 0, 'filenames with numbers should be in numerical order');
		assert(compareFileExtensionsNumeric('abc02.txt', 'abc010.txt') < 0, 'filenames with numbers that have leading zeros sort numerically');
		assert(compareFileExtensionsNumeric('abc1.10.txt', 'abc1.2.txt') > 0, 'numbers with dots between them are treated as two separate numbers, not one decimal number');
		assert(compareFileExtensionsNumeric('abc2.txt2', 'abc1.txt10') < 0, 'extensions with numbers should be in numerical order, not alphabetical order');
		assert(compareFileExtensionsNumeric('txt.abc1', 'txt.abc1') === 0, 'equal extensions with numbers should be equal');
		assert(compareFileExtensionsNumeric('txt.abc1', 'txt.abc2') < 0, 'extensions with numbers should be in numerical order, not alphabetical order');
		assert(compareFileExtensionsNumeric('txt.abc2', 'txt.abc10') < 0, 'extensions with numbers should be in numerical order even when they are multiple digits long');
		assert(compareFileExtensionsNumeric('a.ext1', 'b.ext1') < 0, 'if equal extensions with numbers, filenames should be compared');
		assert(compareFileExtensionsNumeric('a10.txt', 'A2.txt') > 0, 'filenames with number and case differences compare numerically');

		// Same extension comparison that has the same result as compareFileExtensions, but a different result than compareFileNames
		// This is an edge case caused by compareFileNames comparing the whole name all at once instead of the name and then the extension.
		assert(compareFileExtensionsNumeric('aggregate.go', 'aggregate_repo.go') < 0, 'when extensions are equal, names sort in dictionary order');

		//
		// Comparisons with different results than compareFileExtensions
		//

		// name-only comparisons
		assert(compareFileExtensionsNumeric('a', 'A') === compareLocale('a', 'A'), 'the same letter of different case sorts by locale');
		assert(compareFileExtensionsNumeric('â', 'Â') === compareLocale('â', 'Â'), 'the same accented letter of different case sorts by locale');
		assert.deepEqual(['artichoke', 'Artichoke', 'art', 'Art'].sort(compareFileExtensionsNumeric), ['artichoke', 'Artichoke', 'art', 'Art'].sort(compareLocale), 'words with the same root and different cases sort in locale order');
		assert.deepEqual(['email', 'Email', 'émail', 'Émail'].sort(compareFileExtensionsNumeric), ['email', 'Email', 'émail', 'Émail'].sort((a, b) => a.localeCompare(b)), 'the same base characters with different case or accents sort in locale order');

		// name plus extension comparisons
		assert(compareFileExtensionsNumeric('a.MD', 'a.md') === compareLocale('MD', 'md'), 'case differences in extensions sort by locale');
		assert(compareFileExtensionsNumeric('a.md', 'A.md') === compareLocale('a', 'A'), 'case differences in names sort by locale');

		// dotfile comparisons
		assert(compareFileExtensionsNumeric('.env', '.aaa.env') > 0, 'dotfiles sort alphabetically when they contain multiple dots');
		assert(compareFileExtensionsNumeric('.env', '.env.aaa') < 0, 'dotfiles with the same root sort shortest first');

		// dotfile vs non-dotfile comparisons
		assert(compareFileExtensionsNumeric('.env', 'aaa') < 0, 'dotfiles come before filenames without extensions');
		assert(compareFileExtensionsNumeric('.md', 'A.MD') < 0, 'dotfiles sort before uppercase files');

		// numeric comparisons
		assert(compareFileExtensionsNumeric('abc.txt01', 'abc.txt1') > 0, 'extensions with equal numbers should be in shortest-first order');
		assert(compareFileExtensionsNumeric('art01', 'Art01') === compareLocaleNumeric('art01', 'Art01'), 'a numerically equivalent word of a different case compares numerically based on locale');
		assert(compareFileExtensionsNumeric('abc02.txt', 'abc002.txt') < 0, 'filenames with equivalent numbers and leading zeros sort shortest string first');
		assert(compareFileExtensionsNumeric('txt.abc01', 'txt.abc1') > 0, 'extensions with equivalent numbers sort shortest extension first');

	});
});
