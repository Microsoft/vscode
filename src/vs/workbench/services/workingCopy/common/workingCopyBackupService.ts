/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, isEqual, joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { coalesce } from 'vs/base/common/arrays';
import { equals, deepClone } from 'vs/base/common/objects';
import { Promises, ResourceQueue } from 'vs/base/common/async';
import { IResolvedWorkingCopyBackup, IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { IFileService, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { ResourceMap } from 'vs/base/common/map';
import { isReadableStream, peekStream } from 'vs/base/common/stream';
import { bufferToStream, prefixedBufferReadable, prefixedBufferStream, readableToBuffer, streamToBuffer, VSBuffer, VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Schemas } from 'vs/base/common/network';
import { hash } from 'vs/base/common/hash';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { LegacyWorkingCopyBackupRestorer } from 'vs/workbench/services/workingCopy/common/legacyBackupRestorer';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { isEmptyObject } from 'vs/base/common/types';
import { IWorkingCopyBackupMeta, IWorkingCopyIdentifier } from 'vs/workbench/services/workingCopy/common/workingCopy';

export class WorkingCopyBackupsModel {

	private readonly cache = new ResourceMap<{ versionId?: number, meta?: IWorkingCopyBackupMeta }>();

	static async create(backupRoot: URI, fileService: IFileService): Promise<WorkingCopyBackupsModel> {
		const model = new WorkingCopyBackupsModel(backupRoot, fileService);

		await model.resolve();

		return model;
	}

	private constructor(private backupRoot: URI, private fileService: IFileService) { }

	private async resolve(): Promise<void> {
		try {
			const backupRootStat = await this.fileService.resolve(this.backupRoot);
			if (backupRootStat.children) {
				await Promises.settled(backupRootStat.children
					.filter(child => child.isDirectory)
					.map(async backupSchemaFolder => {

						// Read backup directory for backups
						const backupSchemaFolderStat = await this.fileService.resolve(backupSchemaFolder.resource);

						// Remember known backups in our caches
						if (backupSchemaFolderStat.children) {
							for (const backupForSchema of backupSchemaFolderStat.children) {
								if (!backupForSchema.isDirectory) {
									this.add(backupForSchema.resource);
								}
							}
						}
					}));
			}
		} catch (error) {
			// ignore any errors
		}
	}

	add(resource: URI, versionId = 0, meta?: IWorkingCopyBackupMeta): void {
		this.cache.set(resource, { versionId, meta: deepClone(meta) }); // make sure to not store original meta in our cache...
	}

	count(): number {
		return this.cache.size;
	}

	has(resource: URI, versionId?: number, meta?: IWorkingCopyBackupMeta): boolean {
		const entry = this.cache.get(resource);
		if (!entry) {
			return false; // unknown resource
		}

		if (typeof versionId === 'number' && versionId !== entry.versionId) {
			return false; // different versionId
		}

		if (meta && !equals(meta, entry.meta)) {
			return false; // different metadata
		}

		return true;
	}

	get(): URI[] {
		return Array.from(this.cache.keys());
	}

	remove(resource: URI): void {
		this.cache.delete(resource);
	}

	move(source: URI, target: URI): void {
		const entry = this.cache.get(source);
		if (entry) {
			this.cache.delete(source);
			this.cache.set(target, entry);
		}
	}

	clear(): void {
		this.cache.clear();
	}
}

export abstract class WorkingCopyBackupService implements IWorkingCopyBackupService {

	declare readonly _serviceBrand: undefined;

	private impl: NativeWorkingCopyBackupServiceImpl | InMemoryWorkingCopyBackupService;

	constructor(
		backupWorkspaceHome: URI | undefined,
		@IFileService protected fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		this.impl = this.initialize(backupWorkspaceHome);
	}

	private initialize(backupWorkspaceHome: URI | undefined): NativeWorkingCopyBackupServiceImpl | InMemoryWorkingCopyBackupService {
		if (backupWorkspaceHome) {
			return new NativeWorkingCopyBackupServiceImpl(backupWorkspaceHome, this.fileService, this.logService);
		}

		return new InMemoryWorkingCopyBackupService();
	}

	reinitialize(backupWorkspaceHome: URI | undefined): void {

		// Re-init implementation (unless we are running in-memory)
		if (this.impl instanceof NativeWorkingCopyBackupServiceImpl) {
			if (backupWorkspaceHome) {
				this.impl.initialize(backupWorkspaceHome);
			} else {
				this.impl = new InMemoryWorkingCopyBackupService();
			}
		}
	}

	hasBackups(): Promise<boolean> {
		return this.impl.hasBackups();
	}

	hasBackupSync(identifier: IWorkingCopyIdentifier, versionId?: number): boolean {
		return this.impl.hasBackupSync(identifier, versionId);
	}

	backup(identifier: IWorkingCopyIdentifier, content?: VSBufferReadableStream | VSBufferReadable, versionId?: number, meta?: IWorkingCopyBackupMeta, token?: CancellationToken): Promise<void> {
		return this.impl.backup(identifier, content, versionId, meta, token);
	}

	discardBackup(identifier: IWorkingCopyIdentifier): Promise<void> {
		return this.impl.discardBackup(identifier);
	}

	discardBackups(except?: IWorkingCopyIdentifier[]): Promise<void> {
		return this.impl.discardBackups(except);
	}

	getBackups(): Promise<IWorkingCopyIdentifier[]> {
		return this.impl.getBackups();
	}

	resolve<T extends IWorkingCopyBackupMeta>(identifier: IWorkingCopyIdentifier): Promise<IResolvedWorkingCopyBackup<T> | undefined> {
		return this.impl.resolve(identifier);
	}

	toBackupResource(identifier: IWorkingCopyIdentifier): URI {
		return this.impl.toBackupResource(identifier);
	}
}

class NativeWorkingCopyBackupServiceImpl extends Disposable implements IWorkingCopyBackupService {

	private static readonly PREAMBLE_END_MARKER = '\n';
	private static readonly PREAMBLE_END_MARKER_CHARCODE = '\n'.charCodeAt(0);
	private static readonly PREAMBLE_META_SEPARATOR = ' '; // using a character that is know to be escaped in a URI as separator
	private static readonly PREAMBLE_MAX_LENGTH = 10000;

	declare readonly _serviceBrand: undefined;

	private readonly ioOperationQueues = this._register(new ResourceQueue()); // queue IO operations to ensure write/delete file order

	private ready!: Promise<WorkingCopyBackupsModel>;
	private model: WorkingCopyBackupsModel | undefined = undefined;

	constructor(
		private backupWorkspaceHome: URI,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.initialize(backupWorkspaceHome);
	}

	initialize(backupWorkspaceResource: URI): void {
		this.backupWorkspaceHome = backupWorkspaceResource;

		this.ready = this.doInitialize();
	}

	private async doInitialize(): Promise<WorkingCopyBackupsModel> {

		// Create backup model
		this.model = await WorkingCopyBackupsModel.create(this.backupWorkspaceHome, this.fileService);

		// Migrate hashes as needed. We used to hash with a MD5
		// sum of the path but switched to our own simpler hash
		// to avoid a node.js dependency. We still want to
		// support the older hash so we:
		// - iterate over all backups
		// - detect if the file name length is 32 (MD5 length)
		// - read the backup's target file path
		// - rename the backup to the new hash
		// - update the backup in our model
		//
		// TODO@bpasero remove me eventually
		for (const backupResource of this.model.get()) {
			if (basename(backupResource).length !== 32) {
				continue; // not a MD5 hash, already uses new hash function
			}

			try {
				const identifier = await this.resolveIdentifier(backupResource);
				if (!identifier) {
					this.logService.warn(`Backup: Unable to read target URI of backup ${backupResource} for migration to new hash.`);
					continue;
				}

				const expectedBackupResource = this.toBackupResource(identifier);
				if (!isEqual(expectedBackupResource, backupResource)) {
					await this.fileService.move(backupResource, expectedBackupResource, true);
					this.model.move(backupResource, expectedBackupResource);
				}
			} catch (error) {
				this.logService.error(`Backup: Unable to migrate backup ${backupResource} to new hash.`);
			}
		}

		return this.model;
	}

	async hasBackups(): Promise<boolean> {
		const model = await this.ready;

		return model.count() > 0;
	}

	hasBackupSync(identifier: IWorkingCopyIdentifier, versionId?: number): boolean {
		if (!this.model) {
			return false;
		}

		const backupResource = this.toBackupResource(identifier);

		return this.model.has(backupResource, versionId);
	}

	async backup(identifier: IWorkingCopyIdentifier, content?: VSBufferReadable | VSBufferReadableStream, versionId?: number, meta?: IWorkingCopyBackupMeta, token?: CancellationToken): Promise<void> {
		const model = await this.ready;
		if (token?.isCancellationRequested) {
			return;
		}

		const backupResource = this.toBackupResource(identifier);
		if (model.has(backupResource, versionId, meta)) {
			return; // return early if backup version id matches requested one
		}

		return this.ioOperationQueues.queueFor(backupResource).queue(async () => {
			if (token?.isCancellationRequested) {
				return;
			}

			// Encode as: Resource + META-START + Meta + END
			// and respect max length restrictions in case
			// meta is too large.
			let preamble = this.createPreamble(identifier, meta);
			if (preamble.length >= NativeWorkingCopyBackupServiceImpl.PREAMBLE_MAX_LENGTH) {
				preamble = this.createPreamble(identifier);
			}

			// Update backup with value
			const preambleBuffer = VSBuffer.fromString(preamble);
			let backupBuffer: VSBuffer | VSBufferReadableStream | VSBufferReadable;
			if (isReadableStream(content)) {
				backupBuffer = prefixedBufferStream(preambleBuffer, content);
			} else if (content) {
				backupBuffer = prefixedBufferReadable(preambleBuffer, content);
			} else {
				backupBuffer = VSBuffer.concat([preambleBuffer, VSBuffer.fromString('')]);
			}

			await this.fileService.writeFile(backupResource, backupBuffer);

			// Update model
			model.add(backupResource, versionId, meta);
		});
	}

	private createPreamble(identifier: IWorkingCopyIdentifier, meta?: IWorkingCopyBackupMeta): string {
		return `${identifier.resource.toString()}${NativeWorkingCopyBackupServiceImpl.PREAMBLE_META_SEPARATOR}${JSON.stringify({ ...meta, typeId: identifier.typeId })}${NativeWorkingCopyBackupServiceImpl.PREAMBLE_END_MARKER}`;
	}

	async discardBackups(except?: IWorkingCopyIdentifier[]): Promise<void> {
		const model = await this.ready;

		// Discard all but some backups
		if (Array.isArray(except) && except.length > 0) {
			const exceptMap = new ResourceMap<boolean>();
			for (const exceptWorkingCopy of except) {
				exceptMap.set(this.toBackupResource(exceptWorkingCopy), true);
			}

			for (const backupResource of model.get()) {
				if (!exceptMap.has(backupResource)) {
					await this.doDiscardBackup(backupResource);
				}
			}
		}

		// Discard all backups
		else {
			await this.deleteIgnoreFileNotFound(this.backupWorkspaceHome);

			model.clear();
		}
	}

	discardBackup(identifier: IWorkingCopyIdentifier): Promise<void> {
		const backupResource = this.toBackupResource(identifier);

		return this.doDiscardBackup(backupResource);
	}

	private async doDiscardBackup(backupResource: URI): Promise<void> {
		const model = await this.ready;

		return this.ioOperationQueues.queueFor(backupResource).queue(async () => {
			await this.deleteIgnoreFileNotFound(backupResource);

			model.remove(backupResource);
		});
	}

	private async deleteIgnoreFileNotFound(backupResource: URI): Promise<void> {
		try {
			await this.fileService.del(backupResource, { recursive: true });
		} catch (error) {
			if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
				throw error; // re-throw any other error than file not found which is OK
			}
		}
	}

	async getBackups(): Promise<IWorkingCopyIdentifier[]> {
		const model = await this.ready;

		const backups = await Promise.all(model.get().map(backupResource => this.resolveIdentifier(backupResource)));

		return coalesce(backups);
	}

	private async resolveIdentifier(backupResource: URI): Promise<IWorkingCopyIdentifier | undefined> {

		// Read the entire backup preamble by reading up to
		// `PREAMBLE_MAX_LENGTH` in the backup file until
		// the `PREAMBLE_END_MARKER` is found
		const backupPreamble = await this.readToMatchingString(backupResource, NativeWorkingCopyBackupServiceImpl.PREAMBLE_END_MARKER, NativeWorkingCopyBackupServiceImpl.PREAMBLE_MAX_LENGTH);
		if (!backupPreamble) {
			return undefined;
		}

		// Figure out the offset in the preamble where meta
		// information possibly starts. This can be `-1` for
		// older backups without meta.
		const metaStartIndex = backupPreamble.indexOf(NativeWorkingCopyBackupServiceImpl.PREAMBLE_META_SEPARATOR);

		// Extract the preamble content for resource and meta
		let resourcePreamble: string;
		let metaPreamble: string | undefined;
		if (metaStartIndex > 0) {
			resourcePreamble = backupPreamble.substring(0, metaStartIndex);
			metaPreamble = backupPreamble.substr(metaStartIndex + 1);
		} else {
			resourcePreamble = backupPreamble;
			metaPreamble = undefined;
		}

		// Try to find the `typeId` in the meta data if possible
		let typeId: string | undefined = undefined;
		if (metaPreamble) {
			try {
				typeId = JSON.parse(metaPreamble).typeId;
			} catch (error) {
				// ignore JSON parse errors
			}
		}

		return {
			typeId: typeId ?? '', // Fallback for previous backups that do not encode the typeId (TODO@bpasero remove me eventually)
			resource: URI.parse(resourcePreamble)
		};
	}

	private async readToMatchingString(backupResource: URI, matchingString: string, maximumBytesToRead: number): Promise<string | undefined> {
		const contents = (await this.fileService.readFile(backupResource, { length: maximumBytesToRead })).value.toString();

		const matchingStringIndex = contents.indexOf(matchingString);
		if (matchingStringIndex >= 0) {
			return contents.substr(0, matchingStringIndex);
		}

		// Unable to find matching string in file
		return undefined;
	}

	async resolve<T extends IWorkingCopyBackupMeta>(identifier: IWorkingCopyIdentifier): Promise<IResolvedWorkingCopyBackup<T> | undefined> {
		const backupResource = this.toBackupResource(identifier);

		const model = await this.ready;
		if (!model.has(backupResource)) {
			return undefined; // require backup to be present
		}

		// Load the backup content and peek into the first chunk
		// to be able to resolve the meta data
		const backupStream = await this.fileService.readFileStream(backupResource);
		const peekedBackupStream = await peekStream(backupStream.value, 1);
		const firstBackupChunk = VSBuffer.concat(peekedBackupStream.buffer);

		// We have seen reports (e.g. https://github.com/microsoft/vscode/issues/78500) where
		// if VSCode goes down while writing the backup file, the file can turn empty because
		// it always first gets truncated and then written to. In this case, we will not find
		// the meta-end marker ('\n') and as such the backup can only be invalid. We bail out
		// here if that is the case.
		const preambleEndIndex = firstBackupChunk.buffer.indexOf(NativeWorkingCopyBackupServiceImpl.PREAMBLE_END_MARKER_CHARCODE);
		if (preambleEndIndex === -1) {
			this.logService.trace(`Backup: Could not find meta end marker in ${backupResource}. The file is probably corrupt (filesize: ${backupStream.size}).`);

			return undefined;
		}

		const preambelRaw = firstBackupChunk.slice(0, preambleEndIndex).toString();

		// Extract meta data (if any)
		let meta: T | undefined;
		const metaStartIndex = preambelRaw.indexOf(NativeWorkingCopyBackupServiceImpl.PREAMBLE_META_SEPARATOR);
		if (metaStartIndex !== -1) {
			try {
				meta = JSON.parse(preambelRaw.substr(metaStartIndex + 1));

				// `typeId` is a property that we add so we
				// remove it when returning to clients.
				if (typeof meta?.typeId === 'string') {
					delete meta.typeId;

					if (isEmptyObject(meta)) {
						meta = undefined;
					}
				}
			} catch (error) {
				// ignore JSON parse errors
			}
		}

		// Build a new stream without the preamble
		const firstBackupChunkWithoutPreamble = firstBackupChunk.slice(preambleEndIndex + 1);
		let value: VSBufferReadableStream;
		if (peekedBackupStream.ended) {
			value = bufferToStream(firstBackupChunkWithoutPreamble);
		} else {
			value = prefixedBufferStream(firstBackupChunkWithoutPreamble, peekedBackupStream.stream);
		}

		return { value, meta };
	}

	toBackupResource(identifier: IWorkingCopyIdentifier): URI {
		return joinPath(this.backupWorkspaceHome, identifier.resource.scheme, hashIdentifier(identifier));
	}
}

export class InMemoryWorkingCopyBackupService implements IWorkingCopyBackupService {

	declare readonly _serviceBrand: undefined;

	private backups = new ResourceMap<{ typeId: string, content: VSBuffer, meta?: IWorkingCopyBackupMeta }>();

	constructor() { }

	async hasBackups(): Promise<boolean> {
		return this.backups.size > 0;
	}

	hasBackupSync(identifier: IWorkingCopyIdentifier, versionId?: number): boolean {
		const backupResource = this.toBackupResource(identifier);

		return this.backups.has(backupResource);
	}

	async backup(identifier: IWorkingCopyIdentifier, content?: VSBufferReadable | VSBufferReadableStream, versionId?: number, meta?: IWorkingCopyBackupMeta, token?: CancellationToken): Promise<void> {
		const backupResource = this.toBackupResource(identifier);
		this.backups.set(backupResource, {
			typeId: identifier.typeId,
			content: content instanceof VSBuffer ? content : content ? isReadableStream(content) ? await streamToBuffer(content) : readableToBuffer(content) : VSBuffer.fromString(''),
			meta
		});
	}

	async resolve<T extends IWorkingCopyBackupMeta>(identifier: IWorkingCopyIdentifier): Promise<IResolvedWorkingCopyBackup<T> | undefined> {
		const backupResource = this.toBackupResource(identifier);
		const backup = this.backups.get(backupResource);
		if (backup) {
			return { value: bufferToStream(backup.content), meta: backup.meta as T | undefined };
		}

		return undefined;
	}

	async getBackups(): Promise<IWorkingCopyIdentifier[]> {
		return Array.from(this.backups.entries()).map(([resource, backup]) => ({ typeId: backup.typeId, resource }));
	}

	async discardBackup(identifier: IWorkingCopyIdentifier): Promise<void> {
		this.backups.delete(this.toBackupResource(identifier));
	}

	async discardBackups(except?: IWorkingCopyIdentifier[]): Promise<void> {
		if (Array.isArray(except) && except.length > 0) {
			const exceptMap = new ResourceMap<boolean>();
			for (const exceptWorkingCopy of except) {
				exceptMap.set(this.toBackupResource(exceptWorkingCopy), true);
			}

			for (const backup of await this.getBackups()) {
				if (!exceptMap.has(this.toBackupResource(backup))) {
					await this.discardBackup(backup);
				}
			}
		} else {
			this.backups.clear();
		}
	}

	toBackupResource(identifier: IWorkingCopyIdentifier): URI {
		return URI.from({ scheme: Schemas.inMemory, path: hashIdentifier(identifier) });
	}
}

/*
 * Exported only for testing
 */
export function hashIdentifier(identifier: IWorkingCopyIdentifier): string {

	// IMPORTANT: for backwards compatibility, ensure that
	// we ignore the `typeId` unless a value is provided.
	// To preserve previous backups without type id, we
	// need to just hash the resource. Otherwise we use
	// the type id as a seed to the resource path.
	let resource: URI;
	if (identifier.typeId.length > 0) {
		const typeIdHash = hashString(identifier.typeId);
		if (identifier.resource.path) {
			resource = joinPath(identifier.resource, typeIdHash);
		} else {
			resource = identifier.resource.with({ path: typeIdHash });
		}
	} else {
		resource = identifier.resource;
	}

	return hashPath(resource);
}

function hashPath(resource: URI): string {
	const str = resource.scheme === Schemas.file || resource.scheme === Schemas.untitled ? resource.fsPath : resource.toString();

	return hashString(str);
}

function hashString(str: string): string {
	return hash(str).toString(16);
}

// Register Backup Restorer
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(LegacyWorkingCopyBackupRestorer, LifecyclePhase.Starting);
