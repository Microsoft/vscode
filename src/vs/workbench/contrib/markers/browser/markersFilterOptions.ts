/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFilter, matchesFuzzy, matchesFuzzy2 } from 'vs/base/common/filters';
import { IExpression, splitGlobAware, getEmptyExpression } from 'vs/base/common/glob';
import * as strings from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { ResourceGlobMatcher } from 'vs/base/common/resources';

export class FilterOptions {

	static readonly _filter: IFilter = matchesFuzzy2;
	static readonly _messageFilter: IFilter = matchesFuzzy;

	readonly showWarnings: boolean = false;
	readonly showErrors: boolean = false;
	readonly showInfos: boolean = false;
	readonly textFilter: string = '';
	readonly excludesMatcher: ResourceGlobMatcher;
	readonly includesMatcher: ResourceGlobMatcher;

	constructor(readonly filter: string = '', filesExclude: { root: URI, expression: IExpression }[] | IExpression = [], showWarnings: boolean = false, showErrors: boolean = false, showInfos: boolean = false) {
		filter = filter.trim();
		this.showWarnings = showWarnings;
		this.showErrors = showErrors;
		this.showInfos = showInfos;

		const filesExcludeByRoot = Array.isArray(filesExclude) ? filesExclude : [];
		const excludesExpression: IExpression = Array.isArray(filesExclude) ? getEmptyExpression() : filesExclude;

		const includeExpression: IExpression = getEmptyExpression();
		if (filter) {
			const filters = splitGlobAware(filter, ',').map(s => s.trim()).filter(s => !!s.length);
			for (const f of filters) {
				if (f.startsWith('!')) {
					this.setPattern(excludesExpression, strings.ltrim(f, '!'));
				} else {
					this.setPattern(includeExpression, f);
					this.textFilter += ` ${f}`;
				}
			}
		}

		this.excludesMatcher = new ResourceGlobMatcher(excludesExpression, filesExcludeByRoot);
		this.includesMatcher = new ResourceGlobMatcher(includeExpression, []);
		this.textFilter = this.textFilter.trim();
	}

	private setPattern(expression: IExpression, pattern: string) {
		if (pattern[0] === '.') {
			pattern = '*' + pattern; // convert ".js" to "*.js"
		}
		expression[`**/${pattern}/**`] = true;
		expression[`**/${pattern}`] = true;
	}
}
