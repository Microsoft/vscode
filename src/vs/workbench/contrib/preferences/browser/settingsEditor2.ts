/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { Button } from 'vs/base/browser/ui/button/button';
import { ITreeElement } from 'vs/base/browser/ui/tree/tree';
import { Action } from 'vs/base/common/actions';
import * as arrays from 'vs/base/common/arrays';
import { Delayer, ThrottledDelayer, timeout, IntervalTimer } from 'vs/base/common/async';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import * as collections from 'vs/base/common/collections';
import { getErrorMessage, isPromiseCanceledError } from 'vs/base/common/errors';
import { Iterable } from 'vs/base/common/iterator';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import * as strings from 'vs/base/common/strings';
import { isArray, withNullAsUndefined, withUndefinedAsNull } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/settingsEditor2';
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ConfigurationTarget, IConfigurationOverrides, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IEditorModel } from 'vs/platform/editor/common/editor';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IProductService } from 'vs/platform/product/common/productService';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { badgeBackground, badgeForeground, contrastBorder, editorForeground } from 'vs/platform/theme/common/colorRegistry';
import { attachStylerCallback } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { getUserDataSyncStore, IUserDataSyncService, SyncStatus, IUserDataSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { IEditorMemento, IEditorPane } from 'vs/workbench/common/editor';
import { attachSuggestEnabledInputBoxStyler, SuggestEnabledInput } from 'vs/workbench/contrib/codeEditor/browser/suggestEnabledInput/suggestEnabledInput';
import { SettingsTarget, SettingsTargetsWidget } from 'vs/workbench/contrib/preferences/browser/preferencesWidgets';
import { commonlyUsedData, tocData } from 'vs/workbench/contrib/preferences/browser/settingsLayout';
import { AbstractSettingRenderer, ISettingLinkClickEvent, ISettingOverrideClickEvent, resolveExtensionsSettings, resolveSettingsTree, SettingsTree, SettingTreeRenderers } from 'vs/workbench/contrib/preferences/browser/settingsTree';
import { ISettingsEditorViewState, parseQuery, SearchResultIdx, SearchResultModel, SettingsTreeElement, SettingsTreeGroupChild, SettingsTreeGroupElement, SettingsTreeModel, SettingsTreeSettingElement } from 'vs/workbench/contrib/preferences/browser/settingsTreeModels';
import { settingsTextInputBorder } from 'vs/workbench/contrib/preferences/browser/settingsWidgets';
import { createTOCIterator, TOCTree, TOCTreeModel } from 'vs/workbench/contrib/preferences/browser/tocTree';
import { CONTEXT_SETTINGS_EDITOR, CONTEXT_SETTINGS_SEARCH_FOCUS, CONTEXT_TOC_ROW_FOCUS, EXTENSION_SETTING_TAG, IPreferencesSearchService, ISearchProvider, MODIFIED_SETTING_TAG, SETTINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS, SETTINGS_EDITOR_COMMAND_SHOW_CONTEXT_MENU } from 'vs/workbench/contrib/preferences/common/preferences';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IPreferencesService, ISearchResult, ISettingsEditorModel, ISettingsEditorOptions, SettingsEditorOptions, SettingValueType } from 'vs/workbench/services/preferences/common/preferences';
import { SettingsEditor2Input } from 'vs/workbench/services/preferences/common/preferencesEditorInput';
import { Settings2EditorModel } from 'vs/workbench/services/preferences/common/preferencesModels';
import { fromNow } from 'vs/base/common/date';
import { Emitter } from 'vs/base/common/event';

function createGroupIterator(group: SettingsTreeGroupElement): Iterable<ITreeElement<SettingsTreeGroupChild>> {
	return Iterable.map(group.children, g => {
		return {
			element: g,
			children: g instanceof SettingsTreeGroupElement ?
				createGroupIterator(g) :
				undefined
		};
	});
}

const $ = DOM.$;

interface IFocusEventFromScroll extends KeyboardEvent {
	fromScroll: true;
}

const searchBoxLabel = localize('SearchSettings.AriaLabel', "Search settings");

const SETTINGS_AUTOSAVE_NOTIFIED_KEY = 'hasNotifiedOfSettingsAutosave';
const SETTINGS_EDITOR_STATE_KEY = 'settingsEditorState';
export class SettingsEditor2 extends BaseEditor {

	static readonly ID: string = 'workbench.editor.settings2';
	private static NUM_INSTANCES: number = 0;
	private static SETTING_UPDATE_FAST_DEBOUNCE: number = 200;
	private static SETTING_UPDATE_SLOW_DEBOUNCE: number = 1000;
	private static CONFIG_SCHEMA_UPDATE_DELAYER = 500;

	private static readonly SUGGESTIONS: string[] = [
		`@${MODIFIED_SETTING_TAG}`, '@tag:usesOnlineServices', '@tag:sync', `@${EXTENSION_SETTING_TAG}`
	];

	private static shouldSettingUpdateFast(type: SettingValueType | SettingValueType[]): boolean {
		if (isArray(type)) {
			// nullable integer/number or complex
			return false;
		}
		return type === SettingValueType.Enum ||
			type === SettingValueType.ArrayOfString ||
			type === SettingValueType.Complex ||
			type === SettingValueType.Boolean ||
			type === SettingValueType.Exclude;
	}

	// (!) Lots of props that are set once on the first render
	private defaultSettingsEditorModel!: Settings2EditorModel;

	private rootElement!: HTMLElement;
	private headerContainer!: HTMLElement;
	private searchWidget!: SuggestEnabledInput;
	private countElement!: HTMLElement;
	private controlsElement!: HTMLElement;
	private settingsTargetsWidget!: SettingsTargetsWidget;

	private settingsTreeContainer!: HTMLElement;
	private settingsTree!: SettingsTree;
	private settingRenderers!: SettingTreeRenderers;
	private tocTreeModel!: TOCTreeModel;
	private settingsTreeModel!: SettingsTreeModel;
	private noResultsMessage!: HTMLElement;
	private clearFilterLinkContainer!: HTMLElement;

	private tocTreeContainer!: HTMLElement;
	private tocTree!: TOCTree;

	private settingsAriaExtraLabelsContainer!: HTMLElement;

	private delayedFilterLogging: Delayer<void>;
	private localSearchDelayer: Delayer<void>;
	private remoteSearchThrottle: ThrottledDelayer<void>;
	private searchInProgress: CancellationTokenSource | null = null;

	private updatedConfigSchemaDelayer: Delayer<void>;

	private settingFastUpdateDelayer: Delayer<void>;
	private settingSlowUpdateDelayer: Delayer<void>;
	private pendingSettingUpdate: { key: string, value: any } | null = null;

	private readonly viewState: ISettingsEditorViewState;
	private _searchResultModel: SearchResultModel | null = null;

	private tocRowFocused: IContextKey<boolean>;
	private inSettingsEditorContextKey: IContextKey<boolean>;
	private searchFocusContextKey: IContextKey<boolean>;

	private scheduledRefreshes: Map<string, DOM.IFocusTracker>;
	private lastFocusedSettingElement: string | null = null;

