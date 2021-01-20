/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/notificationsEditor';
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { dispose, Disposable, IDisposable, combinedDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Checkbox } from 'vs/base/browser/ui/checkbox/checkbox';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { CONTEXT_KEYBINDINGS_EDITOR } from 'vs/workbench/contrib/preferences/common/preferences';
import { IThemeService, registerThemingParticipant, IColorTheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { listHighlightForeground, listActiveSelectionForeground, listInactiveSelectionForeground, listHoverForeground, listFocusForeground, editorBackground, foreground, listActiveSelectionBackground, listInactiveSelectionBackground, listFocusBackground, listHoverBackground } from 'vs/platform/theme/common/colorRegistry';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { Emitter, Event } from 'vs/base/common/event';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { Color, RGBA } from 'vs/base/common/color';
import { WORKBENCH_BACKGROUND } from 'vs/workbench/common/theme';
import { IListRenderer, IListContextMenuEvent, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { NotificationsEditorModel } from 'vs/workbench/services/preferences/browser/notificationsEditorModel';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IListEntry, INotificationsEditorPane } from 'vs/workbench/common/notifications';
import { INotificationItem } from 'vs/platform/notification/common/notification';
import { Codicon } from 'vs/base/common/codicons';
export const NOTIFICATION_TEMPLATE_ID = 'notification.template';

const $ = DOM.$;

interface ColumnItem {
	column: HTMLElement;
	proportion?: number;
	width: number;
}

const oddRowBackgroundColor = new Color(new RGBA(130, 130, 130, 0.04));

export class NotificationsEditor extends EditorPane implements INotificationsEditorPane {

	static readonly ID: string = 'workbench.editor.notifications';

	private _onLayout: Emitter<void> = this._register(new Emitter<void>());
	readonly onLayout: Event<void> = this._onLayout.event;

	private headerContainer!: HTMLElement;

	private overlayContainer!: HTMLElement;

	private columnItems: ColumnItem[] = [];
	private notificationListContainer!: HTMLElement;

	private listEntries: IListEntry[] = [];
	private notificationList!: WorkbenchList<IListEntry>;
	private notificationsEditorModel: NotificationsEditorModel | null = null;

	private dimension: DOM.Dimension | null = null;

	private notificationsEditorContextKey: IContextKey<boolean>;

	private ariaLabelElement!: HTMLElement;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService
	) {
		super(NotificationsEditor.ID, telemetryService, themeService, storageService);
		this.notificationsEditorContextKey = CONTEXT_KEYBINDINGS_EDITOR.bindTo(this.contextKeyService);

		this.render(!!this.notificationsEditorContextKey.get());
	}

	private async render(preserveFocus: boolean): Promise<void> {
		this.notificationsEditorModel = this.instantiationService.createInstance(NotificationsEditorModel);
		await this.notificationsEditorModel.resolve();
		this.renderNotificationEntries();
	}

	private renderNotificationEntries(): void {
		if (this.notificationsEditorModel) {
			const notificationItems: INotificationItem[] = this.notificationsEditorModel.notificationItems;
			this.ariaLabelElement.setAttribute('aria-label', localize('aria-label', "Showing {0} notifications", notificationItems.length));
			notificationItems.forEach(notification => notification.templateId = NOTIFICATION_TEMPLATE_ID);
			this.listEntries = notificationItems;
			this.notificationList.splice(0, this.notificationList.length, this.listEntries);
			this.layoutNotificationsList();
		}
	}

	renderElement(notificationItem: INotificationItem, index: number, template: NotificationItemTemplate): void {
		template.parent.classList.toggle('odd', index % 2 === 1);
		for (const column of template.columns) {
			column.render(notificationItem);
		}
	}

	createEditor(parent: HTMLElement): void {
		const notificationsEditorElement = DOM.append(parent, $('div', { class: 'notifications-editor' }));
		this.createAriaLabelElement(notificationsEditorElement);
		this.createOverlayContainer(notificationsEditorElement);
		this.createHeader(notificationsEditorElement);
		this.createBody(notificationsEditorElement);
	}

	clearInput(): void {
		super.clearInput();
		this.notificationsEditorContextKey.reset();
	}

	layout(dimension: DOM.Dimension): void {
		this.dimension = dimension;

		this.overlayContainer.style.width = dimension.width + 'px';
		this.overlayContainer.style.height = dimension.height + 'px';

		this.columnItems.forEach(columnItem => {
			if (columnItem.proportion) {
				columnItem.width = 0;
			}
		});
		this.layoutNotificationsList();
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
		const activeNotificationEntry = this.activeNotificationEntry;
		if (activeNotificationEntry) {
			this.selectEntry(activeNotificationEntry);
		}
	}

	get activeNotificationEntry(): INotificationItem | null {
		const focusedElement = this.notificationList.getFocusedElements()[0];
		return focusedElement && focusedElement.templateId === NOTIFICATION_TEMPLATE_ID ? <INotificationItem>focusedElement : null;
	}

	private createAriaLabelElement(parent: HTMLElement): void {
		this.ariaLabelElement = DOM.append(parent, DOM.$(''));
		this.ariaLabelElement.setAttribute('id', 'notifications-editor-aria-label-element');
		this.ariaLabelElement.setAttribute('aria-live', 'assertive');
	}

	private createOverlayContainer(parent: HTMLElement): void {
		this.overlayContainer = DOM.append(parent, $('.overlay-container'));
		this.overlayContainer.style.position = 'absolute';
		this.overlayContainer.style.zIndex = '10';
		this.hideOverlayContainer();
	}

	private hideOverlayContainer() {
		this.overlayContainer.style.display = 'none';
	}

	private createHeader(parent: HTMLElement): void {
		this.headerContainer = DOM.append(parent, $('.notifications-header'));
	}

	private createBody(parent: HTMLElement): void {
		const bodyContainer = DOM.append(parent, $('.notifications-body'));
		this.createListHeader(bodyContainer);
		this.createList(bodyContainer);
	}

	private createListHeader(parent: HTMLElement): void {
		const notificationsListHeader = DOM.append(parent, $('.notifications-list-header'));
		notificationsListHeader.style.height = '30px';
		notificationsListHeader.style.lineHeight = '30px';

		this.columnItems = [];
		let column = $('.header.actions');

		column = $('.header.never-show-again', undefined, localize('never-show-again', "Never Show Again"));
		this.columnItems.push({ column, proportion: 0.125, width: 0 });

		column = $('.header.label', undefined, localize('label', "Notification"));
		this.columnItems.push({ column, proportion: 0.175, width: 0 });

		column = $('.header.when', undefined, localize('when', "When"));
		this.columnItems.push({ column, proportion: 0.7, width: 0 });

		DOM.append(notificationsListHeader, ...this.columnItems.map(({ column }) => column));
	}

	private createList(parent: HTMLElement): void {
		this.notificationListContainer = DOM.append(parent, $('.notifications-list-container'));
		const notificationRenderer = new NotificationItemRenderer(this, this.instantiationService);
		this.notificationList = this._register(this.instantiationService.createInstance(WorkbenchList, NOTIFICATION_TEMPLATE_ID, this.notificationListContainer, new Delegate(), [notificationRenderer], {
			identityProvider: { getId: (e: IListEntry) => e.id },
			setRowLineHeight: false,
			horizontalScrolling: false,
			accessibilityProvider: new AccessibilityProvider(),
			keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: (e: INotificationItem) => e.label },
			overrideStyles: {
				listBackground: editorBackground
			}
		})) as WorkbenchList<IListEntry>;

		this._register(this.notificationList.onContextMenu(e => this.onContextMenu(e)));
		this._register(this.notificationList.onDidFocus(() => {
			this.notificationList.getHTMLElement().classList.add('focused');
		}));
		this._register(this.notificationList.onDidBlur(() => {
			this.notificationList.getHTMLElement().classList.remove('focused');
			this.notificationsEditorContextKey.reset();
		}));
	}

	private layoutNotificationsList(): void {
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
		this.notificationListContainer.style.height = `${listHeight}px`;
		this.notificationList.layout(listHeight);
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

	private selectEntry(notification: INotificationItem | number, focus: boolean = true): void {
		const index = typeof notification === 'number' ? notification : this.getIndexOf(notification);
		if (index !== -1) {
			if (focus) {
				this.notificationList.getHTMLElement().focus();
				this.notificationList.setFocus([index]);
			}
			this.notificationList.setSelection([index]);
		}
	}

	focusNotifications(): void {
		this.notificationList.getHTMLElement().focus();
		const currentFocusIndices = this.notificationList.getFocus();
		this.notificationList.setFocus([currentFocusIndices.length ? currentFocusIndices[0] : 0]);
	}

	selectNotification(notification: INotificationItem): void {
		this.selectEntry(notification);
	}

	private onContextMenu(e: IListContextMenuEvent<IListEntry>): void {
		if (!e.element) {
			return;
		}

		const notification = <INotificationItem>e.element;
		this.selectEntry(notification);
	}
}

