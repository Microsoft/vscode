/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// FORKED FROM https://github.com/eslint/eslint/blob/b23ad0d789a909baf8d7c41a35bc53df932eaf30/lib/rules/no-unused-expressions.js
// and added support for `OptionalCallExpression`, see https://github.com/facebook/create-react-app/issues/8107 and https://github.com/eslint/eslint/issues/12642

/**
 * @fileoverview Flag expressions in statement position that do not side effect
 * @author Michael Ficarra
 */

'use strict';

//------------------------------------------------------------------------------
// Rule Definition
//------------------------------------------------------------------------------

module.exports = {
	meta: {
		type: 'suggestion',

		docs: {
			description: 'disallow unused expressions',
			category: 'Best Practices',
			recommended: false,
			url: 'https://eslint.org/docs/rules/no-unused-expressions'
		},

		schema: [
			{
				type: 'object',
				properties: {
					allowShortCircuit: {
						type: 'boolean',
						default: false
					},
					allowTernary: {
						type: 'boolean',
						default: false
					},
					allowTaggedTemplates: {
						type: 'boolean',
						default: false
					}
				},
				additionalProperties: false
			}
		]
	},

	create(context) {
		const config = context.options[0] || {},
			allowShortCircuit = config.allowShortCircuit || false,
			allowTernary = config.allowTernary || false,
			allowTaggedTemplates = config.allowTaggedTemplates || false;

		// eslint-disable-next-line jsdoc/require-description
        /**
         * @param {ASTNode} node any node
         * @returns {boolean} whether the given node structurally represents a directive
         */
		function looksLikeDirective(node) {
			return node.type === 'ExpressionStatement' &&
				node.expression.type === 'Literal' && typeof node.expression.value === 'string';
		}

		// eslint-disable-next-line jsdoc/require-description
        /**
         * @param {Function} predicate ([a] -> Boolean) the function used to make the determination
         * @param {a[]} list the input list
         * @returns {a[]} the leading sequence of members in the given list that pass the given predicate
         */
		function takeWhile(predicate, list) {
			for (let i = 0; i < list.length; ++i) {
				if (!predicate(list[i])) {
					return list.slice(0, i);
				}
			}
			return list.slice();
		}

		// eslint-disable-next-line jsdoc/require-description
        /**
         * @param {ASTNode} node a Program or BlockStatement node
         * @returns {ASTNode[]} the leading sequence of directive nodes in the given node's body
         */
		function directives(node) {
			return takeWhile(looksLikeDirective, node.body);
		}

		// eslint-disable-next-line jsdoc/require-description
        /**
         * @param {ASTNode} node any node
         * @param {ASTNode[]} ancestors the given node's ancestors
         * @returns {boolean} whether the given node is considered a directive in its current position
         */
		function isDirective(node, ancestors) {
			const parent = ancestors[ancestors.length - 1],
				grandparent = ancestors[ancestors.length - 2];

			return (parent.type === 'Program' || parent.type === 'BlockStatement' &&
				(/Function/u.test(grandparent.type))) &&
				directives(parent).indexOf(node) >= 0;
		}

        /**
         * Determines whether or not a given node is a valid expression. Recurses on short circuit eval and ternary nodes if enabled by flags.
         * @param {ASTNode} node any node
         * @returns {boolean} whether the given node is a valid expression
         */
		function isValidExpression(node) {
			if (allowTernary) {

				// Recursive check for ternary and logical expressions
				if (node.type === 'ConditionalExpression') {
					return isValidExpression(node.consequent) && isValidExpression(node.alternate);
				}
			}

			if (allowShortCircuit) {
				if (node.type === 'LogicalExpression') {
					return isValidExpression(node.right);
				}
			}

			if (allowTaggedTemplates && node.type === 'TaggedTemplateExpression') {
				return true;
			}

			return /^(?:Assignment|OptionalCall|Call|New|Update|Yield|Await)Expression$/u.test(node.type) ||
				(node.type === 'UnaryExpression' && ['delete', 'void'].indexOf(node.operator) >= 0);
		}

		return {
			ExpressionStatement(node) {
				if (!isValidExpression(node.expression) && !isDirective(node, context.getAncestors())) {
					context.report({ node, message: 'Expected an assignment or function call and instead saw an expression.' });
				}
			}
		};

	}
};
