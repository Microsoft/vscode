/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { Orientation, Sizing, SplitView } from 'vs/base/browser/ui/splitview/splitview';
import { Widget } from 'vs/base/browser/ui/widget';
import * as arrays from 'vs/base/common/arrays';
import { Delayer, ThrottledDelayer } from 'vs/base/common/async';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { IStringDictionary } from 'vs/base/common/collections';
import { getErrorMessage, isPromiseCanceledError, onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { ArrayNavigator } from 'vs/base/common/navigator';
import { assertIsDefined, withNullAsUndefined, withUndefinedAsNull } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorExtensionsRegistry, IEditorContributionDescription, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { FindController } from 'vs/editor/contrib/find/findController';
import { FoldingController } from 'vs/editor/contrib/folding/folding';
import { MessageController } from 'vs/editor/contrib/message/messageController';
import { SelectionHighlighter } from 'vs/editor/contrib/multicursor/multicursor';
import * as nls from 'vs/nls';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IConstructorSignature1, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IEditorProgressService } from 'vs/platform/progress/common/progress';
import { Registry } from 'vs/platform/registry/common/platform';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { scrollbarShadow } from 'vs/platform/theme/common/colorRegistry';
import { attachStylerCallback } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { Extensions as EditorExtensions, IEditorRegistry } from 'vs/workbench/browser/editor';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { BaseTextEditor } from 'vs/workbench/browser/parts/editor/textEditor';
import { EditorInput, EditorOptions, IEditorControl } from 'vs/workbench/common/editor';
import { ResourceEditorModel } from 'vs/workbench/common/editor/resourceEditorModel';
import { DefaultSettingsRenderer, FolderSettingsRenderer, IPreferencesRenderer, UserSettingsRenderer, WorkspaceSettingsRenderer } from 'vs/workbench/contrib/preferences/browser/preferencesRenderers';
import { SearchWidget, SettingsTarget, SettingsTargetsWidget } from 'vs/workbench/contrib/preferences/browser/preferencesWidgets';
import { CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_JSON_EDITOR, CONTEXT_SETTINGS_SEARCH_FOCUS, IPreferencesSearchService, ISearchProvider } from 'vs/workbench/contrib/preferences/common/preferences';
import { IEditorGroup, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IFilterResult, IPreferencesService, ISetting, ISettingsEditorModel, ISettingsGroup, SettingsEditorOptions } from 'vs/workbench/services/preferences/common/preferences';
import { DefaultPreferencesEditorInput, PreferencesEditorInput } from 'vs/workbench/services/preferences/common/preferencesEditorInput';
import { DefaultSettingsEditorModel, SettingsEditorModel } from 'vs/workbench/services/preferences/common/preferencesModels';

export class PreferencesEditor extends BaseEditor {

	static readonly ID: string = 'workbench.editor.preferencesEditor';

	private defaultSettingsEditorContextKey: IContextKey<boolean>;
	private defaultSettingsJSONEditorContextKey: IContextKey<boolean>;
	private searchFocusContextKey: IContextKey<boolean>;
	private headerContainer!: HTMLElement;
	private searchWidget!: SearchWidget;
	private sideBySidePreferencesWidget!: SideBySidePreferencesWidget;
	private preferencesRenderers!: PreferencesRenderersController;

	private delayedFilterLogging: Delayer<void>;
	private localSearchDelayer: Delayer<void>;
	private remoteSearchThrottle: ThrottledDelayer<void>;
	private _lastReportedFilter: string | null = null;

	private lastFocusedWidget: SearchWidget | SideBySidePreferencesWidget | undefined = undefined;

	get minimumWidth(): number { return this.sideBySidePreferencesWidget ? this.sideBySidePreferencesWidget.minimumWidth : 0; }
	get maximumWidth(): number { return this.sideBySidePreferencesWidget ? this.sideBySidePreferencesWidget.maximumWidth : Number.POSITIVE_INFINITY; }

	// these setters need to exist because this extends from BaseEditor
	set minimumWidth(value: number) { /*noop*/ }
	set maximumWidth(value: number) { /*noop*/ }

	get minimumHeight() { return 260; }

	private _onDidCreateWidget = this._register(new Emitter<{ width: number; height: number; } | undefined>());
	readonly onDidSizeConstraintsChange: Event<{ width: number; height: number; } | undefined> = this._onDidCreateWidget.event;

	constructor(
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IEditorService private readonly editorService: IEditorService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IEditorProgressService private readonly editorProgressService: IEditorProgressService,
		@IStorageService storageService: IStorageService
	) {
		super(PreferencesEditor.ID, telemetryService, themeService, storageService);
		this.defaultSettingsEditorContextKey = CONTEXT_SETTINGS_EDITOR.bindTo(this.contextKeyService);
		this.defaultSettingsJSONEditorContextKey = CONTEXT_SETTINGS_JSON_EDITOR.bindTo(this.contextKeyService);
		this.searchFocusContextKey = CONTEXT_SETTINGS_SEARCH_FOCUS.bindTo(this.contextKeyService);
		this.delayedFilterLogging = new Delayer<void>(1000);
		this.localSearchDelayer = new Delayer(100);
		this.remoteSearchThrottle = new ThrottledDelayer(200);
	}

	createEditor(parent: HTMLElement): void {
		DOM.addClass(parent, 'preferences-editor');

		this.headerContainer = DOM.append(parent, DOM.$('.preferences-header'));
		this.searchWidget = this._register(this.instantiationService.createInstance(SearchWidget, this.headerContainer, {
			ariaLabel: nls.localize('SearchSettingsWidget.AriaLabel', "Search settings"),
			placeholder: nls.localize('SearchSettingsWidget.Placeholder', "Search Settings"),
			focusKey: this.searchFocusContextKey,
			showResultCount: true,
			ariaLive: 'assertive'
		}));
		this._register(this.searchWidget.onDidChange(value => this.onInputChanged()));
		this._register(this.searchWidget.onFocus(() => this.lastFocusedWidget = this.searchWidget));
		this.lastFocusedWidget = this.searchWidget;

		const editorsContainer = DOM.append(parent, DOM.$('.preferences-editors-container'));
		this.sideBySidePreferencesWidget = this._register(this.instantiationService.createInstance(SideBySidePreferencesWidget, editorsContainer));
		this._onDidCreateWidget.fire(undefined);
		this._register(this.sideBySidePreferencesWidget.onFocus(() => this.lastFocusedWidget = this.sideBySidePreferencesWidget));
		this._register(this.sideBySidePreferencesWidget.onDidSettingsTargetChange(target => this.switchSettings(target)));

		this.preferencesRenderers = this._register(this.instantiationService.createInstance(PreferencesRenderersController));

		this._register(this.preferencesRenderers.onDidFilterResultsCountChange(count => this.showSearchResultsMessage(count)));
	}

