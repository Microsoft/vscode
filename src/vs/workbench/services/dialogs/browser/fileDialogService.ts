/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPickAndOpenOptions, ISaveDialogOptions, IOpenDialogOptions, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { URI } from 'vs/base/common/uri';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { AbstractFileDialogService } from 'vs/workbench/services/dialogs/browser/abstractFileDialogService';
import { Schemas } from 'vs/base/common/network';

export class FileDialogService extends AbstractFileDialogService implements IFileDialogService {

	async pickFileFolderAndOpen(options: IPickAndOpenOptions): Promise<any> {
		const schema = this.getFileSystemSchema(options);

		if (!options.defaultUri) {
			options.defaultUri = await this.defaultFilePath(schema);
		}

		return this.pickFileFolderAndOpenSimplified(schema, options, false);
	}

	async pickFileAndOpen(options: IPickAndOpenOptions): Promise<any> {
		const schema = this.getFileSystemSchema(options);

		if (!options.defaultUri) {
			options.defaultUri = await this.defaultFilePath(schema);
		}

		return this.pickFileAndOpenSimplified(schema, options, false);
	}

	async pickFolderAndOpen(options: IPickAndOpenOptions): Promise<any> {
		const schema = this.getFileSystemSchema(options);

		if (!options.defaultUri) {
			options.defaultUri = await this.defaultFolderPath(schema);
		}

		return this.pickFolderAndOpenSimplified(schema, options);
	}

	async pickWorkspaceAndOpen(options: IPickAndOpenOptions): Promise<void> {
		const schema = this.getFileSystemSchema(options);

		if (!options.defaultUri) {
			options.defaultUri = await this.defaultWorkspacePath(schema);
		}

		return this.pickWorkspaceAndOpenSimplified(schema, options);
	}

	async pickFileToSave(defaultUri: URI, availableFileSystems?: string[]): Promise<URI | undefined> {
		const schema = this.getFileSystemSchema({ defaultUri, availableFileSystems });
		return this.pickFileToSaveSimplified(schema, this.getPickFileToSaveDialogOptions(defaultUri, availableFileSystems));
	}

	async showSaveDialog(options: ISaveDialogOptions): Promise<URI | undefined> {
		const schema = this.getFileSystemSchema(options);
		return this.showSaveDialogSimplified(schema, options);
	}

	async showOpenDialog(options: IOpenDialogOptions): Promise<URI[] | undefined> {
		const schema = this.getFileSystemSchema(options);
		return this.showOpenDialogSimplified(schema, options);
	}

	protected addFileSchemaIfNeeded(schema: string): string[] {
		return schema === Schemas.untitled ? [Schemas.file] : [schema];
	}
}

registerSingleton(IFileDialogService, FileDialogService, true);
