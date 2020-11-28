/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sha1Hex } from 'vs/base/browser/hash';
import { IFileService, IResolveFileResult, IFileStat } from 'vs/platform/files/common/files';
import { IWorkspaceContextService, WorkbenchState, IWorkspace } from 'vs/platform/workspace/common/workspace';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ITextFileService, ITextFileContent } from 'vs/workbench/services/textfile/common/textfiles';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWorkspaceTagsService, Tags } from 'vs/workbench/contrib/tags/common/workspaceTags';
import { getHashedRemotesFromConfig } from 'vs/workbench/contrib/tags/electron-browser/workspaceTags';
import { IProductService } from 'vs/platform/product/common/productService';
import { splitLines } from 'vs/base/common/strings';

const MetaModulesToLookFor = [
	// Azure packages
	'@azure',
	'@azure/ai',
	'@azure/core',
	'@azure/cosmos',
	'@azure/event',
	'@azure/identity',
	'@azure/keyvault',
	'@azure/search',
	'@azure/storage'
];

const ModulesToLookFor = [
	// Packages that suggest a node server
	'express',
	'sails',
	'koa',
	'hapi',
	'socket.io',
	'restify',
	// JS frameworks
	'react',
	'react-native',
	'react-native-macos',
	'react-native-windows',
	'rnpm-plugin-windows',
	'@angular/core',
	'@ionic',
	'vue',
	'tns-core-modules',
	'electron',
	// Other interesting packages
	'aws-sdk',
	'aws-amplify',
	'azure',
	'azure-storage',
	'firebase',
	'@google-cloud/common',
	'heroku-cli',
	// Office and Sharepoint packages
	'@microsoft/teams-js',
	'@microsoft/office-js',
	'@microsoft/office-js-helpers',
	'@types/office-js',
	'@types/office-runtime',
	'office-ui-fabric-react',
	'@uifabric/icons',
	'@uifabric/merge-styles',
	'@uifabric/styling',
	'@uifabric/experiments',
	'@uifabric/utilities',
	'@microsoft/rush',
	'lerna',
	'just-task',
	'beachball',
	// Playwright packages
	'playwright',
	'playwright-cli',
	'@playwright/test',
	'playwright-core',
	'playwright-chromium',
	'playwright-firefox',
	'playwright-webkit'
];

const PyMetaModulesToLookFor = [
	'azure-ai',
	'azure-cognitiveservices',
	'azure-core',
	'azure-cosmos',
	'azure-event',
	'azure-identity',
	'azure-keyvault',
	'azure-mgmt',
	'azure-ml',
	'azure-search',
	'azure-storage'
];

const PyModulesToLookFor = [
	'azure',
	'azure-devtools',
	'azure-elasticluster',
	'azure-eventgrid',
	'azure-functions',
	'azure-graphrbac',
	'azure-iothub-device-client',
	'azure-loganalytics',
	'azure-monitor',
	'azure-servicebus',
	'azure-servicefabric',
	'azure-shell',
	'azure-translator',
	'adal',
	'pydocumentdb',
	'botbuilder-core',
	'botbuilder-schema',
	'botframework-connector',
	'playwright'
];

