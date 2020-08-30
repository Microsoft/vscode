/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IFileService } from 'vs/platform/files/common/files';
import { basename, dirname } from 'vs/base/common/resources';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { URI } from 'vs/base/common/uri';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';

export class LogsDataCleaner extends Disposable {

	constructor(
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
	) {
		super();
		this.cleanUpOldLogsSoon();
	}

	private cleanUpOldLogsSoon(): void {
		let handle: any = setTimeout(async () => {
			handle = undefined;
			const logsPath = URI.file(this.environmentService.logsPath).with({ scheme: this.environmentService.logFile.scheme });
			const stat = await this.fileService.resolve(dirname(logsPath));
			if (stat.children) {
				const currentLog = basename(logsPath);
				const allSessions = stat.children.filter(stat => stat.isDirectory && /^\d{8}T\d{6}$/.test(stat.name));
				const oldSessions = allSessions.sort().filter((d, i) => d.name !== currentLog);
				const toDelete = oldSessions.slice(0, Math.max(0, oldSessions.length - 49));
				Promise.all(toDelete.map(stat => this.fileService.del(stat.resource, { recursive: true })));
			}
		}, 10 * 1000);
		this.lifecycleService.onWillShutdown(() => {
			if (handle) {
				clearTimeout(handle);
				handle = undefined;
			}
		});
	}
}
