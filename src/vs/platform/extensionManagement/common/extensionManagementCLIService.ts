/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';

import { isPromiseCanceledError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { gt } from 'vs/base/common/semver/semver';
import { CLIOutput, IExtensionGalleryService, IExtensionManagementCLIService, IExtensionManagementService, IGalleryExtension, ILocalExtension, InstallOptions } from 'vs/platform/extensionManagement/common/extensionManagement';
import { adoptToGalleryExtensionId, areSameExtensions, getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ExtensionType, EXTENSION_CATEGORIES, IExtensionManifest } from 'vs/platform/extensions/common/extensions';
import { getBaseLabel } from 'vs/base/common/labels';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Schemas } from 'vs/base/common/network';

const notFound = (id: string) => localize('notFound', "Extension '{0}' not found.", id);
const useId = localize('useId', "Make sure you use the full extension ID, including the publisher, e.g.: {0}", 'ms-dotnettools.csharp');


function getId(manifest: IExtensionManifest, withVersion?: boolean): string {
	if (withVersion) {
		return `${manifest.publisher}.${manifest.name}@${manifest.version}`;
	} else {
		return `${manifest.publisher}.${manifest.name}`;
	}
}

const EXTENSION_ID_REGEX = /^([^.]+\..+)@(\d+\.\d+\.\d+(-.*)?)$/;

export function getIdAndVersion(id: string): [string, string | undefined] {
	const matches = EXTENSION_ID_REGEX.exec(id);
	if (matches && matches[1]) {
		return [adoptToGalleryExtensionId(matches[1]), matches[2]];
	}
	return [adoptToGalleryExtensionId(id), undefined];
}

type InstallExtensionInfo = { id: string, version?: string, installOptions: InstallOptions };


export class ExtensionManagementCLIService implements IExtensionManagementCLIService {

	_serviceBrand: any;

	constructor(
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService
	) { }

	protected get location(): string | undefined {
		return undefined;
	}

	public async listExtensions(showVersions: boolean, category?: string, output: CLIOutput = console): Promise<void> {
		let extensions = await this.extensionManagementService.getInstalled(ExtensionType.User);
		const categories = EXTENSION_CATEGORIES.map(c => c.toLowerCase());
		if (category && category !== '') {
			if (categories.indexOf(category.toLowerCase()) < 0) {
				output.log('Invalid category please enter a valid category. To list valid categories run --category without a category specified');
				return;
			}
			extensions = extensions.filter(e => {
				if (e.manifest.categories) {
					const lowerCaseCategories: string[] = e.manifest.categories.map(c => c.toLowerCase());
					return lowerCaseCategories.indexOf(category.toLowerCase()) > -1;
				}
				return false;
			});
		} else if (category === '') {
			output.log('Possible Categories: ');
			categories.forEach(category => {
				output.log(category);
			});
			return;
		}
		if (this.location) {
			output.log(localize('listFromLocation', "Extensions installed on {0}:", this.location));
		}

		extensions = extensions.sort((e1, e2) => e1.identifier.id.localeCompare(e2.identifier.id));
		let lastId: string | undefined = undefined;
		for (let extension of extensions) {
			if (lastId !== extension.identifier.id) {
				lastId = extension.identifier.id;
				output.log(getId(extension.manifest, showVersions));
			}
		}
	}

