/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Disposable } from 'vs/base/common/lifecycle';
import { assign } from 'vs/base/common/objects';
import { Event, Emitter } from 'vs/base/common/event';
import { isPromiseCanceledError, getErrorMessage } from 'vs/base/common/errors';
import { PagedModel, IPagedModel, IPager, DelayedPagedModel } from 'vs/base/common/paging';
import { SortBy, SortOrder, IQueryOptions } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionManagementServer, IExtensionManagementServerService, IExtensionRecommendationsService, IExtensionRecommendation, EnablementState } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { append, $, toggleClass, addClass } from 'vs/base/browser/dom';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Delegate, Renderer, IExtensionsViewState } from 'vs/workbench/contrib/extensions/browser/extensionsList';
import { IExtension, IExtensionsWorkbenchService, ExtensionState } from 'vs/workbench/contrib/extensions/common/extensions';
import { Query } from 'vs/workbench/contrib/extensions/common/extensionQuery';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachBadgeStyler } from 'vs/platform/theme/common/styler';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { InstallWorkspaceRecommendedExtensionsAction, ConfigureWorkspaceFolderRecommendedExtensionsAction, ManageExtensionAction, InstallLocalExtensionsInRemoteAction, getContextMenuActions } from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { WorkbenchPagedList, ListResourceNavigator } from 'vs/platform/list/browser/listService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { distinct, coalesce } from 'vs/base/common/arrays';
import { IExperimentService, IExperiment, ExperimentActionType } from 'vs/workbench/contrib/experiments/common/experimentService';
import { alert } from 'vs/base/browser/ui/aria/aria';
import { IListContextMenuEvent } from 'vs/base/browser/ui/list/list';
import { createErrorWithActions } from 'vs/base/common/errorsWithActions';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IAction, Action } from 'vs/base/common/actions';
import { ExtensionType, ExtensionIdentifier, IExtensionDescription, isLanguagePackExtension } from 'vs/platform/extensions/common/extensions';
import { CancelablePromise, createCancelablePromise } from 'vs/base/common/async';
import { IProductService } from 'vs/platform/product/common/productService';
import { SeverityIcon } from 'vs/platform/severityIcon/common/severityIcon';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';

// Extensions that are automatically classified as Programming Language extensions, but should be Feature extensions
const FORCE_FEATURE_EXTENSIONS = ['vscode.git', 'vscode.search-result'];

class ExtensionsViewState extends Disposable implements IExtensionsViewState {

	private readonly _onFocus: Emitter<IExtension> = this._register(new Emitter<IExtension>());
	readonly onFocus: Event<IExtension> = this._onFocus.event;

	private readonly _onBlur: Emitter<IExtension> = this._register(new Emitter<IExtension>());
	readonly onBlur: Event<IExtension> = this._onBlur.event;

	private currentlyFocusedItems: IExtension[] = [];

	onFocusChange(extensions: IExtension[]): void {
		this.currentlyFocusedItems.forEach(extension => this._onBlur.fire(extension));
		this.currentlyFocusedItems = extensions;
		this.currentlyFocusedItems.forEach(extension => this._onFocus.fire(extension));
	}
}

export interface ExtensionsListViewOptions extends IViewletViewOptions {
	server?: IExtensionManagementServer;
}

class ExtensionListViewWarning extends Error { }

export class ExtensionsListView extends ViewPane {

	protected readonly server: IExtensionManagementServer | undefined;
	private bodyTemplate: {
		messageContainer: HTMLElement;
		messageSeverityIcon: HTMLElement;
		messageBox: HTMLElement;
		extensionsList: HTMLElement;
	} | undefined;
	private badge: CountBadge | undefined;
	private list: WorkbenchPagedList<IExtension> | null = null;
	private queryRequest: { query: string, request: CancelablePromise<IPagedModel<IExtension>> } | null = null;

