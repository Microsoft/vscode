/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IFileService, IFileContent, FileChangesEvent, FileOperationResult, FileOperationError } from 'vs/platform/files/common/files';
import { VSBuffer } from 'vs/base/common/buffer';
import { URI } from 'vs/base/common/uri';
import { SyncResource, SyncStatus, IUserData, IUserDataSyncStoreService, UserDataSyncErrorCode, UserDataSyncError, IUserDataSyncLogService, IUserDataSyncUtilService, IUserDataSyncEnablementService, IUserDataSyncBackupStoreService, Conflict, ISyncResourceHandle, USER_DATA_SYNC_SCHEME, ISyncPreviewResult } from 'vs/platform/userDataSync/common/userDataSync';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { joinPath, dirname, isEqual, basename } from 'vs/base/common/resources';
import { CancelablePromise } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ParseError, parse } from 'vs/base/common/json';
import { FormattingOptions } from 'vs/base/common/jsonFormatter';
import { IStringDictionary } from 'vs/base/common/collections';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { isString } from 'vs/base/common/types';
import { uppercaseFirstLetter } from 'vs/base/common/strings';
import { equals } from 'vs/base/common/arrays';

type SyncSourceClassification = {
	source?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

export interface IRemoteUserData {
	ref: string;
	syncData: ISyncData | null;
}

export interface ISyncData {
	version: number;
	content: string;
}

function isSyncData(thing: any): thing is ISyncData {
	return thing
		&& (thing.version && typeof thing.version === 'number')
		&& (thing.content && typeof thing.content === 'string')
		&& Object.keys(thing).length === 2;
}

export abstract class AbstractSynchroniser extends Disposable {

	protected readonly syncFolder: URI;

	private _status: SyncStatus = SyncStatus.Idle;
	get status(): SyncStatus { return this._status; }
	private _onDidChangStatus: Emitter<SyncStatus> = this._register(new Emitter<SyncStatus>());
	readonly onDidChangeStatus: Event<SyncStatus> = this._onDidChangStatus.event;

	private _conflicts: Conflict[] = [];
	get conflicts(): Conflict[] { return this._conflicts; }
	private _onDidChangeConflicts: Emitter<Conflict[]> = this._register(new Emitter<Conflict[]>());
	readonly onDidChangeConflicts: Event<Conflict[]> = this._onDidChangeConflicts.event;

	protected readonly _onDidChangeLocal: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChangeLocal: Event<void> = this._onDidChangeLocal.event;

	protected readonly lastSyncResource: URI;
	protected readonly syncResourceLogLabel: string;

	constructor(
		readonly resource: SyncResource,
		@IFileService protected readonly fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncStoreService protected readonly userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService protected readonly userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncEnablementService protected readonly userDataSyncEnablementService: IUserDataSyncEnablementService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IUserDataSyncLogService protected readonly logService: IUserDataSyncLogService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
	) {
		super();
		this.syncResourceLogLabel = uppercaseFirstLetter(this.resource);
		this.syncFolder = joinPath(environmentService.userDataSyncHome, resource);
		this.lastSyncResource = joinPath(this.syncFolder, `lastSync${this.resource}.json`);
	}

	protected setStatus(status: SyncStatus): void {
		if (this._status !== status) {
			const oldStatus = this._status;
			this._status = status;
			this._onDidChangStatus.fire(status);
			if (status === SyncStatus.HasConflicts) {
				// Log to telemetry when there is a sync conflict
				this.telemetryService.publicLog2<{ source: string }, SyncSourceClassification>('sync/conflictsDetected', { source: this.resource });
			}
			if (oldStatus === SyncStatus.HasConflicts && status === SyncStatus.Idle) {
				// Log to telemetry when conflicts are resolved
				this.telemetryService.publicLog2<{ source: string }, SyncSourceClassification>('sync/conflictsResolved', { source: this.resource });
			}
			if (this.status !== SyncStatus.HasConflicts) {
				this.setConflicts([]);
			}
		}
	}

	protected setConflicts(conflicts: Conflict[]) {
		if (!equals(this._conflicts, conflicts, (a, b) => isEqual(a.local, b.local) && isEqual(a.remote, b.remote))) {
			this._conflicts = conflicts;
			this._onDidChangeConflicts.fire(this._conflicts);
		}
	}

	protected isEnabled(): boolean { return this.userDataSyncEnablementService.isResourceEnabled(this.resource); }

	async sync(ref?: string): Promise<void> {
		if (!this.isEnabled()) {
			if (this.status !== SyncStatus.Idle) {
				await this.stop();
			}
			this.logService.info(`${this.syncResourceLogLabel}: Skipped synchronizing ${this.resource.toLowerCase()} as it is disabled.`);
			return;
		}
		if (this.status === SyncStatus.HasConflicts) {
			this.logService.info(`${this.syncResourceLogLabel}: Skipped synchronizing ${this.resource.toLowerCase()} as there are conflicts.`);
			return;
		}
		if (this.status === SyncStatus.Syncing) {
			this.logService.info(`${this.syncResourceLogLabel}: Skipped synchronizing ${this.resource.toLowerCase()} as it is running already.`);
			return;
		}

		this.logService.trace(`${this.syncResourceLogLabel}: Started synchronizing ${this.resource.toLowerCase()}...`);
		this.setStatus(SyncStatus.Syncing);

		const lastSyncUserData = await this.getLastSyncUserData();
		const remoteUserData = ref && lastSyncUserData && lastSyncUserData.ref === ref ? lastSyncUserData : await this.getRemoteUserData(lastSyncUserData);

		let status: SyncStatus = SyncStatus.Idle;
		try {
			status = await this.doSync(remoteUserData, lastSyncUserData);
			if (status === SyncStatus.HasConflicts) {
				this.logService.info(`${this.syncResourceLogLabel}: Detected conflicts while synchronizing ${this.resource.toLowerCase()}.`);
			} else if (status === SyncStatus.Idle) {
				this.logService.trace(`${this.syncResourceLogLabel}: Finished synchronizing ${this.resource.toLowerCase()}.`);
			}
		} finally {
			this.setStatus(status);
		}
	}

	async getSyncPreview(): Promise<ISyncPreviewResult> {
		if (!this.isEnabled()) {
			return { hasLocalChanged: false, hasRemoteChanged: false };
		}

		const lastSyncUserData = await this.getLastSyncUserData();
		const remoteUserData = await this.getRemoteUserData(lastSyncUserData);
		return this.generatePreview(remoteUserData, lastSyncUserData);
	}

	protected async doSync(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null): Promise<SyncStatus> {
		if (remoteUserData.syncData && remoteUserData.syncData.version > this.version) {
			// current version is not compatible with cloud version
			this.telemetryService.publicLog2<{ source: string }, SyncSourceClassification>('sync/incompatible', { source: this.resource });
			throw new UserDataSyncError(localize('incompatible', "Cannot sync {0} as its version {1} is not compatible with cloud {2}", this.resource, this.version, remoteUserData.syncData.version), UserDataSyncErrorCode.Incompatible, this.resource);
		}
		try {
			const status = await this.performSync(remoteUserData, lastSyncUserData);
			return status;
		} catch (e) {
			if (e instanceof UserDataSyncError) {
				switch (e.code) {
					case UserDataSyncErrorCode.RemotePreconditionFailed:
						// Rejected as there is a new remote version. Syncing again...
						this.logService.info(`${this.syncResourceLogLabel}: Failed to synchronize as there is a new remote version available. Synchronizing again...`);

						// Avoid cache and get latest remote user data - https://github.com/microsoft/vscode/issues/90624
						remoteUserData = await this.getRemoteUserData(null);

						// Get the latest last sync user data. Because multiples parallel syncs (in Web) could share same last sync data
						// and one of them successfully updated remote and last sync state.
						lastSyncUserData = await this.getLastSyncUserData();

						return this.doSync(remoteUserData, lastSyncUserData);
				}
			}
			throw e;
		}
	}

	async hasPreviouslySynced(): Promise<boolean> {
		const lastSyncData = await this.getLastSyncUserData();
		return !!lastSyncData;
	}

	async getRemoteSyncResourceHandles(): Promise<ISyncResourceHandle[]> {
		const handles = await this.userDataSyncStoreService.getAllRefs(this.resource);
		return handles.map(({ created, ref }) => ({ created, uri: this.toRemoteBackupResource(ref) }));
	}

	async getLocalSyncResourceHandles(): Promise<ISyncResourceHandle[]> {
		const handles = await this.userDataSyncBackupStoreService.getAllRefs(this.resource);
		return handles.map(({ created, ref }) => ({ created, uri: this.toLocalBackupResource(ref) }));
	}

	private toRemoteBackupResource(ref: string): URI {
		return URI.from({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote-backup', path: `/${this.resource}/${ref}` });
	}

	private toLocalBackupResource(ref: string): URI {
		return URI.from({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local-backup', path: `/${this.resource}/${ref}` });
	}

	async resolveContent(uri: URI): Promise<string | null> {
		const ref = basename(uri);
		if (isEqual(uri, this.toRemoteBackupResource(ref))) {
			const { content } = await this.getUserData(ref);
			return content;
		}
		if (isEqual(uri, this.toLocalBackupResource(ref))) {
			return this.userDataSyncBackupStoreService.resolveContent(this.resource, ref);
		}
		return null;
	}

	async resetLocal(): Promise<void> {
		try {
			await this.fileService.del(this.lastSyncResource);
		} catch (e) { /* ignore */ }
	}

	protected async getLastSyncUserData<T extends IRemoteUserData>(): Promise<T | null> {
		try {
			const content = await this.fileService.readFile(this.lastSyncResource);
			const parsed = JSON.parse(content.value.toString());
			let syncData: ISyncData = JSON.parse(parsed.content);

			// Migration from old content to sync data
			if (!isSyncData(syncData)) {
				syncData = { version: this.version, content: parsed.content };
			}

			return { ...parsed, ...{ syncData, content: undefined } };
		} catch (error) {
			if (!(error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND)) {
				// log error always except when file does not exist
				this.logService.error(error);
			}
		}
		return null;
	}

	protected async updateLastSyncUserData(lastSyncRemoteUserData: IRemoteUserData, additionalProps: IStringDictionary<any> = {}): Promise<void> {
		const lastSyncUserData: IUserData = { ref: lastSyncRemoteUserData.ref, content: JSON.stringify(lastSyncRemoteUserData.syncData), ...additionalProps };
		await this.fileService.writeFile(this.lastSyncResource, VSBuffer.fromString(JSON.stringify(lastSyncUserData)));
	}

	protected async getRemoteUserData(lastSyncData: IRemoteUserData | null): Promise<IRemoteUserData> {
		const { ref, content } = await this.getUserData(lastSyncData);
		let syncData: ISyncData | null = null;
		if (content !== null) {
			syncData = this.parseSyncData(content);
		}
		return { ref, syncData };
	}

	protected parseSyncData(content: string): ISyncData | null {
		let syncData: ISyncData | null = null;
		try {
			syncData = <ISyncData>JSON.parse(content);

			// Migration from old content to sync data
			if (!isSyncData(syncData)) {
				syncData = { version: this.version, content };
			}

		} catch (e) {
			this.logService.error(e);
		}
		return syncData;
	}

	private async getUserData(refOrLastSyncData: string | IRemoteUserData | null): Promise<IUserData> {
		if (isString(refOrLastSyncData)) {
			const content = await this.userDataSyncStoreService.resolveContent(this.resource, refOrLastSyncData);
			return { ref: refOrLastSyncData, content };
		} else {
			const lastSyncUserData: IUserData | null = refOrLastSyncData ? { ref: refOrLastSyncData.ref, content: refOrLastSyncData.syncData ? JSON.stringify(refOrLastSyncData.syncData) : null } : null;
			return this.userDataSyncStoreService.read(this.resource, lastSyncUserData);
		}
	}

	protected async updateRemoteUserData(content: string, ref: string | null): Promise<IRemoteUserData> {
		const syncData: ISyncData = { version: this.version, content };
		ref = await this.userDataSyncStoreService.write(this.resource, JSON.stringify(syncData), ref);
		return { ref, syncData };
	}

	protected async backupLocal(content: string): Promise<void> {
		const syncData: ISyncData = { version: this.version, content };
		return this.userDataSyncBackupStoreService.backup(this.resource, JSON.stringify(syncData));
	}

	abstract stop(): Promise<void>;

	protected abstract readonly version: number;
	protected abstract performSync(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null): Promise<SyncStatus>;
	protected abstract generatePreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null): Promise<ISyncPreviewResult>;
}

export interface IFileSyncPreviewResult extends ISyncPreviewResult {
	readonly fileContent: IFileContent | null;
	readonly remoteUserData: IRemoteUserData;
	readonly lastSyncUserData: IRemoteUserData | null;
	readonly content: string | null;
	readonly hasConflicts: boolean;
}

export abstract class AbstractFileSynchroniser extends AbstractSynchroniser {

	protected syncPreviewResultPromise: CancelablePromise<IFileSyncPreviewResult> | null = null;

	constructor(
		protected readonly file: URI,
		resource: SyncResource,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncEnablementService userDataSyncEnablementService: IUserDataSyncEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(resource, fileService, environmentService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncEnablementService, telemetryService, logService, configurationService);
		this._register(this.fileService.watch(dirname(file)));
		this._register(this.fileService.onDidFilesChange(e => this.onFileChanges(e)));
	}

	async stop(): Promise<void> {
		this.cancel();
		this.logService.info(`${this.syncResourceLogLabel}: Stopped synchronizing ${this.resource.toLowerCase()}.`);
		try {
			await this.fileService.del(this.localPreviewResource);
		} catch (e) { /* ignore */ }
		this.setStatus(SyncStatus.Idle);
	}

	protected async getConflictContent(conflictResource: URI): Promise<string | null> {
		if (isEqual(this.remotePreviewResource, conflictResource) || isEqual(this.localPreviewResource, conflictResource)) {
			if (this.syncPreviewResultPromise) {
				const result = await this.syncPreviewResultPromise;
				if (isEqual(this.remotePreviewResource, conflictResource)) {
					return result.remoteUserData && result.remoteUserData.syncData ? result.remoteUserData.syncData.content : null;
				}
				if (isEqual(this.localPreviewResource, conflictResource)) {
					return result.fileContent ? result.fileContent.value.toString() : null;
				}
			}
		}
		return null;
	}

	protected async getLocalFileContent(): Promise<IFileContent | null> {
		try {
			return await this.fileService.readFile(this.file);
		} catch (error) {
			return null;
		}
	}

	protected async updateLocalFileContent(newContent: string, oldContent: IFileContent | null): Promise<void> {
		try {
			if (oldContent) {
				// file exists already
				await this.fileService.writeFile(this.file, VSBuffer.fromString(newContent), oldContent);
			} else {
				// file does not exist
				await this.fileService.createFile(this.file, VSBuffer.fromString(newContent), { overwrite: false });
			}
		} catch (e) {
			if ((e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) ||
				(e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE)) {
				throw new UserDataSyncError(e.message, UserDataSyncErrorCode.LocalPreconditionFailed);
			} else {
				throw e;
			}
		}
	}

	private onFileChanges(e: FileChangesEvent): void {
		if (!e.contains(this.file)) {
			return;
		}

		if (!this.isEnabled()) {
			return;
		}

		// Sync again if local file has changed and current status is in conflicts
		if (this.status === SyncStatus.HasConflicts) {
			this.syncPreviewResultPromise?.then(result => {
				this.cancel();
				this.doSync(result.remoteUserData, result.lastSyncUserData).then(status => this.setStatus(status));
			});
		}

		// Otherwise fire change event
		else {
			this._onDidChangeLocal.fire();
		}

	}

	protected cancel(): void {
		if (this.syncPreviewResultPromise) {
			this.syncPreviewResultPromise.cancel();
			this.syncPreviewResultPromise = null;
		}
	}

	protected abstract readonly localPreviewResource: URI;
	protected abstract readonly remotePreviewResource: URI;
}

export abstract class AbstractJsonFileSynchroniser extends AbstractFileSynchroniser {

	constructor(
		file: URI,
		resource: SyncResource,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncEnablementService userDataSyncEnablementService: IUserDataSyncEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IUserDataSyncUtilService protected readonly userDataSyncUtilService: IUserDataSyncUtilService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(file, resource, fileService, environmentService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncEnablementService, telemetryService, logService, configurationService);
	}

	protected hasErrors(content: string): boolean {
		const parseErrors: ParseError[] = [];
		parse(content, parseErrors, { allowEmptyContent: true, allowTrailingComma: true });
		return parseErrors.length > 0;
	}

	private _formattingOptions: Promise<FormattingOptions> | undefined = undefined;
	protected getFormattingOptions(): Promise<FormattingOptions> {
		if (!this._formattingOptions) {
			this._formattingOptions = this.userDataSyncUtilService.resolveFormattingOptions(this.file);
		}
		return this._formattingOptions;
	}

}
