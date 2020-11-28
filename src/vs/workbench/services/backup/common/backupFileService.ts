/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'vs/base/common/path';
import { joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { coalesce } from 'vs/base/common/arrays';
import { equals, deepClone } from 'vs/base/common/objects';
import { ResourceQueue } from 'vs/base/common/async';
import { IResolvedBackup, IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { IFileService, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { ITextSnapshot } from 'vs/editor/common/model';
import { createTextBufferFactoryFromStream, createTextBufferFactoryFromSnapshot } from 'vs/editor/common/model/textModel';
import { ResourceMap } from 'vs/base/common/map';
import { VSBuffer } from 'vs/base/common/buffer';
import { TextSnapshotReadable, stringToSnapshot } from 'vs/workbench/services/textfile/common/textfiles';
import { Disposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { CancellationToken } from 'vs/base/common/cancellation';

export interface IBackupFilesModel {
	resolve(backupRoot: URI): Promise<IBackupFilesModel>;

	add(resource: URI, versionId?: number, meta?: object): void;
	has(resource: URI, versionId?: number, meta?: object): boolean;
	get(): URI[];
	remove(resource: URI): void;
	count(): number;

	clear(): void;
}

interface IBackupCacheEntry {
	versionId?: number;
	meta?: object;
}

export class BackupFilesModel implements IBackupFilesModel {

	private readonly cache = new ResourceMap<IBackupCacheEntry>();

	constructor(private fileService: IFileService) { }

	async resolve(backupRoot: URI): Promise<IBackupFilesModel> {
		try {
			const backupRootStat = await this.fileService.resolve(backupRoot);
			if (backupRootStat.children) {
				await Promise.all(backupRootStat.children
					.filter(child => child.isDirectory)
					.map(async backupSchema => {

						// Read backup directory for backups
						const backupSchemaStat = await this.fileService.resolve(backupSchema.resource);

						// Remember known backups in our caches
						if (backupSchemaStat.children) {
							backupSchemaStat.children.forEach(backupHash => this.add(backupHash.resource));
						}
					}));
			}
		} catch (error) {
			// ignore any errors
		}

		return this;
	}

	add(resource: URI, versionId = 0, meta?: object): void {
		this.cache.set(resource, { versionId, meta: deepClone(meta) }); // make sure to not store original meta in our cache...
	}

	count(): number {
		return this.cache.size;
	}

	has(resource: URI, versionId?: number, meta?: object): boolean {
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
		return [...this.cache.keys()];
	}

	remove(resource: URI): void {
		this.cache.delete(resource);
	}

	clear(): void {
		this.cache.clear();
	}
}

export abstract class BackupFileService implements IBackupFileService {

	declare readonly _serviceBrand: undefined;

	private impl: BackupFileServiceImpl | InMemoryBackupFileService;

	constructor(
		backupWorkspaceHome: URI | undefined,
		@IFileService protected fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		this.impl = this.initialize(backupWorkspaceHome);
	}

	protected abstract hashPath(resource: URI): string;

	private initialize(backupWorkspaceHome: URI | undefined): BackupFileServiceImpl | InMemoryBackupFileService {
		if (backupWorkspaceHome) {
			return new BackupFileServiceImpl(backupWorkspaceHome, this.hashPath, this.fileService, this.logService);
		}

		return new InMemoryBackupFileService(this.hashPath);
	}

	reinitialize(backupWorkspaceHome: URI | undefined): void {

		// Re-init implementation (unless we are running in-memory)
		if (this.impl instanceof BackupFileServiceImpl) {
			if (backupWorkspaceHome) {
				this.impl.initialize(backupWorkspaceHome);
			} else {
				this.impl = new InMemoryBackupFileService(this.hashPath);
			}
		}
	}

	hasBackups(): Promise<boolean> {
		return this.impl.hasBackups();
	}

	hasBackupSync(resource: URI, versionId?: number): boolean {
		return this.impl.hasBackupSync(resource, versionId);
	}

	backup<T extends object>(resource: URI, content?: ITextSnapshot, versionId?: number, meta?: T, token?: CancellationToken): Promise<void> {
		return this.impl.backup(resource, content, versionId, meta, token);
	}

	discardBackup(resource: URI): Promise<void> {
		return this.impl.discardBackup(resource);
	}

	discardBackups(): Promise<void> {
		return this.impl.discardBackups();
	}

	getBackups(): Promise<URI[]> {
		return this.impl.getBackups();
	}

	resolve<T extends object>(resource: URI): Promise<IResolvedBackup<T> | undefined> {
		return this.impl.resolve(resource);
	}

	toBackupResource(resource: URI): URI {
		return this.impl.toBackupResource(resource);
	}
}

class BackupFileServiceImpl extends Disposable implements IBackupFileService {

	private static readonly PREAMBLE_END_MARKER = '\n';
	private static readonly PREAMBLE_META_SEPARATOR = ' '; // using a character that is know to be escaped in a URI as separator
	private static readonly PREAMBLE_MAX_LENGTH = 10000;

	declare readonly _serviceBrand: undefined;

	private backupWorkspacePath!: URI;

	private readonly ioOperationQueues = this._register(new ResourceQueue()); // queue IO operations to ensure write/delete file order

	private ready!: Promise<IBackupFilesModel>;
	private model!: IBackupFilesModel;

	constructor(
		backupWorkspaceResource: URI,
		private readonly hashPath: (resource: URI) => string,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.initialize(backupWorkspaceResource);
	}

	initialize(backupWorkspaceResource: URI): void {
		this.backupWorkspacePath = backupWorkspaceResource;

		this.ready = this.doInitialize();
	}

	private doInitialize(): Promise<IBackupFilesModel> {
		this.model = new BackupFilesModel(this.fileService);

		return this.model.resolve(this.backupWorkspacePath);
	}

	async hasBackups(): Promise<boolean> {
		const model = await this.ready;

		return model.count() > 0;
	}

	hasBackupSync(resource: URI, versionId?: number): boolean {
		const backupResource = this.toBackupResource(resource);

		return this.model.has(backupResource, versionId);
	}

	async backup<T extends object>(resource: URI, content?: ITextSnapshot, versionId?: number, meta?: T, token?: CancellationToken): Promise<void> {
		const model = await this.ready;
		if (token?.isCancellationRequested) {
			return;
		}

		const backupResource = this.toBackupResource(resource);
		if (model.has(backupResource, versionId, meta)) {
			return; // return early if backup version id matches requested one
		}

		return this.ioOperationQueues.queueFor(backupResource).queue(async () => {
			if (token?.isCancellationRequested) {
				return;
			}

			let preamble: string | undefined = undefined;

			// With Metadata: URI + META-START + Meta + END
			if (meta) {
				const preambleWithMeta = `${resource.toString()}${BackupFileServiceImpl.PREAMBLE_META_SEPARATOR}${JSON.stringify(meta)}${BackupFileServiceImpl.PREAMBLE_END_MARKER}`;
				if (preambleWithMeta.length < BackupFileServiceImpl.PREAMBLE_MAX_LENGTH) {
					preamble = preambleWithMeta;
				}
			}

			// Without Metadata: URI + END
			if (!preamble) {
				preamble = `${resource.toString()}${BackupFileServiceImpl.PREAMBLE_END_MARKER}`;
			}

			// Update content with value
			await this.fileService.writeFile(backupResource, new TextSnapshotReadable(content || stringToSnapshot(''), preamble));

			// Update model
			model.add(backupResource, versionId, meta);
		});
	}

	async discardBackups(): Promise<void> {
		const model = await this.ready;

		await this.deleteIgnoreFileNotFound(this.backupWorkspacePath);

		model.clear();
	}

	discardBackup(resource: URI): Promise<void> {
		const backupResource = this.toBackupResource(resource);

		return this.doDiscardBackup(backupResource);
	}

	private async doDiscardBackup(backupResource: URI): Promise<void> {
		const model = await this.ready;

		return this.ioOperationQueues.queueFor(backupResource).queue(async () => {
			await this.deleteIgnoreFileNotFound(backupResource);

			model.remove(backupResource);
		});
	}

	private async deleteIgnoreFileNotFound(resource: URI): Promise<void> {
		try {
			await this.fileService.del(resource, { recursive: true });
		} catch (error) {
			if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
				throw error; // re-throw any other error than file not found which is OK
			}
		}
	}

	async getBackups(): Promise<URI[]> {
		const model = await this.ready;

		const backups = await Promise.all(model.get().map(async backupResource => {
			const backupPreamble = await this.readToMatchingString(backupResource, BackupFileServiceImpl.PREAMBLE_END_MARKER, BackupFileServiceImpl.PREAMBLE_MAX_LENGTH);
			if (!backupPreamble) {
				return undefined;
			}

			// Preamble with metadata: URI + META-START + Meta + END
			const metaStartIndex = backupPreamble.indexOf(BackupFileServiceImpl.PREAMBLE_META_SEPARATOR);
			if (metaStartIndex > 0) {
				return URI.parse(backupPreamble.substring(0, metaStartIndex));
			}

			// Preamble without metadata: URI + END
			else {
				return URI.parse(backupPreamble);
			}
		}));

		return coalesce(backups);
	}

	private async readToMatchingString(file: URI, matchingString: string, maximumBytesToRead: number): Promise<string | undefined> {
		const contents = (await this.fileService.readFile(file, { length: maximumBytesToRead })).value.toString();

		const matchingStringIndex = contents.indexOf(matchingString);
		if (matchingStringIndex >= 0) {
			return contents.substr(0, matchingStringIndex);
		}

		// Unable to find matching string in file
		return undefined;
	}

	async resolve<T extends object>(resource: URI): Promise<IResolvedBackup<T> | undefined> {
		const backupResource = this.toBackupResource(resource);

		const model = await this.ready;
		if (!model.has(backupResource)) {
			return undefined; // require backup to be present
		}

		// Metadata extraction
		let metaRaw = '';
		let metaEndFound = false;

		// Add a filter method to filter out everything until the meta end marker
		const metaPreambleFilter = (chunk: VSBuffer) => {
			const chunkString = chunk.toString();

			if (!metaEndFound) {
				const metaEndIndex = chunkString.indexOf(BackupFileServiceImpl.PREAMBLE_END_MARKER);
				if (metaEndIndex === -1) {
					metaRaw += chunkString;

					return VSBuffer.fromString(''); // meta not yet found, return empty string
				}

				metaEndFound = true;
				metaRaw += chunkString.substring(0, metaEndIndex); // ensure to get last chunk from metadata

				return VSBuffer.fromString(chunkString.substr(metaEndIndex + 1)); // meta found, return everything after
			}

			return chunk;
		};

		// Read backup into factory
		const content = await this.fileService.readFileStream(backupResource);
		const factory = await createTextBufferFactoryFromStream(content.value, metaPreambleFilter);

		// Extract meta data (if any)
		let meta: T | undefined;
		const metaStartIndex = metaRaw.indexOf(BackupFileServiceImpl.PREAMBLE_META_SEPARATOR);
		if (metaStartIndex !== -1) {
			try {
				meta = JSON.parse(metaRaw.substr(metaStartIndex + 1));
			} catch (error) {
				// ignore JSON parse errors
			}
		}

		// We have seen reports (e.g. https://github.com/microsoft/vscode/issues/78500) where
		// if VSCode goes down while writing the backup file, the file can turn empty because
		// it always first gets truncated and then written to. In this case, we will not find
		// the meta-end marker ('\n') and as such the backup can only be invalid. We bail out
		// here if that is the case.
		if (!metaEndFound) {
			this.logService.trace(`Backup: Could not find meta end marker in ${backupResource}. The file is probably corrupt (filesize: ${content.size}).`);

			return undefined;
		}

		return { value: factory, meta };
	}

	toBackupResource(resource: URI): URI {
		return joinPath(this.backupWorkspacePath, resource.scheme, this.hashPath(resource));
	}
}

export class InMemoryBackupFileService implements IBackupFileService {

	declare readonly _serviceBrand: undefined;

	private backups: Map<string, ITextSnapshot> = new Map();

	constructor(private readonly hashPath: (resource: URI) => string) { }

	async hasBackups(): Promise<boolean> {
		return this.backups.size > 0;
	}

	hasBackupSync(resource: URI, versionId?: number): boolean {
		const backupResource = this.toBackupResource(resource);

		return this.backups.has(backupResource.toString());
	}

	async backup<T extends object>(resource: URI, content?: ITextSnapshot, versionId?: number, meta?: T, token?: CancellationToken): Promise<void> {
		const backupResource = this.toBackupResource(resource);
		this.backups.set(backupResource.toString(), content || stringToSnapshot(''));
	}

	async resolve<T extends object>(resource: URI): Promise<IResolvedBackup<T> | undefined> {
		const backupResource = this.toBackupResource(resource);
		const snapshot = this.backups.get(backupResource.toString());
		if (snapshot) {
			return { value: createTextBufferFactoryFromSnapshot(snapshot) };
		}

		return undefined;
	}

	async getBackups(): Promise<URI[]> {
		return Array.from(this.backups.keys()).map(key => URI.parse(key));
	}

	async discardBackup(resource: URI): Promise<void> {
		this.backups.delete(this.toBackupResource(resource).toString());
	}

	async discardBackups(): Promise<void> {
		this.backups.clear();
	}

	toBackupResource(resource: URI): URI {
		return URI.file(join(resource.scheme, this.hashPath(resource)));
	}
}
