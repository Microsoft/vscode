/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as sinon from 'sinon';
import { IExtensionManagementService, DidUninstallExtensionEvent, ILocalExtension, DidInstallExtensionEvent } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState, IExtensionManagementServerService, IExtensionManagementServer } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ExtensionEnablementService } from 'vs/workbench/services/extensionManagement/browser/extensionEnablementService';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { Emitter } from 'vs/base/common/event';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IStorageService, InMemoryStorageService } from 'vs/platform/storage/common/storage';
import { IExtensionContributions, ExtensionType, IExtension } from 'vs/platform/extensions/common/extensions';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { productService, TestLifecycleService } from 'vs/workbench/test/browser/workbenchTestServices';
import { GlobalExtensionEnablementService } from 'vs/platform/extensionManagement/common/extensionEnablementService';
import { IUserDataSyncAccountService, UserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { IUserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
// import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { mock } from 'vs/base/test/common/mock';
import { IExtensionBisectService } from 'vs/workbench/services/extensionManagement/browser/extensionBisect';

function createStorageService(instantiationService: TestInstantiationService): IStorageService {
	let service = instantiationService.get(IStorageService);
	if (!service) {
		let workspaceContextService = instantiationService.get(IWorkspaceContextService);
		if (!workspaceContextService) {
			workspaceContextService = instantiationService.stub(IWorkspaceContextService, <IWorkspaceContextService>{
				getWorkbenchState: () => WorkbenchState.FOLDER,
			});
		}
		service = instantiationService.stub(IStorageService, new InMemoryStorageService());
	}
	return service;
}

export class TestExtensionEnablementService extends ExtensionEnablementService {
	constructor(instantiationService: TestInstantiationService) {
		const storageService = createStorageService(instantiationService);
		const extensionManagementService = instantiationService.get(IExtensionManagementService) || instantiationService.stub(IExtensionManagementService, { onDidInstallExtension: new Emitter<DidInstallExtensionEvent>().event, onDidUninstallExtension: new Emitter<DidUninstallExtensionEvent>().event } as IExtensionManagementService);
		const extensionManagementServerService = instantiationService.get(IExtensionManagementServerService) || instantiationService.stub(IExtensionManagementServerService, <IExtensionManagementServerService>{ localExtensionManagementServer: { extensionManagementService } });
		super(
			storageService,
			new GlobalExtensionEnablementService(storageService),
			instantiationService.get(IWorkspaceContextService),
			instantiationService.get(IWorkbenchEnvironmentService) || instantiationService.stub(IWorkbenchEnvironmentService, { configuration: Object.create(null) } as IWorkbenchEnvironmentService),
			extensionManagementService,
			instantiationService.get(IConfigurationService),
			extensionManagementServerService,
			productService,
			instantiationService.get(IUserDataAutoSyncEnablementService) || instantiationService.stub(IUserDataAutoSyncEnablementService, <Partial<IUserDataAutoSyncEnablementService>>{ isEnabled() { return false; } }),
			instantiationService.get(IUserDataSyncAccountService) || instantiationService.stub(IUserDataSyncAccountService, UserDataSyncAccountService),
			instantiationService.get(ILifecycleService) || instantiationService.stub(ILifecycleService, new TestLifecycleService()),
			instantiationService.get(INotificationService) || instantiationService.stub(INotificationService, new TestNotificationService()),
			instantiationService.get(IHostService),
			new class extends mock<IExtensionBisectService>() { isDisabledByBisect() { return false; } }
		);
	}

	public reset(): void {
		let extensions = this.globalExtensionEnablementService.getDisabledExtensions();
		for (const e of this._getWorkspaceDisabledExtensions()) {
			if (!extensions.some(r => areSameExtensions(r, e))) {
				extensions.push(e);
			}
		}
		const workspaceEnabledExtensions = this._getWorkspaceEnabledExtensions();
		if (workspaceEnabledExtensions.length) {
			extensions = extensions.filter(r => !workspaceEnabledExtensions.some(e => areSameExtensions(e, r)));
		}
		extensions.forEach(d => this.setEnablement([aLocalExtension(d.id)], EnablementState.EnabledGlobally));
	}
}

suite('ExtensionEnablementService Test', () => {

	let instantiationService: TestInstantiationService;
	let testObject: IWorkbenchExtensionEnablementService;

	const didUninstallEvent = new Emitter<DidUninstallExtensionEvent>();

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
		instantiationService.stub(IExtensionManagementService, { onDidUninstallExtension: didUninstallEvent.event, getInstalled: () => Promise.resolve([] as ILocalExtension[]) } as IExtensionManagementService);
		instantiationService.stub(IExtensionManagementServerService, <IExtensionManagementServerService>{
			localExtensionManagementServer: {
				extensionManagementService: instantiationService.get(IExtensionManagementService)
			}
		});
		testObject = new TestExtensionEnablementService(instantiationService);
	});

	teardown(() => {
		(<ExtensionEnablementService>testObject).dispose();
	});

	test('test disable an extension globally', async () => {
		const extension = aLocalExtension('pub.a');
		await testObject.setEnablement([extension], EnablementState.DisabledGlobally);
		assert.ok(!testObject.isEnabled(extension));
		assert.equal(testObject.getEnablementState(extension), EnablementState.DisabledGlobally);
	});

	test('test disable an extension globally should return truthy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(value => assert.ok(value));
	});

	test('test disable an extension globally triggers the change event', () => {
		const target = sinon.spy();
		testObject.onEnablementChanged(target);
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => {
				assert.ok(target.calledOnce);
				assert.deepEqual((<IExtension>target.args[0][0][0]).identifier, { id: 'pub.a' });
			});
	});

	test('test disable an extension globally again should return a falsy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally))
			.then(value => assert.ok(!value[0]));
	});

	test('test state of globally disabled extension', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.DisabledGlobally));
	});

	test('test state of globally enabled extension', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledGlobally))
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.EnabledGlobally));
	});

	test('test disable an extension for workspace', async () => {
		const extension = aLocalExtension('pub.a');
		await testObject.setEnablement([extension], EnablementState.DisabledWorkspace);
		assert.ok(!testObject.isEnabled(extension));
		assert.equal(testObject.getEnablementState(extension), EnablementState.DisabledWorkspace);
	});

	test('test disable an extension for workspace returns a truthy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(value => assert.ok(value));
	});

	test('test disable an extension for workspace again should return a falsy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace))
			.then(value => assert.ok(!value[0]));
	});

	test('test state of workspace disabled extension', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.DisabledWorkspace));
	});

	test('test state of workspace and globally disabled extension', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace))
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.DisabledWorkspace));
	});

	test('test state of workspace enabled extension', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledWorkspace))
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.EnabledWorkspace));
	});

	test('test state of globally disabled and workspace enabled extension', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace))
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledWorkspace))
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.EnabledWorkspace));
	});

	test('test state of an extension when disabled for workspace from workspace enabled', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledWorkspace))
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace))
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.DisabledWorkspace));
	});

	test('test state of an extension when disabled globally from workspace enabled', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledWorkspace))
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally))
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.DisabledGlobally));
	});

	test('test state of an extension when disabled globally from workspace disabled', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally))
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.DisabledGlobally));
	});

	test('test state of an extension when enabled globally from workspace enabled', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledWorkspace))
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledGlobally))
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.EnabledGlobally));
	});

	test('test state of an extension when enabled globally from workspace disabled', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledGlobally))
			.then(() => assert.equal(testObject.getEnablementState(aLocalExtension('pub.a')), EnablementState.EnabledGlobally));
	});

	test('test disable an extension for workspace and then globally', async () => {
		const extension = aLocalExtension('pub.a');
		await testObject.setEnablement([extension], EnablementState.DisabledWorkspace);
		await testObject.setEnablement([extension], EnablementState.DisabledGlobally);
		assert.ok(!testObject.isEnabled(extension));
		assert.equal(testObject.getEnablementState(extension), EnablementState.DisabledGlobally);
	});

	test('test disable an extension for workspace and then globally return a truthy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally))
			.then(value => assert.ok(value));
	});

	test('test disable an extension for workspace and then globally trigger the change event', () => {
		const target = sinon.spy();
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.onEnablementChanged(target))
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally))
			.then(() => {
				assert.ok(target.calledOnce);
				assert.deepEqual((<IExtension>target.args[0][0][0]).identifier, { id: 'pub.a' });
			});
	});

	test('test disable an extension globally and then for workspace', async () => {
		const extension = aLocalExtension('pub.a');
		await testObject.setEnablement([extension], EnablementState.DisabledGlobally);
		await testObject.setEnablement([extension], EnablementState.DisabledWorkspace);
		assert.ok(!testObject.isEnabled(extension));
		assert.equal(testObject.getEnablementState(extension), EnablementState.DisabledWorkspace);
	});

	test('test disable an extension globally and then for workspace return a truthy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace))
			.then(value => assert.ok(value));
	});

	test('test disable an extension globally and then for workspace triggers the change event', () => {
		const target = sinon.spy();
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => testObject.onEnablementChanged(target))
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace))
			.then(() => {
				assert.ok(target.calledOnce);
				assert.deepEqual((<IExtension>target.args[0][0][0]).identifier, { id: 'pub.a' });
			});
	});

	test('test disable an extension for workspace when there is no workspace throws error', () => {
		instantiationService.stub(IWorkspaceContextService, 'getWorkbenchState', WorkbenchState.EMPTY);
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => assert.fail('should throw an error'), error => assert.ok(error));
	});

	test('test enable an extension globally', async () => {
		const extension = aLocalExtension('pub.a');
		await testObject.setEnablement([extension], EnablementState.DisabledGlobally);
		await testObject.setEnablement([extension], EnablementState.EnabledGlobally);
		assert.ok(testObject.isEnabled(extension));
		assert.equal(testObject.getEnablementState(extension), EnablementState.EnabledGlobally);
	});

	test('test enable an extension globally return truthy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledGlobally))
			.then(value => assert.ok(value));
	});

	test('test enable an extension globally triggers change event', () => {
		const target = sinon.spy();
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => testObject.onEnablementChanged(target))
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledGlobally))
			.then(() => {
				assert.ok(target.calledOnce);
				assert.deepEqual((<IExtension>target.args[0][0][0]).identifier, { id: 'pub.a' });
			});
	});

	test('test enable an extension globally when already enabled return falsy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledGlobally)
			.then(value => assert.ok(!value[0]));
	});

	test('test enable an extension for workspace', async () => {
		const extension = aLocalExtension('pub.a');
		await testObject.setEnablement([extension], EnablementState.DisabledWorkspace);
		await testObject.setEnablement([extension], EnablementState.EnabledWorkspace);
		assert.ok(testObject.isEnabled(extension));
		assert.equal(testObject.getEnablementState(extension), EnablementState.EnabledWorkspace);
	});

	test('test enable an extension for workspace return truthy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledWorkspace))
			.then(value => assert.ok(value));
	});

	test('test enable an extension for workspace triggers change event', () => {
		const target = sinon.spy();
		return testObject.setEnablement([aLocalExtension('pub.b')], EnablementState.DisabledWorkspace)
			.then(() => testObject.onEnablementChanged(target))
			.then(() => testObject.setEnablement([aLocalExtension('pub.b')], EnablementState.EnabledWorkspace))
			.then(() => {
				assert.ok(target.calledOnce);
				assert.deepEqual((<IExtension>target.args[0][0][0]).identifier, { id: 'pub.b' });
			});
	});

	test('test enable an extension for workspace when already enabled return truthy promise', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.EnabledWorkspace)
			.then(value => assert.ok(value));
	});

	test('test enable an extension for workspace when disabled in workspace and gloablly', async () => {
		const extension = aLocalExtension('pub.a');
		await testObject.setEnablement([extension], EnablementState.DisabledWorkspace);
		await testObject.setEnablement([extension], EnablementState.DisabledGlobally);
		await testObject.setEnablement([extension], EnablementState.EnabledWorkspace);
		assert.ok(testObject.isEnabled(extension));
		assert.equal(testObject.getEnablementState(extension), EnablementState.EnabledWorkspace);
	});

	test('test enable an extension globally when disabled in workspace and gloablly', async () => {
		const extension = aLocalExtension('pub.a');
		await testObject.setEnablement([extension], EnablementState.EnabledWorkspace);
		await testObject.setEnablement([extension], EnablementState.DisabledWorkspace);
		await testObject.setEnablement([extension], EnablementState.DisabledGlobally);
		await testObject.setEnablement([extension], EnablementState.EnabledGlobally);
		assert.ok(testObject.isEnabled(extension));
		assert.equal(testObject.getEnablementState(extension), EnablementState.EnabledGlobally);
	});

	test('test remove an extension from disablement list when uninstalled', async () => {
		const extension = aLocalExtension('pub.a');
		await testObject.setEnablement([extension], EnablementState.DisabledWorkspace);
		await testObject.setEnablement([extension], EnablementState.DisabledGlobally);
		didUninstallEvent.fire({ identifier: { id: 'pub.a' } });
		assert.ok(testObject.isEnabled(extension));
		assert.equal(testObject.getEnablementState(extension), EnablementState.EnabledGlobally);
	});

	test('test isEnabled return false extension is disabled globally', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledGlobally)
			.then(() => assert.ok(!testObject.isEnabled(aLocalExtension('pub.a'))));
	});

	test('test isEnabled return false extension is disabled in workspace', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => assert.ok(!testObject.isEnabled(aLocalExtension('pub.a'))));
	});

	test('test isEnabled return true extension is not disabled', () => {
		return testObject.setEnablement([aLocalExtension('pub.a')], EnablementState.DisabledWorkspace)
			.then(() => testObject.setEnablement([aLocalExtension('pub.c')], EnablementState.DisabledGlobally))
			.then(() => assert.ok(testObject.isEnabled(aLocalExtension('pub.b'))));
	});

	test('test canChangeEnablement return false for language packs', () => {
		assert.equal(testObject.canChangeEnablement(aLocalExtension('pub.a', { localizations: [{ languageId: 'gr', translations: [{ id: 'vscode', path: 'path' }] }] })), false);
	});

	test('test canChangeEnablement return true for auth extension', () => {
		assert.equal(testObject.canChangeEnablement(aLocalExtension('pub.a', { authentication: [{ id: 'a', label: 'a' }] })), true);
	});

	test('test canChangeEnablement return true for auth extension when user data sync account does not depends on it', () => {
		instantiationService.stub(IUserDataSyncAccountService, <Partial<IUserDataSyncAccountService>>{
			account: { authenticationProviderId: 'b' }
		});
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.canChangeEnablement(aLocalExtension('pub.a', { authentication: [{ id: 'a', label: 'a' }] })), true);
	});

	test('test canChangeEnablement return true for auth extension when user data sync account depends on it but auto sync is off', () => {
		instantiationService.stub(IUserDataSyncAccountService, <Partial<IUserDataSyncAccountService>>{
			account: { authenticationProviderId: 'a' }
		});
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.canChangeEnablement(aLocalExtension('pub.a', { authentication: [{ id: 'a', label: 'a' }] })), true);
	});

	test('test canChangeEnablement return false for auth extension and user data sync account depends on it and auto sync is on', () => {
		instantiationService.stub(IUserDataAutoSyncEnablementService, <Partial<IUserDataAutoSyncEnablementService>>{ isEnabled() { return true; } });
		instantiationService.stub(IUserDataSyncAccountService, <Partial<IUserDataSyncAccountService>>{
			account: { authenticationProviderId: 'a' }
		});
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.canChangeEnablement(aLocalExtension('pub.a', { authentication: [{ id: 'a', label: 'a' }] })), false);
	});

	test('test canChangeWorkspaceEnablement return true', () => {
		assert.equal(testObject.canChangeWorkspaceEnablement(aLocalExtension('pub.a')), true);
	});

	test('test canChangeWorkspaceEnablement return false if there is no workspace', () => {
		instantiationService.stub(IWorkspaceContextService, 'getWorkbenchState', WorkbenchState.EMPTY);
		assert.equal(testObject.canChangeWorkspaceEnablement(aLocalExtension('pub.a')), false);
	});

	test('test canChangeWorkspaceEnablement return false for auth extension', () => {
		assert.equal(testObject.canChangeWorkspaceEnablement(aLocalExtension('pub.a', { authentication: [{ id: 'a', label: 'a' }] })), false);
	});

	test('test canChangeEnablement return false when extensions are disabled in environment', () => {
		instantiationService.stub(IWorkbenchEnvironmentService, { disableExtensions: true } as IWorkbenchEnvironmentService);
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.canChangeEnablement(aLocalExtension('pub.a')), false);
	});

	test('test canChangeEnablement return false when the extension is disabled in environment', () => {
		instantiationService.stub(IWorkbenchEnvironmentService, { disableExtensions: ['pub.a'] } as IWorkbenchEnvironmentService);
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.canChangeEnablement(aLocalExtension('pub.a')), false);
	});

	test('test canChangeEnablement return true for system extensions when extensions are disabled in environment', () => {
		instantiationService.stub(IWorkbenchEnvironmentService, { disableExtensions: true } as IWorkbenchEnvironmentService);
		testObject = new TestExtensionEnablementService(instantiationService);
		const extension = aLocalExtension('pub.a', undefined, ExtensionType.System);
		assert.equal(testObject.canChangeEnablement(extension), true);
	});

	test('test canChangeEnablement return false for system extension when extension is disabled in environment', () => {
		instantiationService.stub(IWorkbenchEnvironmentService, { disableExtensions: ['pub.a'] } as IWorkbenchEnvironmentService);
		testObject = new TestExtensionEnablementService(instantiationService);
		const extension = aLocalExtension('pub.a', undefined, ExtensionType.System);
		assert.ok(!testObject.canChangeEnablement(extension));
	});

	test('test extension is disabled when disabled in environment', async () => {
		const extension = aLocalExtension('pub.a');
		instantiationService.stub(IWorkbenchEnvironmentService, { disableExtensions: ['pub.a'] } as IWorkbenchEnvironmentService);
		instantiationService.stub(IExtensionManagementService, { onDidUninstallExtension: didUninstallEvent.event, getInstalled: () => Promise.resolve([extension, aLocalExtension('pub.b')]) } as IExtensionManagementService);
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.ok(!testObject.isEnabled(extension));
		assert.deepEqual(testObject.getEnablementState(extension), EnablementState.DisabledByEnvironemt);
	});

	test('test local workspace extension is disabled by kind', async () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['workspace'] }, { location: URI.file(`pub.a`) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.ok(!testObject.isEnabled(localWorkspaceExtension));
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.DisabledByExtensionKind);
	});

	test('test local workspace + ui extension is enabled by kind', async () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['workspace', 'ui'] }, { location: URI.file(`pub.a`) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.ok(testObject.isEnabled(localWorkspaceExtension));
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.EnabledGlobally);
	});

	test('test local ui extension is not disabled by kind', async () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['ui'] }, { location: URI.file(`pub.a`) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.ok(testObject.isEnabled(localWorkspaceExtension));
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.EnabledGlobally);
	});

	test('test canChangeEnablement return false when the local workspace extension is disabled by kind', () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['workspace'] }, { location: URI.file(`pub.a`) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.canChangeEnablement(localWorkspaceExtension), false);
	});

	test('test canChangeEnablement return true for local ui extension', () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['ui'] }, { location: URI.file(`pub.a`) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.canChangeEnablement(localWorkspaceExtension), true);
	});

	test('test remote ui extension is disabled by kind', async () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['ui'] }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.ok(!testObject.isEnabled(localWorkspaceExtension));
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.DisabledByExtensionKind);
	});

	test('test remote ui+workspace extension is disabled by kind', async () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['ui', 'workspace'] }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.ok(testObject.isEnabled(localWorkspaceExtension));
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.EnabledGlobally);
	});

	test('test remote ui extension is disabled by kind when there is no local server', async () => {
		instantiationService.stub(IExtensionManagementServerService, anExtensionManagementServerService(null, anExtensionManagementServer('vscode-remote', instantiationService), null));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['ui'] }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.ok(!testObject.isEnabled(localWorkspaceExtension));
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.DisabledByExtensionKind);
	});

	test('test remote workspace extension is not disabled by kind', async () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['workspace'] }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.ok(testObject.isEnabled(localWorkspaceExtension));
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.EnabledGlobally);
	});

	test('test canChangeEnablement return false when the remote ui extension is disabled by kind', () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['ui'] }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.canChangeEnablement(localWorkspaceExtension), false);
	});

	test('test canChangeEnablement return true for remote workspace extension', () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['workspace'] }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.canChangeEnablement(localWorkspaceExtension), true);
	});

	test('test web extension on local server is disabled by kind when web worker is not enabled', async () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['web'] }, { location: URI.file(`pub.a`) });
		(<TestConfigurationService>instantiationService.get(IConfigurationService)).setUserConfiguration('extensions', { webWorker: false });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.isEnabled(localWorkspaceExtension), false);
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.DisabledByExtensionKind);
	});

	test('test web extension on local server is not disabled by kind when web worker is enabled', async () => {
		instantiationService.stub(IExtensionManagementServerService, aMultiExtensionManagementServerService(instantiationService));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['web'] }, { location: URI.file(`pub.a`) });
		(<TestConfigurationService>instantiationService.get(IConfigurationService)).setUserConfiguration('extensions', { webWorker: true });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.isEnabled(localWorkspaceExtension), true);
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.EnabledGlobally);
	});

	test('test web extension on remote server is disabled by kind when web worker is not enabled', async () => {
		instantiationService.stub(IExtensionManagementServerService, anExtensionManagementServerService(anExtensionManagementServer('vscode-local', instantiationService), anExtensionManagementServer('vscode-remote', instantiationService), anExtensionManagementServer('web', instantiationService)));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['web'] }, { location: URI.file(`pub.a`).with({ scheme: 'vscode-remote' }) });
		(<TestConfigurationService>instantiationService.get(IConfigurationService)).setUserConfiguration('extensions', { webWorker: false });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.isEnabled(localWorkspaceExtension), false);
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.DisabledByExtensionKind);
	});

	test('test web extension on remote server is disabled by kind when web worker is enabled', async () => {
		instantiationService.stub(IExtensionManagementServerService, anExtensionManagementServerService(anExtensionManagementServer('vscode-local', instantiationService), anExtensionManagementServer('vscode-remote', instantiationService), anExtensionManagementServer('web', instantiationService)));
		const localWorkspaceExtension = aLocalExtension2('pub.a', { extensionKind: ['web'] }, { location: URI.file(`pub.a`).with({ scheme: 'vscode-remote' }) });
		(<TestConfigurationService>instantiationService.get(IConfigurationService)).setUserConfiguration('extensions', { webWorker: true });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.isEnabled(localWorkspaceExtension), false);
		assert.deepEqual(testObject.getEnablementState(localWorkspaceExtension), EnablementState.DisabledByExtensionKind);
	});

	test('test web extension on web server is not disabled by kind', async () => {
		instantiationService.stub(IExtensionManagementServerService, anExtensionManagementServerService(anExtensionManagementServer('vscode-local', instantiationService), anExtensionManagementServer('vscode-remote', instantiationService), anExtensionManagementServer('web', instantiationService)));
		const webExtension = aLocalExtension2('pub.a', { extensionKind: ['web'] }, { location: URI.file(`pub.a`).with({ scheme: 'web' }) });
		testObject = new TestExtensionEnablementService(instantiationService);
		assert.equal(testObject.isEnabled(webExtension), true);
		assert.deepEqual(testObject.getEnablementState(webExtension), EnablementState.EnabledGlobally);
	});

});

