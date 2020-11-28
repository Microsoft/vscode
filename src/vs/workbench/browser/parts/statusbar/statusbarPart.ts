/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/statusbarpart';
import * as nls from 'vs/nls';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { dispose, IDisposable, Disposable, toDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { CodiconLabel } from 'vs/base/browser/ui/codicons/codiconLabel';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { Part } from 'vs/workbench/browser/part';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { StatusbarAlignment, IStatusbarService, IStatusbarEntry, IStatusbarEntryAccessor } from 'vs/workbench/services/statusbar/common/statusbar';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { Action, IAction, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification, Separator } from 'vs/base/common/actions';
import { IThemeService, registerThemingParticipant, IColorTheme, ICssStyleCollector, ThemeColor } from 'vs/platform/theme/common/themeService';
import { STATUS_BAR_BACKGROUND, STATUS_BAR_FOREGROUND, STATUS_BAR_NO_FOLDER_BACKGROUND, STATUS_BAR_ITEM_HOVER_BACKGROUND, STATUS_BAR_ITEM_ACTIVE_BACKGROUND, STATUS_BAR_PROMINENT_ITEM_FOREGROUND, STATUS_BAR_PROMINENT_ITEM_BACKGROUND, STATUS_BAR_PROMINENT_ITEM_HOVER_BACKGROUND, STATUS_BAR_BORDER, STATUS_BAR_NO_FOLDER_FOREGROUND, STATUS_BAR_NO_FOLDER_BORDER } from 'vs/workbench/common/theme';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { contrastBorder, activeContrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { isThemeColor } from 'vs/editor/common/editorCommon';
import { Color } from 'vs/base/common/color';
import { EventHelper, createStyleSheet, addDisposableListener, EventType, hide, show, isAncestor, appendChildren } from 'vs/base/browser/dom';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IStorageService, StorageScope, IStorageValueChangeEvent, StorageTarget } from 'vs/platform/storage/common/storage';
import { Parts, IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { coalesce } from 'vs/base/common/arrays';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { ToggleStatusbarVisibilityAction } from 'vs/workbench/browser/actions/layoutActions';
import { assertIsDefined } from 'vs/base/common/types';
import { Emitter } from 'vs/base/common/event';
import { Command } from 'vs/editor/common/modes';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { RawContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { renderCodicon, renderCodicons } from 'vs/base/browser/codicons';

interface IPendingStatusbarEntry {
	id: string;
	name: string;
	entry: IStatusbarEntry;
	alignment: StatusbarAlignment;
	priority: number;
	accessor?: IStatusbarEntryAccessor;
}

interface IStatusbarViewModelEntry {
	id: string;
	name: string;
	alignment: StatusbarAlignment;
	priority: number;
	container: HTMLElement;
	labelContainer: HTMLElement;
}

const CONTEXT_STATUS_BAR_FOCUSED = new RawContextKey<boolean>('statusBarFocused', false);

class StatusbarViewModel extends Disposable {

	static readonly HIDDEN_ENTRIES_KEY = 'workbench.statusbar.hidden';

	private readonly _onDidChangeEntryVisibility = this._register(new Emitter<{ id: string, visible: boolean }>());
	readonly onDidChangeEntryVisibility = this._onDidChangeEntryVisibility.event;

	private readonly _entries: IStatusbarViewModelEntry[] = [];
	get entries(): IStatusbarViewModelEntry[] { return this._entries; }

	private _lastFocusedEntry: IStatusbarViewModelEntry | undefined;
	get lastFocusedEntry(): IStatusbarViewModelEntry | undefined {
		return this._lastFocusedEntry && !this.isHidden(this._lastFocusedEntry.id) ? this._lastFocusedEntry : undefined;
	}

	private hidden!: Set<string>;

	constructor(private readonly storageService: IStorageService) {
		super();

		this.restoreState();
		this.registerListeners();
	}

	private restoreState(): void {
		const hiddenRaw = this.storageService.get(StatusbarViewModel.HIDDEN_ENTRIES_KEY, StorageScope.GLOBAL);
		if (hiddenRaw) {
			try {
				const hiddenArray: string[] = JSON.parse(hiddenRaw);
				this.hidden = new Set(hiddenArray);
			} catch (error) {
				// ignore parsing errors
			}
		}

		if (!this.hidden) {
			this.hidden = new Set<string>();
		}
	}

	private registerListeners(): void {
		this._register(this.storageService.onDidChangeValue(e => this.onDidStorageValueChange(e)));
	}

	private onDidStorageValueChange(event: IStorageValueChangeEvent): void {
		if (event.key === StatusbarViewModel.HIDDEN_ENTRIES_KEY && event.scope === StorageScope.GLOBAL) {

			// Keep current hidden entries
			const currentlyHidden = new Set(this.hidden);

			// Load latest state of hidden entries
			this.hidden.clear();
			this.restoreState();

			const changed = new Set<string>();

			// Check for each entry that is now visible
			currentlyHidden.forEach(id => {
				if (!this.hidden.has(id)) {
					changed.add(id);
				}
			});

			// Check for each entry that is now hidden
			this.hidden.forEach(id => {
				if (!currentlyHidden.has(id)) {
					changed.add(id);
				}
			});

			// Update visibility for entries have changed
			if (changed.size > 0) {
				this._entries.forEach(entry => {
					if (changed.has(entry.id)) {
						this.updateVisibility(entry.id, true);

						changed.delete(entry.id);
					}
				});
			}
		}
	}

	add(entry: IStatusbarViewModelEntry): IDisposable {
		this._entries.push(entry); // intentionally not using a map here since multiple entries can have the same ID!

		// Update visibility directly
		this.updateVisibility(entry, false);

		// Sort according to priority
		this.sort();

		// Mark first/last visible entry
		this.markFirstLastVisibleEntry();

		return toDisposable(() => this.remove(entry));
	}

	private remove(entry: IStatusbarViewModelEntry): void {
		const index = this._entries.indexOf(entry);
		if (index >= 0) {
			this._entries.splice(index, 1);

			// Mark first/last visible entry
			this.markFirstLastVisibleEntry();
		}
	}

	isHidden(id: string): boolean {
		return this.hidden.has(id);
	}

	hide(id: string): void {
		if (!this.hidden.has(id)) {
			this.hidden.add(id);

			this.updateVisibility(id, true);

			this.saveState();
		}
	}

	show(id: string): void {
		if (this.hidden.has(id)) {
			this.hidden.delete(id);

			this.updateVisibility(id, true);

			this.saveState();
		}
	}

	findEntry(container: HTMLElement): IStatusbarViewModelEntry | undefined {
		return this._entries.find(entry => entry.container === container);
	}

	getEntries(alignment: StatusbarAlignment): IStatusbarViewModelEntry[] {
		return this._entries.filter(entry => entry.alignment === alignment);
	}

	focusNextEntry(): void {
		this.focusEntry(+1, 0);
	}

	focusPreviousEntry(): void {
		this.focusEntry(-1, this.entries.length - 1);
	}

	private focusEntry(delta: number, restartPosition: number): void {
		const getVisibleEntry = (start: number) => {
			let indexToFocus = start;
			let entry = (indexToFocus >= 0 && indexToFocus < this._entries.length) ? this._entries[indexToFocus] : undefined;
			while (entry && this.isHidden(entry.id)) {
				indexToFocus += delta;
				entry = (indexToFocus >= 0 && indexToFocus < this._entries.length) ? this._entries[indexToFocus] : undefined;
			}
			return entry;
		};

		const focused = this._entries.find(entry => isAncestor(document.activeElement, entry.container));
		if (focused) {
			const entry = getVisibleEntry(this._entries.indexOf(focused) + delta);
			if (entry) {
				this._lastFocusedEntry = entry;
				entry.labelContainer.focus();
				return;
			}
		}

		const entry = getVisibleEntry(restartPosition);
		if (entry) {
			this._lastFocusedEntry = entry;
			entry.labelContainer.focus();
		}
	}

	private updateVisibility(id: string, trigger: boolean): void;
	private updateVisibility(entry: IStatusbarViewModelEntry, trigger: boolean): void;
	private updateVisibility(arg1: string | IStatusbarViewModelEntry, trigger: boolean): void {

		// By identifier
		if (typeof arg1 === 'string') {
			const id = arg1;

			for (const entry of this._entries) {
				if (entry.id === id) {
					this.updateVisibility(entry, trigger);
				}
			}
		}

		// By entry
		else {
			const entry = arg1;
			const isHidden = this.isHidden(entry.id);

			// Use CSS to show/hide item container
			if (isHidden) {
				hide(entry.container);
			} else {
				show(entry.container);
			}

			if (trigger) {
				this._onDidChangeEntryVisibility.fire({ id: entry.id, visible: !isHidden });
			}

			// Mark first/last visible entry
			this.markFirstLastVisibleEntry();
		}
	}

	private saveState(): void {
		if (this.hidden.size > 0) {
			this.storageService.store(StatusbarViewModel.HIDDEN_ENTRIES_KEY, JSON.stringify(Array.from(this.hidden.values())), StorageScope.GLOBAL, StorageTarget.USER);
		} else {
			this.storageService.remove(StatusbarViewModel.HIDDEN_ENTRIES_KEY, StorageScope.GLOBAL);
		}
	}

	private sort(): void {
		const mapEntryToIndex = new Map<IStatusbarViewModelEntry, number>();
		this._entries.forEach((entry, index) => mapEntryToIndex.set(entry, index));

		this._entries.sort((entryA, entryB) => {
			if (entryA.alignment === entryB.alignment) {
				if (entryA.priority !== entryB.priority) {
					return entryB.priority - entryA.priority; // higher priority towards the left
				}

				const indexA = mapEntryToIndex.get(entryA);
				const indexB = mapEntryToIndex.get(entryB);

				return indexA! - indexB!; // otherwise maintain stable order (both values known to be in map)
			}

			if (entryA.alignment === StatusbarAlignment.LEFT) {
				return -1;
			}

			if (entryB.alignment === StatusbarAlignment.LEFT) {
				return 1;
			}

			return 0;
		});
	}

	private markFirstLastVisibleEntry(): void {
		this.doMarkFirstLastVisibleStatusbarItem(this.getEntries(StatusbarAlignment.LEFT));
		this.doMarkFirstLastVisibleStatusbarItem(this.getEntries(StatusbarAlignment.RIGHT));
	}

	private doMarkFirstLastVisibleStatusbarItem(entries: IStatusbarViewModelEntry[]): void {
		let firstVisibleItem: IStatusbarViewModelEntry | undefined;
		let lastVisibleItem: IStatusbarViewModelEntry | undefined;

		for (const entry of entries) {

			// Clear previous first
			entry.container.classList.remove('first-visible-item', 'last-visible-item');

			const isVisible = !this.isHidden(entry.id);
			if (isVisible) {
				if (!firstVisibleItem) {
					firstVisibleItem = entry;
				}

				lastVisibleItem = entry;
			}
		}

		// Mark: first visible item
		if (firstVisibleItem) {
			firstVisibleItem.container.classList.add('first-visible-item');
		}

		// Mark: last visible item
		if (lastVisibleItem) {
			lastVisibleItem.container.classList.add('last-visible-item');
		}
	}
}

class ToggleStatusbarEntryVisibilityAction extends Action {

	constructor(id: string, label: string, private model: StatusbarViewModel) {
		super(id, label, undefined, true);

		this.checked = !model.isHidden(id);
	}

	async run(): Promise<void> {
		if (this.model.isHidden(this.id)) {
			this.model.show(this.id);
		} else {
			this.model.hide(this.id);
		}
	}
}

class HideStatusbarEntryAction extends Action {

	constructor(id: string, name: string, private model: StatusbarViewModel) {
		super(id, nls.localize('hide', "Hide '{0}'", name), undefined, true);
	}

	async run(): Promise<void> {
		this.model.hide(this.id);
	}
}

export class StatusbarPart extends Part implements IStatusbarService {

	declare readonly _serviceBrand: undefined;

	//#region IView

	readonly minimumWidth: number = 0;
	readonly maximumWidth: number = Number.POSITIVE_INFINITY;
	readonly minimumHeight: number = 22;
	readonly maximumHeight: number = 22;

	//#endregion

	private styleElement: HTMLStyleElement | undefined;

	private pendingEntries: IPendingStatusbarEntry[] = [];

	private readonly viewModel = this._register(new StatusbarViewModel(this.storageService));

	readonly onDidChangeEntryVisibility = this.viewModel.onDidChangeEntryVisibility;

	private leftItemsContainer: HTMLElement | undefined;
	private rightItemsContainer: HTMLElement | undefined;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IContextMenuService private contextMenuService: IContextMenuService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
	) {
		super(Parts.STATUSBAR_PART, { hasTitle: false }, themeService, storageService, layoutService);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.updateStyles()));
	}

	addEntry(entry: IStatusbarEntry, id: string, name: string, alignment: StatusbarAlignment, priority: number = 0): IStatusbarEntryAccessor {

		// As long as we have not been created into a container yet, record all entries
		// that are pending so that they can get created at a later point
		if (!this.element) {
			return this.doAddPendingEntry(entry, id, name, alignment, priority);
		}

		// Otherwise add to view
		return this.doAddEntry(entry, id, name, alignment, priority);
	}

	private doAddPendingEntry(entry: IStatusbarEntry, id: string, name: string, alignment: StatusbarAlignment, priority: number): IStatusbarEntryAccessor {
		const pendingEntry: IPendingStatusbarEntry = { entry, id, name, alignment, priority };
		this.pendingEntries.push(pendingEntry);

		const accessor: IStatusbarEntryAccessor = {
			update: (entry: IStatusbarEntry) => {
				if (pendingEntry.accessor) {
					pendingEntry.accessor.update(entry);
				} else {
					pendingEntry.entry = entry;
				}
			},

			dispose: () => {
				if (pendingEntry.accessor) {
					pendingEntry.accessor.dispose();
				} else {
					this.pendingEntries = this.pendingEntries.filter(entry => entry !== pendingEntry);
				}
			}
		};

		return accessor;
	}

	private doAddEntry(entry: IStatusbarEntry, id: string, name: string, alignment: StatusbarAlignment, priority: number): IStatusbarEntryAccessor {

		// Create item
		const itemContainer = this.doCreateStatusItem(id, alignment, ...coalesce([entry.showBeak ? 'has-beak' : undefined]));
		const item = this.instantiationService.createInstance(StatusbarEntryItem, itemContainer, entry);

		// Append to parent
		this.appendOneStatusbarEntry(itemContainer, alignment, priority);

		// Add to view model
		const viewModelEntry: IStatusbarViewModelEntry = { id, name, alignment, priority, container: itemContainer, labelContainer: item.labelContainer };
		const viewModelEntryDispose = this.viewModel.add(viewModelEntry);

		return {
			update: entry => {
				item.update(entry);
			},
			dispose: () => {
				dispose(viewModelEntryDispose);
				itemContainer.remove();
				dispose(item);
			}
		};
	}

	isEntryVisible(id: string): boolean {
		return !this.viewModel.isHidden(id);
	}

	updateEntryVisibility(id: string, visible: boolean): void {
		if (visible) {
			this.viewModel.show(id);
		} else {
			this.viewModel.hide(id);
		}
	}

	focusNextEntry(): void {
		this.viewModel.focusNextEntry();
	}

	focusPreviousEntry(): void {
		this.viewModel.focusPreviousEntry();
	}

	focus(preserveEntryFocus = true): void {
		this.getContainer()?.focus();
		const lastFocusedEntry = this.viewModel.lastFocusedEntry;
		if (preserveEntryFocus && lastFocusedEntry) {
			// Need a timeout, for some reason without it the inner label container will not get focused
			setTimeout(() => lastFocusedEntry.labelContainer.focus(), 0);
		}
	}

	createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;

		// Track focus within container
		const scopedContextKeyService = this.contextKeyService.createScoped(this.element);
		CONTEXT_STATUS_BAR_FOCUSED.bindTo(scopedContextKeyService).set(true);

		// Left items container
		this.leftItemsContainer = document.createElement('div');
		this.leftItemsContainer.classList.add('left-items', 'items-container');
		this.element.appendChild(this.leftItemsContainer);
		this.element.tabIndex = -1;

		// Right items container
		this.rightItemsContainer = document.createElement('div');
		this.rightItemsContainer.classList.add('right-items', 'items-container');
		this.element.appendChild(this.rightItemsContainer);

		// Context menu support
		this._register(addDisposableListener(parent, EventType.CONTEXT_MENU, e => this.showContextMenu(e)));

		// Initial status bar entries
		this.createInitialStatusbarEntries();

		return this.element;
	}

	private createInitialStatusbarEntries(): void {

		// Add items in order according to alignment
		this.appendAllStatusbarEntries();

		// Fill in pending entries if any
		while (this.pendingEntries.length) {
			const pending = this.pendingEntries.shift();
			if (pending) {
				pending.accessor = this.addEntry(pending.entry, pending.id, pending.name, pending.alignment, pending.priority);
			}
		}
	}

	private appendAllStatusbarEntries(): void {

		// Append in order of priority
		[
			...this.viewModel.getEntries(StatusbarAlignment.LEFT),
			...this.viewModel.getEntries(StatusbarAlignment.RIGHT).reverse() // reversing due to flex: row-reverse
		].forEach(entry => {
			const target = assertIsDefined(entry.alignment === StatusbarAlignment.LEFT ? this.leftItemsContainer : this.rightItemsContainer);

			target.appendChild(entry.container);
		});
	}

	private appendOneStatusbarEntry(itemContainer: HTMLElement, alignment: StatusbarAlignment, priority: number): void {
		const entries = this.viewModel.getEntries(alignment);

		if (alignment === StatusbarAlignment.RIGHT) {
			entries.reverse(); // reversing due to flex: row-reverse
		}

		const target = assertIsDefined(alignment === StatusbarAlignment.LEFT ? this.leftItemsContainer : this.rightItemsContainer);

		// find an entry that has lower priority than the new one
		// and then insert the item before that one
		let appended = false;
		for (const entry of entries) {
			if (
				alignment === StatusbarAlignment.LEFT && entry.priority < priority ||
				alignment === StatusbarAlignment.RIGHT && entry.priority > priority // reversing due to flex: row-reverse
			) {
				target.insertBefore(itemContainer, entry.container);
				appended = true;
				break;
			}
		}

		// Fallback to just appending otherwise
		if (!appended) {
			target.appendChild(itemContainer);
		}
	}

	private showContextMenu(e: MouseEvent): void {
		EventHelper.stop(e, true);

		const event = new StandardMouseEvent(e);

		let actions: IAction[] | undefined = undefined;
		this.contextMenuService.showContextMenu({
			getAnchor: () => ({ x: event.posx, y: event.posy }),
			getActions: () => {
				actions = this.getContextMenuActions(event);

				return actions;
			},
			onHide: () => {
				if (actions) {
					dispose(actions);
				}
			}
		});
	}

	private getContextMenuActions(event: StandardMouseEvent): IAction[] {
		const actions: Action[] = [];

		// Provide an action to hide the status bar at last
		actions.push(this.instantiationService.createInstance(ToggleStatusbarVisibilityAction, ToggleStatusbarVisibilityAction.ID, nls.localize('hideStatusBar', "Hide Status Bar")));
		actions.push(new Separator());

		// Show an entry per known status entry
		// Note: even though entries have an identifier, there can be multiple entries
		// having the same identifier (e.g. from extensions). So we make sure to only
		// show a single entry per identifier we handled.
		const handledEntries = new Set<string>();
		this.viewModel.entries.forEach(entry => {
			if (!handledEntries.has(entry.id)) {
				actions.push(new ToggleStatusbarEntryVisibilityAction(entry.id, entry.name, this.viewModel));
				handledEntries.add(entry.id);
			}
		});

		// Figure out if mouse is over an entry
		let statusEntryUnderMouse: IStatusbarViewModelEntry | undefined = undefined;
		for (let element: HTMLElement | null = event.target; element; element = element.parentElement) {
			const entry = this.viewModel.findEntry(element);
			if (entry) {
				statusEntryUnderMouse = entry;
				break;
			}
		}

		if (statusEntryUnderMouse) {
			actions.push(new Separator());
			actions.push(new HideStatusbarEntryAction(statusEntryUnderMouse.id, statusEntryUnderMouse.name, this.viewModel));
		}

		return actions;
	}

	updateStyles(): void {
		super.updateStyles();

		const container = assertIsDefined(this.getContainer());

		// Background colors
		const backgroundColor = this.getColor(this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY ? STATUS_BAR_BACKGROUND : STATUS_BAR_NO_FOLDER_BACKGROUND) || '';
		container.style.backgroundColor = backgroundColor;
		container.style.color = this.getColor(this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY ? STATUS_BAR_FOREGROUND : STATUS_BAR_NO_FOLDER_FOREGROUND) || '';

		// Border color
		const borderColor = this.getColor(this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY ? STATUS_BAR_BORDER : STATUS_BAR_NO_FOLDER_BORDER) || this.getColor(contrastBorder);
		if (borderColor) {
			container.classList.add('status-border-top');
			container.style.setProperty('--status-border-top-color', borderColor.toString());
		} else {
			container.classList.remove('status-border-top');
			container.style.removeProperty('--status-border-top-color');
		}

		// Notification Beak
		if (!this.styleElement) {
			this.styleElement = createStyleSheet(container);
		}

		this.styleElement.textContent = `.monaco-workbench .part.statusbar > .items-container > .statusbar-item.has-beak:before { border-bottom-color: ${backgroundColor}; }`;
	}

	private doCreateStatusItem(id: string, alignment: StatusbarAlignment, ...extraClasses: string[]): HTMLElement {
		const itemContainer = document.createElement('div');
		itemContainer.id = id;

		itemContainer.classList.add('statusbar-item');
		if (extraClasses) {
			itemContainer.classList.add(...extraClasses);
		}

		if (alignment === StatusbarAlignment.RIGHT) {
			itemContainer.classList.add('right');
		} else {
			itemContainer.classList.add('left');
		}

		return itemContainer;
	}

	layout(width: number, height: number): void {
		super.layout(width, height);
		super.layoutContents(width, height);
	}

	toJSON(): object {
		return {
			type: Parts.STATUSBAR_PART
		};
	}
}

