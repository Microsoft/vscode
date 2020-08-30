/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { CharacterClassifier } from 'vs/editor/common/core/characterClassifier';

export const enum WordCharacterClass {
	Regular = 0,
	Whitespace = 1,
	WordSeparator = 2
}

export class WordCharacterClassifier extends CharacterClassifier<WordCharacterClass> {

	constructor(wordSeparators: string) {
		super(WordCharacterClass.Regular);

		for (let i = 0, len = wordSeparators.length; i < len; i++) {
			this.set(wordSeparators.charCodeAt(i), WordCharacterClass.WordSeparator);
		}

		this.set(CharCode.Space, WordCharacterClass.Whitespace);
		this.set(CharCode.Tab, WordCharacterClass.Whitespace);
	}

}

function once<R>(computeFn: (input: string) => R): (input: string) => R {
	let cache: { [key: string]: R; } = {}; // TODO@Alex unbounded cache
	return (input: string): R => {
		if (!cache.hasOwnProperty(input)) {
			cache[input] = computeFn(input);
		}
		return cache[input];
	};
}

export const getMapForWordSeparators = once<WordCharacterClassifier>(
	(input) => new WordCharacterClassifier(input)
);
