/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/keybindingsEditor';
import { localize } from 'vs/nls';
import { Delayer } from 'vs/base/common/async';
import * as DOM from 'vs/base/browser/dom';
import { OS } from 'vs/base/common/platform';
import { dispose } from 'vs/base/common/lifecycle';
import { CheckboxActionItem } from 'vs/base/browser/ui/checkbox/checkbox';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { KeybindingLabel } from 'vs/base/browser/ui/keybindingLabel/keybindingLabel';
import { IAction, Action } from 'vs/base/common/actions';
import { ActionBar, Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorOptions } from 'vs/workbench/common/editor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { KeybindingsEditorModel, IKeybindingItemEntry, IListEntry, KEYBINDING_ENTRY_TEMPLATE_ID, KEYBINDING_HEADER_TEMPLATE_ID } from 'vs/workbench/services/preferences/common/keybindingsEditorModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService, IUserFriendlyKeybinding } from 'vs/platform/keybinding/common/keybinding';
import { DefineKeybindingWidget, KeybindingsSearchWidget, KeybindingsSearchOptions } from 'vs/workbench/parts/preferences/browser/keybindingWidgets';
import {
	IKeybindingsEditor, CONTEXT_KEYBINDING_FOCUS, CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDINGS_SEARCH_FOCUS, KEYBINDINGS_EDITOR_COMMAND_REMOVE, KEYBINDINGS_EDITOR_COMMAND_COPY,
	KEYBINDINGS_EDITOR_COMMAND_RESET, KEYBINDINGS_EDITOR_COMMAND_COPY_COMMAND, KEYBINDINGS_EDITOR_COMMAND_DEFINE, KEYBINDINGS_EDITOR_COMMAND_SHOW_SIMILAR,
	KEYBINDINGS_EDITOR_COMMAND_RECORD_SEARCH_KEYS, KEYBINDINGS_EDITOR_COMMAND_SORTBY_PRECEDENCE, KEYBINDINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS
} from 'vs/workbench/parts/preferences/common/preferences';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingEditingService } from 'vs/workbench/services/keybinding/common/keybindingEditing';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { IListVirtualDelegate, IListRenderer, IListContextMenuEvent, IListEvent } from 'vs/base/browser/ui/list/list';
import { IThemeService, registerThemingParticipant, ITheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode, ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { listHighlightForeground, badgeBackground, contrastBorder, badgeForeground } from 'vs/platform/theme/common/colorRegistry';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { KeybindingsEditorInput } from 'vs/workbench/services/preferences/common/preferencesEditorInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { attachStylerCallback } from 'vs/platform/theme/common/styler';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';

const $ = DOM.$;

export class KeybindingsEditor extends BaseEditor implements IKeybindingsEditor {

	static readonly ID: string = 'workbench.editor.keybindings';

	private keybindingsEditorModel: KeybindingsEditorModel;

	private headerContainer: HTMLElement;
	private actionsContainer: HTMLElement;
	private searchWidget: KeybindingsSearchWidget;

	private overlayContainer: HTMLElement;
	private defineKeybindingWidget: DefineKeybindingWidget;

	private keybindingsListContainer: HTMLElement;
	private unAssignedKeybindingItemToRevealAndFocus: IKeybindingItemEntry;
	private listEntries: IListEntry[];
	private keybindingsList: List<IListEntry>;

	private dimension: DOM.Dimension;
	private delayedFiltering: Delayer<void>;
	private latestEmptyFilters: string[] = [];
	private delayedFilterLogging: Delayer<void>;
	private keybindingsEditorContextKey: IContextKey<boolean>;
	private keybindingFocusContextKey: IContextKey<boolean>;
	private searchFocusContextKey: IContextKey<boolean>;

	private actionBar: ActionBar;
	private sortByPrecedenceAction: Action;
	private recordKeysAction: Action;

	private ariaLabelElement: HTMLElement;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IKeybindingService private keybindingsService: IKeybindingService,
		@IContextMenuService private contextMenuService: IContextMenuService,
		@IKeybindingEditingService private keybindingEditingService: IKeybindingEditingService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@INotificationService private notificationService: INotificationService,
		@IClipboardService private clipboardService: IClipboardService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IEditorService private editorService: IEditorService,
		@IStorageService storageService: IStorageService,
		@IPreferencesService private preferencesService: IPreferencesService
	) {
		super(KeybindingsEditor.ID, telemetryService, themeService, storageService);
		this.delayedFiltering = new Delayer<void>(300);
		this._register(keybindingsService.onDidUpdateKeybindings(() => this.render(true, CancellationToken.None)));

		this.keybindingsEditorContextKey = CONTEXT_KEYBINDINGS_EDITOR.bindTo(this.contextKeyService);
		this.searchFocusContextKey = CONTEXT_KEYBINDINGS_SEARCH_FOCUS.bindTo(this.contextKeyService);
		this.keybindingFocusContextKey = CONTEXT_KEYBINDING_FOCUS.bindTo(this.contextKeyService);
		this.delayedFilterLogging = new Delayer<void>(1000);
	}

	createEditor(parent: HTMLElement): void {
		const keybindingsEditorElement = DOM.append(parent, $('div', { class: 'keybindings-editor' }));

		this.createAriaLabelElement(keybindingsEditorElement);
		this.createOverlayContainer(keybindingsEditorElement);
		this.createHeader(keybindingsEditorElement);
		this.createBody(keybindingsEditorElement);

		const focusTracker = this._register(DOM.trackFocus(parent));
		this._register(focusTracker.onDidFocus(() => this.keybindingsEditorContextKey.set(true)));
		this._register(focusTracker.onDidBlur(() => this.keybindingsEditorContextKey.reset()));
	}

	setInput(input: KeybindingsEditorInput, options: EditorOptions, token: CancellationToken): Promise<void> {
		return super.setInput(input, options, token)
			.then(() => this.render(options && options.preserveFocus, token));
	}

	clearInput(): void {
		super.clearInput();
		this.keybindingsEditorContextKey.reset();
		this.keybindingFocusContextKey.reset();
	}

	layout(dimension: DOM.Dimension): void {
		this.dimension = dimension;
		this.layoutSearchWidget(dimension);

		this.overlayContainer.style.width = dimension.width + 'px';
		this.overlayContainer.style.height = dimension.height + 'px';
		this.defineKeybindingWidget.layout(this.dimension);

		this.layoutKebindingsList();
	}

	focus(): void {
		const activeKeybindingEntry = this.activeKeybindingEntry;
		if (activeKeybindingEntry) {
			this.selectEntry(activeKeybindingEntry);
		} else {
			this.searchWidget.focus();
		}
	}

	get activeKeybindingEntry(): IKeybindingItemEntry {
		const focusedElement = this.keybindingsList.getFocusedElements()[0];
		return focusedElement && focusedElement.templateId === KEYBINDING_ENTRY_TEMPLATE_ID ? <IKeybindingItemEntry>focusedElement : null;
	}

	defineKeybinding(keybindingEntry: IKeybindingItemEntry): Promise<any> {
		this.selectEntry(keybindingEntry);
		this.showOverlayContainer();
		return this.defineKeybindingWidget.define().then(key => {
			if (key) {
				const currentKey = keybindingEntry.keybindingItem.keybinding ? keybindingEntry.keybindingItem.keybinding.getUserSettingsLabel() : '';
				if (currentKey !== key) {
					this.reportKeybindingAction(KEYBINDINGS_EDITOR_COMMAND_DEFINE, keybindingEntry.keybindingItem.command, key);
					return this.keybindingEditingService.editKeybinding(key, keybindingEntry.keybindingItem.keybindingItem)
						.then(() => {
							if (!keybindingEntry.keybindingItem.keybinding) { // reveal only if keybinding was added to unassinged. Because the entry will be placed in different position after rendering
								this.unAssignedKeybindingItemToRevealAndFocus = keybindingEntry;
							}
						});
				}
			}
			return null;
		}).then(() => {
			this.hideOverlayContainer();
			this.selectEntry(keybindingEntry);
		}, error => {
			this.hideOverlayContainer();
			this.onKeybindingEditingError(error);
			this.selectEntry(keybindingEntry);
			return error;
		});
	}

	removeKeybinding(keybindingEntry: IKeybindingItemEntry): Promise<any> {
		this.selectEntry(keybindingEntry);
		if (keybindingEntry.keybindingItem.keybinding) { // This should be a pre-condition
			this.reportKeybindingAction(KEYBINDINGS_EDITOR_COMMAND_REMOVE, keybindingEntry.keybindingItem.command, keybindingEntry.keybindingItem.keybinding);
			return this.keybindingEditingService.removeKeybinding(keybindingEntry.keybindingItem.keybindingItem)
				.then(() => this.focus(),
					error => {
						this.onKeybindingEditingError(error);
						this.selectEntry(keybindingEntry);
					});
		}
		return Promise.resolve(null);
	}

	resetKeybinding(keybindingEntry: IKeybindingItemEntry): Promise<any> {
		this.selectEntry(keybindingEntry);
		this.reportKeybindingAction(KEYBINDINGS_EDITOR_COMMAND_RESET, keybindingEntry.keybindingItem.command, keybindingEntry.keybindingItem.keybinding);
		return this.keybindingEditingService.resetKeybinding(keybindingEntry.keybindingItem.keybindingItem)
			.then(() => {
				if (!keybindingEntry.keybindingItem.keybinding) { // reveal only if keybinding was added to unassinged. Because the entry will be placed in different position after rendering
					this.unAssignedKeybindingItemToRevealAndFocus = keybindingEntry;
				}
				this.selectEntry(keybindingEntry);
			},
				error => {
					this.onKeybindingEditingError(error);
					this.selectEntry(keybindingEntry);
				});
	}

	copyKeybinding(keybinding: IKeybindingItemEntry): void {
		this.selectEntry(keybinding);
		this.reportKeybindingAction(KEYBINDINGS_EDITOR_COMMAND_COPY, keybinding.keybindingItem.command, keybinding.keybindingItem.keybinding);
		const userFriendlyKeybinding: IUserFriendlyKeybinding = {
			key: keybinding.keybindingItem.keybinding ? keybinding.keybindingItem.keybinding.getUserSettingsLabel() : '',
			command: keybinding.keybindingItem.command
		};
		if (keybinding.keybindingItem.when) {
			userFriendlyKeybinding.when = keybinding.keybindingItem.when;
		}
		this.clipboardService.writeText(JSON.stringify(userFriendlyKeybinding, null, '  '));
	}

	copyKeybindingCommand(keybinding: IKeybindingItemEntry): void {
		this.selectEntry(keybinding);
		this.reportKeybindingAction(KEYBINDINGS_EDITOR_COMMAND_COPY_COMMAND, keybinding.keybindingItem.command, keybinding.keybindingItem.keybinding);
		this.clipboardService.writeText(keybinding.keybindingItem.command);
	}

	focusSearch(): void {
		this.searchWidget.focus();
	}

	search(filter: string): void {
		this.focusSearch();
		this.searchWidget.setValue(filter);
	}

	clearSearchResults(): void {
		this.searchWidget.clear();
	}

	showSimilarKeybindings(keybindingEntry: IKeybindingItemEntry): void {
		const value = `"${keybindingEntry.keybindingItem.keybinding.getAriaLabel()}"`;
		if (value !== this.searchWidget.getValue()) {
			this.searchWidget.setValue(value);
		}
	}

	private createAriaLabelElement(parent: HTMLElement): void {
		this.ariaLabelElement = DOM.append(parent, DOM.$(''));
		this.ariaLabelElement.setAttribute('id', 'keybindings-editor-aria-label-element');
		this.ariaLabelElement.setAttribute('aria-live', 'assertive');
	}

	private createOverlayContainer(parent: HTMLElement): void {
		this.overlayContainer = DOM.append(parent, $('.overlay-container'));
		this.overlayContainer.style.position = 'absolute';
		this.overlayContainer.style.zIndex = '10';
		this.defineKeybindingWidget = this._register(this.instantiationService.createInstance(DefineKeybindingWidget, this.overlayContainer));
		this._register(this.defineKeybindingWidget.onDidChange(keybindingStr => this.defineKeybindingWidget.printExisting(this.keybindingsEditorModel.fetch(`"${keybindingStr}"`).length)));
		this._register(this.defineKeybindingWidget.onShowExistingKeybidings(keybindingStr => this.searchWidget.setValue(`"${keybindingStr}"`)));
		this.hideOverlayContainer();
	}

	private showOverlayContainer() {
		this.overlayContainer.style.display = 'block';
	}

	private hideOverlayContainer() {
		this.overlayContainer.style.display = 'none';
	}

	private createHeader(parent: HTMLElement): void {
		this.headerContainer = DOM.append(parent, $('.keybindings-header'));
		const fullTextSearchPlaceholder = localize('SearchKeybindings.FullTextSearchPlaceholder', "Type to search in keybindings");
		const keybindingsSearchPlaceholder = localize('SearchKeybindings.KeybindingsSearchPlaceholder', "Recording Keys. Press Escape to exit");

		const clearInputAction = new Action(KEYBINDINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS, localize('clearInput', "Clear Keybindings Search Input"), 'clear-input', false, () => { this.search(''); return Promise.resolve(null); });

		const searchContainer = DOM.append(this.headerContainer, $('.search-container'));
		this.searchWidget = this._register(this.instantiationService.createInstance(KeybindingsSearchWidget, searchContainer, <KeybindingsSearchOptions>{
			ariaLabel: fullTextSearchPlaceholder,
			placeholder: fullTextSearchPlaceholder,
			focusKey: this.searchFocusContextKey,
			ariaLabelledBy: 'keybindings-editor-aria-label-element',
			recordEnter: true,
			quoteRecordedKeys: true
		}));
		this._register(this.searchWidget.onDidChange(searchValue => {
			clearInputAction.enabled = !!searchValue;
			this.delayedFiltering.trigger(() => this.filterKeybindings());
		}));
		this._register(this.searchWidget.onEscape(() => this.recordKeysAction.checked = false));

		this.actionsContainer = DOM.append(searchContainer, DOM.$('.keybindings-search-actions-container'));
		const recordingBadge = this.createRecordingBadge(this.actionsContainer);

		const sortByPrecedenceActionKeybinding = this.keybindingsService.lookupKeybinding(KEYBINDINGS_EDITOR_COMMAND_SORTBY_PRECEDENCE);
		const sortByPrecedenceActionLabel = localize('sortByPrecedeneLabel', "Sort by Precedence");
		this.sortByPrecedenceAction = new Action('keybindings.editor.sortByPrecedence', sortByPrecedenceActionKeybinding ? localize('sortByPrecedeneLabelWithKeybinding', "{0} ({1})", sortByPrecedenceActionLabel, sortByPrecedenceActionKeybinding.getLabel()) : sortByPrecedenceActionLabel, 'sort-by-precedence');
		this.sortByPrecedenceAction.checked = false;
		this._register(this.sortByPrecedenceAction.onDidChange(e => {
			if (e.checked !== void 0) {
				this.renderKeybindingsEntries(false);
			}
		}));

		const recordKeysActionKeybinding = this.keybindingsService.lookupKeybinding(KEYBINDINGS_EDITOR_COMMAND_RECORD_SEARCH_KEYS);
		const recordKeysActionLabel = localize('recordKeysLabel', "Record Keys");
		this.recordKeysAction = new Action(KEYBINDINGS_EDITOR_COMMAND_RECORD_SEARCH_KEYS, recordKeysActionKeybinding ? localize('recordKeysLabelWithKeybinding', "{0} ({1})", recordKeysActionLabel, recordKeysActionKeybinding.getLabel()) : recordKeysActionLabel, 'record-keys');
		this.recordKeysAction.checked = false;
		this._register(this.recordKeysAction.onDidChange(e => {
			if (e.checked !== void 0) {
				DOM.toggleClass(recordingBadge, 'disabled', !e.checked);
				if (e.checked) {
					this.searchWidget.inputBox.setPlaceHolder(keybindingsSearchPlaceholder);
					this.searchWidget.inputBox.setAriaLabel(keybindingsSearchPlaceholder);
					this.searchWidget.startRecordingKeys();
					this.searchWidget.focus();
				} else {
					this.searchWidget.inputBox.setPlaceHolder(fullTextSearchPlaceholder);
					this.searchWidget.inputBox.setAriaLabel(fullTextSearchPlaceholder);
					this.searchWidget.stopRecordingKeys();
					this.searchWidget.focus();
				}
			}
		}));

		this.actionBar = this._register(new ActionBar(this.actionsContainer, {
			animated: false,
			actionItemProvider: (action: Action) => {
				if (action.id === this.sortByPrecedenceAction.id) {
					return new CheckboxActionItem(null, action);
				}
				if (action.id === this.recordKeysAction.id) {
					return new CheckboxActionItem(null, action);
				}
				return null;
			}
		}));

		this.actionBar.push([this.recordKeysAction, this.sortByPrecedenceAction, clearInputAction], { label: false, icon: true });

		this.createOpenKeybindingsElement(this.headerContainer);
	}

	private createRecordingBadge(container: HTMLElement): HTMLElement {
		const recordingBadge = DOM.append(container, DOM.$('.recording-badge.disabled'));
		recordingBadge.textContent = localize('recording', "Recording Keys");
		this._register(attachStylerCallback(this.themeService, { badgeBackground, contrastBorder, badgeForeground }, colors => {
			const background = colors.badgeBackground ? colors.badgeBackground.toString() : null;
			const border = colors.contrastBorder ? colors.contrastBorder.toString() : null;
			const color = colors.badgeForeground ? colors.badgeForeground.toString() : null;

			recordingBadge.style.backgroundColor = background;
			recordingBadge.style.borderWidth = border ? '1px' : null;
			recordingBadge.style.borderStyle = border ? 'solid' : null;
			recordingBadge.style.borderColor = border;
			recordingBadge.style.color = color ? color.toString() : null;
		}));
		return recordingBadge;
	}

	private createOpenKeybindingsElement(parent: HTMLElement): void {
		const openKeybindingsContainer = DOM.append(parent, $('.open-keybindings-container'));
		DOM.append(openKeybindingsContainer, $('', null, localize('header-message', "For advanced customizations open and edit")));
		const fileElement = DOM.append(openKeybindingsContainer, $('.file-name', null, localize('keybindings-file-name', "keybindings.json")));
		fileElement.tabIndex = 0;
		this._register(DOM.addDisposableListener(fileElement, DOM.EventType.CLICK, () => this.preferencesService.openGlobalKeybindingSettings(true)));
		this._register(DOM.addDisposableListener(fileElement, DOM.EventType.KEY_UP, e => {
			const keyboardEvent = new StandardKeyboardEvent(e);
			switch (keyboardEvent.keyCode) {
				case KeyCode.Enter:
					this.preferencesService.openGlobalKeybindingSettings(true);
					keyboardEvent.preventDefault();
					keyboardEvent.stopPropagation();
					return;
			}
		}));
	}

	private layoutSearchWidget(dimension: DOM.Dimension): void {
		this.searchWidget.layout(dimension);
		DOM.toggleClass(this.headerContainer, 'small', dimension.width < 400);
		this.searchWidget.inputBox.inputElement.style.paddingRight = `${DOM.getTotalWidth(this.actionsContainer) + 12}px`;
	}

	private createBody(parent: HTMLElement): void {
		const bodyContainer = DOM.append(parent, $('.keybindings-body'));
		this.createList(bodyContainer);
	}

	private createList(parent: HTMLElement): void {
		this.keybindingsListContainer = DOM.append(parent, $('.keybindings-list-container'));

		this.keybindingsList = this._register(this.instantiationService.createInstance(WorkbenchList, this.keybindingsListContainer, new Delegate(), [new KeybindingHeaderRenderer(), new KeybindingItemRenderer(this, this.keybindingsService)],
			{ identityProvider: { getId: e => e.id }, ariaLabel: localize('keybindingsLabel', "Keybindings"), setRowLineHeight: false })) as WorkbenchList<IListEntry>;
		this._register(this.keybindingsList.onContextMenu(e => this.onContextMenu(e)));
		this._register(this.keybindingsList.onFocusChange(e => this.onFocusChange(e)));
		this._register(this.keybindingsList.onDidFocus(() => {
			DOM.addClass(this.keybindingsList.getHTMLElement(), 'focused');
		}));
		this._register(this.keybindingsList.onDidBlur(() => {
			DOM.removeClass(this.keybindingsList.getHTMLElement(), 'focused');
			this.keybindingFocusContextKey.reset();
		}));
		this._register(this.keybindingsList.onMouseDblClick(() => this.defineKeybinding(this.activeKeybindingEntry)));
		this._register(this.keybindingsList.onKeyDown(e => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Enter) {
				const keybindingEntry = this.activeKeybindingEntry;
				if (keybindingEntry) {
					this.defineKeybinding(this.activeKeybindingEntry);
				}
				e.stopPropagation();
			}
		}));
	}

	private render(preserveFocus: boolean, token: CancellationToken): Promise<any> {
		if (this.input) {
			return this.input.resolve()
				.then((keybindingsModel: KeybindingsEditorModel) => {
					if (token.isCancellationRequested) {
						return void 0;
					}

					this.keybindingsEditorModel = keybindingsModel;

					const editorActionsLabels: { [id: string]: string; } = EditorExtensionsRegistry.getEditorActions().reduce((editorActions, editorAction) => {
						editorActions[editorAction.id] = editorAction.label;
						return editorActions;
					}, {});

					return this.keybindingsEditorModel.resolve(editorActionsLabels);
				})
				.then(() => {
					if (token.isCancellationRequested) {
						return void 0;
					}

					this.renderKeybindingsEntries(false, preserveFocus);
				});
		}
		return Promise.resolve();
	}

	private filterKeybindings(): void {
		this.renderKeybindingsEntries(this.searchWidget.hasFocus());
		this.delayedFilterLogging.trigger(() => this.reportFilteringUsed(this.searchWidget.getValue()));
	}

	private renderKeybindingsEntries(reset: boolean, preserveFocus?: boolean): void {
		if (this.keybindingsEditorModel) {
			const filter = this.searchWidget.getValue();
			const keybindingsEntries: IKeybindingItemEntry[] = this.keybindingsEditorModel.fetch(filter, this.sortByPrecedenceAction.checked);

			this.ariaLabelElement.setAttribute('aria-label', this.getAriaLabel(keybindingsEntries));

			if (keybindingsEntries.length === 0) {
				this.latestEmptyFilters.push(filter);
			}
			const currentSelectedIndex = this.keybindingsList.getSelection()[0];
			this.listEntries = [{ id: 'keybinding-header-entry', templateId: KEYBINDING_HEADER_TEMPLATE_ID }, ...keybindingsEntries];
			this.keybindingsList.splice(0, this.keybindingsList.length, this.listEntries);
			this.layoutKebindingsList();

			if (reset) {
				this.keybindingsList.setSelection([]);
				this.keybindingsList.setFocus([]);
			} else {
				if (this.unAssignedKeybindingItemToRevealAndFocus) {
					const index = this.getNewIndexOfUnassignedKeybinding(this.unAssignedKeybindingItemToRevealAndFocus);
					if (index !== -1) {
						this.keybindingsList.reveal(index, 0.2);
						this.selectEntry(index);
					}
					this.unAssignedKeybindingItemToRevealAndFocus = null;
				} else if (currentSelectedIndex !== -1 && currentSelectedIndex < this.listEntries.length) {
					this.selectEntry(currentSelectedIndex);
				} else if (this.editorService.activeControl === this && !preserveFocus) {
					this.focus();
				}
			}
		}
	}

	private getAriaLabel(keybindingsEntries: IKeybindingItemEntry[]): string {
		if (this.sortByPrecedenceAction.checked) {
			return localize('show sorted keybindings', "Showing {0} Keybindings in precedence order", keybindingsEntries.length);
		} else {
			return localize('show keybindings', "Showing {0} Keybindings in alphabetical order", keybindingsEntries.length);
		}
	}

	private layoutKebindingsList(): void {
		const listHeight = this.dimension.height - (DOM.getDomNodePagePosition(this.headerContainer).height + 12 /*padding*/);
		this.keybindingsListContainer.style.height = `${listHeight}px`;
		this.keybindingsList.layout(listHeight);
	}

	private getIndexOf(listEntry: IListEntry): number {
		const index = this.listEntries.indexOf(listEntry);
		if (index === -1) {
			for (let i = 0; i < this.listEntries.length; i++) {
				if (this.listEntries[i].id === listEntry.id) {
					return i;
				}
			}
		}
		return index;
	}

	private getNewIndexOfUnassignedKeybinding(unassignedKeybinding: IKeybindingItemEntry): number {
		for (let index = 0; index < this.listEntries.length; index++) {
			const entry = this.listEntries[index];
			if (entry.templateId === KEYBINDING_ENTRY_TEMPLATE_ID) {
				const keybindingItemEntry = (<IKeybindingItemEntry>entry);
				if (keybindingItemEntry.keybindingItem.command === unassignedKeybinding.keybindingItem.command) {
					return index;
				}
			}
		}
		return -1;
	}

	private selectEntry(keybindingItemEntry: IKeybindingItemEntry | number): void {
		const index = typeof keybindingItemEntry === 'number' ? keybindingItemEntry : this.getIndexOf(keybindingItemEntry);
		if (index !== -1) {
			this.keybindingsList.getHTMLElement().focus();
			this.keybindingsList.setFocus([index]);
			this.keybindingsList.setSelection([index]);
		}
	}

	focusKeybindings(): void {
		this.keybindingsList.getHTMLElement().focus();
		const currentFocusIndices = this.keybindingsList.getFocus();
		this.keybindingsList.setFocus([currentFocusIndices.length ? currentFocusIndices[0] : 0]);
	}

	recordSearchKeys(): void {
		this.recordKeysAction.checked = true;
	}

	toggleSortByPrecedence(): void {
		this.sortByPrecedenceAction.checked = !this.sortByPrecedenceAction.checked;
	}

	private onContextMenu(e: IListContextMenuEvent<IListEntry>): void {
		if (!e.element) {
			return;
		}

		if (e.element.templateId === KEYBINDING_ENTRY_TEMPLATE_ID) {
			this.selectEntry(<IKeybindingItemEntry>e.element);
			this.contextMenuService.showContextMenu({
				getAnchor: () => e.anchor,
				getActions: () => [
					this.createCopyAction(<IKeybindingItemEntry>e.element),
					this.createCopyCommandAction(<IKeybindingItemEntry>e.element),
					new Separator(),
					this.createDefineAction(<IKeybindingItemEntry>e.element),
					this.createRemoveAction(<IKeybindingItemEntry>e.element),
					this.createResetAction(<IKeybindingItemEntry>e.element),
					new Separator(),
					this.createShowConflictsAction(<IKeybindingItemEntry>e.element)]
			});
		}
	}

	private onFocusChange(e: IListEvent<IListEntry>): void {
		this.keybindingFocusContextKey.reset();
		const element = e.elements[0];
		if (!element) {
			return;
		}

		if (element.templateId === KEYBINDING_ENTRY_TEMPLATE_ID) {
			this.keybindingFocusContextKey.set(true);
		}
	}

	private createDefineAction(keybindingItemEntry: IKeybindingItemEntry): IAction {
		return <IAction>{
			label: keybindingItemEntry.keybindingItem.keybinding ? localize('changeLabel', "Change Keybinding") : localize('addLabel', "Add Keybinding"),
			enabled: true,
			id: KEYBINDINGS_EDITOR_COMMAND_DEFINE,
			run: () => this.defineKeybinding(keybindingItemEntry)
		};
	}

	private createRemoveAction(keybindingItem: IKeybindingItemEntry): IAction {
		return <IAction>{
			label: localize('removeLabel', "Remove Keybinding"),
			enabled: !!keybindingItem.keybindingItem.keybinding,
			id: KEYBINDINGS_EDITOR_COMMAND_REMOVE,
			run: () => this.removeKeybinding(keybindingItem)
		};
	}

	private createResetAction(keybindingItem: IKeybindingItemEntry): IAction {
		return <IAction>{
			label: localize('resetLabel', "Reset Keybinding"),
			enabled: !keybindingItem.keybindingItem.keybindingItem.isDefault,
			id: KEYBINDINGS_EDITOR_COMMAND_RESET,
			run: () => this.resetKeybinding(keybindingItem)
		};
	}

	private createShowConflictsAction(keybindingItem: IKeybindingItemEntry): IAction {
		return <IAction>{
			label: localize('showSameKeybindings', "Show Same Keybindings"),
			enabled: !!keybindingItem.keybindingItem.keybinding,
			id: KEYBINDINGS_EDITOR_COMMAND_SHOW_SIMILAR,
			run: () => this.showSimilarKeybindings(keybindingItem)
		};
	}

	private createCopyAction(keybindingItem: IKeybindingItemEntry): IAction {
		return <IAction>{
			label: localize('copyLabel', "Copy"),
			enabled: true,
			id: KEYBINDINGS_EDITOR_COMMAND_COPY,
			run: () => this.copyKeybinding(keybindingItem)
		};
	}

	private createCopyCommandAction(keybinding: IKeybindingItemEntry): IAction {
		return <IAction>{
			label: localize('copyCommandLabel', "Copy Command"),
			enabled: true,
			id: KEYBINDINGS_EDITOR_COMMAND_COPY_COMMAND,
			run: () => this.copyKeybindingCommand(keybinding)
		};
	}

	private reportFilteringUsed(filter: string): void {
		if (filter) {
			const data = {
				filter,
				emptyFilters: this.getLatestEmptyFiltersForTelemetry()
			};
			this.latestEmptyFilters = [];
			/* __GDPR__
				"keybindings.filter" : {
					"filter": { "classification": "CustomerContent", "purpose": "FeatureInsight" },
					"emptyFilters" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryService.publicLog('keybindings.filter', data);
		}
	}

	/**
	 * Put a rough limit on the size of the telemetry data, since otherwise it could be an unbounded large amount
	 * of data. 8192 is the max size of a property value. This is rough since that probably includes ""s, etc.
	 */
	private getLatestEmptyFiltersForTelemetry(): string[] {
		let cumulativeSize = 0;
		return this.latestEmptyFilters.filter(filterText => (cumulativeSize += filterText.length) <= 8192);
	}

	private reportKeybindingAction(action: string, command: string, keybinding: ResolvedKeybinding | string): void {
		// __GDPR__TODO__ Need to move off dynamic event names and properties as they cannot be registered statically
		this.telemetryService.publicLog(action, { command, keybinding: keybinding ? (typeof keybinding === 'string' ? keybinding : keybinding.getUserSettingsLabel()) : '' });
	}

	private onKeybindingEditingError(error: any): void {
		this.notificationService.error(typeof error === 'string' ? error : localize('error', "Error '{0}' while editing the keybinding. Please open 'keybindings.json' file and check for errors.", `${error}`));
	}
}

class Delegate implements IListVirtualDelegate<IListEntry> {

	getHeight(element: IListEntry) {
		if (element.templateId === KEYBINDING_ENTRY_TEMPLATE_ID) {
			const commandIdMatched = (<IKeybindingItemEntry>element).keybindingItem.commandLabel && (<IKeybindingItemEntry>element).commandIdMatches;
			const commandDefaultLabelMatched = !!(<IKeybindingItemEntry>element).commandDefaultLabelMatches;
			if (commandIdMatched && commandDefaultLabelMatched) {
				return 60;
			}
			if (commandIdMatched || commandDefaultLabelMatched) {
				return 40;
			}
		}
		if (element.templateId === KEYBINDING_HEADER_TEMPLATE_ID) {
			return 30;
		}
		return 24;
	}

	getTemplateId(element: IListEntry) {
		return element.templateId;
	}
}

interface KeybindingItemTemplate {
	parent: HTMLElement;
	actions: ActionsColumn;
	command: CommandColumn;
	keybinding: KeybindingColumn;
	source: SourceColumn;
	when: WhenColumn;
}

class KeybindingHeaderRenderer implements IListRenderer<IListEntry, any> {

	get templateId(): string { return KEYBINDING_HEADER_TEMPLATE_ID; }

	constructor() { }

	renderTemplate(container: HTMLElement): any {
		DOM.addClass(container, 'keybindings-list-header');
		DOM.append(container,
			$('.header.actions'),
			$('.header.command', null, localize('command', "Command")),
			$('.header.keybinding', null, localize('keybinding', "Keybinding")),
			$('.header.source', null, localize('source', "Source")),
			$('.header.when', null, localize('when', "When")));
		return {};
	}

	renderElement(entry: IListEntry, index: number, template: any): void {
	}

	disposeTemplate(template: any): void {
	}
}

class KeybindingItemRenderer implements IListRenderer<IKeybindingItemEntry, KeybindingItemTemplate> {

	get templateId(): string { return KEYBINDING_ENTRY_TEMPLATE_ID; }

	constructor(private keybindingsEditor: IKeybindingsEditor, private keybindingsService: IKeybindingService) { }

	renderTemplate(container: HTMLElement): KeybindingItemTemplate {
		DOM.addClass(container, 'keybinding-item');
		const actions = new ActionsColumn(container, this.keybindingsEditor, this.keybindingsService);
		const command = new CommandColumn(container, this.keybindingsEditor);
		const keybinding = new KeybindingColumn(container, this.keybindingsEditor);
		const source = new SourceColumn(container, this.keybindingsEditor);
		const when = new WhenColumn(container, this.keybindingsEditor);
		container.setAttribute('aria-labelledby', [command.id, keybinding.id, source.id, when.id].join(' '));
		return {
			parent: container,
			actions,
			command,
			keybinding,
			source,
			when
		};
	}

	renderElement(keybindingEntry: IKeybindingItemEntry, index: number, template: KeybindingItemTemplate): void {
		DOM.toggleClass(template.parent, 'odd', index % 2 === 1);
		template.actions.render(keybindingEntry);
		template.command.render(keybindingEntry);
		template.keybinding.render(keybindingEntry);
		template.source.render(keybindingEntry);
		template.when.render(keybindingEntry);
	}

	disposeTemplate(template: KeybindingItemTemplate): void {
		template.actions.dispose();
	}
}

abstract class Column {

	static COUNTER = 0;

	protected element: HTMLElement;
	readonly id: string;

	constructor(protected parent: HTMLElement, protected keybindingsEditor: IKeybindingsEditor) {
		this.element = this.create(parent);
		this.id = this.element.getAttribute('id');
	}

	abstract create(parent: HTMLElement): HTMLElement;
}

class ActionsColumn extends Column {

	private actionBar: ActionBar;

	constructor(parent: HTMLElement, keybindingsEditor: IKeybindingsEditor, private keybindingsService: IKeybindingService) {
		super(parent, keybindingsEditor);
	}

	create(parent: HTMLElement): HTMLElement {
		const actionsContainer = DOM.append(parent, $('.column.actions', { id: 'actions_' + ++Column.COUNTER }));
		this.actionBar = new ActionBar(actionsContainer, { animated: false });
		return actionsContainer;
	}

	render(keybindingItemEntry: IKeybindingItemEntry): void {
		this.actionBar.clear();
		const actions: IAction[] = [];
		if (keybindingItemEntry.keybindingItem.keybinding) {
			actions.push(this.createEditAction(keybindingItemEntry));
		} else {
			actions.push(this.createAddAction(keybindingItemEntry));
		}
		this.actionBar.push(actions, { icon: true });
	}

	private createEditAction(keybindingItemEntry: IKeybindingItemEntry): IAction {
		const keybinding = this.keybindingsService.lookupKeybinding(KEYBINDINGS_EDITOR_COMMAND_DEFINE);
		return <IAction>{
			class: 'edit',
			enabled: true,
			id: 'editKeybinding',
			tooltip: keybinding ? localize('editKeybindingLabelWithKey', "Change Keybinding {0}", `(${keybinding.getLabel()})`) : localize('editKeybindingLabel', "Change Keybinding"),
			run: () => this.keybindingsEditor.defineKeybinding(keybindingItemEntry)
		};
	}

	private createAddAction(keybindingItemEntry: IKeybindingItemEntry): IAction {
		const keybinding = this.keybindingsService.lookupKeybinding(KEYBINDINGS_EDITOR_COMMAND_DEFINE);
		return <IAction>{
			class: 'add',
			enabled: true,
			id: 'addKeybinding',
			tooltip: keybinding ? localize('addKeybindingLabelWithKey', "Add Keybinding {0}", `(${keybinding.getLabel()})`) : localize('addKeybindingLabel', "Add Keybinding"),
			run: () => this.keybindingsEditor.defineKeybinding(keybindingItemEntry)
		};
	}

	dispose(): void {
		this.actionBar = dispose(this.actionBar);
	}
}

class CommandColumn extends Column {

	private commandColumn: HTMLElement;

	create(parent: HTMLElement): HTMLElement {
		this.commandColumn = DOM.append(parent, $('.column.command', { id: 'command_' + ++Column.COUNTER }));
		return this.commandColumn;
	}

	render(keybindingItemEntry: IKeybindingItemEntry): void {
		DOM.clearNode(this.commandColumn);
		const keybindingItem = keybindingItemEntry.keybindingItem;
		const commandIdMatched = !!(keybindingItem.commandLabel && keybindingItemEntry.commandIdMatches);
		const commandDefaultLabelMatched = !!keybindingItemEntry.commandDefaultLabelMatches;
		DOM.toggleClass(this.commandColumn, 'vertical-align-column', commandIdMatched || commandDefaultLabelMatched);
		this.commandColumn.setAttribute('aria-label', this.getAriaLabel(keybindingItemEntry));
		let commandLabel: HighlightedLabel;
		if (keybindingItem.commandLabel) {
			commandLabel = new HighlightedLabel(this.commandColumn, false);
			commandLabel.set(keybindingItem.commandLabel, keybindingItemEntry.commandLabelMatches);
		}
		if (keybindingItemEntry.commandDefaultLabelMatches) {
			commandLabel = new HighlightedLabel(DOM.append(this.commandColumn, $('.command-default-label')), false);
			commandLabel.set(keybindingItem.commandDefaultLabel, keybindingItemEntry.commandDefaultLabelMatches);
		}
		if (keybindingItemEntry.commandIdMatches || !keybindingItem.commandLabel) {
			commandLabel = new HighlightedLabel(DOM.append(this.commandColumn, $('.code')), false);
			commandLabel.set(keybindingItem.command, keybindingItemEntry.commandIdMatches);
		}
		if (commandLabel) {
			commandLabel.element.title = keybindingItem.commandLabel ? localize('title', "{0} ({1})", keybindingItem.commandLabel, keybindingItem.command) : keybindingItem.command;
		}
	}

	private getAriaLabel(keybindingItemEntry: IKeybindingItemEntry): string {
		return localize('commandAriaLabel', "Command is {0}.", keybindingItemEntry.keybindingItem.commandLabel ? keybindingItemEntry.keybindingItem.commandLabel : keybindingItemEntry.keybindingItem.command);
	}
}

class KeybindingColumn extends Column {

	private keybindingColumn: HTMLElement;

	create(parent: HTMLElement): HTMLElement {
		this.keybindingColumn = DOM.append(parent, $('.column.keybinding', { id: 'keybinding_' + ++Column.COUNTER }));
		return this.keybindingColumn;
	}

	render(keybindingItemEntry: IKeybindingItemEntry): void {
		DOM.clearNode(this.keybindingColumn);
		this.keybindingColumn.setAttribute('aria-label', this.getAriaLabel(keybindingItemEntry));
		if (keybindingItemEntry.keybindingItem.keybinding) {
			new KeybindingLabel(this.keybindingColumn, OS).set(keybindingItemEntry.keybindingItem.keybinding, keybindingItemEntry.keybindingMatches);
		}
	}

	private getAriaLabel(keybindingItemEntry: IKeybindingItemEntry): string {
		return keybindingItemEntry.keybindingItem.keybinding ? localize('keybindingAriaLabel', "Keybinding is {0}.", keybindingItemEntry.keybindingItem.keybinding.getAriaLabel()) : localize('noKeybinding', "No Keybinding assigned.");
	}
}

class SourceColumn extends Column {

	private sourceColumn: HTMLElement;

	create(parent: HTMLElement): HTMLElement {
		this.sourceColumn = DOM.append(parent, $('.column.source', { id: 'source_' + ++Column.COUNTER }));
		return this.sourceColumn;
	}

	render(keybindingItemEntry: IKeybindingItemEntry): void {
		DOM.clearNode(this.sourceColumn);
		this.sourceColumn.setAttribute('aria-label', this.getAriaLabel(keybindingItemEntry));
		new HighlightedLabel(this.sourceColumn, false).set(keybindingItemEntry.keybindingItem.source, keybindingItemEntry.sourceMatches);
	}

	private getAriaLabel(keybindingItemEntry: IKeybindingItemEntry): string {
		return localize('sourceAriaLabel', "Source is {0}.", keybindingItemEntry.keybindingItem.source);
	}
}

class WhenColumn extends Column {

	private whenColumn: HTMLElement;

	create(parent: HTMLElement): HTMLElement {
		const column = DOM.append(parent, $('.column.when'));
		this.whenColumn = DOM.append(column, $('div', { id: 'when_' + ++Column.COUNTER }));
		return this.whenColumn;
	}

	render(keybindingItemEntry: IKeybindingItemEntry): void {
		DOM.clearNode(this.whenColumn);
		this.whenColumn.setAttribute('aria-label', this.getAriaLabel(keybindingItemEntry));
		DOM.toggleClass(this.whenColumn, 'code', !!keybindingItemEntry.keybindingItem.when);
		DOM.toggleClass(this.whenColumn, 'empty', !keybindingItemEntry.keybindingItem.when);
		if (keybindingItemEntry.keybindingItem.when) {
			const whenLabel = new HighlightedLabel(this.whenColumn, false);
			whenLabel.set(keybindingItemEntry.keybindingItem.when, keybindingItemEntry.whenMatches);
			this.whenColumn.title = keybindingItemEntry.keybindingItem.when;
			whenLabel.element.title = keybindingItemEntry.keybindingItem.when;
		} else {
			this.whenColumn.textContent = '—';
		}
	}

	private getAriaLabel(keybindingItemEntry: IKeybindingItemEntry): string {
		return keybindingItemEntry.keybindingItem.when ? localize('whenAriaLabel', "When is {0}.", keybindingItemEntry.keybindingItem.when) : localize('noWhen', "No when context.");
	}
}

registerThemingParticipant((theme: ITheme, collector: ICssStyleCollector) => {
	const listHighlightForegroundColor = theme.getColor(listHighlightForeground);
	if (listHighlightForegroundColor) {
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list-row > .column .highlight { color: ${listHighlightForegroundColor}; }`);
	}
});
