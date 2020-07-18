/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { ILogService } from 'vs/platform/log/common/log';
import { IEnvironment, IStaticWorkspaceData } from 'vs/workbench/api/common/extHost.protocol';
import { IExtHostConsumerFileSystem } from 'vs/workbench/api/common/extHostFileSystemConsumer';
import { URI } from 'vs/base/common/uri';

export const IExtensionStoragePaths = createDecorator<IExtensionStoragePaths>('IExtensionStoragePaths');

export interface IExtensionStoragePaths {
	readonly _serviceBrand: undefined;
	whenReady: Promise<any>;
	workspaceValue(extension: IExtensionDescription): URI | undefined;
	globalValue(extension: IExtensionDescription): URI;
}

export class ExtensionStoragePaths implements IExtensionStoragePaths {

	readonly _serviceBrand: undefined;

	private readonly _workspace?: IStaticWorkspaceData;
	private readonly _environment: IEnvironment;

	readonly whenReady: Promise<URI | undefined>;
	private _value?: URI;

	constructor(
		@IExtHostInitDataService initData: IExtHostInitDataService,
		@ILogService private readonly _logService: ILogService,
		@IExtHostConsumerFileSystem private readonly _extHostFileSystem: IExtHostConsumerFileSystem
	) {
		this._workspace = initData.workspace ?? undefined;
		this._environment = initData.environment;
		this.whenReady = this._getOrCreateWorkspaceStoragePath().then(value => this._value = value);
	}

	private async _getOrCreateWorkspaceStoragePath(): Promise<URI | undefined> {
		if (!this._workspace) {
			return Promise.resolve(undefined);
		}
		const storageName = this._workspace.id;
		const storageUri = URI.joinPath(this._environment.workspaceStorageHome, storageName);

		try {
			await this._extHostFileSystem.stat(storageUri);
			this._logService.trace('[ExtHostStorage] storage dir already exists', storageUri);
			return storageUri;
		} catch {
			// doesn't exist, that's OK
		}

		try {
			this._logService.trace('[ExtHostStorage] creating dir and metadata-file', storageUri);
			await this._extHostFileSystem.createDirectory(storageUri);
			await this._extHostFileSystem.writeFile(
				URI.joinPath(storageUri, 'meta.json'),
				new TextEncoder().encode(JSON.stringify({
					id: this._workspace.id,
					configuration: URI.revive(this._workspace.configuration)?.toString(),
					name: this._workspace.name
				}, undefined, 2))
			);
			return storageUri;

		} catch (e) {
			this._logService.error('[ExtHostStorage]', e);
			return undefined;
		}
	}

	workspaceValue(extension: IExtensionDescription): URI | undefined {
		if (this._value) {
			return URI.joinPath(this._value, extension.identifier.value);
		}
		return undefined;
	}

	globalValue(extension: IExtensionDescription): URI {
		return URI.joinPath(this._environment.globalStorageHome, extension.identifier.value.toLowerCase());
	}
}
