/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServerChannel, IChannel } from 'vs/base/parts/ipc/common/ipc';
import { Emitter, Event } from 'vs/base/common/event';
import { IUserDataSyncService, IManualSyncTask, IUserDataManifest, SyncStatus, IResourcePreview, ISyncResourceHandle, ISyncResourcePreview, ISyncTask, SyncResource, UserDataSyncError } from 'vs/platform/userDataSync/common/userDataSync';
import { URI } from 'vs/base/common/uri';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { CancellationToken } from 'vs/base/common/cancellation';
import { isArray } from 'vs/base/common/types';

type ManualSyncTaskEvent<T> = { manualSyncTaskId: string, data: T };

export class UserDataSyncChannel implements IServerChannel {

	private readonly manualSyncTasks = new Map<string, { manualSyncTask: IManualSyncTask, disposables: DisposableStore }>();
	private readonly onManualSynchronizeResources = new Emitter<ManualSyncTaskEvent<[SyncResource, URI[]][]>>();

	constructor(private readonly service: IUserDataSyncService, private readonly logService: ILogService) { }

	listen(_: unknown, event: string): Event<any> {
		switch (event) {
			// sync
			case 'onDidChangeStatus': return this.service.onDidChangeStatus;
			case 'onDidChangeConflicts': return this.service.onDidChangeConflicts;
			case 'onDidChangeLocal': return this.service.onDidChangeLocal;
			case 'onDidChangeLastSyncTime': return this.service.onDidChangeLastSyncTime;
			case 'onSyncErrors': return this.service.onSyncErrors;
			case 'onDidResetLocal': return this.service.onDidResetLocal;
			case 'onDidResetRemote': return this.service.onDidResetRemote;

			// manual sync
			case 'manualSync/onSynchronizeResources': return this.onManualSynchronizeResources.event;
		}

		throw new Error(`Event not found: ${event}`);
	}

	async call(context: any, command: string, args?: any): Promise<any> {
		try {
			const result = await this._call(context, command, args);
			return result;
		} catch (e) {
			this.logService.error(e);
			throw e;
		}
	}

	private async _call(context: any, command: string, args?: any): Promise<any> {
		switch (command) {

			// sync
			case '_getInitialData': return Promise.resolve([this.service.status, this.service.conflicts, this.service.lastSyncTime]);
			case 'replace': return this.service.replace(URI.revive(args[0]));
			case 'reset': return this.service.reset();
			case 'resetRemote': return this.service.resetRemote();
			case 'resetLocal': return this.service.resetLocal();
			case 'hasPreviouslySynced': return this.service.hasPreviouslySynced();
			case 'hasLocalData': return this.service.hasLocalData();
			case 'accept': return this.service.accept(args[0], URI.revive(args[1]), args[2], args[3]);
			case 'resolveContent': return this.service.resolveContent(URI.revive(args[0]));
			case 'getLocalSyncResourceHandles': return this.service.getLocalSyncResourceHandles(args[0]);
			case 'getRemoteSyncResourceHandles': return this.service.getRemoteSyncResourceHandles(args[0]);
			case 'getAssociatedResources': return this.service.getAssociatedResources(args[0], { created: args[1].created, uri: URI.revive(args[1].uri) });
			case 'getMachineId': return this.service.getMachineId(args[0], { created: args[1].created, uri: URI.revive(args[1].uri) });

			case 'createManualSyncTask': return this.createManualSyncTask();
		}

		// manual sync
		if (command.startsWith('manualSync/')) {
			const manualSyncTaskCommand = command.substring('manualSync/'.length);
			const manualSyncTaskId = args[0];
			const manualSyncTask = this.getManualSyncTask(manualSyncTaskId);
			args = (<Array<any>>args).slice(1);

			switch (manualSyncTaskCommand) {
				case 'preview': return manualSyncTask.preview();
				case 'accept': return manualSyncTask.accept(URI.revive(args[0]), args[1]);
				case 'merge': return manualSyncTask.merge(URI.revive(args[0]));
				case 'discard': return manualSyncTask.discard(URI.revive(args[0]));
				case 'discardConflicts': return manualSyncTask.discardConflicts();
				case 'apply': return manualSyncTask.apply();
				case 'pull': return manualSyncTask.pull();
				case 'push': return manualSyncTask.push();
				case 'stop': return manualSyncTask.stop();
				case '_getStatus': return manualSyncTask.status;
				case 'dispose': return this.disposeManualSyncTask(manualSyncTask);
			}
		}

		throw new Error('Invalid call');
	}