	clearSearchResults(): void {
		if (this.searchWidget) {
			this.searchWidget.clear();
		}
	}

	focusNextResult(): void {
		if (this.preferencesRenderers) {
			this.preferencesRenderers.focusNextPreference(true);
		}
	}

	focusPreviousResult(): void {
		if (this.preferencesRenderers) {
			this.preferencesRenderers.focusNextPreference(false);
		}
	}

	editFocusedPreference(): void {
		this.preferencesRenderers.editFocusedPreference();
	}

	setInput(newInput: EditorInput, options: SettingsEditorOptions | undefined, token: CancellationToken): Promise<void> {
		this.defaultSettingsEditorContextKey.set(true);
		this.defaultSettingsJSONEditorContextKey.set(true);
		if (options && options.query) {
			this.focusSearch(options.query);
		}

		return super.setInput(newInput, options, token).then(() => this.updateInput(newInput as PreferencesEditorInput, options, token));
	}

	layout(dimension: DOM.Dimension): void {
		this.searchWidget.layout(dimension);
		const headerHeight = DOM.getTotalHeight(this.headerContainer);
		this.sideBySidePreferencesWidget.layout(new DOM.Dimension(dimension.width, dimension.height - headerHeight));
	}

	getControl(): IEditorControl | undefined {
		return this.sideBySidePreferencesWidget.getControl();
	}

	focus(): void {
		if (this.lastFocusedWidget) {
			this.lastFocusedWidget.focus();
		}
	}

	focusSearch(filter?: string): void {
		if (filter) {
			this.searchWidget.setValue(filter);
		}

		this.searchWidget.focus();
	}

	focusSettingsFileEditor(): void {
		if (this.sideBySidePreferencesWidget) {
			this.sideBySidePreferencesWidget.focus();
		}
	}

	clearInput(): void {
		this.defaultSettingsEditorContextKey.set(false);
		this.defaultSettingsJSONEditorContextKey.set(false);
		this.sideBySidePreferencesWidget.clearInput();
		this.preferencesRenderers.onHidden();
		super.clearInput();
	}

	protected setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		this.sideBySidePreferencesWidget.setEditorVisible(visible, group);
		super.setEditorVisible(visible, group);
	}

	private updateInput(newInput: PreferencesEditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {
		return this.sideBySidePreferencesWidget.setInput(<DefaultPreferencesEditorInput>newInput.secondary, <EditorInput>newInput.primary, options, token).then(({ defaultPreferencesRenderer, editablePreferencesRenderer }) => {
			if (token.isCancellationRequested) {
				return;
			}

			this.preferencesRenderers.defaultPreferencesRenderer = defaultPreferencesRenderer!;
			this.preferencesRenderers.editablePreferencesRenderer = editablePreferencesRenderer!;
			this.onInputChanged();
		});
	}

	private onInputChanged(): void {
		const query = this.searchWidget.getValue().trim();
		this.delayedFilterLogging.cancel();
		this.triggerSearch(query)
			.then(() => {
				const result = this.preferencesRenderers.lastFilterResult;
				if (result) {
					this.delayedFilterLogging.trigger(() => this.reportFilteringUsed(
						query,
						this.preferencesRenderers.lastFilterResult));
				}
			});
	}

	private triggerSearch(query: string): Promise<void> {
		if (query) {
			return Promise.all([
				this.localSearchDelayer.trigger(() => this.preferencesRenderers.localFilterPreferences(query).then(() => { })),
				this.remoteSearchThrottle.trigger(() => Promise.resolve(this.editorProgressService.showWhile(this.preferencesRenderers.remoteSearchPreferences(query), 500)))
			]).then(() => { });
		} else {
			// When clearing the input, update immediately to clear it
			this.localSearchDelayer.cancel();
			this.preferencesRenderers.localFilterPreferences(query);

			this.remoteSearchThrottle.cancel();
			return this.preferencesRenderers.remoteSearchPreferences(query);
		}
	}

	private switchSettings(target: SettingsTarget): void {
		// Focus the editor if this editor is not active editor
		if (this.editorService.activeEditorPane !== this) {
			this.focus();
		}
		const promise = this.input && this.input.isDirty() ? this.editorService.save({ editor: this.input, groupId: this.group!.id }) : Promise.resolve(true);
		promise.then(() => {
			if (target === ConfigurationTarget.USER_LOCAL) {
				this.preferencesService.switchSettings(ConfigurationTarget.USER_LOCAL, this.preferencesService.userSettingsResource, true);
			} else if (target === ConfigurationTarget.WORKSPACE) {
				this.preferencesService.switchSettings(ConfigurationTarget.WORKSPACE, this.preferencesService.workspaceSettingsResource!, true);
			} else if (target instanceof URI) {
				this.preferencesService.switchSettings(ConfigurationTarget.WORKSPACE_FOLDER, target, true);
			}
		});
	}

	private showSearchResultsMessage(count: IPreferencesCount): void {
		const countValue = count.count;
		if (count.target) {
			this.sideBySidePreferencesWidget.setResultCount(count.target, count.count);
		} else if (this.searchWidget.getValue()) {
			if (countValue === 0) {
				this.searchWidget.showMessage(nls.localize('noSettingsFound', "No Settings Found"));
			} else if (countValue === 1) {
				this.searchWidget.showMessage(nls.localize('oneSettingFound', "1 Setting Found"));
			} else {
				this.searchWidget.showMessage(nls.localize('settingsFound', "{0} Settings Found", countValue));
			}
		} else {
			this.searchWidget.showMessage(nls.localize('totalSettingsMessage', "Total {0} Settings", countValue));
		}
	}

	private _countById(settingsGroups: ISettingsGroup[]): IStringDictionary<number> {
		const result: IStringDictionary<number> = {};

		for (const group of settingsGroups) {
			let i = 0;
			for (const section of group.sections) {
				i += section.settings.length;
			}

			result[group.id] = i;
		}

		return result;
	}

	private reportFilteringUsed(filter: string, filterResult: IFilterResult | null): void {
		if (filter && filter !== this._lastReportedFilter) {
			const metadata = filterResult && filterResult.metadata;
			const counts = filterResult && this._countById(filterResult.filteredGroups);

			let durations: any;
			if (metadata) {
				durations = Object.create(null);
				Object.keys(metadata).forEach(key => durations[key] = metadata[key].duration);
			}

			const data = {
				filter,
				durations,
				counts,
				requestCount: metadata && metadata['nlpResult'] && metadata['nlpResult'].requestCount
			};

			/* __GDPR__
				"defaultSettings.filter" : {
					"filter": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
					"durations.nlpresult" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
					"counts.nlpresult" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
					"durations.filterresult" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
					"counts.filterresult" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
					"requestCount" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
				}
			*/
			this.telemetryService.publicLog('defaultSettings.filter', data);
			this._lastReportedFilter = filter;
		}
	}
}