class Delegate implements IListVirtualDelegate<IListEntry> {

	getHeight(element: IListEntry) {
		return 24;
	}

	getTemplateId(element: IListEntry) {
		return element.templateId;
	}
}

interface NotificationItemTemplate {
	parent: HTMLElement;
	columns: Column[];
	disposable: IDisposable;
}

class NotificationItemRenderer implements IListRenderer<INotificationItem, NotificationItemTemplate> {

	get templateId(): string { return NOTIFICATION_TEMPLATE_ID; }

	constructor(
		private notificationsEditor: NotificationsEditor,
		private instantiationService: IInstantiationService
	) { }

	renderTemplate(parent: HTMLElement): NotificationItemTemplate {
		parent.classList.add('notification-item');

		const neverShowAgain: NeverShowAgainColumn = this.instantiationService.createInstance(NeverShowAgainColumn, parent, this.notificationsEditor);
		const label: LabelColumn = this.instantiationService.createInstance(LabelColumn, parent, this.notificationsEditor);
		const when: WhenColumn = this.instantiationService.createInstance(WhenColumn, parent, this.notificationsEditor);

		const columns: Column[] = [neverShowAgain, label, when];
		const disposables = combinedDisposable(...columns);
		const elements = columns.map(({ element }) => element);

		this.notificationsEditor.layoutColumns(elements);
		this.notificationsEditor.onLayout(() => this.notificationsEditor.layoutColumns(elements));

		return {
			parent,
			columns,
			disposable: disposables
		};
	}

