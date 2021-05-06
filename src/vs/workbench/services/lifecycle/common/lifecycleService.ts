/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Barrier } from 'vs/base/common/async';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILifecycleService, BeforeShutdownEvent, WillShutdownEvent, StartupKind, LifecyclePhase, LifecyclePhaseToString } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { mark } from 'vs/base/common/performance';

export abstract class AbstractLifecycleService extends Disposable implements ILifecycleService {

	declare readonly _serviceBrand: undefined;

	protected readonly _onBeforeShutdown = this._register(new Emitter<BeforeShutdownEvent>());
	readonly onBeforeShutdown = this._onBeforeShutdown.event;

	protected readonly _onWillShutdown = this._register(new Emitter<WillShutdownEvent>());
	readonly onWillShutdown = this._onWillShutdown.event;

	protected readonly _onDidShutdown = this._register(new Emitter<void>());
	readonly onDidShutdown = this._onDidShutdown.event;

	protected _startupKind: StartupKind = StartupKind.NewWindow;
	get startupKind(): StartupKind { return this._startupKind; }

	private _phase: LifecyclePhase = LifecyclePhase.Starting;
	get phase(): LifecyclePhase { return this._phase; }

	private readonly phaseWhen = new Map<LifecyclePhase, Barrier>();

	constructor(
		@ILogService protected readonly logService: ILogService
	) {
		super();
	}

	set phase(value: LifecyclePhase) {
		if (value < this.phase) {
			throw new Error('Lifecycle cannot go backwards');
		}

		if (this._phase === value) {
			return;
		}

		this.logService.trace(`lifecycle: phase changed (value: ${value})`);

		this._phase = value;
		mark(`code/LifecyclePhase/${LifecyclePhaseToString(value)}`);

		const barrier = this.phaseWhen.get(this._phase);
		if (barrier) {
			barrier.open();
			this.phaseWhen.delete(this._phase);
		}
	}

	async when(phase: LifecyclePhase): Promise<void> {
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

	/**
	 * Subclasses to implement the explicit shutdown method.
	 */
	abstract shutdown(): void;
}
