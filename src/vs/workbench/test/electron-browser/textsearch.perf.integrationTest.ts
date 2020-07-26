/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/workbench/contrib/search/browser/search.contribution'; // load contributions
import * as assert from 'assert';
import * as fs from 'fs';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { createSyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ISearchService } from 'vs/workbench/services/search/common/search';
import { ITelemetryService, ITelemetryInfo } from 'vs/platform/telemetry/common/telemetry';
import { IUntitledTextEditorService, UntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import * as minimist from 'minimist';
import * as path from 'vs/base/common/path';
import { LocalSearchService } from 'vs/workbench/services/search/node/searchService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { TestEditorService, TestEditorGroupsService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestEnvironmentService } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { URI } from 'vs/base/common/uri';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { IModelService } from 'vs/editor/common/services/modelService';

import { SearchModel } from 'vs/workbench/contrib/search/common/searchModel';
import { QueryBuilder, ITextQueryBuilderOptions } from 'vs/workbench/contrib/search/common/queryBuilder';

import { Event, Emitter } from 'vs/base/common/event';
import { testWorkspace } from 'vs/platform/workspace/test/common/testWorkspace';
import { NullLogService, ILogService } from 'vs/platform/log/common/log';
import { ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { ClassifiedEvent, StrictPropertyCheck, GDPRClassification } from 'vs/platform/telemetry/common/gdprTypings';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { TestDialogService } from 'vs/platform/dialogs/test/common/testDialogService';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { TestTextResourcePropertiesService, TestContextService } from 'vs/workbench/test/common/workbenchTestServices';

// declare var __dirname: string;

// Checkout sources to run against:
// git clone --separate-git-dir=testGit --no-checkout --single-branch https://chromium.googlesource.com/chromium/src testWorkspace
// cd testWorkspace; git checkout 39a7f93d67f7
// Run from repository root folder with (test.bat on Windows): ./scripts/test-int-mocha.sh --grep TextSearch.performance --timeout 500000 --testWorkspace <path>
suite.skip('TextSearch performance (integration)', () => {

	test('Measure', () => {
		if (process.env['VSCODE_PID']) {
			return undefined; // TODO@Rob find out why test fails when run from within VS Code
		}

		const n = 3;
		const argv = minimist(process.argv);
		const testWorkspaceArg = argv['testWorkspace'];
		const testWorkspacePath = testWorkspaceArg ? path.resolve(testWorkspaceArg) : __dirname;
		if (!fs.existsSync(testWorkspacePath)) {
			throw new Error(`--testWorkspace doesn't exist`);
		}

		const telemetryService = new TestTelemetryService();
		const configurationService = new TestConfigurationService();
		const textResourcePropertiesService = new TestTextResourcePropertiesService(configurationService);
		const logService = new NullLogService();
		const dialogService = new TestDialogService();
		const notificationService = new TestNotificationService();
		const undoRedoService = new UndoRedoService(dialogService, notificationService);
		const instantiationService = new InstantiationService(new ServiceCollection(
			[ITelemetryService, telemetryService],
			[IConfigurationService, configurationService],
			[ITextResourcePropertiesService, textResourcePropertiesService],
			[IDialogService, dialogService],
			[INotificationService, notificationService],
			[IUndoRedoService, undoRedoService],
			[IModelService, new ModelServiceImpl(configurationService, textResourcePropertiesService, new TestThemeService(), logService, undoRedoService)],
			[IWorkspaceContextService, new TestContextService(testWorkspace(URI.file(testWorkspacePath)))],
			[IEditorService, new TestEditorService()],
			[IEditorGroupsService, new TestEditorGroupsService()],
			[IEnvironmentService, TestEnvironmentService],
			[IUntitledTextEditorService, createSyncDescriptor(UntitledTextEditorService)],
			[ISearchService, createSyncDescriptor(LocalSearchService)],
			[ILogService, logService]
		));

		const queryOptions: ITextQueryBuilderOptions = {
			maxResults: 2048
		};

		const searchModel: SearchModel = instantiationService.createInstance(SearchModel);
		function runSearch(): Promise<any> {
			const queryBuilder: QueryBuilder = instantiationService.createInstance(QueryBuilder);
			const query = queryBuilder.text({ pattern: 'static_library(' }, [URI.file(testWorkspacePath)], queryOptions);

			// Wait for the 'searchResultsFinished' event, which is fired after the search() promise is resolved
			const onSearchResultsFinished = Event.filter(telemetryService.eventLogged, e => e.name === 'searchResultsFinished');
			Event.once(onSearchResultsFinished)(onComplete);

			function onComplete(): void {
				try {
					const allEvents = telemetryService.events.map(e => JSON.stringify(e)).join('\n');
					assert.equal(telemetryService.events.length, 3, 'Expected 3 telemetry events, got:\n' + allEvents);

					const [firstRenderEvent, resultsShownEvent, resultsFinishedEvent] = telemetryService.events;
					assert.equal(firstRenderEvent.name, 'searchResultsFirstRender');
					assert.equal(resultsShownEvent.name, 'searchResultsShown');
					assert.equal(resultsFinishedEvent.name, 'searchResultsFinished');

					telemetryService.events = [];

					resolve!(resultsFinishedEvent);
				} catch (e) {
					// Fail the runSearch() promise
					error!(e);
				}
			}

			let resolve: (result: any) => void;
			let error: (error: Error) => void;
			return new Promise((_resolve, _error) => {
				resolve = _resolve;
				error = _error;

				// Don't wait on this promise, we're waiting on the event fired above
				searchModel.search(query).then(
					null,
					_error);
			});
		}

		const finishedEvents: any[] = [];
		return runSearch() // Warm-up first
			.then(() => {
				if (testWorkspaceArg) { // Don't measure by default
					let i = n;
					return (function iterate(): Promise<undefined> | undefined {
						if (!i--) {
							return;
						}

						return runSearch()
							.then((resultsFinishedEvent: any) => {
								console.log(`Iteration ${n - i}: ${resultsFinishedEvent.data.duration / 1000}s`);
								finishedEvents.push(resultsFinishedEvent);
								return iterate();
							});
					})()!.then(() => {
						const totalTime = finishedEvents.reduce((sum, e) => sum + e.data.duration, 0);
						console.log(`Avg duration: ${totalTime / n / 1000}s`);
					});
				}
				return undefined;
			});
	});
});

class TestTelemetryService implements ITelemetryService {
	public _serviceBrand: undefined;
	public isOptedIn = true;
	public sendErrorTelemetry = true;

	public events: any[] = [];

	private readonly emitter = new Emitter<any>();

	public get eventLogged(): Event<any> {
		return this.emitter.event;
	}

	public setEnabled(value: boolean): void {
	}

	public setExperimentProperty(name: string, value: string): void {
	}

	public publicLog(eventName: string, data?: any): Promise<void> {
		const event = { name: eventName, data: data };
		this.events.push(event);
		this.emitter.fire(event);
		return Promise.resolve();
	}

	public publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>) {
		return this.publicLog(eventName, data as any);
	}

	public publicLogError(eventName: string, data?: any): Promise<void> {
		return this.publicLog(eventName, data);
	}

	public publicLogError2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>) {
		return this.publicLogError(eventName, data as any);
	}

	public getTelemetryInfo(): Promise<ITelemetryInfo> {
		return Promise.resolve({
			instanceId: 'someValue.instanceId',
			sessionId: 'someValue.sessionId',
			machineId: 'someValue.machineId'
		});
	}
}
