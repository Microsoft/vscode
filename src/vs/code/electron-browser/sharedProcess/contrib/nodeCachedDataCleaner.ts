/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises } from 'fs';
import { basename, dirname, join } from 'vs/base/common/path';
import { onUnexpectedError } from 'vs/base/common/errors';
import { toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { readdir, rimraf } from 'vs/base/node/pfs';
import { IProductService } from 'vs/platform/product/common/productService';

export class NodeCachedDataCleaner {

	private readonly _DataMaxAge = this.productService.quality !== 'stable'
		? 1000 * 60 * 60 * 24 * 7 // roughly 1 week
		: 1000 * 60 * 60 * 24 * 30 * 3; // roughly 3 months

	private readonly _disposables = new DisposableStore();

	constructor(
		private readonly nodeCachedDataDir: string | undefined,
		@IProductService private readonly productService: IProductService
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
		if (!this.nodeCachedDataDir) {
			return;
		}

		// The folder which contains folders of cached data. Each of these folder is per
		// version
		const nodeCachedDataRootDir = dirname(this.nodeCachedDataDir);
		const nodeCachedDataCurrent = basename(this.nodeCachedDataDir);

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
						deletes.push(promises.stat(path).then(stats => {
							// stat check
							// * only directories
							// * only when old enough
							if (stats.isDirectory()) {
								const diff = now - stats.mtime.getTime();
								if (diff > this._DataMaxAge) {
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
