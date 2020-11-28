/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as resources from 'vs/base/common/resources';
import * as assert from 'assert';
import { TestEnvironmentService, TestPathService } from 'vs/workbench/test/browser/workbenchTestServices';
import { URI } from 'vs/base/common/uri';
import { LabelService } from 'vs/workbench/services/label/common/labelService';
import { TestContextService } from 'vs/workbench/test/common/workbenchTestServices';
import { WorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { Workspace } from 'vs/platform/workspace/test/common/testWorkspace';

suite('URI Label', () => {
	let labelService: LabelService;

	setup(() => {
		labelService = new LabelService(TestEnvironmentService, new TestContextService(), new TestPathService());
	});

	test('custom scheme', function () {
		labelService.registerFormatter({
			scheme: 'vscode',
			formatting: {
				label: 'LABEL/${path}/${authority}/END',
				separator: '/',
				tildify: true,
				normalizeDriveLetter: true
			}
		});

		const uri1 = URI.parse('vscode://microsoft.com/1/2/3/4/5');
		assert.equal(labelService.getUriLabel(uri1, { relative: false }), 'LABEL//1/2/3/4/5/microsoft.com/END');
		assert.equal(labelService.getUriBasenameLabel(uri1), 'END');
	});

	test('separator', function () {
		labelService.registerFormatter({
			scheme: 'vscode',
			formatting: {
				label: 'LABEL\\${path}\\${authority}\\END',
				separator: '\\',
				tildify: true,
				normalizeDriveLetter: true
			}
		});

		const uri1 = URI.parse('vscode://microsoft.com/1/2/3/4/5');
		assert.equal(labelService.getUriLabel(uri1, { relative: false }), 'LABEL\\\\1\\2\\3\\4\\5\\microsoft.com\\END');
		assert.equal(labelService.getUriBasenameLabel(uri1), 'END');
	});

	test('custom authority', function () {
		labelService.registerFormatter({
			scheme: 'vscode',
			authority: 'micro*',
			formatting: {
				label: 'LABEL/${path}/${authority}/END',
				separator: '/'
			}
		});

		const uri1 = URI.parse('vscode://microsoft.com/1/2/3/4/5');
		assert.equal(labelService.getUriLabel(uri1, { relative: false }), 'LABEL//1/2/3/4/5/microsoft.com/END');
		assert.equal(labelService.getUriBasenameLabel(uri1), 'END');
	});

	test('mulitple authority', function () {
		labelService.registerFormatter({
			scheme: 'vscode',
			authority: 'not_matching_but_long',
			formatting: {
				label: 'first',
				separator: '/'
			}
		});
		labelService.registerFormatter({
			scheme: 'vscode',
			authority: 'microsof*',
			formatting: {
				label: 'second',
				separator: '/'
			}
		});
		labelService.registerFormatter({
			scheme: 'vscode',
			authority: 'mi*',
			formatting: {
				label: 'third',
				separator: '/'
			}
		});

		// Make sure the most specific authority is picked
		const uri1 = URI.parse('vscode://microsoft.com/1/2/3/4/5');
		assert.equal(labelService.getUriLabel(uri1, { relative: false }), 'second');
		assert.equal(labelService.getUriBasenameLabel(uri1), 'second');
	});

	test('custom query', function () {
		labelService.registerFormatter({
			scheme: 'vscode',
			formatting: {
				label: 'LABEL${query.prefix}: ${query.path}/END',
				separator: '/',
				tildify: true,
				normalizeDriveLetter: true
			}
		});

		const uri1 = URI.parse(`vscode://microsoft.com/1/2/3/4/5?${encodeURIComponent(JSON.stringify({ prefix: 'prefix', path: 'path' }))}`);
		assert.equal(labelService.getUriLabel(uri1, { relative: false }), 'LABELprefix: path/END');
	});

	test('custom query without value', function () {
		labelService.registerFormatter({
			scheme: 'vscode',
			formatting: {
				label: 'LABEL${query.prefix}: ${query.path}/END',
				separator: '/',
				tildify: true,
				normalizeDriveLetter: true
			}
		});

		const uri1 = URI.parse(`vscode://microsoft.com/1/2/3/4/5?${encodeURIComponent(JSON.stringify({ path: 'path' }))}`);
		assert.equal(labelService.getUriLabel(uri1, { relative: false }), 'LABEL: path/END');
	});

	test('custom query without query json', function () {
		labelService.registerFormatter({
			scheme: 'vscode',
			formatting: {
				label: 'LABEL${query.prefix}: ${query.path}/END',
				separator: '/',
				tildify: true,
				normalizeDriveLetter: true
			}
		});

		const uri1 = URI.parse('vscode://microsoft.com/1/2/3/4/5?path=foo');
		assert.equal(labelService.getUriLabel(uri1, { relative: false }), 'LABEL: /END');
	});

	test('custom query without query', function () {
		labelService.registerFormatter({
			scheme: 'vscode',
			formatting: {
				label: 'LABEL${query.prefix}: ${query.path}/END',
				separator: '/',
				tildify: true,
				normalizeDriveLetter: true
			}
		});

		const uri1 = URI.parse('vscode://microsoft.com/1/2/3/4/5');
		assert.equal(labelService.getUriLabel(uri1, { relative: false }), 'LABEL: /END');
	});
});


suite('multi-root worksapce', () => {
	let labelService: LabelService;

	setup(() => {
		const sources = URI.file('folder1/src');
		const tests = URI.file('folder1/test');
		const other = URI.file('folder2');

		labelService = new LabelService(
			TestEnvironmentService,
			new TestContextService(
				new Workspace('test-workspaace', [
					new WorkspaceFolder({ uri: sources, index: 0, name: 'Sources' }, { uri: sources.toString() }),
					new WorkspaceFolder({ uri: tests, index: 1, name: 'Tests' }, { uri: tests.toString() }),
					new WorkspaceFolder({ uri: other, index: 2, name: resources.basename(other) }, { uri: other.toString() }),
				])),
			new TestPathService());
	});

	test('labels of files in multiroot workspaces are the foldername folloed by offset from the folder', () => {
		labelService.registerFormatter({
			scheme: 'file',
			formatting: {
				label: '${authority}${path}',
				separator: '/',
				tildify: false,
				normalizeDriveLetter: false,
				authorityPrefix: '//',
				workspaceSuffix: ''
			}
		});

		const tests = {
			'folder1/src/file': 'Sources • file',
			'folder1/src/folder/file': 'Sources • folder/file',
			'folder1/src': 'Sources',
			'folder1/other': '/folder1/other',
			'folder2/other': 'folder2 • other',
		};

		Object.entries(tests).forEach(([path, label]) => {
			const generated = labelService.getUriLabel(URI.file(path), { relative: true });
			assert.equal(generated, label);
		});
	});

	test('labels with context after path', () => {
		labelService.registerFormatter({
			scheme: 'file',
			formatting: {
				label: '${path} (${scheme})',
				separator: '/',
			}
		});

		const tests = {
			'folder1/src/file': 'Sources • file (file)',
			'folder1/src/folder/file': 'Sources • folder/file (file)',
			'folder1/src': 'Sources',
			'folder1/other': '/folder1/other (file)',
			'folder2/other': 'folder2 • other (file)',
		};

		Object.entries(tests).forEach(([path, label]) => {
			const generated = labelService.getUriLabel(URI.file(path), { relative: true });
			assert.equal(generated, label, path);
		});
	});

	test('stripPathStartingSeparator', () => {
		labelService.registerFormatter({
			scheme: 'file',
			formatting: {
				label: '${path}',
				separator: '/',
				stripPathStartingSeparator: true
			}
		});

		const tests = {
			'folder1/src/file': 'Sources • file',
			'other/blah': 'other/blah',
		};

		Object.entries(tests).forEach(([path, label]) => {
			const generated = labelService.getUriLabel(URI.file(path), { relative: true });
			assert.equal(generated, label, path);
		});
	});
});