	renderElement(notificationItem: INotificationItem, index: number, template: NotificationItemTemplate): void {
		template.parent.classList.toggle('odd', index % 2 === 1);
		for (const column of template.columns) {
			column.render(notificationItem);
		}
	}

	disposeTemplate(template: NotificationItemTemplate): void {
		template.disposable.dispose();
	}
}

abstract class Column extends Disposable {
	static COUNTER = 0;

	abstract readonly element: HTMLElement;
	abstract render(notification: INotificationItem): void;

	constructor(protected notificationsEditor: INotificationsEditorPane) {
		super();
	}
}

class NeverShowAgainColumn extends Column {

	private readonly checkbox: Checkbox = new Checkbox({ icon: Codicon.check, actionClassName: 'never-show-again-checkbox', isChecked: true, title: '', inputActiveOptionBorder: undefined });
	readonly element: HTMLElement;


	constructor(
		parent: HTMLElement,
		notificationsEditor: INotificationsEditorPane,
		@IStorageService private readonly storageService: IStorageService
	) {
		super(notificationsEditor);
		this.element = DOM.append(parent, $('.column.neverShowAgain', { id: 'neverShowAgain_' + ++Column.COUNTER }));
	}

	render(notificationItem: INotificationItem): void {
		const toDispose = new DisposableStore();
		this.element.appendChild(this.checkbox.domNode);
		toDispose.add(this.checkbox);
		toDispose.add(this.checkbox.onChange(() => {
			if (!this.checkbox.checked) {
				// delete this row?
				// unnecessary if there is a change listener on these that
				// runs render of the notificationsEditor
			}
			this.storageService.store(notificationItem.id, this.checkbox.checked, StorageScope.GLOBAL, StorageTarget.USER);
			this.checkbox.domNode.classList.toggle('codicon-check');
		}));
	}

	dispose(): void {
		super.dispose();
		dispose(this.checkbox);
	}
}

class LabelColumn extends Column {

	private readonly label: HTMLElement;
	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		notificationsEditor: INotificationsEditorPane,
	) {
		super(notificationsEditor);
		this.element = DOM.append(parent, $('.column.label', { id: 'notification_' + ++Column.COUNTER }));
		this.label = DOM.append(this.element, $('div.label-label'));
	}

	render(notificationItem: INotificationItem): void {
		this.label.classList.toggle('code', !notificationItem.label);
		const label = new HighlightedLabel(this.label, false);
		label.set(notificationItem.label);
		this.element.title = notificationItem.label;
		label.element.title = notificationItem.label;
	}
}

class WhenColumn extends Column {

	private readonly whenLabel: HTMLElement;
	readonly element: HTMLElement;

	constructor(
		parent: HTMLElement,
		notificationsEditor: INotificationsEditorPane,
	) {
		super(notificationsEditor);
		this.element = DOM.append(parent, $('.column.when', { id: 'notification_' + ++Column.COUNTER }));
		this.whenLabel = DOM.append(this.element, $('div.when-label'));
	}

	render(notificationItem: INotificationItem): void {
		this.whenLabel.classList.toggle('code', !notificationItem.when);
		const whenLabel = new HighlightedLabel(this.whenLabel, false);
		whenLabel.set(notificationItem.when);
		this.element.title = notificationItem.when;
		whenLabel.element.title = notificationItem.when;
	}
}

class AccessibilityProvider implements IListAccessibilityProvider<INotificationItem> {

	getWidgetAriaLabel(): string {
		return localize('notificationsLabel', "Notifications");
	}

