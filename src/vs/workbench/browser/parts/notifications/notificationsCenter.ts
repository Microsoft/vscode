/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/notificationsCenter';
import 'vs/css!./media/notificationsActions';
import { NOTIFICATIONS_BORDER, NOTIFICATIONS_CENTER_HEADER_FOREGROUND, NOTIFICATIONS_CENTER_HEADER_BACKGROUND, NOTIFICATIONS_CENTER_BORDER } from 'vs/workbench/common/theme';
import { IThemeService, registerThemingParticipant, Themable } from 'vs/platform/theme/common/themeService';
import { INotificationsModel, INotificationChangeEvent, NotificationChangeType, NotificationViewItemContentChangeKind } from 'vs/workbench/common/notifications';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { Emitter } from 'vs/base/common/event';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { NotificationsCenterVisibleContext, INotificationsCenterController } from 'vs/workbench/browser/parts/notifications/notificationsCommands';
import { NotificationsList } from 'vs/workbench/browser/parts/notifications/notificationsList';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { isAncestor, Dimension } from 'vs/base/browser/dom';
import { widgetShadow } from 'vs/platform/theme/common/colorRegistry';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { localize } from 'vs/nls';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { ClearAllNotificationsAction, HideNotificationsCenterAction, NotificationActionRunner } from 'vs/workbench/browser/parts/notifications/notificationsActions';
import { IAction } from 'vs/base/common/actions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { assertAllDefined, assertIsDefined } from 'vs/base/common/types';

export class NotificationsCenter extends Themable implements INotificationsCenterController {

	private static readonly MAX_DIMENSIONS = new Dimension(450, 400);

	private readonly _onDidChangeVisibility = this._register(new Emitter<void>());
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	private notificationsCenterContainer: HTMLElement | undefined;
	private notificationsCenterHeader: HTMLElement | undefined;
	private notificationsCenterTitle: HTMLSpanElement | undefined;
	private notificationsList: NotificationsList | undefined;
	private _isVisible: boolean | undefined;
	private workbenchDimensions: Dimension | undefined;
	private readonly notificationsCenterVisibleContextKey = NotificationsCenterVisibleContext.bindTo(this.contextKeyService);
	private clearAllAction: ClearAllNotificationsAction | undefined;

