/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ITextBufferFactory, ITextSnapshot } from 'vs/editor/common/model';

export const IBackupFileService = createDecorator<IBackupFileService>('backupFileService');

export interface IResolvedBackup<T extends object> {
	readonly value: ITextBufferFactory;
	readonly meta?: T;
}

/**
 * A service that handles any I/O and state associated with the backup system.
 */
export interface IBackupFileService {

	readonly _serviceBrand: undefined;

	/**
	 * Finds out if there are any backups stored.
	 */
	hasBackups(): Promise<boolean>;

	/**
	 * Finds out if the provided resource with the given version is backed up.
	 *
	 * Note: if the backup service has not been initialized yet, this may return
	 * the wrong result. Always use `resolve()` if you can do a long running
	 * operation.
	 */
	hasBackupSync(resource: URI, versionId?: number): boolean;

	/**
	 * Gets a list of file backups for the current workspace.
	 *
	 * @return The list of backups.
	 */
	getBackups(): Promise<URI[]>;

	/**
	 * Resolves the backup for the given resource if that exists.
	 *
	 * @param resource The resource to get the backup for.
	 * @return The backup file's backed up content and metadata if available or undefined
	 * if not backup exists.
	 */
	resolve<T extends object>(resource: URI): Promise<IResolvedBackup<T> | undefined>;

	/**
	 * Backs up a resource.
	 *
	 * @param resource The resource to back up.
	 * @param content The optional content of the resource as snapshot.
	 * @param versionId The optionsl version id of the resource to backup.
	 * @param meta The optional meta data of the resource to backup. This information
	 * can be restored later when loading the backup again.
	 */
	backup<T extends object>(resource: URI, content?: ITextSnapshot, versionId?: number, meta?: T): Promise<void>;

	/**
	 * Discards the backup associated with a resource if it exists.
	 *
	 * @param resource The resource whose backup is being discarded discard to back up.
	 */
	discardBackup(resource: URI): Promise<void>;

	/**
	 * Discards all backups.
	 */
	discardBackups(): Promise<void>;
}
