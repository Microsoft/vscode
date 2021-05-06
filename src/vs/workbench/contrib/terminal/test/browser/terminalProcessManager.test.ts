/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual } from 'assert';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TerminalConfigHelper } from 'vs/workbench/contrib/terminal/browser/terminalConfigHelper';
import { TerminalProcessManager } from 'vs/workbench/contrib/terminal/browser/terminalProcessManager';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { ITestInstantiationService, TestProductService, TestTerminalProfileResolverService, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { IProductService } from 'vs/platform/product/common/productService';
import { IEnvironmentVariableService } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { EnvironmentVariableService } from 'vs/workbench/contrib/terminal/common/environmentVariableService';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { ITerminalProfileResolverService } from 'vs/workbench/contrib/terminal/common/terminal';

suite('Workbench - TerminalProcessManager', () => {
	let instantiationService: ITestInstantiationService;
	let manager: TerminalProcessManager;

	setup(async () => {
		instantiationService = workbenchInstantiationService();
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('editor', { fontFamily: 'foo' });
		await configurationService.setUserConfiguration('terminal', {
			integrated: {
				fontFamily: 'bar',
				enablePersistentSessions: true
			}
		});
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IProductService, TestProductService);
		instantiationService.stub(IEnvironmentVariableService, instantiationService.createInstance(EnvironmentVariableService));
		instantiationService.stub(ITerminalProfileResolverService, TestTerminalProfileResolverService);

		const configHelper = instantiationService.createInstance(TerminalConfigHelper);
		manager = instantiationService.createInstance(TerminalProcessManager, 1, configHelper);
	});

	suite('process persistence', () => {
		suite('local', () => {
			test('regular terminal should persist', async () => {
				const p = await manager.createProcess({
				}, 1, 1, false);
				strictEqual(p, undefined);
				strictEqual(manager.shouldPersist, true);
			});
			test('task terminal should not persist', async () => {
				const p = await manager.createProcess({
					isFeatureTerminal: true
				}, 1, 1, false);
				strictEqual(p, undefined);
				strictEqual(manager.shouldPersist, false);
			});
		});
		suite('remote', () => {
			const remoteCwd = URI.from({
				scheme: Schemas.vscodeRemote,
				path: 'test/cwd'
			});

			test('regular terminal should persist', async () => {
				const p = await manager.createProcess({
					cwd: remoteCwd
				}, 1, 1, false);
				strictEqual(p, undefined);
				strictEqual(manager.shouldPersist, true);
			});
			test('task terminal should not persist', async () => {
				const p = await manager.createProcess({
					isFeatureTerminal: true,
					cwd: remoteCwd
				}, 1, 1, false);
				strictEqual(p, undefined);
				strictEqual(manager.shouldPersist, false);
			});
		});
	});
});
