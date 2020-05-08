/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as semver from 'semver-umd';
import { Event, Emitter } from 'vs/base/common/event';
import { index, distinct } from 'vs/base/common/arrays';
import { ThrottledDelayer } from 'vs/base/common/async';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { Disposable } from 'vs/base/common/lifecycle';
import { IPager, mapPager, singlePagePager } from 'vs/base/common/paging';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import {
	IExtensionManagementService, IExtensionGalleryService, ILocalExtension, IGalleryExtension, IQueryOptions,
	InstallExtensionEvent, DidInstallExtensionEvent, DidUninstallExtensionEvent, IExtensionIdentifier, InstallOperation, DefaultIconPath
} from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkbenchExtensionEnablementService, EnablementState, IExtensionManagementServerService, IExtensionManagementServer } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { getGalleryExtensionTelemetryData, getLocalExtensionTelemetryData, areSameExtensions, getMaliciousExtensionsSet, groupByExtension, ExtensionIdentifierWithVersion } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { URI } from 'vs/base/common/uri';
import { IExtension, ExtensionState, IExtensionsWorkbenchService, AutoUpdateConfigurationKey, AutoCheckUpdatesConfigurationKey } from 'vs/workbench/contrib/extensions/common/extensions';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IURLService, IURLHandler, IOpenURLOptions } from 'vs/platform/url/common/url';
import { ExtensionsInput } from 'vs/workbench/contrib/extensions/common/extensionsInput';
import { ILogService } from 'vs/platform/log/common/log';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { INotificationService } from 'vs/platform/notification/common/notification';
import * as resources from 'vs/base/common/resources';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IFileService } from 'vs/platform/files/common/files';
import { IExtensionManifest, ExtensionType, IExtension as IPlatformExtension, isLanguagePackExtension } from 'vs/platform/extensions/common/extensions';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IProductService } from 'vs/platform/product/common/productService';
import { asDomUri } from 'vs/base/browser/dom';

interface IExtensionStateProvider<T> {
	(extension: Extension): T;
}

class Extension implements IExtension {

	public enablementState: EnablementState = EnablementState.EnabledGlobally;

	constructor(
		private stateProvider: IExtensionStateProvider<ExtensionState>,
		public readonly server: IExtensionManagementServer | undefined,
		public local: ILocalExtension | undefined,
		public gallery: IGalleryExtension | undefined,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IProductService private readonly productService: IProductService
	) { }

	get type(): ExtensionType {
		return this.local ? this.local.type : ExtensionType.User;
	}

	get name(): string {
		return this.gallery ? this.gallery.name : this.local!.manifest.name;
	}

	get displayName(): string {
		if (this.gallery) {
			return this.gallery.displayName || this.gallery.name;
		}

		return this.local!.manifest.displayName || this.local!.manifest.name;
	}

	get identifier(): IExtensionIdentifier {
		if (this.gallery) {
			return this.gallery.identifier;
		}
		return this.local!.identifier;
	}

	get uuid(): string | undefined {
		return this.gallery ? this.gallery.identifier.uuid : this.local!.identifier.uuid;
	}

	get publisher(): string {
		return this.gallery ? this.gallery.publisher : this.local!.manifest.publisher;
	}

	get publisherDisplayName(): string {
		if (this.gallery) {
			return this.gallery.publisherDisplayName || this.gallery.publisher;
		}

		if (this.local!.metadata && this.local!.metadata.publisherDisplayName) {
			return this.local!.metadata.publisherDisplayName;
		}

		return this.local!.manifest.publisher;
	}

	get version(): string {
		return this.local ? this.local.manifest.version : this.latestVersion;
	}

	get latestVersion(): string {
		return this.gallery ? this.gallery.version : this.local!.manifest.version;
	}

	get description(): string {
		return this.gallery ? this.gallery.description : this.local!.manifest.description || '';
	}

	get url(): string | undefined {
		if (!this.productService.extensionsGallery || !this.gallery) {
			return undefined;
		}

		return `${this.productService.extensionsGallery.itemUrl}?itemName=${this.publisher}.${this.name}`;
	}

	get iconUrl(): string {
		return this.galleryIconUrl || this.localIconUrl || this.defaultIconUrl;
	}

	get iconUrlFallback(): string {
		return this.galleryIconUrlFallback || this.localIconUrl || this.defaultIconUrl;
	}

	private get localIconUrl(): string | null {
		if (this.local && this.local.manifest.icon) {
			return asDomUri(resources.joinPath(this.local.location, this.local.manifest.icon)).toString(true);
		}
		return null;
	}

	private get galleryIconUrl(): string | null {
		return this.gallery ? this.gallery.assets.icon.uri : null;
	}

	private get galleryIconUrlFallback(): string | null {
		return this.gallery ? this.gallery.assets.icon.fallbackUri : null;
	}

	private get defaultIconUrl(): string {
		if (this.type === ExtensionType.System && this.local) {
			if (this.local.manifest && this.local.manifest.contributes) {
				if (Array.isArray(this.local.manifest.contributes.themes) && this.local.manifest.contributes.themes.length) {
					return require.toUrl('./media/theme-icon.png');
				}
				if (Array.isArray(this.local.manifest.contributes.grammars) && this.local.manifest.contributes.grammars.length) {
					return require.toUrl('./media/language-icon.svg');
				}
			}
		}
		return DefaultIconPath;
	}

