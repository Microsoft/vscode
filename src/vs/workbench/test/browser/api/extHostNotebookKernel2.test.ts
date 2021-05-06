/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { nullExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { mock } from 'vs/workbench/test/common/workbenchTestServices';
import { INotebookKernelDto2, MainContext, MainThreadCommandsShape, MainThreadNotebookKernelsShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostNotebookKernels } from 'vs/workbench/api/common/extHostNotebookKernels';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';

suite('NotebookKernel', function () {

	let rpcProtocol: TestRPCProtocol;
	let extHostNotebookKernels: ExtHostNotebookKernels;

	const kernelData = new Map<number, INotebookKernelDto2>();

	setup(async function () {

		kernelData.clear();

		rpcProtocol = new TestRPCProtocol();
		rpcProtocol.set(MainContext.MainThreadCommands, new class extends mock<MainThreadCommandsShape>() {
			override $registerCommand() { }
		});
		rpcProtocol.set(MainContext.MainThreadNotebookKernels, new class extends mock<MainThreadNotebookKernelsShape>() {
			override async $addKernel(handle: number, data: INotebookKernelDto2): Promise<void> {
				kernelData.set(handle, data);
			}
			override $removeKernel(handle: number) {
				kernelData.delete(handle);
			}
			override $updateKernel(handle: number, data: Partial<INotebookKernelDto2>) {
				assert.strictEqual(kernelData.has(handle), true);
				kernelData.set(handle, { ...kernelData.get(handle)!, ...data, });
			}
		});

		extHostNotebookKernels = new ExtHostNotebookKernels(
			rpcProtocol,
			new class extends mock<IExtHostInitDataService>() { },
			new class extends mock<ExtHostNotebookController>() { }
		);
	});

	test('create/dispose kernel', async function () {

		const kernel = extHostNotebookKernels.createNotebookController(nullExtensionDescription, 'foo', '*', 'Foo');

		assert.throws(() => (<any>kernel).id = 'dd');
		assert.throws(() => (<any>kernel).viewType = 'dd');

		assert.ok(kernel);
		assert.strictEqual(kernel.id, 'foo');
		assert.strictEqual(kernel.label, 'Foo');
		assert.strictEqual(kernel.viewType, '*');

		await rpcProtocol.sync();
		assert.strictEqual(kernelData.size, 1);

		let [first] = kernelData.values();
		assert.strictEqual(first.id, 'nullExtensionDescription/foo');
		assert.strictEqual(ExtensionIdentifier.equals(first.extensionId, nullExtensionDescription.identifier), true);
		assert.strictEqual(first.label, 'Foo');
		assert.strictEqual(first.viewType, '*');

		kernel.dispose();
		await rpcProtocol.sync();
		assert.strictEqual(kernelData.size, 0);
	});

	test('update kernel', async function () {

		const kernel = extHostNotebookKernels.createNotebookController(nullExtensionDescription, 'foo', '*', 'Foo');

		await rpcProtocol.sync();
		assert.ok(kernel);

		let [first] = kernelData.values();
		assert.strictEqual(first.id, 'nullExtensionDescription/foo');
		assert.strictEqual(first.label, 'Foo');

		kernel.label = 'Far';
		assert.strictEqual(kernel.label, 'Far');

		await rpcProtocol.sync();
		[first] = kernelData.values();
		assert.strictEqual(first.id, 'nullExtensionDescription/foo');
		assert.strictEqual(first.label, 'Far');
	});
});
