/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { ResourceEditorModel } from 'vs/workbench/common/editor/resourceEditorModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { workbenchInstantiationService, TestServiceAccessor } from 'vs/workbench/test/browser/workbenchTestServices';
import { snapshotToString } from 'vs/workbench/services/textfile/common/textfiles';
import { ModesRegistry, PLAINTEXT_MODE_ID } from 'vs/editor/common/modes/modesRegistry';

suite('Resource text editors', () => {

	let instantiationService: IInstantiationService;
	let accessor: TestServiceAccessor;

	setup(() => {
		instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(TestServiceAccessor);
	});

	test('basics', async () => {
		const resource = URI.from({ scheme: 'inmemory', authority: null!, path: 'thePath' });
		accessor.modelService.createModel('function test() {}', accessor.modeService.create('text'), resource);

		const input: ResourceEditorInput = instantiationService.createInstance(ResourceEditorInput, resource, 'The Name', 'The Description', undefined);

		const model = await input.resolve();

		assert.ok(model);
		assert.equal(snapshotToString(((model as ResourceEditorModel).createSnapshot()!)), 'function test() {}');
	});

	test('custom mode', async () => {
		ModesRegistry.registerLanguage({
			id: 'resource-input-test',
		});

		const resource = URI.from({ scheme: 'inmemory', authority: null!, path: 'thePath' });
		accessor.modelService.createModel('function test() {}', accessor.modeService.create('text'), resource);

		const input: ResourceEditorInput = instantiationService.createInstance(ResourceEditorInput, resource, 'The Name', 'The Description', 'resource-input-test');

		const model = await input.resolve();
		assert.ok(model);
		assert.equal(model.textEditorModel.getModeId(), 'resource-input-test');

		input.setMode('text');
		assert.equal(model.textEditorModel.getModeId(), PLAINTEXT_MODE_ID);
	});
});
