/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/extensionsViewlet';
import { localize } from 'vs/nls';
import { timeout, Delayer } from 'vs/base/common/async';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { Event as EventOf, Emitter } from 'vs/base/common/event';
import { IAction, Action } from 'vs/base/common/actions';
import { Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { IViewlet } from 'vs/workbench/common/viewlet';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { append, $, addClass, toggleClass, Dimension, hide, show } from 'vs/base/browser/dom';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IExtensionsWorkbenchService, IExtensionsViewPaneContainer, VIEWLET_ID, AutoUpdateConfigurationKey, ShowRecommendationsOnlyOnDemandKey, CloseExtensionDetailsOnViewChangeKey } from '../common/extensions';
import {
	ShowEnabledExtensionsAction, ShowInstalledExtensionsAction, ShowRecommendedExtensionsAction, ShowPopularExtensionsAction, ShowDisabledExtensionsAction,
	ShowOutdatedExtensionsAction, ClearExtensionsInputAction, ChangeSortAction, UpdateAllAction, CheckForUpdatesAction, DisableAllAction, EnableAllAction,
	EnableAutoUpdateAction, DisableAutoUpdateAction, ShowBuiltInExtensionsAction, InstallVSIXAction
} from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, IExtensionManagementServerService, IExtensionManagementServer } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ExtensionsInput } from 'vs/workbench/contrib/extensions/common/extensionsInput';
import { ExtensionsListView, EnabledExtensionsView, DisabledExtensionsView, RecommendedExtensionsView, WorkspaceRecommendedExtensionsView, BuiltInExtensionsView, BuiltInThemesExtensionsView, BuiltInBasicsExtensionsView, ServerExtensionsView, DefaultRecommendedExtensionsView } from 'vs/workbench/contrib/extensions/browser/extensionsViews';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import Severity from 'vs/base/common/severity';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IViewsRegistry, IViewDescriptor, Extensions, ViewContainer, IViewDescriptorService, IAddedViewDescriptorRef } from 'vs/workbench/common/views';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IContextKeyService, ContextKeyExpr, RawContextKey, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { getMaliciousExtensionsSet } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ViewPane, ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { Query } from 'vs/workbench/contrib/extensions/common/extensionQuery';
import { SuggestEnabledInput, attachSuggestEnabledInputBoxStyler } from 'vs/workbench/contrib/codeEditor/browser/suggestEnabledInput/suggestEnabledInput';
import { alert } from 'vs/base/browser/ui/aria/aria';
import { createErrorWithActions } from 'vs/base/common/errorsWithActions';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ExtensionType } from 'vs/platform/extensions/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { RemoteNameContext } from 'vs/workbench/browser/contextkeys';
import { ILabelService } from 'vs/platform/label/common/label';
import { MementoObject } from 'vs/workbench/common/memento';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { DragAndDropObserver } from 'vs/workbench/browser/dnd';
import { URI } from 'vs/base/common/uri';
import { SIDE_BAR_DRAG_AND_DROP_BACKGROUND } from 'vs/workbench/common/theme';

