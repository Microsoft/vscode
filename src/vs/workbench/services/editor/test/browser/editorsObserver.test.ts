/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorOptions, IEditorInputFactoryRegistry, EditorExtensions, SideBySideEditorInput } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { workbenchInstantiationService, TestFileEditorInput, registerTestEditor, TestEditorPart, createEditorPart, registerTestSideBySideEditor } from 'vs/workbench/test/browser/workbenchTestServices';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { GroupDirection } from 'vs/workbench/services/editor/common/editorGroupsService';
import { EditorActivation } from 'vs/platform/editor/common/editor';
import { WillSaveStateReason } from 'vs/platform/storage/common/storage';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { EditorsObserver } from 'vs/workbench/browser/parts/editor/editorsObserver';
import { timeout } from 'vs/base/common/async';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';

suite('EditorsObserver', function () {

	const TEST_EDITOR_ID = 'MyTestEditorForEditorsObserver';
	const TEST_EDITOR_INPUT_ID = 'testEditorInputForEditorsObserver';
	const TEST_SERIALIZABLE_EDITOR_INPUT_ID = 'testSerializableEditorInputForEditorsObserver';

	const disposables = new DisposableStore();

	setup(() => {
		disposables.add(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)], TEST_SERIALIZABLE_EDITOR_INPUT_ID));
		disposables.add(registerTestSideBySideEditor());
	});

	teardown(() => {
		disposables.clear();
	});

	async function createPart(): Promise<TestEditorPart> {
		const instantiationService = workbenchInstantiationService();
		instantiationService.invokeFunction(accessor => Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).start(accessor));

		const part = await createEditorPart(instantiationService, disposables);
		disposables.add(toDisposable(() => part.clearState()));

		return part;
	}

	async function createEditorObserver(): Promise<[EditorPart, EditorsObserver]> {
		const part = await createPart();

		const observer = disposables.add(new EditorsObserver(part, new TestStorageService()));

		return [part, observer];
	}

	test('basics (single group)', async () => {
		const [part, observer] = await createEditorObserver();

		let onDidMostRecentlyActiveEditorsChangeCalled = false;
		const listener = observer.onDidMostRecentlyActiveEditorsChange(() => {
			onDidMostRecentlyActiveEditorsChangeCalled = true;
		});

		let currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 0);
		assert.strictEqual(onDidMostRecentlyActiveEditorsChangeCalled, false);

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 1);
		assert.strictEqual(currentEditorsMRU[0].groupId, part.activeGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input1);
		assert.strictEqual(onDidMostRecentlyActiveEditorsChangeCalled, true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditors(input1.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: 'unknownTypeId' }), false);

		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		assert.strictEqual(observer.hasEditors(input2.resource), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);

		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await part.activeGroup.openEditor(input3, EditorOptions.create({ pinned: true }));

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 3);
		assert.strictEqual(currentEditorsMRU[0].groupId, part.activeGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input3);
		assert.strictEqual(currentEditorsMRU[1].groupId, part.activeGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input2);
		assert.strictEqual(currentEditorsMRU[2].groupId, part.activeGroup.id);
		assert.strictEqual(currentEditorsMRU[2].editor, input1);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);

		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 3);
		assert.strictEqual(currentEditorsMRU[0].groupId, part.activeGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input2);
		assert.strictEqual(currentEditorsMRU[1].groupId, part.activeGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input3);
		assert.strictEqual(currentEditorsMRU[2].groupId, part.activeGroup.id);
		assert.strictEqual(currentEditorsMRU[2].editor, input1);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);

		onDidMostRecentlyActiveEditorsChangeCalled = false;
		await part.activeGroup.closeEditor(input1);

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 2);
		assert.strictEqual(currentEditorsMRU[0].groupId, part.activeGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input2);
		assert.strictEqual(currentEditorsMRU[1].groupId, part.activeGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input3);
		assert.strictEqual(onDidMostRecentlyActiveEditorsChangeCalled, true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);

		await part.activeGroup.closeAllEditors();
		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 0);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), false);

		listener.dispose();
	});

	test('basics (multi group)', async () => {
		const [part, observer] = await createEditorObserver();

		const rootGroup = part.activeGroup;

		let currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 0);

		const sideGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true, activation: EditorActivation.ACTIVATE }));
		await sideGroup.openEditor(input1, EditorOptions.create({ pinned: true, activation: EditorActivation.ACTIVATE }));

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 2);
		assert.strictEqual(currentEditorsMRU[0].groupId, sideGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input1);
		assert.strictEqual(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input1);
		assert.strictEqual(observer.hasEditors(input1.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true, activation: EditorActivation.ACTIVATE }));

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 2);
		assert.strictEqual(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input1);
		assert.strictEqual(currentEditorsMRU[1].groupId, sideGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input1);
		assert.strictEqual(observer.hasEditors(input1.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);

		// Opening an editor inactive should not change
		// the most recent editor, but rather put it behind
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input2, EditorOptions.create({ inactive: true }));

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 3);
		assert.strictEqual(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input1);
		assert.strictEqual(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input2);
		assert.strictEqual(currentEditorsMRU[2].groupId, sideGroup.id);
		assert.strictEqual(currentEditorsMRU[2].editor, input1);
		assert.strictEqual(observer.hasEditors(input1.resource), true);
		assert.strictEqual(observer.hasEditors(input2.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);

		await rootGroup.closeAllEditors();

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 1);
		assert.strictEqual(currentEditorsMRU[0].groupId, sideGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input1);
		assert.strictEqual(observer.hasEditors(input1.resource), true);
		assert.strictEqual(observer.hasEditors(input2.resource), false);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);

		await sideGroup.closeAllEditors();

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 0);
		assert.strictEqual(observer.hasEditors(input1.resource), false);
		assert.strictEqual(observer.hasEditors(input2.resource), false);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);
	});

	test('hasEditor/hasEditors - same resource, different type id', async () => {
		const [part, observer] = await createEditorObserver();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(input1.resource, 'otherTypeId');

		assert.strictEqual(observer.hasEditors(input1.resource), false);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);

		await part.activeGroup.openEditor(input1, EditorOptions.create({ pinned: true }));

		assert.strictEqual(observer.hasEditors(input1.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);

		await part.activeGroup.openEditor(input2, EditorOptions.create({ pinned: true }));

		assert.strictEqual(observer.hasEditors(input1.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);

		await part.activeGroup.closeEditor(input2);

		assert.strictEqual(observer.hasEditors(input1.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);

		await part.activeGroup.closeEditor(input1);

		assert.strictEqual(observer.hasEditors(input1.resource), false);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);
	});

	test('hasEditor/hasEditors - side by side editor support', async () => {
		const [part, observer] = await createEditorObserver();

		const primary = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const secondary = new TestFileEditorInput(URI.parse('foo://bar2'), 'otherTypeId');

		const input = new SideBySideEditorInput('name', undefined, secondary, primary);

		assert.strictEqual(observer.hasEditors(primary.resource), false);
		assert.strictEqual(observer.hasEditor({ resource: primary.resource, typeId: primary.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: secondary.resource, typeId: secondary.typeId }), false);

		await part.activeGroup.openEditor(input, EditorOptions.create({ pinned: true }));

		assert.strictEqual(observer.hasEditors(primary.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: primary.resource, typeId: primary.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: secondary.resource, typeId: secondary.typeId }), false);

		await part.activeGroup.openEditor(primary, EditorOptions.create({ pinned: true }));

		assert.strictEqual(observer.hasEditors(primary.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: primary.resource, typeId: primary.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: secondary.resource, typeId: secondary.typeId }), false);

		await part.activeGroup.closeEditor(input);

		assert.strictEqual(observer.hasEditors(primary.resource), true);
		assert.strictEqual(observer.hasEditor({ resource: primary.resource, typeId: primary.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: secondary.resource, typeId: secondary.typeId }), false);

		await part.activeGroup.closeEditor(primary);

		assert.strictEqual(observer.hasEditors(primary.resource), false);
		assert.strictEqual(observer.hasEditor({ resource: primary.resource, typeId: primary.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: secondary.resource, typeId: secondary.typeId }), false);
	});

	test('copy group', async function () {
		const [part, observer] = await createEditorObserver();

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_SERIALIZABLE_EDITOR_INPUT_ID);

		const rootGroup = part.activeGroup;

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input3, EditorOptions.create({ pinned: true }));

		let currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 3);
		assert.strictEqual(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input3);
		assert.strictEqual(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input2);
		assert.strictEqual(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[2].editor, input1);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);

		const copiedGroup = part.copyGroup(rootGroup, rootGroup, GroupDirection.RIGHT);
		copiedGroup.setActive(true);
		copiedGroup.focus();

		currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 6);
		assert.strictEqual(currentEditorsMRU[0].groupId, copiedGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input3);
		assert.strictEqual(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input3);
		assert.strictEqual(currentEditorsMRU[2].groupId, copiedGroup.id);
		assert.strictEqual(currentEditorsMRU[2].editor, input2);
		assert.strictEqual(currentEditorsMRU[3].groupId, copiedGroup.id);
		assert.strictEqual(currentEditorsMRU[3].editor, input1);
		assert.strictEqual(currentEditorsMRU[4].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[4].editor, input2);
		assert.strictEqual(currentEditorsMRU[5].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[5].editor, input1);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);

		await rootGroup.closeAllEditors();

		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);

		await copiedGroup.closeAllEditors();

		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), false);
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
		const observer = disposables.add(new EditorsObserver(part, storage));
		await part.whenReady;

		let currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 3);
		assert.strictEqual(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input3);
		assert.strictEqual(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input2);
		assert.strictEqual(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[2].editor, input1);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);

		storage.emitWillSaveState(WillSaveStateReason.SHUTDOWN);

		const restoredObserver = disposables.add(new EditorsObserver(part, storage));
		await part.whenReady;

		currentEditorsMRU = restoredObserver.editors;
		assert.strictEqual(currentEditorsMRU.length, 3);
		assert.strictEqual(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input3);
		assert.strictEqual(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input2);
		assert.strictEqual(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[2].editor, input1);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);
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
		const observer = disposables.add(new EditorsObserver(part, storage));
		await part.whenReady;

		let currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 3);
		assert.strictEqual(currentEditorsMRU[0].groupId, sideGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input3);
		assert.strictEqual(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input2);
		assert.strictEqual(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[2].editor, input1);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);

		storage.emitWillSaveState(WillSaveStateReason.SHUTDOWN);

		const restoredObserver = disposables.add(new EditorsObserver(part, storage));
		await part.whenReady;

		currentEditorsMRU = restoredObserver.editors;
		assert.strictEqual(currentEditorsMRU.length, 3);
		assert.strictEqual(currentEditorsMRU[0].groupId, sideGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input3);
		assert.strictEqual(currentEditorsMRU[1].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[1].editor, input2);
		assert.strictEqual(currentEditorsMRU[2].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[2].editor, input1);
		assert.strictEqual(restoredObserver.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(restoredObserver.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(restoredObserver.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);
	});

	test('observer does not restore editors that cannot be serialized', async () => {
		const part = await createPart();

		const rootGroup = part.activeGroup;

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true }));

		const storage = new TestStorageService();
		const observer = disposables.add(new EditorsObserver(part, storage));
		await part.whenReady;

		let currentEditorsMRU = observer.editors;
		assert.strictEqual(currentEditorsMRU.length, 1);
		assert.strictEqual(currentEditorsMRU[0].groupId, rootGroup.id);
		assert.strictEqual(currentEditorsMRU[0].editor, input1);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);

		storage.emitWillSaveState(WillSaveStateReason.SHUTDOWN);

		const restoredObserver = disposables.add(new EditorsObserver(part, storage));
		await part.whenReady;

		currentEditorsMRU = restoredObserver.editors;
		assert.strictEqual(currentEditorsMRU.length, 0);
		assert.strictEqual(restoredObserver.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
	});

	test('observer closes editors when limit reached (across all groups)', async () => {
		const part = await createPart();
		part.enforcePartOptions({ limit: { enabled: true, value: 3 } });

		const storage = new TestStorageService();
		const observer = disposables.add(new EditorsObserver(part, storage));

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

		assert.strictEqual(rootGroup.count, 3);
		assert.strictEqual(rootGroup.contains(input1), false);
		assert.strictEqual(rootGroup.contains(input2), true);
		assert.strictEqual(rootGroup.contains(input3), true);
		assert.strictEqual(rootGroup.contains(input4), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input4.resource, typeId: input4.typeId }), true);

		input2.setDirty();
		part.enforcePartOptions({ limit: { enabled: true, value: 1 } });

		await timeout(0);

		assert.strictEqual(rootGroup.count, 2);
		assert.strictEqual(rootGroup.contains(input1), false);
		assert.strictEqual(rootGroup.contains(input2), true); // dirty
		assert.strictEqual(rootGroup.contains(input3), false);
		assert.strictEqual(rootGroup.contains(input4), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input4.resource, typeId: input4.typeId }), true);

		const input5 = new TestFileEditorInput(URI.parse('foo://bar5'), TEST_EDITOR_INPUT_ID);
		await sideGroup.openEditor(input5, EditorOptions.create({ pinned: true }));

		assert.strictEqual(rootGroup.count, 1);
		assert.strictEqual(rootGroup.contains(input1), false);
		assert.strictEqual(rootGroup.contains(input2), true); // dirty
		assert.strictEqual(rootGroup.contains(input3), false);
		assert.strictEqual(rootGroup.contains(input4), false);
		assert.strictEqual(sideGroup.contains(input5), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input4.resource, typeId: input4.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input5.resource, typeId: input5.typeId }), true);
	});

	test('observer closes editors when limit reached (in group)', async () => {
		const part = await createPart();
		part.enforcePartOptions({ limit: { enabled: true, value: 3, perEditorGroup: true } });

		const storage = new TestStorageService();
		const observer = disposables.add(new EditorsObserver(part, storage));

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

		assert.strictEqual(rootGroup.count, 3); // 1 editor got closed due to our limit!
		assert.strictEqual(rootGroup.contains(input1), false);
		assert.strictEqual(rootGroup.contains(input2), true);
		assert.strictEqual(rootGroup.contains(input3), true);
		assert.strictEqual(rootGroup.contains(input4), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input4.resource, typeId: input4.typeId }), true);

		await sideGroup.openEditor(input1, EditorOptions.create({ pinned: true }));
		await sideGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await sideGroup.openEditor(input3, EditorOptions.create({ pinned: true }));
		await sideGroup.openEditor(input4, EditorOptions.create({ pinned: true }));

		assert.strictEqual(sideGroup.count, 3);
		assert.strictEqual(sideGroup.contains(input1), false);
		assert.strictEqual(sideGroup.contains(input2), true);
		assert.strictEqual(sideGroup.contains(input3), true);
		assert.strictEqual(sideGroup.contains(input4), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input4.resource, typeId: input4.typeId }), true);

		part.enforcePartOptions({ limit: { enabled: true, value: 1, perEditorGroup: true } });

		await timeout(10);

		assert.strictEqual(rootGroup.count, 1);
		assert.strictEqual(rootGroup.contains(input1), false);
		assert.strictEqual(rootGroup.contains(input2), false);
		assert.strictEqual(rootGroup.contains(input3), false);
		assert.strictEqual(rootGroup.contains(input4), true);

		assert.strictEqual(sideGroup.count, 1);
		assert.strictEqual(sideGroup.contains(input1), false);
		assert.strictEqual(sideGroup.contains(input2), false);
		assert.strictEqual(sideGroup.contains(input3), false);
		assert.strictEqual(sideGroup.contains(input4), true);

		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input4.resource, typeId: input4.typeId }), true);
	});

	test('observer does not close sticky', async () => {
		const part = await createPart();
		part.enforcePartOptions({ limit: { enabled: true, value: 3 } });

		const storage = new TestStorageService();
		const observer = disposables.add(new EditorsObserver(part, storage));

		const rootGroup = part.activeGroup;

		const input1 = new TestFileEditorInput(URI.parse('foo://bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('foo://bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.parse('foo://bar3'), TEST_EDITOR_INPUT_ID);
		const input4 = new TestFileEditorInput(URI.parse('foo://bar4'), TEST_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input1, EditorOptions.create({ pinned: true, sticky: true }));
		await rootGroup.openEditor(input2, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input3, EditorOptions.create({ pinned: true }));
		await rootGroup.openEditor(input4, EditorOptions.create({ pinned: true }));

		assert.strictEqual(rootGroup.count, 3);
		assert.strictEqual(rootGroup.contains(input1), true);
		assert.strictEqual(rootGroup.contains(input2), false);
		assert.strictEqual(rootGroup.contains(input3), true);
		assert.strictEqual(rootGroup.contains(input4), true);
		assert.strictEqual(observer.hasEditor({ resource: input1.resource, typeId: input1.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input2.resource, typeId: input2.typeId }), false);
		assert.strictEqual(observer.hasEditor({ resource: input3.resource, typeId: input3.typeId }), true);
		assert.strictEqual(observer.hasEditor({ resource: input4.resource, typeId: input4.typeId }), true);
	});
});
