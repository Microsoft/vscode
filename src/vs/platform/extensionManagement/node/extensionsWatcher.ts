/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { DidInstallExtensionEvent, DidUninstallExtensionEvent, IExtensionManagementService, ILocalExtension, InstallExtensionEvent } from 'vs/platform/extensionManagement/common/extensionManagement';
import { Emitter, Event } from 'vs/base/common/event';
import { ExtensionType, IExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { FileChangeType, FileSystemProviderCapabilities, IFileChange, IFileService } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ExtUri } from 'vs/base/common/resources';
import { ILogService } from 'vs/platform/log/common/log';

export class ExtensionsWatcher extends Disposable {

	private readonly _onDidChangeExtensionsByAnotherSource = this._register(new Emitter<{ added: ILocalExtension[], removed: IExtensionIdentifier[] }>());
	readonly onDidChangeExtensionsByAnotherSource = this._onDidChangeExtensionsByAnotherSource.event;

	private startTimestamp = 0;
	private installingExtensions: IExtensionIdentifier[] = [];
	private installedExtensions: IExtensionIdentifier[] | undefined;

	constructor(
		private readonly extensionsManagementService: IExtensionManagementService,
		@IFileService fileService: IFileService,
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.extensionsManagementService.getInstalled(ExtensionType.User).then(extensions => {
			this.installedExtensions = extensions.map(e => e.identifier);
			this.startTimestamp = Date.now();
		});
		this._register(extensionsManagementService.onInstallExtension(e => this.onInstallExtension(e)));
		this._register(extensionsManagementService.onDidInstallExtension(e => this.onDidInstallExtension(e)));
		this._register(extensionsManagementService.onDidUninstallExtension(e => this.onDidUninstallExtension(e)));

		const extensionsResource = URI.file(environmentService.extensionsPath);
		const extUri = new ExtUri(resource => !fileService.hasCapability(resource, FileSystemProviderCapabilities.PathCaseSensitive));
		this._register(fileService.watch(extensionsResource));
		this._register(Event.filter(fileService.onDidFilesChange, e => e.changes.some(change => this.doesChangeAffects(change, extensionsResource, extUri)))(() => this.onDidChange()));
	}

	private doesChangeAffects(change: IFileChange, extensionsResource: URI, extUri: ExtUri): boolean {
		// Is not immediate child of extensions resource
		if (!extUri.isEqual(extUri.dirname(change.resource), extensionsResource)) {
			return false;
		}

		// .obsolete file changed
		if (extUri.isEqual(change.resource, extUri.joinPath(extensionsResource, '.obsolete'))) {
			return true;
		}

		// Only interested in added/deleted changes
		if (change.type !== FileChangeType.ADDED && change.type !== FileChangeType.DELETED) {
			return false;
		}

		// Ingore changes to files starting with `.`
		if (extUri.basename(change.resource).startsWith('.')) {
			return false;
		}

		return true;
	}

	private onInstallExtension(e: InstallExtensionEvent): void {
		this.addInstallingExtension(e.identifier);
	}

	private onDidInstallExtension(e: DidInstallExtensionEvent): void {
		this.removeInstallingExtension(e.identifier);
		if (!e.error) {
			this.addInstalledExtension(e.identifier);
		}
	}

	private onDidUninstallExtension(e: DidUninstallExtensionEvent): void {
		if (!e.error) {
			this.removeInstalledExtension(e.identifier);
		}
	}

	private addInstallingExtension(extension: IExtensionIdentifier) {
		this.removeInstallingExtension(extension);
		this.installingExtensions.push(extension);
	}

	private removeInstallingExtension(identifier: IExtensionIdentifier) {
		this.installingExtensions = this.installingExtensions.filter(e => !areSameExtensions(e, identifier));
	}

	private addInstalledExtension(extension: IExtensionIdentifier): void {
		if (this.installedExtensions) {
			this.removeInstalledExtension(extension);
			this.installedExtensions.push(extension);
		}
	}

	private removeInstalledExtension(identifier: IExtensionIdentifier): void {
		if (this.installedExtensions) {
			this.installedExtensions = this.installedExtensions.filter(e => !areSameExtensions(e, identifier));
		}
	}

	private async onDidChange(): Promise<void> {
		if (this.installedExtensions) {
			const extensions = await this.extensionsManagementService.getInstalled(ExtensionType.User);
			const added = extensions.filter(e => {
				if ([...this.installingExtensions, ...this.installedExtensions!].some(identifier => areSameExtensions(identifier, e.identifier))) {
					return false;
				}
				if (e.installedTimestamp && e.installedTimestamp > this.startTimestamp) {
					this.logService.info('Detected extension installed from another source', e.identifier.id);
					return true;
				} else {
					this.logService.info('Ignored extension installed by another source because of invalid timestamp', e.identifier.id);
					return false;
				}
			});
			const removed = this.installedExtensions.filter(identifier => {
				// Extension being installed
				if (this.installingExtensions.some(installingExtension => areSameExtensions(installingExtension, identifier))) {
					return false;
				}
				if (extensions.every(e => !areSameExtensions(e.identifier, identifier))) {
					this.logService.info('Detected extension removed from another source', identifier.id);
					return true;
				}
				return false;
			});
			this.installedExtensions = extensions.map(e => e.identifier);
			if (added.length || removed.length) {
				this._onDidChangeExtensionsByAnotherSource.fire({ added, removed });
			}
		}
	}

}
