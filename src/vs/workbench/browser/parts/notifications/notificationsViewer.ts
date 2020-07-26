/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IListVirtualDelegate, IListRenderer } from 'vs/base/browser/ui/list/list';
import { clearNode, addClass, toggleClass, addDisposableListener, EventType, EventHelper, $, addClasses, removeClasses } from 'vs/base/browser/dom';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { ButtonGroup } from 'vs/base/browser/ui/button/button';
import { attachButtonStyler, attachProgressBarStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IAction, IActionRunner } from 'vs/base/common/actions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { dispose, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { INotificationViewItem, NotificationViewItem, NotificationViewItemContentChangeKind, INotificationMessage, ChoiceAction } from 'vs/workbench/common/notifications';
import { ClearNotificationAction, ExpandNotificationAction, CollapseNotificationAction, ConfigureNotificationAction } from 'vs/workbench/browser/parts/notifications/notificationsActions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { Severity } from 'vs/platform/notification/common/notification';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { Codicon } from 'vs/base/common/codicons';
import { DropdownMenuActionViewItem } from 'vs/base/browser/ui/dropdown/dropdownActionViewItem';

export class NotificationsListDelegate implements IListVirtualDelegate<INotificationViewItem> {

	private static readonly ROW_HEIGHT = 42;
	private static readonly LINE_HEIGHT = 22;

	private offsetHelper: HTMLElement;

	constructor(container: HTMLElement) {
		this.offsetHelper = this.createOffsetHelper(container);
	}

	private createOffsetHelper(container: HTMLElement): HTMLElement {
		const offsetHelper = document.createElement('div');
		addClass(offsetHelper, 'notification-offset-helper');

		container.appendChild(offsetHelper);

		return offsetHelper;
	}

	getHeight(notification: INotificationViewItem): number {
		if (!notification.expanded) {
			return NotificationsListDelegate.ROW_HEIGHT; // return early if there are no more rows to show
		}

		// First row: message and actions
		let expandedHeight = NotificationsListDelegate.ROW_HEIGHT;

		// Dynamic height: if message overflows
		const preferredMessageHeight = this.computePreferredHeight(notification);
		const messageOverflows = NotificationsListDelegate.LINE_HEIGHT < preferredMessageHeight;
		if (messageOverflows) {
			const overflow = preferredMessageHeight - NotificationsListDelegate.LINE_HEIGHT;
			expandedHeight += overflow;
		}

		// Last row: source and buttons if we have any
		if (notification.source || isNonEmptyArray(notification.actions && notification.actions.primary)) {
			expandedHeight += NotificationsListDelegate.ROW_HEIGHT;
		}

		// If the expanded height is same as collapsed, unset the expanded state
		// but skip events because there is no change that has visual impact
		if (expandedHeight === NotificationsListDelegate.ROW_HEIGHT) {
			notification.collapse(true /* skip events, no change in height */);
		}

		return expandedHeight;
	}

	private computePreferredHeight(notification: INotificationViewItem): number {

		// Prepare offset helper depending on toolbar actions count
		let actions = 1; // close
		if (notification.canCollapse) {
			actions++; // expand/collapse
		}
		if (isNonEmptyArray(notification.actions && notification.actions.secondary)) {
			actions++; // secondary actions
		}
		this.offsetHelper.style.width = `${450 /* notifications container width */ - (10 /* padding */ + 26 /* severity icon */ + (actions * 24) /* 24px per action */)}px`;

		// Render message into offset helper
		const renderedMessage = NotificationMessageRenderer.render(notification.message);
		this.offsetHelper.appendChild(renderedMessage);

		// Compute height
		const preferredHeight = Math.max(this.offsetHelper.offsetHeight, this.offsetHelper.scrollHeight);

		// Always clear offset helper after use
		clearNode(this.offsetHelper);

		return preferredHeight;
	}

	getTemplateId(element: INotificationViewItem): string {
		if (element instanceof NotificationViewItem) {
			return NotificationRenderer.TEMPLATE_ID;
		}

		throw new Error('unknown element type: ' + element);
	}
}

export interface INotificationTemplateData {
	container: HTMLElement;
	toDispose: DisposableStore;