class SettingsNavigator extends ArrayNavigator<ISetting> {

	next(): ISetting | null {
		return super.next() || super.first();
	}

	previous(): ISetting | null {
		return super.previous() || super.last();
	}

	reset(): void {
		this.index = this.start - 1;
	}
}

interface IPreferencesCount {
	target?: SettingsTarget;
	count: number;
}

class PreferencesRenderersController extends Disposable {

	private _defaultPreferencesRenderer!: IPreferencesRenderer<ISetting>;
	private _defaultPreferencesRendererDisposables: IDisposable[] = [];

	private _editablePreferencesRenderer!: IPreferencesRenderer<ISetting>;
	private _editablePreferencesRendererDisposables: IDisposable[] = [];

	private _settingsNavigator: SettingsNavigator | null = null;
	private _remoteFilterCancelToken: CancellationTokenSource | null = null;
	private _prefsModelsForSearch = new Map<string, ISettingsEditorModel>();

	private _currentLocalSearchProvider: ISearchProvider | null = null;
	private _currentRemoteSearchProvider: ISearchProvider | null = null;
	private _lastQuery = '';
	private _lastFilterResult: IFilterResult | null = null;

	private readonly _onDidFilterResultsCountChange: Emitter<IPreferencesCount> = this._register(new Emitter<IPreferencesCount>());
	readonly onDidFilterResultsCountChange: Event<IPreferencesCount> = this._onDidFilterResultsCountChange.event;

