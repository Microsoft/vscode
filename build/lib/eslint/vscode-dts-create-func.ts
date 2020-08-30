/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { TSESTree, AST_NODE_TYPES } from '@typescript-eslint/experimental-utils';

export = new class ApiLiteralOrTypes implements eslint.Rule.RuleModule {

	readonly meta: eslint.Rule.RuleMetaData = {
		docs: { url: 'https://github.com/microsoft/vscode/wiki/Extension-API-guidelines#creating-objects' },
		messages: { sync: '`createXYZ`-functions are constructor-replacements and therefore must return sync', }
	};

	create(context: eslint.Rule.RuleContext): eslint.Rule.RuleListener {

		return {
			['TSDeclareFunction Identifier[name=/create.*/]']: (node: any) => {

				const decl = <TSESTree.FunctionDeclaration>(<TSESTree.Identifier>node).parent;

				if (decl.returnType?.typeAnnotation.type !== AST_NODE_TYPES.TSTypeReference) {
					return;
				}
				if (decl.returnType.typeAnnotation.typeName.type !== AST_NODE_TYPES.Identifier) {
					return;
				}

				const ident = decl.returnType.typeAnnotation.typeName.name;
				if (ident === 'Promise' || ident === 'Thenable') {
					context.report({
						node,
						messageId: 'sync'
					});
				}
			}
		};
	}
};
