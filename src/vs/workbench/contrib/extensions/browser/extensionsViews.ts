/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Disposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { isPromiseCanceledError, getErrorMessage, createErrorWithActions } from 'vs/base/common/errors';
import { PagedModel, IPagedModel, IPager, DelayedPagedModel } from 'vs/base/common/paging';
import { SortBy, SortOrder, IQueryOptions } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionManagementServer, IExtensionManagementServerService, EnablementState, IWorkbenchExtensionManagementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExtensionRecommendationsService } from 'vs/workbench/services/extensionRecommendations/common/extensionRecommendations';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { append, $ } from 'vs/base/browser/dom';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Delegate, Renderer, IExtensionsViewState, EXTENSION_LIST_ELEMENT_HEIGHT } from 'vs/workbench/contrib/extensions/browser/extensionsList';
import { ExtensionState, IExtension, IExtensionsWorkbenchService, IWorkspaceRecommendedExtensionsView } from 'vs/workbench/contrib/extensions/common/extensions';
import { Query } from 'vs/workbench/contrib/extensions/common/extensionQuery';
import { IExtensionService, toExtension } from 'vs/workbench/services/extensions/common/extensions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachBadgeStyler } from 'vs/platform/theme/common/styler';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { ManageExtensionAction, getContextMenuActions, ExtensionAction } from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { WorkbenchPagedList } from 'vs/platform/list/browser/listService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { coalesce, distinct, flatten } from 'vs/base/common/arrays';
import { IExperimentService, IExperiment, ExperimentActionType } from 'vs/workbench/contrib/experiments/common/experimentService';
import { alert } from 'vs/base/browser/ui/aria/aria';
import { IListContextMenuEvent } from 'vs/base/browser/ui/list/list';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IAction, Action, Separator, ActionRunner } from 'vs/base/common/actions';
import { ExtensionIdentifier, IExtensionDescription, isLanguagePackExtension } from 'vs/platform/extensions/common/extensions';
import { CancelablePromise, createCancelablePromise } from 'vs/base/common/async';
import { IProductService } from 'vs/platform/product/common/productService';
import { SeverityIcon } from 'vs/platform/severityIcon/common/severityIcon';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IExtensionManifestPropertiesService } from 'vs/workbench/services/extensions/common/extensionManifestPropertiesService';

// Extensions that are automatically classified as Programming Language extensions, but should be Feature extensions
const FORCE_FEATURE_EXTENSIONS = ['vscode.git', 'vscode.search-result'];

type WorkspaceRecommendationsClassification = {
	count: { classification: 'SystemMetaData', purpose: 'FeatureInsight', 'isMeasurement': true };
};

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

export interface ExtensionsListViewOptions {
	server?: IExtensionManagementServer;
	fixedHeight?: boolean;
	onDidChangeTitle?: Event<string>;
}

class ExtensionListViewWarning extends Error { }

interface IQueryResult {
	readonly model: IPagedModel<IExtension>;
	readonly onDidChangeModel?: Event<IPagedModel<IExtension>>;
	readonly disposables: DisposableStore;
}

export class ExtensionsListView extends ViewPane {

	private bodyTemplate: {
		messageContainer: HTMLElement;
		messageSeverityIcon: HTMLElement;
		messageBox: HTMLElement;
		extensionsList: HTMLElement;
	} | undefined;
	private badge: CountBadge | undefined;
	private list: WorkbenchPagedList<IExtension> | null = null;
	private queryRequest: { query: string, request: CancelablePromise<IPagedModel<IExtension>> } | null = null;
	private queryResult: IQueryResult | undefined;

	private readonly contextMenuActionRunner = this._register(new ActionRunner());