	/** Don't spam warnings */
	private hasWarnedMissingSettings = false;

	private editorMemento: IEditorMemento<ISettingsEditor2State>;

	private tocFocusedElement: SettingsTreeGroupElement | null = null;
	private settingsTreeScrollTop = 0;
	private dimension!: DOM.Dimension;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IThemeService themeService: IThemeService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IPreferencesSearchService private readonly preferencesSearchService: IPreferencesSearchService,
		@ILogService private readonly logService: ILogService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorGroupsService protected editorGroupService: IEditorGroupsService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
		@IProductService private readonly productService: IProductService,
	) {
		super(SettingsEditor2.ID, telemetryService, themeService, storageService);
		this.delayedFilterLogging = new Delayer<void>(1000);
		this.localSearchDelayer = new Delayer(300);
		this.remoteSearchThrottle = new ThrottledDelayer(200);
		this.viewState = { settingsTarget: ConfigurationTarget.USER_LOCAL };

		this.settingFastUpdateDelayer = new Delayer<void>(SettingsEditor2.SETTING_UPDATE_FAST_DEBOUNCE);
		this.settingSlowUpdateDelayer = new Delayer<void>(SettingsEditor2.SETTING_UPDATE_SLOW_DEBOUNCE);

		this.updatedConfigSchemaDelayer = new Delayer<void>(SettingsEditor2.CONFIG_SCHEMA_UPDATE_DELAYER);

		this.inSettingsEditorContextKey = CONTEXT_SETTINGS_EDITOR.bindTo(contextKeyService);
		this.searchFocusContextKey = CONTEXT_SETTINGS_SEARCH_FOCUS.bindTo(contextKeyService);
		this.tocRowFocused = CONTEXT_TOC_ROW_FOCUS.bindTo(contextKeyService);

		this.scheduledRefreshes = new Map<string, DOM.IFocusTracker>();

		this.editorMemento = this.getEditorMemento<ISettingsEditor2State>(editorGroupService, SETTINGS_EDITOR_STATE_KEY);

		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.source !== ConfigurationTarget.DEFAULT) {
				this.onConfigUpdate(e.affectedKeys);
			}
		}));

		storageKeysSyncRegistryService.registerStorageKey({ key: SETTINGS_AUTOSAVE_NOTIFIED_KEY, version: 1 });
	}

	get minimumWidth(): number { return 375; }
	get maximumWidth(): number { return Number.POSITIVE_INFINITY; }

	// these setters need to exist because this extends from BaseEditor
	set minimumWidth(value: number) { /*noop*/ }
	set maximumWidth(value: number) { /*noop*/ }

	private get currentSettingsModel() {
		return this.searchResultModel || this.settingsTreeModel;
	}

	private get searchResultModel(): SearchResultModel | null {
		return this._searchResultModel;
	}

	private set searchResultModel(value: SearchResultModel | null) {
		this._searchResultModel = value;

		DOM.toggleClass(this.rootElement, 'search-mode', !!this._searchResultModel);
	}

	private get currentSettingsContextMenuKeyBindingLabel(): string {
		const keybinding = this.keybindingService.lookupKeybinding(SETTINGS_EDITOR_COMMAND_SHOW_CONTEXT_MENU);
		return (keybinding && keybinding.getAriaLabel()) || '';
	}

	createEditor(parent: HTMLElement): void {
		parent.setAttribute('tabindex', '-1');
		this.rootElement = DOM.append(parent, $('.settings-editor', { tabindex: '-1' }));

		this.createHeader(this.rootElement);
		this.createBody(this.rootElement);
		this.addCtrlAInterceptor(this.rootElement);
		this.updateStyles();
	}

	setInput(input: SettingsEditor2Input, options: SettingsEditorOptions | undefined, token: CancellationToken): Promise<void> {
		this.inSettingsEditorContextKey.set(true);
		return super.setInput(input, options, token)
			.then(() => timeout(0)) // Force setInput to be async
			.then(() => {
				// Don't block setInput on render (which can trigger an async search)
				this.render(token).then(() => {
					options = options || SettingsEditorOptions.create({});

					if (!this.viewState.settingsTarget) {
						if (!options.target) {
							options.target = ConfigurationTarget.USER_LOCAL;
						}
					}

					this._setOptions(options);

					this._register(input.onDispose(() => {
						this.searchWidget.setValue('');
					}));

					// Init TOC selection
					this.updateTreeScrollSync();
				});
			});
	}

	private restoreCachedState(): ISettingsEditor2State | null {
		const cachedState = this.group && this.input && this.editorMemento.loadEditorState(this.group, this.input);
		if (cachedState && typeof cachedState.target === 'object') {
			cachedState.target = URI.revive(cachedState.target);
		}

		if (cachedState) {
			const settingsTarget = cachedState.target;
			this.settingsTargetsWidget.settingsTarget = settingsTarget;
			this.viewState.settingsTarget = settingsTarget;
			this.searchWidget.setValue(cachedState.searchQuery);
		}

		if (this.input) {
			this.editorMemento.clearEditorState(this.input, this.group);
		}

		return withUndefinedAsNull(cachedState);
	}

	setOptions(options: SettingsEditorOptions | undefined): void {
		super.setOptions(options);

		if (options) {
			this._setOptions(options);
		}
	}

	private _setOptions(options: SettingsEditorOptions): void {
		if (options.query) {
			this.searchWidget.setValue(options.query);
		}

		const target: SettingsTarget = options.folderUri || <SettingsTarget>options.target;
		if (target) {
			this.settingsTargetsWidget.settingsTarget = target;
			this.viewState.settingsTarget = target;
		}
	}

	clearInput(): void {
		this.inSettingsEditorContextKey.set(false);
		super.clearInput();
	}

	layout(dimension: DOM.Dimension): void {
		this.dimension = dimension;

		if (!this.isVisible()) {
			return;
		}

		this.layoutTrees(dimension);

		const innerWidth = Math.min(1000, dimension.width) - 24 * 2; // 24px padding on left and right;
		// minus padding inside inputbox, countElement width, controls width, extra padding before countElement
		const monacoWidth = innerWidth - 10 - this.countElement.clientWidth - this.controlsElement.clientWidth - 12;
		this.searchWidget.layout({ height: 20, width: monacoWidth });

		DOM.toggleClass(this.rootElement, 'mid-width', dimension.width < 1000 && dimension.width >= 600);
		DOM.toggleClass(this.rootElement, 'narrow-width', dimension.width < 600);
	}

	focus(): void {
		if (this.lastFocusedSettingElement) {
			const elements = this.settingRenderers.getDOMElementsForSettingKey(this.settingsTree.getHTMLElement(), this.lastFocusedSettingElement);
			if (elements.length) {
				const control = elements[0].querySelector(AbstractSettingRenderer.CONTROL_SELECTOR);
				if (control) {
					(<HTMLElement>control).focus();
					return;
				}
			}
		}

		this.focusSearch();
	}

	onHide(): void {
		this.searchWidget.onHide();
	}

	focusSettings(): void {
		// Update ARIA global labels
		const labelElement = this.settingsAriaExtraLabelsContainer.querySelector('#settings_aria_more_actions_shortcut_label');
		if (labelElement) {
			const settingsContextMenuShortcut = this.currentSettingsContextMenuKeyBindingLabel;
			if (settingsContextMenuShortcut) {
				labelElement.setAttribute('aria-label', localize('settingsContextMenuAriaShortcut', "For more actions, Press {0}.", settingsContextMenuShortcut));
			}
		}

		const firstFocusable = this.settingsTree.getHTMLElement().querySelector(AbstractSettingRenderer.CONTROL_SELECTOR);
		if (firstFocusable) {
			(<HTMLElement>firstFocusable).focus();
		}
	}

	focusTOC(): void {
		this.tocTree.domFocus();
	}

	showContextMenu(): void {
		const activeElement = this.getActiveElementInSettingsTree();
		if (!activeElement) {
			return;
		}

		const settingDOMElement = this.settingRenderers.getSettingDOMElementForDOMElement(activeElement);
		if (!settingDOMElement) {
			return;
		}

		const focusedKey = this.settingRenderers.getKeyForDOMElementInSetting(settingDOMElement);
		if (!focusedKey) {
			return;
		}

		const elements = this.currentSettingsModel.getElementsByName(focusedKey);
		if (elements && elements[0]) {
			this.settingRenderers.showContextMenu(elements[0], settingDOMElement);
		}
	}

	focusSearch(filter?: string, selectAll = true): void {
		if (filter && this.searchWidget) {
			this.searchWidget.setValue(filter);
		}

		this.searchWidget.focus(selectAll);
	}

	clearSearchResults(): void {
		this.searchWidget.setValue('');
		this.focusSearch();
	}

	clearSearchFilters(): void {
		let query = this.searchWidget.getValue();

		SettingsEditor2.SUGGESTIONS.forEach(suggestion => {
			query = query.replace(suggestion, '');
		});

		this.searchWidget.setValue(query.trim());
	}

	private updateInputAriaLabel(lastSyncedLabel: string) {
		const label = lastSyncedLabel ?
			`${searchBoxLabel}. ${lastSyncedLabel}` :
			searchBoxLabel;
		this.searchWidget.updateAriaLabel(label);
	}

	private createHeader(parent: HTMLElement): void {
		this.headerContainer = DOM.append(parent, $('.settings-header'));

		const searchContainer = DOM.append(this.headerContainer, $('.search-container'));

		const clearInputAction = new Action(SETTINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS, localize('clearInput', "Clear Settings Search Input"), 'codicon-clear-all', false, () => { this.clearSearchResults(); return Promise.resolve(null); });

		this.searchWidget = this._register(this.instantiationService.createInstance(SuggestEnabledInput, `${SettingsEditor2.ID}.searchbox`, searchContainer, {
			triggerCharacters: ['@'],
			provideResults: (query: string) => {
				return SettingsEditor2.SUGGESTIONS.filter(tag => query.indexOf(tag) === -1).map(tag => strings.endsWith(tag, ':') ? tag : tag + ' ');
			}
		}, searchBoxLabel, 'settingseditor:searchinput' + SettingsEditor2.NUM_INSTANCES++, {
			placeholderText: searchBoxLabel,
			focusContextKey: this.searchFocusContextKey,
			// TODO: Aria-live
		})
		);

		this._register(this.searchWidget.onFocus(() => {
			this.lastFocusedSettingElement = '';
		}));

		this._register(attachSuggestEnabledInputBoxStyler(this.searchWidget, this.themeService, {
			inputBorder: settingsTextInputBorder
		}));

		this.countElement = DOM.append(searchContainer, DOM.$('.settings-count-widget.monaco-count-badge.long'));
		this._register(attachStylerCallback(this.themeService, { badgeBackground, contrastBorder, badgeForeground }, colors => {
			const background = colors.badgeBackground ? colors.badgeBackground.toString() : '';
			const border = colors.contrastBorder ? colors.contrastBorder.toString() : '';
			const foreground = colors.badgeForeground ? colors.badgeForeground.toString() : '';

			this.countElement.style.backgroundColor = background;
			this.countElement.style.color = foreground;

			this.countElement.style.borderWidth = border ? '1px' : '';
			this.countElement.style.borderStyle = border ? 'solid' : '';
			this.countElement.style.borderColor = border;
		}));

		this._register(this.searchWidget.onInputDidChange(() => {
			const searchVal = this.searchWidget.getValue();
			clearInputAction.enabled = !!searchVal;
			this.onSearchInputChanged();
		}));

		const headerControlsContainer = DOM.append(this.headerContainer, $('.settings-header-controls'));
		const targetWidgetContainer = DOM.append(headerControlsContainer, $('.settings-target-container'));
		this.settingsTargetsWidget = this._register(this.instantiationService.createInstance(SettingsTargetsWidget, targetWidgetContainer, { enableRemoteSettings: true }));
		this.settingsTargetsWidget.settingsTarget = ConfigurationTarget.USER_LOCAL;
		this.settingsTargetsWidget.onDidTargetChange(target => this.onDidSettingsTargetChange(target));

		if (syncAllowed(this.productService, this.configurationService)) {
			const syncControls = this._register(this.instantiationService.createInstance(SyncControls, headerControlsContainer));
			this._register(syncControls.onDidChangeLastSyncedLabel(lastSyncedLabel => this.updateInputAriaLabel(lastSyncedLabel)));
		}

		this.controlsElement = DOM.append(searchContainer, DOM.$('.settings-clear-widget'));

		const actionBar = this._register(new ActionBar(this.controlsElement, {
			animated: false,
			actionViewItemProvider: (_action) => { return undefined; }
		}));

		actionBar.push([clearInputAction], { label: false, icon: true });
	}

	private onDidSettingsTargetChange(target: SettingsTarget): void {
		this.viewState.settingsTarget = target;

		// TODO Instead of rebuilding the whole model, refresh and uncache the inspected setting value
		this.onConfigUpdate(undefined, true);
	}

	private onDidClickSetting(evt: ISettingLinkClickEvent, recursed?: boolean): void {
		const elements = this.currentSettingsModel.getElementsByName(evt.targetKey);
		if (elements && elements[0]) {
			let sourceTop = 0.5;
			try {
				const _sourceTop = this.settingsTree.getRelativeTop(evt.source);
				if (_sourceTop !== null) {
					sourceTop = _sourceTop;
				}
			} catch {
				// e.g. clicked a searched element, now the search has been cleared
			}

			this.settingsTree.reveal(elements[0], sourceTop);

			const domElements = this.settingRenderers.getDOMElementsForSettingKey(this.settingsTree.getHTMLElement(), evt.targetKey);
			if (domElements && domElements[0]) {
				const control = domElements[0].querySelector(AbstractSettingRenderer.CONTROL_SELECTOR);
				if (control) {
					(<HTMLElement>control).focus();
				}
			}
		} else if (!recursed) {
			const p = this.triggerSearch('');
			p.then(() => {
				this.searchWidget.setValue('');
				this.onDidClickSetting(evt, true);
			});
		}
	}

	switchToSettingsFile(): Promise<IEditorPane | undefined> {
		const query = parseQuery(this.searchWidget.getValue()).query;
		return this.openSettingsFile({ query });
	}

	private async openSettingsFile(options?: ISettingsEditorOptions): Promise<IEditorPane | undefined> {
		const currentSettingsTarget = this.settingsTargetsWidget.settingsTarget;

		if (currentSettingsTarget === ConfigurationTarget.USER_LOCAL) {
			return this.preferencesService.openGlobalSettings(true, options);
		} else if (currentSettingsTarget === ConfigurationTarget.USER_REMOTE) {
			return this.preferencesService.openRemoteSettings();
		} else if (currentSettingsTarget === ConfigurationTarget.WORKSPACE) {
			return this.preferencesService.openWorkspaceSettings(true, options);
		} else if (URI.isUri(currentSettingsTarget)) {
			return this.preferencesService.openFolderSettings(currentSettingsTarget, true, options);
		}

		return undefined;
	}

	private createBody(parent: HTMLElement): void {
		const bodyContainer = DOM.append(parent, $('.settings-body'));

		this.noResultsMessage = DOM.append(bodyContainer, $('.no-results-message'));

		this.noResultsMessage.innerText = localize('noResults', "No Settings Found");

		this.clearFilterLinkContainer = $('span.clear-search-filters');

		this.clearFilterLinkContainer.textContent = ' - ';
		const clearFilterLink = DOM.append(this.clearFilterLinkContainer, $('a.pointer.prominent', { tabindex: 0 }, localize('clearSearchFilters', 'Clear Filters')));
		this._register(DOM.addDisposableListener(clearFilterLink, DOM.EventType.CLICK, (e: MouseEvent) => {
			DOM.EventHelper.stop(e, false);
			this.clearSearchFilters();
		}));

		DOM.append(this.noResultsMessage, this.clearFilterLinkContainer);

		this._register(attachStylerCallback(this.themeService, { editorForeground }, colors => {
			this.noResultsMessage.style.color = colors.editorForeground ? colors.editorForeground.toString() : '';
		}));

		this.createTOC(bodyContainer);

		this.createFocusSink(
			bodyContainer,
			e => {
				if (DOM.findParentWithClass(e.relatedTarget, 'settings-editor-tree')) {
					if (this.settingsTree.scrollTop > 0) {
						const firstElement = this.settingsTree.firstVisibleElement;

						if (typeof firstElement !== 'undefined') {
							this.settingsTree.reveal(firstElement, 0.1);
						}

						return true;
					}
				} else {
					const firstControl = this.settingsTree.getHTMLElement().querySelector(AbstractSettingRenderer.CONTROL_SELECTOR);
					if (firstControl) {
						(<HTMLElement>firstControl).focus();
					}
				}

				return false;
			},
			'settings list focus helper');

		this.createSettingsTree(bodyContainer);

		this.createFocusSink(
			bodyContainer,
			e => {
				if (DOM.findParentWithClass(e.relatedTarget, 'settings-editor-tree')) {
					if (this.settingsTree.scrollTop < this.settingsTree.scrollHeight) {
						const lastElement = this.settingsTree.lastVisibleElement;
						this.settingsTree.reveal(lastElement, 0.9);
						return true;
					}
				}

				return false;
			},
			'settings list focus helper'
		);
	}

	private addCtrlAInterceptor(container: HTMLElement): void {
		this._register(DOM.addStandardDisposableListener(container, DOM.EventType.KEY_DOWN, (e: StandardKeyboardEvent) => {
			if (
				e.keyCode === KeyCode.KEY_A &&
				(platform.isMacintosh ? e.metaKey : e.ctrlKey) &&
				e.target.tagName !== 'TEXTAREA' &&
				e.target.tagName !== 'INPUT'
			) {
				// Avoid browser ctrl+a
				e.browserEvent.stopPropagation();
				e.browserEvent.preventDefault();
			}
		}));
	}

	private createFocusSink(container: HTMLElement, callback: (e: any) => boolean, label: string): HTMLElement {
		const listFocusSink = DOM.append(container, $('.settings-tree-focus-sink'));
		listFocusSink.setAttribute('aria-label', label);
		listFocusSink.tabIndex = 0;
		this._register(DOM.addDisposableListener(listFocusSink, 'focus', (e: any) => {
			if (e.relatedTarget && callback(e)) {
				e.relatedTarget.focus();
			}
		}));

		return listFocusSink;
	}

	private createTOC(parent: HTMLElement): void {
		this.tocTreeModel = this.instantiationService.createInstance(TOCTreeModel, this.viewState);
		this.tocTreeContainer = DOM.append(parent, $('.settings-toc-container'));

		this.tocTree = this._register(this.instantiationService.createInstance(TOCTree,
			DOM.append(this.tocTreeContainer, $('.settings-toc-wrapper')),
			this.viewState));

		this._register(this.tocTree.onDidChangeFocus(e => {
			const element: SettingsTreeGroupElement | null = e.elements[0];
			if (this.tocFocusedElement === element) {
				return;
			}

			this.tocFocusedElement = element;
			this.tocTree.setSelection(element ? [element] : []);
			if (this.searchResultModel) {
				if (this.viewState.filterToCategory !== element) {
					this.viewState.filterToCategory = withNullAsUndefined(element);
					this.renderTree();
					this.settingsTree.scrollTop = 0;
				}
			} else if (element && (!e.browserEvent || !(<IFocusEventFromScroll>e.browserEvent).fromScroll)) {
				this.settingsTree.reveal(element, 0);
			}
		}));

		this._register(this.tocTree.onDidFocus(() => {
			this.tocRowFocused.set(true);
		}));

		this._register(this.tocTree.onDidBlur(() => {
			this.tocRowFocused.set(false);
		}));
	}

	private createSettingsTree(parent: HTMLElement): void {
		this.settingsTreeContainer = DOM.append(parent, $('.settings-tree-container'));

		// Add  ARIA extra labels div
		this.settingsAriaExtraLabelsContainer = DOM.append(this.settingsTreeContainer, $('.settings-aria-extra-labels'));
		this.settingsAriaExtraLabelsContainer.id = 'settings_aria_extra_labels';
		// Add global labels here
		const labelDiv = DOM.append(this.settingsAriaExtraLabelsContainer, $('.settings-aria-extra-label'));
		labelDiv.id = 'settings_aria_more_actions_shortcut_label';
		labelDiv.setAttribute('aria-label', '');

		this.settingRenderers = this.instantiationService.createInstance(SettingTreeRenderers);
		this._register(this.settingRenderers.onDidChangeSetting(e => this.onDidChangeSetting(e.key, e.value, e.type)));
		this._register(this.settingRenderers.onDidOpenSettings(settingKey => {
			this.openSettingsFile({ editSetting: settingKey });
		}));
		this._register(this.settingRenderers.onDidClickSettingLink(settingName => this.onDidClickSetting(settingName)));
		this._register(this.settingRenderers.onDidFocusSetting(element => {
			this.lastFocusedSettingElement = element.setting.key;
			this.settingsTree.reveal(element);
		}));
		this._register(this.settingRenderers.onDidClickOverrideElement((element: ISettingOverrideClickEvent) => {
			if (element.scope.toLowerCase() === 'workspace') {
				this.settingsTargetsWidget.updateTarget(ConfigurationTarget.WORKSPACE);
			} else if (element.scope.toLowerCase() === 'user') {
				this.settingsTargetsWidget.updateTarget(ConfigurationTarget.USER_LOCAL);
			} else if (element.scope.toLowerCase() === 'remote') {
				this.settingsTargetsWidget.updateTarget(ConfigurationTarget.USER_REMOTE);
			}

			this.searchWidget.setValue(element.targetKey);
		}));

		this.settingsTree = this._register(this.instantiationService.createInstance(SettingsTree,
			this.settingsTreeContainer,
			this.viewState,
			this.settingRenderers.allRenderers));
		this.settingsTree.getHTMLElement().attributes.removeNamedItem('tabindex');

		this._register(this.settingsTree.onDidScroll(() => {
			if (this.settingsTree.scrollTop === this.settingsTreeScrollTop) {
				return;
			}

			this.settingsTreeScrollTop = this.settingsTree.scrollTop;

			// setTimeout because calling setChildren on the settingsTree can trigger onDidScroll, so it fires when
			// setChildren has called on the settings tree but not the toc tree yet, so their rendered elements are out of sync
			setTimeout(() => {
				this.updateTreeScrollSync();
			}, 0);
		}));
	}

	private notifyNoSaveNeeded() {
		if (!this.storageService.getBoolean(SETTINGS_AUTOSAVE_NOTIFIED_KEY, StorageScope.GLOBAL, false)) {
			this.storageService.store(SETTINGS_AUTOSAVE_NOTIFIED_KEY, true, StorageScope.GLOBAL);
			this.notificationService.info(localize('settingsNoSaveNeeded', "Your changes are automatically saved as you edit."));
		}
	}

	private onDidChangeSetting(key: string, value: any, type: SettingValueType | SettingValueType[]): void {
		this.notifyNoSaveNeeded();

		if (this.pendingSettingUpdate && this.pendingSettingUpdate.key !== key) {
			this.updateChangedSetting(key, value);
		}

		this.pendingSettingUpdate = { key, value };
		if (SettingsEditor2.shouldSettingUpdateFast(type)) {
			this.settingFastUpdateDelayer.trigger(() => this.updateChangedSetting(key, value));
		} else {
			this.settingSlowUpdateDelayer.trigger(() => this.updateChangedSetting(key, value));
		}
	}

	private updateTreeScrollSync(): void {
		this.settingRenderers.cancelSuggesters();
		if (this.searchResultModel) {
			return;
		}

		if (!this.tocTreeModel) {
			return;
		}

		const elementToSync = this.settingsTree.firstVisibleElement;
		const element = elementToSync instanceof SettingsTreeSettingElement ? elementToSync.parent :
			elementToSync instanceof SettingsTreeGroupElement ? elementToSync :
				null;

		// It's possible for this to be called when the TOC and settings tree are out of sync - e.g. when the settings tree has deferred a refresh because
		// it is focused. So, bail if element doesn't exist in the TOC.
		let nodeExists = true;
		try { this.tocTree.getNode(element); } catch (e) { nodeExists = false; }
		if (!nodeExists) {
			return;
		}

		if (element && this.tocTree.getSelection()[0] !== element) {
			const ancestors = this.getAncestors(element);
			ancestors.forEach(e => this.tocTree.expand(<SettingsTreeGroupElement>e));

			this.tocTree.reveal(element);
			const elementTop = this.tocTree.getRelativeTop(element);
			if (typeof elementTop !== 'number') {
				return;
			}

			this.tocTree.collapseAll();

			ancestors.forEach(e => this.tocTree.expand(<SettingsTreeGroupElement>e));
			if (elementTop < 0 || elementTop > 1) {
				this.tocTree.reveal(element);
			} else {
				this.tocTree.reveal(element, elementTop);
			}

			this.tocTree.expand(element);

			this.tocTree.setSelection([element]);

			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			(<IFocusEventFromScroll>fakeKeyboardEvent).fromScroll = true;
			this.tocTree.setFocus([element], fakeKeyboardEvent);
		}
	}

	private getAncestors(element: SettingsTreeElement): SettingsTreeElement[] {
		const ancestors: any[] = [];

		while (element.parent) {
			if (element.parent.id !== 'root') {
				ancestors.push(element.parent);
			}

			element = element.parent;
		}

		return ancestors.reverse();
	}

	private updateChangedSetting(key: string, value: any): Promise<void> {
		// ConfigurationService displays the error if this fails.
		// Force a render afterwards because onDidConfigurationUpdate doesn't fire if the update doesn't result in an effective setting value change
		const settingsTarget = this.settingsTargetsWidget.settingsTarget;
		const resource = URI.isUri(settingsTarget) ? settingsTarget : undefined;
		const configurationTarget = <ConfigurationTarget>(resource ? ConfigurationTarget.WORKSPACE_FOLDER : settingsTarget);
		const overrides: IConfigurationOverrides = { resource };

		const isManualReset = value === undefined;

		// If the user is changing the value back to the default, do a 'reset' instead
		const inspected = this.configurationService.inspect(key, overrides);
		if (inspected.defaultValue === value) {
			value = undefined;
		}

		return this.configurationService.updateValue(key, value, overrides, configurationTarget)
			.then(() => {
				this.renderTree(key, isManualReset);
				const reportModifiedProps = {
					key,
					query: this.searchWidget.getValue(),
					searchResults: this.searchResultModel && this.searchResultModel.getUniqueResults(),
					rawResults: this.searchResultModel && this.searchResultModel.getRawResults(),
					showConfiguredOnly: !!this.viewState.tagFilters && this.viewState.tagFilters.has(MODIFIED_SETTING_TAG),
					isReset: typeof value === 'undefined',
					settingsTarget: this.settingsTargetsWidget.settingsTarget as SettingsTarget
				};

				return this.reportModifiedSetting(reportModifiedProps);
			});
	}

	private reportModifiedSetting(props: { key: string, query: string, searchResults: ISearchResult[] | null, rawResults: ISearchResult[] | null, showConfiguredOnly: boolean, isReset: boolean, settingsTarget: SettingsTarget }): void {
		this.pendingSettingUpdate = null;

		let groupId: string | undefined = undefined;
		let nlpIndex: number | undefined = undefined;
		let displayIndex: number | undefined = undefined;
		if (props.searchResults) {
			const remoteResult = props.searchResults[SearchResultIdx.Remote];
			const localResult = props.searchResults[SearchResultIdx.Local];

			const localIndex = arrays.firstIndex(localResult!.filterMatches, m => m.setting.key === props.key);
			groupId = localIndex >= 0 ?
				'local' :
				'remote';

			displayIndex = localIndex >= 0 ?
				localIndex :
				remoteResult && (arrays.firstIndex(remoteResult.filterMatches, m => m.setting.key === props.key) + localResult.filterMatches.length);

			if (this.searchResultModel) {
				const rawResults = this.searchResultModel.getRawResults();
				if (rawResults[SearchResultIdx.Remote]) {
					const _nlpIndex = arrays.firstIndex(rawResults[SearchResultIdx.Remote].filterMatches, m => m.setting.key === props.key);
					nlpIndex = _nlpIndex >= 0 ? _nlpIndex : undefined;
				}
			}
		}

		const reportedTarget = props.settingsTarget === ConfigurationTarget.USER_LOCAL ? 'user' :
			props.settingsTarget === ConfigurationTarget.USER_REMOTE ? 'user_remote' :
				props.settingsTarget === ConfigurationTarget.WORKSPACE ? 'workspace' :
					'folder';

		const data = {
			key: props.key,
			query: props.query,
			groupId,
			nlpIndex,
			displayIndex,
			showConfiguredOnly: props.showConfiguredOnly,
			isReset: props.isReset,
			target: reportedTarget
		};

		/* __GDPR__
			"settingsEditor.settingModified" : {
				"key" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"query" : { "classification": "CustomerContent", "purpose": "FeatureInsight" },
				"groupId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"nlpIndex" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"displayIndex" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"showConfiguredOnly" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"isReset" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
				"target" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		this.telemetryService.publicLog('settingsEditor.settingModified', data);
	}

	private render(token: CancellationToken): Promise<any> {
		if (this.input) {
			return this.input.resolve()
				.then((model: IEditorModel | null) => {
					if (token.isCancellationRequested || !(model instanceof Settings2EditorModel)) {
						return undefined;
					}

					this._register(model.onDidChangeGroups(() => {
						this.updatedConfigSchemaDelayer.trigger(() => {
							this.onConfigUpdate(undefined, undefined, true);
						});
					}));
					this.defaultSettingsEditorModel = model;
					return this.onConfigUpdate(undefined, true);
				});
		}
		return Promise.resolve(null);
	}

	private onSearchModeToggled(): void {
		DOM.removeClass(this.rootElement, 'no-toc-search');
		if (this.configurationService.getValue('workbench.settings.settingsSearchTocBehavior') === 'hide') {
			DOM.toggleClass(this.rootElement, 'no-toc-search', !!this.searchResultModel);
		}
	}

	private scheduleRefresh(element: HTMLElement, key = ''): void {
		if (key && this.scheduledRefreshes.has(key)) {
			return;
		}

		if (!key) {
			this.scheduledRefreshes.forEach(r => r.dispose());
			this.scheduledRefreshes.clear();
		}

		const scheduledRefreshTracker = DOM.trackFocus(element);
		this.scheduledRefreshes.set(key, scheduledRefreshTracker);
		scheduledRefreshTracker.onDidBlur(() => {
			scheduledRefreshTracker.dispose();
			this.scheduledRefreshes.delete(key);
			this.onConfigUpdate([key]);
		});
	}

	private async onConfigUpdate(keys?: string[], forceRefresh = false, schemaChange = false): Promise<void> {
		if (keys && this.settingsTreeModel) {
			return this.updateElementsByKey(keys);
		}

		const groups = this.defaultSettingsEditorModel.settingsGroups.slice(1); // Without commonlyUsed
		const dividedGroups = collections.groupBy(groups, g => g.contributedByExtension ? 'extension' : 'core');
		const settingsResult = resolveSettingsTree(tocData, dividedGroups.core);
		const resolvedSettingsRoot = settingsResult.tree;

		// Warn for settings not included in layout
		if (settingsResult.leftoverSettings.size && !this.hasWarnedMissingSettings) {
			const settingKeyList: string[] = [];
			settingsResult.leftoverSettings.forEach(s => {
				settingKeyList.push(s.key);
			});

			this.logService.warn(`SettingsEditor2: Settings not included in settingsLayout.ts: ${settingKeyList.join(', ')}`);
			this.hasWarnedMissingSettings = true;
		}

		const commonlyUsed = resolveSettingsTree(commonlyUsedData, dividedGroups.core);
		resolvedSettingsRoot.children!.unshift(commonlyUsed.tree);

		resolvedSettingsRoot.children!.push(resolveExtensionsSettings(dividedGroups.extension || []));

		if (this.searchResultModel) {
			this.searchResultModel.updateChildren();
		}

		if (this.settingsTreeModel) {
			this.settingsTreeModel.update(resolvedSettingsRoot);

			if (schemaChange && !!this.searchResultModel) {
				// If an extension's settings were just loaded and a search is active, retrigger the search so it shows up
				return await this.onSearchInputChanged();
			}

			this.refreshTOCTree();
			this.renderTree(undefined, forceRefresh);
		} else {
			this.settingsTreeModel = this.instantiationService.createInstance(SettingsTreeModel, this.viewState);
			this.settingsTreeModel.update(resolvedSettingsRoot);
			this.tocTreeModel.settingsTreeRoot = this.settingsTreeModel.root as SettingsTreeGroupElement;

			const cachedState = this.restoreCachedState();
			if (cachedState && cachedState.searchQuery) {
				await this.onSearchInputChanged();
			} else {
				this.refreshTOCTree();
				this.refreshTree();
				this.tocTree.collapseAll();
			}
		}
	}

	private updateElementsByKey(keys: string[]): void {
		if (keys.length) {
			if (this.searchResultModel) {
				keys.forEach(key => this.searchResultModel!.updateElementsByName(key));
			}

			if (this.settingsTreeModel) {
				keys.forEach(key => this.settingsTreeModel.updateElementsByName(key));
			}

			keys.forEach(key => this.renderTree(key));
		} else {
			return this.renderTree();
		}
	}

	private getActiveElementInSettingsTree(): HTMLElement | null {
		return (document.activeElement && DOM.isAncestor(document.activeElement, this.settingsTree.getHTMLElement())) ?
			<HTMLElement>document.activeElement :
			null;
	}

	private renderTree(key?: string, force = false): void {
		if (!force && key && this.scheduledRefreshes.has(key)) {
			this.updateModifiedLabelForKey(key);
			return;
		}

		// If the context view is focused, delay rendering settings
		if (this.contextViewFocused()) {
			const element = document.querySelector('.context-view');
			if (element) {
				this.scheduleRefresh(element as HTMLElement, key);
			}
			return;
		}

		// If a setting control is currently focused, schedule a refresh for later
		const activeElement = this.getActiveElementInSettingsTree();
		const focusedSetting = activeElement && this.settingRenderers.getSettingDOMElementForDOMElement(activeElement);
		if (focusedSetting && !force) {
			// If a single setting is being refreshed, it's ok to refresh now if that is not the focused setting
			if (key) {
				const focusedKey = focusedSetting.getAttribute(AbstractSettingRenderer.SETTING_KEY_ATTR);
				if (focusedKey === key &&
					// update `list`s live, as they have a separate "submit edit" step built in before this
					(focusedSetting.parentElement && !DOM.hasClass(focusedSetting.parentElement, 'setting-item-list'))
				) {

					this.updateModifiedLabelForKey(key);
					this.scheduleRefresh(focusedSetting, key);
					return;
				}
			} else {
				this.scheduleRefresh(focusedSetting);
				return;
			}
		}

		this.renderResultCountMessages();

		if (key) {
			const elements = this.currentSettingsModel.getElementsByName(key);
			if (elements && elements.length) {
				// TODO https://github.com/Microsoft/vscode/issues/57360
				this.refreshTree();
			} else {
				// Refresh requested for a key that we don't know about
				return;
			}
		} else {
			this.refreshTree();
		}

		return;
	}

	private contextViewFocused(): boolean {
		return !!DOM.findParentWithClass(<HTMLElement>document.activeElement, 'context-view');
	}

	private refreshTree(): void {
		if (this.isVisible()) {
			this.settingsTree.setChildren(null, createGroupIterator(this.currentSettingsModel.root));
		}
	}

	private refreshTOCTree(): void {
		if (this.isVisible()) {
			this.tocTreeModel.update();
			this.tocTree.setChildren(null, createTOCIterator(this.tocTreeModel, this.tocTree));
		}
	}

	private updateModifiedLabelForKey(key: string): void {
		const dataElements = this.currentSettingsModel.getElementsByName(key);
		const isModified = dataElements && dataElements[0] && dataElements[0].isConfigured; // all elements are either configured or not
		const elements = this.settingRenderers.getDOMElementsForSettingKey(this.settingsTree.getHTMLElement(), key);
		if (elements && elements[0]) {
			DOM.toggleClass(elements[0], 'is-configured', !!isModified);
		}
	}

	private async onSearchInputChanged(): Promise<void> {
		const query = this.searchWidget.getValue().trim();
		this.delayedFilterLogging.cancel();
		await this.triggerSearch(query.replace(/›/g, ' '));

		if (query && this.searchResultModel) {
			this.delayedFilterLogging.trigger(() => this.reportFilteringUsed(query, this.searchResultModel!.getUniqueResults()));
		}
	}

	private parseSettingFromJSON(query: string): string | null {
		const match = query.match(/"([a-zA-Z.]+)": /);
		return match && match[1];
	}

	private triggerSearch(query: string): Promise<void> {
		this.viewState.tagFilters = new Set<string>();
		this.viewState.extensionFilters = new Set<string>();
		if (query) {
			const parsedQuery = parseQuery(query);
			query = parsedQuery.query;
			parsedQuery.tags.forEach(tag => this.viewState.tagFilters!.add(tag));
			parsedQuery.extensionFilters.forEach(extensionId => this.viewState.extensionFilters!.add(extensionId));
		}

		if (query && query !== '@') {
			query = this.parseSettingFromJSON(query) || query;
			return this.triggerFilterPreferences(query);
		} else {
			if ((this.viewState.tagFilters && this.viewState.tagFilters.size) || (this.viewState.extensionFilters && this.viewState.extensionFilters.size)) {
				this.searchResultModel = this.createFilterModel();
			} else {
				this.searchResultModel = null;
			}

			this.localSearchDelayer.cancel();
			this.remoteSearchThrottle.cancel();
			if (this.searchInProgress) {
				this.searchInProgress.cancel();
				this.searchInProgress.dispose();
				this.searchInProgress = null;
			}

			this.tocTree.setFocus([]);
			this.viewState.filterToCategory = undefined;
			this.tocTreeModel.currentSearchModel = this.searchResultModel;
			this.onSearchModeToggled();

			if (this.searchResultModel) {
				// Added a filter model
				this.tocTree.setSelection([]);
				this.tocTree.expandAll();
				this.refreshTOCTree();
				this.renderResultCountMessages();
				this.refreshTree();
			} else {
				// Leaving search mode
				this.tocTree.collapseAll();
				this.refreshTOCTree();
				this.renderResultCountMessages();
				this.refreshTree();
			}
		}

		return Promise.resolve();
	}

	/**
	 * Return a fake SearchResultModel which can hold a flat list of all settings, to be filtered (@modified etc)
	 */
	private createFilterModel(): SearchResultModel {
		const filterModel = this.instantiationService.createInstance(SearchResultModel, this.viewState);

		const fullResult: ISearchResult = {
			filterMatches: []
		};
		for (const g of this.defaultSettingsEditorModel.settingsGroups.slice(1)) {
			for (const sect of g.sections) {
				for (const setting of sect.settings) {
					fullResult.filterMatches.push({ setting, matches: [], score: 0 });
				}
			}
		}

		filterModel.setResult(0, fullResult);

		return filterModel;
	}

	private reportFilteringUsed(query: string, results: ISearchResult[]): void {
		const nlpResult = results[SearchResultIdx.Remote];
		const nlpMetadata = nlpResult && nlpResult.metadata;

		const durations = {
			nlpResult: nlpMetadata && nlpMetadata.duration
		};

		// Count unique results
		const counts: { nlpResult?: number, filterResult?: number } = {};
		const filterResult = results[SearchResultIdx.Local];
		if (filterResult) {
			counts['filterResult'] = filterResult.filterMatches.length;
		}

		if (nlpResult) {
			counts['nlpResult'] = nlpResult.filterMatches.length;
		}

		const requestCount = nlpMetadata && nlpMetadata.requestCount;

		const data = {
			query,
			durations,
			counts,
			requestCount
		};

		/* __GDPR__
			"settingsEditor.filter" : {
				"query": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
				"durations.nlpResult" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"counts.nlpResult" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"counts.filterResult" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"requestCount" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		this.telemetryService.publicLog('settingsEditor.filter', data);
	}

	private triggerFilterPreferences(query: string): Promise<void> {
		if (this.searchInProgress) {
			this.searchInProgress.cancel();
			this.searchInProgress = null;
		}

		// Trigger the local search. If it didn't find an exact match, trigger the remote search.
		const searchInProgress = this.searchInProgress = new CancellationTokenSource();
		return this.localSearchDelayer.trigger(() => {
			if (searchInProgress && !searchInProgress.token.isCancellationRequested) {
				return this.localFilterPreferences(query).then(result => {
					if (result && !result.exactMatch) {
						this.remoteSearchThrottle.trigger(() => {
							return searchInProgress && !searchInProgress.token.isCancellationRequested ?
								this.remoteSearchPreferences(query, this.searchInProgress!.token) :
								Promise.resolve();
						});
					}
				});
			} else {
				return Promise.resolve();
			}
		});
	}

	private localFilterPreferences(query: string, token?: CancellationToken): Promise<ISearchResult | null> {
		const localSearchProvider = this.preferencesSearchService.getLocalSearchProvider(query);
		return this.filterOrSearchPreferences(query, SearchResultIdx.Local, localSearchProvider, token);
	}

	private remoteSearchPreferences(query: string, token?: CancellationToken): Promise<void> {
		const remoteSearchProvider = this.preferencesSearchService.getRemoteSearchProvider(query);
		const newExtSearchProvider = this.preferencesSearchService.getRemoteSearchProvider(query, true);

		return Promise.all([
			this.filterOrSearchPreferences(query, SearchResultIdx.Remote, remoteSearchProvider, token),
			this.filterOrSearchPreferences(query, SearchResultIdx.NewExtensions, newExtSearchProvider, token)
		]).then(() => { });
	}

	private filterOrSearchPreferences(query: string, type: SearchResultIdx, searchProvider?: ISearchProvider, token?: CancellationToken): Promise<ISearchResult | null> {
		return this._filterOrSearchPreferencesModel(query, this.defaultSettingsEditorModel, searchProvider, token).then(result => {
			if (token && token.isCancellationRequested) {
				// Handle cancellation like this because cancellation is lost inside the search provider due to async/await
				return null;
			}

			if (!this.searchResultModel) {
				this.searchResultModel = this.instantiationService.createInstance(SearchResultModel, this.viewState);
				this.searchResultModel.setResult(type, result);
				this.tocTreeModel.currentSearchModel = this.searchResultModel;
				this.onSearchModeToggled();
			} else {
				this.searchResultModel.setResult(type, result);
				this.tocTreeModel.update();
			}

			this.tocTree.setFocus([]);
			this.viewState.filterToCategory = undefined;
			this.tocTree.expandAll();

			this.refreshTOCTree();
			this.renderTree(undefined, true);
			return result;
		});
	}

	private renderResultCountMessages() {
		if (!this.currentSettingsModel) {
			return;
		}

		this.clearFilterLinkContainer.style.display = this.viewState.tagFilters && this.viewState.tagFilters.size > 0
			? 'initial'
			: 'none';

		if (!this.searchResultModel) {
			if (this.countElement.style.display !== 'none') {
				this.countElement.style.display = 'none';
				this.layout(this.dimension);
			}

			DOM.removeClass(this.rootElement, 'no-results');
			return;
		}

		if (this.tocTreeModel && this.tocTreeModel.settingsTreeRoot) {
			const count = this.tocTreeModel.settingsTreeRoot.count;
			switch (count) {
				case 0: this.countElement.innerText = localize('noResults', "No Settings Found"); break;
				case 1: this.countElement.innerText = localize('oneResult', "1 Setting Found"); break;
				default: this.countElement.innerText = localize('moreThanOneResult', "{0} Settings Found", count);
			}

			if (this.countElement.style.display !== 'block') {
				this.countElement.style.display = 'block';
				this.layout(this.dimension);
			}
			DOM.toggleClass(this.rootElement, 'no-results', count === 0);
		}
	}

	private _filterOrSearchPreferencesModel(filter: string, model: ISettingsEditorModel, provider?: ISearchProvider, token?: CancellationToken): Promise<ISearchResult | null> {
		const searchP = provider ? provider.searchModel(model, token) : Promise.resolve(null);
		return searchP
			.then<ISearchResult, ISearchResult | null>(undefined, err => {
				if (isPromiseCanceledError(err)) {
					return Promise.reject(err);
				} else {
					/* __GDPR__
						"settingsEditor.searchError" : {
							"message": { "classification": "CallstackOrException", "purpose": "FeatureInsight" }
						}
					*/
					const message = getErrorMessage(err).trim();
					if (message && message !== 'Error') {
						// "Error" = any generic network error
						this.telemetryService.publicLogError('settingsEditor.searchError', { message });
						this.logService.info('Setting search error: ' + message);
					}
					return null;
				}
			});
	}

	private layoutTrees(dimension: DOM.Dimension): void {
		const listHeight = dimension.height - (76 + 11 /* header height + padding*/);
		const settingsTreeHeight = listHeight - 14;
		this.settingsTreeContainer.style.height = `${settingsTreeHeight}px`;
		this.settingsTree.layout(settingsTreeHeight, dimension.width);

		const tocTreeHeight = listHeight - 16;
		this.tocTreeContainer.style.height = `${tocTreeHeight}px`;
		this.tocTree.layout(tocTreeHeight);
	}

	protected saveState(): void {
		if (this.isVisible()) {
			const searchQuery = this.searchWidget.getValue().trim();
			const target = this.settingsTargetsWidget.settingsTarget as SettingsTarget;
			if (this.group && this.input) {
				this.editorMemento.saveEditorState(this.group, this.input, { searchQuery, target });
			}
		}

		super.saveState();
	}
}

