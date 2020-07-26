/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/keybindingsEditor';
import { localize } from 'vs/nls';
import { Delayer } from 'vs/base/common/async';
import * as DOM from 'vs/base/browser/dom';
import { OS } from 'vs/base/common/platform';
import { dispose, Disposable, IDisposable, combinedDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { CheckboxActionViewItem } from 'vs/base/browser/ui/checkbox/checkbox';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { KeybindingLabel } from 'vs/base/browser/ui/keybindingLabel/keybindingLabel';
import { IAction, Action, Separator } from 'vs/base/common/actions';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { BaseEditor } from 'vs/workbench/browser/parts/editor/baseEditor';
import { EditorOptions } from 'vs/workbench/common/editor';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { KeybindingsEditorModel, IKeybindingItemEntry, IListEntry, KEYBINDING_ENTRY_TEMPLATE_ID } from 'vs/workbench/services/preferences/common/keybindingsEditorModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService, IUserFriendlyKeybinding } from 'vs/platform/keybinding/common/keybinding';
import { DefineKeybindingWidget, KeybindingsSearchWidget, KeybindingsSearchOptions } from 'vs/workbench/contrib/preferences/browser/keybindingWidgets';
import { IKeybindingsEditorPane, CONTEXT_KEYBINDING_FOCUS, CONTEXT_KEYBINDINGS_EDITOR, CONTEXT_KEYBINDINGS_SEARCH_FOCUS, KEYBINDINGS_EDITOR_COMMAND_RECORD_SEARCH_KEYS, KEYBINDINGS_EDITOR_COMMAND_SORTBY_PRECEDENCE, KEYBINDINGS_EDITOR_COMMAND_DEFINE, KEYBINDINGS_EDITOR_COMMAND_REMOVE, KEYBINDINGS_EDITOR_COMMAND_RESET, KEYBINDINGS_EDITOR_COMMAND_COPY, KEYBINDINGS_EDITOR_COMMAND_COPY_COMMAND, KEYBINDINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS, KEYBINDINGS_EDITOR_COMMAND_DEFINE_WHEN, KEYBINDINGS_EDITOR_COMMAND_SHOW_SIMILAR } from 'vs/workbench/contrib/preferences/common/preferences';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingEditingService } from 'vs/workbench/services/keybinding/common/keybindingEditing';
import { IListVirtualDelegate, IListRenderer, IListContextMenuEvent, IListEvent } from 'vs/base/browser/ui/list/list';
import { IThemeService, registerThemingParticipant, IColorTheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { IContextKeyService, IContextKey, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { StandardKeyboardEvent, IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode, ResolvedKeybinding } from 'vs/base/common/keyCodes';
import { listHighlightForeground, badgeBackground, contrastBorder, badgeForeground, listActiveSelectionForeground, listInactiveSelectionForeground, listHoverForeground, listFocusForeground, editorBackground, foreground, listActiveSelectionBackground, listInactiveSelectionBackground, listFocusBackground, listHoverBackground } from 'vs/platform/theme/common/colorRegistry';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { KeybindingsEditorInput } from 'vs/workbench/services/preferences/common/preferencesEditorInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { attachStylerCallback, attachInputBoxStyler } from 'vs/platform/theme/common/styler';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { InputBox, MessageType } from 'vs/base/browser/ui/inputbox/inputBox';
import { Emitter, Event } from 'vs/base/common/event';
import { MenuRegistry, MenuId, isIMenuItem } from 'vs/platform/actions/common/actions';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { preferencesEditIcon } from 'vs/workbench/contrib/preferences/browser/preferencesWidgets';
import { Color, RGBA } from 'vs/base/common/color';
import { WORKBENCH_BACKGROUND } from 'vs/workbench/common/theme';
import { ThemableCheckboxActionViewItem } from 'vs/platform/browser/checkbox';

const $ = DOM.$;

interface ColumnItem {
	column: HTMLElement;
	proportion?: number;
	width: number;
}

const oddRowBackgroundColor = new Color(new RGBA(130, 130, 130, 0.04));

export class KeybindingsEditor extends BaseEditor implements IKeybindingsEditorPane {

	static readonly ID: string = 'workbench.editor.keybindings';

	private _onDefineWhenExpression: Emitter<IKeybindingItemEntry> = this._register(new Emitter<IKeybindingItemEntry>());
	readonly onDefineWhenExpression: Event<IKeybindingItemEntry> = this._onDefineWhenExpression.event;

	private _onLayout: Emitter<void> = this._register(new Emitter<void>());
	readonly onLayout: Event<void> = this._onLayout.event;

	private keybindingsEditorModel: KeybindingsEditorModel | null = null;

	private headerContainer!: HTMLElement;
	private actionsContainer!: HTMLElement;
	private searchWidget!: KeybindingsSearchWidget;

	private overlayContainer!: HTMLElement;
	private defineKeybindingWidget!: DefineKeybindingWidget;

	private columnItems: ColumnItem[] = [];
	private keybindingsListContainer!: HTMLElement;
	private unAssignedKeybindingItemToRevealAndFocus: IKeybindingItemEntry | null = null;
	private listEntries: IListEntry[] = [];
	private keybindingsList!: WorkbenchList<IListEntry>;

	private dimension: DOM.Dimension | null = null;
	private delayedFiltering: Delayer<void>;
	private latestEmptyFilters: string[] = [];
	private delayedFilterLogging: Delayer<void>;
	private keybindingsEditorContextKey: IContextKey<boolean>;
	private keybindingFocusContextKey: IContextKey<boolean>;
	private searchFocusContextKey: IContextKey<boolean>;

	private readonly sortByPrecedenceAction: Action;
	private readonly recordKeysAction: Action;

	private ariaLabelElement!: HTMLElement;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IKeybindingService private readonly keybindingsService: IKeybindingService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IKeybindingEditingService private readonly keybindingEditingService: IKeybindingEditingService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@INotificationService private readonly notificationService: INotificationService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService,
		@IStorageService storageService: IStorageService
	) {
		super(KeybindingsEditor.ID, telemetryService, themeService, storageService);
		this.delayedFiltering = new Delayer<void>(300);
		this._register(keybindingsService.onDidUpdateKeybindings(() => this.render(!!this.keybindingFocusContextKey.get())));

		this.keybindingsEditorContextKey = CONTEXT_KEYBINDINGS_EDITOR.bindTo(this.contextKeyService);
		this.searchFocusContextKey = CONTEXT_KEYBINDINGS_SEARCH_FOCUS.bindTo(this.contextKeyService);
		this.keybindingFocusContextKey = CONTEXT_KEYBINDING_FOCUS.bindTo(this.contextKeyService);
		this.delayedFilterLogging = new Delayer<void>(1000);

		const recordKeysActionKeybinding = this.keybindingsService.lookupKeybinding(KEYBINDINGS_EDITOR_COMMAND_RECORD_SEARCH_KEYS);
		const recordKeysActionLabel = localize('recordKeysLabel', "Record Keys");
		this.recordKeysAction = new Action(KEYBINDINGS_EDITOR_COMMAND_RECORD_SEARCH_KEYS, recordKeysActionKeybinding ? localize('recordKeysLabelWithKeybinding', "{0} ({1})", recordKeysActionLabel, recordKeysActionKeybinding.getLabel()) : recordKeysActionLabel, 'codicon-record-keys');
		this.recordKeysAction.checked = false;

		const sortByPrecedenceActionKeybinding = this.keybindingsService.lookupKeybinding(KEYBINDINGS_EDITOR_COMMAND_SORTBY_PRECEDENCE);
		const sortByPrecedenceActionLabel = localize('sortByPrecedeneLabel', "Sort by Precedence");
		this.sortByPrecedenceAction = new Action('keybindings.editor.sortByPrecedence', sortByPrecedenceActionKeybinding ? localize('sortByPrecedeneLabelWithKeybinding', "{0} ({1})", sortByPrecedenceActionLabel, sortByPrecedenceActionKeybinding.getLabel()) : sortByPrecedenceActionLabel, 'codicon-sort-precedence');
		this.sortByPrecedenceAction.checked = false;
	}

	createEditor(parent: HTMLElement): void {
		const keybindingsEditorElement = DOM.append(parent, $('div', { class: 'keybindings-editor' }));

		this.createAriaLabelElement(keybindingsEditorElement);
		this.createOverlayContainer(keybindingsEditorElement);
		this.createHeader(keybindingsEditorElement);
		this.createBody(keybindingsEditorElement);
	}

	setInput(input: KeybindingsEditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {
		this.keybindingsEditorContextKey.set(true);
		return super.setInput(input, options, token)
			.then(() => this.render(!!(options && options.preserveFocus)));
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

		this.columnItems.forEach(columnItem => {
			if (columnItem.proportion) {
				columnItem.width = 0;
			}
		});
		this.layoutKeybindingsList();
		this._onLayout.fire();
	}

	layoutColumns(columns: HTMLElement[]): void {
		if (this.columnItems) {
			columns.forEach((column, index) => {
				column.style.paddingRight = `6px`;
				column.style.width = `${this.columnItems[index].width}px`;
			});
		}
	}

	focus(): void {
		const activeKeybindingEntry = this.activeKeybindingEntry;
		if (activeKeybindingEntry) {
			this.selectEntry(activeKeybindingEntry);
		} else {
			this.searchWidget.focus();
		}
	}

	get activeKeybindingEntry(): IKeybindingItemEntry | null {
		const focusedElement = this.keybindingsList.getFocusedElements()[0];
		return focusedElement && focusedElement.templateId === KEYBINDING_ENTRY_TEMPLATE_ID ? <IKeybindingItemEntry>focusedElement : null;
	}

	defineKeybinding(keybindingEntry: IKeybindingItemEntry): Promise<any> {
		this.selectEntry(keybindingEntry);
		this.showOverlayContainer();
		return this.defineKeybindingWidget.define().then(key => {
			if (key) {
				this.reportKeybindingAction(KEYBINDINGS_EDITOR_COMMAND_DEFINE, keybindingEntry.keybindingItem.command, key);
				return this.updateKeybinding(keybindingEntry, key, keybindingEntry.keybindingItem.when);
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

	defineWhenExpression(keybindingEntry: IKeybindingItemEntry): void {
		if (keybindingEntry.keybindingItem.keybinding) {
			this.selectEntry(keybindingEntry);
			this._onDefineWhenExpression.fire(keybindingEntry);
		}
	}

	updateKeybinding(keybindingEntry: IKeybindingItemEntry, key: string, when: string | undefined): Promise<any> {
		const currentKey = keybindingEntry.keybindingItem.keybinding ? keybindingEntry.keybindingItem.keybinding.getUserSettingsLabel() : '';
		if (currentKey !== key || keybindingEntry.keybindingItem.when !== when) {
			return this.keybindingEditingService.editKeybinding(keybindingEntry.keybindingItem.keybindingItem, key, when || undefined)
				.then(() => {
					if (!keybindingEntry.keybindingItem.keybinding) { // reveal only if keybinding was added to unassinged. Because the entry will be placed in different position after rendering
						this.unAssignedKeybindingItemToRevealAndFocus = keybindingEntry;
					}
				});
		}
		return Promise.resolve();
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

	async copyKeybinding(keybinding: IKeybindingItemEntry): Promise<void> {
		this.selectEntry(keybinding);
		this.reportKeybindingAction(KEYBINDINGS_EDITOR_COMMAND_COPY, keybinding.keybindingItem.command, keybinding.keybindingItem.keybinding);
		const userFriendlyKeybinding: IUserFriendlyKeybinding = {
			key: keybinding.keybindingItem.keybinding ? keybinding.keybindingItem.keybinding.getUserSettingsLabel() || '' : '',
			command: keybinding.keybindingItem.command
		};
		if (keybinding.keybindingItem.when) {
			userFriendlyKeybinding.when = keybinding.keybindingItem.when;
		}
		await this.clipboardService.writeText(JSON.stringify(userFriendlyKeybinding, null, '  '));
	}

	async copyKeybindingCommand(keybinding: IKeybindingItemEntry): Promise<void> {
		this.selectEntry(keybinding);
		this.reportKeybindingAction(KEYBINDINGS_EDITOR_COMMAND_COPY_COMMAND, keybinding.keybindingItem.command, keybinding.keybindingItem.keybinding);
		await this.clipboardService.writeText(keybinding.keybindingItem.command);
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
		this._register(this.defineKeybindingWidget.onDidChange(keybindingStr => this.defineKeybindingWidget.printExisting(this.keybindingsEditorModel!.fetch(`"${keybindingStr}"`).length)));
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

		const clearInputAction = new Action(KEYBINDINGS_EDITOR_COMMAND_CLEAR_SEARCH_RESULTS, localize('clearInput', "Clear Keybindings Search Input"), 'codicon-clear-all', false, () => { this.search(''); return Promise.resolve(null); });

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
			this.updateSearchOptions();
		}));
		this._register(this.searchWidget.onEscape(() => this.recordKeysAction.checked = false));

		this.actionsContainer = DOM.append(searchContainer, DOM.$('.keybindings-search-actions-container'));
		const recordingBadge = this.createRecordingBadge(this.actionsContainer);

		this._register(this.sortByPrecedenceAction.onDidChange(e => {
			if (e.checked !== undefined) {
				this.renderKeybindingsEntries(false);
			}
			this.updateSearchOptions();
		}));

		this._register(this.recordKeysAction.onDidChange(e => {
			if (e.checked !== undefined) {
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
				this.updateSearchOptions();
			}
		}));

		const actionBar = this._register(new ActionBar(this.actionsContainer, {
			animated: false,
			actionViewItemProvider: (action: IAction) => {
				let checkboxViewItem: CheckboxActionViewItem | undefined;
				if (action.id === this.sortByPrecedenceAction.id) {
					checkboxViewItem = new ThemableCheckboxActionViewItem(null, action, undefined, this.themeService);
				}
				else if (action.id === this.recordKeysAction.id) {
					checkboxViewItem = new ThemableCheckboxActionViewItem(null, action, undefined, this.themeService);
				}
				if (checkboxViewItem) {

				}
				return checkboxViewItem;
			}
		}));

		actionBar.push([this.recordKeysAction, this.sortByPrecedenceAction, clearInputAction], { label: false, icon: true });
	}

	private updateSearchOptions(): void {
		const keybindingsEditorInput = this.input as KeybindingsEditorInput;
		if (keybindingsEditorInput) {
			keybindingsEditorInput.searchOptions = {
				searchValue: this.searchWidget.getValue(),
				recordKeybindings: !!this.recordKeysAction.checked,
				sortByPrecedence: !!this.sortByPrecedenceAction.checked
			};
		}
	}

	private createRecordingBadge(container: HTMLElement): HTMLElement {
		const recordingBadge = DOM.append(container, DOM.$('.recording-badge.monaco-count-badge.long.disabled'));
		recordingBadge.textContent = localize('recording', "Recording Keys");
		this._register(attachStylerCallback(this.themeService, { badgeBackground, contrastBorder, badgeForeground }, colors => {
			const background = colors.badgeBackground ? colors.badgeBackground.toString() : '';
			const border = colors.contrastBorder ? colors.contrastBorder.toString() : '';
			const color = colors.badgeForeground ? colors.badgeForeground.toString() : '';

			recordingBadge.style.backgroundColor = background;
			recordingBadge.style.borderWidth = border ? '1px' : '';
			recordingBadge.style.borderStyle = border ? 'solid' : '';
			recordingBadge.style.borderColor = border;
			recordingBadge.style.color = color ? color.toString() : '';
		}));
		return recordingBadge;
	}

	private layoutSearchWidget(dimension: DOM.Dimension): void {
		this.searchWidget.layout(dimension);
		DOM.toggleClass(this.headerContainer, 'small', dimension.width < 400);
		this.searchWidget.inputBox.inputElement.style.paddingRight = `${DOM.getTotalWidth(this.actionsContainer) + 12}px`;
	}

	private createBody(parent: HTMLElement): void {
		const bodyContainer = DOM.append(parent, $('.keybindings-body'));
		this.createListHeader(bodyContainer);
		this.createList(bodyContainer);
	}

	private createListHeader(parent: HTMLElement): void {
		const keybindingsListHeader = DOM.append(parent, $('.keybindings-list-header'));
		keybindingsListHeader.style.height = '30px';
		keybindingsListHeader.style.lineHeight = '30px';

		this.columnItems = [];
		let column = $('.header.actions');
		this.columnItems.push({ column, width: 30 });

		column = $('.header.command', undefined, localize('command', "Command"));
		this.columnItems.push({ column, proportion: 0.3, width: 0 });

		column = $('.header.keybinding', undefined, localize('keybinding', "Keybinding"));
		this.columnItems.push({ column, proportion: 0.2, width: 0 });

		column = $('.header.when', undefined, localize('when', "When"));
		this.columnItems.push({ column, proportion: 0.4, width: 0 });

		column = $('.header.source', undefined, localize('source', "Source"));
		this.columnItems.push({ column, proportion: 0.1, width: 0 });

		DOM.append(keybindingsListHeader, ...this.columnItems.map(({ column }) => column));
	}

	private createList(parent: HTMLElement): void {
		this.keybindingsListContainer = DOM.append(parent, $('.keybindings-list-container'));
		this.keybindingsList = this._register(this.instantiationService.createInstance(WorkbenchList, 'KeybindingsEditor', this.keybindingsListContainer, new Delegate(), [new KeybindingItemRenderer(this, this.instantiationService)], {
			identityProvider: { getId: (e: IListEntry) => e.id },
			setRowLineHeight: false,
			horizontalScrolling: false,
			accessibilityProvider: new AccessibilityProvider(),
			keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: (e: IKeybindingItemEntry) => e.keybindingItem.commandLabel || e.keybindingItem.command },
			overrideStyles: {
				listBackground: editorBackground
			}
		})) as WorkbenchList<IListEntry>;

		this._register(this.keybindingsList.onContextMenu(e => this.onContextMenu(e)));
		this._register(this.keybindingsList.onDidChangeFocus(e => this.onFocusChange(e)));
		this._register(this.keybindingsList.onDidFocus(() => {
			DOM.addClass(this.keybindingsList.getHTMLElement(), 'focused');
		}));
		this._register(this.keybindingsList.onDidBlur(() => {
			DOM.removeClass(this.keybindingsList.getHTMLElement(), 'focused');
			this.keybindingFocusContextKey.reset();
		}));
		this._register(this.keybindingsList.onMouseDblClick(() => {
			const activeKeybindingEntry = this.activeKeybindingEntry;
			if (activeKeybindingEntry) {
				this.defineKeybinding(activeKeybindingEntry);
			}
		}));
		this._register(this.keybindingsList.onKeyDown(e => {
			const event = new StandardKeyboardEvent(e);
			if (event.keyCode === KeyCode.Enter) {
				const keybindingEntry = this.activeKeybindingEntry;
				if (keybindingEntry) {
					this.defineKeybinding(keybindingEntry);
				}
				e.stopPropagation();
			}
		}));
	}

	private async render(preserveFocus: boolean): Promise<void> {
		if (this.input) {
			const input: KeybindingsEditorInput = this.input as KeybindingsEditorInput;
			this.keybindingsEditorModel = await input.resolve();
			await this.keybindingsEditorModel.resolve(this.getActionsLabels());
			this.renderKeybindingsEntries(false, preserveFocus);
			if (input.searchOptions) {
				this.recordKeysAction.checked = input.searchOptions.recordKeybindings;
				this.sortByPrecedenceAction.checked = input.searchOptions.sortByPrecedence;
				this.searchWidget.setValue(input.searchOptions.searchValue);
			} else {
				this.updateSearchOptions();
			}
		}
	}

	private getActionsLabels(): Map<string, string> {
		const actionsLabels: Map<string, string> = new Map<string, string>();
		EditorExtensionsRegistry.getEditorActions().forEach(editorAction => actionsLabels.set(editorAction.id, editorAction.label));
		for (const menuItem of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
			if (isIMenuItem(menuItem)) {
				const title = typeof menuItem.command.title === 'string' ? menuItem.command.title : menuItem.command.title.value;
				const category = menuItem.command.category ? typeof menuItem.command.category === 'string' ? menuItem.command.category : menuItem.command.category.value : undefined;
				actionsLabels.set(menuItem.command.id, category ? `${category}: ${title}` : title);
			}
		}
		return actionsLabels;
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
			this.listEntries = keybindingsEntries;
			this.keybindingsList.splice(0, this.keybindingsList.length, this.listEntries);
			this.layoutKeybindingsList();

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
					this.selectEntry(currentSelectedIndex, preserveFocus);
				} else if (this.editorService.activeEditorPane === this && !preserveFocus) {
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

	private layoutKeybindingsList(): void {
		if (!this.dimension) {
			return;
		}
		let width = this.dimension.width - 27;
		for (const columnItem of this.columnItems) {
			if (columnItem.width && !columnItem.proportion) {
				width = width - columnItem.width;
			}
		}
		for (const columnItem of this.columnItems) {
			if (columnItem.proportion && !columnItem.width) {
				columnItem.width = width * columnItem.proportion;
			}
		}

		this.layoutColumns(this.columnItems.map(({ column }) => column));
		const listHeight = this.dimension.height - (DOM.getDomNodePagePosition(this.headerContainer).height + 12 /*padding*/ + 30 /*list header*/);
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

	private selectEntry(keybindingItemEntry: IKeybindingItemEntry | number, focus: boolean = true): void {
		const index = typeof keybindingItemEntry === 'number' ? keybindingItemEntry : this.getIndexOf(keybindingItemEntry);
		if (index !== -1) {
			if (focus) {
				this.keybindingsList.getHTMLElement().focus();
				this.keybindingsList.setFocus([index]);
			}
			this.keybindingsList.setSelection([index]);
		}
	}

	focusKeybindings(): void {
		this.keybindingsList.getHTMLElement().focus();
		const currentFocusIndices = this.keybindingsList.getFocus();
		this.keybindingsList.setFocus([currentFocusIndices.length ? currentFocusIndices[0] : 0]);
	}

	selectKeybinding(keybindingItemEntry: IKeybindingItemEntry): void {
		this.selectEntry(keybindingItemEntry);
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
					this.createDefineWhenExpressionAction(<IKeybindingItemEntry>e.element),
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

	private createDefineWhenExpressionAction(keybindingItemEntry: IKeybindingItemEntry): IAction {
		return <IAction>{
			label: localize('editWhen', "Change When Expression"),
			enabled: !!keybindingItemEntry.keybindingItem.keybinding,
			id: KEYBINDINGS_EDITOR_COMMAND_DEFINE_WHEN,
			run: () => this.defineWhenExpression(keybindingItemEntry)
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
			label: localize('copyCommandLabel', "Copy Command ID"),
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
		return 24;
	}

	getTemplateId(element: IListEntry) {
		return element.templateId;
	}
}

interface KeybindingItemTemplate {
	parent: HTMLElement;
	columns: Column[];
	disposable: IDisposable;
}

class KeybindingItemRenderer implements IListRenderer<IKeybindingItemEntry, KeybindingItemTemplate> {

	get templateId(): string { return KEYBINDING_ENTRY_TEMPLATE_ID; }

	constructor(
		private keybindingsEditor: KeybindingsEditor,
		private instantiationService: IInstantiationService
	) { }

	renderTemplate(parent: HTMLElement): KeybindingItemTemplate {
		DOM.addClass(parent, 'keybinding-item');

		const actions = this.instantiationService.createInstance(ActionsColumn, parent, this.keybindingsEditor);
		const command = this.instantiationService.createInstance(CommandColumn, parent, this.keybindingsEditor);
		const keybinding = this.instantiationService.createInstance(KeybindingColumn, parent, this.keybindingsEditor);
		const when = this.instantiationService.createInstance(WhenColumn, parent, this.keybindingsEditor);
		const source = this.instantiationService.createInstance(SourceColumn, parent, this.keybindingsEditor);

		const columns: Column[] = [actions, command, keybinding, when, source];
		const disposables = combinedDisposable(...columns);
		const elements = columns.map(({ element }) => element);

		this.keybindingsEditor.layoutColumns(elements);
		this.keybindingsEditor.onLayout(() => this.keybindingsEditor.layoutColumns(elements));

		return {
			parent,
			columns,
			disposable: disposables
		};
	}

	renderElement(keybindingEntry: IKeybindingItemEntry, index: number, template: KeybindingItemTemplate): void {
		DOM.toggleClass(template.parent, 'odd', index % 2 === 1);
		for (const column of template.columns) {
			column.render(keybindingEntry);
		}
	}

	disposeTemplate(template: KeybindingItemTemplate): void {
		template.disposable.dispose();
	}
}

abstract class Column extends Disposable {

	static COUNTER = 0;

	abstract readonly element: HTMLElement;
	abstract render(keybindingItemEntry: IKeybindingItemEntry): void;

	constructor(protected keybindingsEditor: IKeybindingsEditorPane) {
		super();
	}

}

class ActionsColumn extends Column {

	private readonly actionBar: ActionBar;
	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		keybindingsEditor: IKeybindingsEditorPane,
		@IKeybindingService private keybindingsService: IKeybindingService
	) {
		super(keybindingsEditor);
		this.element = DOM.append(parent, $('.column.actions', { id: 'actions_' + ++Column.COUNTER }));
		this.actionBar = new ActionBar(this.element, { animated: false });
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
			class: preferencesEditIcon.classNames,
			enabled: true,
			id: 'editKeybinding',
			tooltip: keybinding ? localize('editKeybindingLabelWithKey', "Change Keybinding {0}", `(${keybinding.getLabel()})`) : localize('editKeybindingLabel', "Change Keybinding"),
			run: () => this.keybindingsEditor.defineKeybinding(keybindingItemEntry)
		};
	}

	private createAddAction(keybindingItemEntry: IKeybindingItemEntry): IAction {
		const keybinding = this.keybindingsService.lookupKeybinding(KEYBINDINGS_EDITOR_COMMAND_DEFINE);
		return <IAction>{
			class: 'codicon-add',
			enabled: true,
			id: 'addKeybinding',
			tooltip: keybinding ? localize('addKeybindingLabelWithKey', "Add Keybinding {0}", `(${keybinding.getLabel()})`) : localize('addKeybindingLabel', "Add Keybinding"),
			run: () => this.keybindingsEditor.defineKeybinding(keybindingItemEntry)
		};
	}

	dispose(): void {
		super.dispose();
		dispose(this.actionBar);
	}
}

class CommandColumn extends Column {

	private readonly commandColumn: HTMLElement;
	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		keybindingsEditor: IKeybindingsEditorPane,
	) {
		super(keybindingsEditor);
		this.element = this.commandColumn = DOM.append(parent, $('.column.command', { id: 'command_' + ++Column.COUNTER }));
	}

	render(keybindingItemEntry: IKeybindingItemEntry): void {
		DOM.clearNode(this.commandColumn);
		const keybindingItem = keybindingItemEntry.keybindingItem;
		const commandIdMatched = !!(keybindingItem.commandLabel && keybindingItemEntry.commandIdMatches);
		const commandDefaultLabelMatched = !!keybindingItemEntry.commandDefaultLabelMatches;
		DOM.toggleClass(this.commandColumn, 'vertical-align-column', commandIdMatched || commandDefaultLabelMatched);
		let commandLabel: HighlightedLabel | undefined;
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
}

class KeybindingColumn extends Column {

	private readonly keybindingLabel: HTMLElement;
	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		keybindingsEditor: IKeybindingsEditorPane,
	) {
		super(keybindingsEditor);

		this.element = DOM.append(parent, $('.column.keybinding', { id: 'keybinding_' + ++Column.COUNTER }));
		this.keybindingLabel = DOM.append(this.element, $('div.keybinding-label'));
	}

	render(keybindingItemEntry: IKeybindingItemEntry): void {
		DOM.clearNode(this.keybindingLabel);
		if (keybindingItemEntry.keybindingItem.keybinding) {
			new KeybindingLabel(this.keybindingLabel, OS).set(keybindingItemEntry.keybindingItem.keybinding, keybindingItemEntry.keybindingMatches);
		}
	}
}

class SourceColumn extends Column {

	private readonly sourceColumn: HTMLElement;
	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		keybindingsEditor: IKeybindingsEditorPane,
	) {
		super(keybindingsEditor);
		this.element = this.sourceColumn = DOM.append(parent, $('.column.source', { id: 'source_' + ++Column.COUNTER }));
	}

	render(keybindingItemEntry: IKeybindingItemEntry): void {
		DOM.clearNode(this.sourceColumn);
		new HighlightedLabel(this.sourceColumn, false).set(keybindingItemEntry.keybindingItem.source, keybindingItemEntry.sourceMatches);
	}
}

class WhenColumn extends Column {

	readonly element: HTMLElement;
	private readonly whenLabel: HTMLElement;
	private readonly whenInput: InputBox;
	private readonly renderDisposables = this._register(new DisposableStore());

	private _onDidAccept: Emitter<void> = this._register(new Emitter<void>());
	private readonly onDidAccept: Event<void> = this._onDidAccept.event;

	private _onDidReject: Emitter<void> = this._register(new Emitter<void>());
	private readonly onDidReject: Event<void> = this._onDidReject.event;

	constructor(
		parent: HTMLElement,
		keybindingsEditor: IKeybindingsEditorPane,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly themeService: IThemeService
	) {
		super(keybindingsEditor);

		this.element = DOM.append(parent, $('.column.when', { id: 'when_' + ++Column.COUNTER }));

		this.whenLabel = DOM.append(this.element, $('div.when-label'));
		this.whenInput = new InputBox(this.element, this.contextViewService, {
			validationOptions: {
				validation: (value) => {
					try {
						ContextKeyExpr.deserialize(value, true);
					} catch (error) {
						return {
							content: error.message,
							formatContent: true,
							type: MessageType.ERROR
						};
					}
					return null;
				}
			},
			ariaLabel: localize('whenContextInputAriaLabel', "Type when context. Press Enter to confirm or Escape to cancel.")
		});
		this._register(attachInputBoxStyler(this.whenInput, this.themeService));
		this._register(DOM.addStandardDisposableListener(this.whenInput.inputElement, DOM.EventType.KEY_DOWN, e => this.onInputKeyDown(e)));
		this._register(DOM.addDisposableListener(this.whenInput.inputElement, DOM.EventType.BLUR, () => this.cancelEditing()));
	}

	private onInputKeyDown(e: IKeyboardEvent): void {
		let handled = false;
		if (e.equals(KeyCode.Enter)) {
			this.finishEditing();
			handled = true;
		} else if (e.equals(KeyCode.Escape)) {
			this.cancelEditing();
			handled = true;
		}
		if (handled) {
			e.preventDefault();
			e.stopPropagation();
		}
	}

	private startEditing(): void {
		DOM.addClass(this.element, 'input-mode');
		this.whenInput.focus();
		this.whenInput.select();
	}

	private finishEditing(): void {
		DOM.removeClass(this.element, 'input-mode');
		this._onDidAccept.fire();
	}

	private cancelEditing(): void {
		DOM.removeClass(this.element, 'input-mode');
		this._onDidReject.fire();
	}

	render(keybindingItemEntry: IKeybindingItemEntry): void {
		this.renderDisposables.clear();
		DOM.clearNode(this.whenLabel);

		this.keybindingsEditor.onDefineWhenExpression(e => {
			if (keybindingItemEntry === e) {
				this.startEditing();
			}
		}, this, this.renderDisposables);
		this.whenInput.value = keybindingItemEntry.keybindingItem.when || '';
		DOM.toggleClass(this.whenLabel, 'code', !!keybindingItemEntry.keybindingItem.when);
		DOM.toggleClass(this.whenLabel, 'empty', !keybindingItemEntry.keybindingItem.when);
		if (keybindingItemEntry.keybindingItem.when) {
			const whenLabel = new HighlightedLabel(this.whenLabel, false);
			whenLabel.set(keybindingItemEntry.keybindingItem.when, keybindingItemEntry.whenMatches);
			this.element.title = keybindingItemEntry.keybindingItem.when;
			whenLabel.element.title = keybindingItemEntry.keybindingItem.when;
		} else {
			this.whenLabel.textContent = '—';
			this.element.title = '';
		}
		this.onDidAccept(() => {
			this.keybindingsEditor.updateKeybinding(keybindingItemEntry, keybindingItemEntry.keybindingItem.keybinding ? keybindingItemEntry.keybindingItem.keybinding.getUserSettingsLabel() || '' : '', this.whenInput.value);
			this.keybindingsEditor.selectKeybinding(keybindingItemEntry);
		}, this, this.renderDisposables);
		this.onDidReject(() => {
			this.whenInput.value = keybindingItemEntry.keybindingItem.when || '';
			this.keybindingsEditor.selectKeybinding(keybindingItemEntry);
		}, this, this.renderDisposables);
	}
}

class AccessibilityProvider implements IListAccessibilityProvider<IKeybindingItemEntry> {

	getWidgetAriaLabel(): string {
		return localize('keybindingsLabel', "Keybindings");
	}

	getAriaLabel(keybindingItemEntry: IKeybindingItemEntry): string {
		let ariaLabel = keybindingItemEntry.keybindingItem.commandLabel ? keybindingItemEntry.keybindingItem.commandLabel : keybindingItemEntry.keybindingItem.command;
		ariaLabel += ', ' + (keybindingItemEntry.keybindingItem.keybinding?.getAriaLabel() || localize('noKeybinding', "No Keybinding assigned."));
		ariaLabel += ', ' + keybindingItemEntry.keybindingItem.source;
		ariaLabel += ', ' + keybindingItemEntry.keybindingItem.when ? keybindingItemEntry.keybindingItem.when : localize('noWhen', "No when context.");
		return ariaLabel;
	}

}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-header { background-color: ${oddRowBackgroundColor}; }`);
	collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list-row.odd:not(.focused):not(.selected):not(:hover) { background-color: ${oddRowBackgroundColor}; }`);
	collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:not(:focus) .monaco-list-row.focused.odd:not(.selected):not(:hover) { background-color: ${oddRowBackgroundColor}; }`);
	collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:not(.focused) .monaco-list-row.focused.odd:not(.selected):not(:hover) { background-color: ${oddRowBackgroundColor}; }`);

	const foregroundColor = theme.getColor(foreground);
	if (foregroundColor) {
		const whenForegroundColor = foregroundColor.transparent(.8).makeOpaque(WORKBENCH_BACKGROUND(theme));
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list-row > .column > .code { color: ${whenForegroundColor}; }`);
		const whenForegroundColorForOddRow = foregroundColor.transparent(.8).makeOpaque(oddRowBackgroundColor);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list-row.odd > .column > .code { color: ${whenForegroundColorForOddRow}; }`);
	}

	const listActiveSelectionForegroundColor = theme.getColor(listActiveSelectionForeground);
	const listActiveSelectionBackgroundColor = theme.getColor(listActiveSelectionBackground);
	if (listActiveSelectionForegroundColor && listActiveSelectionBackgroundColor) {
		const whenForegroundColor = listActiveSelectionForegroundColor.transparent(.8).makeOpaque(listActiveSelectionBackgroundColor);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:focus .monaco-list-row.selected > .column > .code { color: ${whenForegroundColor}; }`);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:focus .monaco-list-row.odd.selected > .column > .code { color: ${whenForegroundColor}; }`);
	}

	const listInactiveSelectionForegroundColor = theme.getColor(listInactiveSelectionForeground);
	const listInactiveSelectionBackgroundColor = theme.getColor(listInactiveSelectionBackground);
	if (listInactiveSelectionForegroundColor && listInactiveSelectionBackgroundColor) {
		const whenForegroundColor = listInactiveSelectionForegroundColor.transparent(.8).makeOpaque(listInactiveSelectionBackgroundColor);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list .monaco-list-row.selected > .column > .code { color: ${whenForegroundColor}; }`);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list .monaco-list-row.odd.selected > .column > .code { color: ${whenForegroundColor}; }`);
	}

	const listFocusForegroundColor = theme.getColor(listFocusForeground);
	const listFocusBackgroundColor = theme.getColor(listFocusBackground);
	if (listFocusForegroundColor && listFocusBackgroundColor) {
		const whenForegroundColor = listFocusForegroundColor.transparent(.8).makeOpaque(listFocusBackgroundColor);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:focus .monaco-list-row.focused > .column > .code { color: ${whenForegroundColor}; }`);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:focus .monaco-list-row.odd.focused > .column > .code { color: ${whenForegroundColor}; }`);
	}

	const listHoverForegroundColor = theme.getColor(listHoverForeground);
	const listHoverBackgroundColor = theme.getColor(listHoverBackground);
	if (listHoverForegroundColor && listHoverBackgroundColor) {
		const whenForegroundColor = listHoverForegroundColor.transparent(.8).makeOpaque(listHoverBackgroundColor);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:focus .monaco-list-row:hover:not(.focused):not(.selected) > .column > .code { color: ${whenForegroundColor}; }`);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:focus .monaco-list-row.odd:hover:not(.focused):not(.selected) > .column > .code { color: ${whenForegroundColor}; }`);
	}

	const listHighlightForegroundColor = theme.getColor(listHighlightForeground);
	if (listHighlightForegroundColor) {
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list-row > .column .highlight { color: ${listHighlightForegroundColor}; }`);
	}

	if (listActiveSelectionForegroundColor) {
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:focus .monaco-list-row.selected.focused > .column .monaco-keybinding-key { color: ${listActiveSelectionForegroundColor}; }`);
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list:focus .monaco-list-row.selected > .column .monaco-keybinding-key { color: ${listActiveSelectionForegroundColor}; }`);
	}
	const listInactiveFocusAndSelectionForegroundColor = theme.getColor(listInactiveSelectionForeground);
	if (listInactiveFocusAndSelectionForegroundColor) {
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list .monaco-list-row.selected > .column .monaco-keybinding-key { color: ${listInactiveFocusAndSelectionForegroundColor}; }`);
	}
	if (listHoverForegroundColor) {
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list .monaco-list-row:hover:not(.selected):not(.focused) > .column .monaco-keybinding-key { color: ${listHoverForegroundColor}; }`);
	}
	if (listFocusForegroundColor) {
		collector.addRule(`.keybindings-editor > .keybindings-body > .keybindings-list-container .monaco-list .monaco-list-row.focused > .column .monaco-keybinding-key { color: ${listFocusForegroundColor}; }`);
	}
});
