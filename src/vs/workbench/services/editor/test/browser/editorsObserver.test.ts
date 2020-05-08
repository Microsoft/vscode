/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorOptions, IEditorInputFactoryRegistry, Extensions as EditorExtensions } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { workbenchInstantiationService, TestFileEditorInput, registerTestEditor, TestEditorPart } from 'vs/workbench/test/browser/workbenchTestServices';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { GroupDirection } from 'vs/workbench/services/editor/common/editorGroupsService';
import { EditorActivation } from 'vs/platform/editor/common/editor';
import { WillSaveStateReason } from 'vs/platform/storage/common/storage';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { EditorsObserver } from 'vs/workbench/browser/parts/editor/editorsObserver';
import { timeout } from 'vs/base/common/async';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { isWeb } from 'vs/base/common/platform';

const TEST_EDITOR_ID = 'MyTestEditorForEditorsObserver';
const TEST_EDITOR_INPUT_ID = 'testEditorInputForEditorsObserver';
const TEST_SERIALIZABLE_EDITOR_INPUT_ID = 'testSerializableEditorInputForEditorsObserver';

suite('EditorsObserver', function () {

	let disposables: IDisposable[] = [];

	setup(() => {
		disposables.push(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)], TEST_SERIALIZABLE_EDITOR_INPUT_ID));
	});

	teardown(() => {
		dispose(disposables);
		disposables = [];
	});

	async function createPart(): Promise<TestEditorPart> {
		const instantiationService = workbenchInstantiationService();
		instantiationService.invokeFunction(accessor => Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).start(accessor));

		const part = instantiationService.createInstance(TestEditorPart);
		part.create(document.createElement('div'));
		part.layout(400, 300);

		await part.whenRestored;

		return part;
	}

	async function createEditorObserver(): Promise<[EditorPart, EditorsObserver]> {
		const part = await createPart();

		const observer = new EditorsObserver(part, new TestStorageService());

		return [part, observer];
	}

	test('basics (single group)', async () => {
		const [part, observer] = await createEditorObserver();

		let onDidMostRecentlyActiveEditorsChangeCalled = false;
		const listener = observer.onDidMostRecentlyActiveEditorsChange(() => {
			onDidMostRecentlyActiveEditorsChangeCalled = true;
		});

		let currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 0);
		assert.equal(onDidMostRecentlyActiveEditorsChangeCalled, false);

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 1);
		assert.equal(currentEditorsMRU[0].groupId, part.activeGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input1);
		assert.equal(onDidMostRecentlyActiveEditorsChangeCalled, true);
		assert.equal(observer.hasEditor(input1.resource), true);

		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await part.activeGroup.openEditor(input3, EditorOptions.create({ pinned: true }));

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 3);
		assert.equal(currentEditorsMRU[0].groupId, part.activeGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input3);
		assert.equal(currentEditorsMRU[1].groupId, part.activeGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input2);
		assert.equal(currentEditorsMRU[2].groupId, part.activeGroup.id);
		assert.equal(currentEditorsMRU[2].editor, input1);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);

		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 3);
		assert.equal(currentEditorsMRU[0].groupId, part.activeGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input2);
		assert.equal(currentEditorsMRU[1].groupId, part.activeGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input3);
		assert.equal(currentEditorsMRU[2].groupId, part.activeGroup.id);
		assert.equal(currentEditorsMRU[2].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);

		onDidMostRecentlyActiveEditorsChangeCalled = false;
		await part.activeGroup.closeEditor(input1);

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 2);
		assert.equal(currentEditorsMRU[0].groupId, part.activeGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input2);
		assert.equal(currentEditorsMRU[1].groupId, part.activeGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input3);
		assert.equal(onDidMostRecentlyActiveEditorsChangeCalled, true);
		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);

		await part.activeGroup.closeAllEditors();
		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 0);
		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), false);
		assert.equal(observer.hasEditor(input3.resource), false);

		part.dispose();
		listener.dispose();
	});

	test('basics (multi group)', async () => {
		const [part, observer] = await createEditorObserver();

		const rootGroup = part.activeGroup;

		let currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 0);

		const sideGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true, activation: EditorActivation.ACTIVATE }));
		await sideGroup.openEditor(input1, EditorOptions.create({ pinned: true, activation: EditorActivation.ACTIVATE }));

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 2);
		assert.equal(currentEditorsMRU[0].groupId, sideGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input1);
		assert.equal(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true, activation: EditorActivation.ACTIVATE }));

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 2);
		assert.equal(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input1);
		assert.equal(currentEditorsMRU[1].groupId, sideGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);

		// Opening an editor inactive should not change
		// the most recent editor, but rather put it behind
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input2, EditorOptions.create({ inactive: true }));

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 3);
		assert.equal(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input1);
		assert.equal(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input2);
		assert.equal(currentEditorsMRU[2].groupId, sideGroup.id);
		assert.equal(currentEditorsMRU[2].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), true);

		await rootGroup.closeAllEditors();

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 1);
		assert.equal(currentEditorsMRU[0].groupId, sideGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), false);

		await sideGroup.closeAllEditors();

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 0);
		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), false);

		part.dispose();
	});

	test('copy group', async function () {
		if (isWeb) {
			this.skip();
		}
		const [part, observer] = await createEditorObserver();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		const rootGroup = part.activeGroup;

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input3, EditorOptions.create({ pinned: true }));

		let currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 3);
		assert.equal(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input3);
		assert.equal(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input2);
		assert.equal(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[2].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);

		const copiedGroup = part.copyGroup(rootGroup, rootGroup, GroupDirection.RIGHT);
		copiedGroup.setActive(true);

		currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 6);
		assert.equal(currentEditorsMRU[0].groupId, copiedGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input3);
		assert.equal(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input3);
		assert.equal(currentEditorsMRU[2].groupId, copiedGroup.id);
		assert.equal(currentEditorsMRU[2].editor, input2);
		assert.equal(currentEditorsMRU[3].groupId, copiedGroup.id);
		assert.equal(currentEditorsMRU[3].editor, input1);
		assert.equal(currentEditorsMRU[4].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[4].editor, input2);
		assert.equal(currentEditorsMRU[5].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[5].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);

		await rootGroup.closeAllEditors();

		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);

		await copiedGroup.closeAllEditors();

		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), false);
		assert.equal(observer.hasEditor(input3.resource), false);

		part.dispose();
	});

	test('initial editors are part of observer and state is persisted & restored (single group)', async () => {
		const part = await createPart();

		const rootGroup = part.activeGroup;

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input3, EditorOptions.create({ pinned: true }));

		const storage = new TestStorageService();
		const observer = new EditorsObserver(part, storage);
		await part.whenRestored;

		let currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 3);
		assert.equal(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input3);
		assert.equal(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input2);
		assert.equal(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[2].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);

		storage._onWillSaveState.fire({ reason: WillSaveStateReason.SHUTDOWN });

		const restoredObserver = new EditorsObserver(part, storage);
		await part.whenRestored;

		currentEditorsMRU = restoredObserver.editors;
		assert.equal(currentEditorsMRU.length, 3);
		assert.equal(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input3);
		assert.equal(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input2);
		assert.equal(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[2].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);

		part.clearState();
		part.dispose();
	});

	test('initial editors are part of observer (multi group)', async () => {
		const part = await createPart();

		const rootGroup = part.activeGroup;

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input2, EditorOptions.create({ pinned: true }));

		const sideGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);
		await sideGroup.openEditor(input3, EditorOptions.create({ pinned: true }));

		const storage = new TestStorageService();
		const observer = new EditorsObserver(part, storage);
		await part.whenRestored;

		let currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 3);
		assert.equal(currentEditorsMRU[0].groupId, sideGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input3);
		assert.equal(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input2);
		assert.equal(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[2].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);

		storage._onWillSaveState.fire({ reason: WillSaveStateReason.SHUTDOWN });

		const restoredObserver = new EditorsObserver(part, storage);
		await part.whenRestored;

		currentEditorsMRU = restoredObserver.editors;
		assert.equal(currentEditorsMRU.length, 3);
		assert.equal(currentEditorsMRU[0].groupId, sideGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input3);
		assert.equal(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[1].editor, input2);
		assert.equal(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[2].editor, input1);
		assert.equal(restoredObserver.hasEditor(input1.resource), true);
		assert.equal(restoredObserver.hasEditor(input2.resource), true);
		assert.equal(restoredObserver.hasEditor(input3.resource), true);

		part.clearState();
		part.dispose();
	});

	test('observer does not restore editors that cannot be serialized', async () => {
		const part = await createPart();

		const rootGroup = part.activeGroup;

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));

		const storage = new TestStorageService();
		const observer = new EditorsObserver(part, storage);
		await part.whenRestored;

		let currentEditorsMRU = observer.editors;
		assert.equal(currentEditorsMRU.length, 1);
		assert.equal(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.equal(currentEditorsMRU[0].editor, input1);
		assert.equal(observer.hasEditor(input1.resource), true);

		storage._onWillSaveState.fire({ reason: WillSaveStateReason.SHUTDOWN });

		const restoredObserver = new EditorsObserver(part, storage);
		await part.whenRestored;

		currentEditorsMRU = restoredObserver.editors;
		assert.equal(currentEditorsMRU.length, 0);
		assert.equal(restoredObserver.hasEditor(input1.resource), false);

		part.clearState();
		part.dispose();
	});

	test('observer closes editors when limit reached (across all groups)', async () => {
		const part = await createPart();
		part.enforcePartOptions({ limit: { enabled: true, value: 3 } });

		const storage = new TestStorageService();
		const observer = new EditorsObserver(part, storage);

		const rootGroup = part.activeGroup;
		const sideGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_EDITOR_INPUT_ID);
		const input4 = new TestFileEditorInput(URI.parse('foo://bar4'), TEST_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input3, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input4, EditorOptions.create({ pinned: true }));

		assert.equal(rootGroup.count, 3);
		assert.equal(rootGroup.isOpened(input1), false);
		assert.equal(rootGroup.isOpened(input2), true);
		assert.equal(rootGroup.isOpened(input3), true);
		assert.equal(rootGroup.isOpened(input4), true);
		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);
		assert.equal(observer.hasEditor(input4.resource), true);

		input2.setDirty();
		part.enforcePartOptions({ limit: { enabled: true, value: 1 } });

		await timeout(0);

		assert.equal(rootGroup.count, 2);
		assert.equal(rootGroup.isOpened(input1), false);
		assert.equal(rootGroup.isOpened(input2), true); // dirty
		assert.equal(rootGroup.isOpened(input3), false);
		assert.equal(rootGroup.isOpened(input4), true);
		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), false);
		assert.equal(observer.hasEditor(input4.resource), true);

		const input5 = new TestFileEditorInput(URI.parse('foo://bar5'), TEST_EDITOR_INPUT_ID);
		await sideGroup.openEditor(input5, EditorOptions.create({ pinned: true }));

		assert.equal(rootGroup.count, 1);
		assert.equal(rootGroup.isOpened(input1), false);
		assert.equal(rootGroup.isOpened(input2), true); // dirty
		assert.equal(rootGroup.isOpened(input3), false);
		assert.equal(rootGroup.isOpened(input4), false);
		assert.equal(sideGroup.isOpened(input5), true);
		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), false);
		assert.equal(observer.hasEditor(input4.resource), false);
		assert.equal(observer.hasEditor(input5.resource), true);

		observer.dispose();
		part.dispose();
	});

	test('observer closes editors when limit reached (in group)', async () => {
		const part = await createPart();
		part.enforcePartOptions({ limit: { enabled: true, value: 3, perEditorGroup: true } });

		const storage = new TestStorageService();
		const observer = new EditorsObserver(part, storage);

		const rootGroup = part.activeGroup;
		const sideGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_EDITOR_INPUT_ID);
		const input4 = new TestFileEditorInput(URI.parse('foo://bar4'), TEST_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input3, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input4, EditorOptions.create({ pinned: true }));

		assert.equal(rootGroup.count, 3); // 1 editor got closed due to our limit!
		assert.equal(rootGroup.isOpened(input1), false);
		assert.equal(rootGroup.isOpened(input2), true);
		assert.equal(rootGroup.isOpened(input3), true);
		assert.equal(rootGroup.isOpened(input4), true);
		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);
		assert.equal(observer.hasEditor(input4.resource), true);

		await sideGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await sideGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await sideGroup.openEditor(input3, EditorOptions.create({ pinned: true }));
		await sideGroup.openEditor(input4, EditorOptions.create({ pinned: true }));

		assert.equal(sideGroup.count, 3);
		assert.equal(sideGroup.isOpened(input1), false);
		assert.equal(sideGroup.isOpened(input2), true);
		assert.equal(sideGroup.isOpened(input3), true);
		assert.equal(sideGroup.isOpened(input4), true);
		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), true);
		assert.equal(observer.hasEditor(input3.resource), true);
		assert.equal(observer.hasEditor(input4.resource), true);

		part.enforcePartOptions({ limit: { enabled: true, value: 1, perEditorGroup: true } });

		await timeout(10);

		assert.equal(rootGroup.count, 1);
		assert.equal(rootGroup.isOpened(input1), false);
		assert.equal(rootGroup.isOpened(input2), false);
		assert.equal(rootGroup.isOpened(input3), false);
		assert.equal(rootGroup.isOpened(input4), true);

		assert.equal(sideGroup.count, 1);
		assert.equal(sideGroup.isOpened(input1), false);
		assert.equal(sideGroup.isOpened(input2), false);
		assert.equal(sideGroup.isOpened(input3), false);
		assert.equal(sideGroup.isOpened(input4), true);

		assert.equal(observer.hasEditor(input1.resource), false);
		assert.equal(observer.hasEditor(input2.resource), false);
		assert.equal(observer.hasEditor(input3.resource), false);
		assert.equal(observer.hasEditor(input4.resource), true);

		observer.dispose();
		part.dispose();
	});

	test('observer does not close sticky', async () => {
		const part = await createPart();
		part.enforcePartOptions({ limit: { enabled: true, value: 3 } });

		const storage = new TestStorageService();
		const observer = new EditorsObserver(part, storage);

		const rootGroup = part.activeGroup;

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_EDITOR_INPUT_ID);
		const input4 = new TestFileEditorInput(URI.parse('foo://bar4'), TEST_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true, sticky: true }));
		await rootGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input3, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input4, EditorOptions.create({ pinned: true }));

		assert.equal(rootGroup.count, 3);
		assert.equal(rootGroup.isOpened(input1), true);
		assert.equal(rootGroup.isOpened(input2), false);
		assert.equal(rootGroup.isOpened(input3), true);
		assert.equal(rootGroup.isOpened(input4), true);
		assert.equal(observer.hasEditor(input1.resource), true);
		assert.equal(observer.hasEditor(input2.resource), false);
		assert.equal(observer.hasEditor(input3.resource), true);
		assert.equal(observer.hasEditor(input4.resource), true);

		observer.dispose();
		part.dispose();
	});
});
