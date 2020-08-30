/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, dirname, join } from 'vs/base/common/path';
import { onUnexpectedError } from 'vs/base/common/errors';
import { toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { readdir, rimraf, stat } from 'vs/base/node/pfs';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import product from 'vs/platform/product/common/product';

export class NodeCachedDataCleaner {

	private static readonly _DataMaxAge = product.nameLong.indexOf('Insiders') >= 0
		? 1000 * 60 * 60 * 24 * 7 // roughly 1 week
		: 1000 * 60 * 60 * 24 * 30 * 3; // roughly 3 months

	private readonly _disposables = new DisposableStore();

	constructor(
		@IEnvironmentService private readonly _environmentService: INativeEnvironmentService
	) {
		this._manageCachedDataSoon();
	}

	dispose(): void {
		this._disposables.dispose();
	}

	private _manageCachedDataSoon(): void {
		// Cached data is stored as user data and we run a cleanup task everytime
		// the editor starts. The strategy is to delete all files that are older than
		// 3 months (1 week respectively)
		if (!this._environmentService.nodeCachedDataDir) {
			return;
		}

		// The folder which contains folders of cached data. Each of these folder is per
		// version
		const nodeCachedDataRootDir = dirname(this._environmentService.nodeCachedDataDir);
		const nodeCachedDataCurrent = basename(this._environmentService.nodeCachedDataDir);

		let handle: NodeJS.Timeout | undefined = setTimeout(() => {
			handle = undefined;

			readdir(nodeCachedDataRootDir).then(entries => {

				const now = Date.now();
				const deletes: Promise<unknown>[] = [];

				entries.forEach(entry => {
					// name check
					// * not the current cached data folder
					if (entry !== nodeCachedDataCurrent) {

						const path = join(nodeCachedDataRootDir, entry);
						deletes.push(stat(path).then(stats => {
							// stat check
							// * only directories
							// * only when old enough
							if (stats.isDirectory()) {
								const diff = now - stats.mtime.getTime();
								if (diff > NodeCachedDataCleaner._DataMaxAge) {
									return rimraf(path);
								}
							}
							return undefined;
						}));
					}
				});

				return Promise.all(deletes);

			}).then(undefined, onUnexpectedError);

		}, 30 * 1000);

		this._disposables.add(toDisposable(() => {
			if (handle) {
				clearTimeout(handle);
				handle = undefined;
			}
		}));
	}
}
