/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { ISaveOptions, IRevertOptions } from 'vs/workbench/common/editor';
import { CancellationToken } from 'vs/base/common/cancellation';
import { VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';

export const enum WorkingCopyCapabilities {

	/**
	 * Signals no specific capability for the working copy.
	 */
	None = 0,

	/**
	 * Signals that the working copy requires
	 * additional input when saving, e.g. an
	 * associated path to save to.
	 */
	Untitled = 1 << 1
}

/**
 * Data to be associated with working copy backups. Use
 * `IWorkingCopyBackupService.resolve(workingCopy)` to
 * retrieve the backup when loading the working copy.
 */
export interface IWorkingCopyBackup {

	/**
	 * Any serializable metadata to be associated with the backup.
	 */
	meta?: IWorkingCopyBackupMeta;

	/**
	 * The actual snapshot of the contents of the working copy at
	 * the time the backup was made.
	 */
	content?: VSBufferReadable | VSBufferReadableStream;
}

/**
 * Working copy backup metadata that can be associated
 * with the backup.
 *
 * Some properties may be reserved as outlined here and
 * cannot be used.
 */
export interface IWorkingCopyBackupMeta {

	/**
	 * Any property needs to be serializable through JSON.
	 */
	[key: string]: unknown;

	/**
	 * `typeId` is a reverved property that cannot be used
	 * as backup metadata.
	 */
	typeId?: never;
}

/**
 * @deprecated it is important to provide a type identifier
 * for working copies to enable all capabilities.
 */
export const NO_TYPE_ID = '';

/**
 * Every working copy has in common that it is identified by
 * a resource `URI` and a `typeId`. There can only be one
 * working copy registered with the same `URI` and `typeId`.
 */
export interface IWorkingCopyIdentifier {

	/**
	 * The type identifier of the working copy for grouping
	 * working copies of the same domain together.
	 *
	 * There can only be one working copy for a given resource
	 * and type identifier.
	 */
	readonly typeId: string;

	/**
	 * The resource of the working copy must be unique for
	 * working copies of the same `typeId`.
	 */
	readonly resource: URI;
}

/**
 * A working copy is an abstract concept to unify handling of
 * data that can be worked on (e.g. edited) in an editor.
 *
 *
 * A working copy resource may be the backing store of the data
 * (e.g. a file on disk), but that is not a requirement. If
 * your working copy is file based, consider to use the
 * `IFileWorkingCopy` instead that simplifies a lot of things
 * when working with file based working copies.
 */
export interface IWorkingCopy extends IWorkingCopyIdentifier {

	/**
	 * Human readable name of the working copy.
	 */
	readonly name: string;

	/**
	 * The capabilities of the working copy.
	 */
	readonly capabilities: WorkingCopyCapabilities;


	//#region Events

	/**
	 * Used by the workbench to signal if the working copy
	 * is dirty or not. Typically a working copy is dirty
	 * once changed until saved or reverted.
	 */
	readonly onDidChangeDirty: Event<void>;

	/**
	 * Used by the workbench e.g. to trigger auto-save
	 * (unless this working copy is untitled) and backups.
	 */
	readonly onDidChangeContent: Event<void>;

	//#endregion


	//#region Dirty Tracking

	isDirty(): boolean;

	//#endregion


	//#region Save / Backup

	/**
	 * The workbench may call this method often after it receives
	 * the `onDidChangeContent` event for the working copy. The motivation
	 * is to allow to quit VSCode with dirty working copies present.
	 *
	 * Providers of working copies should use `IWorkingCopyBackupService.resolve(workingCopy)`
	 * to retrieve the backup metadata associated when loading the working copy.
	 *
	 * @param token support for cancellation
	 */
	backup(token: CancellationToken): Promise<IWorkingCopyBackup>;

	/**
	 * Asks the working copy to save. If the working copy was dirty, it is
	 * expected to be non-dirty after this operation has finished.
	 *
	 * @returns `true` if the operation was successful and `false` otherwise.
	 */
	save(options?: ISaveOptions): Promise<boolean>;

	/**
	 * Asks the working copy to revert. If the working copy was dirty, it is
	 * expected to be non-dirty after this operation has finished.
	 */
	revert(options?: IRevertOptions): Promise<void>;

	//#endregion
}
