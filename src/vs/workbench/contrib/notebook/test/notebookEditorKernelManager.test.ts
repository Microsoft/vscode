/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { URI } from 'vs/base/common/uri';
import { assertThrowsAsync } from 'vs/base/test/common/utils';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { NotebookEditorKernelManager } from 'vs/workbench/contrib/notebook/browser/notebookEditorKernelManager';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellKind, INotebookKernel, IOutputDto, NotebookCellMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { setupInstantiationService, withTestNotebook as _withTestNotebook } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { Event } from 'vs/base/common/event';
import { INotebookKernelBindEvent, INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { NotebookKernelService } from 'vs/workbench/contrib/notebook/browser/notebookKernelServiceImpl';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { mock } from 'vs/base/test/common/mock';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { DisposableStore } from 'vs/base/common/lifecycle';

suite('NotebookEditorKernelManager', () => {

	let instantiationService: TestInstantiationService;
	let kernelService: INotebookKernelService;
	const dispoables = new DisposableStore();

	setup(function () {

		dispoables.clear();

		instantiationService = setupInstantiationService();

		instantiationService.stub(INotebookService, new class extends mock<INotebookService>() {
			override onDidAddNotebookDocument = Event.None;
			override onDidRemoveNotebookDocument = Event.None;
			override getNotebookTextModels() { return []; }
		});

		kernelService = instantiationService.createInstance(NotebookKernelService);
		instantiationService.set(INotebookKernelService, kernelService);

	});

	async function withTestNotebook(cells: [string, string, CellKind, IOutputDto[], NotebookCellMetadata][], callback: (viewModel: NotebookViewModel, textModel: NotebookTextModel) => void | Promise<void>) {
		return _withTestNotebook(cells, (editor) => callback(editor.viewModel, editor.viewModel.notebookDocument));
	}

	// test('ctor', () => {
	// 	instantiationService.createInstance(NotebookEditorKernelManager, { activeKernel: undefined, viewModel: undefined });
	// 	const contextKeyService = instantiationService.get(IContextKeyService);

	// 	assert.strictEqual(contextKeyService.getContextKeyValue(NOTEBOOK_KERNEL_COUNT.key), 0);
	// });

	test('cell is not runnable when no kernel is selected', async () => {
		await withTestNotebook(
			[],
			async (viewModel) => {
				const kernelManager = instantiationService.createInstance(NotebookEditorKernelManager);

				const cell = viewModel.createCell(1, 'var c = 3', 'javascript', CellKind.Code, {}, [], true);
				await assertThrowsAsync(async () => await kernelManager.executeNotebookCell(cell));
			});
	});

	test('cell is not runnable when kernel does not support the language', async () => {
		await withTestNotebook(
			[],
			async (viewModel) => {

				kernelService.registerKernel(new TestNotebookKernel({ languages: ['testlang'] }));
				const kernelManager = instantiationService.createInstance(NotebookEditorKernelManager);
				const cell = viewModel.createCell(1, 'var c = 3', 'javascript', CellKind.Code, {}, [], true);
				await assertThrowsAsync(async () => await kernelManager.executeNotebookCell(cell));

			});
	});

	test('cell is runnable when kernel does support the language', async () => {
		await withTestNotebook(
			[],
			async (viewModel) => {
				const kernel = new TestNotebookKernel({ languages: ['javascript'] });
				kernelService.registerKernel(kernel);
				const kernelManager = instantiationService.createInstance(NotebookEditorKernelManager);
				const executeSpy = sinon.spy();
				kernel.executeNotebookCellsRequest = executeSpy;

				const cell = viewModel.createCell(0, 'var c = 3', 'javascript', CellKind.Code, {}, [], true);
				await kernelManager.executeNotebookCells(viewModel.notebookDocument, [cell]);
				assert.strictEqual(executeSpy.calledOnce, true);
			});
	});

	test('select kernel when running cell', async function () {
		// https://github.com/microsoft/vscode/issues/121904

		return withTestNotebook([], async viewModel => {
			assert.strictEqual(kernelService.getMatchingKernel(viewModel.notebookDocument).all.length, 0);

			let didExecute = false;
			const kernel = new class extends TestNotebookKernel {
				constructor() {
					super({ languages: ['javascript'] });
					this.id = 'mySpecialId';
				}

				override async executeNotebookCellsRequest() {
					didExecute = true;
					return;
				}
			};

			kernelService.registerKernel(kernel);
			const kernelManager = instantiationService.createInstance(NotebookEditorKernelManager);

			let event: INotebookKernelBindEvent | undefined;
			kernelService.onDidChangeNotebookKernelBinding(e => event = e);

			const cell = viewModel.createCell(0, 'var c = 3', 'javascript', CellKind.Code, {}, [], true);
			await kernelManager.executeNotebookCells(viewModel.notebookDocument, [cell]);

			assert.strictEqual(didExecute, true);
			assert.ok(event !== undefined);
			assert.strictEqual(event.newKernel, kernel.id);
			assert.strictEqual(event.oldKernel, undefined);
		});
	});
});

class TestNotebookKernel implements INotebookKernel {
	id: string = 'test';
	label: string = '';
	viewType = '*';
	onDidChange = Event.None;
	extension: ExtensionIdentifier = new ExtensionIdentifier('test');
	localResourceRoot: URI = URI.file('/test');
	description?: string | undefined;
	detail?: string | undefined;
	preloadUris: URI[] = [];
	preloadProvides: string[] = [];
	supportedLanguages: string[] = [];
	executeNotebookCellsRequest(): Promise<void> {
		throw new Error('Method not implemented.');
	}
	cancelNotebookCellExecution(): Promise<void> {
		throw new Error('Method not implemented.');
	}

	constructor(opts?: { languages: string[] }) {
		this.supportedLanguages = opts?.languages ?? ['text/plain'];
	}
}
