/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as path from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { flakySuite, getPathFromAmdModule } from 'vs/base/test/node/testUtils';
import { IFileQuery, IFolderQuery, ISerializedSearchProgressItem, isProgressMessage, QueryType } from 'vs/workbench/services/search/common/search';
import { SearchService } from 'vs/workbench/services/search/node/rawSearchService';

const TEST_FIXTURES = path.normalize(getPathFromAmdModule(require, './fixtures'));
const TEST_FIXTURES2 = path.normalize(getPathFromAmdModule(require, './fixtures2'));
const EXAMPLES_FIXTURES = path.join(TEST_FIXTURES, 'examples');
const MORE_FIXTURES = path.join(TEST_FIXTURES, 'more');
const TEST_ROOT_FOLDER: IFolderQuery = { folder: URI.file(TEST_FIXTURES) };
const ROOT_FOLDER_QUERY: IFolderQuery[] = [
	TEST_ROOT_FOLDER
];

const MULTIROOT_QUERIES: IFolderQuery[] = [
	{ folder: URI.file(EXAMPLES_FIXTURES), folderName: 'examples_folder' },
	{ folder: URI.file(MORE_FIXTURES) }
];

async function doSearchTest(query: IFileQuery, expectedResultCount: number | Function): Promise<void> {
	const svc = new SearchService();

	const results: ISerializedSearchProgressItem[] = [];
	await svc.doFileSearch(query, e => {
		if (!isProgressMessage(e)) {
			if (Array.isArray(e)) {
				results.push(...e);
			} else {
				results.push(e);
			}
		}
	});

	assert.strictEqual(results.length, expectedResultCount, `rg ${results.length} !== ${expectedResultCount}`);
}

flakySuite('FileSearch-integration', function () {

	test('File - simple', () => {
		const config: IFileQuery = {
			type: QueryType.File,
			folderQueries: ROOT_FOLDER_QUERY
		};

		return doSearchTest(config, 14);
	});

	test('File - filepattern', () => {
		const config: IFileQuery = {
			type: QueryType.File,
			folderQueries: ROOT_FOLDER_QUERY,
			filePattern: 'anotherfile'
		};

		return doSearchTest(config, 1);
	});

	test('File - exclude', () => {
		const config: IFileQuery = {
			type: QueryType.File,
			folderQueries: ROOT_FOLDER_QUERY,
			filePattern: 'file',
			excludePattern: { '**/anotherfolder/**': true }
		};

		return doSearchTest(config, 2);
	});

	test('File - multiroot', () => {
		const config: IFileQuery = {
			type: QueryType.File,
			folderQueries: MULTIROOT_QUERIES,
			filePattern: 'file',
			excludePattern: { '**/anotherfolder/**': true }
		};

		return doSearchTest(config, 2);
	});

	test('File - multiroot with folder name', () => {
		const config: IFileQuery = {
			type: QueryType.File,
			folderQueries: MULTIROOT_QUERIES,
			filePattern: 'examples_folder anotherfile'
		};

		return doSearchTest(config, 1);
	});

	test('File - multiroot with folder name and sibling exclude', () => {
		const config: IFileQuery = {
			type: QueryType.File,
			folderQueries: [
				{ folder: URI.file(TEST_FIXTURES), folderName: 'folder1' },
				{ folder: URI.file(TEST_FIXTURES2) }
			],
			filePattern: 'folder1 site',
			excludePattern: { '*.css': { when: '$(basename).less' } }
		};

		return doSearchTest(config, 1);
	});
});
