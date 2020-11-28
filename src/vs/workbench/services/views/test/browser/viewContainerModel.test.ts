/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { IViewsRegistry, IViewDescriptor, IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation, IViewContainerModel, IViewDescriptorService, ViewContainer } from 'vs/workbench/common/views';
import { IDisposable, dispose, DisposableStore } from 'vs/base/common/lifecycle';
import { move } from 'vs/base/common/arrays';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ContextKeyService } from 'vs/platform/contextkey/browser/contextKeyService';
import { ViewDescriptorService } from 'vs/workbench/services/views/browser/viewDescriptorService';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';

const ViewContainerRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry);
const ViewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

class ViewDescriptorSequence {

	readonly elements: IViewDescriptor[];
	private disposables: IDisposable[] = [];

	constructor(model: IViewContainerModel) {
		this.elements = [...model.visibleViewDescriptors];
		model.onDidAddVisibleViewDescriptors(added => added.forEach(({ viewDescriptor, index }) => this.elements.splice(index, 0, viewDescriptor)), null, this.disposables);
		model.onDidRemoveVisibleViewDescriptors(removed => removed.sort((a, b) => b.index - a.index).forEach(({ index }) => this.elements.splice(index, 1)), null, this.disposables);
		model.onDidMoveVisibleViewDescriptors(({ from, to }) => move(this.elements, from.index, to.index), null, this.disposables);
	}

	dispose() {
		this.disposables = dispose(this.disposables);
	}
}