class StatusBarCodiconLabel extends CodiconLabel {

	private readonly progressCodicon = renderCodicon('sync', 'spin');

	private currentText = '';
	private currentShowProgress = false;

	constructor(
		private readonly container: HTMLElement
	) {
		super(container);
	}

	set showProgress(showProgress: boolean) {
		if (this.currentShowProgress !== showProgress) {
			this.currentShowProgress = showProgress;
			this.text = this.currentText;
		}
	}

	set text(text: string) {

		// Progress: insert progress codicon as first element as needed
		// but keep it stable so that the animation does not reset
		if (this.currentShowProgress) {

			// Append as needed
			if (this.container.firstChild !== this.progressCodicon) {
				this.container.appendChild(this.progressCodicon);
			}

			// Remove others
			for (const node of Array.from(this.container.childNodes)) {
				if (node !== this.progressCodicon) {
					node.remove();
				}
			}

			// If we have text to show, add a space to separate from progress
			let textContent = text ?? '';
			if (textContent) {
				textContent = ` ${textContent}`;
			}

			// Append new elements
			appendChildren(this.container, ...renderCodicons(textContent));
		}

		// No Progress: no special handling
		else {
			super.text = text;
		}
	}
}

class StatusbarEntryItem extends Disposable {

	readonly labelContainer: HTMLElement;
	private readonly label: StatusBarCodiconLabel;

