/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ipcMain as ipc, app, BrowserWindow } from 'electron';
import { ILogService } from 'vs/platform/log/common/log';
import { IStateService } from 'vs/platform/state/node/state';
import { Event, Emitter } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ICodeWindow } from 'vs/platform/windows/electron-main/windows';
import { handleVetos } from 'vs/platform/lifecycle/common/lifecycle';
import { isMacintosh, isWindows } from 'vs/base/common/platform';
import { Disposable } from 'vs/base/common/lifecycle';
import { Barrier, timeout } from 'vs/base/common/async';
import { ParsedArgs } from 'vs/platform/environment/node/argv';

export const ILifecycleMainService = createDecorator<ILifecycleMainService>('lifecycleMainService');

export const enum UnloadReason {
	CLOSE = 1,
	QUIT = 2,
	RELOAD = 3,
	LOAD = 4
}

export interface IWindowUnloadEvent {
	window: ICodeWindow;
	reason: UnloadReason;
	veto(value: boolean | Promise<boolean>): void;
}

export interface ShutdownEvent {

	/**
	 * Allows to join the shutdown. The promise can be a long running operation but it
	 * will block the application from closing.
	 */
	join(promise: Promise<void>): void;
}

export interface ILifecycleMainService {

	readonly _serviceBrand: undefined;

	/**
	 * Will be true if the program was restarted (e.g. due to explicit request or update).
	 */
	readonly wasRestarted: boolean;

	/**
	 * Will be true if the program was requested to quit.
	 */
	readonly quitRequested: boolean;

	/**
	 * A flag indicating in what phase of the lifecycle we currently are.
	 */
	phase: LifecycleMainPhase;

	/**
	 * An event that fires when the application is about to shutdown before any window is closed.
	 * The shutdown can still be prevented by any window that vetos this event.
	 */
	readonly onBeforeShutdown: Event<void>;

	/**
	 * An event that fires after the onBeforeShutdown event has been fired and after no window has
	 * vetoed the shutdown sequence. At this point listeners are ensured that the application will
	 * quit without veto.
	 */
	readonly onWillShutdown: Event<ShutdownEvent>;

	/**
	 * An event that fires before a window closes. This event is fired after any veto has been dealt
	 * with so that listeners know for sure that the window will close without veto.
	 */
	readonly onBeforeWindowClose: Event<ICodeWindow>;

	/**
	 * An event that fires before a window is about to unload. Listeners can veto this event to prevent
	 * the window from unloading.
	 */
	readonly onBeforeWindowUnload: Event<IWindowUnloadEvent>;

	/**
	 * Reload a window. All lifecycle event handlers are triggered.
	 */
	reload(window: ICodeWindow, cli?: ParsedArgs): Promise<void>;

	/**
	 * Unload a window for the provided reason. All lifecycle event handlers are triggered.
	 */
	unload(window: ICodeWindow, reason: UnloadReason): Promise<boolean /* veto */>;

	/**
	 * Restart the application with optional arguments (CLI). All lifecycle event handlers are triggered.
	 */
	relaunch(options?: { addArgs?: string[], removeArgs?: string[] }): void;

	/**
	 * Shutdown the application normally. All lifecycle event handlers are triggered.
	 */
	quit(fromUpdate?: boolean): Promise<boolean /* veto */>;

	/**
	 * Forcefully shutdown the application. No livecycle event handlers are triggered.
	 */
	kill(code?: number): Promise<void>;

	/**
	 * Returns a promise that resolves when a certain lifecycle phase
	 * has started.
	 */
	when(phase: LifecycleMainPhase): Promise<void>;
}

export const enum LifecycleMainPhase {

	/**
	 * The first phase signals that we are about to startup.
	 */
	Starting = 1,

	/**
	 * Services are ready and first window is about to open.
	 */
	Ready = 2,

	/**
	 * This phase signals a point in time after the window has opened
	 * and is typically the best place to do work that is not required
	 * for the window to open.
	 */
	AfterWindowOpen = 3
}

export class LifecycleMainService extends Disposable implements ILifecycleMainService {

	declare readonly _serviceBrand: undefined;

	private static readonly QUIT_FROM_RESTART_MARKER = 'quit.from.restart'; // use a marker to find out if the session was restarted

	private readonly _onBeforeShutdown = this._register(new Emitter<void>());
	readonly onBeforeShutdown = this._onBeforeShutdown.event;

	private readonly _onWillShutdown = this._register(new Emitter<ShutdownEvent>());
	readonly onWillShutdown = this._onWillShutdown.event;

	private readonly _onBeforeWindowClose = this._register(new Emitter<ICodeWindow>());
	readonly onBeforeWindowClose = this._onBeforeWindowClose.event;

