/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

var updateGrammar = require('../../../build/npm/update-grammar');

function adaptJSON(grammar, replacementScope) {
	grammar.name = 'JSON with comments';
	grammar.scopeName = `source${replacementScope}`;

	var fixScopeNames = function(rule) {
		if (typeof rule.name === 'string') {
			rule.name = rule.name.replace(/\.json/g, replacementScope);
		}
		if (typeof rule.contentName === 'string') {
			rule.contentName = rule.contentName.replace(/\.json/g, replacementScope);
		}
		for (var property in rule) {
			var value = rule[property];
			if (typeof value === 'object') {
				fixScopeNames(value);
			}
		}
	};

	var repository = grammar.repository;
	for (var key in repository) {
		fixScopeNames(repository[key]);
	}
}

var tsGrammarRepo = 'Microsoft/vscode-JSON.tmLanguage';
updateGrammar.update(tsGrammarRepo, 'JSON.tmLanguage', './syntaxes/JSON.tmLanguage.json');
updateGrammar.update(tsGrammarRepo, 'JSON.tmLanguage', './syntaxes/JSONC.tmLanguage.json', grammar => adaptJSON(grammar, '.json.comments'));





