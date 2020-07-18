/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILabelService } from 'vs/platform/label/common/label';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWindowOpenable, IOpenWindowOptions, isFolderToOpen, isWorkspaceToOpen, IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';
import { Disposable } from 'vs/base/common/lifecycle';

export class DesktopHostService extends Disposable implements IHostService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IElectronService private readonly electronService: IElectronService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService
	) {
		super();
	}

	get onDidChangeFocus(): Event<boolean> { return this._onDidChangeFocus; }
	private _onDidChangeFocus: Event<boolean> = Event.latch(Event.any(
		Event.map(Event.filter(this.electronService.onWindowFocus, id => id === this.electronService.windowId), () => this.hasFocus),
		Event.map(Event.filter(this.electronService.onWindowBlur, id => id === this.electronService.windowId), () => this.hasFocus)
	));

	get hasFocus(): boolean {
		return document.hasFocus();
	}

	async hadLastFocus(): Promise<boolean> {
		const activeWindowId = await this.electronService.getActiveWindowId();

		if (typeof activeWindowId === 'undefined') {
			return false;
		}

		return activeWindowId === this.electronService.windowId;
	}

	openWindow(options?: IOpenEmptyWindowOptions): Promise<void>;
	openWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void>;
	openWindow(arg1?: IOpenEmptyWindowOptions | IWindowOpenable[], arg2?: IOpenWindowOptions): Promise<void> {
		if (Array.isArray(arg1)) {
			return this.doOpenWindow(arg1, arg2);
		}

		return this.doOpenEmptyWindow(arg1);
	}

	private doOpenWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void> {
		if (!!this.environmentService.configuration.remoteAuthority) {
			toOpen.forEach(openable => openable.label = openable.label || this.getRecentLabel(openable));
		}

		return this.electronService.openWindow(toOpen, options);
	}

	private getRecentLabel(openable: IWindowOpenable): string {
		if (isFolderToOpen(openable)) {
			return this.labelService.getWorkspaceLabel(openable.folderUri, { verbose: true });
		}

		if (isWorkspaceToOpen(openable)) {
			return this.labelService.getWorkspaceLabel({ id: '', configPath: openable.workspaceUri }, { verbose: true });
		}

		return this.labelService.getUriLabel(openable.fileUri);
	}

	private doOpenEmptyWindow(options?: IOpenEmptyWindowOptions): Promise<void> {
		return this.electronService.openWindow(options);
	}

	toggleFullScreen(): Promise<void> {
		return this.electronService.toggleFullScreen();
	}

	focus(): Promise<void> {
		return this.electronService.focusWindow();
	}

	restart(): Promise<void> {
		return this.electronService.relaunch();
	}

	reload(): Promise<void> {
		return this.electronService.reload();
	}
}

registerSingleton(IHostService, DesktopHostService, true);
