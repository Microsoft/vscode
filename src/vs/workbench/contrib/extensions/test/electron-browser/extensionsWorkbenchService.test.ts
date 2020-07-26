/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as assert from 'assert';
import * as fs from 'fs';
import { assign } from 'vs/base/common/objects';
import { generateUuid } from 'vs/base/common/uuid';
import { IExtensionsWorkbenchService, ExtensionState, AutoCheckUpdatesConfigurationKey, AutoUpdateConfigurationKey } from 'vs/workbench/contrib/extensions/common/extensions';
import { ExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/browser/extensionsWorkbenchService';
import {
	IExtensionManagementService, IExtensionGalleryService, ILocalExtension, IGalleryExtension,
	DidInstallExtensionEvent, DidUninstallExtensionEvent, InstallExtensionEvent, IGalleryExtensionAssets, IExtensionIdentifier, InstallOperation, IExtensionTipsService, IGalleryMetadata
} from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState, IExtensionManagementServerService, IExtensionRecommendationsService, IExtensionManagementServer } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { TestExtensionEnablementService } from 'vs/workbench/services/extensionManagement/test/browser/extensionEnablementService.test';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionGalleryService';
import { IURLService } from 'vs/platform/url/common/url';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { Event, Emitter } from 'vs/base/common/event';
import { IPager } from 'vs/base/common/paging';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { TestSharedProcessService } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IProgressService } from 'vs/platform/progress/common/progress';
import { ProgressService } from 'vs/workbench/services/progress/browser/progressService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { NativeURLService } from 'vs/platform/url/common/urlService';
import { URI } from 'vs/base/common/uri';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ExtensionType, IExtension, ExtensionKind } from 'vs/platform/extensions/common/extensions';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { RemoteAgentService } from 'vs/workbench/services/remote/electron-browser/remoteAgentServiceImpl';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { TestContextService } from 'vs/workbench/test/common/workbenchTestServices';
import { IStorageKeysSyncRegistryService, StorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { IProductService } from 'vs/platform/product/common/productService';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { TestLifecycleService } from 'vs/workbench/test/browser/workbenchTestServices';
import { IExperimentService } from 'vs/workbench/contrib/experiments/common/experimentService';
import { TestExperimentService } from 'vs/workbench/contrib/experiments/test/electron-browser/experimentService.test';
import { ExtensionTipsService } from 'vs/platform/extensionManagement/node/extensionTipsService';
import { Schemas } from 'vs/base/common/network';
import { REMOTE_HOST_SCHEME } from 'vs/platform/remote/common/remoteHosts';

suite('ExtensionsWorkbenchServiceTest', () => {

	let instantiationService: TestInstantiationService;
	let testObject: IExtensionsWorkbenchService;

	let installEvent: Emitter<InstallExtensionEvent>,
		didInstallEvent: Emitter<DidInstallExtensionEvent>,
		uninstallEvent: Emitter<IExtensionIdentifier>,
		didUninstallEvent: Emitter<DidUninstallExtensionEvent>;

	suiteSetup(() => {
		installEvent = new Emitter<InstallExtensionEvent>();
		didInstallEvent = new Emitter<DidInstallExtensionEvent>();
		uninstallEvent = new Emitter<IExtensionIdentifier>();
		didUninstallEvent = new Emitter<DidUninstallExtensionEvent>();

		instantiationService = new TestInstantiationService();
		instantiationService.stub(ITelemetryService, NullTelemetryService);
		instantiationService.stub(ILogService, NullLogService);
		instantiationService.stub(IProgressService, ProgressService);
		instantiationService.stub(IStorageKeysSyncRegistryService, new StorageKeysSyncRegistryService());
		instantiationService.stub(IProductService, {});

		instantiationService.stub(IExtensionGalleryService, ExtensionGalleryService);
		instantiationService.stub(IURLService, NativeURLService);
		instantiationService.stub(ISharedProcessService, TestSharedProcessService);

		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(IConfigurationService, <Partial<IConfigurationService>>{
			onDidChangeConfiguration: () => { return undefined!; },
			getValue: (key?: string) => {
				return (key === AutoCheckUpdatesConfigurationKey || key === AutoUpdateConfigurationKey) ? true : undefined;
			}
		});

		instantiationService.stub(IRemoteAgentService, RemoteAgentService);

		instantiationService.stub(IExtensionManagementService, <Partial<IExtensionManagementService>>{
			onInstallExtension: installEvent.event,
			onDidInstallExtension: didInstallEvent.event,
			onUninstallExtension: uninstallEvent.event,
			onDidUninstallExtension: didUninstallEvent.event,
			async getInstalled() { return []; },
			async getExtensionsReport() { return []; },
			async updateMetadata(local: ILocalExtension, metadata: IGalleryMetadata) {
				local.identifier.uuid = metadata.id;
				local.publisherDisplayName = metadata.publisherDisplayName;
				local.publisherId = metadata.publisherId;
				return local;
			}
		});

		instantiationService.stub(IExtensionManagementServerService, <IExtensionManagementServerService>{
			localExtensionManagementServer: {
				extensionManagementService: instantiationService.get(IExtensionManagementService)
			}
		});

		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));

		instantiationService.stub(ILifecycleService, new TestLifecycleService());
		instantiationService.stub(IExperimentService, instantiationService.createInstance(TestExperimentService));
		instantiationService.stub(IExtensionTipsService, instantiationService.createInstance(ExtensionTipsService));
		instantiationService.stub(IExtensionRecommendationsService, {});

		instantiationService.stub(INotificationService, { prompt: () => null! });
	});

	setup(async () => {
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', []);
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		instantiationService.stubPromise(INotificationService, 'prompt', 0);
		await (<TestExtensionEnablementService>instantiationService.get(IWorkbenchExtensionEnablementService)).reset();
	});

	teardown(() => {
		(<ExtensionsWorkbenchService>testObject).dispose();
	});

	test('test gallery extension', async () => {
		const expected = aGalleryExtension('expectedName', {
			displayName: 'expectedDisplayName',
			version: '1.5.0',
			publisherId: 'expectedPublisherId',
			publisher: 'expectedPublisher',
			publisherDisplayName: 'expectedPublisherDisplayName',
			description: 'expectedDescription',
			installCount: 1000,
			rating: 4,
			ratingCount: 100
		}, {
			dependencies: ['pub.1', 'pub.2'],
		}, {
			manifest: { uri: 'uri:manifest', fallbackUri: 'fallback:manifest' },
			readme: { uri: 'uri:readme', fallbackUri: 'fallback:readme' },
			changelog: { uri: 'uri:changelog', fallbackUri: 'fallback:changlog' },
			download: { uri: 'uri:download', fallbackUri: 'fallback:download' },
			icon: { uri: 'uri:icon', fallbackUri: 'fallback:icon' },
			license: { uri: 'uri:license', fallbackUri: 'fallback:license' },
			repository: { uri: 'uri:repository', fallbackUri: 'fallback:repository' },
			coreTranslations: []
		});

		testObject = await aWorkbenchService();
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(expected));

		return testObject.queryGallery(CancellationToken.None).then(pagedResponse => {
			assert.equal(1, pagedResponse.firstPage.length);
			const actual = pagedResponse.firstPage[0];

			assert.equal(ExtensionType.User, actual.type);
			assert.equal('expectedName', actual.name);
			assert.equal('expectedDisplayName', actual.displayName);
			assert.equal('expectedpublisher.expectedname', actual.identifier.id);
			assert.equal('expectedPublisher', actual.publisher);
			assert.equal('expectedPublisherDisplayName', actual.publisherDisplayName);
			assert.equal('1.5.0', actual.version);
			assert.equal('1.5.0', actual.latestVersion);
			assert.equal('expectedDescription', actual.description);
			assert.equal('uri:icon', actual.iconUrl);
			assert.equal('fallback:icon', actual.iconUrlFallback);
			assert.equal('uri:license', actual.licenseUrl);
			assert.equal(ExtensionState.Uninstalled, actual.state);
			assert.equal(1000, actual.installCount);
			assert.equal(4, actual.rating);
			assert.equal(100, actual.ratingCount);
			assert.equal(false, actual.outdated);
			assert.deepEqual(['pub.1', 'pub.2'], actual.dependencies);
		});
	});

	test('test for empty installed extensions', async () => {
		testObject = await aWorkbenchService();

		assert.deepEqual([], testObject.local);
	});

	test('test for installed extensions', async () => {
		const expected1 = aLocalExtension('local1', {
			publisher: 'localPublisher1',
			version: '1.1.0',
			displayName: 'localDisplayName1',
			description: 'localDescription1',
			icon: 'localIcon1',
			extensionDependencies: ['pub.1', 'pub.2'],
		}, {
			type: ExtensionType.User,
			readmeUrl: 'localReadmeUrl1',
			changelogUrl: 'localChangelogUrl1',
			location: URI.file('localPath1')
		});
		const expected2 = aLocalExtension('local2', {
			publisher: 'localPublisher2',
			version: '1.2.0',
			displayName: 'localDisplayName2',
			description: 'localDescription2',
		}, {
			type: ExtensionType.System,
			readmeUrl: 'localReadmeUrl2',
			changelogUrl: 'localChangelogUrl2',
		});
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [expected1, expected2]);
		testObject = await aWorkbenchService();

		const actuals = testObject.local;
		assert.equal(2, actuals.length);

		let actual = actuals[0];
		assert.equal(ExtensionType.User, actual.type);
		assert.equal('local1', actual.name);
		assert.equal('localDisplayName1', actual.displayName);
		assert.equal('localpublisher1.local1', actual.identifier.id);
		assert.equal('localPublisher1', actual.publisher);
		assert.equal('1.1.0', actual.version);
		assert.equal('1.1.0', actual.latestVersion);
		assert.equal('localDescription1', actual.description);
		assert.equal('file:///localPath1/localIcon1', actual.iconUrl);
		assert.equal('file:///localPath1/localIcon1', actual.iconUrlFallback);
		assert.equal(null, actual.licenseUrl);
		assert.equal(ExtensionState.Installed, actual.state);
		assert.equal(null, actual.installCount);
		assert.equal(null, actual.rating);
		assert.equal(null, actual.ratingCount);
		assert.equal(false, actual.outdated);
		assert.deepEqual(['pub.1', 'pub.2'], actual.dependencies);

		actual = actuals[1];
		assert.equal(ExtensionType.System, actual.type);
		assert.equal('local2', actual.name);
		assert.equal('localDisplayName2', actual.displayName);
		assert.equal('localpublisher2.local2', actual.identifier.id);
		assert.equal('localPublisher2', actual.publisher);
		assert.equal('1.2.0', actual.version);
		assert.equal('1.2.0', actual.latestVersion);
		assert.equal('localDescription2', actual.description);
		assert.ok(fs.existsSync(URI.parse(actual.iconUrl).fsPath));
		assert.equal(null, actual.licenseUrl);
		assert.equal(ExtensionState.Installed, actual.state);
		assert.equal(null, actual.installCount);
		assert.equal(null, actual.rating);
		assert.equal(null, actual.ratingCount);
		assert.equal(false, actual.outdated);
		assert.deepEqual([], actual.dependencies);
	});

	test('test installed extensions get syncs with gallery', async () => {
		const local1 = aLocalExtension('local1', {
			publisher: 'localPublisher1',
			version: '1.1.0',
			displayName: 'localDisplayName1',
			description: 'localDescription1',
			icon: 'localIcon1',
			extensionDependencies: ['pub.1', 'pub.2'],
		}, {
			type: ExtensionType.User,
			readmeUrl: 'localReadmeUrl1',
			changelogUrl: 'localChangelogUrl1',
			location: URI.file('localPath1')
		});
		const local2 = aLocalExtension('local2', {
			publisher: 'localPublisher2',
			version: '1.2.0',
			displayName: 'localDisplayName2',
			description: 'localDescription2',
		}, {
			type: ExtensionType.System,
			readmeUrl: 'localReadmeUrl2',
			changelogUrl: 'localChangelogUrl2',
		});
		const gallery1 = aGalleryExtension(local1.manifest.name, {
			identifier: local1.identifier,
			displayName: 'expectedDisplayName',
			version: '1.5.0',
			publisherId: 'expectedPublisherId',
			publisher: local1.manifest.publisher,
			publisherDisplayName: 'expectedPublisherDisplayName',
			description: 'expectedDescription',
			installCount: 1000,
			rating: 4,
			ratingCount: 100
		}, {
			dependencies: ['pub.1'],
		}, {
			manifest: { uri: 'uri:manifest', fallbackUri: 'fallback:manifest' },
			readme: { uri: 'uri:readme', fallbackUri: 'fallback:readme' },
			changelog: { uri: 'uri:changelog', fallbackUri: 'fallback:changlog' },
			download: { uri: 'uri:download', fallbackUri: 'fallback:download' },
			icon: { uri: 'uri:icon', fallbackUri: 'fallback:icon' },
			license: { uri: 'uri:license', fallbackUri: 'fallback:license' },
			repository: { uri: 'uri:repository', fallbackUri: 'fallback:repository' },
			coreTranslations: []
		});
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local1, local2]);
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(gallery1));
		testObject = await aWorkbenchService();
		await testObject.queryLocal();

		return eventToPromise(testObject.onChange).then(() => {
			const actuals = testObject.local;
			assert.equal(2, actuals.length);

			let actual = actuals[0];
			assert.equal(ExtensionType.User, actual.type);
			assert.equal('local1', actual.name);
			assert.equal('expectedDisplayName', actual.displayName);
			assert.equal('localpublisher1.local1', actual.identifier.id);
			assert.equal('localPublisher1', actual.publisher);
			assert.equal('1.1.0', actual.version);
			assert.equal('1.5.0', actual.latestVersion);
			assert.equal('expectedDescription', actual.description);
			assert.equal('uri:icon', actual.iconUrl);
			assert.equal('fallback:icon', actual.iconUrlFallback);
			assert.equal(ExtensionState.Installed, actual.state);
			assert.equal('uri:license', actual.licenseUrl);
			assert.equal(1000, actual.installCount);
			assert.equal(4, actual.rating);
			assert.equal(100, actual.ratingCount);
			assert.equal(true, actual.outdated);
			assert.deepEqual(['pub.1'], actual.dependencies);

			actual = actuals[1];
			assert.equal(ExtensionType.System, actual.type);
			assert.equal('local2', actual.name);
			assert.equal('localDisplayName2', actual.displayName);
			assert.equal('localpublisher2.local2', actual.identifier.id);
			assert.equal('localPublisher2', actual.publisher);
			assert.equal('1.2.0', actual.version);
			assert.equal('1.2.0', actual.latestVersion);
			assert.equal('localDescription2', actual.description);
			assert.ok(fs.existsSync(URI.parse(actual.iconUrl).fsPath));
			assert.equal(null, actual.licenseUrl);
			assert.equal(ExtensionState.Installed, actual.state);
			assert.equal(null, actual.installCount);
			assert.equal(null, actual.rating);
			assert.equal(null, actual.ratingCount);
			assert.equal(false, actual.outdated);
			assert.deepEqual([], actual.dependencies);
		});
	});

	test('test extension state computation', async () => {
		const gallery = aGalleryExtension('gallery1');
		testObject = await aWorkbenchService();
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(gallery));

		return testObject.queryGallery(CancellationToken.None).then(page => {
			const extension = page.firstPage[0];
			assert.equal(ExtensionState.Uninstalled, extension.state);

			testObject.install(extension);
			const identifier = gallery.identifier;

			// Installing
			installEvent.fire({ identifier, gallery });
			let local = testObject.local;
			assert.equal(1, local.length);
			const actual = local[0];
			assert.equal(`${gallery.publisher}.${gallery.name}`, actual.identifier.id);
			assert.equal(ExtensionState.Installing, actual.state);

			// Installed
			didInstallEvent.fire({ identifier, gallery, operation: InstallOperation.Install, local: aLocalExtension(gallery.name, gallery, { identifier }) });
			assert.equal(ExtensionState.Installed, actual.state);
			assert.equal(1, testObject.local.length);

			testObject.uninstall(actual);

			// Uninstalling
			uninstallEvent.fire(identifier);
			assert.equal(ExtensionState.Uninstalling, actual.state);

			// Uninstalled
			didUninstallEvent.fire({ identifier });
			assert.equal(ExtensionState.Uninstalled, actual.state);

			assert.equal(0, testObject.local.length);
		});
	});

	test('test extension doesnot show outdated for system extensions', async () => {
		const local = aLocalExtension('a', { version: '1.0.1' }, { type: ExtensionType.System });
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local]);
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(aGalleryExtension(local.manifest.name, { identifier: local.identifier, version: '1.0.2' })));
		testObject = await aWorkbenchService();
		await testObject.queryLocal();

		assert.ok(!testObject.local[0].outdated);
	});

	test('test canInstall returns false for extensions with out gallery', async () => {
		const local = aLocalExtension('a', { version: '1.0.1' }, { type: ExtensionType.System });
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local]);
		testObject = await aWorkbenchService();
		const target = testObject.local[0];
		testObject.uninstall(target);
		uninstallEvent.fire(local.identifier);
		didUninstallEvent.fire({ identifier: local.identifier });

		assert.ok(!testObject.canInstall(target));
	});

	test('test canInstall returns false for a system extension', async () => {
		const local = aLocalExtension('a', { version: '1.0.1' }, { type: ExtensionType.System });
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local]);
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(aGalleryExtension(local.manifest.name, { identifier: local.identifier })));
		testObject = await aWorkbenchService();
		const target = testObject.local[0];

		assert.ok(!testObject.canInstall(target));
	});

	test('test canInstall returns true for extensions with gallery', async () => {
		const local = aLocalExtension('a', { version: '1.0.1' }, { type: ExtensionType.User });
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local]);
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(aGalleryExtension(local.manifest.name, { identifier: local.identifier })));
		testObject = await aWorkbenchService();
		const target = testObject.local[0];

		return eventToPromise(testObject.onChange).then(() => {
			assert.ok(testObject.canInstall(target));
		});
	});

	test('test onchange event is triggered while installing', async () => {
		const gallery = aGalleryExtension('gallery1');
		testObject = await aWorkbenchService();
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(gallery));
		const target = sinon.spy();

		return testObject.queryGallery(CancellationToken.None).then(page => {
			const extension = page.firstPage[0];
			assert.equal(ExtensionState.Uninstalled, extension.state);

			testObject.install(extension);
			installEvent.fire({ identifier: gallery.identifier, gallery });
			testObject.onChange(target);

			// Installed
			didInstallEvent.fire({ identifier: gallery.identifier, gallery, operation: InstallOperation.Install, local: aLocalExtension(gallery.name, gallery, gallery) });

			assert.ok(target.calledOnce);
		});
	});

	test('test onchange event is triggered when installation is finished', async () => {
		const gallery = aGalleryExtension('gallery1');
		testObject = await aWorkbenchService();
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(gallery));
		const target = sinon.spy();

		return testObject.queryGallery(CancellationToken.None).then(page => {
			const extension = page.firstPage[0];
			assert.equal(ExtensionState.Uninstalled, extension.state);

			testObject.install(extension);
			testObject.onChange(target);

			// Installing
			installEvent.fire({ identifier: gallery.identifier, gallery });

			assert.ok(target.calledOnce);
		});
	});

	test('test onchange event is triggered while uninstalling', async () => {
		const local = aLocalExtension('a', {}, { type: ExtensionType.System });
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local]);
		testObject = await aWorkbenchService();
		const target = sinon.spy();

		testObject.uninstall(testObject.local[0]);
		testObject.onChange(target);
		uninstallEvent.fire(local.identifier);

		assert.ok(target.calledOnce);
	});

	test('test onchange event is triggered when uninstalling is finished', async () => {
		const local = aLocalExtension('a', {}, { type: ExtensionType.System });
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local]);
		testObject = await aWorkbenchService();
		const target = sinon.spy();

		testObject.uninstall(testObject.local[0]);
		uninstallEvent.fire(local.identifier);
		testObject.onChange(target);
		didUninstallEvent.fire({ identifier: local.identifier });

		assert.ok(target.calledOnce);
	});

	test('test uninstalled extensions are always enabled', async () => {
		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('b')], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('c')], EnablementState.DisabledWorkspace))
			.then(async () => {
				testObject = await aWorkbenchService();
				instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(aGalleryExtension('a')));
				return testObject.queryGallery(CancellationToken.None).then(pagedResponse => {
					const actual = pagedResponse.firstPage[0];
					assert.equal(actual.enablementState, EnablementState.EnabledGlobally);
				});
			});
	});

	test('test enablement state installed enabled extension', async () => {
		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('b')], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('c')], EnablementState.DisabledWorkspace))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [aLocalExtension('a')]);
				testObject = await aWorkbenchService();

				const actual = testObject.local[0];

				assert.equal(actual.enablementState, EnablementState.EnabledGlobally);
			});
	});

	test('test workspace disabled extension', async () => {
		const extensionA = aLocalExtension('a');
		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('b')], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('d')], EnablementState.DisabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.DisabledWorkspace))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('e')], EnablementState.DisabledWorkspace))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA]);
				testObject = await aWorkbenchService();

				const actual = testObject.local[0];

				assert.equal(actual.enablementState, EnablementState.DisabledWorkspace);
			});
	});

	test('test globally disabled extension', async () => {
		const localExtension = aLocalExtension('a');
		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([localExtension], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('d')], EnablementState.DisabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('c')], EnablementState.DisabledWorkspace))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [localExtension]);
				testObject = await aWorkbenchService();

				const actual = testObject.local[0];

				assert.equal(actual.enablementState, EnablementState.DisabledGlobally);
			});
	});

	test('test enablement state is updated for user extensions', async () => {
		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('c')], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('b')], EnablementState.DisabledWorkspace))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [aLocalExtension('a')]);
				testObject = await aWorkbenchService();
				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledWorkspace)
					.then(() => {
						const actual = testObject.local[0];
						assert.equal(actual.enablementState, EnablementState.DisabledWorkspace);
					});
			});
	});

	test('test enable extension globally when extension is disabled for workspace', async () => {
		const localExtension = aLocalExtension('a');
		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([localExtension], EnablementState.DisabledWorkspace)
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [localExtension]);
				testObject = await aWorkbenchService();
				return testObject.setEnablement(testObject.local[0], EnablementState.EnabledGlobally)
					.then(() => {
						const actual = testObject.local[0];
						assert.equal(actual.enablementState, EnablementState.EnabledGlobally);
					});
			});
	});

	test('test disable extension globally', async () => {
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [aLocalExtension('a')]);
		testObject = await aWorkbenchService();

		return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
			.then(() => {
				const actual = testObject.local[0];
				assert.equal(actual.enablementState, EnablementState.DisabledGlobally);
			});
	});

	test('test system extensions can be disabled', async () => {
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [aLocalExtension('a', {}, { type: ExtensionType.System })]);
		testObject = await aWorkbenchService();

		return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
			.then(() => {
				const actual = testObject.local[0];
				assert.equal(actual.enablementState, EnablementState.DisabledGlobally);
			});
	});

	test('test enablement state is updated on change from outside', async () => {
		const localExtension = aLocalExtension('a');
		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('c')], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('b')], EnablementState.DisabledWorkspace))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [localExtension]);
				testObject = await aWorkbenchService();

				return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([localExtension], EnablementState.DisabledGlobally)
					.then(() => {
						const actual = testObject.local[0];
						assert.equal(actual.enablementState, EnablementState.DisabledGlobally);
					});
			});
	});

	test('test disable extension with dependencies disable only itself', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
					.then(() => {
						assert.equal(testObject.local[0].enablementState, EnablementState.DisabledGlobally);
						assert.equal(testObject.local[1].enablementState, EnablementState.EnabledGlobally);
					});
			});
	});

	test('test disable extension pack disables the pack', async () => {
		const extensionA = aLocalExtension('a', { extensionPack: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
					.then(() => {
						assert.equal(testObject.local[0].enablementState, EnablementState.DisabledGlobally);
						assert.equal(testObject.local[1].enablementState, EnablementState.DisabledGlobally);
					});
			});
	});

	test('test disable extension pack disable all', async () => {
		const extensionA = aLocalExtension('a', { extensionPack: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
					.then(() => {
						assert.equal(testObject.local[0].enablementState, EnablementState.DisabledGlobally);
						assert.equal(testObject.local[1].enablementState, EnablementState.DisabledGlobally);
					});
			});
	});

	test('test disable extension fails if extension is a dependent of other', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();
				return testObject.setEnablement(testObject.local[1], EnablementState.DisabledGlobally).then(() => assert.fail('Should fail'), error => assert.ok(true));
			});
	});

	test('test disable extension when extension is part of a pack', async () => {
		const extensionA = aLocalExtension('a', { extensionPack: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();
				return testObject.setEnablement(testObject.local[1], EnablementState.DisabledGlobally)
					.then(() => {
						assert.equal(testObject.local[1].enablementState, EnablementState.DisabledGlobally);
					});
			});
	});

	test('test disable both dependency and dependent do not promot and do not fail', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				const target = sinon.spy();
				testObject = await aWorkbenchService();

				return testObject.setEnablement([testObject.local[1], testObject.local[0]], EnablementState.DisabledGlobally)
					.then(() => {
						assert.ok(!target.called);
						assert.equal(testObject.local[0].enablementState, EnablementState.DisabledGlobally);
						assert.equal(testObject.local[1].enablementState, EnablementState.DisabledGlobally);
					});
			});
	});

	test('test enable both dependency and dependent do not promot and do not fail', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.DisabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.DisabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				const target = sinon.spy();
				testObject = await aWorkbenchService();

				return testObject.setEnablement([testObject.local[1], testObject.local[0]], EnablementState.EnabledGlobally)
					.then(() => {
						assert.ok(!target.called);
						assert.equal(testObject.local[0].enablementState, EnablementState.EnabledGlobally);
						assert.equal(testObject.local[1].enablementState, EnablementState.EnabledGlobally);
					});
			});
	});

	test('test disable extension does not fail if its dependency is a dependent of other but chosen to disable only itself', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c', { extensionDependencies: ['pub.b'] });

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
					.then(() => {
						assert.equal(testObject.local[0].enablementState, EnablementState.DisabledGlobally);
					});
			});
	});

	test('test disable extension if its dependency is a dependent of other disabled extension', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c', { extensionDependencies: ['pub.b'] });

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.DisabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
					.then(() => {
						assert.equal(testObject.local[0].enablementState, EnablementState.DisabledGlobally);
					});
			});
	});

	test('test disable extension if its dependencys dependency is itself', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b', { extensionDependencies: ['pub.a'] });
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
					.then(() => assert.fail('An extension with dependent should not be disabled'), () => null);
			});
	});

	test('test disable extension if its dependency is dependent and is disabled', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c', { extensionDependencies: ['pub.b'] });

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.DisabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);

				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
					.then(() => assert.equal(testObject.local[0].enablementState, EnablementState.DisabledGlobally));
			});
	});

	test('test disable extension with cyclic dependencies', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b', { extensionDependencies: ['pub.c'] });
		const extensionC = aLocalExtension('c', { extensionDependencies: ['pub.a'] });

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.EnabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.EnabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();
				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
					.then(() => assert.fail('An extension with dependent should not be disabled'), () => null);
			});
	});

	test('test enable extension with dependencies enable all', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.DisabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.DisabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.EnabledGlobally)
					.then(() => {
						assert.equal(testObject.local[0].enablementState, EnablementState.EnabledGlobally);
						assert.equal(testObject.local[1].enablementState, EnablementState.EnabledGlobally);
					});
			});
	});

	test('test enable extension with dependencies does not prompt if dependency is enabled already', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.EnabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.DisabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				const target = sinon.spy();
				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.EnabledGlobally)
					.then(() => {
						assert.ok(!target.called);
						assert.equal(testObject.local[0].enablementState, EnablementState.EnabledGlobally);
					});
			});
	});

	test('test enable extension with dependency does not prompt if both are enabled', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b');
		const extensionC = aLocalExtension('c');

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.DisabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.DisabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);
				const target = sinon.spy();
				testObject = await aWorkbenchService();

				return testObject.setEnablement([testObject.local[1], testObject.local[0]], EnablementState.EnabledGlobally)
					.then(() => {
						assert.ok(!target.called);
						assert.equal(testObject.local[0].enablementState, EnablementState.EnabledGlobally);
						assert.equal(testObject.local[1].enablementState, EnablementState.EnabledGlobally);
					});
			});
	});

	test('test enable extension with cyclic dependencies', async () => {
		const extensionA = aLocalExtension('a', { extensionDependencies: ['pub.b'] });
		const extensionB = aLocalExtension('b', { extensionDependencies: ['pub.c'] });
		const extensionC = aLocalExtension('c', { extensionDependencies: ['pub.a'] });

		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionA], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionB], EnablementState.DisabledGlobally))
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([extensionC], EnablementState.DisabledGlobally))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [extensionA, extensionB, extensionC]);

				testObject = await aWorkbenchService();

				return testObject.setEnablement(testObject.local[0], EnablementState.EnabledGlobally)
					.then(() => {
						assert.equal(testObject.local[0].enablementState, EnablementState.EnabledGlobally);
						assert.equal(testObject.local[1].enablementState, EnablementState.EnabledGlobally);
						assert.equal(testObject.local[2].enablementState, EnablementState.EnabledGlobally);
					});
			});
	});

	test('test change event is fired when disablement flags are changed', async () => {
		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('c')], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('b')], EnablementState.DisabledWorkspace))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [aLocalExtension('a')]);
				testObject = await aWorkbenchService();
				const target = sinon.spy();
				testObject.onChange(target);

				return testObject.setEnablement(testObject.local[0], EnablementState.DisabledGlobally)
					.then(() => assert.ok(target.calledOnce));
			});
	});

	test('test change event is fired when disablement flags are changed from outside', async () => {
		const localExtension = aLocalExtension('a');
		return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('c')], EnablementState.DisabledGlobally)
			.then(() => instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([aLocalExtension('b')], EnablementState.DisabledWorkspace))
			.then(async () => {
				instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [localExtension]);
				testObject = await aWorkbenchService();
				const target = sinon.spy();
				testObject.onChange(target);

				return instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([localExtension], EnablementState.DisabledGlobally)
					.then(() => assert.ok(target.calledOnce));
			});
	});

	test('test updating an extension does not re-eanbles it when disabled globally', async () => {
		testObject = await aWorkbenchService();
		const local = aLocalExtension('pub.a');
		await instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([local], EnablementState.DisabledGlobally);
		didInstallEvent.fire({ local, identifier: local.identifier, operation: InstallOperation.Update });
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local]);
		const actual = await testObject.queryLocal();
		assert.equal(actual[0].enablementState, EnablementState.DisabledGlobally);
	});

	test('test updating an extension does not re-eanbles it when workspace disabled', async () => {
		testObject = await aWorkbenchService();
		const local = aLocalExtension('pub.a');
		await instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([local], EnablementState.DisabledWorkspace);
		didInstallEvent.fire({ local, identifier: local.identifier, operation: InstallOperation.Update });
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [local]);
		const actual = await testObject.queryLocal();
		assert.equal(actual[0].enablementState, EnablementState.DisabledWorkspace);
	});

	test('test user extension is preferred when the same extension exists as system and user extension', async () => {
		testObject = await aWorkbenchService();
		const userExtension = aLocalExtension('pub.a');
		const systemExtension = aLocalExtension('pub.a', {}, { type: ExtensionType.System });
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [systemExtension, userExtension]);

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, userExtension);
	});

	test('test user extension is disabled when the same extension exists as system and user extension and system extension is disabled', async () => {
		testObject = await aWorkbenchService();
		const systemExtension = aLocalExtension('pub.a', {}, { type: ExtensionType.System });
		await instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([systemExtension], EnablementState.DisabledGlobally);
		const userExtension = aLocalExtension('pub.a');
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [systemExtension, userExtension]);

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, userExtension);
		assert.equal(actual[0].enablementState, EnablementState.DisabledGlobally);
	});

	test('Test local ui extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['ui'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local workspace extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local web extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['web'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local ui,workspace extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['ui', 'workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local workspace,ui extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['workspace', 'ui'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local ui,workspace,web extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['ui', 'workspace', 'web'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local ui,web,workspace extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['ui', 'web', 'workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local web,ui,workspace extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['web', 'ui', 'workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local web,workspace,ui extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['web', 'workspace', 'ui'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local workspace,web,ui extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['workspace', 'web', 'ui'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local workspace,ui,web extension is chosen if it exists only in local server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['workspace', 'ui', 'web'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local UI extension is chosen if it exists in both servers', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['ui'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test local ui,workspace extension is chosen if it exists in both servers', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['ui', 'workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test remote workspace extension is chosen if it exists in remote server', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['workspace'];
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService(), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, remoteExtension);
	});

	test('Test remote workspace extension is chosen if it exists in both servers', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, remoteExtension);
	});

	test('Test remote workspace extension is chosen if it exists in both servers and local is disabled', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		await instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([localExtension], EnablementState.DisabledGlobally);
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, remoteExtension);
		assert.equal(actual[0].enablementState, EnablementState.DisabledGlobally);
	});

	test('Test remote workspace extension is chosen if it exists in both servers and remote is disabled in workspace', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		await instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([remoteExtension], EnablementState.DisabledWorkspace);
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, remoteExtension);
		assert.equal(actual[0].enablementState, EnablementState.DisabledWorkspace);
	});

	test('Test local ui, workspace extension is chosen if it exists in both servers and local is disabled', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['ui', 'workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		await instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([localExtension], EnablementState.DisabledGlobally);
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
		assert.equal(actual[0].enablementState, EnablementState.DisabledGlobally);
	});

	test('Test local ui, workspace extension is chosen if it exists in both servers and local is disabled in workspace', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['ui', 'workspace'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		await instantiationService.get(IWorkbenchExtensionEnablementService).setEnablement([localExtension], EnablementState.DisabledWorkspace);
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
		assert.equal(actual[0].enablementState, EnablementState.DisabledWorkspace);
	});

	test('Test local web extension is chosen if it exists in both servers', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['web'];
		const localExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`) });
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([localExtension]), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, localExtension);
	});

	test('Test remote web extension is chosen if it exists only in remote', async () => {
		// multi server setup
		const extensionKind: ExtensionKind[] = ['web'];
		const remoteExtension = aLocalExtension('a', { extensionKind }, { location: URI.file(`pub.a`).with({ scheme: Schemas.vscodeRemote }) });

		const extensionManagementServerService = aMultiExtensionManagementServerService(instantiationService, createExtensionManagementService([]), createExtensionManagementService([remoteExtension]));
		instantiationService.stub(IExtensionManagementServerService, extensionManagementServerService);
		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));
		testObject = await aWorkbenchService();

		const actual = await testObject.queryLocal();

		assert.equal(actual.length, 1);
		assert.equal(actual[0].local, remoteExtension);
	});

	async function aWorkbenchService(): Promise<ExtensionsWorkbenchService> {
		const workbenchService: ExtensionsWorkbenchService = instantiationService.createInstance(ExtensionsWorkbenchService);
		await workbenchService.queryLocal();
		return workbenchService;
	}

	function aLocalExtension(name: string = 'someext', manifest: any = {}, properties: any = {}): ILocalExtension {
		manifest = assign({ name, publisher: 'pub', version: '1.0.0' }, manifest);
		properties = assign({
			type: ExtensionType.User,
			location: URI.file(`pub.${name}`),
			identifier: { id: getGalleryExtensionId(manifest.publisher, manifest.name) }
		}, properties);
		return <ILocalExtension>Object.create({ manifest, ...properties });
	}

	const noAssets: IGalleryExtensionAssets = {
		changelog: null,
		download: null!,
		icon: null!,
		license: null,
		manifest: null,
		readme: null,
		repository: null,
		coreTranslations: []
	};

	function aGalleryExtension(name: string, properties: any = {}, galleryExtensionProperties: any = {}, assets: IGalleryExtensionAssets = noAssets): IGalleryExtension {
		const galleryExtension = <IGalleryExtension>Object.create({});
		assign(galleryExtension, { name, publisher: 'pub', version: '1.0.0', properties: {}, assets: {} }, properties);
		assign(galleryExtension.properties, { dependencies: [] }, galleryExtensionProperties);
		assign(galleryExtension.assets, assets);
		galleryExtension.identifier = { id: getGalleryExtensionId(galleryExtension.publisher, galleryExtension.name), uuid: generateUuid() };
		return <IGalleryExtension>galleryExtension;
	}

	function aPage<T>(...objects: T[]): IPager<T> {
		return { firstPage: objects, total: objects.length, pageSize: objects.length, getPage: () => null! };
	}

	function eventToPromise(event: Event<any>, count: number = 1): Promise<void> {
		return new Promise<void>(c => {
			let counter = 0;
			event(() => {
				if (++counter === count) {
					c(undefined);
				}
			});
		});
	}

	function aMultiExtensionManagementServerService(instantiationService: TestInstantiationService, localExtensionManagementService?: IExtensionManagementService, remoteExtensionManagementService?: IExtensionManagementService): IExtensionManagementServerService {
		const localExtensionManagementServer: IExtensionManagementServer = {
			id: 'vscode-local',
			label: 'local',
			extensionManagementService: localExtensionManagementService || createExtensionManagementService()
		};
		const remoteExtensionManagementServer: IExtensionManagementServer = {
			id: 'vscode-remote',
			label: 'remote',
			extensionManagementService: remoteExtensionManagementService || createExtensionManagementService()
		};
		return {
			_serviceBrand: undefined,
			localExtensionManagementServer,
			remoteExtensionManagementServer,
			webExtensionManagementServer: null,
			getExtensionManagementServer: (extension: IExtension) => {
				if (extension.location.scheme === Schemas.file) {
					return localExtensionManagementServer;
				}
				if (extension.location.scheme === REMOTE_HOST_SCHEME) {
					return remoteExtensionManagementServer;
				}
				throw new Error('');
			}
		};
	}

	function createExtensionManagementService(installed: ILocalExtension[] = []): IExtensionManagementService {
		return <IExtensionManagementService>{
			onInstallExtension: Event.None,
			onDidInstallExtension: Event.None,
			onUninstallExtension: Event.None,
			onDidUninstallExtension: Event.None,
			getInstalled: () => Promise.resolve<ILocalExtension[]>(installed),
			installFromGallery: (extension: IGalleryExtension) => Promise.reject(new Error('not supported')),
			updateMetadata: async (local: ILocalExtension, metadata: IGalleryMetadata) => {
				local.identifier.uuid = metadata.id;
				local.publisherDisplayName = metadata.publisherDisplayName;
				local.publisherId = metadata.publisherId;
				return local;
			}
		};
	}
});