	mainRow: HTMLElement;
	icon: HTMLElement;
	message: HTMLElement;
	toolbar: ActionBar;

	detailsRow: HTMLElement;
	source: HTMLElement;
	buttonsContainer: HTMLElement;
	progress: ProgressBar;

	renderer: NotificationTemplateRenderer;
}

interface IMessageActionHandler {
	callback: (href: string) => void;
	toDispose: DisposableStore;
}

class NotificationMessageRenderer {

	static render(message: INotificationMessage, actionHandler?: IMessageActionHandler): HTMLElement {
		const messageContainer = document.createElement('span');

		for (const node of message.linkedText.nodes) {
			if (typeof node === 'string') {
				messageContainer.appendChild(document.createTextNode(node));
			} else {
				let title = node.title;

				if (!title && node.href.startsWith('command:')) {
					title = localize('executeCommand', "Click to execute command '{0}'", node.href.substr('command:'.length));
				} else if (!title) {
					title = node.href;
				}

				const anchor = $('a', { href: node.href, title: title, }, node.label);

				if (actionHandler) {
					actionHandler.toDispose.add(addDisposableListener(anchor, EventType.CLICK, e => {
						EventHelper.stop(e, true);
						actionHandler.callback(node.href);
					}));
				}

				messageContainer.appendChild(anchor);
			}
		}

		return messageContainer;
	}
}

export class NotificationRenderer implements IListRenderer<INotificationViewItem, INotificationTemplateData> {

	static readonly TEMPLATE_ID = 'notification';

	constructor(
		private actionRunner: IActionRunner,
		@IThemeService private readonly themeService: IThemeService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
	}

	get templateId() {
		return NotificationRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): INotificationTemplateData {
		const data: INotificationTemplateData = Object.create(null);
		data.toDispose = new DisposableStore();

		// Container
		data.container = document.createElement('div');
		addClass(data.container, 'notification-list-item');

		// Main Row
		data.mainRow = document.createElement('div');
		addClass(data.mainRow, 'notification-list-item-main-row');

		// Icon
		data.icon = document.createElement('div');
		addClass(data.icon, 'notification-list-item-icon');
		addClass(data.icon, 'codicon');

		// Message
		data.message = document.createElement('div');
		addClass(data.message, 'notification-list-item-message');

		// Toolbar
		const toolbarContainer = document.createElement('div');
		addClass(toolbarContainer, 'notification-list-item-toolbar-container');
		data.toolbar = new ActionBar(
			toolbarContainer,
			{
				ariaLabel: localize('notificationActions', "Notification Actions"),
				actionViewItemProvider: action => {
					if (action && action instanceof ConfigureNotificationAction) {
						const item = new DropdownMenuActionViewItem(action, action.configurationActions, this.contextMenuService, { actionRunner: this.actionRunner, classNames: action.class });
						data.toDispose.add(item);

						return item;
					}

					return undefined;
				},
				actionRunner: this.actionRunner
			}
		);
		data.toDispose.add(data.toolbar);

		// Details Row
		data.detailsRow = document.createElement('div');
		addClass(data.detailsRow, 'notification-list-item-details-row');

		// Source
		data.source = document.createElement('div');
		addClass(data.source, 'notification-list-item-source');

		// Buttons Container
		data.buttonsContainer = document.createElement('div');
		addClass(data.buttonsContainer, 'notification-list-item-buttons-container');

		container.appendChild(data.container);

		// the details row appears first in order for better keyboard access to notification buttons
		data.container.appendChild(data.detailsRow);
		data.detailsRow.appendChild(data.source);
		data.detailsRow.appendChild(data.buttonsContainer);

		// main row
		data.container.appendChild(data.mainRow);
		data.mainRow.appendChild(data.icon);
		data.mainRow.appendChild(data.message);
		data.mainRow.appendChild(toolbarContainer);

		// Progress: below the rows to span the entire width of the item
		data.progress = new ProgressBar(container);
		data.toDispose.add(attachProgressBarStyler(data.progress, this.themeService));
		data.toDispose.add(data.progress);

		// Renderer
		data.renderer = this.instantiationService.createInstance(NotificationTemplateRenderer, data, this.actionRunner);
		data.toDispose.add(data.renderer);

		return data;
	}