export class WorkspaceTagsService implements IWorkspaceTagsService {
	declare readonly _serviceBrand: undefined;
	private _tags: Tags | undefined;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IProductService private readonly productService: IProductService,
		@ITextFileService private readonly textFileService: ITextFileService
	) { }

	async getTags(): Promise<Tags> {
		if (!this._tags) {
			this._tags = await this.resolveWorkspaceTags();
		}

		return this._tags;
	}

	async getTelemetryWorkspaceId(workspace: IWorkspace, state: WorkbenchState): Promise<string | undefined> {
		function createHash(uri: URI): Promise<string> {
			return sha1Hex(uri.scheme === Schemas.file ? uri.fsPath : uri.toString());
		}

		let workspaceId: string | undefined;
		switch (state) {
			case WorkbenchState.EMPTY:
				workspaceId = undefined;
				break;
			case WorkbenchState.FOLDER:
				workspaceId = await createHash(workspace.folders[0].uri);
				break;
			case WorkbenchState.WORKSPACE:
				if (workspace.configuration) {
					workspaceId = await createHash(workspace.configuration);
				}
		}

		return workspaceId;
	}

	getHashedRemotesFromUri(workspaceUri: URI, stripEndingDotGit: boolean = false): Promise<string[]> {
		const path = workspaceUri.path;
		const uri = workspaceUri.with({ path: `${path !== '/' ? path : ''}/.git/config` });
		return this.fileService.exists(uri).then(exists => {
			if (!exists) {
				return [];
			}
			return this.textFileService.read(uri, { acceptTextOnly: true }).then(
				content => getHashedRemotesFromConfig(content.value, stripEndingDotGit),
				err => [] // ignore missing or binary file
			);
		});
	}

	/* __GDPR__FRAGMENT__
		"WorkspaceTags" : {
			"workbench.filesToOpenOrCreate" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workbench.filesToDiff" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.id" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
			"workspace.roots" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.empty" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.grunt" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.gulp" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.jake" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.tsconfig" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.jsconfig" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.config.xml" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.vsc.extension" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.asp<NUMBER>" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.sln" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.unity" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.express" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.sails" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.koa" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.hapi" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.socket.io" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.restify" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.rnpm-plugin-windows" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.react" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@angular/core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.vue" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.aws-sdk" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.aws-amplify-sdk" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@azure/ai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@azure/core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@azure/cosmos" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@azure/event" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@azure/identity" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@azure/keyvault" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@azure/search" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@azure/storage" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.azure-storage" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@google-cloud/common" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.firebase" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.heroku-cli" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/teams-js" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/office-js" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/office-js-helpers" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/office-js" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@types/office-runtime" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.office-ui-fabric-react" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/icons" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/merge-styles" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/styling" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/experiments" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@uifabric/utilities" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@microsoft/rush" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.lerna" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.just-task" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.beachball" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.electron" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-cli" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.@playwright/test" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-chromium" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-firefox" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.playwright-webkit" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.react-native-macos" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.npm.react-native-windows" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.bower" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.yeoman.code.ext" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.cordova.high" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.cordova.low" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.xamarin.android" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.xamarin.ios" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.android.cpp" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.reactNative" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.ionic" : { "classification" : "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": "true" },
			"workspace.nativeScript" : { "classification" : "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": "true" },
			"workspace.java.pom" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.requirements" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.requirements.star" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.Pipfile" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.conda" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.any-azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.pulumi-azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-ai" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-cognitiveservices" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-cosmos" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-devtools" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-elasticluster" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-event" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-eventgrid" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-functions" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-graphrbac" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-identity" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-iothub-device-client" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-keyvault" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-loganalytics" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-mgmt" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-ml" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-monitor" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-search" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-servicebus" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-servicefabric" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-shell" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-storage" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.azure-translator" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.adal" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.pydocumentdb" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.botbuilder-core" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.botbuilder-schema" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.botframework-connector" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
			"workspace.py.playwright" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
		}
	*/
	private async resolveWorkspaceTags(): Promise<Tags> {
		const tags: Tags = Object.create(null);

		const state = this.contextService.getWorkbenchState();
		const workspace = this.contextService.getWorkspace();

		tags['workspace.id'] = await this.getTelemetryWorkspaceId(workspace, state);

		const { filesToOpenOrCreate, filesToDiff } = this.environmentService.configuration;
		tags['workbench.filesToOpenOrCreate'] = filesToOpenOrCreate && filesToOpenOrCreate.length || 0;
		tags['workbench.filesToDiff'] = filesToDiff && filesToDiff.length || 0;

		const isEmpty = state === WorkbenchState.EMPTY;
		tags['workspace.roots'] = isEmpty ? 0 : workspace.folders.length;
		tags['workspace.empty'] = isEmpty;

		const folders = !isEmpty ? workspace.folders.map(folder => folder.uri) : this.productService.quality !== 'stable' && this.findFolders();
		if (!folders || !folders.length) {
			return Promise.resolve(tags);
		}

		return this.fileService.resolveAll(folders.map(resource => ({ resource }))).then((files: IResolveFileResult[]) => {
			const names = (<IFileStat[]>[]).concat(...files.map(result => result.success ? (result.stat!.children || []) : [])).map(c => c.name);
			const nameSet = names.reduce((s, n) => s.add(n.toLowerCase()), new Set());

			tags['workspace.grunt'] = nameSet.has('gruntfile.js');
			tags['workspace.gulp'] = nameSet.has('gulpfile.js');
			tags['workspace.jake'] = nameSet.has('jakefile.js');

			tags['workspace.tsconfig'] = nameSet.has('tsconfig.json');
			tags['workspace.jsconfig'] = nameSet.has('jsconfig.json');
			tags['workspace.config.xml'] = nameSet.has('config.xml');
			tags['workspace.vsc.extension'] = nameSet.has('vsc-extension-quickstart.md');

			tags['workspace.ASP5'] = nameSet.has('project.json') && this.searchArray(names, /^.+\.cs$/i);
			tags['workspace.sln'] = this.searchArray(names, /^.+\.sln$|^.+\.csproj$/i);
			tags['workspace.unity'] = nameSet.has('assets') && nameSet.has('library') && nameSet.has('projectsettings');
			tags['workspace.npm'] = nameSet.has('package.json') || nameSet.has('node_modules');
			tags['workspace.bower'] = nameSet.has('bower.json') || nameSet.has('bower_components');

			tags['workspace.java.pom'] = nameSet.has('pom.xml');

			tags['workspace.yeoman.code.ext'] = nameSet.has('vsc-extension-quickstart.md');

			tags['workspace.py.requirements'] = nameSet.has('requirements.txt');
			tags['workspace.py.requirements.star'] = this.searchArray(names, /^(.*)requirements(.*)\.txt$/i);
			tags['workspace.py.Pipfile'] = nameSet.has('pipfile');
			tags['workspace.py.conda'] = this.searchArray(names, /^environment(\.yml$|\.yaml$)/i);

			const mainActivity = nameSet.has('mainactivity.cs') || nameSet.has('mainactivity.fs');
			const appDelegate = nameSet.has('appdelegate.cs') || nameSet.has('appdelegate.fs');
			const androidManifest = nameSet.has('androidmanifest.xml');

			const platforms = nameSet.has('platforms');
			const plugins = nameSet.has('plugins');
			const www = nameSet.has('www');
			const properties = nameSet.has('properties');
			const resources = nameSet.has('resources');
			const jni = nameSet.has('jni');

			if (tags['workspace.config.xml'] &&
				!tags['workspace.language.cs'] && !tags['workspace.language.vb'] && !tags['workspace.language.aspx']) {
				if (platforms && plugins && www) {
					tags['workspace.cordova.high'] = true;
				} else {
					tags['workspace.cordova.low'] = true;
				}
			}

			if (tags['workspace.config.xml'] &&
				!tags['workspace.language.cs'] && !tags['workspace.language.vb'] && !tags['workspace.language.aspx']) {

				if (nameSet.has('ionic.config.json')) {
					tags['workspace.ionic'] = true;
				}
			}

			if (mainActivity && properties && resources) {
				tags['workspace.xamarin.android'] = true;
			}

			if (appDelegate && resources) {
				tags['workspace.xamarin.ios'] = true;
			}

			if (androidManifest && jni) {
				tags['workspace.android.cpp'] = true;
			}

			function getFilePromises(filename: string, fileService: IFileService, textFileService: ITextFileService, contentHandler: (content: ITextFileContent) => void): Promise<void>[] {
				return !nameSet.has(filename) ? [] : (folders as URI[]).map(workspaceUri => {
					const uri = workspaceUri.with({ path: `${workspaceUri.path !== '/' ? workspaceUri.path : ''}/${filename}` });
					return fileService.exists(uri).then(exists => {
						if (!exists) {
							return undefined;
						}

						return textFileService.read(uri, { acceptTextOnly: true }).then(contentHandler);
					}, err => {
						// Ignore missing file
					});
				});
			}

			function addPythonTags(packageName: string): void {
				if (PyModulesToLookFor.indexOf(packageName) > -1) {
					tags['workspace.py.' + packageName] = true;
				}

				for (const metaModule of PyMetaModulesToLookFor) {
					if (packageName.startsWith(metaModule)) {
						tags['workspace.py.' + metaModule] = true;
					}
				}

				if (!tags['workspace.py.any-azure']) {
					tags['workspace.py.any-azure'] = /azure/i.test(packageName);
				}
			}

			const requirementsTxtPromises = getFilePromises('requirements.txt', this.fileService, this.textFileService, content => {
				const dependencies: string[] = splitLines(content.value);
				for (let dependency of dependencies) {
					// Dependencies in requirements.txt can have 3 formats: `foo==3.1, foo>=3.1, foo`
					const format1 = dependency.split('==');
					const format2 = dependency.split('>=');
					const packageName = (format1.length === 2 ? format1[0] : format2[0]).trim();
					addPythonTags(packageName);
				}
			});

			const pipfilePromises = getFilePromises('pipfile', this.fileService, this.textFileService, content => {
				let dependencies: string[] = splitLines(content.value);

				// We're only interested in the '[packages]' section of the Pipfile
				dependencies = dependencies.slice(dependencies.indexOf('[packages]') + 1);

				for (let dependency of dependencies) {
					if (dependency.trim().indexOf('[') > -1) {
						break;
					}
					// All dependencies in Pipfiles follow the format: `<package> = <version, or git repo, or something else>`
					if (dependency.indexOf('=') === -1) {
						continue;
					}
					const packageName = dependency.split('=')[0].trim();
					addPythonTags(packageName);
				}

			});

			const packageJsonPromises = getFilePromises('package.json', this.fileService, this.textFileService, content => {
				try {
					const packageJsonContents = JSON.parse(content.value);
					let dependencies = Object.keys(packageJsonContents['dependencies'] || {}).concat(Object.keys(packageJsonContents['devDependencies'] || {}));

					for (let dependency of dependencies) {
						if ('react-native' === dependency) {
							tags['workspace.reactNative'] = true;
						} else if ('tns-core-modules' === dependency) {
							tags['workspace.nativescript'] = true;
						} else if (ModulesToLookFor.indexOf(dependency) > -1) {
							tags['workspace.npm.' + dependency] = true;
						} else {
							for (const metaModule of MetaModulesToLookFor) {
								if (dependency.startsWith(metaModule)) {
									tags['workspace.npm.' + metaModule] = true;
								}
							}
						}
					}
				}
				catch (e) {
					// Ignore errors when resolving file or parsing file contents
				}
			});
			return Promise.all([...packageJsonPromises, ...requirementsTxtPromises, ...pipfilePromises]).then(() => tags);
		});
	}

	private findFolders(): URI[] | undefined {
		const folder = this.findFolder();
		return folder && [folder];
	}

	private findFolder(): URI | undefined {
		const { filesToOpenOrCreate, filesToDiff } = this.environmentService.configuration;
		if (filesToOpenOrCreate && filesToOpenOrCreate.length) {
			return this.parentURI(filesToOpenOrCreate[0].fileUri);
		} else if (filesToDiff && filesToDiff.length) {
			return this.parentURI(filesToDiff[0].fileUri);
		}
		return undefined;
	}

	private parentURI(uri: URI | undefined): URI | undefined {
		if (!uri) {
			return undefined;
		}
		const path = uri.path;
		const i = path.lastIndexOf('/');
		return i !== -1 ? uri.with({ path: path.substr(0, i) }) : undefined;
	}

	private searchArray(arr: string[], regEx: RegExp): boolean | undefined {
		return arr.some(v => v.search(regEx) > -1) || undefined;
	}
}

registerSingleton(IWorkspaceTagsService, WorkspaceTagsService, true);
