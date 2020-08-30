/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const enum ChCode {
	BOM = 65279,

	SPACE = 32,
	TAB = 9,
	CARRIAGE_RETURN = 13,
	LINE_FEED = 10,

	SLASH = 47,

	LESS_THAN = 60,
	QUESTION_MARK = 63,
	EXCLAMATION_MARK = 33,
}

const enum State {
	ROOT_STATE = 0,
	DICT_STATE = 1,
	ARR_STATE = 2
}

export function parseWithLocation(content: string, filename: string, locationKeyName: string): any {
	return _parse(content, filename, locationKeyName);
}

/**
 * A very fast plist parser
 */
export function parse(content: string): any {
	return _parse(content, null, null);
}

function _parse(content: string, filename: string | null, locationKeyName: string | null): any {
	const len = content.length;

	let pos = 0;
	let line = 1;
	let char = 0;

	// Skip UTF8 BOM
	if (len > 0 && content.charCodeAt(0) === ChCode.BOM) {
		pos = 1;
	}

	function advancePosBy(by: number): void {
		if (locationKeyName === null) {
			pos = pos + by;
		} else {
			while (by > 0) {
				let chCode = content.charCodeAt(pos);
				if (chCode === ChCode.LINE_FEED) {
					pos++; line++; char = 0;
				} else {
					pos++; char++;
				}
				by--;
			}
		}
	}
	function advancePosTo(to: number): void {
		if (locationKeyName === null) {
			pos = to;
		} else {
			advancePosBy(to - pos);
		}
	}

	function skipWhitespace(): void {
		while (pos < len) {
			let chCode = content.charCodeAt(pos);
			if (chCode !== ChCode.SPACE && chCode !== ChCode.TAB && chCode !== ChCode.CARRIAGE_RETURN && chCode !== ChCode.LINE_FEED) {
				break;
			}
			advancePosBy(1);
		}
	}

	function advanceIfStartsWith(str: string): boolean {
		if (content.substr(pos, str.length) === str) {
			advancePosBy(str.length);
			return true;
		}
		return false;
	}

	function advanceUntil(str: string): void {
		let nextOccurence = content.indexOf(str, pos);
		if (nextOccurence !== -1) {
			advancePosTo(nextOccurence + str.length);
		} else {
			// EOF
			advancePosTo(len);
		}
	}

	function captureUntil(str: string): string {
		let nextOccurence = content.indexOf(str, pos);
		if (nextOccurence !== -1) {
			let r = content.substring(pos, nextOccurence);
			advancePosTo(nextOccurence + str.length);
			return r;
		} else {
			// EOF
			let r = content.substr(pos);
			advancePosTo(len);
			return r;
		}
	}

	let state = State.ROOT_STATE;

	let cur: any = null;
	let stateStack: State[] = [];
	let objStack: any[] = [];
	let curKey: string | null = null;

	function pushState(newState: State, newCur: any): void {
		stateStack.push(state);
		objStack.push(cur);
		state = newState;
		cur = newCur;
	}

	function popState(): void {
		if (stateStack.length === 0) {
			return fail('illegal state stack');
		}
		state = stateStack.pop()!;
		cur = objStack.pop();
	}

	function fail(msg: string): void {
		throw new Error('Near offset ' + pos + ': ' + msg + ' ~~~' + content.substr(pos, 50) + '~~~');
	}

	const dictState = {
		enterDict: function () {
			if (curKey === null) {
				return fail('missing <key>');
			}
			let newDict: { [key: string]: any } = {};
			if (locationKeyName !== null) {
				newDict[locationKeyName] = {
					filename: filename,
					line: line,
					char: char
				};
			}
			cur[curKey] = newDict;
			curKey = null;
			pushState(State.DICT_STATE, newDict);
		},
		enterArray: function () {
			if (curKey === null) {
				return fail('missing <key>');
			}
			let newArr: any[] = [];
			cur[curKey] = newArr;
			curKey = null;
			pushState(State.ARR_STATE, newArr);
		}
	};

	const arrState = {
		enterDict: function () {
			let newDict: { [key: string]: any } = {};
			if (locationKeyName !== null) {
				newDict[locationKeyName] = {
					filename: filename,
					line: line,
					char: char
				};
			}
			cur.push(newDict);
			pushState(State.DICT_STATE, newDict);
		},
		enterArray: function () {
			let newArr: any[] = [];
			cur.push(newArr);
			pushState(State.ARR_STATE, newArr);
		}
	};


	function enterDict() {
		if (state === State.DICT_STATE) {
			dictState.enterDict();
		} else if (state === State.ARR_STATE) {
			arrState.enterDict();
		} else { // ROOT_STATE
			cur = {};
			if (locationKeyName !== null) {
				cur[locationKeyName] = {
					filename: filename,
					line: line,
					char: char
				};
			}
			pushState(State.DICT_STATE, cur);
		}
	}
	function leaveDict() {
		if (state === State.DICT_STATE) {
			popState();
		} else if (state === State.ARR_STATE) {
			return fail('unexpected </dict>');
		} else { // ROOT_STATE
			return fail('unexpected </dict>');
		}
	}
	function enterArray() {
		if (state === State.DICT_STATE) {
			dictState.enterArray();
		} else if (state === State.ARR_STATE) {
			arrState.enterArray();
		} else { // ROOT_STATE
			cur = [];
			pushState(State.ARR_STATE, cur);
		}
	}
	function leaveArray() {
		if (state === State.DICT_STATE) {
			return fail('unexpected </array>');
		} else if (state === State.ARR_STATE) {
			popState();
		} else { // ROOT_STATE
			return fail('unexpected </array>');
		}
	}
	function acceptKey(val: string) {
		if (state === State.DICT_STATE) {
			if (curKey !== null) {
				return fail('too many <key>');
			}
			curKey = val;
		} else if (state === State.ARR_STATE) {
			return fail('unexpected <key>');
		} else { // ROOT_STATE
			return fail('unexpected <key>');
		}
	}
	function acceptString(val: string) {
		if (state === State.DICT_STATE) {
			if (curKey === null) {
				return fail('missing <key>');
			}
			cur[curKey] = val;
			curKey = null;
		} else if (state === State.ARR_STATE) {
			cur.push(val);
		} else { // ROOT_STATE
			cur = val;
		}
	}
	function acceptReal(val: number) {
		if (isNaN(val)) {
			return fail('cannot parse float');
		}
		if (state === State.DICT_STATE) {
			if (curKey === null) {
				return fail('missing <key>');
			}
			cur[curKey] = val;
			curKey = null;
		} else if (state === State.ARR_STATE) {
			cur.push(val);
		} else { // ROOT_STATE
			cur = val;
		}
	}
	function acceptInteger(val: number) {
		if (isNaN(val)) {
			return fail('cannot parse integer');
		}
		if (state === State.DICT_STATE) {
			if (curKey === null) {
				return fail('missing <key>');
			}
			cur[curKey] = val;
			curKey = null;
		} else if (state === State.ARR_STATE) {
			cur.push(val);
		} else { // ROOT_STATE
			cur = val;
		}
	}
	function acceptDate(val: Date) {
		if (state === State.DICT_STATE) {
			if (curKey === null) {
				return fail('missing <key>');
			}
			cur[curKey] = val;
			curKey = null;
		} else if (state === State.ARR_STATE) {
			cur.push(val);
		} else { // ROOT_STATE
			cur = val;
		}
	}
	function acceptData(val: string) {
		if (state === State.DICT_STATE) {
			if (curKey === null) {
				return fail('missing <key>');
			}
			cur[curKey] = val;
			curKey = null;
		} else if (state === State.ARR_STATE) {
			cur.push(val);
		} else { // ROOT_STATE
			cur = val;
		}
	}
	function acceptBool(val: boolean) {
		if (state === State.DICT_STATE) {
			if (curKey === null) {
				return fail('missing <key>');
			}
			cur[curKey] = val;
			curKey = null;
		} else if (state === State.ARR_STATE) {
			cur.push(val);
		} else { // ROOT_STATE
			cur = val;
		}
	}

	function escapeVal(str: string): string {
		return str.replace(/&#([0-9]+);/g, function (_: string, m0: string) {
			return (<any>String).fromCodePoint(parseInt(m0, 10));
		}).replace(/&#x([0-9a-f]+);/g, function (_: string, m0: string) {
			return (<any>String).fromCodePoint(parseInt(m0, 16));
		}).replace(/&amp;|&lt;|&gt;|&quot;|&apos;/g, function (_: string) {
			switch (_) {
				case '&amp;': return '&';
				case '&lt;': return '<';
				case '&gt;': return '>';
				case '&quot;': return '"';
				case '&apos;': return '\'';
			}
			return _;
		});
	}

	interface IParsedTag {
		name: string;
		isClosed: boolean;
	}

	function parseOpenTag(): IParsedTag {
		let r = captureUntil('>');
		let isClosed = false;
		if (r.charCodeAt(r.length - 1) === ChCode.SLASH) {
			isClosed = true;
			r = r.substring(0, r.length - 1);
		}

		return {
			name: r.trim(),
			isClosed: isClosed
		};
	}

	function parseTagValue(tag: IParsedTag): string {
		if (tag.isClosed) {
			return '';
		}
		let val = captureUntil('</');
		advanceUntil('>');
		return escapeVal(val);
	}

	while (pos < len) {
		skipWhitespace();
		if (pos >= len) {
			break;
		}

		const chCode = content.charCodeAt(pos);
		advancePosBy(1);
		if (chCode !== ChCode.LESS_THAN) {
			return fail('expected <');
		}

		if (pos >= len) {
			return fail('unexpected end of input');
		}

		const peekChCode = content.charCodeAt(pos);

		if (peekChCode === ChCode.QUESTION_MARK) {
			advancePosBy(1);
			advanceUntil('?>');
			continue;
		}

		if (peekChCode === ChCode.EXCLAMATION_MARK) {
			advancePosBy(1);

			if (advanceIfStartsWith('--')) {
				advanceUntil('-->');
				continue;
			}

			advanceUntil('>');
			continue;
		}

		if (peekChCode === ChCode.SLASH) {
			advancePosBy(1);
			skipWhitespace();

			if (advanceIfStartsWith('plist')) {
				advanceUntil('>');
				continue;
			}

			if (advanceIfStartsWith('dict')) {
				advanceUntil('>');
				leaveDict();
				continue;
			}

			if (advanceIfStartsWith('array')) {
				advanceUntil('>');
				leaveArray();
				continue;
			}

			return fail('unexpected closed tag');
		}

		let tag = parseOpenTag();

		switch (tag.name) {
			case 'dict':
				enterDict();
				if (tag.isClosed) {
					leaveDict();
				}
				continue;

			case 'array':
				enterArray();
				if (tag.isClosed) {
					leaveArray();
				}
				continue;

			case 'key':
				acceptKey(parseTagValue(tag));
				continue;

			case 'string':
				acceptString(parseTagValue(tag));
				continue;

			case 'real':
				acceptReal(parseFloat(parseTagValue(tag)));
				continue;

			case 'integer':
				acceptInteger(parseInt(parseTagValue(tag), 10));
				continue;

			case 'date':
				acceptDate(new Date(parseTagValue(tag)));
				continue;

			case 'data':
				acceptData(parseTagValue(tag));
				continue;

			case 'true':
				parseTagValue(tag);
				acceptBool(true);
				continue;

			case 'false':
				parseTagValue(tag);
				acceptBool(false);
				continue;
		}

		if (/^plist/.test(tag.name)) {
			continue;
		}

		return fail('unexpected opened tag ' + tag.name);
	}

	return cur;
}
