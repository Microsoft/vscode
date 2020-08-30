/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

const updateGrammar = require('../../../build/npm/update-grammar');

function adaptInjectionScope(grammar) {
	// we're using the HTML grammar from https://github.com/textmate/html.tmbundle which has moved away from source.js.embedded.html
	// also we need to add source.css scope for PHP code in <style> tags, which are handled differently in atom
	const oldInjectionKey = "text.html.php - (meta.embedded | meta.tag), L:((text.html.php meta.tag) - (meta.embedded.block.php | meta.embedded.line.php)), L:(source.js.embedded.html - (meta.embedded.block.php | meta.embedded.line.php))";
	const newInjectionKey = "text.html.php - (meta.embedded | meta.tag), L:((text.html.php meta.tag) - (meta.embedded.block.php | meta.embedded.line.php)), L:(source.js - (meta.embedded.block.php | meta.embedded.line.php)), L:(source.css - (meta.embedded.block.php | meta.embedded.line.php))";

	const injections = grammar.injections;
	const injection = injections[oldInjectionKey];
	if (!injection) {
		throw new Error("Can not find PHP injection to patch");
	}
	delete injections[oldInjectionKey];
	injections[newInjectionKey] = injection;
}

function includeDerivativeHtml(grammar) {
	grammar.patterns.forEach(pattern => {
		if (pattern.include === 'text.html.basic') {
			pattern.include = 'text.html.derivative';
		}
	});
}

// Workaround for https://github.com/Microsoft/vscode/issues/40279
// and https://github.com/Microsoft/vscode-textmate/issues/59
function fixBadRegex(grammar) {
	function fail(msg) {
		throw new Error(`fixBadRegex callback couldn't patch ${msg}. It may be obsolete`);
	}

	const scopeResolution = grammar.repository['scope-resolution'];
	if (scopeResolution) {
		const match = scopeResolution.patterns[0].match;
		if (match === '(?i)([a-z_\\x{7f}-\\x{7fffffff}\\\\][a-z0-9_\\x{7f}-\\x{7fffffff}\\\\]*)(?=\\s*::)') {
			scopeResolution.patterns[0].match = '([A-Za-z_\\x{7f}-\\x{7fffffff}\\\\][A-Za-z0-9_\\x{7f}-\\x{7fffffff}\\\\]*)(?=\\s*::)';
		} else {
			fail('scope-resolution.match');
		}
	} else {
		fail('scope-resolution');
	}

	const functionCall = grammar.repository['function-call'];
	if (functionCall) {
		const begin0 = functionCall.patterns[0].begin;
		if (begin0 === '(?xi)\n(\n  \\\\?(?<![a-z0-9_\\x{7f}-\\x{7fffffff}])                            # Optional root namespace\n  [a-z_\\x{7f}-\\x{7fffffff}][a-z0-9_\\x{7f}-\\x{7fffffff}]*          # First namespace\n  (?:\\\\[a-z_\\x{7f}-\\x{7fffffff}][a-z0-9_\\x{7f}-\\x{7fffffff}]*)+ # Additional namespaces\n)\\s*(\\()') {
			functionCall.patterns[0].begin = '(?x)\n(\n  \\\\?(?<![a-zA-Z0-9_\\x{7f}-\\x{7fffffff}])                            # Optional root namespace\n  [a-zA-Z_\\x{7f}-\\x{7fffffff}][a-zA-Z0-9_\\x{7f}-\\x{7fffffff}]*          # First namespace\n  (?:\\\\[a-zA-Z_\\x{7f}-\\x{7fffffff}][a-zA-Z0-9_\\x{7f}-\\x{7fffffff}]*)+ # Additional namespaces\n)\\s*(\\()';
		} else {
			fail('function-call.begin0');
		}

		const begin1 = functionCall.patterns[1].begin;
		if (begin1 === '(?i)(\\\\)?(?<![a-z0-9_\\x{7f}-\\x{7fffffff}])([a-z_\\x{7f}-\\x{7fffffff}][a-z0-9_\\x{7f}-\\x{7fffffff}]*)\\s*(\\()') {
			functionCall.patterns[1].begin = '(\\\\)?(?<![a-zA-Z0-9_\\x{7f}-\\x{7fffffff}])([a-zA-Z_\\x{7f}-\\x{7fffffff}][a-zA-Z0-9_\\x{7f}-\\x{7fffffff}]*)\\s*(\\()';
		} else {
			fail('function-call.begin1');
		}
	} else {
		fail('function-call');
	}
}

updateGrammar.update('atom/language-php', 'grammars/php.cson', './syntaxes/php.tmLanguage.json', fixBadRegex);
updateGrammar.update('atom/language-php', 'grammars/html.cson', './syntaxes/html.tmLanguage.json', grammar => {
	adaptInjectionScope(grammar);
	includeDerivativeHtml(grammar);
});
