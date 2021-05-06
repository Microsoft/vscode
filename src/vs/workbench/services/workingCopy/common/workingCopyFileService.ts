/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Event } from 'vs/base/common/event';
import { AsyncEmitter, IWaitUntil, Promises } from 'vs/base/common/async';
import { insert } from 'vs/base/common/arrays';
import { URI } from 'vs/base/common/uri';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IFileService, FileOperation, IFileStatWithMetadata } from 'vs/platform/files/common/files';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IWorkingCopy } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { WorkingCopyFileOperationParticipant } from 'vs/workbench/services/workingCopy/common/workingCopyFileOperationParticipant';
import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';

export const IWorkingCopyFileService = createDecorator<IWorkingCopyFileService>('workingCopyFileService');

export interface SourceTargetPair {

	/**
	 * The source resource that is defined for move operations.
	 */
	readonly source?: URI;

	/**
	 * The target resource the event is about.
	 */
	readonly target: URI
}

export interface IFileOperationUndoRedoInfo {

	/**
	 * Id of the undo group that the file operation belongs to.
	 */
	undoRedoGroupId?: number;

	/**
	 * Flag indicates if the operation is an undo.
	 */
	isUndoing?: boolean
}

export interface WorkingCopyFileEvent extends IWaitUntil {

	/**
	 * An identifier to correlate the operation through the
	 * different event types (before, after, error).
	 */
	readonly correlationId: number;

	/**
	 * The file operation that is taking place.
	 */
	readonly operation: FileOperation;

	/**
	 * The array of source/target pair of files involved in given operation.
	 */
	readonly files: readonly SourceTargetPair[];
}

export interface IWorkingCopyFileOperationParticipant {

	/**
	 * Participate in a file operation of working copies. Allows to
	 * change the working copies before they are being saved to disk.
	 */
	participate(
		files: SourceTargetPair[],
		operation: FileOperation,
		undoInfo: IFileOperationUndoRedoInfo | undefined,
		timeout: number,
		token: CancellationToken
	): Promise<void>;
}

export interface ICreateOperation {
	resource: URI;
	overwrite?: boolean;
}

export interface ICreateFileOperation extends ICreateOperation {
	contents?: VSBuffer | VSBufferReadable | VSBufferReadableStream,
}

export interface IDeleteOperation {
	resource: URI;
	useTrash?: boolean;
	recursive?: boolean;
}

export interface IMoveOperation {
	file: Required<SourceTargetPair>;
	overwrite?: boolean;
}

export interface ICopyOperation extends IMoveOperation { }

/**
 * Returns the working copies for a given resource.
 */
type WorkingCopyProvider = (resourceOrFolder: URI) => IWorkingCopy[];

/**
 * A service that allows to perform file operations with working copy support.
 * Any operation that would leave a stale dirty working copy behind will make
 * sure to revert the working copy first.
 *
 * On top of that events are provided to participate in each state of the
 * operation to perform additional work.
 */
export interface IWorkingCopyFileService {

	readonly _serviceBrand: undefined;

	//#region Events

	/**
	 * An event that is fired when a certain working copy IO operation is about to run.
	 *
	 * Participants can join this event with a long running operation to keep some state
	 * before the operation is started, but working copies should not be changed at this
	 * point in time. For that purpose, use the `IWorkingCopyFileOperationParticipant` API.
	 */
	readonly onWillRunWorkingCopyFileOperation: Event<WorkingCopyFileEvent>;

	/**
	 * An event that is fired after a working copy IO operation has failed.
	 *
	 * Participants can join this event with a long running operation to clean up as needed.
	 */
	readonly onDidFailWorkingCopyFileOperation: Event<WorkingCopyFileEvent>;

	/**
	 * An event that is fired after a working copy IO operation has been performed.
	 *
	 * Participants can join this event with a long running operation to make changes
	 * after the operation has finished.
	 */
	readonly onDidRunWorkingCopyFileOperation: Event<WorkingCopyFileEvent>;

	//#endregion


	//#region File operation participants

	/**
	 * Adds a participant for file operations on working copies.
	 */
	addFileOperationParticipant(participant: IWorkingCopyFileOperationParticipant): IDisposable;

	//#endregion


	//#region File operations

