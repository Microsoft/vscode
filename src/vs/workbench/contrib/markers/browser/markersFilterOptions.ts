/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFilter, matchesFuzzy, matchesFuzzy2 } from 'vs/base/common/filters';
import { IExpression, splitGlobAware, getEmptyExpression, ParsedExpression, parse } from 'vs/base/common/glob';
import * as strings from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { relativePath } from 'vs/base/common/resources';
import { TernarySearchTree } from 'vs/base/common/map';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export class ResourceGlobMatcher {

	private readonly globalExpression: ParsedExpression;
	private readonly expressionsByRoot: TernarySearchTree<URI, { root: URI, expression: ParsedExpression }>;

	constructor(
		globalExpression: IExpression,
		rootExpressions: { root: URI, expression: IExpression }[],
		uriIdentityService: IUriIdentityService
	) {
		this.globalExpression = parse(globalExpression);
		this.expressionsByRoot = TernarySearchTree.forUris<{ root: URI, expression: ParsedExpression }>(uri => uriIdentityService.extUri.ignorePathCasing(uri));
		for (const expression of rootExpressions) {
			this.expressionsByRoot.set(expression.root, { root: expression.root, expression: parse(expression.expression) });
		}
	}

	matches(resource: URI): boolean {
		const rootExpression = this.expressionsByRoot.findSubstr(resource);
		if (rootExpression) {
			const path = relativePath(rootExpression.root, resource);
			if (path && !!rootExpression.expression(path)) {
				return true;
			}
		}
		return !!this.globalExpression(resource.path);
	}
}

export class FilterOptions {

	static readonly _filter: IFilter = matchesFuzzy2;
	static readonly _messageFilter: IFilter = matchesFuzzy;

	readonly showWarnings: boolean = false;
	readonly showErrors: boolean = false;
	readonly showInfos: boolean = false;
	readonly textFilter: { readonly text: string, readonly negate: boolean };
	readonly excludesMatcher: ResourceGlobMatcher;
	readonly includesMatcher: ResourceGlobMatcher;

	static EMPTY(uriIdentityService: IUriIdentityService) { return new FilterOptions('', [], false, false, false, uriIdentityService); }

	constructor(
		readonly filter: string,
		filesExclude: { root: URI, expression: IExpression }[] | IExpression,
		showWarnings: boolean,
		showErrors: boolean,
		showInfos: boolean,
		uriIdentityService: IUriIdentityService
	) {
		filter = filter.trim();
		this.showWarnings = showWarnings;
		this.showErrors = showErrors;
		this.showInfos = showInfos;

		const filesExcludeByRoot = Array.isArray(filesExclude) ? filesExclude : [];
		const excludesExpression: IExpression = Array.isArray(filesExclude) ? getEmptyExpression() : filesExclude;

		for (const { expression } of filesExcludeByRoot) {
			for (const pattern of Object.keys(expression)) {
				if (!pattern.endsWith('/**')) {
					// Append `/**` to pattern to match a parent folder #103631
					expression[`${strings.rtrim(pattern, '/')}/**`] = expression[pattern];
				}
			}
		}

		const negate = filter.startsWith('!');
		this.textFilter = { text: (negate ? strings.ltrim(filter, '!') : filter).trim(), negate };
		const includeExpression: IExpression = getEmptyExpression();

		if (filter) {
			const filters = splitGlobAware(filter, ',').map(s => s.trim()).filter(s => !!s.length);
			for (const f of filters) {
				if (f.startsWith('!')) {
					const filterText = strings.ltrim(f, '!');
					if (filterText) {
						this.setPattern(excludesExpression, filterText);
					}
				} else {
					this.setPattern(includeExpression, f);
				}
			}
		}

		this.excludesMatcher = new ResourceGlobMatcher(excludesExpression, filesExcludeByRoot, uriIdentityService);
		this.includesMatcher = new ResourceGlobMatcher(includeExpression, [], uriIdentityService);
	}

	private setPattern(expression: IExpression, pattern: string) {
		if (pattern[0] === '.') {
			pattern = '*' + pattern; // convert ".js" to "*.js"
		}
		expression[`**/${pattern}/**`] = true;
		expression[`**/${pattern}`] = true;
	}
}