	private entry: IStatusbarEntry | undefined = undefined;

	private readonly foregroundListener = this._register(new MutableDisposable());
	private readonly backgroundListener = this._register(new MutableDisposable());

	private readonly commandMouseListener = this._register(new MutableDisposable());
	private readonly commandKeyboardListener = this._register(new MutableDisposable());

	constructor(
		private container: HTMLElement,
		entry: IStatusbarEntry,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IThemeService private readonly themeService: IThemeService
	) {
		super();

		// Label Container
		this.labelContainer = document.createElement('a');
		this.labelContainer.tabIndex = -1; // allows screen readers to read title, but still prevents tab focus.
		this.labelContainer.setAttribute('role', 'button');

		// Label (with support for progress)
		this.label = new StatusBarCodiconLabel(this.labelContainer);

		// Add to parent
		this.container.appendChild(this.labelContainer);

		this.update(entry);
	}

	update(entry: IStatusbarEntry): void {

		// Update: Progress
		this.label.showProgress = !!entry.showProgress;

		// Update: Text
		if (!this.entry || entry.text !== this.entry.text) {
			this.label.text = entry.text;

			if (entry.text) {
				show(this.labelContainer);
			} else {
				hide(this.labelContainer);
			}
		}

		// Set the aria label on both elements so screen readers would read
		// the correct thing without duplication #96210
		if (!this.entry || entry.ariaLabel !== this.entry.ariaLabel) {
			this.container.setAttribute('aria-label', entry.ariaLabel);
			this.labelContainer.setAttribute('aria-label', entry.ariaLabel);
		}
		if (!this.entry || entry.role !== this.entry.role) {
			this.labelContainer.setAttribute('role', entry.role || 'button');
		}

		// Update: Tooltip (on the container, because label can be disabled)
		if (!this.entry || entry.tooltip !== this.entry.tooltip) {
			if (entry.tooltip) {
				this.container.title = entry.tooltip;
			} else {
				this.container.title = '';
			}
		}

		// Update: Command
		if (!this.entry || entry.command !== this.entry.command) {
			this.commandMouseListener.clear();
			this.commandKeyboardListener.clear();

			const command = entry.command;
			if (command) {
				this.commandMouseListener.value = addDisposableListener(this.labelContainer, EventType.CLICK, () => this.executeCommand(command));
				this.commandKeyboardListener.value = addDisposableListener(this.labelContainer, EventType.KEY_DOWN, e => {
					const event = new StandardKeyboardEvent(e);
					if (event.equals(KeyCode.Space) || event.equals(KeyCode.Enter)) {
						this.executeCommand(command);
					}
				});

				this.labelContainer.classList.remove('disabled');
			} else {
				this.labelContainer.classList.add('disabled');
			}
		}

		// Update: Beak
		if (!this.entry || entry.showBeak !== this.entry.showBeak) {
			if (entry.showBeak) {
				this.container.classList.add('has-beak');
			} else {
				this.container.classList.remove('has-beak');
			}
		}

		// Update: Foreground
		if (!this.entry || entry.color !== this.entry.color) {
			this.applyColor(this.labelContainer, entry.color);
		}

		// Update: Background
		if (!this.entry || entry.backgroundColor !== this.entry.backgroundColor) {
			if (entry.backgroundColor) {
				this.applyColor(this.container, entry.backgroundColor, true);
				this.container.classList.add('has-background-color');
			} else {
				this.container.classList.remove('has-background-color');
			}
		}

		// Remember for next round
		this.entry = entry;
	}