	getAriaLabel(notification: INotificationItem): string {
		let ariaLabel = 'never show again'
			+ ', ' + notification.label
			+ ', ' + notification.when;
		return ariaLabel;
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-header { background-color: ${oddRowBackgroundColor}; }`);
	collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list-row.odd:not(.focused):not(.selected):not(:hover) { background-color: ${oddRowBackgroundColor}; }`);
	collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:not(:focus) .monaco-list-row.focused.odd:not(.selected):not(:hover) { background-color: ${oddRowBackgroundColor}; }`);
	collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:not(.focused) .monaco-list-row.focused.odd:not(.selected):not(:hover) { background-color: ${oddRowBackgroundColor}; }`);

	const foregroundColor = theme.getColor(foreground);
	if (foregroundColor) {
		const whenForegroundColor = foregroundColor.transparent(.8).makeOpaque(WORKBENCH_BACKGROUND(theme));
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list-row > .column > .code { color: ${whenForegroundColor}; }`);
		const whenForegroundColorForOddRow = foregroundColor.transparent(.8).makeOpaque(oddRowBackgroundColor);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list-row.odd > .column > .code { color: ${whenForegroundColorForOddRow}; }`);
	}

	const listActiveSelectionForegroundColor = theme.getColor(listActiveSelectionForeground);
	const listActiveSelectionBackgroundColor = theme.getColor(listActiveSelectionBackground);
	if (listActiveSelectionForegroundColor && listActiveSelectionBackgroundColor) {
		const whenForegroundColor = listActiveSelectionForegroundColor.transparent(.8).makeOpaque(listActiveSelectionBackgroundColor);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:focus .monaco-list-row.selected > .column > .code { color: ${whenForegroundColor}; }`);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:focus .monaco-list-row.odd.selected > .column > .code { color: ${whenForegroundColor}; }`);
	}

	const listInactiveSelectionForegroundColor = theme.getColor(listInactiveSelectionForeground);
	const listInactiveSelectionBackgroundColor = theme.getColor(listInactiveSelectionBackground);
	if (listInactiveSelectionForegroundColor && listInactiveSelectionBackgroundColor) {
		const whenForegroundColor = listInactiveSelectionForegroundColor.transparent(.8).makeOpaque(listInactiveSelectionBackgroundColor);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list .monaco-list-row.selected > .column > .code { color: ${whenForegroundColor}; }`);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list .monaco-list-row.odd.selected > .column > .code { color: ${whenForegroundColor}; }`);
	}

	const listFocusForegroundColor = theme.getColor(listFocusForeground);
	const listFocusBackgroundColor = theme.getColor(listFocusBackground);
	if (listFocusForegroundColor && listFocusBackgroundColor) {
		const whenForegroundColor = listFocusForegroundColor.transparent(.8).makeOpaque(listFocusBackgroundColor);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:focus .monaco-list-row.focused > .column > .code { color: ${whenForegroundColor}; }`);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:focus .monaco-list-row.odd.focused > .column > .code { color: ${whenForegroundColor}; }`);
	}

	const listHoverForegroundColor = theme.getColor(listHoverForeground);
	const listHoverBackgroundColor = theme.getColor(listHoverBackground);
	if (listHoverForegroundColor && listHoverBackgroundColor) {
		const whenForegroundColor = listHoverForegroundColor.transparent(.8).makeOpaque(listHoverBackgroundColor);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:focus .monaco-list-row:hover:not(.focused):not(.selected) > .column > .code { color: ${whenForegroundColor}; }`);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:focus .monaco-list-row.odd:hover:not(.focused):not(.selected) > .column > .code { color: ${whenForegroundColor}; }`);
	}

	const listHighlightForegroundColor = theme.getColor(listHighlightForeground);
	if (listHighlightForegroundColor) {
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list-row > .column .highlight { color: ${listHighlightForegroundColor}; }`);
	}

	if (listActiveSelectionForegroundColor) {
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:focus .monaco-list-row.selected.focused > .column .monaco-notification-key { color: ${listActiveSelectionForegroundColor}; }`);
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list:focus .monaco-list-row.selected > .column .monaco-notification-key { color: ${listActiveSelectionForegroundColor}; }`);
	}
	const listInactiveFocusAndSelectionForegroundColor = theme.getColor(listInactiveSelectionForeground);
	if (listInactiveFocusAndSelectionForegroundColor) {
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list .monaco-list-row.selected > .column .monaco-notification-key { color: ${listInactiveFocusAndSelectionForegroundColor}; }`);
	}
	if (listHoverForegroundColor) {
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list .monaco-list-row:hover:not(.selected):not(.focused) > .column .monaco-notification-key { color: ${listHoverForegroundColor}; }`);
	}
	if (listFocusForegroundColor) {
		collector.addRule(`.notifications-editor > .notifications-body > .notifications-list-container .monaco-list .monaco-list-row.focused > .column .monaco-notification-key { color: ${listFocusForegroundColor}; }`);
	}
});