	constructor(
		protected readonly options: ExtensionsListViewOptions,
		viewletViewOptions: IViewletViewOptions,
		@INotificationService protected notificationService: INotificationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IExtensionsWorkbenchService protected extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionRecommendationsService protected extensionRecommendationsService: IExtensionRecommendationsService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkspaceContextService protected contextService: IWorkspaceContextService,
		@IExperimentService private readonly experimentService: IExperimentService,
		@IExtensionManagementServerService protected readonly extensionManagementServerService: IExtensionManagementServerService,
		@IExtensionManifestPropertiesService private readonly extensionManifestPropertiesService: IExtensionManifestPropertiesService,
		@IWorkbenchExtensionManagementService protected readonly extensionManagementService: IWorkbenchExtensionManagementService,
		@IProductService protected readonly productService: IProductService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IOpenerService openerService: IOpenerService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super({
			...(viewletViewOptions as IViewPaneOptions),
			showActionsAlways: true,
			maximumBodySize: options.fixedHeight ? storageService.getNumber(viewletViewOptions.id, StorageScope.GLOBAL, 0) : undefined
		}, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		if (this.options.onDidChangeTitle) {
			this._register(this.options.onDidChangeTitle(title => this.updateTitle(title)));
		}

		this._register(this.contextMenuActionRunner.onDidRun(({ error }) => error && this.notificationService.error(error)));
		this.registerActions();
	}

	protected registerActions(): void { }

	protected override renderHeader(container: HTMLElement): void {
		container.classList.add('extension-view-header');
		super.renderHeader(container);

		this.badge = new CountBadge(append(container, $('.count-badge-wrapper')));
		this._register(attachBadgeStyler(this.badge, this.themeService));
	}

	override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const extensionsList = append(container, $('.extensions-list'));
		const messageContainer = append(container, $('.message-container'));
		const messageSeverityIcon = append(messageContainer, $(''));
		const messageBox = append(messageContainer, $('.message'));
		const delegate = new Delegate();
		const extensionsViewState = new ExtensionsViewState();
		const renderer = this.instantiationService.createInstance(Renderer, extensionsViewState);
		this.list = this.instantiationService.createInstance(WorkbenchPagedList, 'Extensions', extensionsList, delegate, [renderer], {
			multipleSelectionSupport: false,
			setRowLineHeight: false,
			horizontalScrolling: false,
			accessibilityProvider: <IListAccessibilityProvider<IExtension | null>>{
				getAriaLabel(extension: IExtension | null): string {
					return extension ? localize('extension.arialabel', "{0}, {1}, {2}, {3}", extension.displayName, extension.version, extension.publisherDisplayName, extension.description) : '';
				},
				getWidgetAriaLabel(): string {
					return localize('extensions', "Extensions");
				}
			},
			overrideStyles: {
				listBackground: SIDE_BAR_BACKGROUND
			},
			openOnSingleClick: true
		}) as WorkbenchPagedList<IExtension>;
		this._register(this.list.onContextMenu(e => this.onContextMenu(e), this));
		this._register(this.list.onDidChangeFocus(e => extensionsViewState.onFocusChange(coalesce(e.elements)), this));
		this._register(this.list);
		this._register(extensionsViewState);

		this._register(Event.debounce(Event.filter(this.list.onDidOpen, e => e.element !== null), (_, event) => event, 75, true)(options => {
			this.openExtension(options.element!, { sideByside: options.sideBySide, ...options.editorOptions });
		}));

		this.bodyTemplate = {
			extensionsList,
			messageBox,
			messageContainer,
			messageSeverityIcon
		};
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.bodyTemplate) {
			this.bodyTemplate.extensionsList.style.height = height + 'px';
		}
		if (this.list) {
			this.list.layout(height, width);
		}
	}

	async show(query: string, refresh?: boolean): Promise<IPagedModel<IExtension>> {
		if (this.queryRequest) {
			if (!refresh && this.queryRequest.query === query) {
				return this.queryRequest.request;
			}
			this.queryRequest.request.cancel();
			this.queryRequest = null;
		}

		if (this.queryResult) {
			this.queryResult.disposables.dispose();
			this.queryResult = undefined;
		}

		const parsedQuery = Query.parse(query);

		let options: IQueryOptions = {
			sortOrder: SortOrder.Default
		};

		switch (parsedQuery.sortBy) {
			case 'installs': options.sortBy = SortBy.InstallCount; break;
			case 'rating': options.sortBy = SortBy.WeightedRating; break;
			case 'name': options.sortBy = SortBy.Title; break;
			case 'publishedDate': options.sortBy = SortBy.PublishedDate; break;
		}

		const request = createCancelablePromise(async token => {
			try {
				this.queryResult = await this.query(parsedQuery, options, token);
				const model = this.queryResult.model;
				this.setModel(model);
				if (this.queryResult.onDidChangeModel) {
					this.queryResult.disposables.add(this.queryResult.onDidChangeModel(model => this.updateModel(model)));
				}
				return model;
			} catch (e) {
				const model = new PagedModel([]);
				if (!isPromiseCanceledError(e)) {
					this.setModel(model, e);
				}
				return this.list ? this.list.model : model;
			}
		});

		request.finally(() => this.queryRequest = null);
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
			let groups: IAction[][] = [];
			if (manageExtensionAction.enabled) {
				groups = await manageExtensionAction.getActionGroups(runningExtensions);

			} else if (e.element) {
				groups = getContextMenuActions(e.element, false, this.instantiationService);
				groups.forEach(group => group.forEach(extensionAction => {
					if (extensionAction instanceof ExtensionAction) {
						extensionAction.extension = e.element!;
					}
				}));
			}
			let actions: IAction[] = [];
			for (const menuActions of groups) {
				actions = [...actions, ...menuActions, new Separator()];
			}
			actions.pop();
			this.contextMenuService.showContextMenu({
				getAnchor: () => e.anchor,
				getActions: () => actions,
				actionRunner: this.contextMenuActionRunner,
			});
		}
	}

	private async query(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IQueryResult> {
		const idRegex = /@id:(([a-z0-9A-Z][a-z0-9\-A-Z]*)\.([a-z0-9A-Z][a-z0-9\-A-Z]*))/g;
		const ids: string[] = [];
		let idMatch;
		while ((idMatch = idRegex.exec(query.value)) !== null) {
			const name = idMatch[1];
			ids.push(name);
		}
		if (ids.length) {
			const model = await this.queryByIds(ids, options, token);
			return { model, disposables: new DisposableStore() };
		}

		if (ExtensionsListView.isLocalExtensionsQuery(query.value)) {
			return this.queryLocal(query, options);
		}

		try {
			const model = await this.queryGallery(query, options, token);
			return { model, disposables: new DisposableStore() };
		} catch (e) {
			console.warn('Error querying extensions gallery', getErrorMessage(e));
			return Promise.reject(new ExtensionListViewWarning(localize('galleryError', "We cannot connect to the Extensions Marketplace at this time, please try again later.")));
		}
	}

	private async queryByIds(ids: string[], options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const idsSet: Set<string> = ids.reduce((result, id) => { result.add(id.toLowerCase()); return result; }, new Set<string>());
		const result = (await this.extensionsWorkbenchService.queryLocal(this.options.server))
			.filter(e => idsSet.has(e.identifier.id.toLowerCase()));

		if (result.length) {
			return this.getPagedModel(this.sortExtensions(result, options));
		}

		return this.extensionsWorkbenchService.queryGallery({ names: ids, source: 'queryById' }, token)
			.then(pager => this.getPagedModel(pager));
	}

	private async queryLocal(query: Query, options: IQueryOptions): Promise<IQueryResult> {
		const local = await this.extensionsWorkbenchService.queryLocal(this.options.server);
		const runningExtensions = await this.extensionService.getExtensions();
		let { extensions, canIncludeInstalledExtensions } = this.filterLocal(local, runningExtensions, query, options);
		const disposables = new DisposableStore();
		const onDidChangeModel = disposables.add(new Emitter<IPagedModel<IExtension>>());

		if (canIncludeInstalledExtensions) {
			let isDisposed: boolean = false;
			disposables.add(toDisposable(() => isDisposed = true));
			disposables.add(Event.debounce(Event.any(
				Event.filter(this.extensionsWorkbenchService.onChange, e => e?.state === ExtensionState.Installed),
				this.extensionService.onDidChangeExtensions
			), () => undefined)(async () => {
				const local = this.options.server ? this.extensionsWorkbenchService.installed.filter(e => e.server === this.options.server) : this.extensionsWorkbenchService.local;
				const runningExtensions = await this.extensionService.getExtensions();
				const { extensions: newExtensions } = this.filterLocal(local, runningExtensions, query, options);
				if (!isDisposed) {
					const mergedExtensions = this.mergeAddedExtensions(extensions, newExtensions);
					if (mergedExtensions) {
						extensions = mergedExtensions;
						onDidChangeModel.fire(new PagedModel(extensions));
					}
				}
			}));
		}

		return {
			model: new PagedModel(extensions),
			onDidChangeModel: onDidChangeModel.event,
			disposables
		};
	}

	private filterLocal(local: IExtension[], runningExtensions: IExtensionDescription[], query: Query, options: IQueryOptions): { extensions: IExtension[], canIncludeInstalledExtensions: boolean } {
		let value = query.value;
		let extensions: IExtension[] = [];
		let canIncludeInstalledExtensions = true;

		if (/@builtin/i.test(value)) {
			extensions = this.filterBuiltinExtensions(local, query, options);
			canIncludeInstalledExtensions = false;
		}

		else if (/@installed/i.test(value)) {
			extensions = this.filterInstalledExtensions(local, runningExtensions, query, options);
		}

		else if (/@outdated/i.test(value)) {
			extensions = this.filterOutdatedExtensions(local, query, options);
		}

		else if (/@disabled/i.test(value)) {
			extensions = this.filterDisabledExtensions(local, runningExtensions, query, options);
		}

		else if (/@enabled/i.test(value)) {
			extensions = this.filterEnabledExtensions(local, runningExtensions, query, options);
		}

		else if (/@trustRequired/i.test(value)) {
			extensions = this.filterTrustRequiredExtensions(local, query, options);
		}

		return { extensions, canIncludeInstalledExtensions };
	}

	private filterBuiltinExtensions(local: IExtension[], query: Query, options: IQueryOptions): IExtension[] {
		let value = query.value;
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

		let result = local
			.filter(e => e.isBuiltin && (e.name.toLowerCase().indexOf(value) > -1 || e.displayName.toLowerCase().indexOf(value) > -1));

		const isThemeExtension = (e: IExtension): boolean => {
			return (Array.isArray(e.local?.manifest?.contributes?.themes) && e.local!.manifest!.contributes!.themes.length > 0)
				|| (Array.isArray(e.local?.manifest?.contributes?.iconThemes) && e.local!.manifest!.contributes!.iconThemes.length > 0);
		};
		if (showThemesOnly) {
			const themesExtensions = result.filter(isThemeExtension);
			return this.sortExtensions(themesExtensions, options);
		}

		const isLangaugeBasicExtension = (e: IExtension): boolean => {
			return FORCE_FEATURE_EXTENSIONS.indexOf(e.identifier.id) === -1
				&& (Array.isArray(e.local?.manifest?.contributes?.grammars) && e.local!.manifest!.contributes!.grammars.length > 0);
		};
		if (showBasicsOnly) {
			const basics = result.filter(isLangaugeBasicExtension);
			return this.sortExtensions(basics, options);
		}
		if (showFeaturesOnly) {
			const others = result.filter(e => {
				return e.local
					&& e.local.manifest
					&& !isThemeExtension(e)
					&& !isLangaugeBasicExtension(e);
			});
			return this.sortExtensions(others, options);
		}

		return this.sortExtensions(result, options);
	}

	private parseCategories(value: string): { value: string, categories: string[] } {
		const categories: string[] = [];
		value = value.replace(/\bcategory:("([^"]*)"|([^"]\S*))(\s+|\b|$)/g, (_, quotedCategory, category) => {
			const entry = (category || quotedCategory || '').toLowerCase();
			if (categories.indexOf(entry) === -1) {
				categories.push(entry);
			}
			return '';
		});
		return { value, categories };
	}

	private filterInstalledExtensions(local: IExtension[], runningExtensions: IExtensionDescription[], query: Query, options: IQueryOptions): IExtension[] {
		let { value, categories } = this.parseCategories(query.value);

		value = value.replace(/@installed/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase();

		let result = local
			.filter(e => !e.isBuiltin
				&& (e.name.toLowerCase().indexOf(value) > -1 || e.displayName.toLowerCase().indexOf(value) > -1)
				&& (!categories.length || categories.some(category => (e.local && e.local.manifest.categories || []).some(c => c.toLowerCase() === category))));

		if (options.sortBy !== undefined) {
			result = this.sortExtensions(result, options);
		} else {
			const runningExtensionsById = runningExtensions.reduce((result, e) => { result.set(ExtensionIdentifier.toKey(e.identifier.value), e); return result; }, new Map<string, IExtensionDescription>());
			result = result.sort((e1, e2) => {
				const running1 = runningExtensionsById.get(ExtensionIdentifier.toKey(e1.identifier.id));
				const isE1Running = running1 && this.extensionManagementServerService.getExtensionManagementServer(toExtension(running1)) === e1.server;
				const running2 = runningExtensionsById.get(ExtensionIdentifier.toKey(e2.identifier.id));
				const isE2Running = running2 && this.extensionManagementServerService.getExtensionManagementServer(toExtension(running2)) === e2.server;
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
		return result;
	}

	private filterOutdatedExtensions(local: IExtension[], query: Query, options: IQueryOptions): IExtension[] {
		let { value, categories } = this.parseCategories(query.value);

		value = value.replace(/@outdated/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase();

		const result = local
			.sort((e1, e2) => e1.displayName.localeCompare(e2.displayName))
			.filter(extension => extension.outdated
				&& (extension.name.toLowerCase().indexOf(value) > -1 || extension.displayName.toLowerCase().indexOf(value) > -1)
				&& (!categories.length || categories.some(category => !!extension.local && extension.local.manifest.categories!.some(c => c.toLowerCase() === category))));

		return this.sortExtensions(result, options);
	}

	private filterDisabledExtensions(local: IExtension[], runningExtensions: IExtensionDescription[], query: Query, options: IQueryOptions): IExtension[] {
		let { value, categories } = this.parseCategories(query.value);

		value = value.replace(/@disabled/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase();

		const result = local
			.sort((e1, e2) => e1.displayName.localeCompare(e2.displayName))
			.filter(e => runningExtensions.every(r => !areSameExtensions({ id: r.identifier.value, uuid: r.uuid }, e.identifier))
				&& (e.name.toLowerCase().indexOf(value) > -1 || e.displayName.toLowerCase().indexOf(value) > -1)
				&& (!categories.length || categories.some(category => (e.local && e.local.manifest.categories || []).some(c => c.toLowerCase() === category))));

		return this.sortExtensions(result, options);
	}

	private filterEnabledExtensions(local: IExtension[], runningExtensions: IExtensionDescription[], query: Query, options: IQueryOptions): IExtension[] {
		let { value, categories } = this.parseCategories(query.value);

		value = value ? value.replace(/@enabled/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase() : '';

		local = local.filter(e => !e.isBuiltin);
		const result = local
			.sort((e1, e2) => e1.displayName.localeCompare(e2.displayName))
			.filter(e => runningExtensions.some(r => areSameExtensions({ id: r.identifier.value, uuid: r.uuid }, e.identifier))
				&& (e.name.toLowerCase().indexOf(value) > -1 || e.displayName.toLowerCase().indexOf(value) > -1)
				&& (!categories.length || categories.some(category => (e.local && e.local.manifest.categories || []).some(c => c.toLowerCase() === category))));

		return this.sortExtensions(result, options);
	}

	private filterTrustRequiredExtensions(local: IExtension[], query: Query, options: IQueryOptions): IExtension[] {
		let value = query.value;
		const onStartOnly = /@trustRequired:onStart/i.test(value);
		if (onStartOnly) {
			value = value.replace(/@trustRequired:onStart/g, '');
		}
		const onDemandOnly = /@trustRequired:onDemand/i.test(value);
		if (onDemandOnly) {
			value = value.replace(/@trustRequired:onDemand/g, '');
		}

		value = value.replace(/@trustRequired/g, '').replace(/@sort:(\w+)(-\w*)?/g, '').trim().toLowerCase();

		const result = local.filter(extension => extension.local && this.extensionManifestPropertiesService.getExtensionUntrustedWorkspaceSupportType(extension.local.manifest) !== true && (extension.name.toLowerCase().indexOf(value) > -1 || extension.displayName.toLowerCase().indexOf(value) > -1));

		if (onStartOnly) {
			const onStartExtensions = result.filter(extension => extension.local && this.extensionManifestPropertiesService.getExtensionUntrustedWorkspaceSupportType(extension.local.manifest) === false);
			return this.sortExtensions(onStartExtensions, options);
		}

		if (onDemandOnly) {
			const onDemandExtensions = result.filter(extension => extension.local && this.extensionManifestPropertiesService.getExtensionUntrustedWorkspaceSupportType(extension.local.manifest) === 'limited');
			return this.sortExtensions(onDemandExtensions, options);
		}

		return this.sortExtensions(result, options);
	}


	private mergeAddedExtensions(extensions: IExtension[], newExtensions: IExtension[]): IExtension[] | undefined {
		const oldExtensions = [...extensions];
		const findPreviousExtensionIndex = (from: number): number => {
			let index = -1;
			const previousExtensionInNew = newExtensions[from];
			if (previousExtensionInNew) {
				index = oldExtensions.findIndex(e => areSameExtensions(e.identifier, previousExtensionInNew.identifier));
				if (index === -1) {
					return findPreviousExtensionIndex(from - 1);
				}
			}
			return index;
		};

		let hasChanged: boolean = false;
		for (let index = 0; index < newExtensions.length; index++) {
			const extension = newExtensions[index];
			if (extensions.every(r => !areSameExtensions(r.identifier, extension.identifier))) {
				hasChanged = true;
				extensions.splice(findPreviousExtensionIndex(index - 1) + 1, 0, extension);
			}
		}

		return hasChanged ? extensions : undefined;
	}

	private async queryGallery(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const hasUserDefinedSortOrder = options.sortBy !== undefined;
		if (!hasUserDefinedSortOrder && !query.value.trim()) {
			options.sortBy = SortBy.InstallCount;
		}

		if (this.isRecommendationsQuery(query)) {
			return this.queryRecommendations(query, options, token);
		}

		if (/\bcurated:([^\s]+)\b/.test(query.value)) {
			return this.getCuratedModel(query, options, token);
		}

		const text = query.value;

		if (/\bext:([^\s]+)\b/g.test(text)) {
			options.text = text;
			options.source = 'file-extension-tags';
			return this.extensionsWorkbenchService.queryGallery(options, token).then(pager => this.getPagedModel(pager));
		}

		let preferredResults: string[] = [];
		if (text) {
			options.text = text.substr(0, 350);
			options.source = 'searchText';
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

	private async getCuratedModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const value = query.value.replace(/curated:/g, '').trim();
		const names = await this.experimentService.getCuratedExtensionsList(value);
		if (Array.isArray(names) && names.length) {
			options.source = `curated:${value}`;
			options.names = names;
			options.pageSize = names.length;
			const pager = await this.extensionsWorkbenchService.queryGallery(options, token);
			this.sortFirstPage(pager, names);
			return this.getPagedModel(pager || []);
		}
		return new PagedModel([]);
	}

	private isRecommendationsQuery(query: Query): boolean {
		return ExtensionsListView.isWorkspaceRecommendedExtensionsQuery(query.value)
			|| ExtensionsListView.isKeymapsRecommendedExtensionsQuery(query.value)
			|| ExtensionsListView.isExeRecommendedExtensionsQuery(query.value)
			|| /@recommended:all/i.test(query.value)
			|| ExtensionsListView.isSearchRecommendedExtensionsQuery(query.value)
			|| ExtensionsListView.isRecommendedExtensionsQuery(query.value);
	}

	private async queryRecommendations(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		// Workspace recommendations
		if (ExtensionsListView.isWorkspaceRecommendedExtensionsQuery(query.value)) {
			return this.getWorkspaceRecommendationsModel(query, options, token);
		}

		// Keymap recommendations
		if (ExtensionsListView.isKeymapsRecommendedExtensionsQuery(query.value)) {
			return this.getKeymapRecommendationsModel(query, options, token);
		}

		// Exe recommendations
		if (ExtensionsListView.isExeRecommendedExtensionsQuery(query.value)) {
			return this.getExeRecommendationsModel(query, options, token);
		}

		// All recommendations
		if (/@recommended:all/i.test(query.value)) {
			return this.getAllRecommendationsModel(options, token);
		}

		// Search recommendations
		if (ExtensionsListView.isSearchRecommendedExtensionsQuery(query.value) ||
			(ExtensionsListView.isRecommendedExtensionsQuery(query.value) && options.sortBy !== undefined)) {
			return this.searchRecommendations(query, options, token);
		}

		// Other recommendations
		if (ExtensionsListView.isRecommendedExtensionsQuery(query.value)) {
			return this.getOtherRecommendationsModel(query, options, token);
		}

		return new PagedModel([]);
	}

	protected async getInstallableRecommendations(recommendations: string[], options: IQueryOptions, token: CancellationToken): Promise<IExtension[]> {
		const extensions: IExtension[] = [];
		if (recommendations.length) {
			const pager = await this.extensionsWorkbenchService.queryGallery({ ...options, names: recommendations, pageSize: recommendations.length }, token);
			for (const extension of pager.firstPage) {
				if (extension.gallery && (await this.extensionManagementService.canInstall(extension.gallery))) {
					extensions.push(extension);
				}
			}
		}
		return extensions;
	}

	protected async getWorkspaceRecommendations(): Promise<string[]> {
		const recommendations = await this.extensionRecommendationsService.getWorkspaceRecommendations();
		const { important } = await this.extensionRecommendationsService.getConfigBasedRecommendations();
		for (const configBasedRecommendation of important) {
			if (!recommendations.find(extensionId => extensionId === configBasedRecommendation)) {
				recommendations.push(configBasedRecommendation);
			}
		}
		return recommendations;
	}

	private async getWorkspaceRecommendationsModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const recommendations = await this.getWorkspaceRecommendations();
		const installableRecommendations = (await this.getInstallableRecommendations(recommendations, { ...options, source: 'recommendations-workspace' }, token));
		this.telemetryService.publicLog2<{ count: number }, WorkspaceRecommendationsClassification>('extensionWorkspaceRecommendations:open', { count: installableRecommendations.length });
		const result: IExtension[] = coalesce(recommendations.map(id => installableRecommendations.find(i => areSameExtensions(i.identifier, { id }))));
		return new PagedModel(result);
	}

	private async getKeymapRecommendationsModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const value = query.value.replace(/@recommended:keymaps/g, '').trim().toLowerCase();
		const recommendations = this.extensionRecommendationsService.getKeymapRecommendations();
		const installableRecommendations = (await this.getInstallableRecommendations(recommendations, { ...options, source: 'recommendations-keymaps' }, token))
			.filter(extension => extension.identifier.id.toLowerCase().indexOf(value) > -1);
		return new PagedModel(installableRecommendations);
	}

	private async getExeRecommendationsModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const exe = query.value.replace(/@exe:/g, '').trim().toLowerCase();
		const { important, others } = await this.extensionRecommendationsService.getExeBasedRecommendations(exe.startsWith('"') ? exe.substring(1, exe.length - 1) : exe);
		const installableRecommendations = await this.getInstallableRecommendations([...important, ...others], { ...options, source: 'recommendations-exe' }, token);
		return new PagedModel(installableRecommendations);
	}

	private async getOtherRecommendationsModel(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const otherRecommendations = await this.getOtherRecommendations();
		const installableRecommendations = await this.getInstallableRecommendations(otherRecommendations, { ...options, source: 'recommendations-other', sortBy: undefined }, token);
		const result = coalesce(otherRecommendations.map(id => installableRecommendations.find(i => areSameExtensions(i.identifier, { id }))));
		return new PagedModel(result);
	}

	private async getOtherRecommendations(): Promise<string[]> {
		const local = (await this.extensionsWorkbenchService.queryLocal(this.options.server))
			.map(e => e.identifier.id.toLowerCase());
		const workspaceRecommendations = (await this.getWorkspaceRecommendations())
			.map(extensionId => extensionId.toLowerCase());

		return distinct(
			flatten(await Promise.all([
				// Order is important
				this.extensionRecommendationsService.getImportantRecommendations(),
				this.extensionRecommendationsService.getFileBasedRecommendations(),
				this.extensionRecommendationsService.getOtherRecommendations()
			])).filter(extensionId => !local.includes(extensionId.toLowerCase()) && !workspaceRecommendations.includes(extensionId.toLowerCase())
			), extensionId => extensionId.toLowerCase());
	}

	// Get All types of recommendations, trimmed to show a max of 8 at any given time
	private async getAllRecommendationsModel(options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const local = (await this.extensionsWorkbenchService.queryLocal(this.options.server)).map(e => e.identifier.id.toLowerCase());

		const allRecommendations = distinct(
			flatten(await Promise.all([
				// Order is important
				this.getWorkspaceRecommendations(),
				this.extensionRecommendationsService.getImportantRecommendations(),
				this.extensionRecommendationsService.getFileBasedRecommendations(),
				this.extensionRecommendationsService.getOtherRecommendations()
			])).filter(extensionId => !local.includes(extensionId.toLowerCase())
			), extensionId => extensionId.toLowerCase());

		const installableRecommendations = await this.getInstallableRecommendations(allRecommendations, { ...options, source: 'recommendations-all', sortBy: undefined }, token);
		const result: IExtension[] = coalesce(allRecommendations.map(id => installableRecommendations.find(i => areSameExtensions(i.identifier, { id }))));
		return new PagedModel(result.slice(0, 8));
	}

	private async searchRecommendations(query: Query, options: IQueryOptions, token: CancellationToken): Promise<IPagedModel<IExtension>> {
		const value = query.value.replace(/@recommended/g, '').trim().toLowerCase();
		const recommendations = distinct([...await this.getWorkspaceRecommendations(), ...await this.getOtherRecommendations()]);
		const installableRecommendations = (await this.getInstallableRecommendations(recommendations, { ...options, source: 'recommendations', sortBy: undefined }, token))
			.filter(extension => extension.identifier.id.toLowerCase().indexOf(value) > -1);
		const result = coalesce(recommendations.map(id => installableRecommendations.find(i => areSameExtensions(i.identifier, { id }))));
		return new PagedModel(this.sortExtensions(result, options));
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
			this.updateBody(error);
		}
	}

	private updateBody(error?: any): void {
		const count = this.count();
		if (this.bodyTemplate && this.badge) {

			this.bodyTemplate.extensionsList.classList.toggle('hidden', count === 0);
			this.bodyTemplate.messageContainer.classList.toggle('hidden', count > 0);
			this.badge.setCount(count);

			if (count === 0 && this.isBodyVisible()) {
				if (error) {
					if (error instanceof ExtensionListViewWarning) {
						this.bodyTemplate.messageSeverityIcon.className = SeverityIcon.className(Severity.Warning);
						this.bodyTemplate.messageBox.textContent = getErrorMessage(error);
					} else {
						this.bodyTemplate.messageSeverityIcon.className = SeverityIcon.className(Severity.Error);
						this.bodyTemplate.messageBox.textContent = localize('error', "Error while loading extensions. {0}", getErrorMessage(error));
					}
				} else {
					this.bodyTemplate.messageSeverityIcon.className = '';
					this.bodyTemplate.messageBox.textContent = localize('no extensions found', "No extensions found.");
				}
				alert(this.bodyTemplate.messageBox.textContent);
			}
		}
		this.updateSize();
	}

	protected updateSize() {
		if (this.options.fixedHeight) {
			const length = this.list?.model.length || 0;
			this.minimumBodySize = Math.min(length, 3) * EXTENSION_LIST_ELEMENT_HEIGHT;
			this.maximumBodySize = length * EXTENSION_LIST_ELEMENT_HEIGHT;
			this.storageService.store(this.id, this.maximumBodySize, StorageScope.GLOBAL, StorageTarget.MACHINE);
		}
	}

	private updateModel(model: IPagedModel<IExtension>) {
		if (this.list) {
			this.list.model = new DelayedPagedModel(model);
			this.updateBody();
		}
	}

	private openExtension(extension: IExtension, options: { sideByside?: boolean, preserveFocus?: boolean, pinned?: boolean }): void {
		extension = this.extensionsWorkbenchService.local.filter(e => areSameExtensions(e.identifier, extension.identifier))[0] || extension;
		this.extensionsWorkbenchService.open(extension, options).then(undefined, err => this.onError(err));
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

	override dispose(): void {
		super.dispose();
		if (this.queryRequest) {
			this.queryRequest.request.cancel();
			this.queryRequest = null;
		}
		if (this.queryResult) {
			this.queryResult.disposables.dispose();
			this.queryResult = undefined;
		}
		this.list = null;
	}

	static isLocalExtensionsQuery(query: string): boolean {
		return this.isInstalledExtensionsQuery(query)
			|| this.isOutdatedExtensionsQuery(query)
			|| this.isEnabledExtensionsQuery(query)
			|| this.isDisabledExtensionsQuery(query)
			|| this.isBuiltInExtensionsQuery(query)
			|| this.isSearchBuiltInExtensionsQuery(query)
			|| this.isBuiltInGroupExtensionsQuery(query)
			|| this.isSearchTrustRequiredExtensionsQuery(query)
			|| this.isTrustRequiredExtensionsQuery(query)
			|| this.isTrustRequiredGroupExtensionsQuery(query);
	}

	static isSearchBuiltInExtensionsQuery(query: string): boolean {
		return /@builtin\s.+/i.test(query);
	}

	static isBuiltInExtensionsQuery(query: string): boolean {
		return /^\s*@builtin$/i.test(query.trim());
	}

	static isBuiltInGroupExtensionsQuery(query: string): boolean {
		return /^\s*@builtin:.+$/i.test(query.trim());
	}

	static isSearchTrustRequiredExtensionsQuery(query: string): boolean {
		return /@trustRequired\s.+/i.test(query);
	}

	static isTrustRequiredExtensionsQuery(query: string): boolean {
		return /^\s*@trustRequired$/i.test(query.trim());
	}

	static isTrustRequiredGroupExtensionsQuery(query: string): boolean {
		return /^\s*@trustRequired:.+$/i.test(query.trim());
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
		return /@recommended\s.+/i.test(query);
	}

	static isWorkspaceRecommendedExtensionsQuery(query: string): boolean {
		return /@recommended:workspace/i.test(query);
	}

	static isExeRecommendedExtensionsQuery(query: string): boolean {
		return /@exe:.+/i.test(query);
	}

	static isKeymapsRecommendedExtensionsQuery(query: string): boolean {
		return /@recommended:keymaps/i.test(query);
	}

	override focus(): void {
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

export class ServerInstalledExtensionsView extends ExtensionsListView {

	override async show(query: string): Promise<IPagedModel<IExtension>> {
		query = query ? query : '@installed';
		if (!ExtensionsListView.isLocalExtensionsQuery(query)) {
			query = query += ' @installed';
		}
		return super.show(query.trim());
	}

}

export class EnabledExtensionsView extends ExtensionsListView {

	override async show(query: string): Promise<IPagedModel<IExtension>> {
		query = query || '@enabled';
		return ExtensionsListView.isEnabledExtensionsQuery(query) ? super.show(query) : this.showEmptyModel();
	}
}

export class DisabledExtensionsView extends ExtensionsListView {

	override async show(query: string): Promise<IPagedModel<IExtension>> {
		query = query || '@disabled';
		return ExtensionsListView.isDisabledExtensionsQuery(query) ? super.show(query) : this.showEmptyModel();
	}
}

export class BuiltInFeatureExtensionsView extends ExtensionsListView {
	override async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== '@builtin') ? this.showEmptyModel() : super.show('@builtin:features');
	}
}

export class BuiltInThemesExtensionsView extends ExtensionsListView {
	override async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== '@builtin') ? this.showEmptyModel() : super.show('@builtin:themes');
	}
}

export class BuiltInProgrammingLanguageExtensionsView extends ExtensionsListView {
	override async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== '@builtin') ? this.showEmptyModel() : super.show('@builtin:basics');
	}
}

