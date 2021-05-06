/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ProgressLocation, UnmanagedProgress } from 'vs/platform/progress/common/progress';
import { TestResultState } from 'vs/workbench/api/common/extHostTypes';
import { TestStateCount } from 'vs/workbench/contrib/testing/common/testResult';
import { ITestResultService } from 'vs/workbench/contrib/testing/common/testResultService';

export interface ITestingProgressUiService {
	readonly _serviceBrand: undefined;
	readonly onCountChange: Event<CountSummary>;
	readonly onTextChange: Event<string>;
}

export const ITestingProgressUiService = createDecorator<ITestingProgressUiService>('testingProgressUiService');

export class TestingProgressUiService extends Disposable implements ITestingProgressUiService {
	declare _serviceBrand: undefined;

	private readonly current = this._register(new MutableDisposable<UnmanagedProgress>());
	private readonly updateCountsEmitter = new Emitter<CountSummary>();
	private readonly updateTextEmitter = new Emitter<string>();

	public readonly onCountChange = this.updateCountsEmitter.event;
	public readonly onTextChange = this.updateTextEmitter.event;

	constructor(
		@ITestResultService private readonly resultService: ITestResultService,
		@IInstantiationService private readonly instantiaionService: IInstantiationService,
	) {
		super();

		const scheduler = this._register(new RunOnceScheduler(() => this.updateProgress(), 200));

		this._register(resultService.onResultsChanged(() => {
			if (!scheduler.isScheduled()) {
				scheduler.schedule();
			}
		}));

		this._register(resultService.onTestChanged(() => {
			if (!scheduler.isScheduled()) {
				scheduler.schedule();
			}
		}));
	}

	private updateProgress() {
		const allResults = this.resultService.results;
		const running = allResults.filter(r => r.completedAt === undefined);
		if (!running.length) {
			if (allResults.length) {
				const collected = collectTestStateCounts(false, allResults[0].counts);
				this.updateCountsEmitter.fire(collected);
				this.updateTextEmitter.fire(getTestProgressText(false, collected));
			}

			this.current.clear();
			return;
		}

		if (!this.current.value) {
			this.current.value = this.instantiaionService.createInstance(UnmanagedProgress, { location: ProgressLocation.Window });
		}

		const collected = collectTestStateCounts(true, ...running.map(r => r.counts));
		this.updateCountsEmitter.fire(collected);

		const message = getTestProgressText(true, collected);
		this.updateTextEmitter.fire(message);
		this.current.value.report({ message });
	}
}

type CountSummary = ReturnType<typeof collectTestStateCounts>;


const collectTestStateCounts = (isRunning: boolean, ...counts: ReadonlyArray<TestStateCount>) => {
	let passed = 0;
	let failed = 0;
	let skipped = 0;
	let running = 0;
	let queued = 0;

	for (const count of counts) {
		failed += count[TestResultState.Errored] + count[TestResultState.Failed];
		passed += count[TestResultState.Passed];
		skipped += count[TestResultState.Skipped];
		running += count[TestResultState.Running];
		queued += count[TestResultState.Queued];
	}

	return {
		isRunning,
		passed,
		failed,
		runSoFar: passed + failed,
		totalWillBeRun: passed + failed + queued + running,
		skipped,
	};
};

const getTestProgressText = (running: boolean, { passed, runSoFar, skipped, failed }: CountSummary) => {
	let percent = passed / runSoFar * 100;
	if (failed > 0) {
		// fix: prevent from rounding to 100 if there's any failed test
		percent = Math.min(percent, 99.9);
	} else if (runSoFar === 0) {
		percent = 0;
	}

	if (running) {
		if (runSoFar === 0) {
			return localize('testProgress.runningInitial', 'Running tests...', passed, runSoFar, percent.toPrecision(3));
		} else if (skipped === 0) {
			return localize('testProgress.running', 'Running tests, {0}/{1} passed ({2}%)', passed, runSoFar, percent.toPrecision(3));
		} else {
			return localize('testProgressWithSkip.running', 'Running tests, {0}/{1} tests passed ({2}%, {3} skipped)', passed, runSoFar, percent.toPrecision(3), skipped);
		}
	} else {
		if (skipped === 0) {
			return localize('testProgress.completed', '{0}/{1} tests passed ({2}%)', passed, runSoFar, percent.toPrecision(3));
		} else {
			return localize('testProgressWithSkip.completed', '{0}/{1} tests passed ({2}%, {3} skipped)', passed, runSoFar, percent.toPrecision(3), skipped);
		}
	}
};
