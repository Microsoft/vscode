/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as eslint from 'eslint';
import { TSESTree } from '@typescript-eslint/experimental-utils';

export function createImportRuleListener(validateImport: (node: TSESTree.Literal, value: string) => any): eslint.Rule.RuleListener {

	function _checkImport(node: TSESTree.Node | null) {
		if (node && node.type === 'Literal' && typeof node.value === 'string') {
			validateImport(node, node.value);
		}
	}

	return {
		// import ??? from 'module'
		ImportDeclaration: (node: any) => {
			_checkImport((<TSESTree.ImportDeclaration>node).source);
		},
		// import('module').then(...) OR await import('module')
		['CallExpression[callee.type="Import"][arguments.length=1] > Literal']: (node: any) => {
			_checkImport(node);
		},
		// import foo = ...
		['TSImportEqualsDeclaration > TSExternalModuleReference > Literal']: (node: any) => {
			_checkImport(node);
		},
		// export ?? from 'module'
		ExportAllDeclaration: (node: any) => {
			_checkImport((<TSESTree.ExportAllDeclaration>node).source);
		},
		// export {foo} from 'module'
		ExportNamedDeclaration: (node: any) => {
			_checkImport((<TSESTree.ExportNamedDeclaration>node).source);
		},

	};
}