	constructor(
		options: ExtensionsListViewOptions,
		@INotificationService protected notificationService: INotificationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IExtensionsWorkbenchService protected extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IEditorService private readonly editorService: IEditorService,
		@IExtensionRecommendationsService protected tipsService: IExtensionRecommendationsService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkspaceContextService protected contextService: IWorkspaceContextService,
		@IExperimentService private readonly experimentService: IExperimentService,
		@IExtensionManagementServerService protected readonly extensionManagementServerService: IExtensionManagementServerService,
		@IProductService protected readonly productService: IProductService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IMenuService private readonly menuService: IMenuService,
		@IOpenerService openerService: IOpenerService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
	) {
		super({ ...(options as IViewPaneOptions), showActionsAlways: true }, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.server = options.server;
	}

	protected renderHeader(container: HTMLElement): void {
		addClass(container, 'extension-view-header');
		super.renderHeader(container);

		this.badge = new CountBadge(append(container, $('.count-badge-wrapper')));
		this._register(attachBadgeStyler(this.badge, this.themeService));
	}

	renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const extensionsList = append(container, $('.extensions-list'));
		const messageContainer = append(container, $('.message-container'));
		const messageSeverityIcon = append(messageContainer, $(''));
		const messageBox = append(messageContainer, $('.message'));
		const delegate = new Delegate();
		const extensionsViewState = new ExtensionsViewState();
		const renderer = this.instantiationService.createInstance(Renderer, extensionsViewState);
		this.list = this.instantiationService.createInstance<typeof WorkbenchPagedList, WorkbenchPagedList<IExtension>>(WorkbenchPagedList, 'Extensions', extensionsList, delegate, [renderer], {
			multipleSelectionSupport: false,
			setRowLineHeight: false,
			horizontalScrolling: false,
			accessibilityProvider: <IListAccessibilityProvider<IExtension | null>>{
				getAriaLabel(extension: IExtension | null): string {
					return extension ? localize('extension-arialabel', "{0}. Press enter for extension details.", extension.displayName) : '';
				},
				getWidgetAriaLabel(): string {
					return localize('extensions', "Extensions");
				}
			},
			overrideStyles: {
				listBackground: SIDE_BAR_BACKGROUND
			}
		});
		this._register(this.list.onContextMenu(e => this.onContextMenu(e), this));
		this._register(this.list.onDidChangeFocus(e => extensionsViewState.onFocusChange(coalesce(e.elements)), this));
		this._register(this.list);
		this._register(extensionsViewState);

		const resourceNavigator = this._register(new ListResourceNavigator(this.list, { openOnFocus: false, openOnSelection: true, openOnSingleClick: true }));
		this._register(Event.debounce(Event.filter(resourceNavigator.onDidOpenResource, e => e.element !== null), (last, event) => event, 75, true)(options => {
			this.openExtension(this.list!.model.get(options.element!), { sideByside: options.sideBySide, ...options.editorOptions });
		}));

		this._register(Event.chain(this.list.onPin)
			.map(e => e.elements[0])
			.filter(e => !!e)
			.on(this.pin, this));

		this.bodyTemplate = {
			extensionsList,
			messageBox,
			messageContainer,
			messageSeverityIcon
		};
	}

