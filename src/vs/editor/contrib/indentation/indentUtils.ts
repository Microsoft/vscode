/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function getSpaceCnt(str: string, tabSize: number) {
	let spacesCnt = 0;

	for (let i = 0; i < str.length; i++) {
		if (str.charAt(i) === '\t') {
			spacesCnt += tabSize;
		} else {
			spacesCnt++;
		}
	}

	return spacesCnt;
}

export function generateIndent(spacesCnt: number, tabSize: number, insertSpaces: boolean) {
	spacesCnt = spacesCnt < 0 ? 0 : spacesCnt;

	let result = '';
	if (!insertSpaces) {
		let tabsCnt = Math.floor(spacesCnt / tabSize);
		spacesCnt = spacesCnt % tabSize;
		for (let i = 0; i < tabsCnt; i++) {
			result += '\t';
		}
	}

	for (let i = 0; i < spacesCnt; i++) {
		result += ' ';
	}

	return result;
}