	get repository(): string | undefined {
		return this.gallery && this.gallery.assets.repository ? this.gallery.assets.repository.uri : undefined;
	}

	get licenseUrl(): string | undefined {
		return this.gallery && this.gallery.assets.license ? this.gallery.assets.license.uri : undefined;
	}

	get state(): ExtensionState {
		return this.stateProvider(this);
	}

	public isMalicious: boolean = false;

	get installCount(): number | undefined {
		return this.gallery ? this.gallery.installCount : undefined;
	}

	get rating(): number | undefined {
		return this.gallery ? this.gallery.rating : undefined;
	}

	get ratingCount(): number | undefined {
		return this.gallery ? this.gallery.ratingCount : undefined;
	}

	get outdated(): boolean {
		return !!this.gallery && this.type === ExtensionType.User && semver.gt(this.latestVersion, this.version);
	}

	get telemetryData(): any {
		const { local, gallery } = this;

		if (gallery) {
			return getGalleryExtensionTelemetryData(gallery);
		} else {
			return getLocalExtensionTelemetryData(local!);
		}
	}

	get preview(): boolean {
		return this.gallery ? this.gallery.preview : false;
	}

	private isGalleryOutdated(): boolean {
		return this.local && this.gallery ? semver.gt(this.local.manifest.version, this.gallery.version) : false;
	}

	getManifest(token: CancellationToken): Promise<IExtensionManifest | null> {
		if (this.gallery && !this.isGalleryOutdated()) {
			if (this.gallery.assets.manifest) {
				return this.galleryService.getManifest(this.gallery, token);
			}
			this.logService.error(nls.localize('Manifest is not found', "Manifest is not found"), this.identifier.id);
			return Promise.resolve(null);
		}

		return Promise.resolve(this.local!.manifest);
	}

	hasReadme(): boolean {
		if (this.gallery && !this.isGalleryOutdated() && this.gallery.assets.readme) {
			return true;
		}

		if (this.local && this.local.readmeUrl) {
			return true;
		}

		return this.type === ExtensionType.System;
	}

	getReadme(token: CancellationToken): Promise<string> {
		if (this.gallery && !this.isGalleryOutdated()) {
			if (this.gallery.assets.readme) {
				return this.galleryService.getReadme(this.gallery, token);
			}
			this.telemetryService.publicLog('extensions:NotFoundReadMe', this.telemetryData);
		}

		if (this.local && this.local.readmeUrl) {
			return this.fileService.readFile(this.local.readmeUrl).then(content => content.value.toString());
		}

		if (this.type === ExtensionType.System) {
			return Promise.resolve(`# ${this.displayName || this.name}
**Notice:** This extension is bundled with Visual Studio Code. It can be disabled but not uninstalled.
## Features
${this.description}
`);
		}

		return Promise.reject(new Error('not available'));
	}

	hasChangelog(): boolean {
		if (this.gallery && this.gallery.assets.changelog && !this.isGalleryOutdated()) {
			return true;
		}

		if (this.local && this.local.changelogUrl) {
			return true;
		}

		return this.type === ExtensionType.System;
	}

	getChangelog(token: CancellationToken): Promise<string> {
		if (this.gallery && this.gallery.assets.changelog && !this.isGalleryOutdated()) {
			return this.galleryService.getChangelog(this.gallery, token);
		}

		const changelogUrl = this.local && this.local.changelogUrl;

		if (!changelogUrl) {
			if (this.type === ExtensionType.System) {
				return Promise.resolve('Please check the [VS Code Release Notes](command:update.showCurrentReleaseNotes) for changes to the built-in extensions.');
			}

			return Promise.reject(new Error('not available'));
		}

		return this.fileService.readFile(changelogUrl).then(content => content.value.toString());
	}

	get dependencies(): string[] {
		const { local, gallery } = this;
		if (gallery && !this.isGalleryOutdated()) {
			return gallery.properties.dependencies || [];
		}
		if (local && local.manifest.extensionDependencies) {
			return local.manifest.extensionDependencies;
		}
		return [];
	}

	get extensionPack(): string[] {
		const { local, gallery } = this;
		if (gallery && !this.isGalleryOutdated()) {
			return gallery.properties.extensionPack || [];
		}
		if (local && local.manifest.extensionPack) {
			return local.manifest.extensionPack;
		}
		return [];
	}
}

class Extensions extends Disposable {

	private readonly _onChange: Emitter<{ extension: Extension, operation?: InstallOperation } | undefined> = this._register(new Emitter<{ extension: Extension, operation?: InstallOperation } | undefined>());
	get onChange(): Event<{ extension: Extension, operation?: InstallOperation } | undefined> { return this._onChange.event; }

	private installing: Extension[] = [];
	private uninstalling: Extension[] = [];
	private installed: Extension[] = [];

	constructor(
		private readonly server: IExtensionManagementServer,
		private readonly stateProvider: IExtensionStateProvider<ExtensionState>,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this._register(server.extensionManagementService.onInstallExtension(e => this.onInstallExtension(e)));
		this._register(server.extensionManagementService.onDidInstallExtension(e => this.onDidInstallExtension(e)));
		this._register(server.extensionManagementService.onUninstallExtension(e => this.onUninstallExtension(e)));
		this._register(server.extensionManagementService.onDidUninstallExtension(e => this.onDidUninstallExtension(e)));
		this._register(extensionEnablementService.onEnablementChanged(e => this.onEnablementChanged(e)));
	}

