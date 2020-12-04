/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


import { WorkspaceFileEditOptions } from 'vs/editor/common/modes';
import { IFileService, FileSystemProviderCapabilities, IFileContent } from 'vs/platform/files/common/files';
import { IProgress } from 'vs/platform/progress/common/progress';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { IWorkspaceUndoRedoElement, UndoRedoElementType, IUndoRedoService, UndoRedoGroup, UndoRedoSource } from 'vs/platform/undoRedo/common/undoRedo';
import { URI } from 'vs/base/common/uri';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { VSBuffer } from 'vs/base/common/buffer';
import { ResourceFileEdit } from 'vs/editor/browser/services/bulkEditService';
import * as resources from 'vs/base/common/resources';
import { CancellationToken } from 'vs/base/common/cancellation';

interface IFileOperationUndoRedoInfo {
	undoRedoGroupId?: number;
	isUndoing?: boolean;
}

interface IFileOperation {
	uris: URI[];
	perform(token: CancellationToken): Promise<IFileOperation>;
}

class Noop implements IFileOperation {
	readonly uris = [];
	async perform() { return this; }
	toString(): string {
		return '(noop)';
	}
}

class RenameOperation implements IFileOperation {

	constructor(
		readonly newUri: URI,
		readonly oldUri: URI,
		readonly options: WorkspaceFileEditOptions,
		readonly undoRedoInfo: IFileOperationUndoRedoInfo,
		@IWorkingCopyFileService private readonly _workingCopyFileService: IWorkingCopyFileService,
		@IFileService private readonly _fileService: IFileService,
	) { }

	get uris() {
		return [this.newUri, this.oldUri];
	}

	async perform(token: CancellationToken): Promise<IFileOperation> {
		// rename
		if (this.options.overwrite === undefined && this.options.ignoreIfExists && await this._fileService.exists(this.newUri)) {
			return new Noop(); // not overwriting, but ignoring, and the target file exists
		}

		await this._workingCopyFileService.move([{ source: this.oldUri, target: this.newUri }], { overwrite: this.options.overwrite, ...this.undoRedoInfo }, token);
		return new RenameOperation(this.oldUri, this.newUri, this.options, { isUndoing: true }, this._workingCopyFileService, this._fileService);
	}

	toString(): string {
		const oldBasename = resources.basename(this.oldUri);
		const newBasename = resources.basename(this.newUri);
		if (oldBasename !== newBasename) {
			return `(rename ${oldBasename} to ${newBasename})`;
		}
		return `(rename ${this.oldUri} to ${this.newUri})`;
	}
}

class CopyOperation implements IFileOperation {

	constructor(
		readonly newUri: URI,
		readonly oldUri: URI,
		readonly options: WorkspaceFileEditOptions,
		readonly undoRedoInfo: IFileOperationUndoRedoInfo,
		@IWorkingCopyFileService private readonly _workingCopyFileService: IWorkingCopyFileService,
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService private readonly _instaService: IInstantiationService
	) { }

	get uris() {
		return [this.newUri, this.oldUri];
	}

	async perform(token: CancellationToken): Promise<IFileOperation> {
		// copy
		if (this.options.overwrite === undefined && this.options.ignoreIfExists && await this._fileService.exists(this.newUri)) {
			return new Noop(); // not overwriting, but ignoring, and the target file exists
		}

		const stat = await this._workingCopyFileService.copy([{ source: this.oldUri, target: this.newUri }], { overwrite: this.options.overwrite, ...this.undoRedoInfo }, token);
		const folder = this.options.folder || (stat.length === 1 && stat[0].isDirectory);
		return this._instaService.createInstance(DeleteOperation, this.newUri, { recursive: true, folder, ...this.options }, { isUndoing: true }, false);
	}

	toString(): string {
		return `(copy ${this.oldUri} to ${this.newUri})`;
	}
}

class CreateOperation implements IFileOperation {

	constructor(
		readonly newUri: URI,
		readonly options: WorkspaceFileEditOptions,
		readonly undoRedoInfo: IFileOperationUndoRedoInfo,
		readonly contents: VSBuffer | undefined,
		@IFileService private readonly _fileService: IFileService,
		@IWorkingCopyFileService private readonly _workingCopyFileService: IWorkingCopyFileService,
		@IInstantiationService private readonly _instaService: IInstantiationService,
	) { }

	get uris() {
		return [this.newUri];
	}

	async perform(token: CancellationToken): Promise<IFileOperation> {
		// create file
		if (this.options.overwrite === undefined && this.options.ignoreIfExists && await this._fileService.exists(this.newUri)) {
			return new Noop(); // not overwriting, but ignoring, and the target file exists
		}
		if (this.options.folder) {
			await this._workingCopyFileService.createFolder(this.newUri, { ...this.undoRedoInfo }, token);
		} else {
			await this._workingCopyFileService.create(this.newUri, this.contents, { overwrite: this.options.overwrite, ...this.undoRedoInfo }, token);
		}
		return this._instaService.createInstance(DeleteOperation, this.newUri, this.options, { isUndoing: true }, !this.options.folder && !this.contents);
	}

