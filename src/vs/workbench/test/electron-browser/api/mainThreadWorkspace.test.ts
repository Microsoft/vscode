/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { workbenchInstantiationService } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ISearchService, IFileQuery } from 'vs/workbench/services/search/common/search';
import { MainThreadWorkspace } from 'vs/workbench/api/browser/mainThreadWorkspace';
import * as assert from 'assert';
import { SingleProxyRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';

suite('MainThreadWorkspace', () => {

	let configService: TestConfigurationService;
	let instantiationService: TestInstantiationService;

	setup(() => {
		instantiationService = workbenchInstantiationService() as TestInstantiationService;

		configService = instantiationService.get(IConfigurationService) as TestConfigurationService;
		configService.setUserConfiguration('search', {});
	});

	test('simple', () => {
		instantiationService.stub(ISearchService, {
			fileSearch(query: IFileQuery) {
				assert.strictEqual(query.folderQueries.length, 1);
				assert.strictEqual(query.folderQueries[0].disregardIgnoreFiles, true);

				assert.deepStrictEqual({ ...query.includePattern }, { 'foo': true });
				assert.strictEqual(query.maxResults, 10);

				return Promise.resolve({ results: [], messages: [] });
			}
		});

		const mtw: MainThreadWorkspace = instantiationService.createInstance(<any>MainThreadWorkspace, SingleProxyRPCProtocol({ $initializeWorkspace: () => { } }));
		return mtw.$startFileSearch('foo', null, null, 10, new CancellationTokenSource().token);
	});

	test('exclude defaults', () => {
		configService.setUserConfiguration('search', {
			'exclude': { 'searchExclude': true }
		});
		configService.setUserConfiguration('files', {
			'exclude': { 'filesExclude': true }
		});

		instantiationService.stub(ISearchService, {
			fileSearch(query: IFileQuery) {
				assert.strictEqual(query.folderQueries.length, 1);
				assert.strictEqual(query.folderQueries[0].disregardIgnoreFiles, true);
				assert.deepStrictEqual(query.folderQueries[0].excludePattern, { 'filesExclude': true });

				return Promise.resolve({ results: [], messages: [] });
			}
		});

		const mtw: MainThreadWorkspace = instantiationService.createInstance(<any>MainThreadWorkspace, SingleProxyRPCProtocol({ $initializeWorkspace: () => { } }));
		return mtw.$startFileSearch('', null, null, 10, new CancellationTokenSource().token);
	});

	test('disregard excludes', () => {
		configService.setUserConfiguration('search', {
			'exclude': { 'searchExclude': true }
		});
		configService.setUserConfiguration('files', {
			'exclude': { 'filesExclude': true }
		});

		instantiationService.stub(ISearchService, {
			fileSearch(query: IFileQuery) {
				assert.strictEqual(query.folderQueries[0].excludePattern, undefined);
				assert.deepStrictEqual(query.excludePattern, undefined);

				return Promise.resolve({ results: [], messages: [] });
			}
		});

		const mtw: MainThreadWorkspace = instantiationService.createInstance(<any>MainThreadWorkspace, SingleProxyRPCProtocol({ $initializeWorkspace: () => { } }));
		return mtw.$startFileSearch('', null, false, 10, new CancellationTokenSource().token);
	});

	test('exclude string', () => {
		instantiationService.stub(ISearchService, {
			fileSearch(query: IFileQuery) {
				assert.strictEqual(query.folderQueries[0].excludePattern, undefined);
				assert.deepStrictEqual({ ...query.excludePattern }, { 'exclude/**': true });

				return Promise.resolve({ results: [], messages: [] });
			}
		});

		const mtw: MainThreadWorkspace = instantiationService.createInstance(<any>MainThreadWorkspace, SingleProxyRPCProtocol({ $initializeWorkspace: () => { } }));
		return mtw.$startFileSearch('', null, 'exclude/**', 10, new CancellationTokenSource().token);
	});
});
