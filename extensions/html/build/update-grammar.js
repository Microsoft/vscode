/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
// @ts-check
'use strict';

var updateGrammar = require('../../../build/npm/update-grammar');

function patchGrammar(grammar) {
	let patchCount = 0;

	let visit = function (rule, parent) {
		if (rule.name === 'source.js' || rule.name === 'source.css') {
			if (parent.parent && parent.parent.property === 'endCaptures') {
				rule.name = rule.name + '-ignored-vscode';
				patchCount++;
			}
		}
		for (let property in rule) {
			let value = rule[property];
			if (typeof value === 'object') {
				visit(value, { node: rule, property: property, parent: parent });
			}
		}
	};

	let repository = grammar.repository;
	for (let key in repository) {
		visit(repository[key], { node: repository, property: key, parent: undefined });
	}
	if (patchCount !== 6) {
		console.warn(`Expected to patch 6 occurrences of source.js & source.css: Was ${patchCount}`);
	}


	return grammar;
}

const tsGrammarRepo = 'textmate/html.tmbundle';
const grammarPath = 'Syntaxes/HTML.plist';
updateGrammar.update(tsGrammarRepo, grammarPath, './syntaxes/html.tmLanguage.json', grammar => patchGrammar(grammar));


