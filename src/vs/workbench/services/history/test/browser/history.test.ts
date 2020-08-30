/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorOptions } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { workbenchInstantiationService, TestFileEditorInput, registerTestEditor } from 'vs/workbench/test/browser/workbenchTestServices';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IEditorGroupsService, GroupDirection } from 'vs/workbench/services/editor/common/editorGroupsService';
import { HistoryService } from 'vs/workbench/services/history/browser/history';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { timeout } from 'vs/base/common/async';

const TEST_EDITOR_ID = 'MyTestEditorForEditorHistory';
const TEST_EDITOR_INPUT_ID = 'testEditorInputForHistoyService';

async function createServices(): Promise<[EditorPart, HistoryService, EditorService]> {
	const instantiationService = workbenchInstantiationService();

	const part = instantiationService.createInstance(EditorPart);
	part.create(document.createElement('div'));
	part.layout(400, 300);

	await part.whenRestored;

	instantiationService.stub(IEditorGroupsService, part);

	const editorService = instantiationService.createInstance(EditorService);
	instantiationService.stub(IEditorService, editorService);

	const historyService = instantiationService.createInstance(HistoryService);
	instantiationService.stub(IHistoryService, historyService);

	return [part, historyService, editorService];
}

suite('HistoryService', function () {

	let disposables: IDisposable[] = [];

	setup(() => {
		disposables.push(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)]));
	});

	teardown(() => {
		dispose(disposables);
		disposables = [];
	});

	test('back / forward', async () => {
		const [part, historyService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		assert.equal(part.activeGroup.activeEditor, input1);

		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		assert.equal(part.activeGroup.activeEditor, input2);

		historyService.back();
		assert.equal(part.activeGroup.activeEditor, input1);

		historyService.forward();
		assert.equal(part.activeGroup.activeEditor, input2);

		part.dispose();
	});

	test('getHistory', async () => {
		const [part, historyService] = await createServices();

		let history = historyService.getHistory();
		assert.equal(history.length, 0);

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));

		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));

		history = historyService.getHistory();
		assert.equal(history.length, 2);

		historyService.remove(input2);
		history = historyService.getHistory();
		assert.equal(history.length, 1);
		assert.equal(history[0], input1);

		part.dispose();
	});

	test('getLastActiveFile', async () => {
		const [part, historyService] = await createServices();

		assert.ok(!historyService.getLastActiveFile('foo'));

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));

		assert.equal(historyService.getLastActiveFile('foo')?.toString(), input1.resource.toString());

		part.dispose();
	});

	test('open next/previous recently used editor (single group)', async () => {
		const [part, historyService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);

		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		assert.equal(part.activeGroup.activeEditor, input1);

		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		assert.equal(part.activeGroup.activeEditor, input2);

		historyService.openPreviouslyUsedEditor();
		assert.equal(part.activeGroup.activeEditor, input1);

		historyService.openNextRecentlyUsedEditor();
		assert.equal(part.activeGroup.activeEditor, input2);

		historyService.openPreviouslyUsedEditor(part.activeGroup.id);
		assert.equal(part.activeGroup.activeEditor, input1);

		historyService.openNextRecentlyUsedEditor(part.activeGroup.id);
		assert.equal(part.activeGroup.activeEditor, input2);

		part.dispose();
	});

	test('open next/previous recently used editor (multi group)', async () => {
		const [part, historyService] = await createServices();
		const rootGroup = part.activeGroup;

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);

		const sideGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await sideGroup.openEditor(input2, EditorOptions.create({ pinned: true }));

		historyService.openPreviouslyUsedEditor();
		assert.equal(part.activeGroup, rootGroup);
		assert.equal(rootGroup.activeEditor, input1);

		historyService.openNextRecentlyUsedEditor();
		assert.equal(part.activeGroup, sideGroup);
		assert.equal(sideGroup.activeEditor, input2);

		part.dispose();
	});

	test('open next/previous recently is reset when other input opens', async () => {
		const [part, historyService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_EDITOR_INPUT_ID);
		const input4 = new TestFileEditorInput(URI.parse('foo://bar4'), TEST_EDITOR_INPUT_ID);

		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await part.activeGroup.openEditor(input3, EditorOptions.create({ pinned: true }));

		historyService.openPreviouslyUsedEditor();
		assert.equal(part.activeGroup.activeEditor, input2);

		await timeout(0);
		await part.activeGroup.openEditor(input4, EditorOptions.create({ pinned: true }));

		historyService.openPreviouslyUsedEditor();
		assert.equal(part.activeGroup.activeEditor, input2);

		historyService.openNextRecentlyUsedEditor();
		assert.equal(part.activeGroup.activeEditor, input4);

		part.dispose();
	});
});


