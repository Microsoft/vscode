/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorOptions } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { workbenchInstantiationService, TestFileEditorInput, registerTestEditor, createEditorPart } from 'vs/workbench/test/browser/workbenchTestServices';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IEditorGroupsService, GroupDirection } from 'vs/workbench/services/editor/common/editorGroupsService';
import { HistoryService } from 'vs/workbench/services/history/browser/history';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { timeout } from 'vs/base/common/async';
import { Event } from 'vs/base/common/event';

suite('HistoryService', function () {

	const TEST_EDITOR_ID = 'MyTestEditorForEditorHistory';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForHistoyService';

	async function createServices(): Promise<[EditorPart, HistoryService, EditorService]> {
		const instantiationService = workbenchInstantiationService();

		const part = await createEditorPart(instantiationService, disposables);

		instantiationService.stub(IEditorGroupsService, part);

		const editorService = instantiationService.createInstance(EditorService);
		instantiationService.stub(IEditorService, editorService);

		const historyService = instantiationService.createInstance(HistoryService);
		instantiationService.stub(IHistoryService, historyService);

		return [part, historyService, editorService];
	}

	const disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)]));
	});

	teardown(() => {
		disposables.clear();
	});

	test('back / forward', async () => {
		const [part, historyService, editorService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		let editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.back();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.forward();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);
	});

	test('getHistory', async () => {
		const [part, historyService] = await createServices();

		let history = historyService.getHistory();
		assert.strictEqual(history.length, 0);

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));

		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));

		history = historyService.getHistory();
		assert.strictEqual(history.length, 2);

		historyService.removeFromHistory(input2);
		history = historyService.getHistory();
		assert.strictEqual(history.length, 1);
		assert.strictEqual(history[0], input1);
	});

	test('getLastActiveFile', async () => {
		const [part, historyService] = await createServices();

		assert.ok(!historyService.getLastActiveFile('foo'));

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));

		assert.strictEqual(historyService.getLastActiveFile('foo')?.toString(), input1.resource.toString());
	});

	test('open next/previous recently used editor (single group)', async () => {
		const [part, historyService, editorService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);

		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		let editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openNextRecentlyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor(part.activeGroup.id);
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input1);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openNextRecentlyUsedEditor(part.activeGroup.id);
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);
	});

	test('open next/previous recently used editor (multi group)', async () => {
		const [part, historyService, editorService] = await createServices();
		const rootGroup = part.activeGroup;

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);

		const sideGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await sideGroup.openEditor(input2, EditorOptions.create({ pinned: true }));

		let editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup, rootGroup);
		assert.strictEqual(rootGroup.activeEditor, input1);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openNextRecentlyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup, sideGroup);
		assert.strictEqual(sideGroup.activeEditor, input2);
	});

	test('open next/previous recently is reset when other input opens', async () => {
		const [part, historyService, editorService] = await createServices();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_EDITOR_INPUT_ID);
		const input4 = new TestFileEditorInput(URI.parse('foo://bar4'), TEST_EDITOR_INPUT_ID);

		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await part.activeGroup.openEditor(input3, EditorOptions.create({ pinned: true }));

		let editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		await timeout(0);
		await part.activeGroup.openEditor(input4, EditorOptions.create({ pinned: true }));

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openPreviouslyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input2);

		editorChangePromise = Event.toPromise(editorService.onDidActiveEditorChange);
		historyService.openNextRecentlyUsedEditor();
		await editorChangePromise;
		assert.strictEqual(part.activeGroup.activeEditor, input4);
	});
});