	private getManualSyncTask(manualSyncTaskId: string): IManualSyncTask {
		const value = this.manualSyncTasks.get(this.createKey(manualSyncTaskId));
		if (!value) {
			throw new Error(`Manual sync taks not found: ${manualSyncTaskId}`);
		}
		return value.manualSyncTask;
	}

	private async createManualSyncTask(): Promise<{ id: string, manifest: IUserDataManifest | null, status: SyncStatus }> {
		const disposables = new DisposableStore();
		const manualSyncTask = disposables.add(await this.service.createManualSyncTask());
		disposables.add(manualSyncTask.onSynchronizeResources(synchronizeResources => this.onManualSynchronizeResources.fire({ manualSyncTaskId: manualSyncTask.id, data: synchronizeResources })));
		this.manualSyncTasks.set(this.createKey(manualSyncTask.id), { manualSyncTask, disposables });
		return { id: manualSyncTask.id, manifest: manualSyncTask.manifest, status: manualSyncTask.status };
	}

	private disposeManualSyncTask(manualSyncTask: IManualSyncTask): void {
		manualSyncTask.dispose();
		const key = this.createKey(manualSyncTask.id);
		this.manualSyncTasks.get(key)?.disposables.dispose();
		this.manualSyncTasks.delete(key);
	}

	private createKey(manualSyncTaskId: string): string { return `manualSyncTask-${manualSyncTaskId}`; }

}

export class UserDataSyncChannelClient extends Disposable implements IUserDataSyncService {

	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;

	private _status: SyncStatus = SyncStatus.Uninitialized;
	get status(): SyncStatus { return this._status; }
	private _onDidChangeStatus: Emitter<SyncStatus> = this._register(new Emitter<SyncStatus>());
	readonly onDidChangeStatus: Event<SyncStatus> = this._onDidChangeStatus.event;

	get onDidChangeLocal(): Event<SyncResource> { return this.channel.listen<SyncResource>('onDidChangeLocal'); }

	private _conflicts: [SyncResource, IResourcePreview[]][] = [];
	get conflicts(): [SyncResource, IResourcePreview[]][] { return this._conflicts; }
	private _onDidChangeConflicts: Emitter<[SyncResource, IResourcePreview[]][]> = this._register(new Emitter<[SyncResource, IResourcePreview[]][]>());
	readonly onDidChangeConflicts: Event<[SyncResource, IResourcePreview[]][]> = this._onDidChangeConflicts.event;

	private _lastSyncTime: number | undefined = undefined;
	get lastSyncTime(): number | undefined { return this._lastSyncTime; }
	private _onDidChangeLastSyncTime: Emitter<number> = this._register(new Emitter<number>());
	readonly onDidChangeLastSyncTime: Event<number> = this._onDidChangeLastSyncTime.event;

	private _onSyncErrors: Emitter<[SyncResource, UserDataSyncError][]> = this._register(new Emitter<[SyncResource, UserDataSyncError][]>());
	readonly onSyncErrors: Event<[SyncResource, UserDataSyncError][]> = this._onSyncErrors.event;

	get onDidResetLocal(): Event<void> { return this.channel.listen<void>('onDidResetLocal'); }
	get onDidResetRemote(): Event<void> { return this.channel.listen<void>('onDidResetRemote'); }

