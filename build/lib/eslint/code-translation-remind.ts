/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { TSESTree } from '@typescript-eslint/experimental-utils';
import { readFileSync } from 'fs';
import { createImportRuleListener } from './utils';


export = new class TranslationRemind implements eslint.Rule.RuleModule {

	private static NLS_MODULE = 'vs/nls';

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			missing: 'Please add \'{{resource}}\' to ./build/lib/i18n.resources.json file to use translations here.'
		}
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		return createImportRuleListener((node, path) => this._checkImport(context, node, path));
	}

	private _checkImport(context: eslint.Rule.RuleContext, node: TSESTree.Node, path: string) {

		if (path !== TranslationRemind.NLS_MODULE) {
			return;
		}

		const currentFile = context.getFilename();
		const matchService = currentFile.match(/vs\/workbench\/services\/\w+/);
		const matchPart = currentFile.match(/vs\/workbench\/contrib\/\w+/);
		if (!matchService && !matchPart) {
			return;
		}

		const resource = matchService ? matchService[0] : matchPart![0];
		let resourceDefined = false;

		let json;
		try {
			json = readFileSync('./build/lib/i18n.resources.json', 'utf8');
		} catch (e) {
			console.error('[translation-remind rule]: File with resources to pull from Transifex was not found. Aborting translation resource check for newly defined workbench part/service.');
			return;
		}
		const workbenchResources = JSON.parse(json).workbench;

		workbenchResources.forEach((existingResource: any) => {
			if (existingResource.name === resource) {
				resourceDefined = true;
				return;
			}
		});

		if (!resourceDefined) {
			context.report({
				loc: node.loc,
				messageId: 'missing',
				data: { resource }
			});
		}
	}
};

