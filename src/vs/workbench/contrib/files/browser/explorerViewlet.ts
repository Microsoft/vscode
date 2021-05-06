/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/explorerviewlet';
import { localize } from 'vs/nls';
import { VIEWLET_ID, ExplorerViewletVisibleContext, IFilesConfiguration, OpenEditorsVisibleContext, VIEW_ID } from 'vs/workbench/contrib/files/common/files';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { ExplorerView } from 'vs/workbench/contrib/files/browser/views/explorerView';
import { EmptyView } from 'vs/workbench/contrib/files/browser/views/emptyView';
import { OpenEditorsView } from 'vs/workbench/contrib/files/browser/views/openEditorsView';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IContextKeyService, IContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IViewsRegistry, IViewDescriptor, Extensions, ViewContainer, IViewContainersRegistry, ViewContainerLocation, IViewDescriptorService, ViewContentGroups } from 'vs/workbench/common/views';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { DelegatingEditorService } from 'vs/workbench/services/editor/browser/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorPane } from 'vs/workbench/common/editor';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { KeyChord, KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { Registry } from 'vs/platform/registry/common/platform';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { WorkbenchStateContext, RemoteNameContext } from 'vs/workbench/browser/contextkeys';
import { IsWebContext } from 'vs/platform/contextkey/common/contextkeys';
import { AddRootFolderAction, OpenFolderAction, OpenFileFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { isMacintosh } from 'vs/base/common/platform';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

const explorerViewIcon = registerIcon('explorer-view-icon', Codicon.files, localize('explorerViewIcon', 'View icon of the explorer view.'));
const openEditorsViewIcon = registerIcon('open-editors-view-icon', Codicon.book, localize('openEditorsIcon', 'View icon of the open editors view.'));

export class ExplorerViewletViewsContribution extends Disposable implements IWorkbenchContribution {

	private openEditorsVisibleContextKey!: IContextKey<boolean>;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IProgressService progressService: IProgressService
	) {
		super();

		progressService.withProgress({ location: ProgressLocation.Explorer }, () => workspaceContextService.getCompleteWorkspace()).finally(() => {
			this.registerViews();

			this.openEditorsVisibleContextKey = OpenEditorsVisibleContext.bindTo(contextKeyService);
			this.updateOpenEditorsVisibility();

			this._register(workspaceContextService.onDidChangeWorkbenchState(() => this.registerViews()));
			this._register(workspaceContextService.onDidChangeWorkspaceFolders(() => this.registerViews()));
			this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationUpdated(e)));
		});
	}

	private registerViews(): void {
		const viewDescriptors = viewsRegistry.getViews(VIEW_CONTAINER);

		let viewDescriptorsToRegister: IViewDescriptor[] = [];
		let viewDescriptorsToDeregister: IViewDescriptor[] = [];

		const openEditorsViewDescriptor = this.createOpenEditorsViewDescriptor();
		if (!viewDescriptors.some(v => v.id === openEditorsViewDescriptor.id)) {
			viewDescriptorsToRegister.push(openEditorsViewDescriptor);
		}

		const explorerViewDescriptor = this.createExplorerViewDescriptor();
		const registeredExplorerViewDescriptor = viewDescriptors.find(v => v.id === explorerViewDescriptor.id);
		const emptyViewDescriptor = this.createEmptyViewDescriptor();
		const registeredEmptyViewDescriptor = viewDescriptors.find(v => v.id === emptyViewDescriptor.id);

		if (this.workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY || this.workspaceContextService.getWorkspace().folders.length === 0) {
			if (registeredExplorerViewDescriptor) {
				viewDescriptorsToDeregister.push(registeredExplorerViewDescriptor);
			}
			if (!registeredEmptyViewDescriptor) {
				viewDescriptorsToRegister.push(emptyViewDescriptor);
			}
		} else {
			if (registeredEmptyViewDescriptor) {
				viewDescriptorsToDeregister.push(registeredEmptyViewDescriptor);
			}
			if (!registeredExplorerViewDescriptor) {
				viewDescriptorsToRegister.push(explorerViewDescriptor);
			}
		}

		if (viewDescriptorsToRegister.length) {
			viewsRegistry.registerViews(viewDescriptorsToRegister, VIEW_CONTAINER);
		}
		if (viewDescriptorsToDeregister.length) {
			viewsRegistry.deregisterViews(viewDescriptorsToDeregister, VIEW_CONTAINER);
		}
	}

	private createOpenEditorsViewDescriptor(): IViewDescriptor {
		return {
			id: OpenEditorsView.ID,
			name: OpenEditorsView.NAME,
			ctorDescriptor: new SyncDescriptor(OpenEditorsView),
			containerIcon: openEditorsViewIcon,
			order: 0,
			when: OpenEditorsVisibleContext,
			canToggleVisibility: true,
			canMoveView: true,
			collapsed: false,
			hideByDefault: true,
			focusCommand: {
				id: 'workbench.files.action.focusOpenEditorsView',
				keybindings: { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_E) }
			}
		};
	}

	private createEmptyViewDescriptor(): IViewDescriptor {
		return {
			id: EmptyView.ID,
			name: EmptyView.NAME,
			containerIcon: explorerViewIcon,
			ctorDescriptor: new SyncDescriptor(EmptyView),
			order: 1,
			canToggleVisibility: true,
			focusCommand: {
				id: 'workbench.explorer.fileView.focus'
			}
		};
	}

	private createExplorerViewDescriptor(): IViewDescriptor {
		return {
			id: VIEW_ID,
			name: localize('folders', "Folders"),
			containerIcon: explorerViewIcon,
			ctorDescriptor: new SyncDescriptor(ExplorerView),
			order: 1,
			canToggleVisibility: false,
			focusCommand: {
				id: 'workbench.explorer.fileView.focus'
			}
		};
	}

	private onConfigurationUpdated(e: IConfigurationChangeEvent): void {
		if (e.affectsConfiguration('explorer.openEditors.visible')) {
			this.updateOpenEditorsVisibility();
		}
	}

	private updateOpenEditorsVisibility(): void {
		this.openEditorsVisibleContextKey.set(this.workspaceContextService.getWorkbenchState() === WorkbenchState.EMPTY || this.configurationService.getValue('explorer.openEditors.visible') !== 0);
	}
}