	constructor(
		@IPreferencesSearchService private readonly preferencesSearchService: IPreferencesSearchService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	get lastFilterResult(): IFilterResult | null {
		return this._lastFilterResult;
	}

	get defaultPreferencesRenderer(): IPreferencesRenderer<ISetting> {
		return this._defaultPreferencesRenderer;
	}

	get editablePreferencesRenderer(): IPreferencesRenderer<ISetting> {
		return this._editablePreferencesRenderer;
	}

	set defaultPreferencesRenderer(defaultPreferencesRenderer: IPreferencesRenderer<ISetting>) {
		if (this._defaultPreferencesRenderer !== defaultPreferencesRenderer) {
			this._defaultPreferencesRenderer = defaultPreferencesRenderer;

			this._defaultPreferencesRendererDisposables = dispose(this._defaultPreferencesRendererDisposables);

			if (this._defaultPreferencesRenderer) {
				this._defaultPreferencesRenderer.onUpdatePreference(({ key, value, source }) => {
					this._editablePreferencesRenderer.updatePreference(key, value, source);
					this._updatePreference(key, value, source);
				}, this, this._defaultPreferencesRendererDisposables);
				this._defaultPreferencesRenderer.onFocusPreference(preference => this._focusPreference(preference, this._editablePreferencesRenderer), this, this._defaultPreferencesRendererDisposables);
				this._defaultPreferencesRenderer.onClearFocusPreference(preference => this._clearFocus(preference, this._editablePreferencesRenderer), this, this._defaultPreferencesRendererDisposables);
			}
		}
	}

	set editablePreferencesRenderer(editableSettingsRenderer: IPreferencesRenderer<ISetting>) {
		if (this._editablePreferencesRenderer !== editableSettingsRenderer) {
			this._editablePreferencesRenderer = editableSettingsRenderer;
			this._editablePreferencesRendererDisposables = dispose(this._editablePreferencesRendererDisposables);
			if (this._editablePreferencesRenderer) {
				(<ISettingsEditorModel>this._editablePreferencesRenderer.preferencesModel)
					.onDidChangeGroups(this._onEditableContentDidChange, this, this._editablePreferencesRendererDisposables);

				this._editablePreferencesRenderer.onUpdatePreference(({ key, value, source }) => this._updatePreference(key, value, source, true), this, this._defaultPreferencesRendererDisposables);
			}
		}
	}

	private async _onEditableContentDidChange(): Promise<void> {
		const foundExactMatch = await this.localFilterPreferences(this._lastQuery, true);
		if (!foundExactMatch) {
			await this.remoteSearchPreferences(this._lastQuery, true);
		}
	}

	onHidden(): void {
		this._prefsModelsForSearch.forEach(model => model.dispose());
		this._prefsModelsForSearch = new Map<string, ISettingsEditorModel>();
	}

	remoteSearchPreferences(query: string, updateCurrentResults?: boolean): Promise<void> {
		if (this.lastFilterResult && this.lastFilterResult.exactMatch) {
			// Skip and clear remote search
			query = '';
		}

		if (this._remoteFilterCancelToken) {
			this._remoteFilterCancelToken.cancel();
			this._remoteFilterCancelToken.dispose();
			this._remoteFilterCancelToken = null;
		}

		this._currentRemoteSearchProvider = (updateCurrentResults && this._currentRemoteSearchProvider) || this.preferencesSearchService.getRemoteSearchProvider(query) || null;

		this._remoteFilterCancelToken = new CancellationTokenSource();
		return this.filterOrSearchPreferences(query, this._currentRemoteSearchProvider!, 'nlpResult', nls.localize('nlpResult', "Natural Language Results"), 1, this._remoteFilterCancelToken.token, updateCurrentResults).then(() => {
			if (this._remoteFilterCancelToken) {
				this._remoteFilterCancelToken.dispose();
				this._remoteFilterCancelToken = null;
			}
		}, err => {
			if (isPromiseCanceledError(err)) {
				return;
			} else {
				onUnexpectedError(err);
			}
		});
	}

	localFilterPreferences(query: string, updateCurrentResults?: boolean): Promise<boolean> {
		if (this._settingsNavigator) {
			this._settingsNavigator.reset();
		}

		this._currentLocalSearchProvider = (updateCurrentResults && this._currentLocalSearchProvider) || this.preferencesSearchService.getLocalSearchProvider(query);
		return this.filterOrSearchPreferences(query, this._currentLocalSearchProvider, 'filterResult', nls.localize('filterResult', "Filtered Results"), 0, undefined, updateCurrentResults);
	}

	private filterOrSearchPreferences(query: string, searchProvider: ISearchProvider, groupId: string, groupLabel: string, groupOrder: number, token?: CancellationToken, editableContentOnly?: boolean): Promise<boolean> {
		this._lastQuery = query;

		const filterPs: Promise<IFilterResult | undefined>[] = [this._filterOrSearchPreferences(query, this.editablePreferencesRenderer, searchProvider, groupId, groupLabel, groupOrder, token)];
		if (!editableContentOnly) {
			filterPs.push(
				this._filterOrSearchPreferences(query, this.defaultPreferencesRenderer, searchProvider, groupId, groupLabel, groupOrder, token));
			filterPs.push(
				this.searchAllSettingsTargets(query, searchProvider, groupId, groupLabel, groupOrder, token).then(() => undefined));
		}

		return Promise.all(filterPs).then(results => {
			let [editableFilterResult, defaultFilterResult] = results;

			if (!defaultFilterResult && editableContentOnly) {
				defaultFilterResult = this.lastFilterResult!;
			}

			this.consolidateAndUpdate(defaultFilterResult, editableFilterResult);
			this._lastFilterResult = withUndefinedAsNull(defaultFilterResult);

			return !!(defaultFilterResult && defaultFilterResult.exactMatch);
		});
	}

	private searchAllSettingsTargets(query: string, searchProvider: ISearchProvider, groupId: string, groupLabel: string, groupOrder: number, token?: CancellationToken): Promise<void> {
		const searchPs = [
			this.searchSettingsTarget(query, searchProvider, ConfigurationTarget.WORKSPACE, groupId, groupLabel, groupOrder, token),
			this.searchSettingsTarget(query, searchProvider, ConfigurationTarget.USER_LOCAL, groupId, groupLabel, groupOrder, token)
		];

		for (const folder of this.workspaceContextService.getWorkspace().folders) {
			const folderSettingsResource = this.preferencesService.getFolderSettingsResource(folder.uri);
			searchPs.push(this.searchSettingsTarget(query, searchProvider, withNullAsUndefined(folderSettingsResource), groupId, groupLabel, groupOrder, token));
		}


		return Promise.all(searchPs).then(() => { });
	}

	private searchSettingsTarget(query: string, provider: ISearchProvider, target: SettingsTarget | undefined, groupId: string, groupLabel: string, groupOrder: number, token?: CancellationToken): Promise<void> {
		if (!query) {
			// Don't open the other settings targets when query is empty
			this._onDidFilterResultsCountChange.fire({ target, count: 0 });
			return Promise.resolve();
		}

		return this.getPreferencesEditorModel(target).then<IFilterResult | undefined>(model => {
			return model && this._filterOrSearchPreferencesModel('', <ISettingsEditorModel>model, provider, groupId, groupLabel, groupOrder, token);
		}).then(result => {
			const count = result ? this._flatten(result.filteredGroups).length : 0;
			this._onDidFilterResultsCountChange.fire({ target, count });
		}, err => {
			if (!isPromiseCanceledError(err)) {
				return Promise.reject(err);
			}

			return undefined;
		});
	}

	private async getPreferencesEditorModel(target: SettingsTarget | undefined): Promise<ISettingsEditorModel | undefined> {
		const resource = target === ConfigurationTarget.USER_LOCAL ? this.preferencesService.userSettingsResource :
			target === ConfigurationTarget.USER_REMOTE ? this.preferencesService.userSettingsResource :
				target === ConfigurationTarget.WORKSPACE ? this.preferencesService.workspaceSettingsResource :
					target;

		if (!resource) {
			return undefined;
		}

		const targetKey = resource.toString();
		if (!this._prefsModelsForSearch.has(targetKey)) {
			try {
				const model = await this.preferencesService.createPreferencesEditorModel(resource);
				if (model) {
					this._register(model);
					this._prefsModelsForSearch.set(targetKey, <ISettingsEditorModel>model);
				}
			} catch (e) {
				// Will throw when the settings file doesn't exist.
				return undefined;
			}
		}

		return this._prefsModelsForSearch.get(targetKey);
	}

	focusNextPreference(forward: boolean = true) {
		if (!this._settingsNavigator) {
			return;
		}

		const setting = forward ? this._settingsNavigator.next() : this._settingsNavigator.previous();
		this._focusPreference(setting, this._defaultPreferencesRenderer);
		this._focusPreference(setting, this._editablePreferencesRenderer);
	}

	editFocusedPreference(): void {
		if (!this._settingsNavigator || !this._settingsNavigator.current()) {
			return;
		}

		const setting = this._settingsNavigator.current();
		const shownInEditableRenderer = this._editablePreferencesRenderer.editPreference(setting!);
		if (!shownInEditableRenderer) {
			this.defaultPreferencesRenderer.editPreference(setting!);
		}
	}

	private _filterOrSearchPreferences(filter: string, preferencesRenderer: IPreferencesRenderer<ISetting>, provider: ISearchProvider, groupId: string, groupLabel: string, groupOrder: number, token?: CancellationToken): Promise<IFilterResult | undefined> {
		if (!preferencesRenderer) {
			return Promise.resolve(undefined);
		}

		const model = <ISettingsEditorModel>preferencesRenderer.preferencesModel;
		return this._filterOrSearchPreferencesModel(filter, model, provider, groupId, groupLabel, groupOrder, token).then(filterResult => {
			preferencesRenderer.filterPreferences(filterResult);
			return filterResult;
		});
	}

	private _filterOrSearchPreferencesModel(filter: string, model: ISettingsEditorModel, provider: ISearchProvider, groupId: string, groupLabel: string, groupOrder: number, token?: CancellationToken): Promise<IFilterResult | undefined> {
		const searchP = provider ? provider.searchModel(model, token) : Promise.resolve(null);
		return searchP
			.then(null, err => {
				if (isPromiseCanceledError(err)) {
					return Promise.reject(err);
				} else {
					/* __GDPR__
						"defaultSettings.searchError" : {
							"message": { "classification": "CallstackOrException", "purpose": "FeatureInsight" }
						}
					*/
					const message = getErrorMessage(err).trim();
					if (message && message !== 'Error') {
						// "Error" = any generic network error
						this.telemetryService.publicLogError('defaultSettings.searchError', { message });
						this.logService.info('Setting search error: ' + message);
					}
					return undefined;
				}
			})
			.then(searchResult => {
				if (token && token.isCancellationRequested) {
					searchResult = null;
				}

				const filterResult = searchResult ?
					model.updateResultGroup(groupId, {
						id: groupId,
						label: groupLabel,
						result: searchResult,
						order: groupOrder
					}) :
					model.updateResultGroup(groupId, undefined);

				if (filterResult) {
					filterResult.query = filter;
					filterResult.exactMatch = !!searchResult && searchResult.exactMatch;
				}

				return filterResult;
			});
	}

	private consolidateAndUpdate(defaultFilterResult: IFilterResult | undefined, editableFilterResult: IFilterResult | undefined): void {
		const defaultPreferencesFilteredGroups = defaultFilterResult ? defaultFilterResult.filteredGroups : this._getAllPreferences(this._defaultPreferencesRenderer);
		const editablePreferencesFilteredGroups = editableFilterResult ? editableFilterResult.filteredGroups : this._getAllPreferences(this._editablePreferencesRenderer);
		const consolidatedSettings = this._consolidateSettings(editablePreferencesFilteredGroups, defaultPreferencesFilteredGroups);

		// Maintain the current navigation position when updating SettingsNavigator
		const current = this._settingsNavigator && this._settingsNavigator.current();
		const navigatorSettings = this._lastQuery ? consolidatedSettings : [];
		const currentIndex = current ?
			arrays.firstIndex(navigatorSettings, s => s.key === current.key) :
			-1;

		this._settingsNavigator = new SettingsNavigator(navigatorSettings, Math.max(currentIndex, 0));

		if (currentIndex >= 0) {
			this._settingsNavigator.next();
			const newCurrent = this._settingsNavigator.current();
			this._focusPreference(newCurrent, this._defaultPreferencesRenderer);
			this._focusPreference(newCurrent, this._editablePreferencesRenderer);
		}

		const totalCount = consolidatedSettings.length;
		this._onDidFilterResultsCountChange.fire({ count: totalCount });
	}

	private _getAllPreferences(preferencesRenderer: IPreferencesRenderer<ISetting>): ISettingsGroup[] {
		return preferencesRenderer ? (<ISettingsEditorModel>preferencesRenderer.preferencesModel).settingsGroups : [];
	}

	private _focusPreference(preference: ISetting | null, preferencesRenderer: IPreferencesRenderer<ISetting>): void {
		if (preference && preferencesRenderer) {
			preferencesRenderer.focusPreference(preference);
		}
	}

	private _clearFocus(preference: ISetting, preferencesRenderer: IPreferencesRenderer<ISetting>): void {
		if (preference && preferencesRenderer) {
			preferencesRenderer.clearFocus(preference);
		}
	}

	private _updatePreference(key: string, value: any, source: ISetting, fromEditableSettings?: boolean): void {
		const data: { [key: string]: any; } = {
			userConfigurationKeys: [key]
		};

		if (this.lastFilterResult) {
			data['query'] = this.lastFilterResult.query;
			data['editableSide'] = !!fromEditableSettings;

			const nlpMetadata = this.lastFilterResult.metadata && this.lastFilterResult.metadata['nlpResult'];
			if (nlpMetadata) {
				const sortedKeys = Object.keys(nlpMetadata.scoredResults).sort((a, b) => nlpMetadata.scoredResults[b].score - nlpMetadata.scoredResults[a].score);
				const suffix = '##' + key;
				data['nlpIndex'] = arrays.firstIndex(sortedKeys, key => key.endsWith(suffix));
			}

			const settingLocation = this._findSetting(this.lastFilterResult, key);
			if (settingLocation) {
				data['groupId'] = this.lastFilterResult.filteredGroups[settingLocation.groupIdx].id;
				data['displayIdx'] = settingLocation.overallSettingIdx;
			}
		}

		/* __GDPR__
			"defaultSettingsActions.copySetting" : {
				"userConfigurationKeys" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"query" : { "classification": "CustomerContent", "purpose": "FeatureInsight" },
				"nlpIndex" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"groupId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"displayIdx" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"editableSide" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		this.telemetryService.publicLog('defaultSettingsActions.copySetting', data);
	}

	private _findSetting(filterResult: IFilterResult, key: string): { groupIdx: number, settingIdx: number, overallSettingIdx: number; } | undefined {
		let overallSettingIdx = 0;

		for (let groupIdx = 0; groupIdx < filterResult.filteredGroups.length; groupIdx++) {
			const group = filterResult.filteredGroups[groupIdx];
			for (let settingIdx = 0; settingIdx < group.sections[0].settings.length; settingIdx++) {
				const setting = group.sections[0].settings[settingIdx];
				if (key === setting.key) {
					return { groupIdx, settingIdx, overallSettingIdx };
				}

				overallSettingIdx++;
			}
		}

		return undefined;
	}

	private _consolidateSettings(editableSettingsGroups: ISettingsGroup[], defaultSettingsGroups: ISettingsGroup[]): ISetting[] {
		const defaultSettings = this._flatten(defaultSettingsGroups);
		const editableSettings = this._flatten(editableSettingsGroups).filter(secondarySetting => defaultSettings.every(primarySetting => primarySetting.key !== secondarySetting.key));
		return [...defaultSettings, ...editableSettings];
	}

	private _flatten(settingsGroups: ISettingsGroup[]): ISetting[] {
		const settings: ISetting[] = [];
		for (const group of settingsGroups) {
			for (const section of group.sections) {
				settings.push(...section.settings);
			}
		}

		return settings;
	}

	dispose(): void {
		dispose(this._defaultPreferencesRendererDisposables);
		dispose(this._editablePreferencesRendererDisposables);
		super.dispose();
	}
}

class SideBySidePreferencesWidget extends Widget {

	private dimension: DOM.Dimension = new DOM.Dimension(0, 0);

	private defaultPreferencesHeader: HTMLElement;
	private defaultPreferencesEditor: DefaultPreferencesEditor;
	private editablePreferencesEditor: BaseEditor | null = null;
	private defaultPreferencesEditorContainer: HTMLElement;
	private editablePreferencesEditorContainer: HTMLElement;

	private settingsTargetsWidget: SettingsTargetsWidget;

	private readonly _onFocus = this._register(new Emitter<void>());
	readonly onFocus: Event<void> = this._onFocus.event;

	private readonly _onDidSettingsTargetChange = this._register(new Emitter<SettingsTarget>());
	readonly onDidSettingsTargetChange: Event<SettingsTarget> = this._onDidSettingsTargetChange.event;

	private splitview: SplitView;

	private isVisible = false;
	private group: IEditorGroup | undefined;

	get minimumWidth(): number { return this.splitview.minimumSize; }
	get maximumWidth(): number { return this.splitview.maximumSize; }

	constructor(
		parentElement: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
	) {
		super();

		DOM.addClass(parentElement, 'side-by-side-preferences-editor');

		this.splitview = new SplitView(parentElement, { orientation: Orientation.HORIZONTAL });
		this._register(this.splitview);
		this._register(this.splitview.onDidSashReset(() => this.splitview.distributeViewSizes()));

		this.defaultPreferencesEditorContainer = DOM.$('.default-preferences-editor-container');

		const defaultPreferencesHeaderContainer = DOM.append(this.defaultPreferencesEditorContainer, DOM.$('.preferences-header-container'));
		this.defaultPreferencesHeader = DOM.append(defaultPreferencesHeaderContainer, DOM.$('div.default-preferences-header'));
		this.defaultPreferencesHeader.textContent = nls.localize('defaultSettings', "Default Settings");

		this.defaultPreferencesEditor = this._register(this.instantiationService.createInstance(DefaultPreferencesEditor));
		this.defaultPreferencesEditor.create(this.defaultPreferencesEditorContainer);

		this.splitview.addView({
			element: this.defaultPreferencesEditorContainer,
			layout: size => this.defaultPreferencesEditor.layout(new DOM.Dimension(size, this.dimension.height - 34 /* height of header container */)),
			minimumSize: 220,
			maximumSize: Number.POSITIVE_INFINITY,
			onDidChange: Event.None
		}, Sizing.Distribute);

		this.editablePreferencesEditorContainer = DOM.$('.editable-preferences-editor-container');
		const editablePreferencesHeaderContainer = DOM.append(this.editablePreferencesEditorContainer, DOM.$('.preferences-header-container'));
		this.settingsTargetsWidget = this._register(this.instantiationService.createInstance(SettingsTargetsWidget, editablePreferencesHeaderContainer, undefined));
		this._register(this.settingsTargetsWidget.onDidTargetChange(target => this._onDidSettingsTargetChange.fire(target)));

		this._register(attachStylerCallback(this.themeService, { scrollbarShadow }, colors => {
			const shadow = colors.scrollbarShadow ? colors.scrollbarShadow.toString() : null;

			this.editablePreferencesEditorContainer.style.boxShadow = shadow ? `-6px 0 5px -5px ${shadow}` : '';
		}));

		this.splitview.addView({
			element: this.editablePreferencesEditorContainer,
			layout: size => this.editablePreferencesEditor && this.editablePreferencesEditor.layout(new DOM.Dimension(size, this.dimension.height - 34 /* height of header container */)),
			minimumSize: 220,
			maximumSize: Number.POSITIVE_INFINITY,
			onDidChange: Event.None
		}, Sizing.Distribute);

		const focusTracker = this._register(DOM.trackFocus(parentElement));
		this._register(focusTracker.onDidFocus(() => this._onFocus.fire()));
	}

	setInput(defaultPreferencesEditorInput: DefaultPreferencesEditorInput, editablePreferencesEditorInput: EditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<{ defaultPreferencesRenderer?: IPreferencesRenderer<ISetting>, editablePreferencesRenderer?: IPreferencesRenderer<ISetting>; }> {
		this.getOrCreateEditablePreferencesEditor(editablePreferencesEditorInput);
		this.settingsTargetsWidget.settingsTarget = this.getSettingsTarget(editablePreferencesEditorInput.resource!);
		return Promise.all([
			this.updateInput(this.defaultPreferencesEditor, defaultPreferencesEditorInput, DefaultSettingsEditorContribution.ID, editablePreferencesEditorInput.resource!, options, token),
			this.updateInput(this.editablePreferencesEditor!, editablePreferencesEditorInput, SettingsEditorContribution.ID, defaultPreferencesEditorInput.resource!, options, token)
		])
			.then(([defaultPreferencesRenderer, editablePreferencesRenderer]) => {
				if (token.isCancellationRequested) {
					return {};
				}

				this.defaultPreferencesHeader.textContent = withUndefinedAsNull(defaultPreferencesRenderer && this.getDefaultPreferencesHeaderText((<DefaultSettingsEditorModel>defaultPreferencesRenderer.preferencesModel).target));
				return { defaultPreferencesRenderer, editablePreferencesRenderer };
			});
	}

	private getDefaultPreferencesHeaderText(target: ConfigurationTarget): string {
		switch (target) {
			case ConfigurationTarget.USER_LOCAL:
				return nls.localize('defaultUserSettings', "Default User Settings");
			case ConfigurationTarget.WORKSPACE:
				return nls.localize('defaultWorkspaceSettings', "Default Workspace Settings");
			case ConfigurationTarget.WORKSPACE_FOLDER:
				return nls.localize('defaultFolderSettings', "Default Folder Settings");
		}
		return '';
	}

	setResultCount(settingsTarget: SettingsTarget, count: number): void {
		this.settingsTargetsWidget.setResultCount(settingsTarget, count);
	}

	layout(dimension: DOM.Dimension = this.dimension): void {
		this.dimension = dimension;
		this.splitview.layout(dimension.width);
	}

	focus(): void {
		if (this.editablePreferencesEditor) {
			this.editablePreferencesEditor.focus();
		}
	}

	getControl(): IEditorControl | undefined {
		return this.editablePreferencesEditor ? this.editablePreferencesEditor.getControl() : undefined;
	}

	clearInput(): void {
		if (this.defaultPreferencesEditor) {
			this.defaultPreferencesEditor.clearInput();
		}
		if (this.editablePreferencesEditor) {
			this.editablePreferencesEditor.clearInput();
		}
	}

	setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		this.isVisible = visible;
		this.group = group;

		if (this.defaultPreferencesEditor) {
			this.defaultPreferencesEditor.setVisible(this.isVisible, this.group);
		}
		if (this.editablePreferencesEditor) {
			this.editablePreferencesEditor.setVisible(this.isVisible, this.group);
		}
	}

	private getOrCreateEditablePreferencesEditor(editorInput: EditorInput): BaseEditor {
		if (this.editablePreferencesEditor) {
			return this.editablePreferencesEditor;
		}
		const descriptor = Registry.as<IEditorRegistry>(EditorExtensions.Editors).getEditor(editorInput);
		const editor = descriptor!.instantiate(this.instantiationService);
		this.editablePreferencesEditor = editor;
		this.editablePreferencesEditor.create(this.editablePreferencesEditorContainer);
		this.editablePreferencesEditor.setVisible(this.isVisible, this.group);
		this.layout();

		return editor;
	}

	private updateInput(editor: BaseEditor, input: EditorInput, editorContributionId: string, associatedPreferencesModelUri: URI, options: EditorOptions | undefined, token: CancellationToken): Promise<IPreferencesRenderer<ISetting> | undefined> {
		return editor.setInput(input, options, token)
			.then<any>(() => {
				if (token.isCancellationRequested) {
					return undefined;
				}

				return withNullAsUndefined((<CodeEditorWidget>editor.getControl()).getContribution<ISettingsEditorContribution>(editorContributionId).updatePreferencesRenderer(associatedPreferencesModelUri));
			});
	}

	private getSettingsTarget(resource: URI): SettingsTarget {
		if (this.preferencesService.userSettingsResource.toString() === resource.toString()) {
			return ConfigurationTarget.USER_LOCAL;
		}

		const workspaceSettingsResource = this.preferencesService.workspaceSettingsResource;
		if (workspaceSettingsResource && workspaceSettingsResource.toString() === resource.toString()) {
			return ConfigurationTarget.WORKSPACE;
		}

		const folder = this.workspaceContextService.getWorkspaceFolder(resource);
		if (folder) {
			return folder.uri;
		}

		return ConfigurationTarget.USER_LOCAL;
	}

	private disposeEditors(): void {
		if (this.defaultPreferencesEditor) {
			this.defaultPreferencesEditor.dispose();
		}
		if (this.editablePreferencesEditor) {
			this.editablePreferencesEditor.dispose();
		}
	}

	dispose(): void {
		this.disposeEditors();
		super.dispose();
	}
}