const NonEmptyWorkspaceContext = new RawContextKey<boolean>('nonEmptyWorkspace', false);
const DefaultViewsContext = new RawContextKey<boolean>('defaultExtensionViews', true);
const SearchMarketplaceExtensionsContext = new RawContextKey<boolean>('searchMarketplaceExtensions', false);
const SearchIntalledExtensionsContext = new RawContextKey<boolean>('searchInstalledExtensions', false);
const SearchOutdatedExtensionsContext = new RawContextKey<boolean>('searchOutdatedExtensions', false);
const SearchEnabledExtensionsContext = new RawContextKey<boolean>('searchEnabledExtensions', false);
const SearchDisabledExtensionsContext = new RawContextKey<boolean>('searchDisabledExtensions', false);
const HasInstalledExtensionsContext = new RawContextKey<boolean>('hasInstalledExtensions', true);
const SearchBuiltInExtensionsContext = new RawContextKey<boolean>('searchBuiltInExtensions', false);
const RecommendedExtensionsContext = new RawContextKey<boolean>('recommendedExtensions', false);
const DefaultRecommendedExtensionsContext = new RawContextKey<boolean>('defaultRecommendedExtensions', false);
const viewIdNameMappings: { [id: string]: string } = {
	'extensions.listView': localize('marketPlace', "Marketplace"),
	'extensions.enabledExtensionList': localize('enabledExtensions', "Enabled"),
	'extensions.enabledExtensionList2': localize('enabledExtensions', "Enabled"),
	'extensions.disabledExtensionList': localize('disabledExtensions', "Disabled"),
	'extensions.disabledExtensionList2': localize('disabledExtensions', "Disabled"),
	'extensions.popularExtensionsList': localize('popularExtensions', "Popular"),
	'extensions.recommendedList': localize('recommendedExtensions', "Recommended"),
	'extensions.otherrecommendedList': localize('otherRecommendedExtensions', "Other Recommendations"),
	'extensions.workspaceRecommendedList': localize('workspaceRecommendedExtensions', "Workspace Recommendations"),
	'extensions.builtInExtensionsList': localize('builtInExtensions', "Features"),
	'extensions.builtInThemesExtensionsList': localize('builtInThemesExtensions', "Themes"),
	'extensions.builtInBasicsExtensionsList': localize('builtInBasicsExtensions', "Programming Languages"),
	'extensions.syncedExtensionsList': localize('syncedExtensions', "My Account"),
};

export class ExtensionsViewletViewsContribution implements IWorkbenchContribution {

	private readonly container: ViewContainer;

