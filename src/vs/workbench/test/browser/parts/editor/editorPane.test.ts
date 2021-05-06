/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorPane, EditorMemento } from 'vs/workbench/browser/parts/editor/editorPane';
import { EditorInput, EditorOptions, IEditorInputSerializer, IEditorInputFactoryRegistry, EditorExtensions } from 'vs/workbench/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { workbenchInstantiationService, TestEditorGroupView, TestEditorGroupsService, registerTestResourceEditor, TestEditorInput } from 'vs/workbench/test/browser/workbenchTestServices';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { URI } from 'vs/base/common/uri';
import { IEditorRegistry, EditorDescriptor } from 'vs/workbench/browser/editor';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorModel } from 'vs/platform/editor/common/editor';
import { DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { extUri } from 'vs/base/common/resources';

const NullThemeService = new TestThemeService();

let EditorRegistry: IEditorRegistry = Registry.as(EditorExtensions.Editors);
let EditorInputRegistry: IEditorInputFactoryRegistry = Registry.as(EditorExtensions.EditorInputFactories);

class TestEditor extends EditorPane {

	constructor(@ITelemetryService telemetryService: ITelemetryService) {
		super('TestEditor', NullTelemetryService, NullThemeService, new TestStorageService());
	}

	override getId(): string { return 'testEditor'; }
	layout(): void { }
	createEditor(): any { }
}

export class OtherTestEditor extends EditorPane {

	constructor(@ITelemetryService telemetryService: ITelemetryService) {
		super('testOtherEditor', NullTelemetryService, NullThemeService, new TestStorageService());
	}

	override getId(): string { return 'testOtherEditor'; }

	layout(): void { }
	createEditor(): any { }
}

class TestInputSerializer implements IEditorInputSerializer {

	canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	serialize(input: EditorInput): string {
		return input.toString();
	}

	deserialize(instantiationService: IInstantiationService, raw: string): EditorInput {
		return {} as EditorInput;
	}
}

class TestInput extends EditorInput {

	readonly resource = undefined;

	override getPreferredEditorId(ids: string[]) {
		return ids[1];
	}

	override get typeId(): string {
		return 'testInput';
	}

	override resolve(): any {
		return null;
	}
}

class OtherTestInput extends EditorInput {

	readonly resource = undefined;

	override get typeId(): string {
		return 'otherTestInput';
	}

	override resolve(): any {
		return null;
	}
}
class TestResourceEditorInput extends ResourceEditorInput { }

suite('Workbench EditorPane', () => {

	test('EditorPane API', async () => {
		let e = new TestEditor(NullTelemetryService);
		let input = new OtherTestInput();
		let options = new EditorOptions();

		assert(!e.isVisible());
		assert(!e.input);

		await e.setInput(input, options, Object.create(null), CancellationToken.None);
		assert.strictEqual(<any>input, e.input);
		const group = new TestEditorGroupView(1);
		e.setVisible(true, group);
		assert(e.isVisible());
		assert.strictEqual(e.group, group);
		input.onWillDispose(() => {
			assert(false);
		});
		e.dispose();
		e.clearInput();
		e.setVisible(false, group);
		assert(!e.isVisible());
		assert(!e.input);
		assert(!e.getControl());
	});

	test('EditorDescriptor', () => {
		let d = EditorDescriptor.create(TestEditor, 'id', 'name');
		assert.strictEqual(d.getId(), 'id');
		assert.strictEqual(d.getName(), 'name');
	});

	test('Editor Registration', function () {
		let d1 = EditorDescriptor.create(TestEditor, 'id1', 'name');
		let d2 = EditorDescriptor.create(OtherTestEditor, 'id2', 'name');

		let oldEditorsCnt = EditorRegistry.getEditors().length;
		let oldInputCnt = (<any>EditorRegistry).getEditorInputs().length;

		const dispose1 = EditorRegistry.registerEditor(d1, [new SyncDescriptor(TestInput)]);
		const dispose2 = EditorRegistry.registerEditor(d2, [new SyncDescriptor(TestInput), new SyncDescriptor(OtherTestInput)]);

		assert.strictEqual(EditorRegistry.getEditors().length, oldEditorsCnt + 2);
		assert.strictEqual((<any>EditorRegistry).getEditorInputs().length, oldInputCnt + 3);

		assert.strictEqual(EditorRegistry.getEditor(new TestInput()), d2);
		assert.strictEqual(EditorRegistry.getEditor(new OtherTestInput()), d2);

		assert.strictEqual(EditorRegistry.getEditorById('id1'), d1);
		assert.strictEqual(EditorRegistry.getEditorById('id2'), d2);
		assert(!EditorRegistry.getEditorById('id3'));

		dispose([dispose1, dispose2]);
	});

	test('Editor Lookup favors specific class over superclass (match on specific class)', function () {
		let d1 = EditorDescriptor.create(TestEditor, 'id1', 'name');

		const disposables = new DisposableStore();

		disposables.add(registerTestResourceEditor());
		disposables.add(EditorRegistry.registerEditor(d1, [new SyncDescriptor(TestResourceEditorInput)]));

		let inst = workbenchInstantiationService();

		const editor = EditorRegistry.getEditor(inst.createInstance(TestResourceEditorInput, URI.file('/fake'), 'fake', '', undefined))!.instantiate(inst);
		assert.strictEqual(editor.getId(), 'testEditor');

		const otherEditor = EditorRegistry.getEditor(inst.createInstance(ResourceEditorInput, URI.file('/fake'), 'fake', '', undefined))!.instantiate(inst);
		assert.strictEqual(otherEditor.getId(), 'workbench.editors.textResourceEditor');

		disposables.dispose();
	});

	test('Editor Lookup favors specific class over superclass (match on super class)', function () {
		let inst = workbenchInstantiationService();

		const disposables = new DisposableStore();

		disposables.add(registerTestResourceEditor());
		const editor = EditorRegistry.getEditor(inst.createInstance(TestResourceEditorInput, URI.file('/fake'), 'fake', '', undefined))!.instantiate(inst);

		assert.strictEqual('workbench.editors.textResourceEditor', editor.getId());

		disposables.dispose();
	});

	test('Editor Input Serializer', function () {
		const testInput = new TestEditorInput(URI.file('/fake'), 'testTypeId');
		workbenchInstantiationService().invokeFunction(accessor => EditorInputRegistry.start(accessor));
		const disposable = EditorInputRegistry.registerEditorInputSerializer(testInput.typeId, TestInputSerializer);

		let factory = EditorInputRegistry.getEditorInputSerializer('testTypeId');
		assert(factory);

		factory = EditorInputRegistry.getEditorInputSerializer(testInput);
		assert(factory);

		// throws when registering serializer for same type
		assert.throws(() => EditorInputRegistry.registerEditorInputSerializer(testInput.typeId, TestInputSerializer));

		disposable.dispose();
	});

	test('EditorMemento - basics', function () {
		const testGroup0 = new TestEditorGroupView(0);
		const testGroup1 = new TestEditorGroupView(1);
		const testGroup4 = new TestEditorGroupView(4);

		const editorGroupService = new TestEditorGroupsService([
			testGroup0,
			testGroup1,
			new TestEditorGroupView(2)
		]);

		interface TestViewState {
			line: number;
		}

		const rawMemento = Object.create(null);
		let memento = new EditorMemento<TestViewState>('id', 'key', rawMemento, 3, editorGroupService);

		let res = memento.loadEditorState(testGroup0, URI.file('/A'));
		assert.ok(!res);

		memento.saveEditorState(testGroup0, URI.file('/A'), { line: 3 });
		res = memento.loadEditorState(testGroup0, URI.file('/A'));
		assert.ok(res);
		assert.strictEqual(res!.line, 3);

		memento.saveEditorState(testGroup1, URI.file('/A'), { line: 5 });
		res = memento.loadEditorState(testGroup1, URI.file('/A'));
		assert.ok(res);
		assert.strictEqual(res!.line, 5);

		// Ensure capped at 3 elements
		memento.saveEditorState(testGroup0, URI.file('/B'), { line: 1 });
		memento.saveEditorState(testGroup0, URI.file('/C'), { line: 1 });
		memento.saveEditorState(testGroup0, URI.file('/D'), { line: 1 });
		memento.saveEditorState(testGroup0, URI.file('/E'), { line: 1 });

		assert.ok(!memento.loadEditorState(testGroup0, URI.file('/A')));
		assert.ok(!memento.loadEditorState(testGroup0, URI.file('/B')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/C')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/D')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/E')));

		// Save at an unknown group
		memento.saveEditorState(testGroup4, URI.file('/E'), { line: 1 });
		assert.ok(memento.loadEditorState(testGroup4, URI.file('/E'))); // only gets removed when memento is saved
		memento.saveEditorState(testGroup4, URI.file('/C'), { line: 1 });
		assert.ok(memento.loadEditorState(testGroup4, URI.file('/C'))); // only gets removed when memento is saved

		memento.saveState();

		memento = new EditorMemento('id', 'key', rawMemento, 3, editorGroupService);
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/C')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/D')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/E')));

		// Check on entries no longer there from invalid groups
		assert.ok(!memento.loadEditorState(testGroup4, URI.file('/E')));
		assert.ok(!memento.loadEditorState(testGroup4, URI.file('/C')));

		memento.clearEditorState(URI.file('/C'), testGroup4);
		memento.clearEditorState(URI.file('/E'));

		assert.ok(!memento.loadEditorState(testGroup4, URI.file('/C')));
		assert.ok(memento.loadEditorState(testGroup0, URI.file('/D')));
		assert.ok(!memento.loadEditorState(testGroup0, URI.file('/E')));
	});

	test('EditorMemento - move', function () {
		const testGroup0 = new TestEditorGroupView(0);

		const editorGroupService = new TestEditorGroupsService([testGroup0]);

		interface TestViewState { line: number; }

		const rawMemento = Object.create(null);
		let memento = new EditorMemento<TestViewState>('id', 'key', rawMemento, 3, editorGroupService);

		memento.saveEditorState(testGroup0, URI.file('/some/folder/file-1.txt'), { line: 1 });
		memento.saveEditorState(testGroup0, URI.file('/some/folder/file-2.txt'), { line: 2 });
		memento.saveEditorState(testGroup0, URI.file('/some/other/file.txt'), { line: 3 });

		memento.moveEditorState(URI.file('/some/folder/file-1.txt'), URI.file('/some/folder/file-moved.txt'), extUri);

		let res = memento.loadEditorState(testGroup0, URI.file('/some/folder/file-1.txt'));
		assert.ok(!res);

		res = memento.loadEditorState(testGroup0, URI.file('/some/folder/file-moved.txt'));
		assert.strictEqual(res?.line, 1);

		memento.moveEditorState(URI.file('/some/folder'), URI.file('/some/folder-moved'), extUri);

		res = memento.loadEditorState(testGroup0, URI.file('/some/folder-moved/file-moved.txt'));
		assert.strictEqual(res?.line, 1);

		res = memento.loadEditorState(testGroup0, URI.file('/some/folder-moved/file-2.txt'));
		assert.strictEqual(res?.line, 2);
	});

	test('EditoMemento - use with editor input', function () {
		const testGroup0 = new TestEditorGroupView(0);

		interface TestViewState {
			line: number;
		}

		class TestEditorInput extends EditorInput {
			constructor(public resource: URI, private id = 'testEditorInputForMementoTest') {
				super();
			}
			override get typeId() { return 'testEditorInputForMementoTest'; }
			override async resolve(): Promise<IEditorModel | null> { return null; }

			override matches(other: TestEditorInput): boolean {
				return other && this.id === other.id && other instanceof TestEditorInput;
			}
		}

		const rawMemento = Object.create(null);
		let memento = new EditorMemento<TestViewState>('id', 'key', rawMemento, 3, new TestEditorGroupsService());

		const testInputA = new TestEditorInput(URI.file('/A'));

		let res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(!res);

		memento.saveEditorState(testGroup0, testInputA, { line: 3 });
		res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(res);
		assert.strictEqual(res!.line, 3);

		// State removed when input gets disposed
		testInputA.dispose();
		res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(!res);
	});

	test('EditoMemento - clear on editor dispose', function () {
		const testGroup0 = new TestEditorGroupView(0);

		interface TestViewState {
			line: number;
		}

		class TestEditorInput extends EditorInput {
			constructor(public resource: URI, private id = 'testEditorInputForMementoTest') {
				super();
			}
			override get typeId() { return 'testEditorInputForMementoTest'; }
			override async resolve(): Promise<IEditorModel | null> { return null; }

			override matches(other: TestEditorInput): boolean {
				return other && this.id === other.id && other instanceof TestEditorInput;
			}
		}

		const rawMemento = Object.create(null);
		let memento = new EditorMemento<TestViewState>('id', 'key', rawMemento, 3, new TestEditorGroupsService());

		const testInputA = new TestEditorInput(URI.file('/A'));

		let res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(!res);

		memento.saveEditorState(testGroup0, testInputA.resource, { line: 3 });
		res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(res);
		assert.strictEqual(res!.line, 3);

		// State not yet removed when input gets disposed
		// because we used resource
		testInputA.dispose();
		res = memento.loadEditorState(testGroup0, testInputA);
		assert.ok(res);

		const testInputB = new TestEditorInput(URI.file('/B'));

		res = memento.loadEditorState(testGroup0, testInputB);
		assert.ok(!res);

		memento.saveEditorState(testGroup0, testInputB.resource, { line: 3 });
		res = memento.loadEditorState(testGroup0, testInputB);
		assert.ok(res);
		assert.strictEqual(res!.line, 3);

		memento.clearEditorStateOnDispose(testInputB.resource, testInputB);

		// State removed when input gets disposed
		testInputB.dispose();
		res = memento.loadEditorState(testGroup0, testInputB);
		assert.ok(!res);
	});
});