export class DefaultPreferencesEditor extends BaseTextEditor {

	static readonly ID: string = 'workbench.editor.defaultPreferences';

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService configurationService: ITextResourceConfigurationService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService
	) {
		super(DefaultPreferencesEditor.ID, telemetryService, instantiationService, storageService, configurationService, themeService, editorService, editorGroupService);
	}

	private static _getContributions(): IEditorContributionDescription[] {
		const skipContributions = [FoldingController.ID, SelectionHighlighter.ID, FindController.ID];
		const contributions = EditorExtensionsRegistry.getEditorContributions().filter(c => skipContributions.indexOf(c.id) === -1);
		contributions.push({ id: DefaultSettingsEditorContribution.ID, ctor: DefaultSettingsEditorContribution as IConstructorSignature1<ICodeEditor, editorCommon.IEditorContribution> });
		return contributions;
	}

	createEditorControl(parent: HTMLElement, configuration: IEditorOptions): editorCommon.IEditor {
		const editor = this.instantiationService.createInstance(CodeEditorWidget, parent, configuration, { contributions: DefaultPreferencesEditor._getContributions() });

		// Inform user about editor being readonly if user starts type
		this._register(editor.onDidType(() => this.showReadonlyHint(editor)));
		this._register(editor.onDidPaste(() => this.showReadonlyHint(editor)));

		return editor;
	}

	private showReadonlyHint(editor: ICodeEditor): void {
		const messageController = MessageController.get(editor);
		if (!messageController.isVisible()) {
			messageController.showMessage(nls.localize('defaultEditorReadonly', "Edit in the right hand side editor to override defaults."), editor.getSelection()!.getPosition());
		}
	}

	protected getConfigurationOverrides(): IEditorOptions {
		const options = super.getConfigurationOverrides();
		options.readOnly = true;
		if (this.input) {
			options.lineNumbers = 'off';
			options.renderLineHighlight = 'none';
			options.scrollBeyondLastLine = false;
			options.folding = false;
			options.renderWhitespace = 'none';
			options.wordWrap = 'on';
			options.renderIndentGuides = false;
			options.rulers = [];
			options.glyphMargin = true;
			options.minimap = {
				enabled: false
			};
			options.renderValidationDecorations = 'editable';
		}
		return options;
	}

	setInput(input: DefaultPreferencesEditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {
		return super.setInput(input, options, token)
			.then(() => this.input!.resolve()
				.then<any>(editorModel => {
					if (token.isCancellationRequested) {
						return undefined;
					}

					return editorModel!.load();
				})
				.then(editorModel => {
					if (token.isCancellationRequested) {
						return;
					}

					const editor = assertIsDefined(this.getControl());
					editor.setModel((<ResourceEditorModel>editorModel).textEditorModel);
				}));
	}

	clearInput(): void {
		// Clear Model
		const editor = this.getControl();
		if (editor) {
			editor.setModel(null);
		}

		// Pass to super
		super.clearInput();
	}

	layout(dimension: DOM.Dimension) {
		const editor = assertIsDefined(this.getControl());
		editor.layout(dimension);
	}

	protected getAriaLabel(): string {
		return nls.localize('preferencesAriaLabel', "Default preferences. Readonly.");
	}
}

