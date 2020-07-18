/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Checkbox } from 'vs/base/browser/ui/checkbox/checkbox';
import { Color } from 'vs/base/common/color';
import * as nls from 'vs/nls';
import { Codicon } from 'vs/base/common/codicons';

export interface IFindInputCheckboxOpts {
	readonly appendTitle: string;
	readonly isChecked: boolean;
	readonly inputActiveOptionBorder?: Color;
	readonly inputActiveOptionForeground?: Color;
	readonly inputActiveOptionBackground?: Color;
}

const NLS_CASE_SENSITIVE_CHECKBOX_LABEL = nls.localize('caseDescription', "Match Case");
const NLS_WHOLE_WORD_CHECKBOX_LABEL = nls.localize('wordsDescription', "Match Whole Word");
const NLS_REGEX_CHECKBOX_LABEL = nls.localize('regexDescription', "Use Regular Expression");

export class CaseSensitiveCheckbox extends Checkbox {
	constructor(opts: IFindInputCheckboxOpts) {
		super({
			icon: Codicon.caseSensitive,
			title: NLS_CASE_SENSITIVE_CHECKBOX_LABEL + opts.appendTitle,
			isChecked: opts.isChecked,
			inputActiveOptionBorder: opts.inputActiveOptionBorder,
			inputActiveOptionForeground: opts.inputActiveOptionForeground,
			inputActiveOptionBackground: opts.inputActiveOptionBackground
		});
	}
}

export class WholeWordsCheckbox extends Checkbox {
	constructor(opts: IFindInputCheckboxOpts) {
		super({
			icon: Codicon.wholeWord,
			title: NLS_WHOLE_WORD_CHECKBOX_LABEL + opts.appendTitle,
			isChecked: opts.isChecked,
			inputActiveOptionBorder: opts.inputActiveOptionBorder,
			inputActiveOptionForeground: opts.inputActiveOptionForeground,
			inputActiveOptionBackground: opts.inputActiveOptionBackground
		});
	}
}

export class RegexCheckbox extends Checkbox {
	constructor(opts: IFindInputCheckboxOpts) {
		super({
			icon: Codicon.regex,
			title: NLS_REGEX_CHECKBOX_LABEL + opts.appendTitle,
			isChecked: opts.isChecked,
			inputActiveOptionBorder: opts.inputActiveOptionBorder,
			inputActiveOptionForeground: opts.inputActiveOptionForeground,
			inputActiveOptionBackground: opts.inputActiveOptionBackground
		});
	}
}