	constructor(
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@ILabelService private readonly labelService: ILabelService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {
		this.container = viewDescriptorService.getViewContainerById(VIEWLET_ID)!;
		this.registerViews();
	}

	private registerViews(): void {
		let viewDescriptors: IViewDescriptor[] = [];
		viewDescriptors.push(this.createMarketPlaceExtensionsListViewDescriptor());
		viewDescriptors.push(this.createDefaultEnabledExtensionsListViewDescriptor());
		viewDescriptors.push(this.createDefaultDisabledExtensionsListViewDescriptor());
		viewDescriptors.push(this.createDefaultPopularExtensionsListViewDescriptor());
		viewDescriptors.push(this.createEnabledExtensionsListViewDescriptor());
		viewDescriptors.push(this.createDisabledExtensionsListViewDescriptor());
		viewDescriptors.push(this.createBuiltInExtensionsListViewDescriptor());
		viewDescriptors.push(this.createBuiltInBasicsExtensionsListViewDescriptor());
		viewDescriptors.push(this.createBuiltInThemesExtensionsListViewDescriptor());
		viewDescriptors.push(this.createDefaultRecommendedExtensionsListViewDescriptor());
		viewDescriptors.push(this.createOtherRecommendedExtensionsListViewDescriptor());
		viewDescriptors.push(this.createWorkspaceRecommendedExtensionsListViewDescriptor());

		if (this.extensionManagementServerService.localExtensionManagementServer) {
			viewDescriptors.push(...this.createExtensionsViewDescriptorsForServer(this.extensionManagementServerService.localExtensionManagementServer));
		}
		if (this.extensionManagementServerService.remoteExtensionManagementServer) {
			viewDescriptors.push(...this.createExtensionsViewDescriptorsForServer(this.extensionManagementServerService.remoteExtensionManagementServer));
		}

		Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews(viewDescriptors, this.container);
	}

	// View used for any kind of searching
	private createMarketPlaceExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.listView';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(ExtensionsListView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchMarketplaceExtensions')),
			weight: 100
		};
	}

	// Separate view for enabled extensions required as we need to show enabled, disabled and recommended sections
	// in the default view when there is no search text, but user has installed extensions.
	private createDefaultEnabledExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.enabledExtensionList';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(EnabledExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.has('hasInstalledExtensions'), RemoteNameContext.isEqualTo('')),
			weight: 40,
			canToggleVisibility: true,
			order: 1
		};
	}

	// Separate view for disabled extensions required as we need to show enabled, disabled and recommended sections
	// in the default view when there is no search text, but user has installed extensions.
	private createDefaultDisabledExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.disabledExtensionList';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(DisabledExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.has('hasInstalledExtensions'), RemoteNameContext.isEqualTo('')),
			weight: 10,
			canToggleVisibility: true,
			order: 3,
			collapsed: true
		};
	}

	// Separate view for popular extensions required as we need to show popular and recommended sections
	// in the default view when there is no search text, and user has no installed extensions.
	private createDefaultPopularExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.popularExtensionsList';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(ExtensionsListView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.not('hasInstalledExtensions')),
			weight: 60,
			order: 1
		};
	}

	private createExtensionsViewDescriptorsForServer(server: IExtensionManagementServer): IViewDescriptor[] {
		const getViewName = (viewTitle: string, server: IExtensionManagementServer): string => {
			const serverLabel = server.label;
			if (viewTitle && this.extensionManagementServerService.localExtensionManagementServer && this.extensionManagementServerService.remoteExtensionManagementServer) {
				return `${serverLabel} - ${viewTitle}`;
			}
			return viewTitle ? viewTitle : serverLabel;
		};
		const getInstalledViewName = (): string => getViewName(localize('installed', "Installed"), server);
		const getOutdatedViewName = (): string => getViewName(localize('outdated', "Outdated"), server);
		const onDidChangeServerLabel: EventOf<void> = EventOf.map(this.labelService.onDidChangeFormatters, () => undefined);
		return [{
			id: `extensions.${server.authority}.installed`,
			get name() { return getInstalledViewName(); },
			ctorDescriptor: new SyncDescriptor(ServerExtensionsView, [server, EventOf.map<void, string>(onDidChangeServerLabel, () => getInstalledViewName())]),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchInstalledExtensions')),
			weight: 100
		}, {
			id: `extensions.${server.authority}.outdated`,
			get name() { return getOutdatedViewName(); },
			ctorDescriptor: new SyncDescriptor(ServerExtensionsView, [server, EventOf.map<void, string>(onDidChangeServerLabel, () => getOutdatedViewName())]),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchOutdatedExtensions')),
			weight: 100
		}, {
			id: `extensions.${server.authority}.default`,
			get name() { return getInstalledViewName(); },
			ctorDescriptor: new SyncDescriptor(ServerExtensionsView, [server, EventOf.map<void, string>(onDidChangeServerLabel, () => getInstalledViewName())]),
			when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.has('hasInstalledExtensions'), RemoteNameContext.notEqualsTo('')),
			weight: 40,
			order: 1
		}];
	}

	// Separate view for recommended extensions required as we need to show it along with other views when there is no search text.
	// When user has installed extensions, this is shown along with the views for enabled & disabled extensions
	// When user has no installed extensions, this is shown along with the view for popular extensions
	private createDefaultRecommendedExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.recommendedList';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(DefaultRecommendedExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.has('defaultRecommendedExtensions')),
			weight: 40,
			order: 2,
			canToggleVisibility: true
		};
	}

	// Separate view for recommedations that are not workspace recommendations.
	// Shown along with view for workspace recommendations, when using the command that shows recommendations
	private createOtherRecommendedExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.otherrecommendedList';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(RecommendedExtensionsView),
			when: ContextKeyExpr.has('recommendedExtensions'),
			weight: 50,
			order: 2
		};
	}

	// Separate view for workspace recommendations.
	// Shown along with view for other recommendations, when using the command that shows recommendations
	private createWorkspaceRecommendedExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.workspaceRecommendedList';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(WorkspaceRecommendedExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('recommendedExtensions'), ContextKeyExpr.has('nonEmptyWorkspace')),
			weight: 50,
			order: 1
		};
	}

	private createEnabledExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.enabledExtensionList2';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(EnabledExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchEnabledExtensions')),
			weight: 40,
			order: 1
		};
	}

	private createDisabledExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.disabledExtensionList2';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(DisabledExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchDisabledExtensions')),
			weight: 10,
			order: 3,
			collapsed: true
		};
	}

	private createBuiltInExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.builtInExtensionsList';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(BuiltInExtensionsView),
			when: ContextKeyExpr.has('searchBuiltInExtensions'),
			weight: 100
		};
	}

	private createBuiltInThemesExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.builtInThemesExtensionsList';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(BuiltInThemesExtensionsView),
			when: ContextKeyExpr.has('searchBuiltInExtensions'),
			weight: 100
		};
	}

	private createBuiltInBasicsExtensionsListViewDescriptor(): IViewDescriptor {
		const id = 'extensions.builtInBasicsExtensionsList';
		return {
			id,
			name: viewIdNameMappings[id],
			ctorDescriptor: new SyncDescriptor(BuiltInBasicsExtensionsView),
			when: ContextKeyExpr.has('searchBuiltInExtensions'),
			weight: 100
		};
	}

}