	private async executeCommand(command: string | Command): Promise<void> {
		const id = typeof command === 'string' ? command : command.id;
		const args = typeof command === 'string' ? [] : command.arguments ?? [];

		this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id, from: 'status bar' });
		try {
			await this.commandService.executeCommand(id, ...args);
		} catch (error) {
			this.notificationService.error(toErrorMessage(error));
		}
	}

	private applyColor(container: HTMLElement, color: string | ThemeColor | undefined, isBackground?: boolean): void {
		let colorResult: string | null = null;

		if (isBackground) {
			this.backgroundListener.clear();
		} else {
			this.foregroundListener.clear();
		}

		if (color) {
			if (isThemeColor(color)) {
				colorResult = (this.themeService.getColorTheme().getColor(color.id) || Color.transparent).toString();

				const listener = this.themeService.onDidColorThemeChange(theme => {
					const colorValue = (theme.getColor(color.id) || Color.transparent).toString();

					if (isBackground) {
						container.style.backgroundColor = colorValue;
					} else {
						container.style.color = colorValue;
					}
				});

				if (isBackground) {
					this.backgroundListener.value = listener;
				} else {
					this.foregroundListener.value = listener;
				}
			} else {
				colorResult = color;
			}
		}

		if (isBackground) {
			container.style.backgroundColor = colorResult || '';
		} else {
			container.style.color = colorResult || '';
		}
	}

	dispose(): void {
		super.dispose();

		dispose(this.foregroundListener);
		dispose(this.backgroundListener);
		dispose(this.commandMouseListener);
		dispose(this.commandKeyboardListener);
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	if (theme.type !== ColorScheme.HIGH_CONTRAST) {
		const statusBarItemHoverBackground = theme.getColor(STATUS_BAR_ITEM_HOVER_BACKGROUND);
		if (statusBarItemHoverBackground) {
			collector.addRule(`.monaco-workbench .part.statusbar > .items-container > .statusbar-item a:hover { background-color: ${statusBarItemHoverBackground}; }`);
			collector.addRule(`.monaco-workbench .part.statusbar > .items-container > .statusbar-item a:focus { background-color: ${statusBarItemHoverBackground}; }`);
		}

		const statusBarItemActiveBackground = theme.getColor(STATUS_BAR_ITEM_ACTIVE_BACKGROUND);
		if (statusBarItemActiveBackground) {
			collector.addRule(`.monaco-workbench .part.statusbar > .items-container > .statusbar-item a:active { background-color: ${statusBarItemActiveBackground}; }`);
		}
	}

	const activeContrastBorderColor = theme.getColor(activeContrastBorder);
	if (activeContrastBorderColor) {
		collector.addRule(`
			.monaco-workbench .part.statusbar > .items-container > .statusbar-item a:focus,
			.monaco-workbench .part.statusbar > .items-container > .statusbar-item a:active {
				outline: 1px solid ${activeContrastBorderColor} !important;
				outline-offset: -1px;
			}
		`);
		collector.addRule(`
			.monaco-workbench .part.statusbar > .items-container > .statusbar-item a:hover {
				outline: 1px dashed ${activeContrastBorderColor};
				outline-offset: -1px;
			}
		`);
	}

	const statusBarProminentItemForeground = theme.getColor(STATUS_BAR_PROMINENT_ITEM_FOREGROUND);
	if (statusBarProminentItemForeground) {
		collector.addRule(`.monaco-workbench .part.statusbar > .items-container > .statusbar-item .status-bar-info { color: ${statusBarProminentItemForeground}; }`);
	}

	const statusBarProminentItemBackground = theme.getColor(STATUS_BAR_PROMINENT_ITEM_BACKGROUND);
	if (statusBarProminentItemBackground) {
		collector.addRule(`.monaco-workbench .part.statusbar > .items-container > .statusbar-item .status-bar-info { background-color: ${statusBarProminentItemBackground}; }`);
	}

	const statusBarProminentItemHoverBackground = theme.getColor(STATUS_BAR_PROMINENT_ITEM_HOVER_BACKGROUND);
	if (statusBarProminentItemHoverBackground) {
		collector.addRule(`.monaco-workbench .part.statusbar > .items-container > .statusbar-item a.status-bar-info:hover { background-color: ${statusBarProminentItemHoverBackground}; }`);
	}
});