	get local(): IExtension[] {
		const installing = this.installing
			.filter(e => !this.installed.some(installed => areSameExtensions(installed.identifier, e.identifier)))
			.map(e => e);

		return [...this.installed, ...installing];
	}

	async queryInstalled(): Promise<IExtension[]> {
		const installed = await this.server.extensionManagementService.getInstalled();
		const byId = index(this.installed, e => e.local ? e.local.identifier.id : e.identifier.id);
		this.installed = installed.map(local => {
			const extension = byId[local.identifier.id] || this.instantiationService.createInstance(Extension, this.stateProvider, this.server, local, undefined);
			extension.local = local;
			extension.enablementState = this.extensionEnablementService.getEnablementState(local);
			return extension;
		});
		this._onChange.fire(undefined);
		return this.local;
	}

	async syncLocalWithGalleryExtension(gallery: IGalleryExtension, maliciousExtensionSet: Set<string>): Promise<boolean> {
		const extension = this.getInstalledExtensionMatchingGallery(gallery);
		if (!extension) {
			return false;
		}
		if (maliciousExtensionSet.has(extension.identifier.id)) {
			extension.isMalicious = true;
		}
		// Loading the compatible version only there is an engine property
		// Otherwise falling back to old way so that we will not make many roundtrips
		const compatible = gallery.properties.engine ? await this.galleryService.getCompatibleExtension(gallery) : gallery;
		if (!compatible) {
			return false;
		}
		// Sync the local extension with gallery extension if local extension doesnot has metadata
		if (extension.local) {
			const local = extension.local.metadata ? extension.local : await this.server.extensionManagementService.updateMetadata(extension.local, { id: compatible.identifier.uuid, publisherDisplayName: compatible.publisherDisplayName, publisherId: compatible.publisherId });
			extension.local = local;
			extension.gallery = compatible;
			this._onChange.fire({ extension });
			return true;
		}
		return false;
	}

	private getInstalledExtensionMatchingGallery(gallery: IGalleryExtension): Extension | null {
		for (const installed of this.installed) {
			if (installed.uuid) { // Installed from Gallery
				if (installed.uuid === gallery.identifier.uuid) {
					return installed;
				}
			} else {
				if (areSameExtensions(installed.identifier, gallery.identifier)) { // Installed from other sources
					return installed;
				}
			}
		}
		return null;
	}

	private onInstallExtension(event: InstallExtensionEvent): void {
		const { gallery } = event;
		if (gallery) {
			const extension = this.installed.filter(e => areSameExtensions(e.identifier, gallery.identifier))[0]
				|| this.instantiationService.createInstance(Extension, this.stateProvider, this.server, undefined, gallery);
			this.installing.push(extension);
			this._onChange.fire({ extension });
		}
	}

	private onDidInstallExtension(event: DidInstallExtensionEvent): void {
		const { local, zipPath, error, gallery } = event;
		const installingExtension = gallery ? this.installing.filter(e => areSameExtensions(e.identifier, gallery.identifier))[0] : null;
		this.installing = installingExtension ? this.installing.filter(e => e !== installingExtension) : this.installing;

		let extension: Extension | undefined = installingExtension ? installingExtension
			: (zipPath || local) ? this.instantiationService.createInstance(Extension, this.stateProvider, this.server, local, undefined)
				: undefined;
		if (extension) {
			if (local) {
				const installed = this.installed.filter(e => areSameExtensions(e.identifier, extension!.identifier))[0];
				if (installed) {
					extension = installed;
				} else {
					this.installed.push(extension);
				}
				extension.local = local;
				if (!extension.gallery) {
					extension.gallery = gallery;
				}
				extension.enablementState = this.extensionEnablementService.getEnablementState(local);
			}
		}
		this._onChange.fire(error || !extension ? undefined : { extension, operation: event.operation });
	}

	private onUninstallExtension(identifier: IExtensionIdentifier): void {
		const extension = this.installed.filter(e => areSameExtensions(e.identifier, identifier))[0];
		if (extension) {
			const uninstalling = this.uninstalling.filter(e => areSameExtensions(e.identifier, identifier))[0] || extension;
			this.uninstalling = [uninstalling, ...this.uninstalling.filter(e => !areSameExtensions(e.identifier, identifier))];
			this._onChange.fire(uninstalling ? { extension: uninstalling } : undefined);
		}
	}

	private onDidUninstallExtension({ identifier, error }: DidUninstallExtensionEvent): void {
		if (!error) {
			this.installed = this.installed.filter(e => !areSameExtensions(e.identifier, identifier));
		}
		const uninstalling = this.uninstalling.filter(e => areSameExtensions(e.identifier, identifier))[0];
		this.uninstalling = this.uninstalling.filter(e => !areSameExtensions(e.identifier, identifier));
		if (uninstalling) {
			this._onChange.fire({ extension: uninstalling });
		}
	}

	private onEnablementChanged(platformExtensions: readonly IPlatformExtension[]) {
		const extensions = this.local.filter(e => platformExtensions.some(p => areSameExtensions(e.identifier, p.identifier)));
		for (const extension of extensions) {
			if (extension.local) {
				const enablementState = this.extensionEnablementService.getEnablementState(extension.local);
				if (enablementState !== extension.enablementState) {
					(extension as Extension).enablementState = enablementState;
					this._onChange.fire({ extension: extension as Extension });
				}
			}
		}
	}

