/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { isThenable } from 'vs/base/common/async';

export const ILifecycleService = createDecorator<ILifecycleService>('lifecycleService');

/**
 * An event that is send out when the window is about to close. Clients have a chance to veto
 * the closing by either calling veto with a boolean "true" directly or with a promise that
 * resolves to a boolean. Returning a promise is useful in cases of long running operations
 * on shutdown.
 *
 * Note: It is absolutely important to avoid long running promises if possible. Please try hard
 * to return a boolean directly. Returning a promise has quite an impact on the shutdown sequence!
 */
export interface BeforeShutdownEvent {

	/**
	 * Allows to veto the shutdown. The veto can be a long running operation but it
	 * will block the application from closing.
	 */
	veto(value: boolean | Promise<boolean>): void;

	/**
	 * The reason why the application will be shutting down.
	 */
	readonly reason: ShutdownReason;
}

/**
 * An event that is send out when the window closes. Clients have a chance to join the closing
 * by providing a promise from the join method. Returning a promise is useful in cases of long
 * running operations on shutdown.
 *
 * Note: It is absolutely important to avoid long running promises if possible. Please try hard
 * to return a boolean directly. Returning a promise has quite an impact on the shutdown sequence!
 */
export interface WillShutdownEvent {

	/**
	 * Allows to join the shutdown. The promise can be a long running operation but it
	 * will block the application from closing.
	 */
	join(promise: Promise<void>): void;

	/**
	 * The reason why the application is shutting down.
	 */
	readonly reason: ShutdownReason;
}

export const enum ShutdownReason {

	/** Window is closed */
	CLOSE = 1,

	/** Application is quit */
	QUIT = 2,

	/** Window is reloaded */
	RELOAD = 3,

	/** Other configuration loaded into window */
	LOAD = 4
}

export const enum StartupKind {
	NewWindow = 1,
	ReloadedWindow = 3,
	ReopenedWindow = 4,
}

export function StartupKindToString(startupKind: StartupKind): string {
	switch (startupKind) {
		case StartupKind.NewWindow: return 'NewWindow';
		case StartupKind.ReloadedWindow: return 'ReloadedWindow';
		case StartupKind.ReopenedWindow: return 'ReopenedWindow';
	}
}

export const enum LifecyclePhase {

	/**
	 * The first phase signals that we are about to startup getting ready.
	 */
	Starting = 1,

	/**
	 * Services are ready and the view is about to restore its state.
	 */
	Ready = 2,

	/**
	 * Views, panels and editors have restored. For editors this means, that
	 * they show their contents fully.
	 */
	Restored = 3,

	/**
	 * The last phase after views, panels and editors have restored and
	 * some time has passed (few seconds).
	 */
	Eventually = 4
}

export function LifecyclePhaseToString(phase: LifecyclePhase) {
	switch (phase) {
		case LifecyclePhase.Starting: return 'Starting';
		case LifecyclePhase.Ready: return 'Ready';
		case LifecyclePhase.Restored: return 'Restored';
		case LifecyclePhase.Eventually: return 'Eventually';
	}
}

/**
 * A lifecycle service informs about lifecycle events of the
 * application, such as shutdown.
 */
export interface ILifecycleService {

	readonly _serviceBrand: undefined;

	/**
	 * Value indicates how this window got loaded.
	 */
	readonly startupKind: StartupKind;

	/**
	 * A flag indicating in what phase of the lifecycle we currently are.
	 */
	phase: LifecyclePhase;

	/**
	 * Fired before shutdown happens. Allows listeners to veto against the
	 * shutdown to prevent it from happening.
	 *
	 * The event carries a shutdown reason that indicates how the shutdown was triggered.
	 */
	readonly onBeforeShutdown: Event<BeforeShutdownEvent>;

	/**
	 * Fired when no client is preventing the shutdown from happening (from onBeforeShutdown).
	 * Can be used to save UI state even if that is long running through the WillShutdownEvent#join()
	 * method.
	 *
	 * The event carries a shutdown reason that indicates how the shutdown was triggered.
	 */
	readonly onWillShutdown: Event<WillShutdownEvent>;

	/**
	 * Fired when the shutdown is about to happen after long running shutdown operations
	 * have finished (from onWillShutdown). This is the right place to dispose resources.
	 */
	readonly onShutdown: Event<void>;

	/**
	 * Returns a promise that resolves when a certain lifecycle phase
	 * has started.
	 */
	when(phase: LifecyclePhase): Promise<void>;
}

export const NullLifecycleService: ILifecycleService = {

	_serviceBrand: undefined,

	onBeforeShutdown: Event.None,
	onWillShutdown: Event.None,
	onShutdown: Event.None,

	phase: LifecyclePhase.Restored,
	startupKind: StartupKind.NewWindow,

	when() { return Promise.resolve(); }
};

// Shared veto handling across main and renderer
export function handleVetos(vetos: (boolean | Promise<boolean>)[], onError: (error: Error) => void): Promise<boolean /* veto */> {
	if (vetos.length === 0) {
		return Promise.resolve(false);
	}

	const promises: Promise<void>[] = [];
	let lazyValue = false;

	for (let valueOrPromise of vetos) {

		// veto, done
		if (valueOrPromise === true) {
			return Promise.resolve(true);
		}

		if (isThenable(valueOrPromise)) {
			promises.push(valueOrPromise.then(value => {
				if (value) {
					lazyValue = true; // veto, done
				}
			}, err => {
				onError(err); // error, treated like a veto, done
				lazyValue = true;
			}));
		}
	}

	return Promise.all(promises).then(() => lazyValue);
}