	constructor(userDataSyncChannel: IChannel) {
		super();
		this.channel = {
			call<T>(command: string, arg?: any, cancellationToken?: CancellationToken): Promise<T> {
				return userDataSyncChannel.call(command, arg, cancellationToken)
					.then(null, error => { throw UserDataSyncError.toUserDataSyncError(error); });
			},
			listen<T>(event: string, arg?: any): Event<T> {
				return userDataSyncChannel.listen(event, arg);
			}
		};
		this.channel.call<[SyncStatus, [SyncResource, IResourcePreview[]][], number | undefined]>('_getInitialData').then(([status, conflicts, lastSyncTime]) => {
			this.updateStatus(status);
			this.updateConflicts(conflicts);
			if (lastSyncTime) {
				this.updateLastSyncTime(lastSyncTime);
			}
			this._register(this.channel.listen<SyncStatus>('onDidChangeStatus')(status => this.updateStatus(status)));
			this._register(this.channel.listen<number>('onDidChangeLastSyncTime')(lastSyncTime => this.updateLastSyncTime(lastSyncTime)));
		});
		this._register(this.channel.listen<[SyncResource, IResourcePreview[]][]>('onDidChangeConflicts')(conflicts => this.updateConflicts(conflicts)));
		this._register(this.channel.listen<[SyncResource, Error][]>('onSyncErrors')(errors => this._onSyncErrors.fire(errors.map(([source, error]) => ([source, UserDataSyncError.toUserDataSyncError(error)])))));
	}

	createSyncTask(): Promise<ISyncTask> {
		throw new Error('not supported');
	}

	async createManualSyncTask(): Promise<IManualSyncTask> {
		const { id, manifest, status } = await this.channel.call<{ id: string, manifest: IUserDataManifest | null, status: SyncStatus }>('createManualSyncTask');
		const that = this;
		const manualSyncTaskChannelClient = new ManualSyncTaskChannelClient(id, manifest, status, {
			async call<T>(command: string, arg?: any, cancellationToken?: CancellationToken): Promise<T> {
				return that.channel.call<T>(`manualSync/${command}`, [id, ...(isArray(arg) ? arg : [arg])], cancellationToken);
			},
			listen<T>(event: string, arg?: any): Event<T> {
				return Event.map(
					Event.filter(that.channel.listen<{ manualSyncTaskId: string, data: T }>(`manualSync/${event}`, arg), e => !manualSyncTaskChannelClient.isDiposed() && e.manualSyncTaskId === id),
					e => e.data);
			}
		});
		return manualSyncTaskChannelClient;
	}

	replace(uri: URI): Promise<void> {
		return this.channel.call('replace', [uri]);
	}

	reset(): Promise<void> {
		return this.channel.call('reset');
	}

	resetRemote(): Promise<void> {
		return this.channel.call('resetRemote');
	}

	resetLocal(): Promise<void> {
		return this.channel.call('resetLocal');
	}

	hasPreviouslySynced(): Promise<boolean> {
		return this.channel.call('hasPreviouslySynced');
	}

	hasLocalData(): Promise<boolean> {
		return this.channel.call('hasLocalData');
	}

	accept(syncResource: SyncResource, resource: URI, content: string | null, apply: boolean): Promise<void> {
		return this.channel.call('accept', [syncResource, resource, content, apply]);
	}

	resolveContent(resource: URI): Promise<string | null> {
		return this.channel.call('resolveContent', [resource]);
	}