export class TrustRequiredOnStartExtensionsView extends ExtensionsListView {
	override async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== '@trustRequired') ? this.showEmptyModel() : super.show('@trustRequired:onStart');
	}
}

export class TrustRequiredOnDemandExtensionsView extends ExtensionsListView {
	override async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== '@trustRequired') ? this.showEmptyModel() : super.show('@trustRequired:onDemand');
	}
}

export class DefaultRecommendedExtensionsView extends ExtensionsListView {
	private readonly recommendedExtensionsQuery = '@recommended:all';

	override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._register(this.extensionRecommendationsService.onDidChangeRecommendations(() => {
			this.show('');
		}));
	}

	override async show(query: string): Promise<IPagedModel<IExtension>> {
		if (query && query.trim() !== this.recommendedExtensionsQuery) {
			return this.showEmptyModel();
		}
		const model = await super.show(this.recommendedExtensionsQuery);
		if (!this.extensionsWorkbenchService.local.some(e => !e.isBuiltin)) {
			// This is part of popular extensions view. Collapse if no installed extensions.
			this.setExpanded(model.length > 0);
		}
		return model;
	}

}

export class RecommendedExtensionsView extends ExtensionsListView {
	private readonly recommendedExtensionsQuery = '@recommended';

	override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._register(this.extensionRecommendationsService.onDidChangeRecommendations(() => {
			this.show('');
		}));
	}

	override async show(query: string): Promise<IPagedModel<IExtension>> {
		return (query && query.trim() !== this.recommendedExtensionsQuery) ? this.showEmptyModel() : super.show(this.recommendedExtensionsQuery);
	}
}