export class ExplorerViewPaneContainer extends ViewPaneContainer {

	private viewletVisibleContextKey: IContextKey<boolean>;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {

		super(VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService);

		this.viewletVisibleContextKey = ExplorerViewletVisibleContext.bindTo(contextKeyService);

		this._register(this.contextService.onDidChangeWorkspaceName(e => this.updateTitleArea()));
	}

	override create(parent: HTMLElement): void {
		super.create(parent);
		parent.classList.add('explorer-viewlet');
	}

	protected override createView(viewDescriptor: IViewDescriptor, options: IViewletViewOptions): ViewPane {
		if (viewDescriptor.id === VIEW_ID) {
			// Create a delegating editor service for the explorer to be able to delay the refresh in the opened
			// editors view above. This is a workaround for being able to double click on a file to make it pinned
			// without causing the animation in the opened editors view to kick in and change scroll position.
			// We try to be smart and only use the delay if we recognize that the user action is likely to cause
			// a new entry in the opened editors view.
			const delegatingEditorService = this.instantiationService.createInstance(DelegatingEditorService, async (group, delegate): Promise<IEditorPane | undefined> => {
				let openEditorsView = this.getOpenEditorsView();
				if (openEditorsView) {
					let delay = 0;

					const config = this.configurationService.getValue<IFilesConfiguration>();
					const delayEditorOpeningInOpenedEditors = !!config.workbench?.editor?.enablePreview; // No need to delay if preview is disabled

					const activeGroup = this.editorGroupService.activeGroup;
					if (delayEditorOpeningInOpenedEditors && group === activeGroup && !activeGroup.previewEditor) {
						delay = 250; // a new editor entry is likely because there is either no group or no preview in group
					}

					openEditorsView.setStructuralRefreshDelay(delay);
				}

				try {
					return await delegate();
				} catch (error) {
					return undefined; // ignore
				} finally {
					if (openEditorsView) {
						openEditorsView.setStructuralRefreshDelay(0);
					}
				}
			});

			const explorerInstantiator = this.instantiationService.createChild(new ServiceCollection([IEditorService, delegatingEditorService]));
			return explorerInstantiator.createInstance(ExplorerView, options);
		}
		return super.createView(viewDescriptor, options);
	}

