/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { IViewsRegistry, Extensions, ITreeViewDescriptor, ITreeViewDataProvider, ITreeItem, TreeItemCollapsibleState, IViewsService, TreeViewItemHandleArg, IViewContainersRegistry, ViewContainerLocation, ViewContainer, IViewDescriptorService } from 'vs/workbench/common/views';
import { localize } from 'vs/nls';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { TreeViewPane, TreeView } from 'vs/workbench/browser/parts/views/treeView';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ALL_SYNC_RESOURCES, SyncResource, IUserDataSyncService, ISyncResourceHandle, CONTEXT_SYNC_STATE, SyncStatus } from 'vs/platform/userDataSync/common/userDataSync';
import { registerAction2, Action2, MenuId } from 'vs/platform/actions/common/actions';
import { IContextKeyService, RawContextKey, ContextKeyExpr, ContextKeyEqualsExpr, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { URI } from 'vs/base/common/uri';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { FolderThemeIcon } from 'vs/platform/theme/common/themeService';
import { fromNow } from 'vs/base/common/date';
import { pad, uppercaseFirstLetter } from 'vs/base/common/strings';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { Codicon } from 'vs/base/common/codicons';
import { CONTEXT_ACCOUNT_STATE } from 'vs/workbench/contrib/userDataSync/browser/userDataSync';
import { AccountStatus } from 'vs/workbench/contrib/userDataSync/browser/userDataSyncAccount';

export const VIEW_CONTAINER_ID = 'workbench.view.sync';
const CONTEXT_ENABLE_VIEWS = new RawContextKey<boolean>(`showUserDataSyncViews`, false);

export class UserDataSyncViewContribution implements IWorkbenchContribution {

	private readonly viewsEnablementContext: IContextKey<boolean>;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
	) {
		const container = this.registerSyncViewContainer();
		this.viewsEnablementContext = CONTEXT_ENABLE_VIEWS.bindTo(this.contextKeyService);
		this.registerView(container, true);
		this.registerView(container, false);
	}

	private registerSyncViewContainer(): ViewContainer {
		return Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer(
			{
				id: VIEW_CONTAINER_ID,
				name: localize('sync preferences', "Preferences Sync"),
				ctorDescriptor: new SyncDescriptor(
					ViewPaneContainer,
					[VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]
				),
				icon: Codicon.sync.classNames,
				hideIfEmpty: true,
			}, ViewContainerLocation.Sidebar);
	}

	private registerView(container: ViewContainer, remote: boolean): void {
		const that = this;
		const id = `workbench.views.sync.${remote ? 'remote' : 'local'}DataView`;
		const name = remote ? localize('remote title', "Remote Data") : localize('local title', "Local Backup");
		const treeView = this.instantiationService.createInstance(TreeView, id, name);
		treeView.showCollapseAllAction = true;
		treeView.showRefreshAction = true;
		const disposable = treeView.onDidChangeVisibility(visible => {
			if (visible && !treeView.dataProvider) {
				disposable.dispose();
				treeView.dataProvider = new UserDataSyncHistoryViewDataProvider(remote, this.userDataSyncService);
			}
		});
		const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
		viewsRegistry.registerViews([<ITreeViewDescriptor>{
			id,
			name,
			ctorDescriptor: new SyncDescriptor(TreeViewPane),
			when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available), CONTEXT_ENABLE_VIEWS),
			canToggleVisibility: true,
			canMoveView: true,
			treeView,
			collapsed: false,
			order: 100,
		}], container);

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.actions.showSync${remote ? 'Remote' : 'Local'}DataView`,
					title: remote ?
						{ value: localize('workbench.action.showSyncRemoteBackup', "Show Remote Data"), original: `Show Remote Data` }
						: { value: localize('workbench.action.showSyncLocalBackup', "Show Local Backup"), original: `Show Local Backup` },
					category: { value: localize('sync preferences', "Preferences Sync"), original: `Preferences Sync` },
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available)),
					},
				});
			}
			async run(accessor: ServicesAccessor): Promise<void> {
				const viewDescriptorService = accessor.get(IViewDescriptorService);
				const viewsService = accessor.get(IViewsService);
				that.viewsEnablementContext.set(true);
				const viewContainer = viewDescriptorService.getViewContainerByViewId(id);
				if (viewContainer) {
					const model = viewDescriptorService.getViewContainerModel(viewContainer);
					if (model.activeViewDescriptors.some(viewDescriptor => viewDescriptor.id === id)) {
						viewsService.openView(id, true);
					} else {
						const disposable = model.onDidChangeActiveViewDescriptors(e => {
							if (e.added.some(viewDescriptor => viewDescriptor.id === id)) {
								disposable.dispose();
								viewsService.openView(id, true);
							}
						});
					}
				}
			}
		});

		this.registerActions(id);
	}

	private registerActions(viewId: string) {
		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.actions.sync.resolveResource`,
					title: localize('workbench.actions.sync.resolveResourceRef', "Show raw JSON sync data"),
					menu: {
						id: MenuId.ViewItemContext,
						when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', viewId), ContextKeyExpr.regex('viewItem', /sync-resource-.*/i))
					},
				});
			}
			async run(accessor: ServicesAccessor, handle: TreeViewItemHandleArg): Promise<void> {
				const editorService = accessor.get(IEditorService);
				await editorService.openEditor({ resource: URI.parse(handle.$treeItemHandle) });
			}
		});

		registerAction2(class extends Action2 {
			constructor() {
				super({
					id: `workbench.actions.sync.commpareWithLocal`,
					title: localize('workbench.actions.sync.commpareWithLocal', "Open Changes"),
				});
			}
			async run(accessor: ServicesAccessor, handle: TreeViewItemHandleArg): Promise<void> {
				const editorService = accessor.get(IEditorService);
				const { resource, comparableResource } = <{ resource: string, comparableResource?: string }>JSON.parse(handle.$treeItemHandle);
				if (comparableResource) {
					await editorService.openEditor({
						leftResource: URI.parse(resource),
						rightResource: URI.parse(comparableResource),
						options: {
							preserveFocus: true,
							revealIfVisible: true,
						},
					});
				} else {
					await editorService.openEditor({ resource: URI.parse(resource) });
				}
			}
		});
	}

}