	protected layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.bodyTemplate) {
			this.bodyTemplate.extensionsList.style.height = height + 'px';
		}
		if (this.list) {
			this.list.layout(height, width);
		}
	}

	async show(query: string): Promise<IPagedModel<IExtension>> {
		if (this.queryRequest) {
			if (this.queryRequest.query === query) {
				return this.queryRequest.request;
			}
			this.queryRequest.request.cancel();
			this.queryRequest = null;
		}

		const parsedQuery = Query.parse(query);

		let options: IQueryOptions = {
			sortOrder: SortOrder.Default
		};

		switch (parsedQuery.sortBy) {
			case 'installs': options = assign(options, { sortBy: SortBy.InstallCount }); break;
			case 'rating': options = assign(options, { sortBy: SortBy.WeightedRating }); break;
			case 'name': options = assign(options, { sortBy: SortBy.Title }); break;
		}

		const successCallback = (model: IPagedModel<IExtension>) => {
			this.queryRequest = null;
			this.setModel(model);
			return model;
		};


		const errorCallback = (e: any) => {
			const model = new PagedModel([]);
			if (!isPromiseCanceledError(e)) {
				this.queryRequest = null;
				this.setModel(model, e);
			}
			return this.list ? this.list.model : model;
		};

		const request = createCancelablePromise(token => this.query(parsedQuery, options, token).then(successCallback).catch(errorCallback));
		this.queryRequest = { query, request };
		return request;
	}

	count(): number {
		return this.list ? this.list.length : 0;
	}

	protected showEmptyModel(): Promise<IPagedModel<IExtension>> {
		const emptyModel = new PagedModel([]);
		this.setModel(emptyModel);
		return Promise.resolve(emptyModel);
	}

	private async onContextMenu(e: IListContextMenuEvent<IExtension>): Promise<void> {
		if (e.element) {
			const runningExtensions = await this.extensionService.getExtensions();
			const manageExtensionAction = this.instantiationService.createInstance(ManageExtensionAction);
			manageExtensionAction.extension = e.element;
			if (manageExtensionAction.enabled) {
				const groups = await manageExtensionAction.getActionGroups(runningExtensions);
				let actions: IAction[] = [];
				for (const menuActions of groups) {
					actions = [...actions, ...menuActions, new Separator()];
				}
				this.contextMenuService.showContextMenu({
					getAnchor: () => e.anchor,
					getActions: () => actions.slice(0, actions.length - 1)
				});
			} else if (e.element) {
				const groups = getContextMenuActions(this.menuService, this.contextKeyService.createScoped(), this.instantiationService, e.element);
				groups.forEach(group => group.forEach(extensionAction => extensionAction.extension = e.element!));
				let actions: IAction[] = [];
				for (const menuActions of groups) {
					actions = [...actions, ...menuActions, new Separator()];
				}
				this.contextMenuService.showContextMenu({
					getAnchor: () => e.anchor,
					getActions: () => actions
				});
			}
		}
	}

	private async query(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const idRegex = /@id:(([a-z0-9A-Z][a-z0-9\-A-Z]*)\.([a-z0-9A-Z][a-z0-9\-A-Z]*))/g;
		const ids: string[] = [];
		let idMatch;
		while ((idMatch = idRegex.exec(query.value)) !== null) {
			const name = idMatch[1];
			ids.push(name);
		}
		if (ids.length) {
			return this.queryByIds(ids, options, token);
		}
		if (ExtensionsListView.isLocalExtensionsQuery(query.value) || /@builtin/.test(query.value)) {
			return this.queryLocal(query, options);
		}
		return this.queryGallery(query, options, token)
			.then(null, e => {
				console.warn('Error querying extensions gallery', getErrorMessage(e));
				return Promise.reject(new ExtensionListViewWarning(localize('galleryError', "We cannot connect to the Extensions Marketplace at this time, please try again later.")));
			});
	}

	private async queryByIds(ids: string[], options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const idsSet: Set<string> = ids.reduce((result, id) => { result.add(id.toLowerCase()); return result; }, new Set<string>());
		const result = (await this.extensionsWorkbenchService.queryLocal(this.server))
			.filter(e => idsSet.has(e.identifier.id.toLowerCase()));

		if (result.length) {
			return this.getPagedModel(this.sortExtensions(result, options));
		}

		return this.extensionsWorkbenchService.queryGallery({ names: ids, source: 'queryById' }, token)
			.then(pager => this.getPagedModel(pager));
	}

	private async queryLocal(query: Query, options: IQueryOptions): Promise<IPagedModel<IExtension>> {
		let value = query.value;
		if (/@builtin/i.test(value)) {
			const showThemesOnly = /@builtin:themes/i.test(value);
			if (showThemesOnly) {
				value = value.replace(/@builtin:themes/g, '');
			}
			const showBasicsOnly = /@builtin:basics/i.test(value);
			if (showBasicsOnly) {
				value = value.replace(/@builtin:basics/g, '');
			}
			const showFeaturesOnly = /@builtin:features/i.test(value);
			if (showFeaturesOnly) {
				value = value.replace(/@builtin:features/g, '');
			}

			value = value.replace(/@builtin/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase();
			let result = await this.extensionsWorkbenchService.queryLocal(this.server);

			result = result
				.filter(e => e.type === ExtensionType.System && (e.name.toLowerCase().indexOf(value) > -1 || e.displayName.toLowerCase().indexOf(value) > -1));

			if (showThemesOnly) {
				const themesExtensions = result.filter(e => {
					return e.local
						&& e.local.manifest
						&& e.local.manifest.contributes
						&& Array.isArray(e.local.manifest.contributes.themes)
						&& e.local.manifest.contributes.themes.length;
				});
				return this.getPagedModel(this.sortExtensions(themesExtensions, options));
			}
			if (showBasicsOnly) {
				const basics = result.filter(e => {
					return e.local && e.local.manifest
						&& e.local.manifest.contributes
						&& Array.isArray(e.local.manifest.contributes.grammars)
						&& e.local.manifest.contributes.grammars.length
						&& FORCE_FEATURE_EXTENSIONS.indexOf(e.local.identifier.id) === -1;
				});
				return this.getPagedModel(this.sortExtensions(basics, options));
			}
			if (showFeaturesOnly) {
				const others = result.filter(e => {
					return e.local
						&& e.local.manifest
						&& e.local.manifest.contributes
						&& (!Array.isArray(e.local.manifest.contributes.grammars) || FORCE_FEATURE_EXTENSIONS.indexOf(e.local.identifier.id) !== -1)
						&& !Array.isArray(e.local.manifest.contributes.themes);
				});
				return this.getPagedModel(this.sortExtensions(others, options));
			}

			return this.getPagedModel(this.sortExtensions(result, options));
		}

		const categories: string[] = [];
		value = value.replace(/\bcategory:("([^"]*)"|([^"]\S*))(\s+|\b|$)/g, (_, quotedCategory, category) => {
			const entry = (category || quotedCategory || '').toLowerCase();
			if (categories.indexOf(entry) === -1) {
				categories.push(entry);
			}
			return '';
		});

		if (/@installed/i.test(value)) {
			// Show installed extensions
			value = value.replace(/@installed/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase();

			let result = await this.extensionsWorkbenchService.queryLocal(this.server);

			result = result
				.filter(e => e.type === ExtensionType.User
					&& (e.name.toLowerCase().indexOf(value) > -1 || e.displayName.toLowerCase().indexOf(value) > -1)
					&& (!categories.length || categories.some(category => (e.local && e.local.manifest.categories || []).some(c => c.toLowerCase() === category))));

			if (options.sortBy !== undefined) {
				result = this.sortExtensions(result, options);
			} else {
				const runningExtensions = await this.extensionService.getExtensions();
				const runningExtensionsById = runningExtensions.reduce((result, e) => { result.set(ExtensionIdentifier.toKey(e.identifier.value), e); return result; }, new Map<string, IExtensionDescription>());
				result = result.sort((e1, e2) => {
					const running1 = runningExtensionsById.get(ExtensionIdentifier.toKey(e1.identifier.id));
					const isE1Running = running1 && this.extensionManagementServerService.getExtensionManagementServer(running1.extensionLocation) === e1.server;
					const running2 = runningExtensionsById.get(ExtensionIdentifier.toKey(e2.identifier.id));
					const isE2Running = running2 && this.extensionManagementServerService.getExtensionManagementServer(running2.extensionLocation) === e2.server;
					if ((isE1Running && isE2Running)) {
						return e1.displayName.localeCompare(e2.displayName);
					}
					const isE1LanguagePackExtension = e1.local && isLanguagePackExtension(e1.local.manifest);
					const isE2LanguagePackExtension = e2.local && isLanguagePackExtension(e2.local.manifest);
					if (!isE1Running && !isE2Running) {
						if (isE1LanguagePackExtension) {
							return -1;
						}
						if (isE2LanguagePackExtension) {
							return 1;
						}
						return e1.displayName.localeCompare(e2.displayName);
					}
					if ((isE1Running && isE2LanguagePackExtension) || (isE2Running && isE1LanguagePackExtension)) {
						return e1.displayName.localeCompare(e2.displayName);
					}
					return isE1Running ? -1 : 1;
				});
			}
			return this.getPagedModel(result);
		}


		if (/@outdated/i.test(value)) {
			value = value.replace(/@outdated/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase();

			const local = await this.extensionsWorkbenchService.queryLocal(this.server);
			const result = local
				.sort((e1, e2) => e1.displayName.localeCompare(e2.displayName))
				.filter(extension => extension.outdated
					&& (extension.name.toLowerCase().indexOf(value) > -1 || extension.displayName.toLowerCase().indexOf(value) > -1)
					&& (!categories.length || categories.some(category => !!extension.local && extension.local.manifest.categories!.some(c => c.toLowerCase() === category))));

			return this.getPagedModel(this.sortExtensions(result, options));
		}

		if (/@disabled/i.test(value)) {
			value = value.replace(/@disabled/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase();

			const local = await this.extensionsWorkbenchService.queryLocal(this.server);
			const runningExtensions = await this.extensionService.getExtensions();

			const result = local
				.sort((e1, e2) => e1.displayName.localeCompare(e2.displayName))
				.filter(e => runningExtensions.every(r => !areSameExtensions({ id: r.identifier.value, uuid: r.uuid }, e.identifier))
					&& (e.name.toLowerCase().indexOf(value) > -1 || e.displayName.toLowerCase().indexOf(value) > -1)
					&& (!categories.length || categories.some(category => (e.local && e.local.manifest.categories || []).some(c => c.toLowerCase() === category))));

			return this.getPagedModel(this.sortExtensions(result, options));
		}

		if (/@enabled/i.test(value)) {
			value = value ? value.replace(/@enabled/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase() : '';

			const local = (await this.extensionsWorkbenchService.queryLocal(this.server)).filter(e => e.type === ExtensionType.User);
			const runningExtensions = await this.extensionService.getExtensions();

			const result = local
				.sort((e1, e2) => e1.displayName.localeCompare(e2.displayName))
				.filter(e => runningExtensions.some(r => areSameExtensions({ id: r.identifier.value, uuid: r.uuid }, e.identifier))
					&& (e.name.toLowerCase().indexOf(value) > -1 || e.displayName.toLowerCase().indexOf(value) > -1)
					&& (!categories.length || categories.some(category => (e.local && e.local.manifest.categories || []).some(c => c.toLowerCase() === category))));

			return this.getPagedModel(this.sortExtensions(result, options));
		}

		return new PagedModel([]);
	}

	private async queryGallery(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const hasUserDefinedSortOrder = options.sortBy !== undefined;
		if (!hasUserDefinedSortOrder && !query.value.trim()) {
			options.sortBy = SortBy.InstallCount;
		}

		if (ExtensionsListView.isWorkspaceRecommendedExtensionsQuery(query.value)) {
			return this.getWorkspaceRecommendationsModel(query, options, token);
		} else if (ExtensionsListView.isKeymapsRecommendedExtensionsQuery(query.value)) {
			return this.getKeymapRecommendationsModel(query, options, token);
		} else if (/@recommended:all/i.test(query.value) || ExtensionsListView.isSearchRecommendedExtensionsQuery(query.value)) {
			return this.getAllRecommendationsModel(query, options, token);
		} else if (ExtensionsListView.isRecommendedExtensionsQuery(query.value)) {
			return this.getRecommendationsModel(query, options, token);
		}

		if (/\bcurated:([^\s]+)\b/.test(query.value)) {
			return this.getCuratedModel(query, options, token);
		}

		const text = query.value;

		if (/\bext:([^\s]+)\b/g.test(text)) {
			options = assign(options, { text, source: 'file-extension-tags' });
			return this.extensionsWorkbenchService.queryGallery(options, token).then(pager => this.getPagedModel(pager));
		}

		let preferredResults: string[] = [];
		if (text) {
			options = assign(options, { text: text.substr(0, 350), source: 'searchText' });
			if (!hasUserDefinedSortOrder) {
				const searchExperiments = await this.getSearchExperiments();
				for (const experiment of searchExperiments) {
					if (experiment.action && text.toLowerCase() === experiment.action.properties['searchText'] && Array.isArray(experiment.action.properties['preferredResults'])) {
						preferredResults = experiment.action.properties['preferredResults'];
						options.source += `-experiment-${experiment.id}`;
						break;
					}
				}
			}
		} else {
			options.source = 'viewlet';
		}

		const pager = await this.extensionsWorkbenchService.queryGallery(options, token);

		let positionToUpdate = 0;
		for (const preferredResult of preferredResults) {
			for (let j = positionToUpdate; j < pager.firstPage.length; j++) {
				if (areSameExtensions(pager.firstPage[j].identifier, { id: preferredResult })) {
					if (positionToUpdate !== j) {
						const preferredExtension = pager.firstPage.splice(j, 1)[0];
						pager.firstPage.splice(positionToUpdate, 0, preferredExtension);
						positionToUpdate++;
					}
					break;
				}
			}
		}
		return this.getPagedModel(pager);

	}

	private _searchExperiments: Promise<IExperiment[]> | undefined;
	private getSearchExperiments(): Promise<IExperiment[]> {
		if (!this._searchExperiments) {
			this._searchExperiments = this.experimentService.getExperimentsByType(ExperimentActionType.ExtensionSearchResults);
		}
		return this._searchExperiments;
	}

	private sortExtensions(extensions: IExtension[], options: IQueryOptions): IExtension[] {
		switch (options.sortBy) {
			case SortBy.InstallCount:
				extensions = extensions.sort((e1, e2) => typeof e2.installCount === 'number' && typeof e1.installCount === 'number' ? e2.installCount - e1.installCount : NaN);
				break;
			case SortBy.AverageRating:
			case SortBy.WeightedRating:
				extensions = extensions.sort((e1, e2) => typeof e2.rating === 'number' && typeof e1.rating === 'number' ? e2.rating - e1.rating : NaN);
				break;
			default:
				extensions = extensions.sort((e1, e2) => e1.displayName.localeCompare(e2.displayName));
				break;
		}
		if (options.sortOrder === SortOrder.Descending) {
			extensions = extensions.reverse();
		}
		return extensions;
	}

	// Get All types of recommendations, trimmed to show a max of 8 at any given time
	private getAllRecommendationsModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const value = query.value.replace(/@recommended:all/g, '').replace(/@recommended/g, '').trim().toLowerCase();

		return this.extensionsWorkbenchService.queryLocal(this.server)
			.then(result => result.filter(e => e.type === ExtensionType.User))
			.then(local => {
				const fileBasedRecommendations = this.tipsService.getFileBasedRecommendations();
				const configBasedRecommendationsPromise = this.tipsService.getConfigBasedRecommendations();
				const othersPromise = this.tipsService.getOtherRecommendations();
				const workspacePromise = this.tipsService.getWorkspaceRecommendations();

				return Promise.all([othersPromise, workspacePromise, configBasedRecommendationsPromise])
					.then(([others, workspaceRecommendations, configBasedRecommendations]) => {
						const names = this.getTrimmedRecommendations(local, value, fileBasedRecommendations, configBasedRecommendations, others, workspaceRecommendations);
						const recommendationsWithReason = this.tipsService.getAllRecommendationsWithReason();
						/* __GDPR__
							"extensionAllRecommendations:open" : {
								"count" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
								"recommendations": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
							}
						*/
						this.telemetryService.publicLog('extensionAllRecommendations:open', {
							count: names.length,
							recommendations: names.map(id => {
								return {
									id,
									recommendationReason: recommendationsWithReason[id.toLowerCase()].reasonId
								};
							})
						});
						if (!names.length) {
							return Promise.resolve(new PagedModel([]));
						}
						options.source = 'recommendations-all';
						return this.extensionsWorkbenchService.queryGallery(assign(options, { names, pageSize: names.length }), token)
							.then(pager => {
								this.sortFirstPage(pager, names);
								return this.getPagedModel(pager || []);
							});
					});
			});
	}

	private async getCuratedModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const value = query.value.replace(/curated:/g, '').trim();
		const names = await this.experimentService.getCuratedExtensionsList(value);
		if (Array.isArray(names) && names.length) {
			options.source = `curated:${value}`;
			const pager = await this.extensionsWorkbenchService.queryGallery(assign(options, { names, pageSize: names.length }), token);
			this.sortFirstPage(pager, names);
			return this.getPagedModel(pager || []);
		}
		return new PagedModel([]);
	}

	// Get All types of recommendations other than Workspace recommendations, trimmed to show a max of 8 at any given time
	private getRecommendationsModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const value = query.value.replace(/@recommended/g, '').trim().toLowerCase();

		return this.extensionsWorkbenchService.queryLocal(this.server)
			.then(result => result.filter(e => e.type === ExtensionType.User))
			.then(local => {
				let fileBasedRecommendations = this.tipsService.getFileBasedRecommendations();
				const configBasedRecommendationsPromise = this.tipsService.getConfigBasedRecommendations();
				const othersPromise = this.tipsService.getOtherRecommendations();
				const workspacePromise = this.tipsService.getWorkspaceRecommendations();

				return Promise.all([othersPromise, workspacePromise, configBasedRecommendationsPromise])
					.then(([others, workspaceRecommendations, configBasedRecommendations]) => {
						configBasedRecommendations = configBasedRecommendations.filter(x => workspaceRecommendations.every(({ extensionId }) => x.extensionId !== extensionId));
						fileBasedRecommendations = fileBasedRecommendations.filter(x => workspaceRecommendations.every(({ extensionId }) => x.extensionId !== extensionId));
						others = others.filter(x => workspaceRecommendations.every(({ extensionId }) => x.extensionId !== extensionId));

						const names = this.getTrimmedRecommendations(local, value, fileBasedRecommendations, configBasedRecommendations, others, []);
						const recommendationsWithReason = this.tipsService.getAllRecommendationsWithReason();

						/* __GDPR__
							"extensionRecommendations:open" : {
								"count" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
								"recommendations": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
							}
						*/
						this.telemetryService.publicLog('extensionRecommendations:open', {
							count: names.length,
							recommendations: names.map(id => {
								return {
									id,
									recommendationReason: recommendationsWithReason[id.toLowerCase()].reasonId
								};
							})
						});

						if (!names.length) {
							return Promise.resolve(new PagedModel([]));
						}
						options.source = 'recommendations';
						return this.extensionsWorkbenchService.queryGallery(assign(options, { names, pageSize: names.length }), token)
							.then(pager => {
								this.sortFirstPage(pager, names);
								return this.getPagedModel(pager || []);
							});
					});
			});
	}

	// Given all recommendations, trims and returns recommendations in the relevant order after filtering out installed extensions
	private getTrimmedRecommendations(installedExtensions: IExtension[], value: string, fileBasedRecommendations: IExtensionRecommendation[], configBasedRecommendations: IExtensionRecommendation[], otherRecommendations: IExtensionRecommendation[], workspaceRecommendations: IExtensionRecommendation[]): string[] {
		const totalCount = 10;
		workspaceRecommendations = workspaceRecommendations
			.filter(recommendation => {
				return !this.isRecommendationInstalled(recommendation, installedExtensions)
					&& recommendation.extensionId.toLowerCase().indexOf(value) > -1;
			});
		configBasedRecommendations = configBasedRecommendations
			.filter(recommendation => {
				return !this.isRecommendationInstalled(recommendation, installedExtensions)
					&& workspaceRecommendations.every(workspaceRecommendation => workspaceRecommendation.extensionId !== recommendation.extensionId)
					&& recommendation.extensionId.toLowerCase().indexOf(value) > -1;
			});
		fileBasedRecommendations = fileBasedRecommendations.filter(recommendation => {
			return !this.isRecommendationInstalled(recommendation, installedExtensions)
				&& workspaceRecommendations.every(workspaceRecommendation => workspaceRecommendation.extensionId !== recommendation.extensionId)
				&& configBasedRecommendations.every(configBasedRecommendation => configBasedRecommendation.extensionId !== recommendation.extensionId)
				&& recommendation.extensionId.toLowerCase().indexOf(value) > -1;
		});
		otherRecommendations = otherRecommendations.filter(recommendation => {
			return !this.isRecommendationInstalled(recommendation, installedExtensions)
				&& fileBasedRecommendations.every(fileBasedRecommendation => fileBasedRecommendation.extensionId !== recommendation.extensionId)
				&& workspaceRecommendations.every(workspaceRecommendation => workspaceRecommendation.extensionId !== recommendation.extensionId)
				&& configBasedRecommendations.every(configBasedRecommendation => configBasedRecommendation.extensionId !== recommendation.extensionId)
				&& recommendation.extensionId.toLowerCase().indexOf(value) > -1;
		});

		const otherCount = Math.min(2, otherRecommendations.length);
		const fileBasedCount = Math.min(fileBasedRecommendations.length, totalCount - workspaceRecommendations.length - configBasedRecommendations.length - otherCount);
		const recommendations = [...workspaceRecommendations, ...configBasedRecommendations];
		recommendations.push(...fileBasedRecommendations.splice(0, fileBasedCount));
		recommendations.push(...otherRecommendations.splice(0, otherCount));

		return distinct(recommendations.map(({ extensionId }) => extensionId));
	}

	private isRecommendationInstalled(recommendation: IExtensionRecommendation, installed: IExtension[]): boolean {
		return installed.some(i => areSameExtensions(i.identifier, { id: recommendation.extensionId }));
	}

	private getWorkspaceRecommendationsModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const value = query.value.replace(/@recommended:workspace/g, '').trim().toLowerCase();
		return this.tipsService.getWorkspaceRecommendations()
			.then(recommendations => {
				const names = recommendations.map(({ extensionId }) => extensionId).filter(name => name.toLowerCase().indexOf(value) > -1);
				/* __GDPR__
					"extensionWorkspaceRecommendations:open" : {
						"count" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
					}
				*/
				this.telemetryService.publicLog('extensionWorkspaceRecommendations:open', { count: names.length });

				if (!names.length) {
					return Promise.resolve(new PagedModel([]));
				}
				options.source = 'recommendations-workspace';
				return this.extensionsWorkbenchService.queryGallery(assign(options, { names, pageSize: names.length }), token)
					.then(pager => this.getPagedModel(pager || []));
			});
	}

	private getKeymapRecommendationsModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const value = query.value.replace(/@recommended:keymaps/g, '').trim().toLowerCase();
		const names: string[] = this.tipsService.getKeymapRecommendations().map(({ extensionId }) => extensionId)
			.filter(extensionId => extensionId.toLowerCase().indexOf(value) > -1);

		if (!names.length) {
			return Promise.resolve(new PagedModel([]));
		}
		options.source = 'recommendations-keymaps';
		return this.extensionsWorkbenchService.queryGallery(assign(options, { names, pageSize: names.length }), token)
			.then(result => this.getPagedModel(result));
	}

	// Sorts the firstPage of the pager in the same order as given array of extension ids
	private sortFirstPage(pager: IPager<IExtension>, ids: string[]) {
		ids = ids.map(x => x.toLowerCase());
		pager.firstPage.sort((a, b) => {
			return ids.indexOf(a.identifier.id.toLowerCase()) < ids.indexOf(b.identifier.id.toLowerCase()) ? -1 : 1;
		});
	}

	private setModel(model: IPagedModel<IExtension>, error?: any) {
		if (this.list) {
			this.list.model = new DelayedPagedModel(model);
			this.list.scrollTop = 0;
			const count = this.count();

			if (this.bodyTemplate && this.badge) {

				toggleClass(this.bodyTemplate.extensionsList, 'hidden', count === 0);
				toggleClass(this.bodyTemplate.messageContainer, 'hidden', count > 0);
				this.badge.setCount(count);

				if (count === 0 && this.isBodyVisible()) {
					if (error) {
						if (error instanceof ExtensionListViewWarning) {
							this.bodyTemplate.messageSeverityIcon.className = `codicon ${SeverityIcon.className(Severity.Warning)}`;
							this.bodyTemplate.messageBox.textContent = getErrorMessage(error);
						} else {
							this.bodyTemplate.messageSeverityIcon.className = `codicon ${SeverityIcon.className(Severity.Error)}`;
							this.bodyTemplate.messageBox.textContent = localize('error', "Error while loading extensions. {0}", getErrorMessage(error));
						}
					} else {
						this.bodyTemplate.messageSeverityIcon.className = '';
						this.bodyTemplate.messageBox.textContent = localize('no extensions found', "No extensions found.");
					}
					alert(this.bodyTemplate.messageBox.textContent);
				}
			}
		}
	}

	private openExtension(extension: IExtension, options: { sideByside?: boolean, preserveFocus?: boolean, pinned?: boolean }): void {
		extension = this.extensionsWorkbenchService.local.filter(e => areSameExtensions(e.identifier, extension.identifier))[0] || extension;
		this.extensionsWorkbenchService.open(extension, options).then(undefined, err => this.onError(err));
	}

	private pin(): void {
		const activeEditorPane = this.editorService.activeEditorPane;
		if (activeEditorPane) {
			activeEditorPane.group.pinEditor(activeEditorPane.input);
			activeEditorPane.focus();
		}
	}

	private onError(err: any): void {
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

	private getPagedModel(arg: IPager<IExtension> | IExtension[]): IPagedModel<IExtension> {
		if (Array.isArray(arg)) {
			return new PagedModel(arg);
		}
		const pager = {
			total: arg.total,
			pageSize: arg.pageSize,
			firstPage: arg.firstPage,
			getPage: (pageIndex: number, cancellationToken: CancellationToken) => arg.getPage(pageIndex, cancellationToken)
		};
		return new PagedModel(pager);
	}

	dispose(): void {
		super.dispose();
		if (this.queryRequest) {
			this.queryRequest.request.cancel();
			this.queryRequest = null;
		}
		this.list = null;
	}

	static isBuiltInExtensionsQuery(query: string): boolean {
		return /^\s*@builtin\s*$/i.test(query);
	}

	static isLocalExtensionsQuery(query: string): boolean {
		return this.isInstalledExtensionsQuery(query)
			|| this.isOutdatedExtensionsQuery(query)
			|| this.isEnabledExtensionsQuery(query)
			|| this.isDisabledExtensionsQuery(query)
			|| this.isBuiltInExtensionsQuery(query);
	}

	static isInstalledExtensionsQuery(query: string): boolean {
		return /@installed/i.test(query);
	}

	static isOutdatedExtensionsQuery(query: string): boolean {
		return /@outdated/i.test(query);
	}

	static isEnabledExtensionsQuery(query: string): boolean {
		return /@enabled/i.test(query);
	}

	static isDisabledExtensionsQuery(query: string): boolean {
		return /@disabled/i.test(query);
	}

	static isRecommendedExtensionsQuery(query: string): boolean {
		return /^@recommended$/i.test(query.trim());
	}

	static isSearchRecommendedExtensionsQuery(query: string): boolean {
		return /@recommended/i.test(query) && !ExtensionsListView.isRecommendedExtensionsQuery(query);
	}

	static isWorkspaceRecommendedExtensionsQuery(query: string): boolean {
		return /@recommended:workspace/i.test(query);
	}

	static isKeymapsRecommendedExtensionsQuery(query: string): boolean {
		return /@recommended:keymaps/i.test(query);
	}

	focus(): void {
		super.focus();
		if (!this.list) {
			return;
		}

		if (!(this.list.getFocus().length || this.list.getSelection().length)) {
			this.list.focusNext();
		}
		this.list.domFocus();
	}
}

