/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { join } from 'path';
import { createImportRuleListener } from './utils';

export = new class NoNlsInStandaloneEditorRule implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		messages: {
			noNls: 'Not allowed to import vs/nls in standalone editor modules. Use standaloneStrings.ts'
		}
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {

		const fileName = context.getFilename();
		if (
			/vs(\/|\\)editor(\/|\\)standalone(\/|\\)/.test(fileName)
			|| /vs(\/|\\)editor(\/|\\)common(\/|\\)standalone(\/|\\)/.test(fileName)
			|| /vs(\/|\\)editor(\/|\\)editor.api/.test(fileName)
			|| /vs(\/|\\)editor(\/|\\)editor.main/.test(fileName)
			|| /vs(\/|\\)editor(\/|\\)editor.worker/.test(fileName)
		) {
			return createImportRuleListener((node, path) => {
				// resolve relative paths
				if (path[0] === '.') {
					path = join(context.getFilename(), path);
				}

				if (
					/vs(\/|\\)nls/.test(path)
				) {
					context.report({
						loc: node.loc,
						messageId: 'noNls'
					});
				}
			});
		}

		return {};
	}
};