	renderElement(notification: INotificationViewItem, index: number, data: INotificationTemplateData): void {
		data.renderer.setInput(notification);
	}

	disposeTemplate(templateData: INotificationTemplateData): void {
		dispose(templateData.toDispose);
	}
}

export class NotificationTemplateRenderer extends Disposable {

	private static closeNotificationAction: ClearNotificationAction;
	private static expandNotificationAction: ExpandNotificationAction;
	private static collapseNotificationAction: CollapseNotificationAction;

	private static readonly SEVERITIES = [Severity.Info, Severity.Warning, Severity.Error];

	private readonly inputDisposables = this._register(new DisposableStore());

	constructor(
		private template: INotificationTemplateData,
		private actionRunner: IActionRunner,
		@IOpenerService private readonly openerService: IOpenerService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService,
		@IKeybindingService private readonly keybindingService: IKeybindingService
	) {
		super();

		if (!NotificationTemplateRenderer.closeNotificationAction) {
			NotificationTemplateRenderer.closeNotificationAction = instantiationService.createInstance(ClearNotificationAction, ClearNotificationAction.ID, ClearNotificationAction.LABEL);
			NotificationTemplateRenderer.expandNotificationAction = instantiationService.createInstance(ExpandNotificationAction, ExpandNotificationAction.ID, ExpandNotificationAction.LABEL);
			NotificationTemplateRenderer.collapseNotificationAction = instantiationService.createInstance(CollapseNotificationAction, CollapseNotificationAction.ID, CollapseNotificationAction.LABEL);
		}
	}

	setInput(notification: INotificationViewItem): void {
		this.inputDisposables.clear();

		this.render(notification);
	}

	private render(notification: INotificationViewItem): void {

		// Container
		toggleClass(this.template.container, 'expanded', notification.expanded);
		this.inputDisposables.add(addDisposableListener(this.template.container, EventType.AUXCLICK, e => {
			if (!notification.hasProgress && e.button === 1 /* Middle Button */) {
				EventHelper.stop(e, true);

				notification.close();
			}
		}));

		// Severity Icon
		this.renderSeverity(notification);

		// Message
		const messageOverflows = this.renderMessage(notification);

		// Secondary Actions
		this.renderSecondaryActions(notification, messageOverflows);

		// Source
		this.renderSource(notification);

		// Buttons
		this.renderButtons(notification);

		// Progress
		this.renderProgress(notification);

		// Label Change Events that we can handle directly
		// (changes to actions require an entire redraw of
		// the notification because it has an impact on
		// epxansion state)
		this.inputDisposables.add(notification.onDidChangeContent(event => {
			switch (event.kind) {
				case NotificationViewItemContentChangeKind.SEVERITY:
					this.renderSeverity(notification);
					break;
				case NotificationViewItemContentChangeKind.PROGRESS:
					this.renderProgress(notification);
					break;
				case NotificationViewItemContentChangeKind.MESSAGE:
					this.renderMessage(notification);
					break;
			}
		}));
	}

	private renderSeverity(notification: INotificationViewItem): void {
		// first remove, then set as the codicon class names overlap
		NotificationTemplateRenderer.SEVERITIES.forEach(severity => {
			if (notification.severity !== severity) {
				removeClasses(this.template.icon, this.toSeverityIcon(severity).classNames);
			}
		});
		addClasses(this.template.icon, this.toSeverityIcon(notification.severity).classNames);
	}

	private renderMessage(notification: INotificationViewItem): boolean {
		clearNode(this.template.message);
		this.template.message.appendChild(NotificationMessageRenderer.render(notification.message, {
			callback: link => this.openerService.open(URI.parse(link)),
			toDispose: this.inputDisposables
		}));

		const messageOverflows = notification.canCollapse && !notification.expanded && this.template.message.scrollWidth > this.template.message.clientWidth;
		if (messageOverflows) {
			this.template.message.title = this.template.message.textContent + '';
		} else {
			this.template.message.removeAttribute('title');
		}

		const links = this.template.message.querySelectorAll('a');
		for (let i = 0; i < links.length; i++) {
			links.item(i).tabIndex = -1; // prevent keyboard navigation to links to allow for better keyboard support within a message
		}

		return messageOverflows;
	}

