/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorActivation } from 'vs/platform/editor/common/editor';
import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorInput, EditorsOrder, SideBySideEditorInput } from 'vs/workbench/common/editor';
import { workbenchInstantiationService, TestServiceAccessor, registerTestEditor, TestFileEditorInput } from 'vs/workbench/test/browser/workbenchTestServices';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { EditorService, DelegatingEditorService } from 'vs/workbench/services/editor/browser/editorService';
import { IEditorGroup, IEditorGroupsService, GroupDirection, GroupsArrangement } from 'vs/workbench/services/editor/common/editorGroupsService';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { FileEditorInput } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { timeout } from 'vs/base/common/async';
import { toResource } from 'vs/base/test/common/utils';
import { IFileService, FileOperationEvent, FileOperation } from 'vs/platform/files/common/files';
import { Disposable, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { ModesRegistry } from 'vs/editor/common/modes/modesRegistry';
import { UntitledTextEditorModel } from 'vs/workbench/services/untitled/common/untitledTextEditorModel';
import { NullFileSystemProvider } from 'vs/platform/files/test/common/nullFileSystemProvider';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { isLinux } from 'vs/base/common/platform';

const TEST_EDITOR_ID = 'MyTestEditorForEditorService';
const TEST_EDITOR_INPUT_ID = 'testEditorInputForEditorService';

class FileServiceProvider extends Disposable {
	constructor(scheme: string, @IFileService fileService: IFileService) {
		super();

		this._register(fileService.registerProvider(scheme, new NullFileSystemProvider()));
	}
}

suite('EditorService', () => {

	let disposables: IDisposable[] = [];

	setup(() => {
		disposables.push(registerTestEditor(TEST_EDITOR_ID, [new SyncDescriptor(TestFileEditorInput)], TEST_EDITOR_INPUT_ID));
	});

	teardown(() => {
		dispose(disposables);
		disposables = [];
	});

	function createEditorService(): [EditorPart, EditorService, TestServiceAccessor] {
		const instantiationService = workbenchInstantiationService();

		const part = instantiationService.createInstance(EditorPart);
		part.create(document.createElement('div'));
		part.layout(400, 300);

		instantiationService.stub(IEditorGroupsService, part);

		const editorService = instantiationService.createInstance(EditorService);
		instantiationService.stub(IEditorService, editorService);

		return [part, editorService, instantiationService.createInstance(TestServiceAccessor)];
	}

	test('basics', async () => {
		const [part, service] = createEditorService();

		let input = new TestFileEditorInput(URI.parse('my://resource-basics'), TEST_EDITOR_INPUT_ID);
		let otherInput = new TestFileEditorInput(URI.parse('my://resource2-basics'), TEST_EDITOR_INPUT_ID);

		let activeEditorChangeEventCounter = 0;
		const activeEditorChangeListener = service.onDidActiveEditorChange(() => {
			activeEditorChangeEventCounter++;
		});

		let visibleEditorChangeEventCounter = 0;
		const visibleEditorChangeListener = service.onDidVisibleEditorsChange(() => {
			visibleEditorChangeEventCounter++;
		});

		let didCloseEditorListenerCounter = 0;
		const didCloseEditorListener = service.onDidCloseEditor(() => {
			didCloseEditorListenerCounter++;
		});

		await part.whenRestored;

		// Open input
		let editor = await service.openEditor(input, { pinned: true });

		assert.equal(editor?.getId(), TEST_EDITOR_ID);
		assert.equal(editor, service.activeEditorPane);
		assert.equal(1, service.count);
		assert.equal(input, service.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)[0].editor);
		assert.equal(input, service.getEditors(EditorsOrder.SEQUENTIAL)[0].editor);
		assert.equal(input, service.activeEditor);
		assert.equal(service.visibleEditorPanes.length, 1);
		assert.equal(service.visibleEditorPanes[0], editor);
		assert.ok(!service.activeTextEditorControl);
		assert.ok(!service.activeTextEditorMode);
		assert.equal(service.visibleTextEditorControls.length, 0);
		assert.equal(service.isOpen(input), true);
		assert.equal(service.isOpen({ resource: input.resource }), true);
		assert.equal(activeEditorChangeEventCounter, 1);
		assert.equal(visibleEditorChangeEventCounter, 1);

		// Close input
		await editor?.group?.closeEditor(input);

		assert.equal(0, service.count);
		assert.equal(0, service.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE).length);
		assert.equal(0, service.getEditors(EditorsOrder.SEQUENTIAL).length);
		assert.equal(didCloseEditorListenerCounter, 1);
		assert.equal(activeEditorChangeEventCounter, 2);
		assert.equal(visibleEditorChangeEventCounter, 2);
		assert.ok(input.gotDisposed);

		// Open again 2 inputs (disposed editors are ignored!)
		await service.openEditor(input, { pinned: true });
		assert.equal(0, service.count);

		// Open again 2 inputs (recreate because disposed)
		input = new TestFileEditorInput(URI.parse('my://resource-basics'), TEST_EDITOR_INPUT_ID);
		otherInput = new TestFileEditorInput(URI.parse('my://resource2-basics'), TEST_EDITOR_INPUT_ID);

		await service.openEditor(input, { pinned: true });
		editor = await service.openEditor(otherInput, { pinned: true });

		assert.equal(2, service.count);
		assert.equal(otherInput, service.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)[0].editor);
		assert.equal(input, service.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)[1].editor);
		assert.equal(input, service.getEditors(EditorsOrder.SEQUENTIAL)[0].editor);
		assert.equal(otherInput, service.getEditors(EditorsOrder.SEQUENTIAL)[1].editor);
		assert.equal(service.visibleEditorPanes.length, 1);
		assert.equal(service.isOpen(input), true);
		assert.equal(service.isOpen({ resource: input.resource }), true);
		assert.equal(service.isOpen(otherInput), true);
		assert.equal(service.isOpen({ resource: otherInput.resource }), true);

		assert.equal(activeEditorChangeEventCounter, 4);
		assert.equal(visibleEditorChangeEventCounter, 4);

		const stickyInput = new TestFileEditorInput(URI.parse('my://resource3-basics'), TEST_EDITOR_INPUT_ID);
		await service.openEditor(stickyInput, { sticky: true });

		assert.equal(3, service.count);

		const allSequentialEditors = service.getEditors(EditorsOrder.SEQUENTIAL);
		assert.equal(allSequentialEditors.length, 3);
		assert.equal(stickyInput, allSequentialEditors[0].editor);
		assert.equal(input, allSequentialEditors[1].editor);
		assert.equal(otherInput, allSequentialEditors[2].editor);

		const sequentialEditorsExcludingSticky = service.getEditors(EditorsOrder.SEQUENTIAL, { excludeSticky: true });
		assert.equal(sequentialEditorsExcludingSticky.length, 2);
		assert.equal(input, sequentialEditorsExcludingSticky[0].editor);
		assert.equal(otherInput, sequentialEditorsExcludingSticky[1].editor);

		activeEditorChangeListener.dispose();
		visibleEditorChangeListener.dispose();
		didCloseEditorListener.dispose();

		part.dispose();
	});

	test('isOpen() with side by side editor', async () => {
		const [part, service] = createEditorService();

		const input = new TestFileEditorInput(URI.parse('my://resource-openEditors'), TEST_EDITOR_INPUT_ID);
		const otherInput = new TestFileEditorInput(URI.parse('my://resource2-openEditors'), TEST_EDITOR_INPUT_ID);
		const sideBySideInput = new SideBySideEditorInput('sideBySide', '', input, otherInput);

		await part.whenRestored;

		const editor1 = await service.openEditor(sideBySideInput, { pinned: true });
		assert.equal(part.activeGroup.count, 1);

		assert.equal(service.isOpen(input), false);
		assert.equal(service.isOpen(otherInput), false);
		assert.equal(service.isOpen(sideBySideInput), true);
		assert.equal(service.isOpen({ resource: input.resource }), false);
		assert.equal(service.isOpen({ resource: otherInput.resource }), true);

		const editor2 = await service.openEditor(input, { pinned: true });
		assert.equal(part.activeGroup.count, 2);

		assert.equal(service.isOpen(input), true);
		assert.equal(service.isOpen(otherInput), false);
		assert.equal(service.isOpen(sideBySideInput), true);
		assert.equal(service.isOpen({ resource: input.resource }), true);
		assert.equal(service.isOpen({ resource: otherInput.resource }), true);

		await editor2?.group?.closeEditor(input);
		assert.equal(part.activeGroup.count, 1);

		assert.equal(service.isOpen(input), false);
		assert.equal(service.isOpen(otherInput), false);
		assert.equal(service.isOpen(sideBySideInput), true);
		assert.equal(service.isOpen({ resource: input.resource }), false);
		assert.equal(service.isOpen({ resource: otherInput.resource }), true);

		await editor1?.group?.closeEditor(sideBySideInput);

		assert.equal(service.isOpen(input), false);
		assert.equal(service.isOpen(otherInput), false);
		assert.equal(service.isOpen(sideBySideInput), false);
		assert.equal(service.isOpen({ resource: input.resource }), false);
		assert.equal(service.isOpen({ resource: otherInput.resource }), false);

		part.dispose();
	});

	test('openEditors() / replaceEditors()', async () => {
		const [part, service] = createEditorService();

		const input = new TestFileEditorInput(URI.parse('my://resource-openEditors'), TEST_EDITOR_INPUT_ID);
		const otherInput = new TestFileEditorInput(URI.parse('my://resource2-openEditors'), TEST_EDITOR_INPUT_ID);
		const replaceInput = new TestFileEditorInput(URI.parse('my://resource3-openEditors'), TEST_EDITOR_INPUT_ID);

		await part.whenRestored;

		// Open editors
		await service.openEditors([{ editor: input }, { editor: otherInput }]);
		assert.equal(part.activeGroup.count, 2);

		// Replace editors
		await service.replaceEditors([{ editor: input, replacement: replaceInput }], part.activeGroup);
		assert.equal(part.activeGroup.count, 2);
		assert.equal(part.activeGroup.getIndexOfEditor(replaceInput), 0);

		part.dispose();
	});

	test('caching', function () {
		const instantiationService = workbenchInstantiationService();
		const service = instantiationService.createInstance(EditorService);

		// Cached Input (Files)
		const fileResource1 = toResource.call(this, '/foo/bar/cache1.js');
		const fileEditorInput1 = service.createEditorInput({ resource: fileResource1 });
		assert.ok(fileEditorInput1);

		const fileResource2 = toResource.call(this, '/foo/bar/cache2.js');
		const fileEditorInput2 = service.createEditorInput({ resource: fileResource2 });
		assert.ok(fileEditorInput2);

		assert.notEqual(fileEditorInput1, fileEditorInput2);

		const fileEditorInput1Again = service.createEditorInput({ resource: fileResource1 });
		assert.equal(fileEditorInput1Again, fileEditorInput1);

		fileEditorInput1Again.dispose();

		assert.ok(fileEditorInput1.isDisposed());

		const fileEditorInput1AgainAndAgain = service.createEditorInput({ resource: fileResource1 });
		assert.notEqual(fileEditorInput1AgainAndAgain, fileEditorInput1);
		assert.ok(!fileEditorInput1AgainAndAgain.isDisposed());

		// Cached Input (Resource)
		const resource1 = URI.from({ scheme: 'custom', path: '/foo/bar/cache1.js' });
		const input1 = service.createEditorInput({ resource: resource1 });
		assert.ok(input1);

		const resource2 = URI.from({ scheme: 'custom', path: '/foo/bar/cache2.js' });
		const input2 = service.createEditorInput({ resource: resource2 });
		assert.ok(input2);

		assert.notEqual(input1, input2);

		const input1Again = service.createEditorInput({ resource: resource1 });
		assert.equal(input1Again, input1);

		input1Again.dispose();

		assert.ok(input1.isDisposed());

		const input1AgainAndAgain = service.createEditorInput({ resource: resource1 });
		assert.notEqual(input1AgainAndAgain, input1);
		assert.ok(!input1AgainAndAgain.isDisposed());
	});

	test('createEditorInput', async function () {
		const instantiationService = workbenchInstantiationService();
		const service = instantiationService.createInstance(EditorService);

		const mode = 'create-input-test';
		ModesRegistry.registerLanguage({
			id: mode,
		});

		// Untyped Input (file)
		let input = service.createEditorInput({ resource: toResource.call(this, '/index.html'), options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof FileEditorInput);
		let contentInput = <FileEditorInput>input;
		assert.strictEqual(contentInput.resource.fsPath, toResource.call(this, '/index.html').fsPath);

		// Untyped Input (file casing)
		input = service.createEditorInput({ resource: toResource.call(this, '/index.html') });
		let inputDifferentCase = service.createEditorInput({ resource: toResource.call(this, '/INDEX.html') });

		if (!isLinux) {
			assert.equal(input, inputDifferentCase);
			assert.equal(input.resource?.toString(), inputDifferentCase.resource?.toString());
		} else {
			assert.notEqual(input, inputDifferentCase);
			assert.notEqual(input.resource?.toString(), inputDifferentCase.resource?.toString());
		}

		// Typed Input
		assert.equal(service.createEditorInput(input), input);
		assert.equal(service.createEditorInput({ editor: input }), input);

		// Untyped Input (file, encoding)
		input = service.createEditorInput({ resource: toResource.call(this, '/index.html'), encoding: 'utf16le', options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof FileEditorInput);
		contentInput = <FileEditorInput>input;
		assert.equal(contentInput.getPreferredEncoding(), 'utf16le');

		// Untyped Input (file, mode)
		input = service.createEditorInput({ resource: toResource.call(this, '/index.html'), mode });
		assert(input instanceof FileEditorInput);
		contentInput = <FileEditorInput>input;
		assert.equal(contentInput.getPreferredMode(), mode);

		// Untyped Input (file, different mode)
		input = service.createEditorInput({ resource: toResource.call(this, '/index.html'), mode: 'text' });
		assert(input instanceof FileEditorInput);
		contentInput = <FileEditorInput>input;
		assert.equal(contentInput.getPreferredMode(), 'text');

		// Untyped Input (untitled)
		input = service.createEditorInput({ options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof UntitledTextEditorInput);

		// Untyped Input (untitled with contents)
		input = service.createEditorInput({ contents: 'Hello Untitled', options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof UntitledTextEditorInput);
		let model = await input.resolve() as UntitledTextEditorModel;
		assert.equal(model.textEditorModel?.getValue(), 'Hello Untitled');

		// Untyped Input (untitled with mode)
		input = service.createEditorInput({ mode, options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof UntitledTextEditorInput);
		model = await input.resolve() as UntitledTextEditorModel;
		assert.equal(model.getMode(), mode);

		// Untyped Input (untitled with file path)
		input = service.createEditorInput({ resource: URI.file('/some/path.txt'), forceUntitled: true, options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof UntitledTextEditorInput);
		assert.ok((input as UntitledTextEditorInput).model.hasAssociatedFilePath);

		// Untyped Input (untitled with untitled resource)
		input = service.createEditorInput({ resource: URI.parse('untitled://Untitled-1'), forceUntitled: true, options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof UntitledTextEditorInput);
		assert.ok(!(input as UntitledTextEditorInput).model.hasAssociatedFilePath);

		// Untyped Input (untitled with custom resource)
		const provider = instantiationService.createInstance(FileServiceProvider, 'untitled-custom');

		input = service.createEditorInput({ resource: URI.parse('untitled-custom://some/path'), forceUntitled: true, options: { selection: { startLineNumber: 1, startColumn: 1 } } });
		assert(input instanceof UntitledTextEditorInput);
		assert.ok((input as UntitledTextEditorInput).model.hasAssociatedFilePath);

		provider.dispose();

		// Untyped Input (resource)
		input = service.createEditorInput({ resource: URI.parse('custom:resource') });
		assert(input instanceof ResourceEditorInput);

		// Untyped Input (diff)
		input = service.createEditorInput({
			leftResource: toResource.call(this, '/primary.html'),
			rightResource: toResource.call(this, '/secondary.html')
		});
		assert(input instanceof DiffEditorInput);
	});

	test('delegate', function (done) {
		const instantiationService = workbenchInstantiationService();

		class MyEditor extends BaseEditor {

			constructor(id: string) {
				super(id, undefined!, new TestThemeService(), new TestStorageService());
			}

			getId(): string {
				return 'myEditor';
			}

			layout(): void { }

			createEditor(): void { }
		}

		const ed = instantiationService.createInstance(MyEditor, 'my.editor');

		const inp = instantiationService.createInstance(ResourceEditorInput, URI.parse('my://resource-delegate'), 'name', 'description', undefined);
		const delegate = instantiationService.createInstance(DelegatingEditorService, async (delegate, group, input) => {
			assert.strictEqual(input, inp);

			done();

			return ed;
		});

		delegate.openEditor(inp);
	});

	test('close editor does not dispose when editor opened in other group', async () => {
		const [part, service] = createEditorService();

		const input = new TestFileEditorInput(URI.parse('my://resource-close1'), TEST_EDITOR_INPUT_ID);

		const rootGroup = part.activeGroup;
		const rightGroup = part.addGroup(rootGroup, GroupDirection.RIGHT);

		await part.whenRestored;

		// Open input
		await service.openEditor(input, { pinned: true });
		await service.openEditor(input, { pinned: true }, rightGroup);

		const editors = service.editors;
		assert.equal(editors.length, 2);
		assert.equal(editors[0], input);
		assert.equal(editors[1], input);

		// Close input
		await rootGroup.closeEditor(input);
		assert.equal(input.isDisposed(), false);

		await rightGroup.closeEditor(input);
		assert.equal(input.isDisposed(), true);

		part.dispose();
	});

	test('open to the side', async () => {
		const [part, service] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('my://resource1-openside'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('my://resource2-openside'), TEST_EDITOR_INPUT_ID);

		const rootGroup = part.activeGroup;

		await part.whenRestored;

		await service.openEditor(input1, { pinned: true }, rootGroup);
		let editor = await service.openEditor(input1, { pinned: true, preserveFocus: true }, SIDE_GROUP);

		assert.equal(part.activeGroup, rootGroup);
		assert.equal(part.count, 2);
		assert.equal(editor?.group, part.groups[1]);

		// Open to the side uses existing neighbour group if any
		editor = await service.openEditor(input2, { pinned: true, preserveFocus: true }, SIDE_GROUP);
		assert.equal(part.activeGroup, rootGroup);
		assert.equal(part.count, 2);
		assert.equal(editor?.group, part.groups[1]);

		part.dispose();
	});

	test('editor group activation', async () => {
		const [part, service] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('my://resource1-openside'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('my://resource2-openside'), TEST_EDITOR_INPUT_ID);

		const rootGroup = part.activeGroup;

		await part.whenRestored;

		await service.openEditor(input1, { pinned: true }, rootGroup);
		let editor = await service.openEditor(input2, { pinned: true, preserveFocus: true, activation: EditorActivation.ACTIVATE }, SIDE_GROUP);
		const sideGroup = editor?.group;

		assert.equal(part.activeGroup, sideGroup);

		editor = await service.openEditor(input1, { pinned: true, preserveFocus: true, activation: EditorActivation.PRESERVE }, rootGroup);
		assert.equal(part.activeGroup, sideGroup);

		editor = await service.openEditor(input1, { pinned: true, preserveFocus: true, activation: EditorActivation.ACTIVATE }, rootGroup);
		assert.equal(part.activeGroup, rootGroup);

		editor = await service.openEditor(input2, { pinned: true, activation: EditorActivation.PRESERVE }, sideGroup);
		assert.equal(part.activeGroup, rootGroup);

		editor = await service.openEditor(input2, { pinned: true, activation: EditorActivation.ACTIVATE }, sideGroup);
		assert.equal(part.activeGroup, sideGroup);

		part.arrangeGroups(GroupsArrangement.MINIMIZE_OTHERS);
		editor = await service.openEditor(input1, { pinned: true, preserveFocus: true, activation: EditorActivation.RESTORE }, rootGroup);
		assert.equal(part.activeGroup, sideGroup);

		part.dispose();
	});

	test('active editor change / visible editor change events', async function () {
		const [part, service] = createEditorService();

		let input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		let otherInput = new TestFileEditorInput(URI.parse('my://resource2-active'), TEST_EDITOR_INPUT_ID);

		let activeEditorChangeEventFired = false;
		const activeEditorChangeListener = service.onDidActiveEditorChange(() => {
			activeEditorChangeEventFired = true;
		});

		let visibleEditorChangeEventFired = false;
		const visibleEditorChangeListener = service.onDidVisibleEditorsChange(() => {
			visibleEditorChangeEventFired = true;
		});

		function assertActiveEditorChangedEvent(expected: boolean) {
			assert.equal(activeEditorChangeEventFired, expected, `Unexpected active editor change state (got ${activeEditorChangeEventFired}, expected ${expected})`);
			activeEditorChangeEventFired = false;
		}

		function assertVisibleEditorsChangedEvent(expected: boolean) {
			assert.equal(visibleEditorChangeEventFired, expected, `Unexpected visible editors change state (got ${visibleEditorChangeEventFired}, expected ${expected})`);
			visibleEditorChangeEventFired = false;
		}

		async function closeEditorAndWaitForNextToOpen(group: IEditorGroup, input: EditorInput): Promise<void> {
			await group.closeEditor(input);
			await timeout(0); // closing an editor will not immediately open the next one, so we need to wait
		}

		await part.whenRestored;

		// 1.) open, open same, open other, close
		let editor = await service.openEditor(input, { pinned: true });
		const group = editor?.group!;
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		editor = await service.openEditor(input);
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		editor = await service.openEditor(otherInput);
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		await closeEditorAndWaitForNextToOpen(group, otherInput);
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		await closeEditorAndWaitForNextToOpen(group, input);
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		// 2.) open, open same (forced open) (recreate inputs that got disposed)
		input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		otherInput = new TestFileEditorInput(URI.parse('my://resource2-active'), TEST_EDITOR_INPUT_ID);
		editor = await service.openEditor(input);
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		editor = await service.openEditor(input, { forceReload: true });
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		await closeEditorAndWaitForNextToOpen(group, input);

		// 3.) open, open inactive, close (recreate inputs that got disposed)
		input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		otherInput = new TestFileEditorInput(URI.parse('my://resource2-active'), TEST_EDITOR_INPUT_ID);
		editor = await service.openEditor(input, { pinned: true });
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		editor = await service.openEditor(otherInput, { inactive: true });
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		await group.closeAllEditors();
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		// 4.) open, open inactive, close inactive (recreate inputs that got disposed)
		input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		otherInput = new TestFileEditorInput(URI.parse('my://resource2-active'), TEST_EDITOR_INPUT_ID);
		editor = await service.openEditor(input, { pinned: true });
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		editor = await service.openEditor(otherInput, { inactive: true });
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		await closeEditorAndWaitForNextToOpen(group, otherInput);
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		await group.closeAllEditors();
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		// 5.) add group, remove group (recreate inputs that got disposed)
		input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		otherInput = new TestFileEditorInput(URI.parse('my://resource2-active'), TEST_EDITOR_INPUT_ID);
		editor = await service.openEditor(input, { pinned: true });
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		let rightGroup = part.addGroup(part.activeGroup, GroupDirection.RIGHT);
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		rightGroup.focus();
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(false);

		part.removeGroup(rightGroup);
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(false);

		await group.closeAllEditors();
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		// 6.) open editor in inactive group (recreate inputs that got disposed)
		input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		otherInput = new TestFileEditorInput(URI.parse('my://resource2-active'), TEST_EDITOR_INPUT_ID);
		editor = await service.openEditor(input, { pinned: true });
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		rightGroup = part.addGroup(part.activeGroup, GroupDirection.RIGHT);
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		await rightGroup.openEditor(otherInput);
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		await closeEditorAndWaitForNextToOpen(rightGroup, otherInput);
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		await group.closeAllEditors();
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		// 7.) activate group (recreate inputs that got disposed)
		input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		otherInput = new TestFileEditorInput(URI.parse('my://resource2-active'), TEST_EDITOR_INPUT_ID);
		editor = await service.openEditor(input, { pinned: true });
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		rightGroup = part.addGroup(part.activeGroup, GroupDirection.RIGHT);
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		await rightGroup.openEditor(otherInput);
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		group.focus();
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(false);

		await closeEditorAndWaitForNextToOpen(rightGroup, otherInput);
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(true);

		await group.closeAllEditors();
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		// 8.) move editor (recreate inputs that got disposed)
		input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		otherInput = new TestFileEditorInput(URI.parse('my://resource2-active'), TEST_EDITOR_INPUT_ID);
		editor = await service.openEditor(input, { pinned: true });
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		editor = await service.openEditor(otherInput, { pinned: true });
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		group.moveEditor(otherInput, group, { index: 0 });
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		await group.closeAllEditors();
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		// 9.) close editor in inactive group (recreate inputs that got disposed)
		input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		otherInput = new TestFileEditorInput(URI.parse('my://resource2-active'), TEST_EDITOR_INPUT_ID);
		editor = await service.openEditor(input, { pinned: true });
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		rightGroup = part.addGroup(part.activeGroup, GroupDirection.RIGHT);
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(false);

		await rightGroup.openEditor(otherInput);
		assertActiveEditorChangedEvent(true);
		assertVisibleEditorsChangedEvent(true);

		await closeEditorAndWaitForNextToOpen(group, input);
		assertActiveEditorChangedEvent(false);
		assertVisibleEditorsChangedEvent(true);

		// cleanup
		activeEditorChangeListener.dispose();
		visibleEditorChangeListener.dispose();

		part.dispose();
	});

	test('two active editor change events when opening editor to the side', async function () {
		const [part, service] = createEditorService();

		let input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);

		let activeEditorChangeEvents = 0;
		const activeEditorChangeListener = service.onDidActiveEditorChange(() => {
			activeEditorChangeEvents++;
		});

		function assertActiveEditorChangedEvent(expected: number) {
			assert.equal(activeEditorChangeEvents, expected, `Unexpected active editor change state (got ${activeEditorChangeEvents}, expected ${expected})`);
			activeEditorChangeEvents = 0;
		}

		await part.whenRestored;

		await service.openEditor(input, { pinned: true });
		assertActiveEditorChangedEvent(1);

		await service.openEditor(input, { pinned: true }, SIDE_GROUP);

		// we expect 2 active editor change events: one for the fact that the
		// active editor is now in the side group but also one for when the
		// editor has finished loading. we used to ignore that second change
		// event, however many listeners are interested on the active editor
		// when it has fully loaded (e.g. a model is set). as such, we cannot
		// simply ignore that second event from the editor service, even though
		// the actual editor input is the same
		assertActiveEditorChangedEvent(2);

		// cleanup
		activeEditorChangeListener.dispose();

		part.dispose();
	});

	test('activeTextEditorControl / activeTextEditorMode', async () => {
		const [part, service] = createEditorService();

		await part.whenRestored;

		// Open untitled input
		let editor = await service.openEditor({});

		assert.equal(service.activeEditorPane, editor);
		assert.equal(service.activeTextEditorControl, editor?.getControl());
		assert.equal(service.activeTextEditorMode, 'plaintext');

		part.dispose();
	});

	test('openEditor returns NULL when opening fails or is inactive', async function () {
		const [part, service] = createEditorService();

		const input = new TestFileEditorInput(URI.parse('my://resource-active'), TEST_EDITOR_INPUT_ID);
		const otherInput = new TestFileEditorInput(URI.parse('my://resource2-inactive'), TEST_EDITOR_INPUT_ID);
		const failingInput = new TestFileEditorInput(URI.parse('my://resource3-failing'), TEST_EDITOR_INPUT_ID);
		failingInput.setFailToOpen();

		await part.whenRestored;

		let editor = await service.openEditor(input, { pinned: true });
		assert.ok(editor);

		let otherEditor = await service.openEditor(otherInput, { inactive: true });
		assert.ok(!otherEditor);

		let failingEditor = await service.openEditor(failingInput);
		assert.ok(!failingEditor);

		part.dispose();
	});

	test('save, saveAll, revertAll', async function () {
		const [part, service] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('my://resource1'), TEST_EDITOR_INPUT_ID);
		input1.dirty = true;
		const input2 = new TestFileEditorInput(URI.parse('my://resource2'), TEST_EDITOR_INPUT_ID);
		input2.dirty = true;
		const sameInput1 = new TestFileEditorInput(URI.parse('my://resource1'), TEST_EDITOR_INPUT_ID);
		sameInput1.dirty = true;

		const rootGroup = part.activeGroup;

		await part.whenRestored;

		await service.openEditor(input1, { pinned: true });
		await service.openEditor(input2, { pinned: true });
		await service.openEditor(sameInput1, { pinned: true }, SIDE_GROUP);

		await service.save({ groupId: rootGroup.id, editor: input1 });
		assert.equal(input1.gotSaved, true);

		input1.gotSaved = false;
		input1.gotSavedAs = false;
		input1.gotReverted = false;

		input1.dirty = true;
		input2.dirty = true;
		sameInput1.dirty = true;

		await service.save({ groupId: rootGroup.id, editor: input1 }, { saveAs: true });
		assert.equal(input1.gotSavedAs, true);

		input1.gotSaved = false;
		input1.gotSavedAs = false;
		input1.gotReverted = false;

		input1.dirty = true;
		input2.dirty = true;
		sameInput1.dirty = true;

		const revertRes = await service.revertAll();
		assert.equal(revertRes, true);
		assert.equal(input1.gotReverted, true);

		input1.gotSaved = false;
		input1.gotSavedAs = false;
		input1.gotReverted = false;

		input1.dirty = true;
		input2.dirty = true;
		sameInput1.dirty = true;

		const saveRes = await service.saveAll();
		assert.equal(saveRes, true);
		assert.equal(input1.gotSaved, true);
		assert.equal(input2.gotSaved, true);

		input1.gotSaved = false;
		input1.gotSavedAs = false;
		input1.gotReverted = false;
		input2.gotSaved = false;
		input2.gotSavedAs = false;
		input2.gotReverted = false;

		input1.dirty = true;
		input2.dirty = true;
		sameInput1.dirty = true;

		await service.saveAll({ saveAs: true });

		assert.equal(input1.gotSavedAs, true);
		assert.equal(input2.gotSavedAs, true);

		// services dedupes inputs automatically
		assert.equal(sameInput1.gotSaved, false);
		assert.equal(sameInput1.gotSavedAs, false);
		assert.equal(sameInput1.gotReverted, false);

		part.dispose();
	});

	test('saveAll, revertAll (sticky editor)', async function () {
		const [part, service] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('my://resource1'), TEST_EDITOR_INPUT_ID);
		input1.dirty = true;
		const input2 = new TestFileEditorInput(URI.parse('my://resource2'), TEST_EDITOR_INPUT_ID);
		input2.dirty = true;
		const sameInput1 = new TestFileEditorInput(URI.parse('my://resource1'), TEST_EDITOR_INPUT_ID);
		sameInput1.dirty = true;

		await part.whenRestored;

		await service.openEditor(input1, { pinned: true, sticky: true });
		await service.openEditor(input2, { pinned: true });
		await service.openEditor(sameInput1, { pinned: true }, SIDE_GROUP);

		const revertRes = await service.revertAll({ excludeSticky: true });
		assert.equal(revertRes, true);
		assert.equal(input1.gotReverted, false);
		assert.equal(sameInput1.gotReverted, true);

		input1.gotSaved = false;
		input1.gotSavedAs = false;
		input1.gotReverted = false;

		sameInput1.gotSaved = false;
		sameInput1.gotSavedAs = false;
		sameInput1.gotReverted = false;

		input1.dirty = true;
		input2.dirty = true;
		sameInput1.dirty = true;

		const saveRes = await service.saveAll({ excludeSticky: true });
		assert.equal(saveRes, true);
		assert.equal(input1.gotSaved, false);
		assert.equal(input2.gotSaved, true);
		assert.equal(sameInput1.gotSaved, true);

		part.dispose();
	});

	test('file delete closes editor', async function () {
		return testFileDeleteEditorClose(false);
	});

	test('file delete leaves dirty editors open', function () {
		return testFileDeleteEditorClose(true);
	});

	async function testFileDeleteEditorClose(dirty: boolean): Promise<void> {
		const [part, service, accessor] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('my://resource1'), TEST_EDITOR_INPUT_ID);
		input1.dirty = dirty;
		const input2 = new TestFileEditorInput(URI.parse('my://resource2'), TEST_EDITOR_INPUT_ID);
		input2.dirty = dirty;

		const rootGroup = part.activeGroup;

		await part.whenRestored;

		await service.openEditor(input1, { pinned: true });
		await service.openEditor(input2, { pinned: true });

		assert.equal(rootGroup.activeEditor, input2);

		const activeEditorChangePromise = awaitActiveEditorChange(service);
		accessor.fileService.fireAfterOperation(new FileOperationEvent(input2.resource, FileOperation.DELETE));
		if (!dirty) {
			await activeEditorChangePromise;
		}

		if (dirty) {
			assert.equal(rootGroup.activeEditor, input2);
		} else {
			assert.equal(rootGroup.activeEditor, input1);
		}

		part.dispose();
	}

	test('file move asks input to move', async function () {
		const [part, service, accessor] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('my://resource1'), TEST_EDITOR_INPUT_ID);
		const movedInput = new TestFileEditorInput(URI.parse('my://resource2'), TEST_EDITOR_INPUT_ID);
		input1.movedEditor = { editor: movedInput };

		const rootGroup = part.activeGroup;

		await part.whenRestored;

		await service.openEditor(input1, { pinned: true });

		const activeEditorChangePromise = awaitActiveEditorChange(service);
		accessor.fileService.fireAfterOperation(new FileOperationEvent(input1.resource, FileOperation.MOVE, {
			resource: movedInput.resource,
			ctime: 0,
			etag: '',
			isDirectory: false,
			isFile: true,
			mtime: 0,
			name: 'resource2',
			size: 0,
			isSymbolicLink: false
		}));
		await activeEditorChangePromise;

		assert.equal(rootGroup.activeEditor, movedInput);

		part.dispose();
	});

	function awaitActiveEditorChange(editorService: IEditorService): Promise<void> {
		return new Promise(c => {
			Event.once(editorService.onDidActiveEditorChange)(c);
		});
	}

	test('file watcher gets installed for out of workspace files', async function () {
		const [part, service, accessor] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('file://resource1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('file://resource2'), TEST_EDITOR_INPUT_ID);

		await part.whenRestored;

		await service.openEditor(input1, { pinned: true });
		assert.equal(accessor.fileService.watches.length, 1);
		assert.equal(accessor.fileService.watches[0].toString(), input1.resource.toString());

		const editor = await service.openEditor(input2, { pinned: true });
		assert.equal(accessor.fileService.watches.length, 1);
		assert.equal(accessor.fileService.watches[0].toString(), input2.resource.toString());

		await editor?.group?.closeAllEditors();
		assert.equal(accessor.fileService.watches.length, 0);

		part.dispose();
	});

	test('invokeWithinEditorContext', async function () {
		const [part, service] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('file://resource1'), TEST_EDITOR_INPUT_ID);
		new TestFileEditorInput(URI.parse('file://resource2'), TEST_EDITOR_INPUT_ID);

		await part.whenRestored;

		await service.openEditor(input1, { pinned: true });

		let hasAccessor = false;
		service.invokeWithinEditorContext(accessor => {
			hasAccessor = true;
		});

		assert.ok(hasAccessor);

		part.dispose();
	});

	test('overrideOpenEditor', async function () {
		const [part, service] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('file://resource1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('file://resource2'), TEST_EDITOR_INPUT_ID);

		await part.whenRestored;

		let overrideCalled = false;

		const handler = service.overrideOpenEditor({
			open: editor => {
				if (editor === input1) {
					overrideCalled = true;

					return { override: service.openEditor(input2, { pinned: true }) };
				}

				return undefined;
			}
		});

		await service.openEditor(input1, { pinned: true });

		assert.ok(overrideCalled);
		assert.equal(service.activeEditor, input2);

		handler.dispose();
		part.dispose();
	});

	test('whenClosed', async function () {
		const [part, service] = createEditorService();

		const input1 = new TestFileEditorInput(URI.parse('file://resource1'), TEST_EDITOR_INPUT_ID);
		const input2 = new TestFileEditorInput(URI.parse('file://resource2'), TEST_EDITOR_INPUT_ID);

		await part.whenRestored;

		const editor = await service.openEditor(input1, { pinned: true });
		await service.openEditor(input2, { pinned: true });

		const whenClosed = service.whenClosed([{ resource: input1.resource }, { resource: input2.resource }]);

		editor?.group?.closeAllEditors();

		await whenClosed;

		part.dispose();
	});
});
