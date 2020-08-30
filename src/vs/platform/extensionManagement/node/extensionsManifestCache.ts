/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { join } from 'vs/base/common/path';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IExtensionManagementService, DidInstallExtensionEvent, DidUninstallExtensionEvent } from 'vs/platform/extensionManagement/common/extensionManagement';
import { MANIFEST_CACHE_FOLDER, USER_MANIFEST_CACHE_FILE } from 'vs/platform/extensions/common/extensions';
import * as pfs from 'vs/base/node/pfs';

export class ExtensionsManifestCache extends Disposable {

	private extensionsManifestCache = join(this.environmentService.userDataPath, MANIFEST_CACHE_FOLDER, USER_MANIFEST_CACHE_FILE);

	constructor(
		private readonly environmentService: INativeEnvironmentService,
		extensionsManagementService: IExtensionManagementService
	) {
		super();
		this._register(extensionsManagementService.onDidInstallExtension(e => this.onDidInstallExtension(e)));
		this._register(extensionsManagementService.onDidUninstallExtension(e => this.onDidUnInstallExtension(e)));
	}

	private onDidInstallExtension(e: DidInstallExtensionEvent): void {
		if (!e.error) {
			this.invalidate();
		}
	}

	private onDidUnInstallExtension(e: DidUninstallExtensionEvent): void {
		if (!e.error) {
			this.invalidate();
		}
	}

	invalidate(): void {
		pfs.rimraf(this.extensionsManifestCache, pfs.RimRafMode.MOVE).then(() => { }, () => { });
	}
}
