/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { join, dirname, basename } from 'vs/base/common/path';
import { readdir, rimraf } from 'vs/base/node/pfs';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';

export class LogsDataCleaner extends Disposable {

	constructor(
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super();

		this.cleanUpOldLogsSoon();
	}

	private cleanUpOldLogsSoon(): void {
		let handle: NodeJS.Timeout | undefined = setTimeout(() => {
			handle = undefined;

			const currentLog = basename(this.environmentService.logsPath);
			const logsRoot = dirname(this.environmentService.logsPath);

			readdir(logsRoot).then(children => {
				const allSessions = children.filter(name => /^\d{8}T\d{6}$/.test(name));
				const oldSessions = allSessions.sort().filter((d, i) => d !== currentLog);
				const toDelete = oldSessions.slice(0, Math.max(0, oldSessions.length - 9));

				return Promise.all(toDelete.map(name => rimraf(join(logsRoot, name))));
			}).then(null, onUnexpectedError);
		}, 10 * 1000);

		this._register(toDisposable(() => {
			if (handle) {
				clearTimeout(handle);
				handle = undefined;
			}
		}));
	}
}
