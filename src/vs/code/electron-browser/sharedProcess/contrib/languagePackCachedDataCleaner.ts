/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import * as pfs from 'vs/base/node/pfs';
import { IStringDictionary } from 'vs/base/common/collections';
import product from 'vs/platform/product/common/product';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

interface ExtensionEntry {
	version: string;
	extensionIdentifier: {
		id: string;
		uuid: string;
	};
}

interface LanguagePackEntry {
	hash: string;
	extensions: ExtensionEntry[];
}

interface LanguagePackFile {
	[locale: string]: LanguagePackEntry;
}

export class LanguagePackCachedDataCleaner extends Disposable {

	constructor(
		@IEnvironmentService private readonly _environmentService: INativeEnvironmentService,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		// We have no Language pack support for dev version (run from source)
		// So only cleanup when we have a build version.
		if (this._environmentService.isBuilt) {
			this._manageCachedDataSoon();
		}
	}

	private _manageCachedDataSoon(): void {
		let handle: any = setTimeout(async () => {
			handle = undefined;
			this._logService.info('Starting to clean up unused language packs.');
			const maxAge = product.nameLong.indexOf('Insiders') >= 0
				? 1000 * 60 * 60 * 24 * 7 // roughly 1 week
				: 1000 * 60 * 60 * 24 * 30 * 3; // roughly 3 months
			try {
				const installed: IStringDictionary<boolean> = Object.create(null);
				const metaData: LanguagePackFile = JSON.parse(await pfs.readFile(path.join(this._environmentService.userDataPath, 'languagepacks.json'), 'utf8'));
				for (let locale of Object.keys(metaData)) {
					const entry = metaData[locale];
					installed[`${entry.hash}.${locale}`] = true;
				}
				// Cleanup entries for language packs that aren't installed anymore
				const cacheDir = path.join(this._environmentService.userDataPath, 'clp');
				const exists = await pfs.exists(cacheDir);
				if (!exists) {
					return;
				}
				for (let entry of await pfs.readdir(cacheDir)) {
					if (installed[entry]) {
						this._logService.info(`Skipping directory ${entry}. Language pack still in use.`);
						continue;
					}
					this._logService.info('Removing unused language pack:', entry);
					await pfs.rimraf(path.join(cacheDir, entry));
				}

				const now = Date.now();
				for (let packEntry of Object.keys(installed)) {
					const folder = path.join(cacheDir, packEntry);
					for (let entry of await pfs.readdir(folder)) {
						if (entry === 'tcf.json') {
							continue;
						}
						const candidate = path.join(folder, entry);
						const stat = await pfs.stat(candidate);
						if (stat.isDirectory()) {
							const diff = now - stat.mtime.getTime();
							if (diff > maxAge) {
								this._logService.info('Removing language pack cache entry: ', path.join(packEntry, entry));
								await pfs.rimraf(candidate);
							}
						}
					}
				}
			} catch (error) {
				onUnexpectedError(error);
			}
		}, 40 * 1000);

		this._register(toDisposable(() => {
			if (handle !== undefined) {
				clearTimeout(handle);
			}
		}));
	}
}