	private readonly _onBeforeWindowUnload = this._register(new Emitter<IWindowUnloadEvent>());
	readonly onBeforeWindowUnload = this._onBeforeWindowUnload.event;

	private _quitRequested = false;
	get quitRequested(): boolean { return this._quitRequested; }

	private _wasRestarted: boolean = false;
	get wasRestarted(): boolean { return this._wasRestarted; }

	private _phase = LifecycleMainPhase.Starting;
	get phase(): LifecycleMainPhase { return this._phase; }

	private readonly windowToCloseRequest = new Set<number>();
	private oneTimeListenerTokenGenerator = 0;
	private windowCounter = 0;

	private pendingQuitPromise: Promise<boolean> | null = null;
	private pendingQuitPromiseResolve: { (veto: boolean): void } | null = null;

	private pendingWillShutdownPromise: Promise<void> | null = null;

	private readonly phaseWhen = new Map<LifecycleMainPhase, Barrier>();

	constructor(
		@ILogService private readonly logService: ILogService,
		@IStateService private readonly stateService: IStateService
	) {
		super();

		this.handleRestarted();
		this.when(LifecycleMainPhase.Ready).then(() => this.registerListeners());
	}

	private handleRestarted(): void {
		this._wasRestarted = !!this.stateService.getItem(LifecycleMainService.QUIT_FROM_RESTART_MARKER);

		if (this._wasRestarted) {
			this.stateService.removeItem(LifecycleMainService.QUIT_FROM_RESTART_MARKER); // remove the marker right after if found
		}
	}

	private registerListeners(): void {

		// before-quit: an event that is fired if application quit was
		// requested but before any window was closed.
		const beforeQuitListener = () => {
			if (this._quitRequested) {
				return;
			}

			this.logService.trace('Lifecycle#app.on(before-quit)');
			this._quitRequested = true;

			// Emit event to indicate that we are about to shutdown
			this.logService.trace('Lifecycle#onBeforeShutdown.fire()');
			this._onBeforeShutdown.fire();

			// macOS: can run without any window open. in that case we fire
			// the onWillShutdown() event directly because there is no veto
			// to be expected.
			if (isMacintosh && this.windowCounter === 0) {
				this.beginOnWillShutdown();
			}
		};
		app.addListener('before-quit', beforeQuitListener);

		// window-all-closed: an event that only fires when the last window
		// was closed. We override this event to be in charge if app.quit()
		// should be called or not.
		const windowAllClosedListener = () => {
			this.logService.trace('Lifecycle#app.on(window-all-closed)');

			// Windows/Linux: we quit when all windows have closed
			// Mac: we only quit when quit was requested
			if (this._quitRequested || !isMacintosh) {
				app.quit();
			}
		};
		app.addListener('window-all-closed', windowAllClosedListener);

		// will-quit: an event that is fired after all windows have been
		// closed, but before actually quitting.
		app.once('will-quit', e => {
			this.logService.trace('Lifecycle#app.on(will-quit)');

			// Prevent the quit until the shutdown promise was resolved
			e.preventDefault();

			// Start shutdown sequence
			const shutdownPromise = this.beginOnWillShutdown();

			// Wait until shutdown is signaled to be complete
			shutdownPromise.finally(() => {

				// Resolve pending quit promise now without veto
				this.resolvePendingQuitPromise(false /* no veto */);

				// Quit again, this time do not prevent this, since our
				// will-quit listener is only installed "once". Also
				// remove any listener we have that is no longer needed
				app.removeListener('before-quit', beforeQuitListener);
				app.removeListener('window-all-closed', windowAllClosedListener);
				app.quit();
			});
		});
	}

	private beginOnWillShutdown(): Promise<void> {
		if (this.pendingWillShutdownPromise) {
			return this.pendingWillShutdownPromise; // shutdown is already running
		}

		this.logService.trace('Lifecycle#onWillShutdown.fire()');

		const joiners: Promise<void>[] = [];

		this._onWillShutdown.fire({
			join(promise) {
				if (promise) {
					joiners.push(promise);
				}
			}
		});

		this.pendingWillShutdownPromise = Promise.all(joiners).then(() => undefined, err => this.logService.error(err));

		return this.pendingWillShutdownPromise;
	}

	set phase(value: LifecycleMainPhase) {
		if (value < this.phase) {
			throw new Error('Lifecycle cannot go backwards');
		}

		if (this._phase === value) {
			return;
		}

		this.logService.trace(`lifecycle (main): phase changed (value: ${value})`);

		this._phase = value;

		const barrier = this.phaseWhen.get(this._phase);
		if (barrier) {
			barrier.open();
			this.phaseWhen.delete(this._phase);
		}
	}