	getExtensionState(extension: Extension): ExtensionState {
		if (extension.gallery && this.installing.some(e => !!e.gallery && areSameExtensions(e.gallery.identifier, extension.gallery!.identifier))) {
			return ExtensionState.Installing;
		}
		if (this.uninstalling.some(e => areSameExtensions(e.identifier, extension.identifier))) {
			return ExtensionState.Uninstalling;
		}
		const local = this.installed.filter(e => e === extension || (e.gallery && extension.gallery && areSameExtensions(e.gallery.identifier, extension.gallery.identifier)))[0];
		return local ? ExtensionState.Installed : ExtensionState.Uninstalled;
	}
}

export class ExtensionsWorkbenchService extends Disposable implements IExtensionsWorkbenchService, IURLHandler {

	private static readonly SyncPeriod = 1000 * 60 * 60 * 12; // 12 hours
	_serviceBrand: undefined;

	private readonly localExtensions: Extensions | null = null;
	private readonly remoteExtensions: Extensions | null = null;
	private syncDelayer: ThrottledDelayer<void>;
	private autoUpdateDelayer: ThrottledDelayer<void>;

	private readonly _onChange: Emitter<IExtension | undefined> = new Emitter<IExtension | undefined>();
	get onChange(): Event<IExtension | undefined> { return this._onChange.event; }