registerSingleton(IStatusbarService, StatusbarPart);

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.statusBar.focusPrevious',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.LeftArrow,
	secondary: [KeyCode.UpArrow],
	when: CONTEXT_STATUS_BAR_FOCUSED,
	handler: (accessor: ServicesAccessor) => {
		const statusBarService = accessor.get(IStatusbarService);
		statusBarService.focusPreviousEntry();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.statusBar.focusNext',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.RightArrow,
	secondary: [KeyCode.DownArrow],
	when: CONTEXT_STATUS_BAR_FOCUSED,
	handler: (accessor: ServicesAccessor) => {
		const statusBarService = accessor.get(IStatusbarService);
		statusBarService.focusNextEntry();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.statusBar.focusFirst',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Home,
	when: CONTEXT_STATUS_BAR_FOCUSED,
	handler: (accessor: ServicesAccessor) => {
		const statusBarService = accessor.get(IStatusbarService);
		statusBarService.focus(false);
		statusBarService.focusNextEntry();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.statusBar.focusLast',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.End,
	when: CONTEXT_STATUS_BAR_FOCUSED,
	handler: (accessor: ServicesAccessor) => {
		const statusBarService = accessor.get(IStatusbarService);
		statusBarService.focus(false);
		statusBarService.focusPreviousEntry();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'workbench.statusBar.clearFocus',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Escape,
	when: CONTEXT_STATUS_BAR_FOCUSED,
	handler: (accessor: ServicesAccessor) => {
		const statusBarService = accessor.get(IStatusbarService);
		statusBarService.focus(false);
	}
});