export class ServerExtensionsView extends ExtensionsListView {

	constructor(
		server: IExtensionManagementServer,
		onDidChangeTitle: Event<string>,
		options: ExtensionsListViewOptions,
		@INotificationService notificationService: INotificationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IExtensionService extensionService: IExtensionService,
		@IEditorService editorService: IEditorService,
		@IExtensionRecommendationsService tipsService: IExtensionRecommendationsService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IExperimentService experimentService: IExperimentService,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionManagementServerService extensionManagementServerService: IExtensionManagementServerService,
		@IProductService productService: IProductService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IMenuService menuService: IMenuService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IPreferencesService preferencesService: IPreferencesService,
	) {
		options.server = server;
		super(options, notificationService, keybindingService, contextMenuService, instantiationService, themeService, extensionService, extensionsWorkbenchService, editorService, tipsService, telemetryService, configurationService, contextService, experimentService, extensionManagementServerService, productService, contextKeyService, viewDescriptorService, menuService, openerService, preferencesService);
		this._register(onDidChangeTitle(title => this.updateTitle(title)));
	}

	async show(query: string): Promise<IPagedModel<IExtension>> {
		query = query ? query : '@installed';
		if (!ExtensionsListView.isLocalExtensionsQuery(query) && !ExtensionsListView.isBuiltInExtensionsQuery(query)) {
			query = query += ' @installed';
		}
		return super.show(query.trim());
	}

