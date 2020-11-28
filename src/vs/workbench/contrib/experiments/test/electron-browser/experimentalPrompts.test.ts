/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter } from 'vs/base/common/event';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { INotificationService, IPromptChoice, IPromptOptions, Severity } from 'vs/platform/notification/common/notification';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { ExperimentalPrompts } from 'vs/workbench/contrib/experiments/browser/experimentalPrompt';
import { ExperimentActionType, ExperimentState, IExperiment, IExperimentActionPromptProperties, IExperimentService, LocalizedPromptText } from 'vs/workbench/contrib/experiments/common/experimentService';
import { TestExperimentService } from 'vs/workbench/contrib/experiments/test/electron-browser/experimentService.test';
import { TestLifecycleService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestCommandService } from 'vs/editor/test/browser/editorTestServices';
import { ICommandService } from 'vs/platform/commands/common/commands';

suite('Experimental Prompts', () => {
	let instantiationService: TestInstantiationService;
	let experimentService: TestExperimentService;
	let experimentalPrompt: ExperimentalPrompts;
	let commandService: TestCommandService;
	let onExperimentEnabledEvent: Emitter<IExperiment>;

	let storageData: { [key: string]: any; } = {};
	const promptText = 'Hello there! Can you see this?';
	const experiment: IExperiment =
	{
		id: 'experiment1',
		enabled: true,
		raw: undefined,
		state: ExperimentState.Run,
		action: {
			type: ExperimentActionType.Prompt,
			properties: {
				promptText,
				commands: [
					{
						text: 'Yes',
					},
					{
						text: 'No'
					}
				]
			}
		}
	};

	suiteSetup(() => {
		instantiationService = new TestInstantiationService();

		instantiationService.stub(ILifecycleService, new TestLifecycleService());
		instantiationService.stub(ITelemetryService, NullTelemetryService);

		onExperimentEnabledEvent = new Emitter<IExperiment>();

	});

	setup(() => {
		storageData = {};
		instantiationService.stub(IStorageService, <Partial<IStorageService>>{
			get: (a: string, b: StorageScope, c?: string) => a === 'experiments.experiment1' ? JSON.stringify(storageData) : c,
			store: (a, b, c, d) => {
				if (a === 'experiments.experiment1') {
					storageData = JSON.parse(b + '');
				}
			}
		});
		instantiationService.stub(INotificationService, new TestNotificationService());
		experimentService = instantiationService.createInstance(TestExperimentService);
		experimentService.onExperimentEnabled = onExperimentEnabledEvent.event;
		instantiationService.stub(IExperimentService, experimentService);
		commandService = instantiationService.createInstance(TestCommandService);
		instantiationService.stub(ICommandService, commandService);
	});

	teardown(() => {
		if (experimentService) {
			experimentService.dispose();
		}
		if (experimentalPrompt) {
			experimentalPrompt.dispose();
		}
	});

	test('Show experimental prompt if experiment should be run. Choosing negative option should mark experiment as complete', () => {

		storageData = {
			enabled: true,
			state: ExperimentState.Run
		};

		instantiationService.stub(INotificationService, {
			prompt: (a: Severity, b: string, c: IPromptChoice[]) => {
				assert.equal(b, promptText);
				assert.equal(c.length, 2);
				c[1].run();
				return undefined!;
			}
		});

		experimentalPrompt = instantiationService.createInstance(ExperimentalPrompts);
		onExperimentEnabledEvent.fire(experiment);

		return Promise.resolve(null).then(result => {
			assert.equal(storageData['state'], ExperimentState.Complete);
		});

	});

	test('runs experiment command', () => {

		storageData = {
			enabled: true,
			state: ExperimentState.Run
		};

		const stub = instantiationService.stub(ICommandService, 'executeCommand', () => undefined);
		instantiationService.stub(INotificationService, {
			prompt: (a: Severity, b: string, c: IPromptChoice[], options: IPromptOptions) => {
				c[0].run();
				return undefined!;
			}
		});

		experimentalPrompt = instantiationService.createInstance(ExperimentalPrompts);
		onExperimentEnabledEvent.fire({
			...experiment,
			action: {
				type: ExperimentActionType.Prompt,
				properties: {
					promptText,
					commands: [
						{
							text: 'Yes',
							codeCommand: { id: 'greet', arguments: ['world'] }
						}
					]
				}
			}
		});

		return Promise.resolve(null).then(result => {
			assert.deepStrictEqual(stub.args[0], ['greet', 'world']);
			assert.equal(storageData['state'], ExperimentState.Complete);
		});

	});

	test('Show experimental prompt if experiment should be run. Cancelling should mark experiment as complete', () => {

		storageData = {
			enabled: true,
			state: ExperimentState.Run
		};

		instantiationService.stub(INotificationService, {
			prompt: (a: Severity, b: string, c: IPromptChoice[], options: IPromptOptions) => {
				assert.equal(b, promptText);
				assert.equal(c.length, 2);
				options.onCancel!();
				return undefined!;
			}
		});

		experimentalPrompt = instantiationService.createInstance(ExperimentalPrompts);
		onExperimentEnabledEvent.fire(experiment);

		return Promise.resolve(null).then(result => {
			assert.equal(storageData['state'], ExperimentState.Complete);
		});

	});

	test('Test getPromptText', () => {
		const simpleTextCase: IExperimentActionPromptProperties = {
			promptText: 'My simple prompt',
			commands: []
		};
		const multipleLocaleCase: IExperimentActionPromptProperties = {
			promptText: {
				en: 'My simple prompt for en',
				de: 'My simple prompt for de',
				'en-au': 'My simple prompt for Austrailian English',
				'en-us': 'My simple prompt for US English'
			},
			commands: []
		};
		const englishUSTextCase: IExperimentActionPromptProperties = {
			promptText: {
				'en-us': 'My simple prompt for en'
			},
			commands: []
		};
		const noEnglishTextCase: IExperimentActionPromptProperties = {
			promptText: {
				'de-de': 'My simple prompt for German'
			},
			commands: []
		};

		assert.equal(ExperimentalPrompts.getLocalizedText(simpleTextCase.promptText, 'any-language'), simpleTextCase.promptText);
		const multipleLocalePromptText = multipleLocaleCase.promptText as LocalizedPromptText;
		assert.equal(ExperimentalPrompts.getLocalizedText(multipleLocaleCase.promptText, 'en'), multipleLocalePromptText['en']);
		assert.equal(ExperimentalPrompts.getLocalizedText(multipleLocaleCase.promptText, 'de'), multipleLocalePromptText['de']);
		assert.equal(ExperimentalPrompts.getLocalizedText(multipleLocaleCase.promptText, 'en-au'), multipleLocalePromptText['en-au']);
		assert.equal(ExperimentalPrompts.getLocalizedText(multipleLocaleCase.promptText, 'en-gb'), multipleLocalePromptText['en']);
		assert.equal(ExperimentalPrompts.getLocalizedText(multipleLocaleCase.promptText, 'fr'), multipleLocalePromptText['en']);
		assert.equal(ExperimentalPrompts.getLocalizedText(englishUSTextCase.promptText, 'fr'), (englishUSTextCase.promptText as LocalizedPromptText)['en-us']);
		assert.equal(!!ExperimentalPrompts.getLocalizedText(noEnglishTextCase.promptText, 'fr'), false);
	});
});
