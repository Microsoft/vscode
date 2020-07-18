/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from 'vs/base/common/event';
import { workbenchInstantiationService, registerTestEditor, TestFileEditorInput, TestEditorPart, ITestInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { GroupDirection, GroupsOrder, MergeGroupMode, GroupOrientation, GroupChangeKind, GroupLocation, OpenEditorContext } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EditorOptions, CloseDirection, IEditorPartOptions, EditorsOrder } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';

const TEST_EDITOR_ID = 'MyFileEditorForEditorGroupService';
const TEST_EDITOR_INPUT_ID = 'testEditorInputForEditorGroupService';

suite('EditorGroupsService', () => {

	let disposables: IDisposable[] = [];

	setup(() => {
		disposables.push(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)], TEST_EDITOR_INPUT_ID));
	});

	teardown(() => {
		dispose(disposables);
		disposables = [];
	});

	function createPart(instantiationService = workbenchInstantiationService()): [TestEditorPart, ITestInstantiationService] {
		const part = instantiationService.createInstance(TestEditorPart);
		part.create(document.createElement('div'));
		part.layout(400, 300);

		return [part, instantiationService];
	}

	test('groups basics', async function () {
		const [part] = createPart();

		let activeGroupChangeCounter = 0;
		const activeGroupChangeListener = part.onDidActiveGroupChange(() => {
			activeGroupChangeCounter++;
		});

		let groupAddedCounter = 0;
		const groupAddedListener = part.onDidAddGroup(() => {
			groupAddedCounter++;
		});

		let groupRemovedCounter = 0;
		const groupRemovedListener = part.onDidRemoveGroup(() => {
			groupRemovedCounter++;
		});

		let groupMovedCounter = 0;
		const groupMovedListener = part.onDidMoveGroup(() => {
			groupMovedCounter++;
		});

		// always a root group
		const rootGroup = part.groups[0];
		assert.equal(part.groups.length, 1);
		assert.equal(part.count, 1);
		assert.equal(rootGroup, part.getGroup(rootGroup.id));
		assert.ok(part.activeGroup === rootGroup);
		assert.equal(rootGroup.label, 'Group 1');

		let mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.equal(mru.length, 1);
		assert.equal(mru[0], rootGroup);

		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);
		assert.equal(rightGroup, part.getGroup(rightGroup.id));
		assert.equal(groupAddedCounter, 1);
		assert.equal(part.groups.length, 2);
		assert.equal(part.count, 2);
		assert.ok(part.activeGroup === rootGroup);
		assert.equal(rootGroup.label, 'Group 1');
		assert.equal(rightGroup.label, 'Group 2');

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.equal(mru.length, 2);
		assert.equal(mru[0], rootGroup);
		assert.equal(mru[1], rightGroup);

		assert.equal(activeGroupChangeCounter, 0);

		let rootGroupActiveChangeCounter = 0;
		const rootGroupChangeListener = rootGroup.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.GROUP_ACTIVE) {
				rootGroupActiveChangeCounter++;
			}
		});

		let rightGroupActiveChangeCounter = 0;
		const rightGroupChangeListener = rightGroup.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.GROUP_ACTIVE) {
				rightGroupActiveChangeCounter++;
			}
		});

		part.activateGroup(rightGroup);
		assert.ok(part.activeGroup === rightGroup);
		assert.equal(activeGroupChangeCounter, 1);
		assert.equal(rootGroupActiveChangeCounter, 1);
		assert.equal(rightGroupActiveChangeCounter, 1);

		rootGroupChangeListener.dispose();
		rightGroupChangeListener.dispose();

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.equal(mru.length, 2);
		assert.equal(mru[0], rightGroup);
		assert.equal(mru[1], rootGroup);

		const downGroup = part.addGroup(rightGroup, GroupDirection.DOWN);
		let didDispose = false;
		downGroup.onWillDispose(() => {
			didDispose = true;
		});
		assert.equal(groupAddedCounter, 2);
		assert.equal(part.groups.length, 3);
		assert.ok(part.activeGroup === rightGroup);
		assert.ok(!downGroup.activeEditorPane);
		assert.equal(rootGroup.label, 'Group 1');
		assert.equal(rightGroup.label, 'Group 2');
		assert.equal(downGroup.label, 'Group 3');

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.equal(mru.length, 3);
		assert.equal(mru[0], rightGroup);
		assert.equal(mru[1], rootGroup);
		assert.equal(mru[2], downGroup);

		const gridOrder = part.getGroups(GroupsOrder.GRID_APPEARANCE);
		assert.equal(gridOrder.length, 3);
		assert.equal(gridOrder[0], rootGroup);
		assert.equal(gridOrder[0].index, 0);
		assert.equal(gridOrder[1], rightGroup);
		assert.equal(gridOrder[1].index, 1);
		assert.equal(gridOrder[2], downGroup);
		assert.equal(gridOrder[2].index, 2);

		part.moveGroup(downGroup, rightGroup, GroupDirection.DOWN);
		assert.equal(groupMovedCounter, 1);

		part.removeGroup(downGroup);
		assert.ok(!part.getGroup(downGroup.id));
		assert.equal(didDispose, true);
		assert.equal(groupRemovedCounter, 1);
		assert.equal(part.groups.length, 2);
		assert.ok(part.activeGroup === rightGroup);
		assert.equal(rootGroup.label, 'Group 1');
		assert.equal(rightGroup.label, 'Group 2');

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.equal(mru.length, 2);
		assert.equal(mru[0], rightGroup);
		assert.equal(mru[1], rootGroup);

		let rightGroupInstantiator!: IInstantiationService;
		part.activeGroup.invokeWithinContext(accessor => {
			rightGroupInstantiator = accessor.get(IInstantiationService);
		});

		let rootGroupInstantiator!: IInstantiationService;
		rootGroup.invokeWithinContext(accessor => {
			rootGroupInstantiator = accessor.get(IInstantiationService);
		});

		assert.ok(rightGroupInstantiator);
		assert.ok(rootGroupInstantiator);
		assert.ok(rightGroupInstantiator !== rootGroupInstantiator);

		part.removeGroup(rightGroup);
		assert.equal(groupRemovedCounter, 2);
		assert.equal(part.groups.length, 1);
		assert.ok(part.activeGroup === rootGroup);

		mru = part.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		assert.equal(mru.length, 1);
		assert.equal(mru[0], rootGroup);

		part.removeGroup(rootGroup); // cannot remove root group
		assert.equal(part.groups.length, 1);
		assert.equal(groupRemovedCounter, 2);
		assert.ok(part.activeGroup === rootGroup);

		part.setGroupOrientation(part.orientation === GroupOrientation.HORIZONTAL ? GroupOrientation.VERTICAL : GroupOrientation.HORIZONTAL);

		activeGroupChangeListener.dispose();
		groupAddedListener.dispose();
		groupRemovedListener.dispose();
		groupMovedListener.dispose();

		part.dispose();
	});

	test('save & restore state', async function () {
		let [part, instantiationService] = createPart();

		const rootGroup = part.groups[0];
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);
		const downGroup = part.addGroup(rightGroup, GroupDirection.DOWN);

		const rootGroupInput = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		await rootGroup.openEditor(rootGroupInput, EditorOptions.create({ pinned: true }));

		const rightGroupInput = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		await rightGroup.openEditor(rightGroupInput, EditorOptions.create({ pinned: true }));

		assert.equal(part.groups.length, 3);

		part.saveState();
		part.dispose();

		let [restoredPart] = createPart(instantiationService);

		assert.equal(restoredPart.groups.length, 3);
		assert.ok(restoredPart.getGroup(rootGroup.id));
		assert.ok(restoredPart.getGroup(rightGroup.id));
		assert.ok(restoredPart.getGroup(downGroup.id));

		restoredPart.clearState();
		restoredPart.dispose();
	});

	test('groups index / labels', function () {
		const [part] = createPart();

		const rootGroup = part.groups[0];
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);
		const downGroup = part.addGroup(rightGroup, GroupDirection.DOWN);

		let groupIndexChangedCounter = 0;
		const groupIndexChangedListener = part.onDidGroupIndexChange(() => {
			groupIndexChangedCounter++;
		});

		let indexChangeCounter = 0;
		const labelChangeListener = downGroup.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.GROUP_INDEX) {
				indexChangeCounter++;
			}
		});

		assert.equal(rootGroup.index, 0);
		assert.equal(rightGroup.index, 1);
		assert.equal(downGroup.index, 2);
		assert.equal(rootGroup.label, 'Group 1');
		assert.equal(rightGroup.label, 'Group 2');
		assert.equal(downGroup.label, 'Group 3');

		part.removeGroup(rightGroup);
		assert.equal(rootGroup.index, 0);
		assert.equal(downGroup.index, 1);
		assert.equal(rootGroup.label, 'Group 1');
		assert.equal(downGroup.label, 'Group 2');
		assert.equal(indexChangeCounter, 1);
		assert.equal(groupIndexChangedCounter, 1);

		part.moveGroup(downGroup, rootGroup, GroupDirection.UP);
		assert.equal(downGroup.index, 0);
		assert.equal(rootGroup.index, 1);
		assert.equal(downGroup.label, 'Group 1');
		assert.equal(rootGroup.label, 'Group 2');
		assert.equal(indexChangeCounter, 2);
		assert.equal(groupIndexChangedCounter, 3);

		const newFirstGroup = part.addGroup(downGroup, GroupDirection.UP);
		assert.equal(newFirstGroup.index, 0);
		assert.equal(downGroup.index, 1);
		assert.equal(rootGroup.index, 2);
		assert.equal(newFirstGroup.label, 'Group 1');
		assert.equal(downGroup.label, 'Group 2');
		assert.equal(rootGroup.label, 'Group 3');
		assert.equal(indexChangeCounter, 3);
		assert.equal(groupIndexChangedCounter, 6);

		labelChangeListener.dispose();
		groupIndexChangedListener.dispose();

		part.dispose();
	});

	test('copy/merge groups', async () => {
		const [part] = createPart();

		let groupAddedCounter = 0;
		const groupAddedListener = part.onDidAddGroup(() => {
			groupAddedCounter++;
		});

		let groupRemovedCounter = 0;
		const groupRemovedListener = part.onDidRemoveGroup(() => {
			groupRemovedCounter++;
		});

		const rootGroup = part.groups[0];
		let rootGroupDisposed = false;
		const disposeListener = rootGroup.onWillDispose(() => {
			rootGroupDisposed = true;
		});

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);

		await rootGroup.openEditor(input, EditorOptions.create({ pinned: true }));
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT, { activate: true });
		const downGroup = part.copyGroup(rootGroup, rightGroup, GroupDirection.DOWN);
		assert.equal(groupAddedCounter, 2);
		assert.equal(downGroup.count, 1);
		assert.ok(downGroup.activeEditor instanceof TestFileEditorInput);
		part.mergeGroup(rootGroup, rightGroup, { mode: MergeGroupMode.COPY_EDITORS });
		assert.equal(rightGroup.count, 1);
		assert.ok(rightGroup.activeEditor instanceof TestFileEditorInput);
		part.mergeGroup(rootGroup, rightGroup, { mode: MergeGroupMode.MOVE_EDITORS });
		assert.equal(rootGroup.count, 0);
		part.mergeGroup(rootGroup, downGroup);
		assert.equal(groupRemovedCounter, 1);
		assert.equal(rootGroupDisposed, true);
		groupAddedListener.dispose();
		groupRemovedListener.dispose();
		disposeListener.dispose();
		part.dispose();
	});

	test('whenRestored', async () => {
		const [part] = createPart();

		await part.whenRestored;
		assert.ok(true);
		part.dispose();
	});

	test('options', () => {
		const [part] = createPart();

		let oldOptions!: IEditorPartOptions;
		let newOptions!: IEditorPartOptions;
		part.onDidEditorPartOptionsChange(event => {
			oldOptions = event.oldPartOptions;
			newOptions = event.newPartOptions;
		});

		const currentOptions = part.partOptions;
		assert.ok(currentOptions);

		part.enforcePartOptions({ showTabs: false });
		assert.equal(part.partOptions.showTabs, false);
		assert.equal(newOptions.showTabs, false);
		assert.equal(oldOptions, currentOptions);

		part.dispose();
	});

	test('editor basics', async function () {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		await part.whenRestored;

		let editorWillOpenCounter = 0;
		const editorWillOpenListener = group.onWillOpenEditor(() => {
			editorWillOpenCounter++;
		});

		let activeEditorChangeCounter = 0;
		let editorDidOpenCounter = 0;
		let editorCloseCounter = 0;
		let editorPinCounter = 0;
		let editorStickyCounter = 0;
		const editorGroupChangeListener = group.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.EDITOR_OPEN) {
				assert.ok(e.editor);
				editorDidOpenCounter++;
			} else if (e.kind === GroupChangeKind.EDITOR_ACTIVE) {
				assert.ok(e.editor);
				activeEditorChangeCounter++;
			} else if (e.kind === GroupChangeKind.EDITOR_CLOSE) {
				assert.ok(e.editor);
				editorCloseCounter++;
			} else if (e.kind === GroupChangeKind.EDITOR_PIN) {
				assert.ok(e.editor);
				editorPinCounter++;
			} else if (e.kind === GroupChangeKind.EDITOR_STICKY) {
				assert.ok(e.editor);
				editorStickyCounter++;
			}
		});

		let editorCloseCounter1 = 0;
		const editorCloseListener = group.onDidCloseEditor(() => {
			editorCloseCounter1++;
		});

		let editorWillCloseCounter = 0;
		const editorWillCloseListener = group.onWillCloseEditor(() => {
			editorWillCloseCounter++;
		});

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditor(input, EditorOptions.create({ pinned: true }));
		await group.openEditor(inputInactive, EditorOptions.create({ inactive: true }));

		assert.equal(group.isActive(input), true);
		assert.equal(group.isActive(inputInactive), false);
		assert.equal(group.isOpened(input), true);
		assert.equal(group.isOpened(inputInactive), true);
		assert.equal(group.isEmpty, false);
		assert.equal(group.count, 2);
		assert.equal(editorWillOpenCounter, 2);
		assert.equal(editorDidOpenCounter, 2);
		assert.equal(activeEditorChangeCounter, 1);
		assert.equal(group.getEditorByIndex(0), input);
		assert.equal(group.getEditorByIndex(1), inputInactive);
		assert.equal(group.getIndexOfEditor(input), 0);
		assert.equal(group.getIndexOfEditor(inputInactive), 1);

		assert.equal(group.previewEditor, inputInactive);
		assert.equal(group.isPinned(inputInactive), false);
		group.pinEditor(inputInactive);
		assert.equal(editorPinCounter, 1);
		assert.equal(group.isPinned(inputInactive), true);
		assert.ok(!group.previewEditor);

		assert.equal(group.activeEditor, input);
		assert.equal(group.activeEditorPane?.getId(), TEST_EDITOR_ID);
		assert.equal(group.count, 2);

		const mru = group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE);
		assert.equal(mru[0], input);
		assert.equal(mru[1], inputInactive);

		await group.openEditor(inputInactive);
		assert.equal(activeEditorChangeCounter, 2);
		assert.equal(group.activeEditor, inputInactive);

		await group.openEditor(input);
		await group.closeEditor(inputInactive);

		assert.equal(activeEditorChangeCounter, 3);
		assert.equal(editorCloseCounter, 1);
		assert.equal(editorCloseCounter1, 1);
		assert.equal(editorWillCloseCounter, 1);

		assert.ok(inputInactive.gotDisposed);

		assert.equal(group.activeEditor, input);

		assert.equal(editorStickyCounter, 0);
		group.stickEditor(input);
		assert.equal(editorStickyCounter, 1);
		group.unstickEditor(input);
		assert.equal(editorStickyCounter, 2);

		editorCloseListener.dispose();
		editorWillCloseListener.dispose();
		editorWillOpenListener.dispose();
		editorGroupChangeListener.dispose();
		part.dispose();
	});

	test('openEditors / closeEditors', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input, options: { pinned: true } },
			{ editor: inputInactive }
		]);

		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input);
		assert.equal(group.getEditorByIndex(1), inputInactive);

		await group.closeEditors([input, inputInactive]);

		assert.ok(input.gotDisposed);
		assert.ok(inputInactive.gotDisposed);

		assert.equal(group.isEmpty, true);
		part.dispose();
	});

	test('closeEditors (one, opened in multiple groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		await rightGroup.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);

		await rightGroup.closeEditor(input);

		assert.ok(!input.gotDisposed);

		await group.closeEditor(input);

		assert.ok(input.gotDisposed);
	});

	test('closeEditors (except one)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.equal(group.count, 3);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		assert.equal(group.getEditorByIndex(2), input3);

		await group.closeEditors({ except: input2 });
		assert.equal(group.count, 1);
		assert.equal(group.getEditorByIndex(0), input2);
		part.dispose();
	});

	test('closeEditors (except one, sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true, sticky: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.equal(group.count, 3);
		assert.equal(group.stickyCount, 1);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		assert.equal(group.getEditorByIndex(2), input3);

		await group.closeEditors({ except: input2, excludeSticky: true });

		assert.equal(group.count, 2);
		assert.equal(group.stickyCount, 1);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);

		await group.closeEditors({ except: input2 });

		assert.equal(group.count, 1);
		assert.equal(group.stickyCount, 0);
		assert.equal(group.getEditorByIndex(0), input2);
		part.dispose();
	});

	test('closeEditors (saved only)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.equal(group.count, 3);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		assert.equal(group.getEditorByIndex(2), input3);

		await group.closeEditors({ savedOnly: true });
		assert.equal(group.count, 0);
		part.dispose();
	});

	test('closeEditors (saved only, sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true, sticky: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.equal(group.count, 3);
		assert.equal(group.stickyCount, 1);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		assert.equal(group.getEditorByIndex(2), input3);

		await group.closeEditors({ savedOnly: true, excludeSticky: true });

		assert.equal(group.count, 1);
		assert.equal(group.stickyCount, 1);
		assert.equal(group.getEditorByIndex(0), input1);

		await group.closeEditors({ savedOnly: true });
		assert.equal(group.count, 0);
		part.dispose();
	});

	test('closeEditors (direction: right)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.equal(group.count, 3);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		assert.equal(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.RIGHT, except: input2 });
		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		part.dispose();
	});

	test('closeEditors (direction: right, sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true, sticky: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.equal(group.count, 3);
		assert.equal(group.stickyCount, 1);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		assert.equal(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.RIGHT, except: input2, excludeSticky: true });
		assert.equal(group.count, 2);
		assert.equal(group.stickyCount, 1);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);

		await group.closeEditors({ direction: CloseDirection.RIGHT, except: input2 });
		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		part.dispose();
	});

	test('closeEditors (direction: left)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.equal(group.count, 3);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		assert.equal(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.LEFT, except: input2 });
		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input2);
		assert.equal(group.getEditorByIndex(1), input3);
		part.dispose();
	});

	test('closeEditors (direction: left, sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input1 = new TestFileEditorInput(URI.file('foo/bar1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.file('foo/bar2'), TEST_EDITOR_INPUT_ID);
		const input3 = new TestFileEditorInput(URI.file('foo/bar3'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input1, options: { pinned: true, sticky: true } },
			{ editor: input2, options: { pinned: true } },
			{ editor: input3 }
		]);

		assert.equal(group.count, 3);
		assert.equal(group.stickyCount, 1);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		assert.equal(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.LEFT, except: input2, excludeSticky: true });
		assert.equal(group.count, 3);
		assert.equal(group.stickyCount, 1);
		assert.equal(group.getEditorByIndex(0), input1);
		assert.equal(group.getEditorByIndex(1), input2);
		assert.equal(group.getEditorByIndex(2), input3);

		await group.closeEditors({ direction: CloseDirection.LEFT, except: input2 });
		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input2);
		assert.equal(group.getEditorByIndex(1), input3);
		part.dispose();
	});

	test('closeAllEditors', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input, options: { pinned: true } },
			{ editor: inputInactive }
		]);

		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input);
		assert.equal(group.getEditorByIndex(1), inputInactive);

		await group.closeAllEditors();
		assert.equal(group.isEmpty, true);
		part.dispose();
	});

	test('closeAllEditors (sticky editor)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([
			{ editor: input, options: { pinned: true, sticky: true } },
			{ editor: inputInactive }
		]);

		assert.equal(group.count, 2);
		assert.equal(group.stickyCount, 1);

		await group.closeAllEditors({ excludeSticky: true });

		assert.equal(group.count, 1);
		assert.equal(group.stickyCount, 1);
		assert.equal(group.getEditorByIndex(0), input);

		await group.closeAllEditors();

		assert.equal(group.isEmpty, true);

		part.dispose();
	});

	test('moveEditor (same group)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		let editorMoveCounter = 0;
		const editorGroupChangeListener = group.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.EDITOR_MOVE) {
				assert.ok(e.editor);
				editorMoveCounter++;
			}
		});

		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input);
		assert.equal(group.getEditorByIndex(1), inputInactive);
		group.moveEditor(inputInactive, group, { index: 0 });
		assert.equal(editorMoveCounter, 1);
		assert.equal(group.getEditorByIndex(0), inputInactive);
		assert.equal(group.getEditorByIndex(1), input);
		editorGroupChangeListener.dispose();
		part.dispose();
	});

	test('moveEditor (across groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input);
		assert.equal(group.getEditorByIndex(1), inputInactive);
		group.moveEditor(inputInactive, rightGroup, { index: 0 });
		assert.equal(group.count, 1);
		assert.equal(group.getEditorByIndex(0), input);
		assert.equal(rightGroup.count, 1);
		assert.equal(rightGroup.getEditorByIndex(0), inputInactive);
		part.dispose();
	});

	test('copyEditor (across groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input);
		assert.equal(group.getEditorByIndex(1), inputInactive);
		group.copyEditor(inputInactive, rightGroup, { index: 0 });
		assert.equal(group.count, 2);
		assert.equal(group.getEditorByIndex(0), input);
		assert.equal(group.getEditorByIndex(1), inputInactive);
		assert.equal(rightGroup.count, 1);
		assert.equal(rightGroup.getEditorByIndex(0), inputInactive);
		part.dispose();
	});

	test('replaceEditors', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditor(input);
		assert.equal(group.count, 1);
		assert.equal(group.getEditorByIndex(0), input);

		await group.replaceEditors([{ editor: input, replacement: inputInactive }]);
		assert.equal(group.count, 1);
		assert.equal(group.getEditorByIndex(0), inputInactive);
		part.dispose();
	});

	test('find neighbour group (left/right)', function () {
		const [part] = createPart();
		const rootGroup = part.activeGroup;
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		assert.equal(rightGroup, part.findGroup({ direction: GroupDirection.RIGHT }, rootGroup));
		assert.equal(rootGroup, part.findGroup({ direction: GroupDirection.LEFT }, rightGroup));

		part.dispose();
	});

	test('find neighbour group (up/down)', function () {
		const [part] = createPart();
		const rootGroup = part.activeGroup;
		const downGroup = part.addGroup(rootGroup, GroupDirection.DOWN);

		assert.equal(downGroup, part.findGroup({ direction: GroupDirection.DOWN }, rootGroup));
		assert.equal(rootGroup, part.findGroup({ direction: GroupDirection.UP }, downGroup));

		part.dispose();
	});

	test('find group by location (left/right)', function () {
		const [part] = createPart();
		const rootGroup = part.activeGroup;
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);
		const downGroup = part.addGroup(rightGroup, GroupDirection.DOWN);

		assert.equal(rootGroup, part.findGroup({ location: GroupLocation.FIRST }));
		assert.equal(downGroup, part.findGroup({ location: GroupLocation.LAST }));

		assert.equal(rightGroup, part.findGroup({ location: GroupLocation.NEXT }, rootGroup));
		assert.equal(rootGroup, part.findGroup({ location: GroupLocation.PREVIOUS }, rightGroup));

		assert.equal(downGroup, part.findGroup({ location: GroupLocation.NEXT }, rightGroup));
		assert.equal(rightGroup, part.findGroup({ location: GroupLocation.PREVIOUS }, downGroup));

		part.dispose();
	});

	test('applyLayout (2x2)', function () {
		const [part] = createPart();

		part.applyLayout({ groups: [{ groups: [{}, {}] }, { groups: [{}, {}] }], orientation: GroupOrientation.HORIZONTAL });

		assert.equal(part.groups.length, 4);

		part.dispose();
	});

	test('centeredLayout', function () {
		const [part] = createPart();

		part.centerLayout(true);

		assert.equal(part.isLayoutCentered(), true);

		part.dispose();
	});

	test('sticky editors', async () => {
		const [part] = createPart();
		const group = part.activeGroup;

		await part.whenRestored;

		assert.equal(group.stickyCount, 0);
		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL).length, 0);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 0);
		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 0);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 0);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);

		await group.openEditor(input, EditorOptions.create({ pinned: true }));
		await group.openEditor(inputInactive, EditorOptions.create({ inactive: true }));

		assert.equal(group.stickyCount, 0);
		assert.equal(group.isSticky(input), false);
		assert.equal(group.isSticky(inputInactive), false);

		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL).length, 2);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 2);
		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 2);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 2);

		group.stickEditor(input);

		assert.equal(group.stickyCount, 1);
		assert.equal(group.isSticky(input), true);
		assert.equal(group.isSticky(inputInactive), false);

		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL).length, 2);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 2);
		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 1);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 1);

		group.unstickEditor(input);

		assert.equal(group.stickyCount, 0);
		assert.equal(group.isSticky(input), false);
		assert.equal(group.isSticky(inputInactive), false);

		assert.equal(group.getIndexOfEditor(input), 0);
		assert.equal(group.getIndexOfEditor(inputInactive), 1);

		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL).length, 2);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 2);
		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 2);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 2);

		let editorMoveCounter = 0;
		const editorGroupChangeListener = group.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.EDITOR_MOVE) {
				assert.ok(e.editor);
				editorMoveCounter++;
			}
		});

		group.stickEditor(inputInactive);

		assert.equal(group.stickyCount, 1);
		assert.equal(group.isSticky(input), false);
		assert.equal(group.isSticky(inputInactive), true);

		assert.equal(group.getIndexOfEditor(input), 1);
		assert.equal(group.getIndexOfEditor(inputInactive), 0);
		assert.equal(editorMoveCounter, 1);

		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL).length, 2);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length, 2);
		assert.equal(group.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true }).length, 1);
		assert.equal(group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE, { excludeSticky: true }).length, 1);

		const inputSticky = new TestFileEditorInput(URI.file('foo/bar/sticky'), TEST_EDITOR_INPUT_ID);

		await group.openEditor(inputSticky, EditorOptions.create({ sticky: true }));

		assert.equal(group.stickyCount, 2);
		assert.equal(group.isSticky(input), false);
		assert.equal(group.isSticky(inputInactive), true);
		assert.equal(group.isSticky(inputSticky), true);

		assert.equal(group.getIndexOfEditor(inputInactive), 0);
		assert.equal(group.getIndexOfEditor(inputSticky), 1);
		assert.equal(group.getIndexOfEditor(input), 2);

		await group.openEditor(input, EditorOptions.create({ sticky: true }));

		assert.equal(group.stickyCount, 3);
		assert.equal(group.isSticky(input), true);
		assert.equal(group.isSticky(inputInactive), true);
		assert.equal(group.isSticky(inputSticky), true);

		assert.equal(group.getIndexOfEditor(inputInactive), 0);
		assert.equal(group.getIndexOfEditor(inputSticky), 1);
		assert.equal(group.getIndexOfEditor(input), 2);

		editorGroupChangeListener.dispose();
		part.dispose();
	});

	test('moveEditor with context (across groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);

		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);
		let firstOpenEditorContext: OpenEditorContext | undefined;
		Event.once(group.onWillOpenEditor)(e => {
			firstOpenEditorContext = e.context;
		});
		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		assert.equal(firstOpenEditorContext, undefined);

		const waitForEditorWillOpen = new Promise<OpenEditorContext | undefined>(c => {
			Event.once(rightGroup.onWillOpenEditor)(e => c(e.context));
		});

		group.moveEditor(inputInactive, rightGroup, { index: 0 });
		const context = await waitForEditorWillOpen;
		assert.equal(context, OpenEditorContext.MOVE_EDITOR);
		part.dispose();
	});

	test('copyEditor with context (across groups)', async () => {
		const [part] = createPart();
		const group = part.activeGroup;
		assert.equal(group.isEmpty, true);

		const rightGroup = part.addGroup(group, GroupDirection.RIGHT);
		const input = new TestFileEditorInput(URI.file('foo/bar'), TEST_EDITOR_INPUT_ID);
		const inputInactive = new TestFileEditorInput(URI.file('foo/bar/inactive'), TEST_EDITOR_INPUT_ID);
		await group.openEditors([{ editor: input, options: { pinned: true } }, { editor: inputInactive }]);
		const waitForEditorWillOpen = new Promise<OpenEditorContext | undefined>(c => {
			Event.once(rightGroup.onWillOpenEditor)(e => c(e.context));
		});

		group.copyEditor(inputInactive, rightGroup, { index: 0 });
		const context = await waitForEditorWillOpen;
		assert.equal(context, OpenEditorContext.COPY_EDITOR);
		part.dispose();
	});
});
