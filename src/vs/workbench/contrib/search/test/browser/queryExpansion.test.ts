/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { QueryExpansion } from 'vs/workbench/contrib/search/common/queryExpansion';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { TestCommandService } from 'vs/editor/test/browser/editorTestServices';

const DEFAULT_USER_CONFIG = {
	expandableTokens: {
		'@src': ['**/src'],
		'@all': ['@src', '*.foo']
	}
};

suite('QueryExpansion', () => {
	let instantiationService: TestInstantiationService;
	let queryExpansion: QueryExpansion;
	let mockConfigService: TestConfigurationService;
	setup(() => {
		instantiationService = new TestInstantiationService();

		const commandService = new TestCommandService(instantiationService);
		instantiationService.stub(ICommandService, commandService);

		mockConfigService = new TestConfigurationService();
		mockConfigService.setUserConfiguration('search', DEFAULT_USER_CONFIG);
		instantiationService.stub(IConfigurationService, mockConfigService);

		queryExpansion = instantiationService.createInstance(QueryExpansion);
	});

	suite('configuration', () => {
		test('simple expansion into pattern', async () => {
			const actual = await queryExpansion.expandQuerySegments(['@src']);
			assertEqualSegments(actual, ['**/src']);
		});

		test('expansion into pattern from reference to other config token', async () => {
			const actual = await queryExpansion.expandQuerySegments(['@all']);
			assertEqualSegments(actual, ['**/src', '*.foo']);
		});
	});
});

function assertEqualSegments(actual: string[], expected: string[]) {
	const actualNormalized = actual.map(normalizePath);
	const expectedNormalized = expected.map(normalizePath);
	assert.deepStrictEqual(actualNormalized, expectedNormalized);
}

function normalizePath(path: string) {
	return path.replace(/\\/g, '/');
}
