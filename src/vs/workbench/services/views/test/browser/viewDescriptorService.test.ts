/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IViewsRegistry, IViewDescriptor, IViewContainersRegistry, Extensions as ViewContainerExtensions, IViewDescriptorService, ViewContainerLocation, ViewContainer } from 'vs/workbench/common/views';
import { Registry } from 'vs/platform/registry/common/platform';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewDescriptorService } from 'vs/workbench/services/views/browser/viewDescriptorService';
import { assertIsDefined } from 'vs/base/common/types';
import { ContextKeyService } from 'vs/platform/contextkey/browser/contextKeyService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

const ViewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);
const sidebarContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({ id: 'testSidebar', title: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
const panelContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({ id: 'testPanel', title: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Panel);

suite('ViewDescriptorService', () => {

	let viewDescriptorService: IViewDescriptorService;

	setup(() => {
		const instantiationService: TestInstantiationService = <TestInstantiationService>workbenchInstantiationService();
		instantiationService.stub(IContextKeyService, instantiationService.createInstance(ContextKeyService));
		viewDescriptorService = instantiationService.createInstance(ViewDescriptorService);
	});

	teardown(() => {
		ViewsRegistry.deregisterViews(ViewsRegistry.getViews(sidebarContainer), sidebarContainer);
		ViewsRegistry.deregisterViews(ViewsRegistry.getViews(panelContainer), panelContainer);
	});

	test('Empty Containers', function () {
		const sidebarViews = viewDescriptorService.getViewContainerModel(sidebarContainer);
		const panelViews = viewDescriptorService.getViewContainerModel(panelContainer);
		assert.strictEqual(sidebarViews.allViewDescriptors.length, 0, 'The sidebar container should have no views yet.');
		assert.strictEqual(panelViews.allViewDescriptors.length, 0, 'The panel container should have no views yet.');
	});

	test('Register/Deregister', () => {
		const viewDescriptors: IViewDescriptor[] = [
			{
				id: 'view1',
				ctorDescriptor: null!,
				name: 'Test View 1',
				canMoveView: true
			},
			{
				id: 'view2',
				ctorDescriptor: null!,
				name: 'Test View 2',
				canMoveView: true
			},
			{
				id: 'view3',
				ctorDescriptor: null!,
				name: 'Test View 3',
				canMoveView: true
			}
		];


		ViewsRegistry.registerViews(viewDescriptors.slice(0, 2), sidebarContainer);
		ViewsRegistry.registerViews(viewDescriptors.slice(2), panelContainer);


		let sidebarViews = viewDescriptorService.getViewContainerModel(sidebarContainer);
		let panelViews = viewDescriptorService.getViewContainerModel(panelContainer);

		assert.strictEqual(sidebarViews.activeViewDescriptors.length, 2, 'Sidebar should have 2 views');
		assert.strictEqual(panelViews.activeViewDescriptors.length, 1, 'Panel should have 1 view');

		ViewsRegistry.deregisterViews(viewDescriptors.slice(0, 2), sidebarContainer);
		ViewsRegistry.deregisterViews(viewDescriptors.slice(2), panelContainer);


		sidebarViews = viewDescriptorService.getViewContainerModel(sidebarContainer);
		panelViews = viewDescriptorService.getViewContainerModel(panelContainer);

		assert.strictEqual(sidebarViews.activeViewDescriptors.length, 0, 'Sidebar should have no views');
		assert.strictEqual(panelViews.activeViewDescriptors.length, 0, 'Panel should have no views');
	});

	test('move views to existing containers', async function () {
		const viewDescriptors: IViewDescriptor[] = [
			{
				id: 'view1',
				ctorDescriptor: null!,
				name: 'Test View 1',
				canMoveView: true
			},
			{
				id: 'view2',
				ctorDescriptor: null!,
				name: 'Test View 2',
				canMoveView: true
			},
			{
				id: 'view3',
				ctorDescriptor: null!,
				name: 'Test View 3',
				canMoveView: true
			}
		];

		ViewsRegistry.registerViews(viewDescriptors.slice(0, 2), sidebarContainer);
		ViewsRegistry.registerViews(viewDescriptors.slice(2), panelContainer);

		viewDescriptorService.moveViewsToContainer(viewDescriptors.slice(2), sidebarContainer);
		viewDescriptorService.moveViewsToContainer(viewDescriptors.slice(0, 2), panelContainer);

		let sidebarViews = viewDescriptorService.getViewContainerModel(sidebarContainer);
		let panelViews = viewDescriptorService.getViewContainerModel(panelContainer);

		assert.strictEqual(sidebarViews.activeViewDescriptors.length, 1, 'Sidebar should have 2 views');
		assert.strictEqual(panelViews.activeViewDescriptors.length, 2, 'Panel should have 1 view');

		assert.notStrictEqual(sidebarViews.activeViewDescriptors.indexOf(viewDescriptors[2]), -1, `Sidebar should have ${viewDescriptors[2].name}`);
		assert.notStrictEqual(panelViews.activeViewDescriptors.indexOf(viewDescriptors[0]), -1, `Panel should have ${viewDescriptors[0].name}`);
		assert.notStrictEqual(panelViews.activeViewDescriptors.indexOf(viewDescriptors[1]), -1, `Panel should have ${viewDescriptors[1].name}`);
	});

	test('move views to generated containers', async function () {
		const viewDescriptors: IViewDescriptor[] = [
			{
				id: 'view1',
				ctorDescriptor: null!,
				name: 'Test View 1',
				canMoveView: true
			},
			{
				id: 'view2',
				ctorDescriptor: null!,
				name: 'Test View 2',
				canMoveView: true
			},
			{
				id: 'view3',
				ctorDescriptor: null!,
				name: 'Test View 3',
				canMoveView: true
			}
		];

		ViewsRegistry.registerViews(viewDescriptors.slice(0, 2), sidebarContainer);
		ViewsRegistry.registerViews(viewDescriptors.slice(2), panelContainer);

		viewDescriptorService.moveViewToLocation(viewDescriptors[0], ViewContainerLocation.Panel);
		viewDescriptorService.moveViewToLocation(viewDescriptors[2], ViewContainerLocation.Sidebar);

		let sidebarViews = viewDescriptorService.getViewContainerModel(sidebarContainer);
		let panelViews = viewDescriptorService.getViewContainerModel(panelContainer);

		assert.strictEqual(sidebarViews.activeViewDescriptors.length, 1, 'Sidebar container should have 1 view');
		assert.strictEqual(panelViews.activeViewDescriptors.length, 0, 'Panel container should have no views');

		const generatedPanel = assertIsDefined(viewDescriptorService.getViewContainerByViewId(viewDescriptors[0].id));
		const generatedSidebar = assertIsDefined(viewDescriptorService.getViewContainerByViewId(viewDescriptors[2].id));

		assert.strictEqual(viewDescriptorService.getViewContainerLocation(generatedPanel), ViewContainerLocation.Panel, 'Generated Panel should be in located in the panel');
		assert.strictEqual(viewDescriptorService.getViewContainerLocation(generatedSidebar), ViewContainerLocation.Sidebar, 'Generated Sidebar should be in located in the sidebar');

		assert.strictEqual(viewDescriptorService.getViewContainerLocation(generatedPanel), viewDescriptorService.getViewLocationById(viewDescriptors[0].id), 'Panel view location and container location should match');
		assert.strictEqual(viewDescriptorService.getViewContainerLocation(generatedSidebar), viewDescriptorService.getViewLocationById(viewDescriptors[2].id), 'Sidebar view location and container location should match');

		assert.strictEqual(viewDescriptorService.getDefaultContainerById(viewDescriptors[2].id), panelContainer, `${viewDescriptors[2].name} has wrong default container`);
		assert.strictEqual(viewDescriptorService.getDefaultContainerById(viewDescriptors[0].id), sidebarContainer, `${viewDescriptors[0].name} has wrong default container`);

		viewDescriptorService.moveViewToLocation(viewDescriptors[0], ViewContainerLocation.Sidebar);
		viewDescriptorService.moveViewToLocation(viewDescriptors[2], ViewContainerLocation.Panel);

		sidebarViews = viewDescriptorService.getViewContainerModel(sidebarContainer);
		panelViews = viewDescriptorService.getViewContainerModel(panelContainer);

		assert.strictEqual(sidebarViews.activeViewDescriptors.length, 1, 'Sidebar should have 2 views');
		assert.strictEqual(panelViews.activeViewDescriptors.length, 0, 'Panel should have 1 view');

		assert.strictEqual(viewDescriptorService.getViewLocationById(viewDescriptors[0].id), ViewContainerLocation.Sidebar, 'View should be located in the sidebar');
		assert.strictEqual(viewDescriptorService.getViewLocationById(viewDescriptors[2].id), ViewContainerLocation.Panel, 'View should be located in the panel');
	});

	test('move view events', async function () {
		const viewDescriptors: IViewDescriptor[] = [
			{
				id: 'view1',
				ctorDescriptor: null!,
				name: 'Test View 1',
				canMoveView: true
			},
			{
				id: 'view2',
				ctorDescriptor: null!,
				name: 'Test View 2',
				canMoveView: true
			},
			{
				id: 'view3',
				ctorDescriptor: null!,
				name: 'Test View 3',
				canMoveView: true
			}
		];


		let expectedSequence = '';
		let actualSequence = '';
		const disposables = [];

		const containerMoveString = (view: IViewDescriptor, from: ViewContainer, to: ViewContainer) => {
			return `Moved ${view.id} from ${from.id} to ${to.id}\n`;
		};

		const locationMoveString = (view: IViewDescriptor, from: ViewContainerLocation, to: ViewContainerLocation) => {
			return `Moved ${view.id} from ${from === ViewContainerLocation.Sidebar ? 'Sidebar' : 'Panel'} to ${to === ViewContainerLocation.Sidebar ? 'Sidebar' : 'Panel'}\n`;
		};
		disposables.push(viewDescriptorService.onDidChangeContainer(({ views, from, to }) => {
			views.forEach(view => {
				actualSequence += containerMoveString(view, from, to);
			});
		}));

		disposables.push(viewDescriptorService.onDidChangeLocation(({ views, from, to }) => {
			views.forEach(view => {
				actualSequence += locationMoveString(view, from, to);
			});
		}));

		ViewsRegistry.registerViews(viewDescriptors.slice(0, 2), sidebarContainer);
		ViewsRegistry.registerViews(viewDescriptors.slice(2), panelContainer);

		expectedSequence += locationMoveString(viewDescriptors[0], ViewContainerLocation.Sidebar, ViewContainerLocation.Panel);
		viewDescriptorService.moveViewToLocation(viewDescriptors[0], ViewContainerLocation.Panel);
		expectedSequence += containerMoveString(viewDescriptors[0], sidebarContainer, viewDescriptorService.getViewContainerByViewId(viewDescriptors[0].id)!);

		expectedSequence += locationMoveString(viewDescriptors[2], ViewContainerLocation.Panel, ViewContainerLocation.Sidebar);
		viewDescriptorService.moveViewToLocation(viewDescriptors[2], ViewContainerLocation.Sidebar);
		expectedSequence += containerMoveString(viewDescriptors[2], panelContainer, viewDescriptorService.getViewContainerByViewId(viewDescriptors[2].id)!);


		expectedSequence += locationMoveString(viewDescriptors[0], ViewContainerLocation.Panel, ViewContainerLocation.Sidebar);
		expectedSequence += containerMoveString(viewDescriptors[0], viewDescriptorService.getViewContainerByViewId(viewDescriptors[0].id)!, sidebarContainer);
		viewDescriptorService.moveViewsToContainer([viewDescriptors[0]], sidebarContainer);

		expectedSequence += locationMoveString(viewDescriptors[2], ViewContainerLocation.Sidebar, ViewContainerLocation.Panel);
		expectedSequence += containerMoveString(viewDescriptors[2], viewDescriptorService.getViewContainerByViewId(viewDescriptors[2].id)!, panelContainer);
		viewDescriptorService.moveViewsToContainer([viewDescriptors[2]], panelContainer);

		expectedSequence += locationMoveString(viewDescriptors[0], ViewContainerLocation.Sidebar, ViewContainerLocation.Panel);
		expectedSequence += containerMoveString(viewDescriptors[0], sidebarContainer, panelContainer);
		viewDescriptorService.moveViewsToContainer([viewDescriptors[0]], panelContainer);

		expectedSequence += locationMoveString(viewDescriptors[2], ViewContainerLocation.Panel, ViewContainerLocation.Sidebar);
		expectedSequence += containerMoveString(viewDescriptors[2], panelContainer, sidebarContainer);
		viewDescriptorService.moveViewsToContainer([viewDescriptors[2]], sidebarContainer);

		expectedSequence += locationMoveString(viewDescriptors[1], ViewContainerLocation.Sidebar, ViewContainerLocation.Panel);
		expectedSequence += locationMoveString(viewDescriptors[2], ViewContainerLocation.Sidebar, ViewContainerLocation.Panel);
		expectedSequence += containerMoveString(viewDescriptors[1], sidebarContainer, panelContainer);
		expectedSequence += containerMoveString(viewDescriptors[2], sidebarContainer, panelContainer);
		viewDescriptorService.moveViewsToContainer([viewDescriptors[1], viewDescriptors[2]], panelContainer);

		assert.strictEqual(actualSequence, expectedSequence, 'Event sequence not matching expected sequence');
	});

});
