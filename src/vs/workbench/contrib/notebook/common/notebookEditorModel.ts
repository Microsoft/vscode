/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { EditorModel, IRevertOptions } from 'vs/workbench/common/editor';
import { Emitter, Event } from 'vs/base/common/event';
import { INotebookEditorModel, NotebookDocumentBackupData } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { URI } from 'vs/base/common/uri';
import { IWorkingCopyService, IWorkingCopy, IWorkingCopyBackup, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { basename } from 'vs/base/common/resources';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { Schemas } from 'vs/base/common/network';
import { IFileStatWithMetadata, IFileService } from 'vs/platform/files/common/files';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';

export interface INotebookEditorModelManager {
	models: NotebookEditorModel[];

	resolve(resource: URI, viewType: string, editorId?: string): Promise<NotebookEditorModel>;

	get(resource: URI): NotebookEditorModel | undefined;
}

export interface INotebookLoadOptions {
	/**
	 * Go to disk bypassing any cache of the model if any.
	 */
	forceReadFromDisk?: boolean;

	editorId?: string;
}


export class NotebookEditorModel extends EditorModel implements IWorkingCopy, INotebookEditorModel {
	protected readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;
	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;
	private _notebook!: NotebookTextModel;
	private _lastResolvedFileStat: IFileStatWithMetadata | undefined;

	get notebook() {
		return this._notebook;
	}

	private _name!: string;

	get name() {
		return this._name;
	}

	private _workingCopyResource: URI;

	constructor(
		public readonly resource: URI,
		public readonly viewType: string,
		@INotebookService private readonly _notebookService: INotebookService,
		@IWorkingCopyService private readonly _workingCopyService: IWorkingCopyService,
		@IBackupFileService private readonly _backupFileService: IBackupFileService,
		@IFileService private readonly _fileService: IFileService,
		@INotificationService private readonly _notificationService: INotificationService
	) {
		super();

		const input = this;
		this._workingCopyResource = resource.with({ scheme: Schemas.vscodeNotebook });
		const workingCopyAdapter = new class implements IWorkingCopy {
			readonly resource = input._workingCopyResource;
			get name() { return input.name; }
			readonly capabilities = input.isUntitled() ? WorkingCopyCapabilities.Untitled : input.capabilities;
			readonly onDidChangeDirty = input.onDidChangeDirty;
			readonly onDidChangeContent = input.onDidChangeContent;
			isDirty(): boolean { return input.isDirty(); }
			backup(): Promise<IWorkingCopyBackup> { return input.backup(); }
			save(): Promise<boolean> { return input.save(); }
			revert(options?: IRevertOptions): Promise<void> { return input.revert(options); }
		};

		this._register(this._workingCopyService.registerWorkingCopy(workingCopyAdapter));
	}

	capabilities = 0;

	async backup(): Promise<IWorkingCopyBackup<NotebookDocumentBackupData>> {
		if (this._notebook.supportBackup) {
			const tokenSource = new CancellationTokenSource();
			const backupId = await this._notebookService.backup(this.viewType, this.resource, tokenSource.token);
			const stats = await this._resolveStats(this.resource);

			return {
				meta: {
					mtime: stats?.mtime || new Date().getTime(),
					name: this._name,
					viewType: this._notebook.viewType,
					backupId: backupId
				}
			};
		} else {
			return {
				meta: {
					mtime: new Date().getTime(),
					name: this._name,
					viewType: this._notebook.viewType
				},
				content: this._notebook.createSnapshot(true)
			};
		}
	}

	async revert(options?: IRevertOptions | undefined): Promise<void> {
		if (options?.soft) {
			await this._backupFileService.discardBackup(this.resource);
			return;
		}

		await this.load({ forceReadFromDisk: true });
		const newStats = await this._resolveStats(this.resource);
		this._lastResolvedFileStat = newStats;

		this._notebook.setDirty(false);
		this._onDidChangeDirty.fire();
	}

	async load(options?: INotebookLoadOptions): Promise<NotebookEditorModel> {
		if (options?.forceReadFromDisk) {
			return this.loadFromProvider(true, undefined, undefined);
		}

		if (this.isResolved()) {
			return this;
		}

		const backup = await this._backupFileService.resolve<NotebookDocumentBackupData>(this._workingCopyResource);

		if (this.isResolved()) {
			return this; // Make sure meanwhile someone else did not succeed in loading
		}

		return this.loadFromProvider(false, options?.editorId, backup?.meta?.backupId);
	}

	private async loadFromProvider(forceReloadFromDisk: boolean, editorId: string | undefined, backupId: string | undefined) {
		const notebook = await this._notebookService.resolveNotebook(this.viewType!, this.resource, forceReloadFromDisk, editorId, backupId);
		this._notebook = notebook!;
		const newStats = await this._resolveStats(this.resource);
		this._lastResolvedFileStat = newStats;

		this._register(this._notebook);

		this._name = basename(this._notebook!.uri);

		this._register(this._notebook.onDidChangeContent(() => {
			this._onDidChangeContent.fire();
		}));
		this._register(this._notebook.onDidChangeDirty(() => {
			this._onDidChangeDirty.fire();
		}));

		if (backupId) {
			await this._backupFileService.discardBackup(this._workingCopyResource);
			this._notebook.setDirty(true);
		}

		return this;
	}

	isResolved(): boolean {
		return !!this._notebook;
	}

	isDirty() {
		return this._notebook?.isDirty;
	}

	isUntitled() {
		return this.resource.scheme === Schemas.untitled;
	}

	private async _assertStat() {
		const stats = await this._resolveStats(this.resource);
		if (this._lastResolvedFileStat && stats && stats.mtime > this._lastResolvedFileStat.mtime) {
			return new Promise<'overwrite' | 'revert' | 'none'>(resolve => {
				const handle = this._notificationService.prompt(
					Severity.Info,
					nls.localize('notebook.staleSaveError', "The content of the file is newer. Please revert your version with the file contents or overwrite the content of the file with your changes"),
					[{
						label: nls.localize('notebook.staleSaveError.revert', "Revert"),
						run: () => {
							resolve('revert');
						}
					}, {
						label: nls.localize('notebook.staleSaveError.overwrite.', "Overwrite"),
						run: () => {
							resolve('overwrite');
						}
					}],
					{ sticky: true }
				);

				Event.once(handle.onDidClose)(() => {
					resolve('none');
				});
			});
		}

		return 'overwrite';
	}

	async save(): Promise<boolean> {
		const result = await this._assertStat();
		if (result === 'none') {
			return false;
		}

		if (result === 'revert') {
			await this.revert();
			return true;
		}

		const tokenSource = new CancellationTokenSource();
		await this._notebookService.save(this.notebook.viewType, this.notebook.uri, tokenSource.token);
		const newStats = await this._resolveStats(this.resource);
		this._lastResolvedFileStat = newStats;
		this._notebook.setDirty(false);
		return true;
	}

	async saveAs(targetResource: URI): Promise<boolean> {
		const result = await this._assertStat();

		if (result === 'none') {
			return false;
		}

		if (result === 'revert') {
			await this.revert();
			return true;
		}

		const tokenSource = new CancellationTokenSource();
		await this._notebookService.saveAs(this.notebook.viewType, this.notebook.uri, targetResource, tokenSource.token);
		const newStats = await this._resolveStats(this.resource);
		this._lastResolvedFileStat = newStats;
		this._notebook.setDirty(false);
		return true;
	}

	private async _resolveStats(resource: URI) {
		if (resource.scheme === Schemas.untitled) {
			return undefined;
		}

		try {
			const newStats = await this._fileService.resolve(this.resource, { resolveMetadata: true });
			return newStats;
		} catch (e) {
			return undefined;
		}

	}

	dispose() {
		super.dispose();
	}
}
