/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { getDomainsOfRemotes, getRemotes } from 'vs/platform/extensionManagement/common/configRemotes';

suite('Config Remotes', () => {

	const allowedDomains = [
		'github.com',
		'github2.com',
		'github3.com',
		'example.com',
		'example2.com',
		'example3.com',
		'server.org',
		'server2.org',
	];

	test('HTTPS remotes', function () {
		assert.deepStrictEqual(getDomainsOfRemotes(remote('https://github.com/Microsoft/vscode.git'), allowedDomains), ['github.com']);
		assert.deepStrictEqual(getDomainsOfRemotes(remote('https://git.example.com/gitproject.git'), allowedDomains), ['example.com']);
		assert.deepStrictEqual(getDomainsOfRemotes(remote('https://username@github2.com/username/repository.git'), allowedDomains), ['github2.com']);
		assert.deepStrictEqual(getDomainsOfRemotes(remote('https://username:password@github3.com/username/repository.git'), allowedDomains), ['github3.com']);
		assert.deepStrictEqual(getDomainsOfRemotes(remote('https://username:password@example2.com:1234/username/repository.git'), allowedDomains), ['example2.com']);
		assert.deepStrictEqual(getDomainsOfRemotes(remote('https://example3.com:1234/username/repository.git'), allowedDomains), ['example3.com']);
	});

	test('SSH remotes', function () {
		assert.deepStrictEqual(getDomainsOfRemotes(remote('ssh://user@git.server.org/project.git'), allowedDomains), ['server.org']);
	});

	test('SCP-like remotes', function () {
		assert.deepStrictEqual(getDomainsOfRemotes(remote('git@github.com:Microsoft/vscode.git'), allowedDomains), ['github.com']);
		assert.deepStrictEqual(getDomainsOfRemotes(remote('user@git.server.org:project.git'), allowedDomains), ['server.org']);
		assert.deepStrictEqual(getDomainsOfRemotes(remote('git.server2.org:project.git'), allowedDomains), ['server2.org']);
	});

	test('Local remotes', function () {
		assert.deepStrictEqual(getDomainsOfRemotes(remote('/opt/git/project.git'), allowedDomains), []);
		assert.deepStrictEqual(getDomainsOfRemotes(remote('file:///opt/git/project.git'), allowedDomains), []);
	});

	test('Multiple remotes', function () {
		const config = ['https://github.com/Microsoft/vscode.git', 'https://git.example.com/gitproject.git'].map(remote).join('');
		assert.deepStrictEqual(getDomainsOfRemotes(config, allowedDomains).sort(), ['example.com', 'github.com']);
	});

	test('Non allowed domains are anonymized', () => {
		const config = ['https://github.com/Microsoft/vscode.git', 'https://git.foobar.com/gitproject.git'].map(remote).join('');
		assert.deepStrictEqual(getDomainsOfRemotes(config, allowedDomains).sort(), ['aaaaaa.aaa', 'github.com']);
	});

	test('HTTPS remotes to be hashed', function () {
		assert.deepStrictEqual(getRemotes(remote('https://github.com/Microsoft/vscode.git')), ['github.com/Microsoft/vscode.git']);
		assert.deepStrictEqual(getRemotes(remote('https://git.example.com/gitproject.git')), ['git.example.com/gitproject.git']);
		assert.deepStrictEqual(getRemotes(remote('https://username@github2.com/username/repository.git')), ['github2.com/username/repository.git']);
		assert.deepStrictEqual(getRemotes(remote('https://username:password@github3.com/username/repository.git')), ['github3.com/username/repository.git']);
		assert.deepStrictEqual(getRemotes(remote('https://username:password@example2.com:1234/username/repository.git')), ['example2.com/username/repository.git']);
		assert.deepStrictEqual(getRemotes(remote('https://example3.com:1234/username/repository.git')), ['example3.com/username/repository.git']);

		// Strip .git
		assert.deepStrictEqual(getRemotes(remote('https://github.com/Microsoft/vscode.git'), true), ['github.com/Microsoft/vscode']);
		assert.deepStrictEqual(getRemotes(remote('https://git.example.com/gitproject.git'), true), ['git.example.com/gitproject']);
		assert.deepStrictEqual(getRemotes(remote('https://username@github2.com/username/repository.git'), true), ['github2.com/username/repository']);
		assert.deepStrictEqual(getRemotes(remote('https://username:password@github3.com/username/repository.git'), true), ['github3.com/username/repository']);
		assert.deepStrictEqual(getRemotes(remote('https://username:password@example2.com:1234/username/repository.git'), true), ['example2.com/username/repository']);
		assert.deepStrictEqual(getRemotes(remote('https://example3.com:1234/username/repository.git'), true), ['example3.com/username/repository']);

		// Compare Striped .git with no .git
		assert.deepStrictEqual(getRemotes(remote('https://github.com/Microsoft/vscode.git'), true), getRemotes(remote('https://github.com/Microsoft/vscode')));
		assert.deepStrictEqual(getRemotes(remote('https://git.example.com/gitproject.git'), true), getRemotes(remote('https://git.example.com/gitproject')));
		assert.deepStrictEqual(getRemotes(remote('https://username@github2.com/username/repository.git'), true), getRemotes(remote('https://username@github2.com/username/repository')));
		assert.deepStrictEqual(getRemotes(remote('https://username:password@github3.com/username/repository.git'), true), getRemotes(remote('https://username:password@github3.com/username/repository')));
		assert.deepStrictEqual(getRemotes(remote('https://username:password@example2.com:1234/username/repository.git'), true), getRemotes(remote('https://username:password@example2.com:1234/username/repository')));
		assert.deepStrictEqual(getRemotes(remote('https://example3.com:1234/username/repository.git'), true), getRemotes(remote('https://example3.com:1234/username/repository')));
	});

	test('SSH remotes to be hashed', function () {
		assert.deepStrictEqual(getRemotes(remote('ssh://user@git.server.org/project.git')), ['git.server.org/project.git']);

		// Strip .git
		assert.deepStrictEqual(getRemotes(remote('ssh://user@git.server.org/project.git'), true), ['git.server.org/project']);

		// Compare Striped .git with no .git
		assert.deepStrictEqual(getRemotes(remote('ssh://user@git.server.org/project.git'), true), getRemotes(remote('ssh://user@git.server.org/project')));
	});

	test('SCP-like remotes to be hashed', function () {
		assert.deepStrictEqual(getRemotes(remote('git@github.com:Microsoft/vscode.git')), ['github.com/Microsoft/vscode.git']);
		assert.deepStrictEqual(getRemotes(remote('user@git.server.org:project.git')), ['git.server.org/project.git']);
		assert.deepStrictEqual(getRemotes(remote('git.server2.org:project.git')), ['git.server2.org/project.git']);

		// Strip .git
		assert.deepStrictEqual(getRemotes(remote('git@github.com:Microsoft/vscode.git'), true), ['github.com/Microsoft/vscode']);
		assert.deepStrictEqual(getRemotes(remote('user@git.server.org:project.git'), true), ['git.server.org/project']);
		assert.deepStrictEqual(getRemotes(remote('git.server2.org:project.git'), true), ['git.server2.org/project']);

		// Compare Striped .git with no .git
		assert.deepStrictEqual(getRemotes(remote('git@github.com:Microsoft/vscode.git'), true), getRemotes(remote('git@github.com:Microsoft/vscode')));
		assert.deepStrictEqual(getRemotes(remote('user@git.server.org:project.git'), true), getRemotes(remote('user@git.server.org:project')));
		assert.deepStrictEqual(getRemotes(remote('git.server2.org:project.git'), true), getRemotes(remote('git.server2.org:project')));
	});

	test('Local remotes to be hashed', function () {
		assert.deepStrictEqual(getRemotes(remote('/opt/git/project.git')), []);
		assert.deepStrictEqual(getRemotes(remote('file:///opt/git/project.git')), []);
	});

	test('Multiple remotes to be hashed', function () {
		const config = ['https://github.com/Microsoft/vscode.git', 'https://git.example.com/gitproject.git'].map(remote).join(' ');
		assert.deepStrictEqual(getRemotes(config), ['github.com/Microsoft/vscode.git', 'git.example.com/gitproject.git']);

		// Strip .git
		assert.deepStrictEqual(getRemotes(config, true), ['github.com/Microsoft/vscode', 'git.example.com/gitproject']);

		// Compare Striped .git with no .git
		const noDotGitConfig = ['https://github.com/Microsoft/vscode', 'https://git.example.com/gitproject'].map(remote).join(' ');
		assert.deepStrictEqual(getRemotes(config, true), getRemotes(noDotGitConfig));
	});

	function remote(url: string): string {
		return `[remote "origin"]
	url = ${url}
	fetch = +refs/heads/*:refs/remotes/origin/*
`;
	}
});