	async when(phase: LifecycleMainPhase): Promise<void> {
		if (phase <= this._phase) {
			return;
		}

		let barrier = this.phaseWhen.get(phase);
		if (!barrier) {
			barrier = new Barrier();
			this.phaseWhen.set(phase, barrier);
		}

		await barrier.wait();
	}

	registerWindow(window: ICodeWindow): void {

		// track window count
		this.windowCounter++;

		// Window Before Closing: Main -> Renderer
		window.win.on('close', e => {

			// The window already acknowledged to be closed
			const windowId = window.id;
			if (this.windowToCloseRequest.has(windowId)) {
				this.windowToCloseRequest.delete(windowId);

				return;
			}

			this.logService.trace(`Lifecycle#window.on('close') - window ID ${window.id}`);

			// Otherwise prevent unload and handle it from window
			e.preventDefault();
			this.unload(window, UnloadReason.CLOSE).then(veto => {
				if (veto) {
					this.windowToCloseRequest.delete(windowId);
					return;
				}

				this.windowToCloseRequest.add(windowId);

				// Fire onBeforeWindowClose before actually closing
				this.logService.trace(`Lifecycle#onBeforeWindowClose.fire() - window ID ${windowId}`);
				this._onBeforeWindowClose.fire(window);

				// No veto, close window now
				window.close();
			});
		});

		// Window After Closing
		window.win.on('closed', () => {
			this.logService.trace(`Lifecycle#window.on('closed') - window ID ${window.id}`);

			// update window count
			this.windowCounter--;

			// if there are no more code windows opened, fire the onWillShutdown event, unless
			// we are on macOS where it is perfectly fine to close the last window and
			// the application continues running (unless quit was actually requested)
			if (this.windowCounter === 0 && (!isMacintosh || this._quitRequested)) {
				this.beginOnWillShutdown();
			}
		});
	}

	async reload(window: ICodeWindow, cli?: ParsedArgs): Promise<void> {

		// Only reload when the window has not vetoed this
		const veto = await this.unload(window, UnloadReason.RELOAD);
		if (!veto) {
			window.reload(undefined, cli);
		}
	}

	async unload(window: ICodeWindow, reason: UnloadReason): Promise<boolean /* veto */> {

		// Always allow to unload a window that is not yet ready
		if (!window.isReady) {
			return Promise.resolve(false);
		}

		this.logService.trace(`Lifecycle#unload() - window ID ${window.id}`);

		// first ask the window itself if it vetos the unload
		const windowUnloadReason = this._quitRequested ? UnloadReason.QUIT : reason;
		let veto = await this.onBeforeUnloadWindowInRenderer(window, windowUnloadReason);
		if (veto) {
			this.logService.trace(`Lifecycle#unload() - veto in renderer (window ID ${window.id})`);

			return this.handleWindowUnloadVeto(veto);
		}

		// then check for vetos in the main side
		veto = await this.onBeforeUnloadWindowInMain(window, windowUnloadReason);
		if (veto) {
			this.logService.trace(`Lifecycle#unload() - veto in main (window ID ${window.id})`);

			return this.handleWindowUnloadVeto(veto);
		}

		this.logService.trace(`Lifecycle#unload() - no veto (window ID ${window.id})`);

		// finally if there are no vetos, unload the renderer
		await this.onWillUnloadWindowInRenderer(window, windowUnloadReason);

		return false;
	}

	private handleWindowUnloadVeto(veto: boolean): boolean {
		if (!veto) {
			return false; // no veto
		}

		// a veto resolves any pending quit with veto
		this.resolvePendingQuitPromise(true /* veto */);

		// a veto resets the pending quit request flag
		this._quitRequested = false;

		return true; // veto
	}

	private resolvePendingQuitPromise(veto: boolean): void {
		if (this.pendingQuitPromiseResolve) {
			this.pendingQuitPromiseResolve(veto);
			this.pendingQuitPromiseResolve = null;
			this.pendingQuitPromise = null;
		}
	}

	private onBeforeUnloadWindowInRenderer(window: ICodeWindow, reason: UnloadReason): Promise<boolean /* veto */> {
		return new Promise<boolean>(c => {
			const oneTimeEventToken = this.oneTimeListenerTokenGenerator++;
			const okChannel = `vscode:ok${oneTimeEventToken}`;
			const cancelChannel = `vscode:cancel${oneTimeEventToken}`;

			ipc.once(okChannel, () => {
				c(false); // no veto
			});

			ipc.once(cancelChannel, () => {
				c(true); // veto
			});

			window.send('vscode:onBeforeUnload', { okChannel, cancelChannel, reason });
		});
	}