suite('ViewContainerModel', () => {

	let container: ViewContainer;
	let disposableStore: DisposableStore;
	let contextKeyService: IContextKeyService;
	let viewDescriptorService: IViewDescriptorService;
	let storageService: IStorageService;

	setup(() => {
		disposableStore = new DisposableStore();
		const instantiationService: TestInstantiationService = <TestInstantiationService>workbenchInstantiationService();
		contextKeyService = instantiationService.createInstance(ContextKeyService);
		instantiationService.stub(IContextKeyService, contextKeyService);
		storageService = instantiationService.get(IStorageService);
		viewDescriptorService = instantiationService.createInstance(ViewDescriptorService);
	});

	teardown(() => {
		disposableStore.dispose();
		ViewsRegistry.deregisterViews(ViewsRegistry.getViews(container), container);
		ViewContainerRegistry.deregisterViewContainer(container);
	});

	test('empty model', function () {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		assert.equal(testObject.visibleViewDescriptors.length, 0);
	});

	test('register/unregister', () => {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));

		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);

		const viewDescriptor: IViewDescriptor = {
			id: 'view1',
			ctorDescriptor: null!,
			name: 'Test View 1'
		};

		ViewsRegistry.registerViews([viewDescriptor], container);

		assert.equal(testObject.visibleViewDescriptors.length, 1);
		assert.equal(target.elements.length, 1);
		assert.deepEqual(testObject.visibleViewDescriptors[0], viewDescriptor);
		assert.deepEqual(target.elements[0], viewDescriptor);

		ViewsRegistry.deregisterViews([viewDescriptor], container);

		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);
	});

	test('when contexts', async function () {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));
		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);

		const viewDescriptor: IViewDescriptor = {
			id: 'view1',
			ctorDescriptor: null!,
			name: 'Test View 1',
			when: ContextKeyExpr.equals('showview1', true)
		};

		ViewsRegistry.registerViews([viewDescriptor], container);
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should not appear since context isnt in');
		assert.equal(target.elements.length, 0);

		const key = contextKeyService.createKey('showview1', false);
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should still not appear since showview1 isnt true');
		assert.equal(target.elements.length, 0);

		key.set(true);
		await new Promise(c => setTimeout(c, 30));
		assert.equal(testObject.visibleViewDescriptors.length, 1, 'view should appear');
		assert.equal(target.elements.length, 1);
		assert.deepEqual(testObject.visibleViewDescriptors[0], viewDescriptor);
		assert.equal(target.elements[0], viewDescriptor);

		key.set(false);
		await new Promise(c => setTimeout(c, 30));
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should disappear');
		assert.equal(target.elements.length, 0);

		ViewsRegistry.deregisterViews([viewDescriptor], container);
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should not be there anymore');
		assert.equal(target.elements.length, 0);

		key.set(true);
		await new Promise(c => setTimeout(c, 30));
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should not be there anymore');
		assert.equal(target.elements.length, 0);
	});

	test('when contexts - multiple', async function () {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));
		const view1: IViewDescriptor = { id: 'view1', ctorDescriptor: null!, name: 'Test View 1' };
		const view2: IViewDescriptor = { id: 'view2', ctorDescriptor: null!, name: 'Test View 2', when: ContextKeyExpr.equals('showview2', true) };

		ViewsRegistry.registerViews([view1, view2], container);
		assert.deepEqual(testObject.visibleViewDescriptors, [view1], 'only view1 should be visible');
		assert.deepEqual(target.elements, [view1], 'only view1 should be visible');

		const key = contextKeyService.createKey('showview2', false);
		assert.deepEqual(testObject.visibleViewDescriptors, [view1], 'still only view1 should be visible');
		assert.deepEqual(target.elements, [view1], 'still only view1 should be visible');

		key.set(true);
		await new Promise(c => setTimeout(c, 30));
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view2], 'both views should be visible');
		assert.deepEqual(target.elements, [view1, view2], 'both views should be visible');

		ViewsRegistry.deregisterViews([view1, view2], container);
	});

	test('when contexts - multiple 2', async function () {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));
		const view1: IViewDescriptor = { id: 'view1', ctorDescriptor: null!, name: 'Test View 1', when: ContextKeyExpr.equals('showview1', true) };
		const view2: IViewDescriptor = { id: 'view2', ctorDescriptor: null!, name: 'Test View 2' };

		ViewsRegistry.registerViews([view1, view2], container);
		assert.deepEqual(testObject.visibleViewDescriptors, [view2], 'only view2 should be visible');
		assert.deepEqual(target.elements, [view2], 'only view2 should be visible');

		const key = contextKeyService.createKey('showview1', false);
		assert.deepEqual(testObject.visibleViewDescriptors, [view2], 'still only view2 should be visible');
		assert.deepEqual(target.elements, [view2], 'still only view2 should be visible');

		key.set(true);
		await new Promise(c => setTimeout(c, 30));
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view2], 'both views should be visible');
		assert.deepEqual(target.elements, [view1, view2], 'both views should be visible');

		ViewsRegistry.deregisterViews([view1, view2], container);
	});

	test('setVisible', () => {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));
		const view1: IViewDescriptor = { id: 'view1', ctorDescriptor: null!, name: 'Test View 1', canToggleVisibility: true };
		const view2: IViewDescriptor = { id: 'view2', ctorDescriptor: null!, name: 'Test View 2', canToggleVisibility: true };
		const view3: IViewDescriptor = { id: 'view3', ctorDescriptor: null!, name: 'Test View 3', canToggleVisibility: true };

		ViewsRegistry.registerViews([view1, view2, view3], container);
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view2, view3]);
		assert.deepEqual(target.elements, [view1, view2, view3]);

		testObject.setVisible('view2', true);
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view2, view3], 'nothing should happen');
		assert.deepEqual(target.elements, [view1, view2, view3]);

		testObject.setVisible('view2', false);
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view3], 'view2 should hide');
		assert.deepEqual(target.elements, [view1, view3]);

		testObject.setVisible('view1', false);
		assert.deepEqual(testObject.visibleViewDescriptors, [view3], 'view1 should hide');
		assert.deepEqual(target.elements, [view3]);

		testObject.setVisible('view3', false);
		assert.deepEqual(testObject.visibleViewDescriptors, [], 'view3 shoud hide');
		assert.deepEqual(target.elements, []);

		testObject.setVisible('view1', true);
		assert.deepEqual(testObject.visibleViewDescriptors, [view1], 'view1 should show');
		assert.deepEqual(target.elements, [view1]);

		testObject.setVisible('view3', true);
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view3], 'view3 should show');
		assert.deepEqual(target.elements, [view1, view3]);

		testObject.setVisible('view2', true);
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view2, view3], 'view2 should show');
		assert.deepEqual(target.elements, [view1, view2, view3]);

		ViewsRegistry.deregisterViews([view1, view2, view3], container);
		assert.deepEqual(testObject.visibleViewDescriptors, []);
		assert.deepEqual(target.elements, []);
	});

	test('move', () => {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));
		const view1: IViewDescriptor = { id: 'view1', ctorDescriptor: null!, name: 'Test View 1' };
		const view2: IViewDescriptor = { id: 'view2', ctorDescriptor: null!, name: 'Test View 2' };
		const view3: IViewDescriptor = { id: 'view3', ctorDescriptor: null!, name: 'Test View 3' };

		ViewsRegistry.registerViews([view1, view2, view3], container);
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view2, view3], 'model views should be OK');
		assert.deepEqual(target.elements, [view1, view2, view3], 'sql views should be OK');

		testObject.move('view3', 'view1');
		assert.deepEqual(testObject.visibleViewDescriptors, [view3, view1, view2], 'view3 should go to the front');
		assert.deepEqual(target.elements, [view3, view1, view2]);

		testObject.move('view1', 'view2');
		assert.deepEqual(testObject.visibleViewDescriptors, [view3, view2, view1], 'view1 should go to the end');
		assert.deepEqual(target.elements, [view3, view2, view1]);

		testObject.move('view1', 'view3');
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view3, view2], 'view1 should go to the front');
		assert.deepEqual(target.elements, [view1, view3, view2]);

		testObject.move('view2', 'view3');
		assert.deepEqual(testObject.visibleViewDescriptors, [view1, view2, view3], 'view2 should go to the middle');
		assert.deepEqual(target.elements, [view1, view2, view3]);
	});

	test('view states', async function () {
		storageService.store(`${container.id}.state.hidden`, JSON.stringify([{ id: 'view1', isHidden: true }]), StorageScope.GLOBAL, StorageTarget.MACHINE);
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));

		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);

		const viewDescriptor: IViewDescriptor = {
			id: 'view1',
			ctorDescriptor: null!,
			name: 'Test View 1'
		};

		ViewsRegistry.registerViews([viewDescriptor], container);
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should not appear since it was set not visible in view state');
		assert.equal(target.elements.length, 0);
	});

	test('view states and when contexts', async function () {
		storageService.store(`${container.id}.state.hidden`, JSON.stringify([{ id: 'view1', isHidden: true }]), StorageScope.GLOBAL, StorageTarget.MACHINE);
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));

		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);

		const viewDescriptor: IViewDescriptor = {
			id: 'view1',
			ctorDescriptor: null!,
			name: 'Test View 1',
			when: ContextKeyExpr.equals('showview1', true)
		};

		ViewsRegistry.registerViews([viewDescriptor], container);
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should not appear since context isnt in');
		assert.equal(target.elements.length, 0);

		const key = contextKeyService.createKey('showview1', false);
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should still not appear since showview1 isnt true');
		assert.equal(target.elements.length, 0);

		key.set(true);
		await new Promise(c => setTimeout(c, 30));
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should still not appear since it was set not visible in view state');
		assert.equal(target.elements.length, 0);
	});

	test('view states and when contexts multiple views', async function () {
		storageService.store(`${container.id}.state.hidden`, JSON.stringify([{ id: 'view1', isHidden: true }]), StorageScope.GLOBAL, StorageTarget.MACHINE);
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));

		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);

		const view1: IViewDescriptor = {
			id: 'view1',
			ctorDescriptor: null!,
			name: 'Test View 1',
			when: ContextKeyExpr.equals('showview', true)
		};
		const view2: IViewDescriptor = {
			id: 'view2',
			ctorDescriptor: null!,
			name: 'Test View 2',
		};
		const view3: IViewDescriptor = {
			id: 'view3',
			ctorDescriptor: null!,
			name: 'Test View 3',
			when: ContextKeyExpr.equals('showview', true)
		};

		ViewsRegistry.registerViews([view1, view2, view3], container);
		assert.deepEqual(testObject.visibleViewDescriptors, [view2], 'Only view2 should be visible');
		assert.deepEqual(target.elements, [view2]);

		const key = contextKeyService.createKey('showview', false);
		assert.deepEqual(testObject.visibleViewDescriptors, [view2], 'Only view2 should be visible');
		assert.deepEqual(target.elements, [view2]);

		key.set(true);
		await new Promise(c => setTimeout(c, 30));
		assert.deepEqual(testObject.visibleViewDescriptors, [view2, view3], 'view3 should be visible');
		assert.deepEqual(target.elements, [view2, view3]);

		key.set(false);
		await new Promise(c => setTimeout(c, 30));
		assert.deepEqual(testObject.visibleViewDescriptors, [view2], 'Only view2 should be visible');
		assert.deepEqual(target.elements, [view2]);
	});

	test('remove event is not triggered if view was hidden and removed', async function () {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));
		const viewDescriptor: IViewDescriptor = {
			id: 'view1',
			ctorDescriptor: null!,
			name: 'Test View 1',
			when: ContextKeyExpr.equals('showview1', true),
			canToggleVisibility: true
		};

		ViewsRegistry.registerViews([viewDescriptor], container);

		const key = contextKeyService.createKey('showview1', true);
		await new Promise(c => setTimeout(c, 30));
		assert.equal(testObject.visibleViewDescriptors.length, 1, 'view should appear after context is set');
		assert.equal(target.elements.length, 1);

		testObject.setVisible('view1', false);
		assert.equal(testObject.visibleViewDescriptors.length, 0, 'view should disappear after setting visibility to false');
		assert.equal(target.elements.length, 0);

		const targetEvent = sinon.spy(testObject.onDidRemoveVisibleViewDescriptors);
		key.set(false);
		await new Promise(c => setTimeout(c, 30));
		assert.ok(!targetEvent.called, 'remove event should not be called since it is already hidden');
	});

	test('add event is not triggered if view was set visible (when visible) and not active', async function () {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));
		const viewDescriptor: IViewDescriptor = {
			id: 'view1',
			ctorDescriptor: null!,
			name: 'Test View 1',
			when: ContextKeyExpr.equals('showview1', true),
			canToggleVisibility: true
		};

		const key = contextKeyService.createKey('showview1', true);
		key.set(false);
		ViewsRegistry.registerViews([viewDescriptor], container);

		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);

		const targetEvent = sinon.spy(testObject.onDidAddVisibleViewDescriptors);
		testObject.setVisible('view1', true);
		assert.ok(!targetEvent.called, 'add event should not be called since it is already visible');
		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);
	});

	test('remove event is not triggered if view was hidden and not active', async function () {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));
		const viewDescriptor: IViewDescriptor = {
			id: 'view1',
			ctorDescriptor: null!,
			name: 'Test View 1',
			when: ContextKeyExpr.equals('showview1', true),
			canToggleVisibility: true
		};

		const key = contextKeyService.createKey('showview1', true);
		key.set(false);
		ViewsRegistry.registerViews([viewDescriptor], container);

		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);

		const targetEvent = sinon.spy(testObject.onDidAddVisibleViewDescriptors);
		testObject.setVisible('view1', false);
		assert.ok(!targetEvent.called, 'add event should not be called since it is disabled');
		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);
	});

	test('add event is not triggered if view was set visible (when not visible) and not active', async function () {
		container = ViewContainerRegistry.registerViewContainer({ id: 'test', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const testObject = viewDescriptorService.getViewContainerModel(container);
		const target = disposableStore.add(new ViewDescriptorSequence(testObject));
		const viewDescriptor: IViewDescriptor = {
			id: 'view1',
			ctorDescriptor: null!,
			name: 'Test View 1',
			when: ContextKeyExpr.equals('showview1', true),
			canToggleVisibility: true
		};

		const key = contextKeyService.createKey('showview1', true);
		key.set(false);
		ViewsRegistry.registerViews([viewDescriptor], container);

		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);

		testObject.setVisible('view1', false);
		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);

		const targetEvent = sinon.spy(testObject.onDidAddVisibleViewDescriptors);
		testObject.setVisible('view1', true);
		assert.ok(!targetEvent.called, 'add event should not be called since it is disabled');
		assert.equal(testObject.visibleViewDescriptors.length, 0);
		assert.equal(target.elements.length, 0);
	});

});