export class ExtensionsViewPaneContainer extends ViewPaneContainer implements IExtensionsViewPaneContainer {

	private readonly _onSearchChange: Emitter<string> = this._register(new Emitter<string>());
	private readonly onSearchChange: EventOf<string> = this._onSearchChange.event;
	private nonEmptyWorkspaceContextKey: IContextKey<boolean>;
	private defaultViewsContextKey: IContextKey<boolean>;
	private searchMarketplaceExtensionsContextKey: IContextKey<boolean>;
	private searchInstalledExtensionsContextKey: IContextKey<boolean>;
	private searchOutdatedExtensionsContextKey: IContextKey<boolean>;
	private searchEnabledExtensionsContextKey: IContextKey<boolean>;
	private searchDisabledExtensionsContextKey: IContextKey<boolean>;
	private hasInstalledExtensionsContextKey: IContextKey<boolean>;
	private searchBuiltInExtensionsContextKey: IContextKey<boolean>;
	private recommendedExtensionsContextKey: IContextKey<boolean>;
	private defaultRecommendedExtensionsContextKey: IContextKey<boolean>;

	private searchDelayer: Delayer<void>;
	private root: HTMLElement | undefined;
	private searchBox: SuggestEnabledInput | undefined;
	private primaryActions: IAction[] | undefined;
	private secondaryActions: IAction[] | null = null;
	private readonly searchViewletState: MementoObject;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IProgressService private readonly progressService: IProgressService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@INotificationService private readonly notificationService: INotificationService,
		@IViewletService private readonly viewletService: IViewletService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IPreferencesService private readonly preferencesService: IPreferencesService
	) {
		super(VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService);

		this.searchDelayer = new Delayer(500);
		this.nonEmptyWorkspaceContextKey = NonEmptyWorkspaceContext.bindTo(contextKeyService);
		this.defaultViewsContextKey = DefaultViewsContext.bindTo(contextKeyService);
		this.searchMarketplaceExtensionsContextKey = SearchMarketplaceExtensionsContext.bindTo(contextKeyService);
		this.searchInstalledExtensionsContextKey = SearchIntalledExtensionsContext.bindTo(contextKeyService);
		this.searchOutdatedExtensionsContextKey = SearchOutdatedExtensionsContext.bindTo(contextKeyService);
		this.searchEnabledExtensionsContextKey = SearchEnabledExtensionsContext.bindTo(contextKeyService);
		this.searchDisabledExtensionsContextKey = SearchDisabledExtensionsContext.bindTo(contextKeyService);
		this.hasInstalledExtensionsContextKey = HasInstalledExtensionsContext.bindTo(contextKeyService);
		this.searchBuiltInExtensionsContextKey = SearchBuiltInExtensionsContext.bindTo(contextKeyService);
		this.recommendedExtensionsContextKey = RecommendedExtensionsContext.bindTo(contextKeyService);
		this.defaultRecommendedExtensionsContextKey = DefaultRecommendedExtensionsContext.bindTo(contextKeyService);
		this.defaultRecommendedExtensionsContextKey.set(!this.configurationService.getValue<boolean>(ShowRecommendationsOnlyOnDemandKey));
		this._register(this.viewletService.onDidViewletOpen(this.onViewletOpen, this));
		this.searchViewletState = this.getMemento(StorageScope.WORKSPACE);

		this.extensionManagementService.getInstalled(ExtensionType.User).then(result => {
			this.hasInstalledExtensionsContextKey.set(result.length > 0);
		});

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AutoUpdateConfigurationKey)) {
				this.secondaryActions = null;
				this.updateTitleArea();
			}
			if (e.affectedKeys.indexOf(ShowRecommendationsOnlyOnDemandKey) > -1) {
				this.defaultRecommendedExtensionsContextKey.set(!this.configurationService.getValue<boolean>(ShowRecommendationsOnlyOnDemandKey));
			}
		}, this));
	}

	create(parent: HTMLElement): void {
		addClass(parent, 'extensions-viewlet');
		this.root = parent;

		const overlay = append(this.root, $('.overlay'));
		const overlayBackgroundColor = this.getColor(SIDE_BAR_DRAG_AND_DROP_BACKGROUND) ?? '';
		overlay.style.backgroundColor = overlayBackgroundColor;
		hide(overlay);

		const header = append(this.root, $('.header'));
		const placeholder = localize('searchExtensions', "Search Extensions in Marketplace");
		const searchValue = this.searchViewletState['query.value'] ? this.searchViewletState['query.value'] : '';

		this.searchBox = this._register(this.instantiationService.createInstance(SuggestEnabledInput, `${VIEWLET_ID}.searchbox`, header, {
			triggerCharacters: ['@'],
			sortKey: (item: string) => {
				if (item.indexOf(':') === -1) { return 'a'; }
				else if (/ext:/.test(item) || /id:/.test(item) || /tag:/.test(item)) { return 'b'; }
				else if (/sort:/.test(item)) { return 'c'; }
				else { return 'd'; }
			},
			provideResults: (query: string) => Query.suggestions(query)
		}, placeholder, 'extensions:searchinput', { placeholderText: placeholder, value: searchValue }));

		if (this.searchBox.getValue()) {
			this.triggerSearch();
		}

		this._register(attachSuggestEnabledInputBoxStyler(this.searchBox, this.themeService));

		this._register(this.searchBox.onInputDidChange(() => {
			this.triggerSearch();
			this._onSearchChange.fire(this.searchBox!.getValue());
		}, this));

		this._register(this.searchBox.onShouldFocusResults(() => this.focusListView(), this));

		this._register(this.onDidChangeVisibility(visible => {
			if (visible) {
				this.searchBox!.focus();
			}
		}));

		// Register DragAndDrop support
		this._register(new DragAndDropObserver(this.root, {
			onDragEnd: (e: DragEvent) => undefined,
			onDragEnter: (e: DragEvent) => {
				if (this.isSupportedDragElement(e)) {
					show(overlay);
				}
			},
			onDragLeave: (e: DragEvent) => {
				if (this.isSupportedDragElement(e)) {
					hide(overlay);
				}
			},
			onDragOver: (e: DragEvent) => {
				if (e.dataTransfer) {
					e.dataTransfer.dropEffect = this.isSupportedDragElement(e) ? 'copy' : 'none';
				}
			},
			onDrop: async (e: DragEvent) => {
				if (this.isSupportedDragElement(e)) {
					hide(overlay);

					if (e.dataTransfer && e.dataTransfer.files.length > 0) {
						let vsixPaths: URI[] = [];
						for (let index = 0; index < e.dataTransfer.files.length; index++) {
							const path = e.dataTransfer.files.item(index)!.path;
							if (path.indexOf('.vsix') !== -1) {
								vsixPaths.push(URI.parse(path));
							}
						}

						try {
							// Attempt to install the extension(s)
							await this.instantiationService.createInstance(InstallVSIXAction, InstallVSIXAction.ID, InstallVSIXAction.LABEL).run(vsixPaths);
						}
						catch (err) {
							this.notificationService.error(err);
						}
					}
				}
			},
		}));

		super.create(append(this.root, $('.extensions')));
	}

	focus(): void {
		if (this.searchBox) {
			this.searchBox.focus();
		}
	}

	layout(dimension: Dimension): void {
		if (this.root) {
			toggleClass(this.root, 'narrow', dimension.width <= 300);
		}
		if (this.searchBox) {
			this.searchBox.layout({ height: 20, width: dimension.width - 34 });
		}
		super.layout(new Dimension(dimension.width, dimension.height - 41));
	}

	getOptimalWidth(): number {
		return 400;
	}

	getActions(): IAction[] {
		if (!this.primaryActions) {
			this.primaryActions = [
				this.instantiationService.createInstance(ClearExtensionsInputAction, ClearExtensionsInputAction.ID, ClearExtensionsInputAction.LABEL, this.onSearchChange, this.searchBox ? this.searchBox.getValue() : '')
			];
		}
		return this.primaryActions;
	}

	getSecondaryActions(): IAction[] {
		if (!this.secondaryActions) {
			this.secondaryActions = [
				this.instantiationService.createInstance(ShowInstalledExtensionsAction, ShowInstalledExtensionsAction.ID, ShowInstalledExtensionsAction.LABEL),
				this.instantiationService.createInstance(ShowOutdatedExtensionsAction, ShowOutdatedExtensionsAction.ID, ShowOutdatedExtensionsAction.LABEL),
				this.instantiationService.createInstance(ShowEnabledExtensionsAction, ShowEnabledExtensionsAction.ID, ShowEnabledExtensionsAction.LABEL),
				this.instantiationService.createInstance(ShowDisabledExtensionsAction, ShowDisabledExtensionsAction.ID, ShowDisabledExtensionsAction.LABEL),
				this.instantiationService.createInstance(ShowBuiltInExtensionsAction, ShowBuiltInExtensionsAction.ID, ShowBuiltInExtensionsAction.LABEL),
				this.instantiationService.createInstance(ShowRecommendedExtensionsAction, ShowRecommendedExtensionsAction.ID, ShowRecommendedExtensionsAction.LABEL),
				this.instantiationService.createInstance(ShowPopularExtensionsAction, ShowPopularExtensionsAction.ID, ShowPopularExtensionsAction.LABEL),
				new Separator(),
				this.instantiationService.createInstance(ChangeSortAction, 'extensions.sort.install', localize('sort by installs', "Sort By: Install Count"), this.onSearchChange, 'installs'),
				this.instantiationService.createInstance(ChangeSortAction, 'extensions.sort.rating', localize('sort by rating', "Sort By: Rating"), this.onSearchChange, 'rating'),
				this.instantiationService.createInstance(ChangeSortAction, 'extensions.sort.name', localize('sort by name', "Sort By: Name"), this.onSearchChange, 'name'),
				new Separator(),
				this.instantiationService.createInstance(CheckForUpdatesAction, CheckForUpdatesAction.ID, CheckForUpdatesAction.LABEL),
				...(this.configurationService.getValue(AutoUpdateConfigurationKey) ? [this.instantiationService.createInstance(DisableAutoUpdateAction, DisableAutoUpdateAction.ID, DisableAutoUpdateAction.LABEL)] : [this.instantiationService.createInstance(UpdateAllAction, UpdateAllAction.ID, UpdateAllAction.LABEL), this.instantiationService.createInstance(EnableAutoUpdateAction, EnableAutoUpdateAction.ID, EnableAutoUpdateAction.LABEL)]),
				this.instantiationService.createInstance(InstallVSIXAction, InstallVSIXAction.ID, InstallVSIXAction.LABEL),
				new Separator(),
				this.instantiationService.createInstance(DisableAllAction, DisableAllAction.ID, DisableAllAction.LABEL),
				this.instantiationService.createInstance(EnableAllAction, EnableAllAction.ID, EnableAllAction.LABEL)
			];
		}

		return this.secondaryActions;
	}

	search(value: string, refresh: boolean = false): void {
		if (this.searchBox) {
			if (this.searchBox.getValue() !== value) {
				this.searchBox.setValue(value);
			} else if (refresh) {
				this.doSearch();
			}
		}
	}

	private triggerSearch(): void {
		this.searchDelayer.trigger(() => this.doSearch(), this.searchBox && this.searchBox.getValue() ? 500 : 0).then(undefined, err => this.onError(err));
	}

	private normalizedQuery(): string {
		return this.searchBox ? this.searchBox.getValue().replace(/@category/g, 'category').replace(/@tag:/g, 'tag:').replace(/@ext:/g, 'ext:') : '';
	}

	saveState(): void {
		const value = this.searchBox ? this.searchBox.getValue() : '';
		if (ExtensionsListView.isLocalExtensionsQuery(value)) {
			this.searchViewletState['query.value'] = value;
		} else {
			this.searchViewletState['query.value'] = '';
		}
		super.saveState();
	}

	private doSearch(): Promise<void> {
		const value = this.normalizedQuery();
		const isRecommendedExtensionsQuery = ExtensionsListView.isRecommendedExtensionsQuery(value);
		this.searchInstalledExtensionsContextKey.set(ExtensionsListView.isInstalledExtensionsQuery(value));
		this.searchOutdatedExtensionsContextKey.set(ExtensionsListView.isOutdatedExtensionsQuery(value));
		this.searchEnabledExtensionsContextKey.set(ExtensionsListView.isEnabledExtensionsQuery(value));
		this.searchDisabledExtensionsContextKey.set(ExtensionsListView.isDisabledExtensionsQuery(value));
		this.searchBuiltInExtensionsContextKey.set(ExtensionsListView.isBuiltInExtensionsQuery(value));
		this.recommendedExtensionsContextKey.set(isRecommendedExtensionsQuery);
		this.searchMarketplaceExtensionsContextKey.set(!!value && !ExtensionsListView.isLocalExtensionsQuery(value) && !isRecommendedExtensionsQuery);
		this.nonEmptyWorkspaceContextKey.set(this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY);
		this.defaultViewsContextKey.set(!value);

		return this.progress(Promise.all(this.panes.map(view =>
			(<ExtensionsListView>view).show(this.normalizedQuery())
				.then(model => this.alertSearchResult(model.length, view.id))
		))).then(() => undefined);
	}

	protected onDidAddViewDescriptors(added: IAddedViewDescriptorRef[]): ViewPane[] {
		const addedViews = super.onDidAddViewDescriptors(added);
		this.progress(Promise.all(addedViews.map(addedView =>
			(<ExtensionsListView>addedView).show(this.normalizedQuery())
				.then(model => this.alertSearchResult(model.length, addedView.id))
		)));
		return addedViews;
	}

	private alertSearchResult(count: number, viewId: string): void {
		switch (count) {
			case 0:
				break;
			case 1:
				if (viewIdNameMappings[viewId]) {
					alert(localize('extensionFoundInSection', "1 extension found in the {0} section.", viewIdNameMappings[viewId]));
				} else {
					alert(localize('extensionFound', "1 extension found."));
				}
				break;
			default:
				if (viewIdNameMappings[viewId]) {
					alert(localize('extensionsFoundInSection', "{0} extensions found in the {1} section.", count, viewIdNameMappings[viewId]));
				} else {
					alert(localize('extensionsFound', "{0} extensions found.", count));
				}
				break;
		}
	}

	private count(): number {
		return this.panes.reduce((count, view) => (<ExtensionsListView>view).count() + count, 0);
	}

	private focusListView(): void {
		if (this.count() > 0) {
			this.panes[0].focus();
		}
	}

	private onViewletOpen(viewlet: IViewlet): void {
		if (!viewlet || viewlet.getId() === VIEWLET_ID) {
			return;
		}

		if (this.configurationService.getValue<boolean>(CloseExtensionDetailsOnViewChangeKey)) {
			const promises = this.editorGroupService.groups.map(group => {
				const editors = group.editors.filter(input => input instanceof ExtensionsInput);

				return group.closeEditors(editors);
			});

			Promise.all(promises);
		}
	}

	private progress<T>(promise: Promise<T>): Promise<T> {
		return this.progressService.withProgress({ location: ProgressLocation.Extensions }, () => promise);
	}

	private onError(err: Error): void {
		if (isPromiseCanceledError(err)) {
			return;
		}

		const message = err && err.message || '';

		if (/ECONNREFUSED/.test(message)) {
			const error = createErrorWithActions(localize('suggestProxyError', "Marketplace returned 'ECONNREFUSED'. Please check the 'http.proxy' setting."), {
				actions: [
					new Action('open user settings', localize('open user settings', "Open User Settings"), undefined, true, () => this.preferencesService.openGlobalSettings())
				]
			});

			this.notificationService.error(error);
			return;
		}

		this.notificationService.error(err);
	}

	private isSupportedDragElement(e: DragEvent): boolean {
		if (e.dataTransfer) {
			const typesLowerCase = e.dataTransfer.types.map(t => t.toLocaleLowerCase());
			return typesLowerCase.indexOf('files') !== -1;
		}

		return false;
	}
}

