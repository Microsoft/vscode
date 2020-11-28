/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorPane, EditorMemento } from 'vs/workbench/browser/parts/editor/editorPane';
import { EditorInput, EditorOptions, IEditorInputFactory, IEditorInputFactoryRegistry, Extensions as EditorExtensions } from 'vs/workbench/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import * as Platform from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { workbenchInstantiationService, TestEditorGroupView, TestEditorGroupsService } from 'vs/workbench/test/browser/workbenchTestServices';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { URI } from 'vs/base/common/uri';
import { IEditorRegistry, Extensions, EditorDescriptor } from 'vs/workbench/browser/editor';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorModel } from 'vs/platform/editor/common/editor';
import { dispose } from 'vs/base/common/lifecycle';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';
import { extUri } from 'vs/base/common/resources';

const NullThemeService = new TestThemeService();

let EditorRegistry: IEditorRegistry = Platform.Registry.as(Extensions.Editors);
let EditorInputRegistry: IEditorInputFactoryRegistry = Platform.Registry.as(EditorExtensions.EditorInputFactories);

export class MyEditor extends EditorPane {

	constructor(@ITelemetryService telemetryService: ITelemetryService) {
		super('MyEditor', NullTelemetryService, NullThemeService, new TestStorageService());
	}

	getId(): string { return 'myEditor'; }
	layout(): void { }
	createEditor(): any { }
}

export class MyOtherEditor extends EditorPane {

	constructor(@ITelemetryService telemetryService: ITelemetryService) {
		super('myOtherEditor', NullTelemetryService, NullThemeService, new TestStorageService());
	}

	getId(): string { return 'myOtherEditor'; }

	layout(): void { }
	createEditor(): any { }
}

class MyInputFactory implements IEditorInputFactory {

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

class MyInput extends EditorInput {

	readonly resource = undefined;

	getPreferredEditorId(ids: string[]) {
		return ids[1];
	}

	getTypeId(): string {
		return '';
	}

	resolve(): any {
		return null;
	}
}

class MyOtherInput extends EditorInput {

	readonly resource = undefined;

	getTypeId(): string {
		return '';
	}

	resolve(): any {
		return null;
	}
}
class MyResourceEditorInput extends ResourceEditorInput { }

suite('Workbench EditorPane', () => {

	test('EditorPane API', async () => {
		let e = new MyEditor(NullTelemetryService);
		let input = new MyOtherInput();
		let options = new EditorOptions();

		assert(!e.isVisible());
		assert(!e.input);

		await e.setInput(input, options, Object.create(null), CancellationToken.None);
		assert.strictEqual(input, e.input);
		const group = new TestEditorGroupView(1);
		e.setVisible(true, group);
		assert(e.isVisible());
		assert.equal(e.group, group);
		input.onDispose(() => {
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
		let d = EditorDescriptor.create(MyEditor, 'id', 'name');
		assert.strictEqual(d.getId(), 'id');
		assert.strictEqual(d.getName(), 'name');
	});

	test('Editor Registration', function () {
		let d1 = EditorDescriptor.create(MyEditor, 'id1', 'name');
		let d2 = EditorDescriptor.create(MyOtherEditor, 'id2', 'name');

		let oldEditorsCnt = EditorRegistry.getEditors().length;
		let oldInputCnt = (<any>EditorRegistry).getEditorInputs().length;

		const dispose1 = EditorRegistry.registerEditor(d1, [new SyncDescriptor(MyInput)]);
		const dispose2 = EditorRegistry.registerEditor(d2, [new SyncDescriptor(MyInput), new SyncDescriptor(MyOtherInput)]);

		assert.equal(EditorRegistry.getEditors().length, oldEditorsCnt + 2);
		assert.equal((<any>EditorRegistry).getEditorInputs().length, oldInputCnt + 3);

		assert.strictEqual(EditorRegistry.getEditor(new MyInput()), d2);
		assert.strictEqual(EditorRegistry.getEditor(new MyOtherInput()), d2);

		assert.strictEqual(EditorRegistry.getEditorById('id1'), d1);
		assert.strictEqual(EditorRegistry.getEditorById('id2'), d2);
		assert(!EditorRegistry.getEditorById('id3'));

		dispose([dispose1, dispose2]);
	});

	test('Editor Lookup favors specific class over superclass (match on specific class)', function () {
		let d1 = EditorDescriptor.create(MyEditor, 'id1', 'name');

		const disposable = EditorRegistry.registerEditor(d1, [new SyncDescriptor(MyResourceEditorInput)]);

		let inst = workbenchInstantiationService();

		const editor = EditorRegistry.getEditor(inst.createInstance(MyResourceEditorInput, URI.file('/fake'), 'fake', '', undefined))!.instantiate(inst);
		assert.strictEqual(editor.getId(), 'myEditor');

		const otherEditor = EditorRegistry.getEditor(inst.createInstance(ResourceEditorInput, URI.file('/fake'), 'fake', '', undefined))!.instantiate(inst);
		assert.strictEqual(otherEditor.getId(), 'workbench.editors.textResourceEditor');

		disposable.dispose();
	});

	test('Editor Lookup favors specific class over superclass (match on super class)', function () {
		let inst = workbenchInstantiationService();

		const editor = EditorRegistry.getEditor(inst.createInstance(MyResourceEditorInput, URI.file('/fake'), 'fake', '', undefined))!.instantiate(inst);
		assert.strictEqual('workbench.editors.textResourceEditor', editor.getId());
	});

	test('Editor Input Factory', function () {
		workbenchInstantiationService().invokeFunction(accessor => EditorInputRegistry.start(accessor));
		const disposable = EditorInputRegistry.registerEditorInputFactory('myInputId', MyInputFactory);

		let factory = EditorInputRegistry.getEditorInputFactory('myInputId');
		assert(factory);

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
		assert.equal(res!.line, 3);

		memento.saveEditorState(testGroup1, URI.file('/A'), { line: 5 });
		res = memento.loadEditorState(testGroup1, URI.file('/A'));
		assert.ok(res);
		assert.equal(res!.line, 5);

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

		// Use fallbackToOtherGroupState
		assert.ok(memento.loadEditorState(testGroup4, URI.file('/C'), true));
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
		assert.equal(res?.line, 1);

		memento.moveEditorState(URI.file('/some/folder'), URI.file('/some/folder-moved'), extUri);

		res = memento.loadEditorState(testGroup0, URI.file('/some/folder-moved/file-moved.txt'));
		assert.equal(res?.line, 1);

		res = memento.loadEditorState(testGroup0, URI.file('/some/folder-moved/file-2.txt'));
		assert.equal(res?.line, 2);
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
			getTypeId() { return 'testEditorInputForMementoTest'; }
			resolve(): Promise<IEditorModel> { return Promise.resolve(null!); }

			matches(other: TestEditorInput): boolean {
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
		assert.equal(res!.line, 3);

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
			getTypeId() { return 'testEditorInputForMementoTest'; }
			resolve(): Promise<IEditorModel> { return Promise.resolve(null!); }

			matches(other: TestEditorInput): boolean {
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
		assert.equal(res!.line, 3);

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
		assert.equal(res!.line, 3);

		memento.clearEditorStateOnDispose(testInputB.resource, testInputB);

		// State removed when input gets disposed
		testInputB.dispose();
		res = memento.loadEditorState(testGroup0, testInputB);
		assert.ok(!res);
	});

	return {
		MyEditor: MyEditor,
		MyOtherEditor: MyOtherEditor
	};
});