	getActions(): IAction[] {
		if (this.extensionManagementServerService.remoteExtensionManagementServer && this.extensionManagementServerService.localExtensionManagementServer === this.server) {
			const installLocalExtensionsInRemoteAction = this._register(this.instantiationService.createInstance(InstallLocalExtensionsInRemoteAction));
			installLocalExtensionsInRemoteAction.class = 'codicon codicon-cloud-download';
			return [installLocalExtensionsInRemoteAction];
		}
		return [];
	}
}

export class EnabledExtensionsView extends ExtensionsListView {

	async show(query: string): Promise<IPagedModel<IExtension>> {
		query = query || '@enabled';
		return ExtensionsListView.isEnabledExtensionsQuery(query) ? super.show(query) : this.showEmptyModel();
	}
}

export class DisabledExtensionsView extends ExtensionsListView {

	async show(query: string): Promise<IPagedModel<IExtension>> {
		query = query || '@disabled';
		return ExtensionsListView.isDisabledExtensionsQuery(query) ? super.show(query) : this.showEmptyModel();
	}
}

export class BuiltInExtensionsView extends ExtensionsListView {
	async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== '@builtin') ? this.showEmptyModel() : super.show('@builtin:features');
	}
}

export class BuiltInThemesExtensionsView extends ExtensionsListView {
	async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== '@builtin') ? this.showEmptyModel() : super.show('@builtin:themes');
	}
}