export class StatusUpdater extends Disposable implements IWorkbenchContribution {

	private readonly badgeHandle = this._register(new MutableDisposable());

	constructor(
		@IActivityService private readonly activityService: IActivityService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService
	) {
		super();
		this._register(extensionsWorkbenchService.onChange(this.onServiceChange, this));
	}

	private onServiceChange(): void {
		this.badgeHandle.clear();

		const outdated = this.extensionsWorkbenchService.outdated.reduce((r, e) => r + (this.extensionEnablementService.isEnabled(e.local!) ? 1 : 0), 0);
		if (outdated > 0) {
			const badge = new NumberBadge(outdated, n => localize('outdatedExtensions', '{0} Outdated Extensions', n));
			this.badgeHandle.value = this.activityService.showViewContainerActivity(VIEWLET_ID, { badge, clazz: 'extensions-badge count-badge' });
		}
	}
}

export class MaliciousExtensionChecker implements IWorkbenchContribution {

	constructor(
		@IExtensionManagementService private readonly extensionsManagementService: IExtensionManagementService,
		@IHostService private readonly hostService: IHostService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		if (!this.environmentService.disableExtensions) {
			this.loopCheckForMaliciousExtensions();
		}
	}

	private loopCheckForMaliciousExtensions(): void {
		this.checkForMaliciousExtensions()
			.then(() => timeout(1000 * 60 * 5)) // every five minutes
			.then(() => this.loopCheckForMaliciousExtensions());
	}

	private checkForMaliciousExtensions(): Promise<void> {
		return this.extensionsManagementService.getExtensionsReport().then(report => {
			const maliciousSet = getMaliciousExtensionsSet(report);

			return this.extensionsManagementService.getInstalled(ExtensionType.User).then(installed => {
				const maliciousExtensions = installed
					.filter(e => maliciousSet.has(e.identifier.id));

				if (maliciousExtensions.length) {
					return Promise.all(maliciousExtensions.map(e => this.extensionsManagementService.uninstall(e, true).then(() => {
						this.notificationService.prompt(
							Severity.Warning,
							localize('malicious warning', "We have uninstalled '{0}' which was reported to be problematic.", e.identifier.id),
							[{
								label: localize('reloadNow', "Reload Now"),
								run: () => this.hostService.reload()
							}],
							{ sticky: true }
						);
					})));
				} else {
					return Promise.resolve(undefined);
				}
			}).then(() => undefined);
		}, err => this.logService.error(err));
	}
}