	/**
	 * Will create a resource with the provided optional contents, optionally overwriting any target.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 */
	create(operations: ICreateFileOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	/**
	 * Will create a folder and any parent folder that needs to be created.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 *
	 * Note: events will only be emitted for the provided resource, but not any
	 * parent folders that are being created as part of the operation.
	 */
	createFolder(operations: ICreateOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	/**
	 * Will move working copies matching the provided resources and corresponding children
	 * to the target resources using the associated file service for those resources.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 */
	move(operations: IMoveOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	/**
	 * Will copy working copies matching the provided resources and corresponding children
	 * to the target resources using the associated file service for those resources.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 */
	copy(operations: ICopyOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<readonly IFileStatWithMetadata[]>;

	/**
	 * Will delete working copies matching the provided resources and children
	 * using the associated file service for those resources.
	 *
	 * Working copy owners can listen to the `onWillRunWorkingCopyFileOperation` and
	 * `onDidRunWorkingCopyFileOperation` events to participate.
	 */
	delete(operations: IDeleteOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<void>;

	//#endregion


	//#region Path related

	/**
	 * Register a new provider for working copies based on a resource.
	 *
	 * @return a disposable that unregisters the provider.
	 */
	registerWorkingCopyProvider(provider: WorkingCopyProvider): IDisposable;

	/**
	 * Will return all working copies that are dirty matching the provided resource.
	 * If the resource is a folder and the scheme supports file operations, a working
	 * copy that is dirty and is a child of that folder will also be returned.
	 */
	getDirty(resource: URI): readonly IWorkingCopy[];

	//#endregion
}

export class WorkingCopyFileService extends Disposable implements IWorkingCopyFileService {

	declare readonly _serviceBrand: undefined;

	//#region Events

	private readonly _onWillRunWorkingCopyFileOperation = this._register(new AsyncEmitter<WorkingCopyFileEvent>());
	readonly onWillRunWorkingCopyFileOperation = this._onWillRunWorkingCopyFileOperation.event;

	private readonly _onDidFailWorkingCopyFileOperation = this._register(new AsyncEmitter<WorkingCopyFileEvent>());
	readonly onDidFailWorkingCopyFileOperation = this._onDidFailWorkingCopyFileOperation.event;

	private readonly _onDidRunWorkingCopyFileOperation = this._register(new AsyncEmitter<WorkingCopyFileEvent>());
	readonly onDidRunWorkingCopyFileOperation = this._onDidRunWorkingCopyFileOperation.event;

	//#endregion

	private correlationIds = 0;

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super();

		// register a default working copy provider that uses the working copy service
		this._register(this.registerWorkingCopyProvider(resource => {
			return this.workingCopyService.workingCopies.filter(workingCopy => {
				if (this.fileService.canHandleResource(resource)) {
					// only check for parents if the resource can be handled
					// by the file system where we then assume a folder like
					// path structure
					return this.uriIdentityService.extUri.isEqualOrParent(workingCopy.resource, resource);
				}

				return this.uriIdentityService.extUri.isEqual(workingCopy.resource, resource);
			});
		}));
	}


	//#region File operations

	create(operations: ICreateFileOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doCreateFileOrFolder(operations, true, token, undoInfo);
	}

	createFolder(operations: ICreateOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doCreateFileOrFolder(operations, false, token, undoInfo);
	}

	async doCreateFileOrFolder(operations: (ICreateFileOperation | ICreateOperation)[], isFile: boolean, token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		if (operations.length === 0) {
			return [];
		}

		// validate create operation before starting
		if (isFile) {
			const validateCreates = await Promises.settled(operations.map(operation => this.fileService.canCreateFile(operation.resource, { overwrite: operation.overwrite })));
			const error = validateCreates.find(validateCreate => validateCreate instanceof Error);
			if (error instanceof Error) {
				throw error;
			}
		}

		// file operation participant
		const files = operations.map(operation => ({ target: operation.resource }));
		await this.runFileOperationParticipants(files, FileOperation.CREATE, undoInfo, token);

		// before events
		const event = { correlationId: this.correlationIds++, operation: FileOperation.CREATE, files };
		await this._onWillRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

		// now actually create on disk
		let stats: IFileStatWithMetadata[];
		try {
			if (isFile) {
				stats = await Promises.settled(operations.map(operation => this.fileService.createFile(operation.resource, (operation as ICreateFileOperation).contents, { overwrite: operation.overwrite })));
			} else {
				stats = await Promises.settled(operations.map(operation => this.fileService.createFolder(operation.resource)));
			}
		} catch (error) {

			// error event
			await this._onDidFailWorkingCopyFileOperation.fireAsync(event, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

			throw error;
		}

		// after event
		await this._onDidRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

		return stats;
	}

	async move(operations: IMoveOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doMoveOrCopy(operations, true, token, undoInfo);
	}

	async copy(operations: ICopyOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		return this.doMoveOrCopy(operations, false, token, undoInfo);
	}

	private async doMoveOrCopy(operations: IMoveOperation[] | ICopyOperation[], move: boolean, token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<IFileStatWithMetadata[]> {
		const stats: IFileStatWithMetadata[] = [];

		// validate move/copy operation before starting
		for (const { file: { source, target }, overwrite } of operations) {
			const validateMoveOrCopy = await (move ? this.fileService.canMove(source, target, overwrite) : this.fileService.canCopy(source, target, overwrite));
			if (validateMoveOrCopy instanceof Error) {
				throw validateMoveOrCopy;
			}
		}

		// file operation participant
		const files = operations.map(o => o.file);
		await this.runFileOperationParticipants(files, move ? FileOperation.MOVE : FileOperation.COPY, undoInfo, token);

		// before event
		const event = { correlationId: this.correlationIds++, operation: move ? FileOperation.MOVE : FileOperation.COPY, files };
		await this._onWillRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

		try {
			for (const { file: { source, target }, overwrite } of operations) {
				// if source and target are not equal, handle dirty working copies
				// depending on the operation:
				// - move: revert both source and target (if any)
				// - copy: revert target (if any)
				if (!this.uriIdentityService.extUri.isEqual(source, target)) {
					const dirtyWorkingCopies = (move ? [...this.getDirty(source), ...this.getDirty(target)] : this.getDirty(target));
					await Promises.settled(dirtyWorkingCopies.map(dirtyWorkingCopy => dirtyWorkingCopy.revert({ soft: true })));
				}

				// now we can rename the source to target via file operation
				if (move) {
					stats.push(await this.fileService.move(source, target, overwrite));
				} else {
					stats.push(await this.fileService.copy(source, target, overwrite));
				}
			}
		} catch (error) {

			// error event
			await this._onDidFailWorkingCopyFileOperation.fireAsync(event, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

			throw error;
		}

		// after event
		await this._onDidRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

		return stats;
	}

	async delete(operations: IDeleteOperation[], token: CancellationToken, undoInfo?: IFileOperationUndoRedoInfo): Promise<void> {

		// validate delete operation before starting
		for (const operation of operations) {
			const validateDelete = await this.fileService.canDelete(operation.resource, { recursive: operation.recursive, useTrash: operation.useTrash });
			if (validateDelete instanceof Error) {
				throw validateDelete;
			}
		}

		// file operation participant
		const files = operations.map(operation => ({ target: operation.resource }));
		await this.runFileOperationParticipants(files, FileOperation.DELETE, undoInfo, token);

		// before events
		const event = { correlationId: this.correlationIds++, operation: FileOperation.DELETE, files };
		await this._onWillRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

		// check for any existing dirty working copies for the resource
		// and do a soft revert before deleting to be able to close
		// any opened editor with these working copies
		for (const operation of operations) {
			const dirtyWorkingCopies = this.getDirty(operation.resource);
			await Promises.settled(dirtyWorkingCopies.map(dirtyWorkingCopy => dirtyWorkingCopy.revert({ soft: true })));
		}

		// now actually delete from disk
		try {
			for (const operation of operations) {
				await this.fileService.del(operation.resource, { recursive: operation.recursive, useTrash: operation.useTrash });
			}
		} catch (error) {

			// error event
			await this._onDidFailWorkingCopyFileOperation.fireAsync(event, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);

			throw error;
		}

		// after event
		await this._onDidRunWorkingCopyFileOperation.fireAsync(event, CancellationToken.None /* intentional: we currently only forward cancellation to participants */);
	}

	//#endregion


	//#region File operation participants

	private readonly fileOperationParticipants = this._register(this.instantiationService.createInstance(WorkingCopyFileOperationParticipant));

	addFileOperationParticipant(participant: IWorkingCopyFileOperationParticipant): IDisposable {
		return this.fileOperationParticipants.addFileOperationParticipant(participant);
	}

	private runFileOperationParticipants(files: SourceTargetPair[], operation: FileOperation, undoInfo: IFileOperationUndoRedoInfo | undefined, token: CancellationToken): Promise<void> {
		return this.fileOperationParticipants.participate(files, operation, undoInfo, token);
	}

	//#endregion


	//#region Path related

	private readonly workingCopyProviders: WorkingCopyProvider[] = [];

	registerWorkingCopyProvider(provider: WorkingCopyProvider): IDisposable {
		const remove = insert(this.workingCopyProviders, provider);

		return toDisposable(remove);
	}

	getDirty(resource: URI): IWorkingCopy[] {
		const dirtyWorkingCopies = new Set<IWorkingCopy>();
		for (const provider of this.workingCopyProviders) {
			for (const workingCopy of provider(resource)) {
				if (workingCopy.isDirty()) {
					dirtyWorkingCopies.add(workingCopy);
				}
			}
		}

		return Array.from(dirtyWorkingCopies);
	}

	//#endregion
}

registerSingleton(IWorkingCopyFileService, WorkingCopyFileService, true);