class SyncControls extends Disposable {
	private readonly lastSyncedLabel!: HTMLElement;
	private readonly turnOnSyncButton!: Button;

	private readonly _onDidChangeLastSyncedLabel = this._register(new Emitter<string>());
	public readonly onDidChangeLastSyncedLabel = this._onDidChangeLastSyncedLabel.event;

	constructor(
		container: HTMLElement,
		@ICommandService private readonly commandService: ICommandService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IUserDataSyncEnablementService private readonly userDataSyncEnablementService: IUserDataSyncEnablementService
	) {
		super();

		const headerRightControlsContainer = DOM.append(container, $('.settings-right-controls'));
		const turnOnSyncButtonContainer = DOM.append(headerRightControlsContainer, $('.turn-on-sync'));
		this.turnOnSyncButton = this._register(new Button(turnOnSyncButtonContainer, { title: true }));
		this.lastSyncedLabel = DOM.append(headerRightControlsContainer, $('.last-synced-label'));
		DOM.hide(this.lastSyncedLabel);

		this.turnOnSyncButton.enabled = true;
		this.turnOnSyncButton.label = localize('turnOnSyncButton', "Turn on Preferences Sync");
		DOM.hide(this.turnOnSyncButton.element);

		this._register(this.turnOnSyncButton.onDidClick(async () => {
			await this.commandService.executeCommand('workbench.userData.actions.syncStart');
		}));

		this.updateLastSyncedTime();
		this._register(this.userDataSyncService.onDidChangeLastSyncTime(() => {
			this.updateLastSyncedTime();
		}));

		const updateLastSyncedTimer = this._register(new IntervalTimer());
		updateLastSyncedTimer.cancelAndSet(() => this.updateLastSyncedTime(), 60 * 1000);

		this.update();
		this._register(this.userDataSyncService.onDidChangeStatus(() => {
			this.update();
		}));

		this._register(this.userDataSyncEnablementService.onDidChangeEnablement(() => {
			this.update();
		}));
	}

	private updateLastSyncedTime(): void {
		const last = this.userDataSyncService.lastSyncTime;
		let label: string;
		if (typeof last === 'number') {
			const d = fromNow(last, true);
			label = localize('lastSyncedLabel', "Last synced: {0}", d);
		} else {
			label = '';
		}

		this.lastSyncedLabel.textContent = label;
		this._onDidChangeLastSyncedLabel.fire(label);
	}

	private update(): void {
		if (this.userDataSyncService.status === SyncStatus.Uninitialized) {
			return;
		}

		if (this.userDataSyncEnablementService.isEnabled()) {
			DOM.show(this.lastSyncedLabel);
			DOM.hide(this.turnOnSyncButton.element);
		} else {
			DOM.hide(this.lastSyncedLabel);
			DOM.show(this.turnOnSyncButton.element);
		}
	}
}

interface ISettingsEditor2State {
	searchQuery: string;
	target: SettingsTarget;
}

function syncAllowed(productService: IProductService, configService: IConfigurationService): boolean {
	return !!getUserDataSyncStore(productService, configService);
}
