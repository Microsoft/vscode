/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { raceCancellation } from 'vs/base/common/async';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { ILogService } from 'vs/platform/log/common/log';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { IDisposable, Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IWorkingCopyFileOperationParticipant } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { URI } from 'vs/base/common/uri';
import { FileOperation } from 'vs/platform/files/common/files';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { LinkedList } from 'vs/base/common/linkedList';

export class WorkingCopyFileOperationParticipant extends Disposable {

	private readonly participants = new LinkedList<IWorkingCopyFileOperationParticipant>();

	constructor(
		@IProgressService private readonly progressService: IProgressService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
	}

	addFileOperationParticipant(participant: IWorkingCopyFileOperationParticipant): IDisposable {
		const remove = this.participants.push(participant);
		return toDisposable(() => remove());
	}

	async participate(files: { source?: URI, target: URI }[], operation: FileOperation, undoRedoGroupId: number | undefined, isUndoing: boolean | undefined, token: CancellationToken | undefined): Promise<void> {
		const timeout = this.configurationService.getValue<number>('files.participants.timeout');
		if (timeout <= 0) {
			return; // disabled
		}

		const cts = new CancellationTokenSource(token);
		const timer = setTimeout(() => cts.cancel(), timeout);

		return this.progressService.withProgress({
			location: ProgressLocation.Notification,
			title: this.progressLabel(operation),
			cancellable: true,
			delay: Math.min(timeout / 2, 3000)
		}, async progress => {

			// For each participant
			for (const participant of this.participants) {
				if (cts.token.isCancellationRequested) {
					break;
				}
				try {
					const promise = participant.participate(files, operation, undoRedoGroupId, isUndoing, progress, timeout, cts.token);
					await raceCancellation(promise, cts.token);
				} catch (err) {
					this.logService.warn(err);
				}
			}
		}, () => {
			// user cancel
			cts.cancel();

		}).finally(() => {
			// cleanup
			cts.dispose();
			clearTimeout(timer);
		});
	}

	private progressLabel(operation: FileOperation): string {
		switch (operation) {
			case FileOperation.CREATE:
				return localize('msg-create', "Running 'File Create' participants...");
			case FileOperation.MOVE:
				return localize('msg-rename', "Running 'File Rename' participants...");
			case FileOperation.COPY:
				return localize('msg-copy', "Running 'File Copy' participants...");
			case FileOperation.DELETE:
				return localize('msg-delete', "Running 'File Delete' participants...");
		}
	}

	dispose(): void {
		this.participants.clear();
	}
}
