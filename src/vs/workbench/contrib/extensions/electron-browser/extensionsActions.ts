/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { IFileService } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { Schemas } from 'vs/base/common/network';

export class OpenExtensionsFolderAction extends Action {

	static readonly ID = 'workbench.extensions.action.openExtensionsFolder';
	static readonly LABEL = localize('openExtensionsFolder', "Open Extensions Folder");

	constructor(
		id: string,
		label: string,
		@IElectronService private readonly electronService: IElectronService,
		@IFileService private readonly fileService: IFileService,
		@IWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService
	) {
		super(id, label, undefined, true);
	}

	async run(): Promise<void> {
		if (this.environmentService.extensionsPath) {
			const extensionsHome = URI.file(this.environmentService.extensionsPath);
			const file = await this.fileService.resolve(extensionsHome);

			let itemToShow: URI;
			if (file.children && file.children.length > 0) {
				itemToShow = file.children[0].resource;
			} else {
				itemToShow = extensionsHome;
			}

			if (itemToShow.scheme === Schemas.file) {
				return this.electronService.showItemInFolder(itemToShow.fsPath);
			}
		}
	}
}

