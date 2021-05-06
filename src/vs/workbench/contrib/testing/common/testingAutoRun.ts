/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { AutoRunMode, getTestingConfiguration, TestingConfigKeys } from 'vs/workbench/contrib/testing/common/configuration';
import { TestDiffOpType, TestIdWithMaybeSrc } from 'vs/workbench/contrib/testing/common/testCollection';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';
import { TestResultItemChangeReason } from 'vs/workbench/contrib/testing/common/testResult';
import { ITestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { ITestService } from 'vs/workbench/contrib/testing/common/testService';
import { IWorkspaceTestCollectionService } from 'vs/workbench/contrib/testing/common/workspaceTestCollectionService';

export interface ITestingAutoRun {
	/**
	 * Toggles autorun on or off.
	 */
	toggle(): void;
}

export const ITestingAutoRun = createDecorator<ITestingAutoRun>('testingAutoRun');

export class TestingAutoRun extends Disposable implements ITestingAutoRun {
	private enabled: IContextKey<boolean>;
	private runner = this._register(new MutableDisposable());

	constructor(
		@IContextKeyService contextKeyService: IContextKeyService,
		@ITestService private readonly testService: ITestService,
		@ITestResultService private readonly results: ITestResultService,
		@IConfigurationService private readonly configuration: IConfigurationService,
		@IWorkspaceTestCollectionService private readonly workspaceTests: IWorkspaceTestCollectionService,
	) {
		super();
		this.enabled = TestingContextKeys.autoRun.bindTo(contextKeyService);

		this._register(configuration.onDidChangeConfiguration(evt => {
			if (evt.affectsConfiguration(TestingConfigKeys.AutoRunMode) && this.enabled.get()) {
				this.runner.value = this.makeRunner();
			}
		}));
	}

	/**
	 * @inheritdoc
	 */
	public toggle(): void {
		const enabled = this.enabled.get();
		if (enabled) {
			this.runner.value = undefined;
		} else {
			this.runner.value = this.makeRunner();
		}

		this.enabled.set(!enabled);
	}

	/**
	 * Creates the runner. Is triggered when tests are marked as retired.
	 * Runs them on a debounce.
	 */
	private makeRunner() {
		let isRunning = false;
		const rerunIds = new Map<string, TestIdWithMaybeSrc>();
		const store = new DisposableStore();
		const cts = new CancellationTokenSource();
		store.add(toDisposable(() => cts.dispose(true)));

		let delay = getTestingConfiguration(this.configuration, TestingConfigKeys.AutoRunDelay);

		store.add(this.configuration.onDidChangeConfiguration(() => {
			delay = getTestingConfiguration(this.configuration, TestingConfigKeys.AutoRunDelay);
		}));

		const scheduler = store.add(new RunOnceScheduler(async () => {
			const tests = [...rerunIds.values()];

			isRunning = true;
			rerunIds.clear();
			await this.testService.runTests({ debug: false, tests, isAutoRun: true });
			isRunning = false;

			if (rerunIds.size > 0) {
				scheduler.schedule(delay);
			}
		}, delay));

		const addToRerun = (test: TestIdWithMaybeSrc) => {
			rerunIds.set(`${test.testId}/${test.src?.controller}`, test);
			if (!isRunning) {
				scheduler.schedule(delay);
			}
		};

		store.add(this.results.onTestChanged(evt => {
			if (evt.reason === TestResultItemChangeReason.Retired) {
				addToRerun({ testId: evt.item.item.extId });
			}
		}));

		if (getTestingConfiguration(this.configuration, TestingConfigKeys.AutoRunMode) === AutoRunMode.AllInWorkspace) {
			const sub = this.workspaceTests.subscribeToWorkspaceTests();
			store.add(sub);

			sub.waitForAllRoots(cts.token).then(() => {
				if (!cts.token.isCancellationRequested) {
					for (const [, collection] of sub.workspaceFolderCollections) {
						for (const rootId of collection.rootIds) {
							const root = collection.getNodeById(rootId);
							if (root) { addToRerun({ testId: root.item.extId, src: root.src }); }
						}
					}
				}
			});

			store.add(sub.onDiff(([, diff]) => {
				for (const entry of diff) {
					if (entry[0] === TestDiffOpType.Add) {
						addToRerun({ testId: entry[1].item.extId, src: entry[1].src });
					}
				}
			}));
		}

		return store;
	}
}
