/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position, Range } from '../modes/languageModes';

export function beforeOrSame(p1: Position, p2: Position) {
	return p1.line < p2.line || p1.line === p2.line && p1.character <= p2.character;
}
export function insideRangeButNotSame(r1: Range, r2: Range) {
	return beforeOrSame(r1.start, r2.start) && beforeOrSame(r2.end, r1.end) && !equalRange(r1, r2);
}
export function equalRange(r1: Range, r2: Range) {
	return r1.start.line === r2.start.line && r1.start.character === r2.start.character && r1.end.line === r2.end.line && r1.end.character === r2.end.character;
}
