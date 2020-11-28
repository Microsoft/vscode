/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction, IActionRunner, ActionRunner, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification, Separator, SubmenuAction } from 'vs/base/common/actions';
import * as dom from 'vs/base/browser/dom';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { getZoomFactor } from 'vs/base/browser/browser';
import { unmnemonicLabel } from 'vs/base/common/labels';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IContextMenuDelegate, IContextMenuEvent } from 'vs/base/browser/contextmenu';
import { once } from 'vs/base/common/functional';
import { Disposable } from 'vs/base/common/lifecycle';
import { IContextMenuItem } from 'vs/base/parts/contextmenu/common/contextmenu';
import { popup } from 'vs/base/parts/contextmenu/electron-sandbox/contextmenu';
import { getTitleBarStyle } from 'vs/platform/windows/common/windows';
import { isMacintosh } from 'vs/base/common/platform';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ContextMenuService as HTMLContextMenuService } from 'vs/platform/contextview/browser/contextMenuService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { stripCodicons } from 'vs/base/common/codicons';
import { coalesce } from 'vs/base/common/arrays';

export class ContextMenuService extends Disposable implements IContextMenuService {

	declare readonly _serviceBrand: undefined;

	private impl: IContextMenuService;

	constructor(
		@INotificationService notificationService: INotificationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IContextViewService contextViewService: IContextViewService,
		@IThemeService themeService: IThemeService
	) {
		super();

		// Custom context menu: Linux/Windows if custom title is enabled
		if (!isMacintosh && getTitleBarStyle(configurationService) === 'custom') {
			this.impl = new HTMLContextMenuService(telemetryService, notificationService, contextViewService, keybindingService, themeService);
		}

		// Native context menu: otherwise
		else {
			this.impl = new NativeContextMenuService(notificationService, telemetryService, keybindingService);
		}
	}

	showContextMenu(delegate: IContextMenuDelegate): void {
		this.impl.showContextMenu(delegate);
	}
}

class NativeContextMenuService extends Disposable implements IContextMenuService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@INotificationService private readonly notificationService: INotificationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IKeybindingService private readonly keybindingService: IKeybindingService
	) {
		super();
	}

	showContextMenu(delegate: IContextMenuDelegate): void {
		const actions = delegate.getActions();
		if (actions.length) {
			const onHide = once(() => {
				if (delegate.onHide) {
					delegate.onHide(false);
				}

				dom.ModifierKeyEmitter.getInstance().resetKeyStatus();
			});

			const menu = this.createMenu(delegate, actions, onHide);
			const anchor = delegate.getAnchor();

			let x: number;
			let y: number;

			const zoom = getZoomFactor();
			if (dom.isHTMLElement(anchor)) {
				const elementPosition = dom.getDomNodePagePosition(anchor);

				x = elementPosition.left;
				y = elementPosition.top + elementPosition.height;

				// Shift macOS menus by a few pixels below elements
				// to account for extra padding on top of native menu
				// https://github.com/microsoft/vscode/issues/84231
				if (isMacintosh) {
					y += 4 / zoom;
				}
			} else {
				const pos: { x: number; y: number; } = anchor;
				x = pos.x + 1; /* prevent first item from being selected automatically under mouse */
				y = pos.y;
			}

			x *= zoom;
			y *= zoom;

			popup(menu, {
				x: Math.floor(x),
				y: Math.floor(y),
				positioningItem: delegate.autoSelectFirstItem ? 0 : undefined,
			}, () => onHide());
		}
	}

	private createMenu(delegate: IContextMenuDelegate, entries: IAction[], onHide: () => void, submenuIds = new Set<string>()): IContextMenuItem[] {
		const actionRunner = delegate.actionRunner || new ActionRunner();
		return coalesce(entries.map(entry => this.createMenuItem(delegate, entry, actionRunner, onHide, submenuIds)));
	}

	private createMenuItem(delegate: IContextMenuDelegate, entry: IAction, actionRunner: IActionRunner, onHide: () => void, submenuIds: Set<string>): IContextMenuItem | undefined {
		// Separator
		if (entry instanceof Separator) {
			return { type: 'separator' };
		}

		// Submenu
		if (entry instanceof SubmenuAction) {
			if (submenuIds.has(entry.id)) {
				console.warn(`Found submenu cycle: ${entry.id}`);
				return undefined;
			}

			return {
				label: unmnemonicLabel(stripCodicons(entry.label)).trim(),
				submenu: this.createMenu(delegate, entry.actions, onHide, new Set([...submenuIds, entry.id]))
			};
		}

		// Normal Menu Item
		else {
			let type: 'radio' | 'checkbox' | undefined = undefined;
			if (!!entry.checked) {
				if (typeof delegate.getCheckedActionsRepresentation === 'function') {
					type = delegate.getCheckedActionsRepresentation(entry);
				} else {
					type = 'checkbox';
				}
			}

			const item: IContextMenuItem = {
				label: unmnemonicLabel(stripCodicons(entry.label)).trim(),
				checked: !!entry.checked,
				type,
				enabled: !!entry.enabled,
				click: event => {

					// To preserve pre-electron-2.x behaviour, we first trigger
					// the onHide callback and then the action.
					// Fixes https://github.com/microsoft/vscode/issues/45601
					onHide();

					// Run action which will close the menu
					this.runAction(actionRunner, entry, delegate, event);
				}
			};

			const keybinding = !!delegate.getKeyBinding ? delegate.getKeyBinding(entry) : this.keybindingService.lookupKeybinding(entry.id);
			if (keybinding) {
				const electronAccelerator = keybinding.getElectronAccelerator();
				if (electronAccelerator) {
					item.accelerator = electronAccelerator;
				} else {
					const label = keybinding.getLabel();
					if (label) {
						item.label = `${item.label} [${label}]`;
					}
				}
			}

			return item;
		}
	}

	private async runAction(actionRunner: IActionRunner, actionToRun: IAction, delegate: IContextMenuDelegate, event: IContextMenuEvent): Promise<void> {
		this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: actionToRun.id, from: 'contextMenu' });

		const context = delegate.getActionsContext ? delegate.getActionsContext(event) : undefined;

		const runnable = actionRunner.run(actionToRun, context);
		if (runnable) {
			try {
				await runnable;
			} catch (error) {
				this.notificationService.error(error);
			}
		}
	}
}

registerSingleton(IContextMenuService, ContextMenuService, true);