interface ISettingsEditorContribution extends editorCommon.IEditorContribution {

	updatePreferencesRenderer(associatedPreferencesModelUri: URI): Promise<IPreferencesRenderer<ISetting> | null>;

}

abstract class AbstractSettingsEditorContribution extends Disposable implements ISettingsEditorContribution {

	private preferencesRendererCreationPromise: Promise<IPreferencesRenderer<ISetting> | null> | null = null;

	constructor(protected editor: ICodeEditor,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IPreferencesService protected preferencesService: IPreferencesService,
		@IWorkspaceContextService protected workspaceContextService: IWorkspaceContextService
	) {
		super();
		this._register(this.editor.onDidChangeModel(() => this._onModelChanged()));
	}

	updatePreferencesRenderer(associatedPreferencesModelUri: URI): Promise<IPreferencesRenderer<ISetting> | null> {
		if (!this.preferencesRendererCreationPromise) {
			this.preferencesRendererCreationPromise = this._createPreferencesRenderer();
		}

		if (this.preferencesRendererCreationPromise) {
			return this._hasAssociatedPreferencesModelChanged(associatedPreferencesModelUri)
				.then(changed => changed ? this._updatePreferencesRenderer(associatedPreferencesModelUri) : this.preferencesRendererCreationPromise);
		}

		return Promise.resolve(null);
	}