	async getLocalSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]> {
		const handles = await this.channel.call<ISyncResourceHandle[]>('getLocalSyncResourceHandles', [resource]);
		return handles.map(({ created, uri }) => ({ created, uri: URI.revive(uri) }));
	}

	async getRemoteSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]> {
		const handles = await this.channel.call<ISyncResourceHandle[]>('getRemoteSyncResourceHandles', [resource]);
		return handles.map(({ created, uri }) => ({ created, uri: URI.revive(uri) }));
	}

	async getAssociatedResources(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<{ resource: URI, comparableResource: URI }[]> {
		const result = await this.channel.call<{ resource: URI, comparableResource: URI }[]>('getAssociatedResources', [resource, syncResourceHandle]);
		return result.map(({ resource, comparableResource }) => ({ resource: URI.revive(resource), comparableResource: URI.revive(comparableResource) }));
	}

	async getMachineId(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<string | undefined> {
		return this.channel.call<string | undefined>('getMachineId', [resource, syncResourceHandle]);
	}

	private async updateStatus(status: SyncStatus): Promise<void> {
		this._status = status;
		this._onDidChangeStatus.fire(status);
	}

	private async updateConflicts(conflicts: [SyncResource, IResourcePreview[]][]): Promise<void> {
		// Revive URIs
		this._conflicts = conflicts.map(([syncResource, conflicts]) =>
		([
			syncResource,
			conflicts.map(r =>
			({
				...r,
				localResource: URI.revive(r.localResource),
				remoteResource: URI.revive(r.remoteResource),
				previewResource: URI.revive(r.previewResource),
			}))
		]));
		this._onDidChangeConflicts.fire(this._conflicts);
	}

	private updateLastSyncTime(lastSyncTime: number): void {
		if (this._lastSyncTime !== lastSyncTime) {
			this._lastSyncTime = lastSyncTime;
			this._onDidChangeLastSyncTime.fire(lastSyncTime);
		}
	}
}

class ManualSyncTaskChannelClient extends Disposable implements IManualSyncTask {

	private readonly channel: IChannel;

	get onSynchronizeResources(): Event<[SyncResource, URI[]][]> { return this.channel.listen<[SyncResource, URI[]][]>('onSynchronizeResources'); }

	private _status: SyncStatus;
	get status(): SyncStatus { return this._status; }

	constructor(
		readonly id: string,
		readonly manifest: IUserDataManifest | null,
		status: SyncStatus,
		manualSyncTaskChannel: IChannel
	) {
		super();
		this._status = status;
		const that = this;
		this.channel = {
			async call<T>(command: string, arg?: any, cancellationToken?: CancellationToken): Promise<T> {
				try {
					const result = await manualSyncTaskChannel.call<T>(command, arg, cancellationToken);
					if (!that.isDiposed()) {
						that._status = await manualSyncTaskChannel.call<SyncStatus>('_getStatus');
					}
					return result;
				} catch (error) {
					throw UserDataSyncError.toUserDataSyncError(error);
				}
			},
			listen<T>(event: string, arg?: any): Event<T> {
				return manualSyncTaskChannel.listen(event, arg);
			}
		};
	}

	async preview(): Promise<[SyncResource, ISyncResourcePreview][]> {
		const previews = await this.channel.call<[SyncResource, ISyncResourcePreview][]>('preview');
		return this.deserializePreviews(previews);
	}

	async accept(resource: URI, content?: string | null): Promise<[SyncResource, ISyncResourcePreview][]> {
		const previews = await this.channel.call<[SyncResource, ISyncResourcePreview][]>('accept', [resource, content]);
		return this.deserializePreviews(previews);
	}

	async merge(resource?: URI): Promise<[SyncResource, ISyncResourcePreview][]> {
		const previews = await this.channel.call<[SyncResource, ISyncResourcePreview][]>('merge', [resource]);
		return this.deserializePreviews(previews);
	}

	async discard(resource: URI): Promise<[SyncResource, ISyncResourcePreview][]> {
		const previews = await this.channel.call<[SyncResource, ISyncResourcePreview][]>('discard', [resource]);
		return this.deserializePreviews(previews);
	}

	async discardConflicts(): Promise<[SyncResource, ISyncResourcePreview][]> {
		const previews = await this.channel.call<[SyncResource, ISyncResourcePreview][]>('discardConflicts');
		return this.deserializePreviews(previews);
	}

	async apply(): Promise<[SyncResource, ISyncResourcePreview][]> {
		const previews = await this.channel.call<[SyncResource, ISyncResourcePreview][]>('apply');
		return this.deserializePreviews(previews);
	}

	pull(): Promise<void> {
		return this.channel.call('pull');
	}

	push(): Promise<void> {
		return this.channel.call('push');
	}

	stop(): Promise<void> {
		return this.channel.call('stop');
	}

	private _disposed = false;
	isDiposed() { return this._disposed; }

	override dispose(): void {
		this._disposed = true;
		this.channel.call('dispose');
	}

	private deserializePreviews(previews: [SyncResource, ISyncResourcePreview][]): [SyncResource, ISyncResourcePreview][] {
		return previews.map(([syncResource, preview]) =>
		([
			syncResource,
			{
				isLastSyncFromCurrentMachine: preview.isLastSyncFromCurrentMachine,
				resourcePreviews: preview.resourcePreviews.map(r => ({
					...r,
					localResource: URI.revive(r.localResource),
					remoteResource: URI.revive(r.remoteResource),
					previewResource: URI.revive(r.previewResource),
					acceptedResource: URI.revive(r.acceptedResource),
				}))
			}
		]));
	}
}

