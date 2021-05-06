/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sd from 'string_decoder';
import { CharCode } from 'vs/base/common/charCode';

/**
 * Convenient way to iterate over output line by line. This helper accommodates for the fact that
 * a buffer might not end with new lines all the way.
 *
 * To use:
 * - call the write method
 * - forEach() over the result to get the lines
 */
export class LineDecoder {
	private stringDecoder: sd.StringDecoder;
	private remaining: string | null;

	constructor(encoding: BufferEncoding = 'utf8') {
		this.stringDecoder = new sd.StringDecoder(encoding);
		this.remaining = null;
	}

	write(buffer: Buffer): string[] {
		const result: string[] = [];
		const value = this.remaining
			? this.remaining + this.stringDecoder.write(buffer)
			: this.stringDecoder.write(buffer);

		if (value.length < 1) {
			return result;
		}
		let start = 0;
		let ch: number;
		let idx = start;
		while (idx < value.length) {
			ch = value.charCodeAt(idx);
			if (ch === CharCode.CarriageReturn || ch === CharCode.LineFeed) {
				result.push(value.substring(start, idx));
				idx++;
				if (idx < value.length) {
					const lastChar = ch;
					ch = value.charCodeAt(idx);
					if ((lastChar === CharCode.CarriageReturn && ch === CharCode.LineFeed) || (lastChar === CharCode.LineFeed && ch === CharCode.CarriageReturn)) {
						idx++;
					}
				}
				start = idx;
			} else {
				idx++;
			}
		}
		this.remaining = start < value.length ? value.substr(start) : null;
		return result;
	}

	end(): string | null {
		return this.remaining;
	}
}
