/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { TSESTree } from '@typescript-eslint/experimental-utils';
import { join } from 'path';
import * as minimatch from 'minimatch';
import { createImportRuleListener } from './utils';

interface ImportPatternsConfig {
	target: string;
	restrictions: string | string[];
}

export = new class implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			badImport: 'Imports violates \'{{restrictions}}\' restrictions. See https://github.com/microsoft/vscode/wiki/Source-Code-Organization'
		},
		docs: {
			url: 'https://github.com/microsoft/vscode/wiki/Source-Code-Organization'
		}
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {

		const configs = <ImportPatternsConfig[]>context.options;

		for (const config of configs) {
			if (minimatch(context.getFilename(), config.target)) {
				return createImportRuleListener((node, value) => this._checkImport(context, config, node, value));
			}
		}

		return {};
	}

	private _checkImport(context: eslint.Rule.RuleContext, config: ImportPatternsConfig, node: TSESTree.Node, path: string) {

		// resolve relative paths
		if (path[0] === '.') {
			path = join(context.getFilename(), path);
		}

		let restrictions: string[];
		if (typeof config.restrictions === 'string') {
			restrictions = [config.restrictions];
		} else {
			restrictions = config.restrictions;
		}

		let matched = false;
		for (const pattern of restrictions) {
			if (minimatch(path, pattern)) {
				matched = true;
				break;
			}
		}

		if (!matched) {
			// None of the restrictions matched
			context.report({
				loc: node.loc,
				messageId: 'badImport',
				data: {
					restrictions: restrictions.join(' or ')
				}
			});
		}
	}
};

