/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';

export = new class ApiLiteralOrTypes implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		docs: { url: 'https://github.com/microsoft/vscode/wiki/Extension-API-guidelines#enums' },
		messages: { useEnum: 'Use enums, not literal-or-types', }
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {
		return {
			['TSTypeAnnotation TSUnionType TSLiteralType']: (node: any) => {
				if (node.literal?.type === 'TSNullKeyword') {
					return;
				}
				context.report({
					node: node,
					messageId: 'useEnum'
				});
			}
		};
	}
};