export class WorkspaceRecommendedExtensionsView extends ExtensionsListView implements IWorkspaceRecommendedExtensionsView {
	private readonly recommendedExtensionsQuery = '@recommended:workspace';

	override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this._register(this.extensionRecommendationsService.onDidChangeRecommendations(() => this.show(this.recommendedExtensionsQuery)));
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.show(this.recommendedExtensionsQuery)));
	}

	override async show(query: string): Promise<IPagedModel<IExtension>> {
		let shouldShowEmptyView = query && query.trim() !== '@recommended' && query.trim() !== '@recommended:workspace';
		let model = await (shouldShowEmptyView ? this.showEmptyModel() : super.show(this.recommendedExtensionsQuery));
		this.setExpanded(model.length > 0);
		return model;
	}

	private async getInstallableWorkspaceRecommendations() {
		const installed = (await this.extensionsWorkbenchService.queryLocal())
			.filter(l => l.enablementState !== EnablementState.DisabledByExtensionKind); // Filter extensions disabled by kind
		const recommendations = (await this.getWorkspaceRecommendations())
			.filter(extensionId => installed.every(local => !areSameExtensions({ id: extensionId }, local.identifier)));
		return this.getInstallableRecommendations(recommendations, { source: 'install-all-workspace-recommendations' }, CancellationToken.None);
	}

	async installWorkspaceRecommendations(): Promise<void> {
		const installableRecommendations = await this.getInstallableWorkspaceRecommendations();
		if (installableRecommendations.length) {
			await this.extensionManagementService.installExtensions(installableRecommendations.map(i => i.gallery!));
		} else {
			this.notificationService.notify({
				severity: Severity.Info,
				message: localize('no local extensions', "There are no extensions to install.")
			});
		}
	}

}
