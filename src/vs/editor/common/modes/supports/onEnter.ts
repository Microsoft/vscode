/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';
import * as strings from 'vs/base/common/strings';
import { CharacterPair, EnterAction, IndentAction, OnEnterRule } from 'vs/editor/common/modes/languageConfiguration';
import { EditorAutoIndentStrategy } from 'vs/editor/common/config/editorOptions';

export interface IOnEnterSupportOptions {
	brackets?: CharacterPair[];
	onEnterRules?: OnEnterRule[];
}

interface IProcessedBracketPair {
	open: string;
	close: string;
	openRegExp: RegExp;
	closeRegExp: RegExp;
}

export class OnEnterSupport {

	private readonly _brackets: IProcessedBracketPair[];
	private readonly _regExpRules: OnEnterRule[];

	constructor(opts: IOnEnterSupportOptions) {
		opts = opts || {};
		opts.brackets = opts.brackets || [
			['(', ')'],
			['{', '}'],
			['[', ']']
		];

		this._brackets = [];
		opts.brackets.forEach((bracket) => {
			const openRegExp = OnEnterSupport._createOpenBracketRegExp(bracket[0]);
			const closeRegExp = OnEnterSupport._createCloseBracketRegExp(bracket[1]);
			if (openRegExp && closeRegExp) {
				this._brackets.push({
					open: bracket[0],
					openRegExp: openRegExp,
					close: bracket[1],
					closeRegExp: closeRegExp,
				});
			}
		});
		this._regExpRules = opts.onEnterRules || [];
	}

	public onEnter(autoIndent: EditorAutoIndentStrategy, oneLineAboveText: string, beforeEnterText: string, afterEnterText: string): EnterAction | null {
		// (1): `regExpRules`
		if (autoIndent >= EditorAutoIndentStrategy.Advanced) {
			for (let i = 0, len = this._regExpRules.length; i < len; i++) {
				let rule = this._regExpRules[i];
				const regResult = [{
					reg: rule.beforeText,
					text: beforeEnterText
				}, {
					reg: rule.afterText,
					text: afterEnterText
				}, {
					reg: rule.oneLineAboveText,
					text: oneLineAboveText
				}].every((obj): boolean => {
					return obj.reg ? obj.reg.test(obj.text) : true;
				});

				if (regResult) {
					return rule.action;
				}
			}
		}

		// (2): Special indent-outdent
		if (autoIndent >= EditorAutoIndentStrategy.Brackets) {
			if (beforeEnterText.length > 0 && afterEnterText.length > 0) {
				for (let i = 0, len = this._brackets.length; i < len; i++) {
					let bracket = this._brackets[i];
					if (bracket.openRegExp.test(beforeEnterText) && bracket.closeRegExp.test(afterEnterText)) {
						return { indentAction: IndentAction.IndentOutdent };
					}
				}
			}
		}


		// (4): Open bracket based logic
		if (autoIndent >= EditorAutoIndentStrategy.Brackets) {
			if (beforeEnterText.length > 0) {
				for (let i = 0, len = this._brackets.length; i < len; i++) {
					let bracket = this._brackets[i];
					if (bracket.openRegExp.test(beforeEnterText)) {
						return { indentAction: IndentAction.Indent };
					}
				}
			}
		}

		return null;
	}

	private static _createOpenBracketRegExp(bracket: string): RegExp | null {
		let str = strings.escapeRegExpCharacters(bracket);
		if (!/\B/.test(str.charAt(0))) {
			str = '\\b' + str;
		}
		str += '\\s*$';
		return OnEnterSupport._safeRegExp(str);
	}

	private static _createCloseBracketRegExp(bracket: string): RegExp | null {
		let str = strings.escapeRegExpCharacters(bracket);
		if (!/\B/.test(str.charAt(str.length - 1))) {
			str = str + '\\b';
		}
		str = '^\\s*' + str;
		return OnEnterSupport._safeRegExp(str);
	}

	private static _safeRegExp(def: string): RegExp | null {
		try {
			return new RegExp(def);
		} catch (err) {
			onUnexpectedError(err);
			return null;
		}
	}
}