	public async installExtensions(extensions: (string | URI)[], builtinExtensionIds: string[], isMachineScoped: boolean, force: boolean, output: CLIOutput = console): Promise<void> {
		const failed: string[] = [];
		const installedExtensionsManifests: IExtensionManifest[] = [];
		if (extensions.length) {
			output.log(this.location ? localize('installingExtensionsOnLocation', "Installing extensions on {0}...", this.location) : localize('installingExtensions', "Installing extensions..."));
		}

		const installed = await this.extensionManagementService.getInstalled(ExtensionType.User);
		const checkIfNotInstalled = (id: string, version?: string): boolean => {
			const installedExtension = installed.find(i => areSameExtensions(i.identifier, { id }));
			if (installedExtension) {
				if (!version && !force) {
					output.log(localize('alreadyInstalled-checkAndUpdate', "Extension '{0}' v{1} is already installed. Use '--force' option to update to latest version or provide '@<version>' to install a specific version, for example: '{2}@1.2.3'.", id, installedExtension.manifest.version, id));
					return false;
				}
				if (version && installedExtension.manifest.version === version) {
					output.log(localize('alreadyInstalled', "Extension '{0}' is already installed.", `${id}@${version}`));
					return false;
				}
			}
			return true;
		};
		const vsixs: URI[] = [];
		const installExtensionInfos: InstallExtensionInfo[] = [];
		for (const extension of extensions) {
			if (extension instanceof URI) {
				vsixs.push(extension);
			} else {
				const [id, version] = getIdAndVersion(extension);
				if (checkIfNotInstalled(id, version)) {
					installExtensionInfos.push({ id, version, installOptions: { isBuiltin: false, isMachineScoped } });
				}
			}
		}
		for (const extension of builtinExtensionIds) {
			const [id, version] = getIdAndVersion(extension);
			if (checkIfNotInstalled(id, version)) {
				installExtensionInfos.push({ id, version, installOptions: { isBuiltin: true, isMachineScoped: false } });
			}
		}

		if (vsixs.length) {
			await Promise.all(vsixs.map(async vsix => {
				try {
					const manifest = await this.installVSIX(vsix, { isBuiltin: false, isMachineScoped }, force, output);
					if (manifest) {
						installedExtensionsManifests.push(manifest);
					}
				} catch (err) {
					output.error(err.message || err.stack || err);
					failed.push(vsix.toString());
				}
			}));
		}

		if (installExtensionInfos.length) {

			const galleryExtensions = await this.getGalleryExtensions(installExtensionInfos);

			await Promise.all(installExtensionInfos.map(async extensionInfo => {
				const gallery = galleryExtensions.get(extensionInfo.id.toLowerCase());
				if (gallery) {
					try {
						const manifest = await this.installFromGallery(extensionInfo, gallery, installed, force, output);
						if (manifest) {
							installedExtensionsManifests.push(manifest);
						}
					} catch (err) {
						output.error(err.message || err.stack || err);
						failed.push(extensionInfo.id);
					}
				} else {
					output.error(`${notFound(extensionInfo.version ? `${extensionInfo.id}@${extensionInfo.version}` : extensionInfo.id)}\n${useId}`);
					failed.push(extensionInfo.id);
				}
			}));

		}

		if (failed.length) {
			throw new Error(localize('installation failed', "Failed Installing Extensions: {0}", failed.join(', ')));
		}
	}

	private async installVSIX(vsix: URI, installOptions: InstallOptions, force: boolean, output: CLIOutput): Promise<IExtensionManifest | null> {

		const manifest = await this.extensionManagementService.getManifest(vsix);
		if (!manifest) {
			throw new Error('Invalid vsix');
		}

		const valid = await this.validateVSIX(manifest, force, output);
		if (valid) {
			try {
				await this.extensionManagementService.install(vsix, installOptions);
				output.log(localize('successVsixInstall', "Extension '{0}' was successfully installed.", getBaseLabel(vsix)));
				return manifest;
			} catch (error) {
				if (isPromiseCanceledError(error)) {
					output.log(localize('cancelVsixInstall', "Cancelled installing extension '{0}'.", getBaseLabel(vsix)));
					return null;
				} else {
					throw error;
				}
			}
		}
		return null;
	}

	private async getGalleryExtensions(extensions: InstallExtensionInfo[]): Promise<Map<string, IGalleryExtension>> {
		const extensionIds = extensions.filter(({ version }) => version === undefined).map(({ id }) => id);
		const extensionsWithIdAndVersion = extensions.filter(({ version }) => version !== undefined);

		const galleryExtensions = new Map<string, IGalleryExtension>();
		await Promise.all([
			(async () => {
				const result = await this.extensionGalleryService.getExtensions(extensionIds, CancellationToken.None);
				result.forEach(extension => galleryExtensions.set(extension.identifier.id.toLowerCase(), extension));
			})(),
			Promise.all(extensionsWithIdAndVersion.map(async ({ id, version }) => {
				const extension = await this.extensionGalleryService.getCompatibleExtension({ id }, version);
				if (extension) {
					galleryExtensions.set(extension.identifier.id.toLowerCase(), extension);
				}
			}))
		]);

		return galleryExtensions;
	}

