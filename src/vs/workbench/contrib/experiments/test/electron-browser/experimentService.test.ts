/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as sinon from 'sinon';
import { ExperimentActionType, ExperimentState, IExperiment, ExperimentService, getCurrentActivationRecord, currentSchemaVersion } from 'vs/workbench/contrib/experiments/common/experimentService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { TestLifecycleService } from 'vs/workbench/test/browser/workbenchTestServices';
import {
	IExtensionManagementService, DidInstallExtensionEvent, DidUninstallExtensionEvent, InstallExtensionEvent, IExtensionIdentifier, ILocalExtension
} from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ExtensionManagementService } from 'vs/platform/extensionManagement/node/extensionManagementService';
import { Emitter } from 'vs/base/common/event';
import { TestExtensionEnablementService } from 'vs/workbench/services/extensionManagement/test/browser/extensionEnablementService.test';
import { NativeURLService } from 'vs/platform/url/common/urlService';
import { IURLService } from 'vs/platform/url/common/url';
import { ITelemetryService, lastSessionDateStorageKey } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ExtensionType } from 'vs/platform/extensions/common/extensions';
import { IProductService } from 'vs/platform/product/common/productService';
import { IWillActivateEvent, IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { timeout } from 'vs/base/common/async';
import { TestExtensionService } from 'vs/workbench/test/common/workbenchTestServices';
import { OS } from 'vs/base/common/platform';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { TestWorkspaceTrustManagementService } from 'vs/workbench/services/workspaces/test/common/testWorkspaceTrustService';

interface ExperimentSettings {
	enabled?: boolean;
	id?: string;
	state?: ExperimentState;
}

let experimentData: { [i: string]: any; } = {
	experiments: []
};

const local = aLocalExtension('installedExtension1', { version: '1.0.0' });

function aLocalExtension(name: string = 'someext', manifest: any = {}, properties: any = {}): ILocalExtension {
	manifest = Object.assign({ name, publisher: 'pub', version: '1.0.0' }, manifest);
	properties = Object.assign({
		type: ExtensionType.User,
		location: URI.file(`pub.${name}`),
		identifier: { id: getGalleryExtensionId(manifest.publisher, manifest.name), uuid: undefined },
		metadata: { id: getGalleryExtensionId(manifest.publisher, manifest.name), publisherId: manifest.publisher, publisherDisplayName: 'somename' }
	}, properties);
	return <ILocalExtension>Object.create({ manifest, ...properties });
}

export class TestExperimentService extends ExperimentService {
	public override getExperiments(): Promise<any[]> {
		return Promise.resolve(experimentData.experiments);
	}
}

suite('Experiment Service', () => {
	let instantiationService: TestInstantiationService;
	let testConfigurationService: TestConfigurationService;
	let testObject: ExperimentService;
	let activationEvent: Emitter<IWillActivateEvent>;
	let installEvent: Emitter<InstallExtensionEvent>,
		didInstallEvent: Emitter<DidInstallExtensionEvent>,
		uninstallEvent: Emitter<IExtensionIdentifier>,
		didUninstallEvent: Emitter<DidUninstallExtensionEvent>;

	suiteSetup(() => {
		instantiationService = new TestInstantiationService();
		installEvent = new Emitter<InstallExtensionEvent>();
		didInstallEvent = new Emitter<DidInstallExtensionEvent>();
		uninstallEvent = new Emitter<IExtensionIdentifier>();
		didUninstallEvent = new Emitter<DidUninstallExtensionEvent>();
		activationEvent = new Emitter<IWillActivateEvent>();

		instantiationService.stub(IExtensionService, TestExtensionService);
		instantiationService.stub(IExtensionService, 'onWillActivateByEvent', activationEvent.event);
		instantiationService.stub(IExtensionManagementService, ExtensionManagementService);
		instantiationService.stub(IExtensionManagementService, 'onInstallExtension', installEvent.event);
		instantiationService.stub(IExtensionManagementService, 'onDidInstallExtension', didInstallEvent.event);
		instantiationService.stub(IExtensionManagementService, 'onUninstallExtension', uninstallEvent.event);
		instantiationService.stub(IExtensionManagementService, 'onDidUninstallExtension', didUninstallEvent.event);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		instantiationService.stub(ITelemetryService, NullTelemetryService);
		instantiationService.stub(IURLService, NativeURLService);
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local]);
		testConfigurationService = new TestConfigurationService();
		instantiationService.stub(IConfigurationService, testConfigurationService);
		instantiationService.stub(ILifecycleService, new TestLifecycleService());
		instantiationService.stub(IStorageService, <Partial<IStorageService>>{ get: (a: string, b: StorageScope, c?: string) => c, getBoolean: (a: string, b: StorageScope, c?: boolean) => c, store: () => { }, remove: () => { } });
		instantiationService.stub(IWorkspaceTrustManagementService, new TestWorkspaceTrustManagementService());

		setup(() => {
			instantiationService.stub(IProductService, {});
			instantiationService.stub(IStorageService, <Partial<IStorageService>>{ get: (a: string, b: StorageScope, c?: string) => c, getBoolean: (a: string, b: StorageScope, c?: boolean) => c, store: () => { }, remove: () => { } });
		});

		teardown(() => {
			if (testObject) {
				testObject.dispose();
			}
		});
	});

	test('Simple Experiment Test', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1'
				},
				{
					id: 'experiment2',
					enabled: false
				},
				{
					id: 'experiment3',
					enabled: true
				},
				{
					id: 'experiment4',
					enabled: true,
					condition: {

					}
				},
				{
					id: 'experiment5',
					enabled: true,
					condition: {
						insidersOnly: true
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		const tests: Promise<IExperiment>[] = [];
		tests.push(testObject.getExperimentById('experiment1'));
		tests.push(testObject.getExperimentById('experiment2'));
		tests.push(testObject.getExperimentById('experiment3'));
		tests.push(testObject.getExperimentById('experiment4'));
		tests.push(testObject.getExperimentById('experiment5'));

		return Promise.all(tests).then(results => {
			assert.strictEqual(results[0].id, 'experiment1');
			assert.strictEqual(results[0].enabled, false);
			assert.strictEqual(results[0].state, ExperimentState.NoRun);

			assert.strictEqual(results[1].id, 'experiment2');
			assert.strictEqual(results[1].enabled, false);
			assert.strictEqual(results[1].state, ExperimentState.NoRun);

			assert.strictEqual(results[2].id, 'experiment3');
			assert.strictEqual(results[2].enabled, true);
			assert.strictEqual(results[2].state, ExperimentState.Run);

			assert.strictEqual(results[3].id, 'experiment4');
			assert.strictEqual(results[3].enabled, true);
			assert.strictEqual(results[3].state, ExperimentState.Run);

			assert.strictEqual(results[4].id, 'experiment5');
			assert.strictEqual(results[4].enabled, true);
			assert.strictEqual(results[4].state, ExperimentState.Run);
		});
	});

	test('filters out experiments with newer schema versions', async () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					// no version == 0
				},
				{
					id: 'experiment2',
					schemaVersion: currentSchemaVersion,
				},
				{
					id: 'experiment3',
					schemaVersion: currentSchemaVersion + 1,
				},
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		const actual = await Promise.all([
			testObject.getExperimentById('experiment1'),
			testObject.getExperimentById('experiment2'),
			testObject.getExperimentById('experiment3'),
		]);

		assert.strictEqual(actual[0]?.id, 'experiment1');
		assert.strictEqual(actual[1]?.id, 'experiment2');
		assert.strictEqual(actual[2], undefined);
	});

	test('Insiders only experiment shouldnt be enabled in stable', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						insidersOnly: true
					}
				}
			]
		};

		instantiationService.stub(IProductService, { quality: 'stable' });
		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.NoRun);
		});
	});

	test('NewUsers experiment shouldnt be enabled for old users', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						newUser: true
					}
				}
			]
		};

		instantiationService.stub(IStorageService, <Partial<IStorageService>>{
			get: (a: string, b: StorageScope, c?: string) => {
				return a === lastSessionDateStorageKey ? 'some-date' : undefined;
			},
			getBoolean: (a: string, b: StorageScope, c?: boolean) => c, store: () => { }, remove: () => { }
		});
		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.NoRun);
		});
	});

	test('OldUsers experiment shouldnt be enabled for new users', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						newUser: false
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.NoRun);
		});
	});

	test('Experiment without NewUser condition should be enabled for old users', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {}
				}
			]
		};

		instantiationService.stub(IStorageService, <Partial<IStorageService>>{
			get: (a: string, b: StorageScope, c: string | undefined) => {
				return a === lastSessionDateStorageKey ? 'some-date' : undefined;
			},
			getBoolean: (a: string, b: StorageScope, c?: boolean) => c, store: () => { }, remove: () => { }
		});
		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Run);
		});
	});

	test('Experiment without NewUser condition should be enabled for new users', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Run);
		});
	});

	test('Experiment with OS should be enabled on current OS', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						os: [OS],
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.state, ExperimentState.Run);
		});
	});

	test('Experiment with OS should be disabled on other OS', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						os: [OS - 1],
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.state, ExperimentState.NoRun);
		});
	});

	test('Activation event experiment with not enough events should be evaluating', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						activationEvent: {
							event: 'my:event',
							minEvents: 5,
						}
					}
				}
			]
		};

		instantiationService.stub(IStorageService, 'get', (a: string, b: StorageScope, c?: string) => {
			return a === 'experimentEventRecord-my-event'
				? JSON.stringify({ count: [2], mostRecentBucket: Date.now() })
				: undefined;
		});

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Evaluating);
		});
	});

	test('Activation event works with enough events', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						activationEvent: {
							event: 'my:event',
							minEvents: 5,
						}
					}
				}
			]
		};

		instantiationService.stub(IStorageService, 'get', (a: string, b: StorageScope, c?: string) => {
			return a === 'experimentEventRecord-my-event'
				? JSON.stringify({ count: [10], mostRecentBucket: Date.now() })
				: undefined;
		});

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Run);
		});
	});

	test('Activation event does not work with old data', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						activationEvent: {
							event: 'my:event',
							minEvents: 5,
						}
					}
				}
			]
		};

		instantiationService.stub(IStorageService, 'get', (a: string, b: StorageScope, c?: string) => {
			return a === 'experimentEventRecord-my-event'
				? JSON.stringify({ count: [10], mostRecentBucket: Date.now() - (1000 * 60 * 60 * 24 * 10) })
				: undefined;
		});

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Evaluating);
		});
	});

	test('Parses activation records correctly', () => {
		const timers = sinon.useFakeTimers(); // so Date.now() is stable
		const oneDay = 1000 * 60 * 60 * 24;
		teardown(() => timers.restore());

		let rec = getCurrentActivationRecord();

		// good default:
		assert.deepStrictEqual(rec, {
			count: [0, 0, 0, 0, 0, 0, 0],
			mostRecentBucket: Date.now(),
		});

		rec.count[0] = 1;
		timers.tick(1);
		rec = getCurrentActivationRecord(rec);

		// does not advance unnecessarily
		assert.deepStrictEqual(getCurrentActivationRecord(rec), {
			count: [1, 0, 0, 0, 0, 0, 0],
			mostRecentBucket: Date.now() - 1,
		});

		// advances time
		timers.tick(oneDay * 3);
		rec = getCurrentActivationRecord(rec);
		assert.deepStrictEqual(getCurrentActivationRecord(rec), {
			count: [0, 0, 0, 1, 0, 0, 0],
			mostRecentBucket: Date.now() - 1,
		});

		// rotates off time
		timers.tick(oneDay * 4);
		rec.count[0] = 2;
		rec = getCurrentActivationRecord(rec);
		assert.deepStrictEqual(getCurrentActivationRecord(rec), {
			count: [0, 0, 0, 0, 2, 0, 0],
			mostRecentBucket: Date.now() - 1,
		});
	});

	test('Activation event updates', async () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						activationEvent: {
							event: 'my:event',
							minEvents: 2,
						}
					}
				}
			]
		};

		instantiationService.stub(IStorageService, 'get', (a: string, b: StorageScope, c?: string) => {
			return a === 'experimentEventRecord-my-event'
				? JSON.stringify({ count: [10, 0, 0, 0, 0, 0, 0], mostRecentBucket: Date.now() - (1000 * 60 * 60 * 24 * 2) })
				: undefined;
		});

		let didGetCall = false;
		instantiationService.stub(IStorageService, 'store', (key: string, value: string, scope: StorageScope) => {
			if (key.includes('experimentEventRecord')) {
				didGetCall = true;
				assert.strictEqual(key, 'experimentEventRecord-my-event');
				assert.deepStrictEqual(JSON.parse(value).count, [1, 0, 10, 0, 0, 0, 0]);
				assert.strictEqual(scope, StorageScope.GLOBAL);
			}
		});

		testObject = instantiationService.createInstance(TestExperimentService);
		await testObject.getExperimentById('experiment1');
		activationEvent.fire({ event: 'not our event', activation: Promise.resolve() });
		activationEvent.fire({ event: 'my:event', activation: Promise.resolve() });
		assert(didGetCall);
	});

	test('Activation events run experiments in realtime', async () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						activationEvent: {
							event: 'my:event',
							minEvents: 2,
						}
					}
				}
			]
		};

		let calls = 0;
		instantiationService.stub(IStorageService, 'get', (a: string, b: StorageScope, c?: string) => {
			return a === 'experimentEventRecord-my-event'
				? JSON.stringify({ count: [++calls, 0, 0, 0, 0, 0, 0], mostRecentBucket: Date.now() })
				: undefined;
		});

		const enabledListener = sinon.stub();
		testObject = instantiationService.createInstance(TestExperimentService);
		testObject.onExperimentEnabled(enabledListener);

		assert.strictEqual((await testObject.getExperimentById('experiment1')).state, ExperimentState.Evaluating);
		assert.strictEqual((await testObject.getExperimentById('experiment1')).state, ExperimentState.Evaluating);
		assert.strictEqual(enabledListener.callCount, 0);

		activationEvent.fire({ event: 'my:event', activation: Promise.resolve() });
		await timeout(1);
		assert.strictEqual(enabledListener.callCount, 1);
		assert.strictEqual((await testObject.getExperimentById('experiment1')).state, ExperimentState.Run);
	});

	test('Experiment not matching user setting should be disabled', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						userSetting: { neat: true }
					}
				}
			]
		};

		instantiationService.stub(IConfigurationService, 'getValue',
			(key: string) => key === 'neat' ? false : undefined);
		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.NoRun);
		});
	});

	test('Experiment matching user setting should be enabled', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						userSetting: { neat: true }
					}
				}
			]
		};

		instantiationService.stub(IConfigurationService, 'getValue',
			(key: string) => key === 'neat' ? true : undefined);
		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Run);
		});
	});

	test('Experiment with no matching display language should be disabled', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						displayLanguage: 'somethingthat-nooneknows'
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.NoRun);
		});
	});

	test('Experiment with condition type InstalledExtensions is enabled when one of the expected extensions is installed', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						installedExtensions: {
							inlcudes: ['pub.installedExtension1', 'uninstalled-extention-id']
						}
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Run);
		});
	});

	test('Experiment with condition type InstalledExtensions is disabled when none of the expected extensions is installed', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						installedExtensions: {
							includes: ['uninstalled-extention-id1', 'uninstalled-extention-id2']
						}
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.NoRun);
		});
	});

	test('Experiment with condition type InstalledExtensions is disabled when one of the exlcuded extensions is installed', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						installedExtensions: {
							excludes: ['pub.installedExtension1', 'uninstalled-extention-id2']
						}
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.NoRun);
		});
	});

	test('Experiment that is marked as complete should be disabled regardless of the conditions', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						installedExtensions: {
							includes: ['pub.installedExtension1', 'uninstalled-extention-id2']
						}
					}
				}
			]
		};

		instantiationService.stub(IStorageService, <Partial<IStorageService>>{
			get: (a: string, b: StorageScope, c?: string) => a === 'experiments.experiment1' ? JSON.stringify({ state: ExperimentState.Complete }) : c,
			store: () => { }
		});

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Complete);
		});
	});

	test('Experiment with evaluate only once should read enablement from storage service', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					condition: {
						installedExtensions: {
							excludes: ['pub.installedExtension1', 'uninstalled-extention-id2']
						},
						evaluateOnlyOnce: true
					}
				}
			]
		};

		instantiationService.stub(IStorageService, <Partial<IStorageService>>{
			get: (a: string, b: StorageScope, c?: string) => a === 'experiments.experiment1' ? JSON.stringify({ enabled: true, state: ExperimentState.Run }) : c,
			store: () => { }
		});
		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Run);
		});
	});

	test('Curated list should be available if experiment is enabled.', () => {
		const promptText = 'Hello there! Can you see this?';
		const curatedExtensionsKey = 'AzureDeploy';
		const curatedExtensionsList = ['uninstalled-extention-id1', 'uninstalled-extention-id2'];
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: true,
					action: {
						type: 'Prompt',
						properties: {
							promptText,
							commands: [
								{
									text: 'Search Marketplace',
									dontShowAgain: true,
									curatedExtensionsKey,
									curatedExtensionsList
								},
								{
									text: 'No'
								}
							]
						}
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, true);
			assert.strictEqual(result.state, ExperimentState.Run);
			return testObject.getCuratedExtensionsList(curatedExtensionsKey).then(curatedList => {
				assert.strictEqual(curatedList, curatedExtensionsList);
			});
		});
	});

	test('Curated list shouldnt be available if experiment is disabled.', () => {
		const promptText = 'Hello there! Can you see this?';
		const curatedExtensionsKey = 'AzureDeploy';
		const curatedExtensionsList = ['uninstalled-extention-id1', 'uninstalled-extention-id2'];
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: false,
					action: {
						type: 'Prompt',
						properties: {
							promptText,
							commands: [
								{
									text: 'Search Marketplace',
									dontShowAgain: true,
									curatedExtensionsKey,
									curatedExtensionsList
								},
								{
									text: 'No'
								}
							]
						}
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, false);
			assert.strictEqual(result.action?.type, 'Prompt');
			assert.strictEqual(result.state, ExperimentState.NoRun);
			return testObject.getCuratedExtensionsList(curatedExtensionsKey).then(curatedList => {
				assert.strictEqual(curatedList.length, 0);
			});
		});
	});

	test('Maps action2 to action.', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: false,
					action2: {
						type: 'Prompt',
						properties: {
							promptText: 'Hello world',
							commands: []
						}
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.action?.type, 'Prompt');
		});
	});

	test('Experiment that is disabled or deleted should be removed from storage', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment1',
					enabled: false
				},
				{
					id: 'experiment3',
					enabled: true
				}
			]
		};

		let storageDataExperiment1: ExperimentSettings | null = { enabled: false };
		let storageDataExperiment2: ExperimentSettings | null = { enabled: false };
		let storageDataAllExperiments: string[] | null = ['experiment1', 'experiment2', 'experiment3'];
		instantiationService.stub(IStorageService, <Partial<IStorageService>>{
			get: (a: string, b: StorageScope, c?: string) => {
				switch (a) {
					case 'experiments.experiment1':
						return JSON.stringify(storageDataExperiment1);
					case 'experiments.experiment2':
						return JSON.stringify(storageDataExperiment2);
					case 'allExperiments':
						return JSON.stringify(storageDataAllExperiments);
					default:
						break;
				}
				return c;
			},
			store: (a: string, b: any, c: StorageScope) => {
				switch (a) {
					case 'experiments.experiment1':
						storageDataExperiment1 = JSON.parse(b);
						break;
					case 'experiments.experiment2':
						storageDataExperiment2 = JSON.parse(b);
						break;
					case 'allExperiments':
						storageDataAllExperiments = JSON.parse(b);
						break;
					default:
						break;
				}
			},
			remove: (a: string) => {
				switch (a) {
					case 'experiments.experiment1':
						storageDataExperiment1 = null;
						break;
					case 'experiments.experiment2':
						storageDataExperiment2 = null;
						break;
					case 'allExperiments':
						storageDataAllExperiments = null;
						break;
					default:
						break;
				}
			}
		});

		testObject = instantiationService.createInstance(TestExperimentService);
		const disabledExperiment = testObject.getExperimentById('experiment1').then(result => {
			assert.strictEqual(result.enabled, false);
			assert.strictEqual(!!storageDataExperiment1, false);
		});
		const deletedExperiment = testObject.getExperimentById('experiment2').then(result => {
			assert.strictEqual(!!result, false);
			assert.strictEqual(!!storageDataExperiment2, false);
		});
		return Promise.all([disabledExperiment, deletedExperiment]).then(() => {
			assert.strictEqual(storageDataAllExperiments!.length, 1);
			assert.strictEqual(storageDataAllExperiments![0], 'experiment3');
		});

	});

	test('Offline mode', () => {
		experimentData = {
			experiments: null
		};

		let storageDataExperiment1: ExperimentSettings | null = { enabled: true, state: ExperimentState.Run };
		let storageDataExperiment2: ExperimentSettings | null = { enabled: true, state: ExperimentState.NoRun };
		let storageDataExperiment3: ExperimentSettings | null = { enabled: true, state: ExperimentState.Evaluating };
		let storageDataExperiment4: ExperimentSettings | null = { enabled: true, state: ExperimentState.Complete };
		let storageDataAllExperiments: string[] | null = ['experiment1', 'experiment2', 'experiment3', 'experiment4'];
		instantiationService.stub(IStorageService, <Partial<IStorageService>>{
			get: (a: string, b: StorageScope, c?: string) => {
				switch (a) {
					case 'experiments.experiment1':
						return JSON.stringify(storageDataExperiment1);
					case 'experiments.experiment2':
						return JSON.stringify(storageDataExperiment2);
					case 'experiments.experiment3':
						return JSON.stringify(storageDataExperiment3);
					case 'experiments.experiment4':
						return JSON.stringify(storageDataExperiment4);
					case 'allExperiments':
						return JSON.stringify(storageDataAllExperiments);
					default:
						break;
				}
				return c;
			},
			store: (a, b, c) => {
				switch (a) {
					case 'experiments.experiment1':
						storageDataExperiment1 = JSON.parse(b + '');
						break;
					case 'experiments.experiment2':
						storageDataExperiment2 = JSON.parse(b + '');
						break;
					case 'experiments.experiment3':
						storageDataExperiment3 = JSON.parse(b + '');
						break;
					case 'experiments.experiment4':
						storageDataExperiment4 = JSON.parse(b + '');
						break;
					case 'allExperiments':
						storageDataAllExperiments = JSON.parse(b + '');
						break;
					default:
						break;
				}
			},
			remove: a => {
				switch (a) {
					case 'experiments.experiment1':
						storageDataExperiment1 = null;
						break;
					case 'experiments.experiment2':
						storageDataExperiment2 = null;
						break;
					case 'experiments.experiment3':
						storageDataExperiment3 = null;
						break;
					case 'experiments.experiment4':
						storageDataExperiment4 = null;
						break;
					case 'allExperiments':
						storageDataAllExperiments = null;
						break;
					default:
						break;
				}
			}
		});

		testObject = instantiationService.createInstance(TestExperimentService);

		const tests: Promise<IExperiment>[] = [];
		tests.push(testObject.getExperimentById('experiment1'));
		tests.push(testObject.getExperimentById('experiment2'));
		tests.push(testObject.getExperimentById('experiment3'));
		tests.push(testObject.getExperimentById('experiment4'));

		return Promise.all(tests).then(results => {
			assert.strictEqual(results[0].id, 'experiment1');
			assert.strictEqual(results[0].enabled, true);
			assert.strictEqual(results[0].state, ExperimentState.Run);

			assert.strictEqual(results[1].id, 'experiment2');
			assert.strictEqual(results[1].enabled, true);
			assert.strictEqual(results[1].state, ExperimentState.NoRun);

			assert.strictEqual(results[2].id, 'experiment3');
			assert.strictEqual(results[2].enabled, true);
			assert.strictEqual(results[2].state, ExperimentState.Evaluating);

			assert.strictEqual(results[3].id, 'experiment4');
			assert.strictEqual(results[3].enabled, true);
			assert.strictEqual(results[3].state, ExperimentState.Complete);
		});

	});

	test('getExperimentByType', () => {
		const customProperties = {
			some: 'random-value'
		};
		experimentData = {
			experiments: [
				{
					id: 'simple-experiment',
					enabled: true
				},
				{
					id: 'custom-experiment',
					enabled: true,
					action: {
						type: 'Custom',
						properties: customProperties
					}
				},
				{
					id: 'custom-experiment-no-properties',
					enabled: true,
					action: {
						type: 'Custom'
					}
				},
				{
					id: 'prompt-with-no-commands',
					enabled: true,
					action: {
						type: 'Prompt',
						properties: {
							promptText: 'someText'
						}
					}
				},
				{
					id: 'prompt-with-commands',
					enabled: true,
					action: {
						type: 'Prompt',
						properties: {
							promptText: 'someText',
							commands: [
								{
									text: 'Hello'
								}
							]
						}
					}
				}
			]
		};

		testObject = instantiationService.createInstance(TestExperimentService);
		const custom = testObject.getExperimentsByType(ExperimentActionType.Custom).then(result => {
			assert.strictEqual(result.length, 3);
			assert.strictEqual(result[0].id, 'simple-experiment');
			assert.strictEqual(result[1].id, 'custom-experiment');
			assert.strictEqual(result[1].action!.properties, customProperties);
			assert.strictEqual(result[2].id, 'custom-experiment-no-properties');
			assert.strictEqual(!!result[2].action!.properties, true);
		});
		const prompt = testObject.getExperimentsByType(ExperimentActionType.Prompt).then(result => {
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].id, 'prompt-with-no-commands');
			assert.strictEqual(result[1].id, 'prompt-with-commands');
		});
		return Promise.all([custom, prompt]);
	});

	test('experimentsPreviouslyRun includes, excludes check', () => {
		experimentData = {
			experiments: [
				{
					id: 'experiment3',
					enabled: true,
					condition: {
						experimentsPreviouslyRun: {
							includes: ['experiment1'],
							excludes: ['experiment2']
						}
					}
				},
				{
					id: 'experiment4',
					enabled: true,
					condition: {
						experimentsPreviouslyRun: {
							includes: ['experiment1'],
							excludes: ['experiment200']
						}
					}
				}
			]
		};

		let storageDataExperiment3 = { enabled: true, state: ExperimentState.Evaluating };
		let storageDataExperiment4 = { enabled: true, state: ExperimentState.Evaluating };
		instantiationService.stub(IStorageService, <Partial<IStorageService>>{
			get: (a: string, b: StorageScope, c?: string) => {
				switch (a) {
					case 'currentOrPreviouslyRunExperiments':
						return JSON.stringify(['experiment1', 'experiment2']);
					default:
						break;
				}
				return c;
			},
			store: (a, b, c) => {
				switch (a) {
					case 'experiments.experiment3':
						storageDataExperiment3 = JSON.parse(b + '');
						break;
					case 'experiments.experiment4':
						storageDataExperiment4 = JSON.parse(b + '');
						break;
					default:
						break;
				}
			}
		});

		testObject = instantiationService.createInstance(TestExperimentService);
		return testObject.getExperimentsByType(ExperimentActionType.Custom).then(result => {
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0].id, 'experiment3');
			assert.strictEqual(result[0].state, ExperimentState.NoRun);
			assert.strictEqual(result[1].id, 'experiment4');
			assert.strictEqual(result[1].state, ExperimentState.Run);
			assert.strictEqual(storageDataExperiment3.state, ExperimentState.NoRun);
			assert.strictEqual(storageDataExperiment4.state, ExperimentState.Run);
			return Promise.resolve(null);
		});
	});
	// test('Experiment with condition type FileEdit should increment editcount as appropriate', () => {

	// });

	// test('Experiment with condition type WorkspaceEdit should increment editcount as appropriate', () => {

	// });



});


