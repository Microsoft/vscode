/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IndentationRule } from 'vs/editor/common/modes/languageConfiguration';

export const enum IndentConsts {
	INCREASE_MASK = 0b00000001,
	DECREASE_MASK = 0b00000010,
	INDENT_NEXTLINE_MASK = 0b00000100,
	UNINDENT_MASK = 0b00001000,
}

function resetGlobalRegex(reg: RegExp) {
	if (reg.global) {
		reg.lastIndex = 0;
	}

	return true;
}

export class IndentRulesSupport {

	private readonly _indentationRules: IndentationRule;

	constructor(indentationRules: IndentationRule) {
		this._indentationRules = indentationRules;
	}

	public shouldIncrease(text: string): boolean {
		if (this._indentationRules) {
			if (this._indentationRules.increaseIndentPattern && resetGlobalRegex(this._indentationRules.increaseIndentPattern) && this._indentationRules.increaseIndentPattern.test(text)) {
				return true;
			}
			// if (this._indentationRules.indentNextLinePattern && this._indentationRules.indentNextLinePattern.test(text)) {
			// 	return true;
			// }
		}
		return false;
	}

	public shouldDecrease(text: string): boolean {
		if (this._indentationRules && this._indentationRules.decreaseIndentPattern && resetGlobalRegex(this._indentationRules.decreaseIndentPattern) && this._indentationRules.decreaseIndentPattern.test(text)) {
			return true;
		}
		return false;
	}

	public shouldIndentNextLine(text: string): boolean {
		if (this._indentationRules && this._indentationRules.indentNextLinePattern && resetGlobalRegex(this._indentationRules.indentNextLinePattern) && this._indentationRules.indentNextLinePattern.test(text)) {
			return true;
		}

		return false;
	}

	public shouldIgnore(text: string): boolean {
		// the text matches `unIndentedLinePattern`
		if (this._indentationRules && this._indentationRules.unIndentedLinePattern && resetGlobalRegex(this._indentationRules.unIndentedLinePattern) && this._indentationRules.unIndentedLinePattern.test(text)) {
			return true;
		}

		return false;
	}

	public getIndentMetadata(text: string): number {
		let ret = 0;
		if (this.shouldIncrease(text)) {
			ret += IndentConsts.INCREASE_MASK;
		}
		if (this.shouldDecrease(text)) {
			ret += IndentConsts.DECREASE_MASK;
		}
		if (this.shouldIndentNextLine(text)) {
			ret += IndentConsts.INDENT_NEXTLINE_MASK;
		}
		if (this.shouldIgnore(text)) {
			ret += IndentConsts.UNINDENT_MASK;
		}
		return ret;
	}
}
