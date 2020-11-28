/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ExtHostTreeViewsShape, IExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { mock } from 'vs/base/test/common/mock';
import { ITreeItem, IViewsRegistry, Extensions, ViewContainerLocation, IViewContainersRegistry, ITreeViewDescriptor, ITreeView, ViewContainer, IViewDescriptorService, TreeItemCollapsibleState } from 'vs/workbench/common/views';
import { NullLogService } from 'vs/platform/log/common/log';
import { MainThreadTreeViews } from 'vs/workbench/api/browser/mainThreadTreeViews';
import { TestViewsService, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestExtensionService } from 'vs/workbench/test/common/workbenchTestServices';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ViewDescriptorService } from 'vs/workbench/services/views/browser/viewDescriptorService';
import { CustomTreeView } from 'vs/workbench/browser/parts/views/treeView';

suite('MainThreadHostTreeView', function () {
	const testTreeViewId = 'testTreeView';
	const customValue = 'customValue';
	const ViewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);

	interface CustomTreeItem extends ITreeItem {
		customProp: string;
	}

	class MockExtHostTreeViewsShape extends mock<ExtHostTreeViewsShape>() {
		async $getChildren(treeViewId: string, treeItemHandle?: string): Promise<ITreeItem[]> {
			return [<CustomTreeItem>{ handle: 'testItem1', collapsibleState: TreeItemCollapsibleState.Expanded, customProp: customValue }];
		}

		async $hasResolve(): Promise<boolean> {
			return false;
		}

		$setVisible(): void { }
	}

	let container: ViewContainer;
	let mainThreadTreeViews: MainThreadTreeViews;
	let extHostTreeViewsShape: MockExtHostTreeViewsShape;

	setup(async () => {
		const instantiationService: TestInstantiationService = <TestInstantiationService>workbenchInstantiationService();
		const viewDescriptorService = instantiationService.createInstance(ViewDescriptorService);
		instantiationService.stub(IViewDescriptorService, viewDescriptorService);
		container = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer({ id: 'testContainer', name: 'test', ctorDescriptor: new SyncDescriptor(<any>{}) }, ViewContainerLocation.Sidebar);
		const viewDescriptor: ITreeViewDescriptor = {
			id: testTreeViewId,
			ctorDescriptor: null!,
			name: 'Test View 1',
			treeView: instantiationService.createInstance(CustomTreeView, 'testTree', 'Test Title'),
		};
		ViewsRegistry.registerViews([viewDescriptor], container);

		const testExtensionService = new TestExtensionService();
		extHostTreeViewsShape = new MockExtHostTreeViewsShape();
		mainThreadTreeViews = new MainThreadTreeViews(
			new class implements IExtHostContext {
				remoteAuthority = '';
				assertRegistered() { }
				set(v: any): any { return null; }
				getProxy(): any {
					return extHostTreeViewsShape;
				}
				drain(): any { return null; }
			}, new TestViewsService(), new TestNotificationService(), testExtensionService, new NullLogService());
		mainThreadTreeViews.$registerTreeViewDataProvider(testTreeViewId, { showCollapseAll: false, canSelectMany: false });
		await testExtensionService.whenInstalledExtensionsRegistered();
	});

	teardown(() => {
		ViewsRegistry.deregisterViews(ViewsRegistry.getViews(container), container);
	});

	test('getChildren keeps custom properties', async () => {
		const treeView: ITreeView = (<ITreeViewDescriptor>ViewsRegistry.getView(testTreeViewId)).treeView;
		const children = await treeView.dataProvider?.getChildren({ handle: 'root', collapsibleState: TreeItemCollapsibleState.Expanded });
		assert(children!.length === 1, 'Exactly one child should be returned');
		assert((<CustomTreeItem>children![0]).customProp === customValue, 'Tree Items should keep custom properties');
	});


});