	protected _onModelChanged(): void {
		const model = this.editor.getModel();
		this.disposePreferencesRenderer();
		if (model) {
			this.preferencesRendererCreationPromise = this._createPreferencesRenderer();
		}
	}

	private _hasAssociatedPreferencesModelChanged(associatedPreferencesModelUri: URI): Promise<boolean> {
		return this.preferencesRendererCreationPromise!.then(preferencesRenderer => {
			return !(preferencesRenderer && preferencesRenderer.getAssociatedPreferencesModel() && preferencesRenderer.getAssociatedPreferencesModel().uri!.toString() === associatedPreferencesModelUri.toString());
		});
	}

	private _updatePreferencesRenderer(associatedPreferencesModelUri: URI): Promise<IPreferencesRenderer<ISetting> | null> {
		return this.preferencesService.createPreferencesEditorModel<ISetting>(associatedPreferencesModelUri)
			.then(associatedPreferencesEditorModel => {
				if (associatedPreferencesEditorModel) {
					return this.preferencesRendererCreationPromise!.then(preferencesRenderer => {
						if (preferencesRenderer) {
							const associatedPreferencesModel = preferencesRenderer.getAssociatedPreferencesModel();
							if (associatedPreferencesModel) {
								associatedPreferencesModel.dispose();
							}
							preferencesRenderer.setAssociatedPreferencesModel(associatedPreferencesEditorModel);
						}
						return preferencesRenderer;
					});
				}
				return null;
			});
	}