	constructor(
		private readonly container: HTMLElement,
		private readonly model: INotificationsModel,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IKeybindingService private readonly keybindingService: IKeybindingService
	) {
		super(themeService);

		this.notificationsCenterVisibleContextKey = NotificationsCenterVisibleContext.bindTo(contextKeyService);

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.model.onDidChangeNotification(e => this.onDidChangeNotification(e)));
		this._register(this.layoutService.onDidLayout(dimension => this.layout(Dimension.lift(dimension))));
	}

	get isVisible(): boolean {
		return !!this._isVisible;
	}

	show(): void {
		if (this._isVisible) {
			const notificationsList = assertIsDefined(this.notificationsList);
			notificationsList.show(true /* focus */);

			return; // already visible
		}

		// Lazily create if showing for the first time
		if (!this.notificationsCenterContainer) {
			this.create();
		}

		// Title
		this.updateTitle();

		// Make visible
		const [notificationsList, notificationsCenterContainer] = assertAllDefined(this.notificationsList, this.notificationsCenterContainer);
		this._isVisible = true;
		notificationsCenterContainer.classList.add('visible');
		notificationsList.show();

		// Layout
		this.layout(this.workbenchDimensions);

		// Show all notifications that are present now
		notificationsList.updateNotificationsList(0, 0, this.model.notifications);

		// Focus first
		notificationsList.focusFirst();

		// Theming
		this.updateStyles();

		// Mark as visible
		this.model.notifications.forEach(notification => notification.updateVisibility(true));

		// Context Key
		this.notificationsCenterVisibleContextKey.set(true);

		// Event
		this._onDidChangeVisibility.fire();
	}

	private updateTitle(): void {
		const [notificationsCenterTitle, clearAllAction] = assertAllDefined(this.notificationsCenterTitle, this.clearAllAction);

		if (this.model.notifications.length === 0) {
			notificationsCenterTitle.textContent = localize('notificationsEmpty', "No new notifications");
			clearAllAction.enabled = false;
		} else {
			notificationsCenterTitle.textContent = localize('notifications', "Notifications");
			clearAllAction.enabled = this.model.notifications.some(notification => !notification.hasProgress);
		}
	}

	private create(): void {

		// Container
		this.notificationsCenterContainer = document.createElement('div');
		this.notificationsCenterContainer.classList.add('notifications-center');

		// Header
		this.notificationsCenterHeader = document.createElement('div');
		this.notificationsCenterHeader.classList.add('notifications-center-header');
		this.notificationsCenterContainer.appendChild(this.notificationsCenterHeader);

		// Header Title
		this.notificationsCenterTitle = document.createElement('span');
		this.notificationsCenterTitle.classList.add('notifications-center-header-title');
		this.notificationsCenterHeader.appendChild(this.notificationsCenterTitle);

		// Header Toolbar
		const toolbarContainer = document.createElement('div');
		toolbarContainer.classList.add('notifications-center-header-toolbar');
		this.notificationsCenterHeader.appendChild(toolbarContainer);

		const actionRunner = this._register(this.instantiationService.createInstance(NotificationActionRunner));

		const notificationsToolBar = this._register(new ActionBar(toolbarContainer, {
			ariaLabel: localize('notificationsToolbar', "Notification Center Actions"),
			actionRunner
		}));

		this.clearAllAction = this._register(this.instantiationService.createInstance(ClearAllNotificationsAction, ClearAllNotificationsAction.ID, ClearAllNotificationsAction.LABEL));
		notificationsToolBar.push(this.clearAllAction, { icon: true, label: false, keybinding: this.getKeybindingLabel(this.clearAllAction) });

		const hideAllAction = this._register(this.instantiationService.createInstance(HideNotificationsCenterAction, HideNotificationsCenterAction.ID, HideNotificationsCenterAction.LABEL));
		notificationsToolBar.push(hideAllAction, { icon: true, label: false, keybinding: this.getKeybindingLabel(hideAllAction) });

		// Notifications List
		this.notificationsList = this.instantiationService.createInstance(NotificationsList, this.notificationsCenterContainer, {});
		this.container.appendChild(this.notificationsCenterContainer);
	}

	private getKeybindingLabel(action: IAction): string | null {
		const keybinding = this.keybindingService.lookupKeybinding(action.id);

		return keybinding ? keybinding.getLabel() : null;
	}

	private onDidChangeNotification(e: INotificationChangeEvent): void {
		if (!this._isVisible) {
			return; // only if visible
		}

		let focusEditor = false;

		// Update notifications list based on event kind
		const [notificationsList, notificationsCenterContainer] = assertAllDefined(this.notificationsList, this.notificationsCenterContainer);
		switch (e.kind) {
			case NotificationChangeType.ADD:
				notificationsList.updateNotificationsList(e.index, 0, [e.item]);
				e.item.updateVisibility(true);
				break;
			case NotificationChangeType.CHANGE:
				// Handle content changes
				// - actions: re-draw to properly show them
				// - message: update notification height unless collapsed
				switch (e.detail) {
					case NotificationViewItemContentChangeKind.ACTIONS:
						notificationsList.updateNotificationsList(e.index, 1, [e.item]);
						break;
					case NotificationViewItemContentChangeKind.MESSAGE:
						if (e.item.expanded) {
							notificationsList.updateNotificationHeight(e.item);
						}
						break;
				}
				break;
			case NotificationChangeType.EXPAND_COLLAPSE:
				// Re-draw entire item when expansion changes to reveal or hide details
				notificationsList.updateNotificationsList(e.index, 1, [e.item]);
				break;
			case NotificationChangeType.REMOVE:
				focusEditor = isAncestor(document.activeElement, notificationsCenterContainer);
				notificationsList.updateNotificationsList(e.index, 1);
				e.item.updateVisibility(false);
				break;
		}

		// Update title
		this.updateTitle();

		// Hide if no more notifications to show
		if (this.model.notifications.length === 0) {
			this.hide();

			// Restore focus to editor group if we had focus
			if (focusEditor) {
				this.editorGroupService.activeGroup.focus();
			}
		}
	}

	hide(): void {
		if (!this._isVisible || !this.notificationsCenterContainer || !this.notificationsList) {
			return; // already hidden
		}

		const focusEditor = isAncestor(document.activeElement, this.notificationsCenterContainer);

		// Hide
		this._isVisible = false;
		this.notificationsCenterContainer.classList.remove('visible');
		this.notificationsList.hide();

		// Mark as hidden
		this.model.notifications.forEach(notification => notification.updateVisibility(false));

		// Context Key
		this.notificationsCenterVisibleContextKey.set(false);

		// Event
		this._onDidChangeVisibility.fire();

		// Restore focus to editor group if we had focus
		if (focusEditor) {
			this.editorGroupService.activeGroup.focus();
		}
	}

	protected override updateStyles(): void {
		if (this.notificationsCenterContainer && this.notificationsCenterHeader) {
			const widgetShadowColor = this.getColor(widgetShadow);
			this.notificationsCenterContainer.style.boxShadow = widgetShadowColor ? `0 0 8px 2px ${widgetShadowColor}` : '';

			const borderColor = this.getColor(NOTIFICATIONS_CENTER_BORDER);
			this.notificationsCenterContainer.style.border = borderColor ? `1px solid ${borderColor}` : '';

			const headerForeground = this.getColor(NOTIFICATIONS_CENTER_HEADER_FOREGROUND);
			this.notificationsCenterHeader.style.color = headerForeground ? headerForeground.toString() : '';

			const headerBackground = this.getColor(NOTIFICATIONS_CENTER_HEADER_BACKGROUND);
			this.notificationsCenterHeader.style.background = headerBackground ? headerBackground.toString() : '';
		}
	}

	layout(dimension: Dimension | undefined): void {
		this.workbenchDimensions = dimension;

		if (this._isVisible && this.notificationsCenterContainer) {
			let maxWidth = NotificationsCenter.MAX_DIMENSIONS.width;
			let maxHeight = NotificationsCenter.MAX_DIMENSIONS.height;

			let availableWidth = maxWidth;
			let availableHeight = maxHeight;

			if (this.workbenchDimensions) {

				// Make sure notifications are not exceding available width
				availableWidth = this.workbenchDimensions.width;
				availableWidth -= (2 * 8); // adjust for paddings left and right

				// Make sure notifications are not exceeding available height
				availableHeight = this.workbenchDimensions.height - 35 /* header */;
				if (this.layoutService.isVisible(Parts.STATUSBAR_PART)) {
					availableHeight -= 22; // adjust for status bar
				}

				if (this.layoutService.isVisible(Parts.TITLEBAR_PART)) {
					availableHeight -= 22; // adjust for title bar
				}

				availableHeight -= (2 * 12); // adjust for paddings top and bottom
			}

			// Apply to list
			const notificationsList = assertIsDefined(this.notificationsList);
			notificationsList.layout(Math.min(maxWidth, availableWidth), Math.min(maxHeight, availableHeight));
		}
	}

	clearAll(): void {

		// Hide notifications center first
		this.hide();

		// Close all
		for (const notification of [...this.model.notifications] /* copy array since we modify it from closing */) {
			if (!notification.hasProgress) {
				notification.close();
			}
		}
	}
}

registerThemingParticipant((theme, collector) => {
	const notificationBorderColor = theme.getColor(NOTIFICATIONS_BORDER);
	if (notificationBorderColor) {
		collector.addRule(`.monaco-workbench > .notifications-center .notifications-list-container .monaco-list-row[data-last-element="false"] > .notification-list-item { border-bottom: 1px solid ${notificationBorderColor}; }`);
	}
});
