/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';
import { Schemas } from 'vs/base/common/network';
import { join } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { IFileService, IFileStatWithMetadata, IWriteFileOptions } from 'vs/platform/files/common/files';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { IElevatedFileService } from 'vs/workbench/services/files/common/elevatedFileService';

export class NativeElevatedFileService implements IElevatedFileService {

	readonly _serviceBrand: undefined;

	constructor(
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IFileService private readonly fileService: IFileService,
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService
	) { }

	isSupported(resource: URI): boolean {
		// Saving elevated is currently only supported for local
		// files for as long as we have no generic support from
		// the file service
		// (https://github.com/microsoft/vscode/issues/48659)
		return resource.scheme === Schemas.file;
	}

	async writeFileElevated(resource: URI, value: VSBuffer | VSBufferReadable | VSBufferReadableStream, options?: IWriteFileOptions): Promise<IFileStatWithMetadata> {
		const source = URI.file(join(this.environmentService.userDataPath, `code-elevated-${Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 6)}`));
		try {
			// write into a tmp file first
			await this.fileService.writeFile(source, value, options);

			// then sudo prompt copy
			await this.nativeHostService.writeElevated(source, resource, options);
		} finally {

			// clean up
			await this.fileService.del(source);
		}

		return this.fileService.resolve(resource, { resolveMetadata: true });
	}
}

registerSingleton(IElevatedFileService, NativeElevatedFileService);