	private disposePreferencesRenderer(): void {
		if (this.preferencesRendererCreationPromise) {
			this.preferencesRendererCreationPromise.then(preferencesRenderer => {
				if (preferencesRenderer) {
					const associatedPreferencesModel = preferencesRenderer.getAssociatedPreferencesModel();
					if (associatedPreferencesModel) {
						associatedPreferencesModel.dispose();
					}
					preferencesRenderer.preferencesModel.dispose();
					preferencesRenderer.dispose();
				}
			});
			this.preferencesRendererCreationPromise = Promise.resolve(null);
		}
	}

	dispose() {
		this.disposePreferencesRenderer();
		super.dispose();
	}

	protected abstract _createPreferencesRenderer(): Promise<IPreferencesRenderer<ISetting> | null> | null;
}

export class DefaultSettingsEditorContribution extends AbstractSettingsEditorContribution implements ISettingsEditorContribution {

	static readonly ID: string = 'editor.contrib.defaultsettings';

	protected _createPreferencesRenderer(): Promise<IPreferencesRenderer<ISetting> | null> | null {
		return this.preferencesService.createPreferencesEditorModel(this.editor.getModel()!.uri)
			.then<any>(editorModel => {
				if (editorModel instanceof DefaultSettingsEditorModel && this.editor.getModel()) {
					const preferencesRenderer = this.instantiationService.createInstance(DefaultSettingsRenderer, this.editor, editorModel);
					preferencesRenderer.render();
					return preferencesRenderer;
				}
				return null;
			});
	}
}

class SettingsEditorContribution extends AbstractSettingsEditorContribution implements ISettingsEditorContribution {

	static readonly ID: string = 'editor.contrib.settings';

	constructor(editor: ICodeEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IPreferencesService preferencesService: IPreferencesService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService
	) {
		super(editor, instantiationService, preferencesService, workspaceContextService);
		this._register(this.workspaceContextService.onDidChangeWorkbenchState(() => this._onModelChanged()));
	}

	protected _createPreferencesRenderer(): Promise<IPreferencesRenderer<ISetting> | null> | null {
		const model = this.editor.getModel();
		if (model) {
			return this.preferencesService.createPreferencesEditorModel(model.uri)
				.then<any>(settingsModel => {
					if (settingsModel instanceof SettingsEditorModel && this.editor.getModel()) {
						switch (settingsModel.configurationTarget) {
							case ConfigurationTarget.USER_LOCAL:
							case ConfigurationTarget.USER_REMOTE:
								return this.instantiationService.createInstance(UserSettingsRenderer, this.editor, settingsModel);
							case ConfigurationTarget.WORKSPACE:
								return this.instantiationService.createInstance(WorkspaceSettingsRenderer, this.editor, settingsModel);
							case ConfigurationTarget.WORKSPACE_FOLDER:
								return this.instantiationService.createInstance(FolderSettingsRenderer, this.editor, settingsModel);
						}
					}
					return null;
				})
				.then(preferencesRenderer => {
					if (preferencesRenderer) {
						preferencesRenderer.render();
					}
					return preferencesRenderer;
				});
		}
		return null;
	}
}

registerEditorContribution(SettingsEditorContribution.ID, SettingsEditorContribution);