function anExtensionManagementServer(authority: string, instantiationService: TestInstantiationService): IExtensionManagementServer {
	return {
		id: authority,
		label: authority,
		extensionManagementService: instantiationService.get(IExtensionManagementService)
	};
}

function aMultiExtensionManagementServerService(instantiationService: TestInstantiationService): IExtensionManagementServerService {
	const localExtensionManagementServer = anExtensionManagementServer('vscode-local', instantiationService);
	const remoteExtensionManagementServer = anExtensionManagementServer('vscode-remote', instantiationService);
	return anExtensionManagementServerService(localExtensionManagementServer, remoteExtensionManagementServer, null);
}

function anExtensionManagementServerService(localExtensionManagementServer: IExtensionManagementServer | null, remoteExtensionManagementServer: IExtensionManagementServer | null, webExtensionManagementServer: IExtensionManagementServer | null): IExtensionManagementServerService {
	return {
		_serviceBrand: undefined,
		localExtensionManagementServer,
		remoteExtensionManagementServer,
		webExtensionManagementServer,
		getExtensionManagementServer: (extension: IExtension) => {
			if (extension.location.scheme === Schemas.file) {
				return localExtensionManagementServer;
			}
			if (extension.location.scheme === Schemas.vscodeRemote) {
				return remoteExtensionManagementServer;
			}
			return webExtensionManagementServer;
		}
	};
}

function aLocalExtension(id: string, contributes?: IExtensionContributions, type?: ExtensionType): ILocalExtension {
	return aLocalExtension2(id, contributes ? { contributes } : {}, isUndefinedOrNull(type) ? {} : { type });
}

function aLocalExtension2(id: string, manifest: any = {}, properties: any = {}): ILocalExtension {
	const [publisher, name] = id.split('.');
	manifest = { name, publisher, ...manifest };
	properties = {
		identifier: { id },
		galleryIdentifier: { id, uuid: undefined },
		type: ExtensionType.User,
		...properties
	};
	properties.isBuiltin = properties.type === ExtensionType.System;
	return <ILocalExtension>Object.create({ manifest, ...properties });
}
