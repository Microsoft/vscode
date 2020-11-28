/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';

import { isURLDomainTrusted } from 'vs/workbench/contrib/url/browser/trustedDomainsValidator';
import { URI } from 'vs/base/common/uri';
import { extractGitHubRemotesFromGitConfig } from 'vs/workbench/contrib/url/browser/trustedDomains';

function linkAllowedByRules(link: string, rules: string[]) {
	assert.ok(isURLDomainTrusted(URI.parse(link), rules), `Link\n${link}\n should be allowed by rules\n${JSON.stringify(rules)}`);
}
function linkNotAllowedByRules(link: string, rules: string[]) {
	assert.ok(!isURLDomainTrusted(URI.parse(link), rules), `Link\n${link}\n should NOT be allowed by rules\n${JSON.stringify(rules)}`);
}

suite('GitHub remote extraction', () => {
	test('All known formats', () => {
		assert.deepEqual(
			extractGitHubRemotesFromGitConfig(
				`
[remote "1"]
			url = git@github.com:sshgit/vscode.git
[remote "2"]
			url = git@github.com:ssh/vscode
[remote "3"]
			url = https://github.com/httpsgit/vscode.git
[remote "4"]
			url = https://github.com/https/vscode`),
			[
				'https://github.com/sshgit/vscode/',
				'https://github.com/ssh/vscode/',
				'https://github.com/httpsgit/vscode/',
				'https://github.com/https/vscode/'
			]);
	});
});

suite('Link protection domain matching', () => {
	test('simple', () => {
		linkNotAllowedByRules('https://x.org', []);

		linkAllowedByRules('https://x.org', ['https://x.org']);
		linkAllowedByRules('https://x.org/foo', ['https://x.org']);

		linkNotAllowedByRules('https://x.org', ['http://x.org']);
		linkNotAllowedByRules('http://x.org', ['https://x.org']);

		linkNotAllowedByRules('https://www.x.org', ['https://x.org']);

		linkAllowedByRules('https://www.x.org', ['https://www.x.org', 'https://y.org']);
	});

	test('localhost', () => {
		linkAllowedByRules('https://127.0.0.1', []);
		linkAllowedByRules('https://127.0.0.1:3000', []);
		linkAllowedByRules('https://localhost', []);
		linkAllowedByRules('https://localhost:3000', []);
	});

	test('* star', () => {
		linkAllowedByRules('https://a.x.org', ['https://*.x.org']);
		linkAllowedByRules('https://a.b.x.org', ['https://*.x.org']);
	});

	test('no scheme', () => {
		linkAllowedByRules('https://a.x.org', ['a.x.org']);
		linkAllowedByRules('https://a.x.org', ['*.x.org']);
		linkAllowedByRules('https://a.b.x.org', ['*.x.org']);
		linkAllowedByRules('https://x.org', ['*.x.org']);
	});

	test('sub paths', () => {
		linkAllowedByRules('https://x.org/foo', ['https://x.org/foo']);
		linkAllowedByRules('https://x.org/foo/bar', ['https://x.org/foo']);

		linkAllowedByRules('https://x.org/foo', ['https://x.org/foo/']);
		linkAllowedByRules('https://x.org/foo/bar', ['https://x.org/foo/']);

		linkAllowedByRules('https://x.org/foo', ['x.org/foo']);
		linkAllowedByRules('https://x.org/foo', ['*.org/foo']);

		linkNotAllowedByRules('https://x.org/bar', ['https://x.org/foo']);
		linkNotAllowedByRules('https://x.org/bar', ['x.org/foo']);
		linkNotAllowedByRules('https://x.org/bar', ['*.org/foo']);

		linkAllowedByRules('https://x.org/foo/bar', ['https://x.org/foo']);
		linkNotAllowedByRules('https://x.org/foo2', ['https://x.org/foo']);

		linkNotAllowedByRules('https://www.x.org/foo', ['https://x.org/foo']);

		linkNotAllowedByRules('https://a.x.org/bar', ['https://*.x.org/foo']);
		linkNotAllowedByRules('https://a.b.x.org/bar', ['https://*.x.org/foo']);

		linkAllowedByRules('https://github.com', ['https://github.com/foo/bar', 'https://github.com']);
	});

	test('ports', () => {
		linkNotAllowedByRules('https://x.org:8080/foo/bar', ['https://x.org:8081/foo']);
		linkAllowedByRules('https://x.org:8080/foo/bar', ['https://x.org:*/foo']);
		linkAllowedByRules('https://x.org/foo/bar', ['https://x.org:*/foo']);
		linkAllowedByRules('https://x.org:8080/foo/bar', ['https://x.org:8080/foo']);
	});

	test('ip addresses', () => {
		linkAllowedByRules('http://192.168.1.7/', ['http://192.168.1.7/']);
		linkAllowedByRules('http://192.168.1.7/', ['http://192.168.1.7']);
		linkAllowedByRules('http://192.168.1.7/', ['http://192.168.1.*']);

		linkNotAllowedByRules('http://192.168.1.7:3000/', ['http://192.168.*.6:*']);
		linkAllowedByRules('http://192.168.1.7:3000/', ['http://192.168.1.7:3000/']);
		linkAllowedByRules('http://192.168.1.7:3000/', ['http://192.168.1.7:*']);
		linkAllowedByRules('http://192.168.1.7:3000/', ['http://192.168.1.*:*']);
		linkNotAllowedByRules('http://192.168.1.7:3000/', ['http://192.168.*.6:*']);
	});

	test('scheme match', () => {
		linkAllowedByRules('http://192.168.1.7/', ['http://*']);
		linkAllowedByRules('http://twitter.com', ['http://*']);
		linkAllowedByRules('http://twitter.com/hello', ['http://*']);
		linkNotAllowedByRules('https://192.168.1.7/', ['http://*']);
		linkNotAllowedByRules('https://twitter.com/', ['http://*']);
	});

	test('case normalization', () => {
		// https://github.com/microsoft/vscode/issues/99294
		linkAllowedByRules('https://github.com/microsoft/vscode/issues/new', ['https://github.com/microsoft']);
		linkAllowedByRules('https://github.com/microsoft/vscode/issues/new', ['https://github.com/microsoft']);
	});
});