	toString(): string {
		return this.options.folder ? `create ${resources.basename(this.newUri)} folder`
			: `(create ${resources.basename(this.newUri)} with ${this.contents?.byteLength || 0} bytes)`;
	}
}

class DeleteOperation implements IFileOperation {

	constructor(
		readonly oldUri: URI,
		readonly options: WorkspaceFileEditOptions,
		readonly undoRedoInfo: IFileOperationUndoRedoInfo,
		private readonly _undoesCreateOperation: boolean,
		@IWorkingCopyFileService private readonly _workingCopyFileService: IWorkingCopyFileService,
		@IFileService private readonly _fileService: IFileService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ILogService private readonly _logService: ILogService
	) { }

	get uris() {
		return [this.oldUri];
	}

	async perform(token: CancellationToken): Promise<IFileOperation> {
		// delete file
		if (!await this._fileService.exists(this.oldUri)) {
			if (!this.options.ignoreIfNotExists) {
				throw new Error(`${this.oldUri} does not exist and can not be deleted`);
			}
			return new Noop();
		}

		let fileContent: IFileContent | undefined;
		if (!this._undoesCreateOperation && !this.options.folder) {
			try {
				fileContent = await this._fileService.readFile(this.oldUri);
			} catch (err) {
				this._logService.critical(err);
			}
		}

		const useTrash = !this.options.skipTrashBin && this._fileService.hasCapability(this.oldUri, FileSystemProviderCapabilities.Trash) && this._configurationService.getValue<boolean>('files.enableTrash');
		await this._workingCopyFileService.delete([this.oldUri], { useTrash, recursive: this.options.recursive, ...this.undoRedoInfo }, token);

		if (typeof this.options.maxSize === 'number' && fileContent && (fileContent?.size > this.options.maxSize)) {
			return new Noop();
		}
		return this._instaService.createInstance(CreateOperation, this.oldUri, this.options, { isUndoing: true }, fileContent?.value);
	}

	toString(): string {
		return `(delete ${resources.basename(this.oldUri)})`;
	}
}

class FileUndoRedoElement implements IWorkspaceUndoRedoElement {

	readonly type = UndoRedoElementType.Workspace;

	readonly resources: readonly URI[];

	constructor(
		readonly label: string,
		readonly operations: IFileOperation[]
	) {
		this.resources = (<URI[]>[]).concat(...operations.map(op => op.uris));
	}

	async undo(): Promise<void> {
		await this._reverse();
	}

	async redo(): Promise<void> {
		await this._reverse();
	}

	private async _reverse() {
		for (let i = 0; i < this.operations.length; i++) {
			const op = this.operations[i];
			const undo = await op.perform(CancellationToken.None);
			this.operations[i] = undo;
		}
	}

	public toString(): string {
		return this.operations.map(op => String(op)).join(', ');
	}
}

export class BulkFileEdits {

	constructor(
		private readonly _label: string,
		private readonly _undoRedoGroup: UndoRedoGroup,
		private readonly _undoRedoSource: UndoRedoSource | undefined,
		private readonly _progress: IProgress<void>,
		private readonly _token: CancellationToken,
		private readonly _edits: ResourceFileEdit[],
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService,
	) { }

	async apply(): Promise<void> {
		const undoOperations: IFileOperation[] = [];
		const undoRedoInfo = { undoRedoGroupId: this._undoRedoGroup.id };
		for (const edit of this._edits) {

			if (this._token.isCancellationRequested) {
				break;
			}

			const options = edit.options || {};
			let op: IFileOperation | undefined;
			if (edit.newResource && edit.oldResource && !options.copy) {
				// rename
				op = this._instaService.createInstance(RenameOperation, edit.newResource, edit.oldResource, options, undoRedoInfo);
			} else if (edit.newResource && edit.oldResource && options.copy) {
				op = this._instaService.createInstance(CopyOperation, edit.newResource, edit.oldResource, options, undoRedoInfo);
			} else if (!edit.newResource && edit.oldResource) {
				// delete file
				op = this._instaService.createInstance(DeleteOperation, edit.oldResource, options, undoRedoInfo, false);
			} else if (edit.newResource && !edit.oldResource) {
				// create file
				op = this._instaService.createInstance(CreateOperation, edit.newResource, options, undoRedoInfo, undefined);
			}
			if (op) {
				const undoOp = await op.perform(this._token);
				undoOperations.push(undoOp);
			}

			this._progress.report(undefined);
		}

		this._undoRedoService.pushElement(new FileUndoRedoElement(this._label, undoOperations), this._undoRedoGroup, this._undoRedoSource);
	}
}