interface SyncResourceTreeItem extends ITreeItem {
	resource: SyncResource;
	resourceHandle: ISyncResourceHandle;
}

class UserDataSyncHistoryViewDataProvider implements ITreeViewDataProvider {

	constructor(private readonly remote: boolean, private userDataSyncService: IUserDataSyncService) { }

	async getChildren(element?: ITreeItem): Promise<ITreeItem[]> {
		if (!element) {
			return ALL_SYNC_RESOURCES.map(resourceKey => ({
				handle: resourceKey,
				collapsibleState: TreeItemCollapsibleState.Collapsed,
				label: { label: uppercaseFirstLetter(resourceKey) },
				themeIcon: FolderThemeIcon,
			}));
		}
		const resourceKey = ALL_SYNC_RESOURCES.filter(key => key === element.handle)[0] as SyncResource;
		if (resourceKey) {
			const refHandles = this.remote ? await this.userDataSyncService.getRemoteSyncResourceHandles(resourceKey) : await this.userDataSyncService.getLocalSyncResourceHandles(resourceKey);
			return refHandles.map(({ uri, created }) => {
				return <SyncResourceTreeItem>{
					handle: uri.toString(),
					collapsibleState: TreeItemCollapsibleState.Collapsed,
					label: { label: label(new Date(created)) },
					description: fromNow(created, true),
					resourceUri: uri,
					resource: resourceKey,
					resourceHandle: { uri, created },
					contextValue: `sync-resource-${resourceKey}`
				};
			});
		}
		if ((<SyncResourceTreeItem>element).resourceHandle) {
			const associatedResources = await this.userDataSyncService.getAssociatedResources((<SyncResourceTreeItem>element).resource, (<SyncResourceTreeItem>element).resourceHandle);
			return associatedResources.map(({ resource, comparableResource }) => {
				const handle = JSON.stringify({ resource: resource.toString(), comparableResource: comparableResource?.toString() });
				return {
					handle,
					collapsibleState: TreeItemCollapsibleState.None,
					resourceUri: resource,
					command: { id: `workbench.actions.sync.commpareWithLocal`, title: '', arguments: [<TreeViewItemHandleArg>{ $treeViewId: '', $treeItemHandle: handle }] },
					contextValue: `sync-associatedResource-${(<SyncResourceTreeItem>element).resource}`
				};
			});
		}
		return [];
	}
}

function label(date: Date): string {
	return date.toLocaleDateString() +
		' ' + pad(date.getHours(), 2) +
		':' + pad(date.getMinutes(), 2) +
		':' + pad(date.getSeconds(), 2);
}