	private onBeforeUnloadWindowInMain(window: ICodeWindow, reason: UnloadReason): Promise<boolean /* veto */> {
		const vetos: (boolean | Promise<boolean>)[] = [];

		this._onBeforeWindowUnload.fire({
			reason,
			window,
			veto(value) {
				vetos.push(value);
			}
		});

		return handleVetos(vetos, err => this.logService.error(err));
	}

	private onWillUnloadWindowInRenderer(window: ICodeWindow, reason: UnloadReason): Promise<void> {
		return new Promise<void>(resolve => {
			const oneTimeEventToken = this.oneTimeListenerTokenGenerator++;
			const replyChannel = `vscode:reply${oneTimeEventToken}`;

			ipc.once(replyChannel, () => resolve());

			window.send('vscode:onWillUnload', { replyChannel, reason });
		});
	}

	quit(fromUpdate?: boolean): Promise<boolean /* veto */> {
		if (this.pendingQuitPromise) {
			return this.pendingQuitPromise;
		}

		this.logService.trace(`Lifecycle#quit() - from update: ${fromUpdate}`);

		// Remember the reason for quit was to restart
		if (fromUpdate) {
			this.stateService.setItem(LifecycleMainService.QUIT_FROM_RESTART_MARKER, true);
		}

		this.pendingQuitPromise = new Promise(resolve => {

			// Store as field to access it from a window cancellation
			this.pendingQuitPromiseResolve = resolve;

			// Calling app.quit() will trigger the close handlers of each opened window
			// and only if no window vetoed the shutdown, we will get the will-quit event
			this.logService.trace('Lifecycle#quit() - calling app.quit()');
			app.quit();
		});

		return this.pendingQuitPromise;
	}

	relaunch(options?: { addArgs?: string[], removeArgs?: string[] }): void {
		this.logService.trace('Lifecycle#relaunch()');

		const args = process.argv.slice(1);
		if (options?.addArgs) {
			args.push(...options.addArgs);
		}

		if (options?.removeArgs) {
			for (const a of options.removeArgs) {
				const idx = args.indexOf(a);
				if (idx >= 0) {
					args.splice(idx, 1);
				}
			}
		}

		let quitVetoed = false;
		app.once('quit', () => {
			if (!quitVetoed) {

				// Remember the reason for quit was to restart
				this.stateService.setItem(LifecycleMainService.QUIT_FROM_RESTART_MARKER, true);

				// Windows: we are about to restart and as such we need to restore the original
				// current working directory we had on startup to get the exact same startup
				// behaviour. As such, we briefly change back to the VSCODE_CWD and then when
				// Code starts it will set it back to the installation directory again.
				try {
					if (isWindows) {
						const vscodeCwd = process.env['VSCODE_CWD'];
						if (vscodeCwd) {
							process.chdir(vscodeCwd);
						}
					}
				} catch (err) {
					this.logService.error(err);
				}

				// relaunch after we are sure there is no veto
				this.logService.trace('Lifecycle#relaunch() - calling app.relaunch()');
				app.relaunch({ args });
			}
		});

		// app.relaunch() does not quit automatically, so we quit first,
		// check for vetoes and then relaunch from the app.on('quit') event
		this.quit().then(veto => quitVetoed = veto);
	}

	async kill(code?: number): Promise<void> {
		this.logService.trace('Lifecycle#kill()');

		// The kill() method is only used in 2 situations:
		// - when an instance fails to start at all
		// - when extension tests run from CLI to report proper exit code
		//
		// From extension tests we have seen issues where calling app.exit()
		// with an opened window can lead to native crashes (Linux) when webviews
		// are involved. As such, we should make sure to destroy any opened
		// window before calling app.exit().
		//
		// Note: Electron implements a similar logic here:
		// https://github.com/electron/electron/blob/fe5318d753637c3903e23fc1ed1b263025887b6a/spec-main/window-helpers.ts#L5

		await Promise.race([

			// still do not block more than 1s
			timeout(1000),

			// destroy any opened window
			(async () => {
				for (const window of BrowserWindow.getAllWindows()) {
					if (window && !window.isDestroyed()) {
						let whenWindowClosed: Promise<void>;
						if (window.webContents && !window.webContents.isDestroyed()) {
							whenWindowClosed = new Promise(c => window.once('closed', c));
						} else {
							whenWindowClosed = Promise.resolve();
						}

						window.destroy();
						await whenWindowClosed;
					}
				}
			})()
		]);

		// Now exit either after 1s or all windows destroyed
		app.exit(code);
	}
}
