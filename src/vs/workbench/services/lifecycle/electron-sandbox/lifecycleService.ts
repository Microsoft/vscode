/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { handleVetos } from 'vs/platform/lifecycle/common/lifecycle';
import { ShutdownReason, StartupKind, ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from 'vs/platform/storage/common/storage';
import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { onUnexpectedError } from 'vs/base/common/errors';
import { AbstractLifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycleService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import Severity from 'vs/base/common/severity';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { Promises, disposableTimeout } from 'vs/base/common/async';

export class NativeLifecycleService extends AbstractLifecycleService {

	private static readonly LAST_SHUTDOWN_REASON_KEY = 'lifecyle.lastShutdownReason';

	private static readonly BEFORE_SHUTDOWN_WARNING_DELAY = 5000;
	private static readonly WILL_SHUTDOWN_WARNING_DELAY = 5000;

	private shutdownReason: ShutdownReason | undefined;

	constructor(
		@INotificationService private readonly notificationService: INotificationService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IStorageService readonly storageService: IStorageService,
		@ILogService logService: ILogService
	) {
		super(logService);

		this._startupKind = this.resolveStartupKind();

		this.registerListeners();
	}

	private resolveStartupKind(): StartupKind {
		const lastShutdownReason = this.storageService.getNumber(NativeLifecycleService.LAST_SHUTDOWN_REASON_KEY, StorageScope.WORKSPACE);
		this.storageService.remove(NativeLifecycleService.LAST_SHUTDOWN_REASON_KEY, StorageScope.WORKSPACE);

		let startupKind: StartupKind;
		if (lastShutdownReason === ShutdownReason.RELOAD) {
			startupKind = StartupKind.ReloadedWindow;
		} else if (lastShutdownReason === ShutdownReason.LOAD) {
			startupKind = StartupKind.ReopenedWindow;
		} else {
			startupKind = StartupKind.NewWindow;
		}

		this.logService.trace(`[lifecycle] starting up (startup kind: ${this._startupKind})`);

		return startupKind;
	}

	private registerListeners(): void {
		const windowId = this.nativeHostService.windowId;

		// Main side indicates that window is about to unload, check for vetos
		ipcRenderer.on('vscode:onBeforeUnload', (event: unknown, reply: { okChannel: string, cancelChannel: string, reason: ShutdownReason }) => {
			this.logService.trace(`[lifecycle] onBeforeUnload (reason: ${reply.reason})`);

			// trigger onBeforeShutdown events and veto collecting
			this.handleBeforeShutdown(reply.reason).then(veto => {
				if (veto) {
					this.logService.trace('[lifecycle] onBeforeUnload prevented via veto');

					ipcRenderer.send(reply.cancelChannel, windowId);
				} else {
					this.logService.trace('[lifecycle] onBeforeUnload continues without veto');

					this.shutdownReason = reply.reason;
					ipcRenderer.send(reply.okChannel, windowId);
				}
			});
		});

		// Main side indicates that we will indeed shutdown
		ipcRenderer.on('vscode:onWillUnload', async (event: unknown, reply: { replyChannel: string, reason: ShutdownReason }) => {
			this.logService.trace(`[lifecycle] onWillUnload (reason: ${reply.reason})`);

			// trigger onWillShutdown events and joining
			await this.handleWillShutdown(reply.reason);

			// trigger onDidShutdown event now that we know we will quit
			this._onDidShutdown.fire();

			// acknowledge to main side
			ipcRenderer.send(reply.replyChannel, windowId);
		});

		// Save shutdown reason to retrieve on next startup
		this.storageService.onWillSaveState(e => {
			if (e.reason === WillSaveStateReason.SHUTDOWN) {
				this.storageService.store(NativeLifecycleService.LAST_SHUTDOWN_REASON_KEY, this.shutdownReason, StorageScope.WORKSPACE, StorageTarget.MACHINE);
			}
		});
	}

	private async handleBeforeShutdown(reason: ShutdownReason): Promise<boolean> {
		const logService = this.logService;
		const vetos: (boolean | Promise<boolean>)[] = [];
		const pendingVetos = new Set<string>();

		this._onBeforeShutdown.fire({
			veto(value, id) {
				vetos.push(value);

				// Log any veto instantly
				if (value === true) {
					logService.info(`[lifecycle]: Shutdown was prevented (id: ${id})`);
				}

				// Track promise completion
				else if (value instanceof Promise) {
					pendingVetos.add(id);
					value.then(veto => {
						if (veto === true) {
							logService.info(`[lifecycle]: Shutdown was prevented (id: ${id})`);
						}
					}).finally(() => pendingVetos.delete(id));
				}
			},
			reason
		});

		const longRunningBeforeShutdownWarning = disposableTimeout(() => {
			logService.warn(`[lifecycle] onBeforeShutdown is taking a long time, pending operations: ${Array.from(pendingVetos).join(', ')}`);
		}, NativeLifecycleService.BEFORE_SHUTDOWN_WARNING_DELAY);

		try {
			return await handleVetos(vetos, error => this.onShutdownError(reason, error));
		} finally {
			longRunningBeforeShutdownWarning.dispose();
		}
	}

	private async handleWillShutdown(reason: ShutdownReason): Promise<void> {
		const joiners: Promise<void>[] = [];
		const pendingJoiners = new Set<string>();

		this._onWillShutdown.fire({
			join(promise, id) {
				joiners.push(promise);

				// Track promise completion
				pendingJoiners.add(id);
				promise.finally(() => pendingJoiners.delete(id));
			},
			reason
		});

		const longRunningWillShutdownWarning = disposableTimeout(() => {
			this.logService.warn(`[lifecycle] onWillShutdown is taking a long time, pending operations: ${Array.from(pendingJoiners).join(', ')}`);
		}, NativeLifecycleService.WILL_SHUTDOWN_WARNING_DELAY);

		try {
			await Promises.settled(joiners);
		} catch (error) {
			this.onShutdownError(reason, error);
		} finally {
			longRunningWillShutdownWarning.dispose();
		}
	}

	private onShutdownError(reason: ShutdownReason, error: Error): void {
		let message: string;
		switch (reason) {
			case ShutdownReason.CLOSE:
				message = localize('errorClose', "An unexpected error was thrown while attempting to close the window ({0}).", toErrorMessage(error));
				break;
			case ShutdownReason.QUIT:
				message = localize('errorQuit', "An unexpected error was thrown while attempting to quit the application ({0}).", toErrorMessage(error));
				break;
			case ShutdownReason.RELOAD:
				message = localize('errorReload', "An unexpected error was thrown while attempting to reload the window ({0}).", toErrorMessage(error));
				break;
			case ShutdownReason.LOAD:
				message = localize('errorLoad', "An unexpected error was thrown while attempting to change the workspace of the window ({0}).", toErrorMessage(error));
				break;
		}

		this.notificationService.notify({
			severity: Severity.Error,
			message,
			sticky: true
		});

		onUnexpectedError(error);
	}

	shutdown(): void {
		this.nativeHostService.closeWindow();
	}
}

registerSingleton(ILifecycleService, NativeLifecycleService);
