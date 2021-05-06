/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { generateUuid } from 'vs/base/common/uuid';
import { ExtensionsListView } from 'vs/workbench/contrib/extensions/browser/extensionsViews';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';
import { ExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/browser/extensionsWorkbenchService';
import {
	IExtensionManagementService, IExtensionGalleryService, ILocalExtension, IGalleryExtension, IQueryOptions,
	DidInstallExtensionEvent, DidUninstallExtensionEvent, InstallExtensionEvent, IExtensionIdentifier, SortBy
} from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState, IExtensionManagementServerService, IExtensionManagementServer } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExtensionRecommendationsService, ExtensionRecommendationReason } from 'vs/workbench/services/extensionRecommendations/common/extensionRecommendations';
import { getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { TestExtensionEnablementService } from 'vs/workbench/services/extensionManagement/test/browser/extensionEnablementService.test';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionGalleryService';
import { IURLService } from 'vs/platform/url/common/url';
import { Emitter, Event } from 'vs/base/common/event';
import { IPager } from 'vs/base/common/paging';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { IExtensionService, toExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { TestMenuService } from 'vs/workbench/test/browser/workbenchTestServices';
import { TestSharedProcessService } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { NativeURLService } from 'vs/platform/url/common/urlService';
import { URI } from 'vs/base/common/uri';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { SinonStub } from 'sinon';
import { IExperimentService, ExperimentState, ExperimentActionType, ExperimentService } from 'vs/workbench/contrib/experiments/common/experimentService';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { RemoteAgentService } from 'vs/workbench/services/remote/electron-sandbox/remoteAgentServiceImpl';
import { ExtensionType, IExtension, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ISharedProcessService } from 'vs/platform/ipc/electron-sandbox/services';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { TestContextService } from 'vs/workbench/test/common/workbenchTestServices';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { Schemas } from 'vs/base/common/network';

suite('ExtensionsListView Tests', () => {

	let instantiationService: TestInstantiationService;
	let testableView: ExtensionsListView;
	let installEvent: Emitter<InstallExtensionEvent>,
		didInstallEvent: Emitter<DidInstallExtensionEvent>,
		uninstallEvent: Emitter<IExtensionIdentifier>,
		didUninstallEvent: Emitter<DidUninstallExtensionEvent>;

	const localEnabledTheme = aLocalExtension('first-enabled-extension', { categories: ['Themes', 'random'] });
	const localEnabledLanguage = aLocalExtension('second-enabled-extension', { categories: ['Programming languages'] });
	const localDisabledTheme = aLocalExtension('first-disabled-extension', { categories: ['themes'] });
	const localDisabledLanguage = aLocalExtension('second-disabled-extension', { categories: ['programming languages'] });
	const localRandom = aLocalExtension('random-enabled-extension', { categories: ['random'] });
	const builtInTheme = aLocalExtension('my-theme', { contributes: { themes: ['my-theme'] } }, { type: ExtensionType.System });
	const builtInBasic = aLocalExtension('my-lang', { contributes: { grammars: [{ language: 'my-language' }] } }, { type: ExtensionType.System });

	const workspaceRecommendationA = aGalleryExtension('workspace-recommendation-A');
	const workspaceRecommendationB = aGalleryExtension('workspace-recommendation-B');
	const configBasedRecommendationA = aGalleryExtension('configbased-recommendation-A');
	const configBasedRecommendationB = aGalleryExtension('configbased-recommendation-B');
	const fileBasedRecommendationA = aGalleryExtension('filebased-recommendation-A');
	const fileBasedRecommendationB = aGalleryExtension('filebased-recommendation-B');
	const otherRecommendationA = aGalleryExtension('other-recommendation-A');

	suiteSetup(() => {
		installEvent = new Emitter<InstallExtensionEvent>();
		didInstallEvent = new Emitter<DidInstallExtensionEvent>();
		uninstallEvent = new Emitter<IExtensionIdentifier>();
		didUninstallEvent = new Emitter<DidUninstallExtensionEvent>();

		instantiationService = new TestInstantiationService();
		instantiationService.stub(ITelemetryService, NullTelemetryService);
		instantiationService.stub(ILogService, NullLogService);

		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		instantiationService.stub(IConfigurationService, new TestConfigurationService());

		instantiationService.stub(IExtensionGalleryService, ExtensionGalleryService);
		instantiationService.stub(ISharedProcessService, TestSharedProcessService);
		instantiationService.stub(IExperimentService, ExperimentService);

		instantiationService.stub(IExtensionManagementService, <Partial<IExtensionManagementService>>{
			onInstallExtension: installEvent.event,
			onDidInstallExtension: didInstallEvent.event,
			onUninstallExtension: uninstallEvent.event,
			onDidUninstallExtension: didUninstallEvent.event,
			async getInstalled() { return []; },
			async canInstall() { return true; },
			async getExtensionsReport() { return []; },
		});
		instantiationService.stub(IRemoteAgentService, RemoteAgentService);
		instantiationService.stub(IContextKeyService, new MockContextKeyService());
		instantiationService.stub(IMenuService, new TestMenuService());

		const localExtensionManagementServer = { extensionManagementService: instantiationService.get(IExtensionManagementService), label: 'local', id: 'vscode-local' };
		instantiationService.stub(IExtensionManagementServerService, <Partial<IExtensionManagementServerService>>{
			get localExtensionManagementServer(): IExtensionManagementServer {
				return localExtensionManagementServer;
			},
			getExtensionManagementServer(extension: IExtension): IExtensionManagementServer | null {
				if (extension.location.scheme === Schemas.file) {
					return localExtensionManagementServer;
				}
				throw new Error(`Invalid Extension ${extension.location}`);
			}
		});

		instantiationService.stub(IWorkbenchExtensionEnablementService, new TestExtensionEnablementService(instantiationService));

		const reasons: { [key: string]: any } = {};
		reasons[workspaceRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.Workspace };
		reasons[workspaceRecommendationB.identifier.id] = { reasonId: ExtensionRecommendationReason.Workspace };
		reasons[fileBasedRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.File };
		reasons[fileBasedRecommendationB.identifier.id] = { reasonId: ExtensionRecommendationReason.File };
		reasons[otherRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.Executable };
		reasons[configBasedRecommendationA.identifier.id] = { reasonId: ExtensionRecommendationReason.WorkspaceConfig };
		instantiationService.stub(IExtensionRecommendationsService, <Partial<IExtensionRecommendationsService>>{
			getWorkspaceRecommendations() {
				return Promise.resolve([
					workspaceRecommendationA.identifier.id,
					workspaceRecommendationB.identifier.id]);
			},
			getConfigBasedRecommendations() {
				return Promise.resolve({
					important: [configBasedRecommendationA.identifier.id],
					others: [configBasedRecommendationB.identifier.id],
				});
			},
			getImportantRecommendations(): Promise<string[]> {
				return Promise.resolve([]);
			},
			getFileBasedRecommendations() {
				return [
					fileBasedRecommendationA.identifier.id,
					fileBasedRecommendationB.identifier.id
				];
			},
			getOtherRecommendations() {
				return Promise.resolve([
					configBasedRecommendationB.identifier.id,
					otherRecommendationA.identifier.id
				]);
			},
			getAllRecommendationsWithReason() {
				return reasons;
			}
		});
		instantiationService.stub(IURLService, NativeURLService);
	});

	setup(async () => {
		instantiationService.stubPromise(IExtensionManagementService, 'getInstalled', [localEnabledTheme, localEnabledLanguage, localRandom, localDisabledTheme, localDisabledLanguage, builtInTheme, builtInBasic]);
		instantiationService.stubPromise(IExtensionManagementService, 'getExtensionsReport', []);
		instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		instantiationService.stubPromise(IExperimentService, 'getExperimentsByType', []);

		instantiationService.stub(IViewDescriptorService, {
			getViewLocationById(): ViewContainerLocation {
				return ViewContainerLocation.Sidebar;
			},
			onDidChangeLocation: Event.None
		});

		instantiationService.stub(IExtensionService, <Partial<IExtensionService>>{
			onDidChangeExtensions: Event.None,
			getExtensions: (): Promise<IExtensionDescription[]> => {
				return Promise.resolve([
					toExtensionDescription(localEnabledTheme),
					toExtensionDescription(localEnabledLanguage),
					toExtensionDescription(localRandom),
					toExtensionDescription(builtInTheme),
					toExtensionDescription(builtInBasic)
				]);
			}
		});
		await (<TestExtensionEnablementService>instantiationService.get(IWorkbenchExtensionEnablementService)).setEnablement([localDisabledTheme], EnablementState.DisabledGlobally);
		await (<TestExtensionEnablementService>instantiationService.get(IWorkbenchExtensionEnablementService)).setEnablement([localDisabledLanguage], EnablementState.DisabledGlobally);

		instantiationService.set(IExtensionsWorkbenchService, instantiationService.createInstance(ExtensionsWorkbenchService));
		testableView = instantiationService.createInstance(ExtensionsListView, {}, {});
	});

	teardown(() => {
		(<ExtensionsWorkbenchService>instantiationService.get(IExtensionsWorkbenchService)).dispose();
		testableView.dispose();
	});

	test('Test query types', () => {
		assert.strictEqual(ExtensionsListView.isBuiltInExtensionsQuery('@builtin'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@installed'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@enabled'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@disabled'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@outdated'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@installed searchText'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@enabled searchText'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@disabled searchText'), true);
		assert.strictEqual(ExtensionsListView.isLocalExtensionsQuery('@outdated searchText'), true);
	});

	test('Test empty query equates to sort by install count', () => {
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		return testableView.show('').then(() => {
			assert.ok(target.calledOnce);
			const options: IQueryOptions = target.args[0][0];
			assert.strictEqual(options.sortBy, SortBy.InstallCount);
		});
	});

	test('Test non empty query without sort doesnt use sortBy', () => {
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		return testableView.show('some extension').then(() => {
			assert.ok(target.calledOnce);
			const options: IQueryOptions = target.args[0][0];
			assert.strictEqual(options.sortBy, undefined);
		});
	});

	test('Test query with sort uses sortBy', () => {
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage());
		return testableView.show('some extension @sort:rating').then(() => {
			assert.ok(target.calledOnce);
			const options: IQueryOptions = target.args[0][0];
			assert.strictEqual(options.sortBy, SortBy.WeightedRating);
		});
	});

	test('Test installed query results', async () => {
		await testableView.show('@installed').then(result => {
			assert.strictEqual(result.length, 5, 'Unexpected number of results for @installed query');
			const actual = [result.get(0).name, result.get(1).name, result.get(2).name, result.get(3).name, result.get(4).name].sort();
			const expected = [localDisabledTheme.manifest.name, localEnabledTheme.manifest.name, localRandom.manifest.name, localDisabledLanguage.manifest.name, localEnabledLanguage.manifest.name];
			for (let i = 0; i < result.length; i++) {
				assert.strictEqual(actual[i], expected[i], 'Unexpected extension for @installed query.');
			}
		});

		await testableView.show('@installed first').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @installed query');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with search text.');
			assert.strictEqual(result.get(1).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with search text.');
		});

		await testableView.show('@disabled').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @disabled query');
			assert.strictEqual(result.get(0).name, localDisabledTheme.manifest.name, 'Unexpected extension for @disabled query.');
			assert.strictEqual(result.get(1).name, localDisabledLanguage.manifest.name, 'Unexpected extension for @disabled query.');
		});

		await testableView.show('@enabled').then(result => {
			assert.strictEqual(result.length, 3, 'Unexpected number of results for @enabled query');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @enabled query.');
			assert.strictEqual(result.get(1).name, localRandom.manifest.name, 'Unexpected extension for @enabled query.');
			assert.strictEqual(result.get(2).name, localEnabledLanguage.manifest.name, 'Unexpected extension for @enabled query.');
		});

		await testableView.show('@builtin:themes').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @builtin:themes query');
			assert.strictEqual(result.get(0).name, builtInTheme.manifest.name, 'Unexpected extension for @builtin:themes query.');
		});

		await testableView.show('@builtin:basics').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @builtin:basics query');
			assert.strictEqual(result.get(0).name, builtInBasic.manifest.name, 'Unexpected extension for @builtin:basics query.');
		});

		await testableView.show('@builtin').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @builtin query');
			assert.strictEqual(result.get(0).name, builtInBasic.manifest.name, 'Unexpected extension for @builtin query.');
			assert.strictEqual(result.get(1).name, builtInTheme.manifest.name, 'Unexpected extension for @builtin query.');
		});

		await testableView.show('@builtin my-theme').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @builtin query');
			assert.strictEqual(result.get(0).name, builtInTheme.manifest.name, 'Unexpected extension for @builtin query.');
		});
	});

	test('Test installed query with category', async () => {
		await testableView.show('@installed category:themes').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @installed query with category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with category.');
			assert.strictEqual(result.get(1).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with category.');
		});

		await testableView.show('@installed category:"themes"').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @installed query with quoted category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with quoted category.');
			assert.strictEqual(result.get(1).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with quoted category.');
		});

		await testableView.show('@installed category:"programming languages"').then(result => {
			assert.strictEqual(result.length, 2, 'Unexpected number of results for @installed query with quoted category including space');
			assert.strictEqual(result.get(0).name, localEnabledLanguage.manifest.name, 'Unexpected extension for @installed query with quoted category including space.');
			assert.strictEqual(result.get(1).name, localDisabledLanguage.manifest.name, 'Unexpected extension for @installed query with quoted category inlcuding space.');
		});

		await testableView.show('@installed category:themes category:random').then(result => {
			assert.strictEqual(result.length, 3, 'Unexpected number of results for @installed query with multiple category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @installed query with multiple category.');
			assert.strictEqual(result.get(1).name, localRandom.manifest.name, 'Unexpected extension for @installed query with multiple category.');
			assert.strictEqual(result.get(2).name, localDisabledTheme.manifest.name, 'Unexpected extension for @installed query with multiple category.');
		});

		await testableView.show('@enabled category:themes').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @enabled query with category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @enabled query with category.');
		});

		await testableView.show('@enabled category:"themes"').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @enabled query with quoted category');
			assert.strictEqual(result.get(0).name, localEnabledTheme.manifest.name, 'Unexpected extension for @enabled query with quoted category.');
		});

		await testableView.show('@enabled category:"programming languages"').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @enabled query with quoted category inlcuding space');
			assert.strictEqual(result.get(0).name, localEnabledLanguage.manifest.name, 'Unexpected extension for @enabled query with quoted category including space.');
		});

		await testableView.show('@disabled category:themes').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @disabled query with category');
			assert.strictEqual(result.get(0).name, localDisabledTheme.manifest.name, 'Unexpected extension for @disabled query with category.');
		});

		await testableView.show('@disabled category:"themes"').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @disabled query with quoted category');
			assert.strictEqual(result.get(0).name, localDisabledTheme.manifest.name, 'Unexpected extension for @disabled query with quoted category.');
		});

		await testableView.show('@disabled category:"programming languages"').then(result => {
			assert.strictEqual(result.length, 1, 'Unexpected number of results for @disabled query with quoted category inlcuding space');
			assert.strictEqual(result.get(0).name, localDisabledLanguage.manifest.name, 'Unexpected extension for @disabled query with quoted category including space.');
		});
	});

	test('Test @recommended:workspace query', () => {
		const workspaceRecommendedExtensions = [
			workspaceRecommendationA,
			workspaceRecommendationB,
			configBasedRecommendationA,
		];
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...workspaceRecommendedExtensions));

		return testableView.show('@recommended:workspace').then(result => {
			assert.ok(target.calledOnce);
			const options: IQueryOptions = target.args[0][0];
			assert.strictEqual(options.names!.length, workspaceRecommendedExtensions.length);
			assert.strictEqual(result.length, workspaceRecommendedExtensions.length);
			for (let i = 0; i < workspaceRecommendedExtensions.length; i++) {
				assert.strictEqual(options.names![i], workspaceRecommendedExtensions[i].identifier.id);
				assert.strictEqual(result.get(i).identifier.id, workspaceRecommendedExtensions[i].identifier.id);
			}
		});
	});

	test('Test @recommended query', () => {
		const allRecommendedExtensions = [
			fileBasedRecommendationA,
			fileBasedRecommendationB,
			configBasedRecommendationB,
			otherRecommendationA
		];
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...allRecommendedExtensions));

		return testableView.show('@recommended').then(result => {
			const options: IQueryOptions = target.args[0][0];

			assert.ok(target.calledOnce);
			assert.strictEqual(options.names!.length, allRecommendedExtensions.length);
			assert.strictEqual(result.length, allRecommendedExtensions.length);
			for (let i = 0; i < allRecommendedExtensions.length; i++) {
				assert.strictEqual(options.names![i], allRecommendedExtensions[i].identifier.id);
				assert.strictEqual(result.get(i).identifier.id, allRecommendedExtensions[i].identifier.id);
			}
		});
	});


	test('Test @recommended:all query', () => {
		const allRecommendedExtensions = [
			workspaceRecommendationA,
			workspaceRecommendationB,
			configBasedRecommendationA,
			fileBasedRecommendationA,
			fileBasedRecommendationB,
			configBasedRecommendationB,
			otherRecommendationA,
		];
		const target = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...allRecommendedExtensions));

		return testableView.show('@recommended:all').then(result => {
			const options: IQueryOptions = target.args[0][0];

			assert.ok(target.calledOnce);
			assert.strictEqual(options.names!.length, allRecommendedExtensions.length);
			assert.strictEqual(result.length, allRecommendedExtensions.length);
			for (let i = 0; i < allRecommendedExtensions.length; i++) {
				assert.strictEqual(options.names![i], allRecommendedExtensions[i].identifier.id);
				assert.strictEqual(result.get(i).identifier.id, allRecommendedExtensions[i].identifier.id);
			}
		});
	});

	test('Test curated list experiment', () => {
		const curatedList = [
			workspaceRecommendationA,
			fileBasedRecommendationA
		];
		const experimentTarget = <SinonStub>instantiationService.stubPromise(IExperimentService, 'getCuratedExtensionsList', curatedList.map(e => e.identifier.id));
		const queryTarget = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...curatedList));

		return testableView.show('curated:mykey').then(result => {
			const curatedKey: string = experimentTarget.args[0][0];
			const options: IQueryOptions = queryTarget.args[0][0];

			assert.ok(experimentTarget.calledOnce);
			assert.ok(queryTarget.calledOnce);
			assert.strictEqual(options.names!.length, curatedList.length);
			assert.strictEqual(result.length, curatedList.length);
			for (let i = 0; i < curatedList.length; i++) {
				assert.strictEqual(options.names![i], curatedList[i].identifier.id);
				assert.strictEqual(result.get(i).identifier.id, curatedList[i].identifier.id);
			}
			assert.strictEqual(curatedKey, 'mykey');
		});
	});

	test('Test search', () => {
		const searchText = 'search-me';
		const results = [
			fileBasedRecommendationA,
			workspaceRecommendationA,
			otherRecommendationA,
			workspaceRecommendationB
		];
		const queryTarget = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...results));
		return testableView.show('search-me').then(result => {
			const options: IQueryOptions = queryTarget.args[0][0];

			assert.ok(queryTarget.calledOnce);
			assert.strictEqual(options.text, searchText);
			assert.strictEqual(result.length, results.length);
			for (let i = 0; i < results.length; i++) {
				assert.strictEqual(result.get(i).identifier.id, results[i].identifier.id);
			}
		});
	});

	test('Test preferred search experiment', () => {
		const searchText = 'search-me';
		const actual = [
			fileBasedRecommendationA,
			workspaceRecommendationA,
			otherRecommendationA,
			workspaceRecommendationB
		];
		const expected = [
			workspaceRecommendationA,
			workspaceRecommendationB,
			fileBasedRecommendationA,
			otherRecommendationA
		];

		const queryTarget = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...actual));
		const experimentTarget = <SinonStub>instantiationService.stubPromise(IExperimentService, 'getExperimentsByType', [{
			id: 'someId',
			enabled: true,
			state: ExperimentState.Run,
			action: {
				type: ExperimentActionType.ExtensionSearchResults,
				properties: {
					searchText: 'search-me',
					preferredResults: [
						workspaceRecommendationA.identifier.id,
						'something-that-wasnt-in-first-page',
						workspaceRecommendationB.identifier.id
					]
				}
			}
		}]);

		testableView.dispose();
		testableView = instantiationService.createInstance(ExtensionsListView, {}, {});

		return testableView.show('search-me').then(result => {
			const options: IQueryOptions = queryTarget.args[0][0];

			assert.ok(experimentTarget.calledOnce);
			assert.ok(queryTarget.calledOnce);
			assert.strictEqual(options.text, searchText);
			assert.strictEqual(result.length, expected.length);
			for (let i = 0; i < expected.length; i++) {
				assert.strictEqual(result.get(i).identifier.id, expected[i].identifier.id);
			}
		});
	});

	test('Skip preferred search experiment when user defines sort order', () => {
		const searchText = 'search-me';
		const realResults = [
			fileBasedRecommendationA,
			workspaceRecommendationA,
			otherRecommendationA,
			workspaceRecommendationB
		];

		const queryTarget = <SinonStub>instantiationService.stubPromise(IExtensionGalleryService, 'query', aPage(...realResults));

		testableView.dispose();
		testableView = instantiationService.createInstance(ExtensionsListView, {}, {});

		return testableView.show('search-me @sort:installs').then(result => {
			const options: IQueryOptions = queryTarget.args[0][0];

			assert.ok(queryTarget.calledOnce);
			assert.strictEqual(options.text, searchText);
			assert.strictEqual(result.length, realResults.length);
			for (let i = 0; i < realResults.length; i++) {
				assert.strictEqual(result.get(i).identifier.id, realResults[i].identifier.id);
			}
		});
	});

	function aLocalExtension(name: string = 'someext', manifest: any = {}, properties: any = {}): ILocalExtension {
		manifest = { name, publisher: 'pub', version: '1.0.0', ...manifest };
		properties = {
			type: ExtensionType.User,
			location: URI.file(`pub.${name}`),
			identifier: { id: getGalleryExtensionId(manifest.publisher, manifest.name) },
			metadata: { id: getGalleryExtensionId(manifest.publisher, manifest.name), publisherId: manifest.publisher, publisherDisplayName: 'somename' },
			...properties
		};
		properties.isBuiltin = properties.type === ExtensionType.System;
		return <ILocalExtension>Object.create({ manifest, ...properties });
	}

	function aGalleryExtension(name: string, properties: any = {}, galleryExtensionProperties: any = {}, assets: any = {}): IGalleryExtension {
		const galleryExtension = <IGalleryExtension>Object.create({ name, publisher: 'pub', version: '1.0.0', properties: {}, assets: {}, ...properties });
		galleryExtension.properties = { ...galleryExtension.properties, dependencies: [], ...galleryExtensionProperties };
		galleryExtension.assets = { ...galleryExtension.assets, ...assets };
		galleryExtension.identifier = { id: getGalleryExtensionId(galleryExtension.publisher, galleryExtension.name), uuid: generateUuid() };
		return <IGalleryExtension>galleryExtension;
	}

	function aPage<T>(...objects: T[]): IPager<T> {
		return { firstPage: objects, total: objects.length, pageSize: objects.length, getPage: () => null! };
	}

});