	public getExplorerView(): ExplorerView {
		return <ExplorerView>this.getView(VIEW_ID);
	}

	public getOpenEditorsView(): OpenEditorsView {
		return <OpenEditorsView>this.getView(OpenEditorsView.ID);
	}

	public override setVisible(visible: boolean): void {
		this.viewletVisibleContextKey.set(visible);
		super.setVisible(visible);
	}

	override focus(): void {
		const explorerView = this.getView(VIEW_ID);
		if (explorerView && this.panes.every(p => !p.isExpanded())) {
			explorerView.setExpanded(true);
		}
		if (explorerView?.isExpanded()) {
			explorerView.focus();
		} else {
			super.focus();
		}
	}
}

const viewContainerRegistry = Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry);

/**
 * Explorer viewlet container.
 */
export const VIEW_CONTAINER: ViewContainer = viewContainerRegistry.registerViewContainer({
	id: VIEWLET_ID,
	title: localize('explore', "Explorer"),
	ctorDescriptor: new SyncDescriptor(ExplorerViewPaneContainer),
	storageId: 'workbench.explorer.views.state',
	icon: explorerViewIcon,
	alwaysUseContainerInfo: true,
	order: 0,
	openCommandActionDescriptor: {
		id: VIEWLET_ID,
		title: localize('explore', "Explorer"),
		mnemonicTitle: localize({ key: 'miViewExplorer', comment: ['&& denotes a mnemonic'] }, "&&Explorer"),
		keybindings: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_E },
		order: 0
	},
}, ViewContainerLocation.Sidebar, { isDefault: true });

const viewsRegistry = Registry.as<IViewsRegistry>(Extensions.ViewsRegistry);
viewsRegistry.registerViewWelcomeContent(EmptyView.ID, {
	content: localize({ key: 'noWorkspaceHelp', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"You have not yet added a folder to the workspace.\n[Add Folder](command:{0})", AddRootFolderAction.ID),
	when: WorkbenchStateContext.isEqualTo('workspace'),
	group: ViewContentGroups.Open,
	order: 1
});

const commandId = isMacintosh ? OpenFileFolderAction.ID : OpenFolderAction.ID;
viewsRegistry.registerViewWelcomeContent(EmptyView.ID, {
	content: localize({ key: 'remoteNoFolderHelp', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"Connected to remote.\n[Open Folder](command:{0})", commandId),
	when: ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('workspace'), RemoteNameContext.notEqualsTo(''), IsWebContext.toNegated()),
	group: ViewContentGroups.Open,
	order: 1
});

viewsRegistry.registerViewWelcomeContent(EmptyView.ID, {
	content: localize({ key: 'noFolderHelp', comment: ['Please do not translate the word "commmand", it is part of our internal syntax which must not change'] },
		"You have not yet opened a folder.\n[Open Folder](command:{0})", commandId),
	when: ContextKeyExpr.or(ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('workspace'), RemoteNameContext.isEqualTo('')), ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('workspace'), IsWebContext)),
	group: ViewContentGroups.Open,
	order: 1
});
