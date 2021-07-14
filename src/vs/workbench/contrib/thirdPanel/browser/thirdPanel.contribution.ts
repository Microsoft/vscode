/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Registry } from 'vs/platform/registry/common/platform';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IViewContainersRegistry, ViewContainerLocation, Extensions as ViewContainerExtensions, IViewsRegistry, IViewDescriptorService } from 'vs/workbench/common/views';
import { THIRD_PANEL_VIEWLET_ID } from 'vs/workbench/contrib/thirdPanel/browser/thirdPanel';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';

export class ThirdPanelViewPaneContainer extends ViewPaneContainer {
	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {
		super(THIRD_PANEL_VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService);
	}

	override create(parent: HTMLElement): void {
		super.create(parent);
		parent.classList.add('third-panel-viewlet');
	}
}

export const thirdPanelViewRegistry = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: THIRD_PANEL_VIEWLET_ID,
	title: 'Third Panel',
	ctorDescriptor: new SyncDescriptor(ThirdPanelViewPaneContainer),
	storageId: 'workbench.thirdpanel.views.state',
	order: 1,
	hideIfEmpty: false,
}, ViewContainerLocation.ThirdPanel, { isDefault: true, donotRegisterOpenCommand: true });

const viewsRegistry = Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry);

viewsRegistry.registerViewWelcomeContent(THIRD_PANEL_VIEWLET_ID, {
	content: 'Third Panel Area',
	when: 'default'
});