	private async installFromGallery({ id, version, installOptions }: InstallExtensionInfo, galleryExtension: IGalleryExtension, installed: ILocalExtension[], force: boolean, output: CLIOutput): Promise<IExtensionManifest | null> {
		const manifest = await this.extensionGalleryService.getManifest(galleryExtension, CancellationToken.None);
		if (manifest && !this.validateExtensionKind(manifest, output)) {
			return null;
		}

		const installedExtension = installed.find(e => areSameExtensions(e.identifier, galleryExtension.identifier));
		if (installedExtension) {
			if (galleryExtension.version === installedExtension.manifest.version) {
				output.log(localize('alreadyInstalled', "Extension '{0}' is already installed.", version ? `${id}@${version}` : id));
				return null;
			}
			output.log(localize('updateMessage', "Updating the extension '{0}' to the version {1}", id, galleryExtension.version));
		}

		try {
			if (installOptions.isBuiltin) {
				output.log(localize('installing builtin ', "Installing builtin extension '{0}' v{1}...", id, galleryExtension.version));
			} else {
				output.log(localize('installing', "Installing extension '{0}' v{1}...", id, galleryExtension.version));
			}

			await this.extensionManagementService.installFromGallery(galleryExtension, installOptions);
			output.log(localize('successInstall', "Extension '{0}' v{1} was successfully installed.", id, galleryExtension.version));
			return manifest;
		} catch (error) {
			if (isPromiseCanceledError(error)) {
				output.log(localize('cancelInstall', "Cancelled installing extension '{0}'.", id));
				return null;
			} else {
				throw error;
			}
		}
	}

	protected validateExtensionKind(_manifest: IExtensionManifest, output: CLIOutput): boolean {
		return true;
	}

	private async validateVSIX(manifest: IExtensionManifest, force: boolean, output: CLIOutput): Promise<boolean> {
		const extensionIdentifier = { id: getGalleryExtensionId(manifest.publisher, manifest.name) };
		const installedExtensions = await this.extensionManagementService.getInstalled(ExtensionType.User);
		const newer = installedExtensions.find(local => areSameExtensions(extensionIdentifier, local.identifier) && gt(local.manifest.version, manifest.version));

		if (newer && !force) {
			output.log(localize('forceDowngrade', "A newer version of extension '{0}' v{1} is already installed. Use '--force' option to downgrade to older version.", newer.identifier.id, newer.manifest.version, manifest.version));
			return false;
		}

		return this.validateExtensionKind(manifest, output);
	}

	public async uninstallExtensions(extensions: (string | URI)[], force: boolean, output: CLIOutput = console): Promise<void> {
		const getExtensionId = async (extensionDescription: string | URI): Promise<string> => {
			if (extensionDescription instanceof URI) {
				const manifest = await this.extensionManagementService.getManifest(extensionDescription);
				return getId(manifest);
			}
			return extensionDescription;
		};

		const uninstalledExtensions: ILocalExtension[] = [];
		for (const extension of extensions) {
			const id = await getExtensionId(extension);
			const installed = await this.extensionManagementService.getInstalled();
			const extensionsToUninstall = installed.filter(e => areSameExtensions(e.identifier, { id }));
			if (!extensionsToUninstall.length) {
				throw new Error(`${this.notInstalled(id)}\n${useId}`);
			}
			if (extensionsToUninstall.some(e => e.type === ExtensionType.System)) {
				output.log(localize('builtin', "Extension '{0}' is a Built-in extension and cannot be uninstalled", id));
				return;
			}
			if (!force && extensionsToUninstall.some(e => e.isBuiltin)) {
				output.log(localize('forceUninstall', "Extension '{0}' is marked as a Built-in extension by user. Please use '--force' option to uninstall it.", id));
				return;
			}
			output.log(localize('uninstalling', "Uninstalling {0}...", id));
			for (const extensionToUninstall of extensionsToUninstall) {
				await this.extensionManagementService.uninstall(extensionToUninstall);
				uninstalledExtensions.push(extensionToUninstall);
			}

			if (this.location) {
				output.log(localize('successUninstallFromLocation', "Extension '{0}' was successfully uninstalled from {1}!", id, this.location));
			} else {
				output.log(localize('successUninstall', "Extension '{0}' was successfully uninstalled!", id));
			}

		}
	}

	public async locateExtension(extensions: string[], output: CLIOutput = console): Promise<void> {
		const installed = await this.extensionManagementService.getInstalled();
		extensions.forEach(e => {
			installed.forEach(i => {
				if (i.identifier.id === e) {
					if (i.location.scheme === Schemas.file) {
						output.log(i.location.fsPath);
						return;
					}
				}
			});
		});
	}

	private notInstalled(id: string) {
		return this.location ? localize('notInstalleddOnLocation', "Extension '{0}' is not installed on {1}.", id, this.location) : localize('notInstalled', "Extension '{0}' is not installed.", id);
	}

}
