/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancelablePromise, RunOnceScheduler, createCancelablePromise } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { onUnexpectedError } from 'vs/base/common/errors';

export interface IHoverComputer<Result> {

	/**
	 * This is called after half the hover time
	 */
	computeAsync?: (token: CancellationToken) => Promise<Result>;

	/**
	 * This is called after all the hover time
	 */
	computeSync?: () => Result;

	/**
	 * This is called whenever one of the compute* methods returns a truey value
	 */
	onResult: (result: Result, isFromSynchronousComputation: boolean) => void;

	/**
	 * This is what will be sent as progress/complete to the computation promise
	 */
	getResult: () => Result;

	getResultWithLoadingMessage: () => Result;

}

const enum ComputeHoverOperationState {
	IDLE = 0,
	FIRST_WAIT = 1,
	SECOND_WAIT = 2,
	WAITING_FOR_ASYNC_COMPUTATION = 3
}

export const enum HoverStartMode {
	Delayed = 0,
	Immediate = 1
}

export class HoverOperation<Result> {

	private readonly _computer: IHoverComputer<Result>;
	private _state: ComputeHoverOperationState;
	private _hoverTime: number;

	private readonly _firstWaitScheduler: RunOnceScheduler;
	private readonly _secondWaitScheduler: RunOnceScheduler;
	private readonly _loadingMessageScheduler: RunOnceScheduler;
	private _asyncComputationPromise: CancelablePromise<Result> | null;
	private _asyncComputationPromiseDone: boolean;

	private readonly _completeCallback: (r: Result) => void;
	private readonly _errorCallback: ((err: any) => void) | null | undefined;
	private readonly _progressCallback: (progress: any) => void;

	constructor(computer: IHoverComputer<Result>, success: (r: Result) => void, error: ((err: any) => void) | null | undefined, progress: (progress: any) => void, hoverTime: number) {
		this._computer = computer;
		this._state = ComputeHoverOperationState.IDLE;
		this._hoverTime = hoverTime;

		this._firstWaitScheduler = new RunOnceScheduler(() => this._triggerAsyncComputation(), 0);
		this._secondWaitScheduler = new RunOnceScheduler(() => this._triggerSyncComputation(), 0);
		this._loadingMessageScheduler = new RunOnceScheduler(() => this._showLoadingMessage(), 0);

		this._asyncComputationPromise = null;
		this._asyncComputationPromiseDone = false;

		this._completeCallback = success;
		this._errorCallback = error;
		this._progressCallback = progress;
	}

	public setHoverTime(hoverTime: number): void {
		this._hoverTime = hoverTime;
	}

	private _firstWaitTime(): number {
		return this._hoverTime / 2;
	}

	private _secondWaitTime(): number {
		return this._hoverTime / 2;
	}

	private _loadingMessageTime(): number {
		return 3 * this._hoverTime;
	}

	private _triggerAsyncComputation(): void {
		this._state = ComputeHoverOperationState.SECOND_WAIT;
		this._secondWaitScheduler.schedule(this._secondWaitTime());

		if (this._computer.computeAsync) {
			this._asyncComputationPromiseDone = false;
			this._asyncComputationPromise = createCancelablePromise(token => this._computer.computeAsync!(token));
			this._asyncComputationPromise.then((asyncResult: Result) => {
				this._asyncComputationPromiseDone = true;
				this._withAsyncResult(asyncResult);
			}, (e) => this._onError(e));

		} else {
			this._asyncComputationPromiseDone = true;
		}
	}

	private _triggerSyncComputation(): void {
		if (this._computer.computeSync) {
			this._computer.onResult(this._computer.computeSync(), true);
		}

		if (this._asyncComputationPromiseDone) {
			this._state = ComputeHoverOperationState.IDLE;
			this._onComplete(this._computer.getResult());
		} else {
			this._state = ComputeHoverOperationState.WAITING_FOR_ASYNC_COMPUTATION;
			this._onProgress(this._computer.getResult());
		}
	}

	private _showLoadingMessage(): void {
		if (this._state === ComputeHoverOperationState.WAITING_FOR_ASYNC_COMPUTATION) {
			this._onProgress(this._computer.getResultWithLoadingMessage());
		}
	}

	private _withAsyncResult(asyncResult: Result): void {
		if (asyncResult) {
			this._computer.onResult(asyncResult, false);
		}

		if (this._state === ComputeHoverOperationState.WAITING_FOR_ASYNC_COMPUTATION) {
			this._state = ComputeHoverOperationState.IDLE;
			this._onComplete(this._computer.getResult());
		}
	}

	private _onComplete(value: Result): void {
		this._completeCallback(value);
	}

	private _onError(error: any): void {
		if (this._errorCallback) {
			this._errorCallback(error);
		} else {
			onUnexpectedError(error);
		}
	}

	private _onProgress(value: Result): void {
		this._progressCallback(value);
	}

	public start(mode: HoverStartMode): void {
		if (mode === HoverStartMode.Delayed) {
			if (this._state === ComputeHoverOperationState.IDLE) {
				this._state = ComputeHoverOperationState.FIRST_WAIT;
				this._firstWaitScheduler.schedule(this._firstWaitTime());
				this._loadingMessageScheduler.schedule(this._loadingMessageTime());
			}
		} else {
			switch (this._state) {
				case ComputeHoverOperationState.IDLE:
					this._triggerAsyncComputation();
					this._secondWaitScheduler.cancel();
					this._triggerSyncComputation();
					break;
				case ComputeHoverOperationState.SECOND_WAIT:
					this._secondWaitScheduler.cancel();
					this._triggerSyncComputation();
					break;
			}
		}
	}

	public cancel(): void {
		this._loadingMessageScheduler.cancel();
		if (this._state === ComputeHoverOperationState.FIRST_WAIT) {
			this._firstWaitScheduler.cancel();
		}
		if (this._state === ComputeHoverOperationState.SECOND_WAIT) {
			this._secondWaitScheduler.cancel();
			if (this._asyncComputationPromise) {
				this._asyncComputationPromise.cancel();
				this._asyncComputationPromise = null;
			}
		}
		if (this._state === ComputeHoverOperationState.WAITING_FOR_ASYNC_COMPUTATION) {
			if (this._asyncComputationPromise) {
				this._asyncComputationPromise.cancel();
				this._asyncComputationPromise = null;
			}
		}
		this._state = ComputeHoverOperationState.IDLE;
	}

}
