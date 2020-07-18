/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ContextMenuHandler, IContextMenuHandlerOptions } from './contextMenuHandler';
import { IContextViewService, IContextMenuService } from './contextView';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { Event, Emitter } from 'vs/base/common/event';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IContextMenuDelegate } from 'vs/base/browser/contextmenu';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { Disposable } from 'vs/base/common/lifecycle';

export class ContextMenuService extends Disposable implements IContextMenuService {
	declare readonly _serviceBrand: undefined;

	private _onDidContextMenu = this._register(new Emitter<void>());
	readonly onDidContextMenu: Event<void> = this._onDidContextMenu.event;

	private contextMenuHandler: ContextMenuHandler;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@INotificationService notificationService: INotificationService,
		@IContextViewService contextViewService: IContextViewService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IThemeService themeService: IThemeService
	) {
		super();

		this.contextMenuHandler = new ContextMenuHandler(contextViewService, telemetryService, notificationService, keybindingService, themeService);
	}

	configure(options: IContextMenuHandlerOptions): void {
		this.contextMenuHandler.configure(options);
	}

	// ContextMenu

	showContextMenu(delegate: IContextMenuDelegate): void {
		this.contextMenuHandler.showContextMenu(delegate);
		this._onDidContextMenu.fire();
	}
}