	private renderSecondaryActions(notification: INotificationViewItem, messageOverflows: boolean): void {
		const actions: IAction[] = [];

		// Secondary Actions
		const secondaryActions = notification.actions ? notification.actions.secondary : undefined;
		if (isNonEmptyArray(secondaryActions)) {
			const configureNotificationAction = this.instantiationService.createInstance(ConfigureNotificationAction, ConfigureNotificationAction.ID, ConfigureNotificationAction.LABEL, secondaryActions);
			actions.push(configureNotificationAction);
			this.inputDisposables.add(configureNotificationAction);
		}

		// Expand / Collapse
		let showExpandCollapseAction = false;
		if (notification.canCollapse) {
			if (notification.expanded) {
				showExpandCollapseAction = true; // allow to collapse an expanded message
			} else if (notification.source) {
				showExpandCollapseAction = true; // allow to expand to details row
			} else if (messageOverflows) {
				showExpandCollapseAction = true; // allow to expand if message overflows
			}
		}

		if (showExpandCollapseAction) {
			actions.push(notification.expanded ? NotificationTemplateRenderer.collapseNotificationAction : NotificationTemplateRenderer.expandNotificationAction);
		}

		// Close (unless progress is showing)
		if (!notification.hasProgress) {
			actions.push(NotificationTemplateRenderer.closeNotificationAction);
		}

		this.template.toolbar.clear();
		this.template.toolbar.context = notification;
		actions.forEach(action => this.template.toolbar.push(action, { icon: true, label: false, keybinding: this.getKeybindingLabel(action) }));
	}

	private renderSource(notification: INotificationViewItem): void {
		if (notification.expanded && notification.source) {
			this.template.source.textContent = localize('notificationSource', "Source: {0}", notification.source);
			this.template.source.title = notification.source;
		} else {
			this.template.source.textContent = '';
			this.template.source.removeAttribute('title');
		}
	}

	private renderButtons(notification: INotificationViewItem): void {
		clearNode(this.template.buttonsContainer);

		const primaryActions = notification.actions ? notification.actions.primary : undefined;
		if (notification.expanded && isNonEmptyArray(primaryActions)) {
			const buttonGroup = new ButtonGroup(this.template.buttonsContainer, primaryActions.length, { title: true /* assign titles to buttons in case they overflow */ });
			buttonGroup.buttons.forEach((button, index) => {
				const action = primaryActions[index];
				button.label = action.label;

				this.inputDisposables.add(button.onDidClick(e => {
					EventHelper.stop(e, true);

					// Run action
					this.actionRunner.run(action, notification);

					// Hide notification (unless explicitly prevented)
					if (!(action instanceof ChoiceAction) || !action.keepOpen) {
						notification.close();
					}
				}));

				this.inputDisposables.add(attachButtonStyler(button, this.themeService));
			});

			this.inputDisposables.add(buttonGroup);
		}
	}

	private renderProgress(notification: INotificationViewItem): void {

		// Return early if the item has no progress
		if (!notification.hasProgress) {
			this.template.progress.stop().hide();

			return;
		}

		// Infinite
		const state = notification.progress.state;
		if (state.infinite) {
			this.template.progress.infinite().show();
		}

		// Total / Worked
		else if (typeof state.total === 'number' || typeof state.worked === 'number') {
			if (typeof state.total === 'number' && !this.template.progress.hasTotal()) {
				this.template.progress.total(state.total);
			}

			if (typeof state.worked === 'number') {
				this.template.progress.setWorked(state.worked).show();
			}
		}

		// Done
		else {
			this.template.progress.done().hide();
		}
	}

	private toSeverityIcon(severity: Severity): Codicon {
		switch (severity) {
			case Severity.Warning:
				return Codicon.warning;
			case Severity.Error:
				return Codicon.error;
		}
		return Codicon.info;
	}

	private getKeybindingLabel(action: IAction): string | null {
		const keybinding = this.keybindingService.lookupKeybinding(action.id);

		return keybinding ? keybinding.getLabel() : null;
	}
}