	private installing: IExtension[] = [];

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService,
		@IExtensionManagementService private readonly extensionService: IExtensionManagementService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@INotificationService private readonly notificationService: INotificationService,
		@IURLService urlService: IURLService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IHostService private readonly hostService: IHostService,
		@IProgressService private readonly progressService: IProgressService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IStorageService private readonly storageService: IStorageService,
		@IModeService private readonly modeService: IModeService,
		@IProductService private readonly productService: IProductService
	) {
		super();
		if (extensionManagementServerService.localExtensionManagementServer) {
			this.localExtensions = this._register(instantiationService.createInstance(Extensions, extensionManagementServerService.localExtensionManagementServer, ext => this.getExtensionState(ext)));
			this._register(this.localExtensions.onChange(e => this._onChange.fire(e ? e.extension : undefined)));
		}
		if (extensionManagementServerService.remoteExtensionManagementServer) {
			this.remoteExtensions = this._register(instantiationService.createInstance(Extensions, extensionManagementServerService.remoteExtensionManagementServer, ext => this.getExtensionState(ext)));
			this._register(this.remoteExtensions.onChange(e => this._onChange.fire(e ? e.extension : undefined)));
		}

		this.syncDelayer = new ThrottledDelayer<void>(ExtensionsWorkbenchService.SyncPeriod);
		this.autoUpdateDelayer = new ThrottledDelayer<void>(1000);

		urlService.registerHandler(this);

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AutoUpdateConfigurationKey)) {
				if (this.isAutoUpdateEnabled()) {
					this.checkForUpdates();
				}
			}
			if (e.affectsConfiguration(AutoCheckUpdatesConfigurationKey)) {
				if (this.isAutoCheckUpdatesEnabled()) {
					this.checkForUpdates();
				}
			}
		}, this));

		this.queryLocal().then(() => {
			this.resetIgnoreAutoUpdateExtensions();
			this.eventuallySyncWithGallery(true);
		});

		this._register(this.onChange(() => this.updateActivity()));
	}

	get local(): IExtension[] {
		const result = [...this.installed];
		const byId = groupByExtension(result, r => r.identifier);
		return byId.reduce((result, extensions) => { result.push(this.getPrimaryExtension(extensions)); return result; }, []);
	}

	get installed(): IExtension[] {
		const result = [];
		if (this.localExtensions) {
			result.push(...this.localExtensions.local);
		}
		if (this.remoteExtensions) {
			result.push(...this.remoteExtensions.local);
		}
		return result;
	}

	get outdated(): IExtension[] {
		const allLocal = [];
		if (this.localExtensions) {
			allLocal.push(...this.localExtensions.local);
		}
		if (this.remoteExtensions) {
			allLocal.push(...this.remoteExtensions.local);
		}
		return allLocal.filter(e => e.outdated && e.local && e.state === ExtensionState.Installed);
	}

	async queryLocal(server?: IExtensionManagementServer): Promise<IExtension[]> {
		if (server) {
			if (this.localExtensions && this.extensionManagementServerService.localExtensionManagementServer === server) {
				return this.localExtensions.queryInstalled();
			}
			if (this.remoteExtensions && this.extensionManagementServerService.remoteExtensionManagementServer === server) {
				return this.remoteExtensions.queryInstalled();
			}
		}

		if (this.localExtensions) {
			await this.localExtensions.queryInstalled();
		}
		if (this.remoteExtensions) {
			await this.remoteExtensions.queryInstalled();
		}
		return this.local;
	}

	queryGallery(token: CancellationToken): Promise<IPager<IExtension>>;
	queryGallery(options: IQueryOptions, token: CancellationToken): Promise<IPager<IExtension>>;
	queryGallery(arg1: any, arg2?: any): Promise<IPager<IExtension>> {
		const options: IQueryOptions = CancellationToken.isCancellationToken(arg1) ? {} : arg1;
		const token: CancellationToken = CancellationToken.isCancellationToken(arg1) ? arg1 : arg2;
		options.text = options.text ? this.resolveQueryText(options.text) : options.text;
		return this.extensionService.getExtensionsReport()
			.then(report => {
				const maliciousSet = getMaliciousExtensionsSet(report);

				return this.galleryService.query(options, token)
					.then(result => mapPager(result, gallery => this.fromGallery(gallery, maliciousSet)))
					.then(undefined, err => {
						if (/No extension gallery service configured/.test(err.message)) {
							return Promise.resolve(singlePagePager([]));
						}

						return Promise.reject<IPager<IExtension>>(err);
					});
			});
	}

	private resolveQueryText(text: string): string {
		const extensionRegex = /\bext:([^\s]+)\b/g;
		if (extensionRegex.test(text)) {
			text = text.replace(extensionRegex, (m, ext) => {

				// Get curated keywords
				const lookup = this.productService.extensionKeywords || {};
				const keywords = lookup[ext] || [];

				// Get mode name
				const modeId = this.modeService.getModeIdByFilepathOrFirstLine(URI.file(`.${ext}`));
				const languageName = modeId && this.modeService.getLanguageName(modeId);
				const languageTag = languageName ? ` tag:"${languageName}"` : '';

				// Construct a rich query
				return `tag:"__ext_${ext}" tag:"__ext_.${ext}" ${keywords.map(tag => `tag:"${tag}"`).join(' ')}${languageTag} tag:"${ext}"`;
			});
		}
		return text.substr(0, 350);
	}

	open(extension: IExtension, { sideByside, preserveFocus, pinned }: { sideByside?: boolean, preserveFocus?: boolean, pinned?: boolean } = { sideByside: false, preserveFocus: false, pinned: false }): Promise<any> {
		return Promise.resolve(this.editorService.openEditor(this.instantiationService.createInstance(ExtensionsInput, extension), { preserveFocus, pinned }, sideByside ? SIDE_GROUP : ACTIVE_GROUP));
	}

	private getPrimaryExtension(extensions: IExtension[]): IExtension {
		if (extensions.length === 1) {
			return extensions[0];
		}
		const pickRemoteOrFirstExtension = (from: IExtension[]): IExtension => {
			const remoteExtension = from.filter(e => e.server === this.extensionManagementServerService.remoteExtensionManagementServer)[0];
			return remoteExtension ? remoteExtension : from[0];
		};
		const enabledExtensions = extensions.filter(e => e.local && this.extensionEnablementService.isEnabled(e.local));
		return enabledExtensions.length === 1 ? enabledExtensions[0] : pickRemoteOrFirstExtension(extensions);
	}

	private fromGallery(gallery: IGalleryExtension, maliciousExtensionSet: Set<string>): IExtension {
		Promise.all([
			this.localExtensions ? this.localExtensions.syncLocalWithGalleryExtension(gallery, maliciousExtensionSet) : Promise.resolve(false),
			this.remoteExtensions ? this.remoteExtensions.syncLocalWithGalleryExtension(gallery, maliciousExtensionSet) : Promise.resolve(false)
		])
			.then(result => {
				if (result[0] || result[1]) {
					this.eventuallyAutoUpdateExtensions();
				}
			});

		const installed = this.getInstalledExtensionMatchingGallery(gallery);
		if (installed) {
			return installed;
		}
		const extension = this.instantiationService.createInstance(Extension, ext => this.getExtensionState(ext), undefined, undefined, gallery);
		if (maliciousExtensionSet.has(extension.identifier.id)) {
			extension.isMalicious = true;
		}
		return extension;
	}

	private getInstalledExtensionMatchingGallery(gallery: IGalleryExtension): IExtension | null {
		for (const installed of this.local) {
			if (installed.identifier.uuid) { // Installed from Gallery
				if (installed.identifier.uuid === gallery.identifier.uuid) {
					return installed;
				}
			} else {
				if (areSameExtensions(installed.identifier, gallery.identifier)) { // Installed from other sources
					return installed;
				}
			}
		}
		return null;
	}

	private getExtensionState(extension: Extension): ExtensionState {
		const isInstalling = this.installing.some(i => areSameExtensions(i.identifier, extension.identifier));
		if (extension.server) {
			const state = (extension.server === this.extensionManagementServerService.localExtensionManagementServer ? this.localExtensions! : this.remoteExtensions!).getExtensionState(extension);
			return state === ExtensionState.Uninstalled && isInstalling ? ExtensionState.Installing : state;
		} else if (isInstalling) {
			return ExtensionState.Installing;
		}
		if (this.remoteExtensions) {
			const state = this.remoteExtensions.getExtensionState(extension);
			if (state !== ExtensionState.Uninstalled) {
				return state;
			}
		}
		if (this.localExtensions) {
			return this.localExtensions.getExtensionState(extension);
		}
		return ExtensionState.Uninstalled;
	}

	checkForUpdates(): Promise<void> {
		return Promise.resolve(this.syncDelayer.trigger(() => this.syncWithGallery(), 0));
	}

	private isAutoUpdateEnabled(): boolean {
		return this.configurationService.getValue(AutoUpdateConfigurationKey);
	}

	private isAutoCheckUpdatesEnabled(): boolean {
		return this.configurationService.getValue(AutoCheckUpdatesConfigurationKey);
	}

	private eventuallySyncWithGallery(immediate = false): void {
		const shouldSync = this.isAutoUpdateEnabled() || this.isAutoCheckUpdatesEnabled();
		const loop = () => (shouldSync ? this.syncWithGallery() : Promise.resolve(undefined)).then(() => this.eventuallySyncWithGallery());
		const delay = immediate ? 0 : ExtensionsWorkbenchService.SyncPeriod;

		this.syncDelayer.trigger(loop, delay)
			.then(undefined, err => null);
	}

	private syncWithGallery(): Promise<void> {
		const ids: string[] = [], names: string[] = [];
		for (const installed of this.local) {
			if (installed.type === ExtensionType.User) {
				if (installed.identifier.uuid) {
					ids.push(installed.identifier.uuid);
				} else {
					names.push(installed.identifier.id);
				}
			}
		}

		const promises: Promise<IPager<IExtension>>[] = [];
		if (ids.length) {
			promises.push(this.queryGallery({ ids, pageSize: ids.length }, CancellationToken.None));
		}
		if (names.length) {
			promises.push(this.queryGallery({ names, pageSize: names.length }, CancellationToken.None));
		}

		return Promise.all(promises).then(() => undefined);
	}

	private eventuallyAutoUpdateExtensions(): void {
		this.autoUpdateDelayer.trigger(() => this.autoUpdateExtensions())
			.then(undefined, err => null);
	}

	private autoUpdateExtensions(): Promise<any> {
		if (!this.isAutoUpdateEnabled()) {
			return Promise.resolve();
		}

		const toUpdate = this.outdated.filter(e => !this.isAutoUpdateIgnored(new ExtensionIdentifierWithVersion(e.identifier, e.version)));
		return Promise.all(toUpdate.map(e => this.install(e)));
	}

	canInstall(extension: IExtension): boolean {
		if (!(extension instanceof Extension)) {
			return false;
		}

		if (extension.isMalicious) {
			return false;
		}

		if (!extension.gallery) {
			return false;
		}

		if (this.extensionManagementServerService.localExtensionManagementServer || this.extensionManagementServerService.remoteExtensionManagementServer) {
			return true;
		}

		return false;
	}

	install(extension: URI | IExtension): Promise<IExtension> {
		if (extension instanceof URI) {
			return this.installWithProgress(async () => {
				const { identifier } = await this.extensionService.install(extension);
				return this.local.filter(local => areSameExtensions(local.identifier, identifier))[0];
			});
		}

		if (extension.isMalicious) {
			return Promise.reject(new Error(nls.localize('malicious', "This extension is reported to be problematic.")));
		}

		const gallery = extension.gallery;

		if (!gallery) {
			return Promise.reject(new Error('Missing gallery'));
		}

		return this.installWithProgress(async () => {
			await this.installFromGallery(extension, gallery);
			return this.local.filter(local => areSameExtensions(local.identifier, gallery.identifier))[0];
		}, gallery.displayName);
	}

	setEnablement(extensions: IExtension | IExtension[], enablementState: EnablementState): Promise<void> {
		extensions = Array.isArray(extensions) ? extensions : [extensions];
		return this.promptAndSetEnablement(extensions, enablementState);
	}

	uninstall(extension: IExtension): Promise<void> {
		const ext = extension.local ? extension : this.local.filter(e => areSameExtensions(e.identifier, extension.identifier))[0];
		const toUninstall: ILocalExtension | null = ext && ext.local ? ext.local : null;

		if (!toUninstall) {
			return Promise.reject(new Error('Missing local'));
		}
		return this.progressService.withProgress({
			location: ProgressLocation.Extensions,
			title: nls.localize('uninstallingExtension', 'Uninstalling extension....'),
			source: `${toUninstall.identifier.id}`
		}, () => this.extensionService.uninstall(toUninstall).then(() => undefined));
	}

	installVersion(extension: IExtension, version: string): Promise<IExtension> {
		if (!(extension instanceof Extension)) {
			return Promise.resolve(extension);
		}

		if (!extension.gallery) {
			return Promise.reject(new Error('Missing gallery'));
		}

		return this.galleryService.getCompatibleExtension(extension.gallery.identifier, version)
			.then(gallery => {
				if (!gallery) {
					return Promise.reject(new Error(nls.localize('incompatible', "Unable to install extension '{0}' as it is not compatible with VS Code '{1}'.", extension.gallery!.identifier.id, version)));
				}
				return this.installWithProgress(async () => {
					await this.installFromGallery(extension, gallery);
					if (extension.latestVersion !== version) {
						this.ignoreAutoUpdate(new ExtensionIdentifierWithVersion(gallery.identifier, version));
					}
					return this.local.filter(local => areSameExtensions(local.identifier, gallery.identifier))[0];
				}
					, gallery.displayName);
			});
	}

	reinstall(extension: IExtension): Promise<IExtension> {
		const ext = extension.local ? extension : this.local.filter(e => areSameExtensions(e.identifier, extension.identifier))[0];
		const toReinstall: ILocalExtension | null = ext && ext.local ? ext.local : null;

		if (!toReinstall) {
			return Promise.reject(new Error('Missing local'));
		}

		return this.progressService.withProgress({
			location: ProgressLocation.Extensions,
			source: `${toReinstall.identifier.id}`
		}, () => this.extensionService.reinstallFromGallery(toReinstall).then(() => this.local.filter(local => areSameExtensions(local.identifier, extension.identifier))[0]));
	}

	private installWithProgress<T>(installTask: () => Promise<T>, extensionName?: string): Promise<T> {
		const title = extensionName ? nls.localize('installing named extension', "Installing '{0}' extension....", extensionName) : nls.localize('installing extension', 'Installing extension....');
		return this.progressService.withProgress({
			location: ProgressLocation.Extensions,
			title
		}, () => installTask());
	}

	private async installFromGallery(extension: IExtension, gallery: IGalleryExtension): Promise<void> {
		this.installing.push(extension);
		this._onChange.fire(extension);
		try {
			const extensionService = extension.server && extension.local && !isLanguagePackExtension(extension.local.manifest) ? extension.server.extensionManagementService : this.extensionService;
			await extensionService.installFromGallery(gallery);
			const ids: string[] | undefined = extension.identifier.uuid ? [extension.identifier.uuid] : undefined;
			const names: string[] | undefined = extension.identifier.uuid ? undefined : [extension.identifier.id];
			this.queryGallery({ names, ids, pageSize: 1 }, CancellationToken.None);
		} finally {
			this.installing = this.installing.filter(e => e !== extension);
			this._onChange.fire(this.local.filter(e => areSameExtensions(e.identifier, extension.identifier))[0]);
		}
	}

	private promptAndSetEnablement(extensions: IExtension[], enablementState: EnablementState): Promise<any> {
		const enable = enablementState === EnablementState.EnabledGlobally || enablementState === EnablementState.EnabledWorkspace;
		if (enable) {
			const allDependenciesAndPackedExtensions = this.getExtensionsRecursively(extensions, this.local, enablementState, { dependencies: true, pack: true });
			return this.checkAndSetEnablement(extensions, allDependenciesAndPackedExtensions, enablementState);
		} else {
			const packedExtensions = this.getExtensionsRecursively(extensions, this.local, enablementState, { dependencies: false, pack: true });
			if (packedExtensions.length) {
				return this.checkAndSetEnablement(extensions, packedExtensions, enablementState);
			}
			return this.checkAndSetEnablement(extensions, [], enablementState);
		}
	}

	private checkAndSetEnablement(extensions: IExtension[], otherExtensions: IExtension[], enablementState: EnablementState): Promise<any> {
		const allExtensions = [...extensions, ...otherExtensions];
		const enable = enablementState === EnablementState.EnabledGlobally || enablementState === EnablementState.EnabledWorkspace;
		if (!enable) {
			for (const extension of extensions) {
				let dependents = this.getDependentsAfterDisablement(extension, allExtensions, this.local);
				if (dependents.length) {
					return Promise.reject(new Error(this.getDependentsErrorMessage(extension, allExtensions, dependents)));
				}
			}
		}
		return this.doSetEnablement(allExtensions, enablementState);
	}

	private getExtensionsRecursively(extensions: IExtension[], installed: IExtension[], enablementState: EnablementState, options: { dependencies: boolean, pack: boolean }, checked: IExtension[] = []): IExtension[] {
		const toCheck = extensions.filter(e => checked.indexOf(e) === -1);
		if (toCheck.length) {
			for (const extension of toCheck) {
				checked.push(extension);
			}
			const extensionsToDisable = installed.filter(i => {
				if (checked.indexOf(i) !== -1) {
					return false;
				}
				if (i.enablementState === enablementState) {
					return false;
				}
				const enable = enablementState === EnablementState.EnabledGlobally || enablementState === EnablementState.EnabledWorkspace;
				return (enable || i.type === ExtensionType.User) // Include all Extensions for enablement and only user extensions for disablement
					&& (options.dependencies || options.pack)
					&& extensions.some(extension =>
						(options.dependencies && extension.dependencies.some(id => areSameExtensions({ id }, i.identifier)))
						|| (options.pack && extension.extensionPack.some(id => areSameExtensions({ id }, i.identifier)))
					);
			});
			if (extensionsToDisable.length) {
				extensionsToDisable.push(...this.getExtensionsRecursively(extensionsToDisable, installed, enablementState, options, checked));
			}
			return extensionsToDisable;
		}
		return [];
	}

	private getDependentsAfterDisablement(extension: IExtension, extensionsToDisable: IExtension[], installed: IExtension[]): IExtension[] {
		return installed.filter(i => {
			if (i.dependencies.length === 0) {
				return false;
			}
			if (i === extension) {
				return false;
			}
			if (!(i.enablementState === EnablementState.EnabledWorkspace || i.enablementState === EnablementState.EnabledGlobally)) {
				return false;
			}
			if (extensionsToDisable.indexOf(i) !== -1) {
				return false;
			}
			return i.dependencies.some(dep => [extension, ...extensionsToDisable].some(d => areSameExtensions(d.identifier, { id: dep })));
		});
	}

	private getDependentsErrorMessage(extension: IExtension, allDisabledExtensions: IExtension[], dependents: IExtension[]): string {
		for (const e of [extension, ...allDisabledExtensions]) {
			let dependentsOfTheExtension = dependents.filter(d => d.dependencies.some(id => areSameExtensions({ id }, e.identifier)));
			if (dependentsOfTheExtension.length) {
				return this.getErrorMessageForDisablingAnExtensionWithDependents(e, dependentsOfTheExtension);
			}
		}
		return '';
	}

	private getErrorMessageForDisablingAnExtensionWithDependents(extension: IExtension, dependents: IExtension[]): string {
		if (dependents.length === 1) {
			return nls.localize('singleDependentError', "Cannot disable extension '{0}'. Extension '{1}' depends on this.", extension.displayName, dependents[0].displayName);
		}
		if (dependents.length === 2) {
			return nls.localize('twoDependentsError', "Cannot disable extension '{0}'. Extensions '{1}' and '{2}' depend on this.",
				extension.displayName, dependents[0].displayName, dependents[1].displayName);
		}
		return nls.localize('multipleDependentsError', "Cannot disable extension '{0}'. Extensions '{1}', '{2}' and others depend on this.",
			extension.displayName, dependents[0].displayName, dependents[1].displayName);
	}

	private async doSetEnablement(extensions: IExtension[], enablementState: EnablementState): Promise<boolean[]> {
		const changed = await this.extensionEnablementService.setEnablement(extensions.map(e => e.local!), enablementState);
		for (let i = 0; i < changed.length; i++) {
			if (changed[i]) {
				/* __GDPR__
				"extension:enable" : {
					"${include}": [
						"${GalleryExtensionTelemetryData}"
					]
				}
				*/
				/* __GDPR__
				"extension:disable" : {
					"${include}": [
						"${GalleryExtensionTelemetryData}"
					]
				}
				*/
				this.telemetryService.publicLog(enablementState === EnablementState.EnabledGlobally || enablementState === EnablementState.EnabledWorkspace ? 'extension:enable' : 'extension:disable', extensions[i].telemetryData);
			}
		}
		return changed;
	}

	private _activityCallBack: (() => void) | null = null;
	private updateActivity(): void {
		if ((this.localExtensions && this.localExtensions.local.some(e => e.state === ExtensionState.Installing || e.state === ExtensionState.Uninstalling))
			|| (this.remoteExtensions && this.remoteExtensions.local.some(e => e.state === ExtensionState.Installing || e.state === ExtensionState.Uninstalling))) {
			if (!this._activityCallBack) {
				this.progressService.withProgress({ location: ProgressLocation.Extensions }, () => new Promise(c => this._activityCallBack = c));
			}
		} else {
			if (this._activityCallBack) {
				this._activityCallBack();
			}
			this._activityCallBack = null;
		}
	}

	private onError(err: any): void {
		if (isPromiseCanceledError(err)) {
			return;
		}

		const message = err && err.message || '';

		if (/getaddrinfo ENOTFOUND|getaddrinfo ENOENT|connect EACCES|connect ECONNREFUSED/.test(message)) {
			return;
		}

		this.notificationService.error(err);
	}

	handleURL(uri: URI, options?: IOpenURLOptions): Promise<boolean> {
		if (!/^extension/.test(uri.path)) {
			return Promise.resolve(false);
		}

		this.onOpenExtensionUrl(uri);
		return Promise.resolve(true);
	}

	private onOpenExtensionUrl(uri: URI): void {
		const match = /^extension\/([^/]+)$/.exec(uri.path);

		if (!match) {
			return;
		}

		const extensionId = match[1];

		this.queryLocal().then(local => {
			const extension = local.filter(local => areSameExtensions(local.identifier, { id: extensionId }))[0];

			if (extension) {
				return this.hostService.focus()
					.then(() => this.open(extension));
			}
			return this.queryGallery({ names: [extensionId], source: 'uri' }, CancellationToken.None).then(result => {
				if (result.total < 1) {
					return Promise.resolve(null);
				}

				const extension = result.firstPage[0];

				return this.hostService.focus().then(() => {
					return this.open(extension);
				});
			});
		}).then(undefined, error => this.onError(error));
	}


	private _ignoredAutoUpdateExtensions: string[] | undefined;
	private get ignoredAutoUpdateExtensions(): string[] {
		if (!this._ignoredAutoUpdateExtensions) {
			this._ignoredAutoUpdateExtensions = JSON.parse(this.storageService.get('extensions.ignoredAutoUpdateExtension', StorageScope.GLOBAL, '[]') || '[]');
		}
		return this._ignoredAutoUpdateExtensions!;
	}

	private set ignoredAutoUpdateExtensions(extensionIds: string[]) {
		this._ignoredAutoUpdateExtensions = distinct(extensionIds.map(id => id.toLowerCase()));
		this.storageService.store('extensions.ignoredAutoUpdateExtension', JSON.stringify(this._ignoredAutoUpdateExtensions), StorageScope.GLOBAL);
	}

	private ignoreAutoUpdate(identifierWithVersion: ExtensionIdentifierWithVersion): void {
		if (!this.isAutoUpdateIgnored(identifierWithVersion)) {
			this.ignoredAutoUpdateExtensions = [...this.ignoredAutoUpdateExtensions, identifierWithVersion.key()];
		}
	}

	private isAutoUpdateIgnored(identifierWithVersion: ExtensionIdentifierWithVersion): boolean {
		return this.ignoredAutoUpdateExtensions.indexOf(identifierWithVersion.key()) !== -1;
	}

	private resetIgnoreAutoUpdateExtensions(): void {
		this.ignoredAutoUpdateExtensions = this.ignoredAutoUpdateExtensions.filter(extensionId => this.local.some(local => !!local.local && new ExtensionIdentifierWithVersion(local.identifier, local.version).key() === extensionId));
	}

	dispose(): void {
		super.dispose();
		this.syncDelayer.cancel();
	}
}
