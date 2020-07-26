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
import { IAction, Action, Separator, SubmenuAction } from 'vs/base/common/actions';
import { IViewlet } from 'vs/workbench/common/viewlet';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { append, $, addClass, toggleClass, Dimension, hide, show } from 'vs/base/browser/dom';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IExtensionsWorkbenchService, IExtensionsViewPaneContainer, VIEWLET_ID, AutoUpdateConfigurationKey, CloseExtensionDetailsOnViewChangeKey } from '../common/extensions';
import {
	ClearExtensionsInputAction, ChangeSortAction, UpdateAllAction, CheckForUpdatesAction, DisableAllAction, EnableAllAction,
	EnableAutoUpdateAction, DisableAutoUpdateAction, ShowBuiltInExtensionsAction, InstallVSIXAction, SearchCategoryAction,
	RecentlyPublishedExtensionsAction, ShowInstalledExtensionsAction, ShowOutdatedExtensionsAction, ShowDisabledExtensionsAction,
	ShowEnabledExtensionsAction, PredefinedExtensionFilterAction
} from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { IExtensionManagementService, IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, IExtensionManagementServerService, IExtensionManagementServer } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ExtensionsInput } from 'vs/workbench/contrib/extensions/common/extensionsInput';
import { ExtensionsListView, EnabledExtensionsView, DisabledExtensionsView, RecommendedExtensionsView, WorkspaceRecommendedExtensionsView, BuiltInFeatureExtensionsView, BuiltInThemesExtensionsView, BuiltInProgrammingLanguageExtensionsView, ServerExtensionsView, DefaultRecommendedExtensionsView, OutdatedExtensionsView, InstalledExtensionsView, SearchBuiltInExtensionsView } from 'vs/workbench/contrib/extensions/browser/extensionsViews';
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
import { ExtensionType, EXTENSION_CATEGORIES } from 'vs/platform/extensions/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
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
const BuiltInExtensionsContext = new RawContextKey<boolean>('builtInExtensions', false);
const SearchBuiltInExtensionsContext = new RawContextKey<boolean>('searchBuiltInExtensions', false);
const RecommendedExtensionsContext = new RawContextKey<boolean>('recommendedExtensions', false);

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
		const viewDescriptors: IViewDescriptor[] = [];

		/* Default views */
		viewDescriptors.push(...this.createDefaultExtensionsViewDescriptors());

		/* Search views */
		viewDescriptors.push(...this.createSearchExtensionsViewDescriptors());

		/* Recommendations views */
		viewDescriptors.push(...this.createRecommendedExtensionsViewDescriptors());

		/* Built-in extensions views */
		viewDescriptors.push(...this.createBuiltinExtensionsViewDescriptors());

		Registry.as<IViewsRegistry>(Extensions.ViewsRegistry).registerViews(viewDescriptors, this.container);
	}

	private createDefaultExtensionsViewDescriptors(): IViewDescriptor[] {
		const viewDescriptors: IViewDescriptor[] = [];

		/*
		 * Default popular extensions view
		 * Separate view for popular extensions required as we need to show popular and recommended sections
		 * in the default view when there is no search text, and user has no installed extensions.
		 */
		viewDescriptors.push({
			id: 'workbench.views.extensions.popular',
			name: localize('popularExtensions', "Popular"),
			ctorDescriptor: new SyncDescriptor(ExtensionsListView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.not('hasInstalledExtensions')),
			weight: 60,
			order: 1,
		});

		/*
		 * Default installed extensions views - Shows all user installed extensions.
		 */
		const servers: IExtensionManagementServer[] = [];
		if (this.extensionManagementServerService.localExtensionManagementServer) {
			servers.push(this.extensionManagementServerService.localExtensionManagementServer);
		}
		if (this.extensionManagementServerService.remoteExtensionManagementServer) {
			servers.push(this.extensionManagementServerService.remoteExtensionManagementServer);
		}
		const getViewName = (viewTitle: string, server: IExtensionManagementServer): string => {
			return servers.length > 1 ? `${server.label} - ${viewTitle}` : viewTitle;
		};
		for (const server of servers) {
			const getInstalledViewName = (): string => getViewName(localize('installed', "Installed"), server);
			const onDidChangeServerLabel: EventOf<void> = EventOf.map(this.labelService.onDidChangeFormatters, () => undefined);
			viewDescriptors.push({
				id: servers.length > 1 ? `workbench.views.extensions.${server.id}.installed` : `workbench.views.extensions.installed`,
				get name() { return getInstalledViewName(); },
				ctorDescriptor: new SyncDescriptor(ServerExtensionsView, [server, EventOf.map<void, string>(onDidChangeServerLabel, () => getInstalledViewName())]),
				when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.has('hasInstalledExtensions')),
				weight: 100,
				order: 2,
				/* Installed extensions views shall not be hidden when there are more than one server */
				canToggleVisibility: servers.length === 1
			});
		}

		/*
		 * Default recommended extensions view
		 * When user has installed extensions, this is shown along with the views for enabled & disabled extensions
		 * When user has no installed extensions, this is shown along with the view for popular extensions
		 */
		viewDescriptors.push({
			id: 'extensions.recommendedList',
			name: localize('recommendedExtensions', "Recommended"),
			ctorDescriptor: new SyncDescriptor(DefaultRecommendedExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.not('config.extensions.showRecommendationsOnlyOnDemand')),
			weight: 40,
			order: 3,
			canToggleVisibility: true
		});

		/* Installed views shall be default in multi server window  */
		if (servers.length === 1) {
			/*
			 * Default enabled extensions view - Shows all user installed enabled extensions.
			 * Hidden by default
			 */
			viewDescriptors.push({
				id: 'workbench.views.extensions.enabled',
				name: localize('enabledExtensions', "Enabled"),
				ctorDescriptor: new SyncDescriptor(EnabledExtensionsView),
				when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.has('hasInstalledExtensions')),
				hideByDefault: true,
				weight: 40,
				order: 4,
				canToggleVisibility: true
			});

			/*
			 * Default disabled extensions view - Shows all disabled extensions.
			 * Hidden by default
			 */
			viewDescriptors.push({
				id: 'workbench.views.extensions.disabled',
				name: localize('disabledExtensions', "Disabled"),
				ctorDescriptor: new SyncDescriptor(DisabledExtensionsView),
				when: ContextKeyExpr.and(ContextKeyExpr.has('defaultExtensionViews'), ContextKeyExpr.has('hasInstalledExtensions')),
				hideByDefault: true,
				weight: 10,
				order: 5,
				canToggleVisibility: true
			});

		}

		return viewDescriptors;
	}

	private createSearchExtensionsViewDescriptors(): IViewDescriptor[] {
		const viewDescriptors: IViewDescriptor[] = [];

		/*
		 * View used for searching Marketplace
		 */
		viewDescriptors.push({
			id: 'workbench.views.extensions.marketplace',
			name: localize('marketPlace', "Marketplace"),
			ctorDescriptor: new SyncDescriptor(ExtensionsListView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchMarketplaceExtensions')),
		});

		/*
		 * View used for searching all installed extensions
		 */
		viewDescriptors.push({
			id: 'workbench.views.extensions.searchInstalled',
			name: localize('installed', "Installed"),
			ctorDescriptor: new SyncDescriptor(InstalledExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchInstalledExtensions')),
		});

		/*
		 * View used for searching enabled extensions
		 */
		viewDescriptors.push({
			id: 'workbench.views.extensions.searchEnabled',
			name: localize('enabled', "Enabled"),
			ctorDescriptor: new SyncDescriptor(EnabledExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchEnabledExtensions')),
		});

		/*
		 * View used for searching disabled extensions
		 */
		viewDescriptors.push({
			id: 'workbench.views.extensions.searchDisabled',
			name: localize('disabled', "Disabled"),
			ctorDescriptor: new SyncDescriptor(DisabledExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchDisabledExtensions')),
		});

		/*
		 * View used for searching outdated extensions
		 */
		viewDescriptors.push({
			id: 'workbench.views.extensions.searchOutdated',
			name: localize('outdated', "Outdated"),
			ctorDescriptor: new SyncDescriptor(OutdatedExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchOutdatedExtensions')),
		});

		/*
		 * View used for searching builtin extensions
		 */
		viewDescriptors.push({
			id: 'workbench.views.extensions.searchBuiltin',
			name: localize('builtin', "Builtin"),
			ctorDescriptor: new SyncDescriptor(SearchBuiltInExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('searchBuiltInExtensions')),
		});

		return viewDescriptors;
	}

	private createRecommendedExtensionsViewDescriptors(): IViewDescriptor[] {
		const viewDescriptors: IViewDescriptor[] = [];

		viewDescriptors.push({
			id: 'workbench.views.extensions.workspaceRecommendations',
			name: localize('workspaceRecommendedExtensions', "Workspace Recommendations"),
			ctorDescriptor: new SyncDescriptor(WorkspaceRecommendedExtensionsView),
			when: ContextKeyExpr.and(ContextKeyExpr.has('recommendedExtensions'), ContextKeyExpr.has('nonEmptyWorkspace')),
			order: 1
		});

		viewDescriptors.push({
			id: 'workbench.views.extensions.otherRecommendations',
			name: localize('otherRecommendedExtensions', "Other Recommendations"),
			ctorDescriptor: new SyncDescriptor(RecommendedExtensionsView),
			when: ContextKeyExpr.has('recommendedExtensions'),
			order: 2
		});

		return viewDescriptors;
	}

	private createBuiltinExtensionsViewDescriptors(): IViewDescriptor[] {
		const viewDescriptors: IViewDescriptor[] = [];

		viewDescriptors.push({
			id: 'workbench.views.extensions.builtinFeatureExtensions',
			name: localize('builtinFeatureExtensions', "Features"),
			ctorDescriptor: new SyncDescriptor(BuiltInFeatureExtensionsView),
			when: ContextKeyExpr.has('builtInExtensions'),
		});

		viewDescriptors.push({
			id: 'workbench.views.extensions.builtinThemeExtensions',
			name: localize('builtInThemesExtensions', "Themes"),
			ctorDescriptor: new SyncDescriptor(BuiltInThemesExtensionsView),
			when: ContextKeyExpr.has('builtInExtensions'),
		});

		viewDescriptors.push({
			id: 'workbench.views.extensions.builtinProgrammingLanguageExtensions',
			name: localize('builtinProgrammingLanguageExtensions', "Programming Languages"),
			ctorDescriptor: new SyncDescriptor(BuiltInProgrammingLanguageExtensionsView),
			when: ContextKeyExpr.has('builtInExtensions'),
		});

		return viewDescriptors;
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
	private builtInExtensionsContextKey: IContextKey<boolean>;
	private searchBuiltInExtensionsContextKey: IContextKey<boolean>;
	private recommendedExtensionsContextKey: IContextKey<boolean>;

	private searchDelayer: Delayer<void>;
	private root: HTMLElement | undefined;
	private searchBox: SuggestEnabledInput | undefined;
	private readonly searchViewletState: MementoObject;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IProgressService private readonly progressService: IProgressService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
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
		@IPreferencesService private readonly preferencesService: IPreferencesService,
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
		this.builtInExtensionsContextKey = BuiltInExtensionsContext.bindTo(contextKeyService);
		this.searchBuiltInExtensionsContextKey = SearchBuiltInExtensionsContext.bindTo(contextKeyService);
		this.recommendedExtensionsContextKey = RecommendedExtensionsContext.bindTo(contextKeyService);
		this._register(this.viewletService.onDidViewletOpen(this.onViewletOpen, this));
		this.searchViewletState = this.getMemento(StorageScope.WORKSPACE);

		this.extensionManagementService.getInstalled(ExtensionType.User).then(result => {
			this.hasInstalledExtensionsContextKey.set(result.length > 0);
		});

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AutoUpdateConfigurationKey)) {
				this.updateTitleArea();
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
				if (this.isSupportedDragElement(e)) {
					e.dataTransfer!.dropEffect = 'copy';
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
								vsixPaths.push(URI.file(path));
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
			}
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
		const filterActions: IAction[] = [];

		// Local extensions filters
		filterActions.push(...[
			this.instantiationService.createInstance(ShowBuiltInExtensionsAction, ShowBuiltInExtensionsAction.ID, localize('builtin filter', "Built-in")),
			this.instantiationService.createInstance(ShowInstalledExtensionsAction, ShowInstalledExtensionsAction.ID, localize('installed filter', "Installed")),
			this.instantiationService.createInstance(ShowEnabledExtensionsAction, ShowEnabledExtensionsAction.ID, localize('enabled filter', "Enabled")),
			this.instantiationService.createInstance(ShowDisabledExtensionsAction, ShowDisabledExtensionsAction.ID, localize('disabled filter', "Disabled")),
			this.instantiationService.createInstance(ShowOutdatedExtensionsAction, ShowOutdatedExtensionsAction.ID, localize('outdated filter', "Outdated")),
		]);

		if (this.extensionGalleryService.isEnabled()) {
			filterActions.splice(0, 0, ...[
				this.instantiationService.createInstance(PredefinedExtensionFilterAction, 'extensions.filter.featured', localize('featured filter', "Featured"), '@featured'),
				this.instantiationService.createInstance(PredefinedExtensionFilterAction, 'extensions.filter.popular', localize('most popular filter', "Most Popular"), '@popular'),
				this.instantiationService.createInstance(PredefinedExtensionFilterAction, 'extensions.filter.recommended', localize('most popular recommended', "Recommended"), '@recommended'),
				this.instantiationService.createInstance(RecentlyPublishedExtensionsAction, RecentlyPublishedExtensionsAction.ID, localize('recently published filter', "Recently Published")),
				new SubmenuAction('workbench.extensions.action.filterExtensionsByCategory', localize('filter by category', "Category"), EXTENSION_CATEGORIES.map(category => this.instantiationService.createInstance(SearchCategoryAction, `extensions.actions.searchByCategory.${category}`, category, category))),
				new Separator(),
			]);
			filterActions.push(...[
				new Separator(),
				new SubmenuAction('workbench.extensions.action.sortBy', localize('sorty by', "Sort By"), [
					this.instantiationService.createInstance(ChangeSortAction, 'extensions.sort.install', localize('sort by installs', "Install Count"), this.onSearchChange, 'installs'),
					this.instantiationService.createInstance(ChangeSortAction, 'extensions.sort.rating', localize('sort by rating', "Rating"), this.onSearchChange, 'rating'),
					this.instantiationService.createInstance(ChangeSortAction, 'extensions.sort.name', localize('sort by name', "Name"), this.onSearchChange, 'name'),
					this.instantiationService.createInstance(ChangeSortAction, 'extensions.sort.publishedDate', localize('sort by date', "Published Date"), this.onSearchChange, 'publishedDate'),
				]),
			]);
		}

		return [
			new SubmenuAction('workbench.extensions.action.filterExtensions', localize('filterExtensions', "Filter Extensions..."), filterActions, 'codicon-filter'),
			this.instantiationService.createInstance(ClearExtensionsInputAction, ClearExtensionsInputAction.ID, ClearExtensionsInputAction.LABEL, this.onSearchChange, this.searchBox ? this.searchBox.getValue() : ''),
		];
	}

	getSecondaryActions(): IAction[] {
		const actions: IAction[] = [];

		actions.push(this.instantiationService.createInstance(CheckForUpdatesAction, CheckForUpdatesAction.ID, CheckForUpdatesAction.LABEL));
		if (this.configurationService.getValue(AutoUpdateConfigurationKey)) {
			actions.push(this.instantiationService.createInstance(DisableAutoUpdateAction, DisableAutoUpdateAction.ID, DisableAutoUpdateAction.LABEL));
		} else {
			actions.push(this.instantiationService.createInstance(UpdateAllAction, UpdateAllAction.ID, UpdateAllAction.LABEL), this.instantiationService.createInstance(EnableAutoUpdateAction, EnableAutoUpdateAction.ID, EnableAutoUpdateAction.LABEL));
		}

		actions.push(new Separator());
		actions.push(this.instantiationService.createInstance(EnableAllAction, EnableAllAction.ID, EnableAllAction.LABEL));
		actions.push(this.instantiationService.createInstance(DisableAllAction, DisableAllAction.ID, DisableAllAction.LABEL));

		actions.push(new Separator());
		actions.push(this.instantiationService.createInstance(InstallVSIXAction, InstallVSIXAction.ID, InstallVSIXAction.LABEL));

		return actions;
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
		return this.searchBox
			? this.searchBox.getValue()
				.replace(/@category/g, 'category')
				.replace(/@tag:/g, 'tag:')
				.replace(/@ext:/g, 'ext:')
				.replace(/@featured/g, 'featured')
				.replace(/@popular/g, '@sort:installs')
			: '';
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
		this.searchBuiltInExtensionsContextKey.set(ExtensionsListView.isSearchBuiltInExtensionsQuery(value));
		this.builtInExtensionsContextKey.set(ExtensionsListView.isBuiltInExtensionsQuery(value));
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
		const view = this.viewContainerModel.visibleViewDescriptors.find(view => view.id === viewId);
		switch (count) {
			case 0:
				break;
			case 1:
				if (view) {
					alert(localize('extensionFoundInSection', "1 extension found in the {0} section.", view.name));
				} else {
					alert(localize('extensionFound', "1 extension found."));
				}
				break;
			default:
				if (view) {
					alert(localize('extensionsFoundInSection', "{0} extensions found in the {1} section.", count, view.name));
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