export class BuiltInBasicsExtensionsView extends ExtensionsListView {
	async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== '@builtin') ? this.showEmptyModel() : super.show('@builtin:basics');
	}
}

export class DefaultRecommendedExtensionsView extends ExtensionsListView {
	private readonly recommendedExtensionsQuery = '@recommended:all';

	renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._register(this.tipsService.onRecommendationChange(() => {
			this.show('');
		}));
	}

	async show(query: string): Promise<IPagedModel<IExtension>> {
		if (query && query.trim() !== this.recommendedExtensionsQuery) {
			return this.showEmptyModel();
		}
		const model = await super.show(this.recommendedExtensionsQuery);
		if (!this.extensionsWorkbenchService.local.some(e => e.type === ExtensionType.User)) {
			// This is part of popular extensions view. Collapse if no installed extensions.
			this.setExpanded(model.length > 0);
		}
		return model;
	}

}

export class RecommendedExtensionsView extends ExtensionsListView {
	private readonly recommendedExtensionsQuery = '@recommended';

	renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._register(this.tipsService.onRecommendationChange(() => {
			this.show('');
		}));
	}

	async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== this.recommendedExtensionsQuery) ? this.showEmptyModel() : super.show(this.recommendedExtensionsQuery);
	}
}

export class WorkspaceRecommendedExtensionsView extends ExtensionsListView {
	private readonly recommendedExtensionsQuery = '@recommended:workspace';
	private installAllAction: InstallWorkspaceRecommendedExtensionsAction | undefined;

	renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._register(this.tipsService.onRecommendationChange(() => this.update()));
		this._register(this.extensionsWorkbenchService.onChange(() => this.setRecommendationsToInstall()));
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.update()));
	}

	getActions(): IAction[] {
		if (!this.installAllAction) {
			this.installAllAction = this._register(this.instantiationService.createInstance(InstallWorkspaceRecommendedExtensionsAction, InstallWorkspaceRecommendedExtensionsAction.ID, InstallWorkspaceRecommendedExtensionsAction.LABEL, []));
			this.installAllAction.class = 'codicon codicon-cloud-download';
		}

		const configureWorkspaceFolderAction = this._register(this.instantiationService.createInstance(ConfigureWorkspaceFolderRecommendedExtensionsAction, ConfigureWorkspaceFolderRecommendedExtensionsAction.ID, ConfigureWorkspaceFolderRecommendedExtensionsAction.LABEL));
		configureWorkspaceFolderAction.class = 'codicon codicon-pencil';
		return [this.installAllAction, configureWorkspaceFolderAction];
	}

	async show(query: string): Promise<IPagedModel<IExtension>> {
		let shouldShowEmptyView = query && query.trim() !== '@recommended' && query.trim() !== '@recommended:workspace';
		let model = await (shouldShowEmptyView ? this.showEmptyModel() : super.show(this.recommendedExtensionsQuery));
		this.setExpanded(model.length > 0);
		return model;
	}

	private update(): void {
		this.show(this.recommendedExtensionsQuery);
		this.setRecommendationsToInstall();
	}

	private async setRecommendationsToInstall(): Promise<void> {
		const recommendations = await this.getRecommendationsToInstall();
		if (this.installAllAction) {
			this.installAllAction.recommendations = recommendations.map(({ extensionId }) => extensionId);
		}
	}

	private getRecommendationsToInstall(): Promise<IExtensionRecommendation[]> {
		return this.tipsService.getWorkspaceRecommendations()
			.then(recommendations => recommendations.filter(({ extensionId }) => {
				const extension = this.extensionsWorkbenchService.local.filter(i => areSameExtensions({ id: extensionId }, i.identifier))[0];
				if (!extension
					|| !extension.local
					|| extension.state !== ExtensionState.Installed
					|| extension.enablementState === EnablementState.DisabledByExtensionKind
				) {
					return true;
				}
				return false;
			}));
	}
}
