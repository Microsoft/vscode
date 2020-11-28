/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as crypto from 'crypto';
import * as fs from 'fs';
import Severity from 'vs/base/common/severity';
import { URI } from 'vs/base/common/uri';
import { ChecksumPair, IIntegrityService, IntegrityTestResult } from 'vs/workbench/services/integrity/common/integrity';
import { ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IProductService } from 'vs/platform/product/common/productService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { FileAccess } from 'vs/base/common/network';

interface IStorageData {
	dontShowPrompt: boolean;
	commit: string | undefined;
}

class IntegrityStorage {
	private static readonly KEY = 'integrityService';

	private storageService: IStorageService;
	private value: IStorageData | null;

	constructor(storageService: IStorageService) {
		this.storageService = storageService;
		this.value = this._read();
	}

	private _read(): IStorageData | null {
		let jsonValue = this.storageService.get(IntegrityStorage.KEY, StorageScope.GLOBAL);
		if (!jsonValue) {
			return null;
		}
		try {
			return JSON.parse(jsonValue);
		} catch (err) {
			return null;
		}
	}

	get(): IStorageData | null {
		return this.value;
	}

	set(data: IStorageData | null): void {
		this.value = data;
		this.storageService.store(IntegrityStorage.KEY, JSON.stringify(this.value), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}
}

export class IntegrityServiceImpl implements IIntegrityService {

	declare readonly _serviceBrand: undefined;

	private _storage: IntegrityStorage;
	private _isPurePromise: Promise<IntegrityTestResult>;

	constructor(
		@INotificationService private readonly notificationService: INotificationService,
		@IStorageService storageService: IStorageService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService
	) {
		this._storage = new IntegrityStorage(storageService);

		this._isPurePromise = this._isPure();

		this.isPure().then(r => {
			if (r.isPure) {
				return; // all is good
			}

			this._prompt();
		});
	}

	private _prompt(): void {
		const storedData = this._storage.get();
		if (storedData?.dontShowPrompt && storedData.commit === this.productService.commit) {
			return; // Do not prompt
		}

		const checksumFailMoreInfoUrl = this.productService.checksumFailMoreInfoUrl;
		const message = nls.localize('integrity.prompt', "Your {0} installation appears to be corrupt. Please reinstall.", this.productService.nameShort);
		if (checksumFailMoreInfoUrl) {
			this.notificationService.prompt(
				Severity.Warning,
				message,
				[
					{
						label: nls.localize('integrity.moreInformation', "More Information"),
						run: () => this.openerService.open(URI.parse(checksumFailMoreInfoUrl))
					},
					{
						label: nls.localize('integrity.dontShowAgain', "Don't Show Again"),
						isSecondary: true,
						run: () => this._storage.set({ dontShowPrompt: true, commit: this.productService.commit })
					}
				],
				{ sticky: true }
			);
		} else {
			this.notificationService.notify({
				severity: Severity.Warning,
				message,
				sticky: true
			});
		}
	}

	isPure(): Promise<IntegrityTestResult> {
		return this._isPurePromise;
	}

	private async _isPure(): Promise<IntegrityTestResult> {
		const expectedChecksums = this.productService.checksums || {};

		await this.lifecycleService.when(LifecyclePhase.Eventually);

		const allResults = await Promise.all(Object.keys(expectedChecksums).map(filename => this._resolve(filename, expectedChecksums[filename])));

		let isPure = true;
		for (let i = 0, len = allResults.length; i < len; i++) {
			if (!allResults[i].isPure) {
				isPure = false;
				break;
			}
		}

		return {
			isPure: isPure,
			proof: allResults
		};
	}

	private _resolve(filename: string, expected: string): Promise<ChecksumPair> {
		const fileUri = FileAccess.asFileUri(filename, require);
		return new Promise<ChecksumPair>((resolve, reject) => {
			fs.readFile(fileUri.fsPath, (err, buff) => {
				if (err) {
					return resolve(IntegrityServiceImpl._createChecksumPair(fileUri, '', expected));
				}
				resolve(IntegrityServiceImpl._createChecksumPair(fileUri, this._computeChecksum(buff), expected));
			});
		});
	}

	private _computeChecksum(buff: Buffer): string {
		let hash = crypto
			.createHash('md5')
			.update(buff)
			.digest('base64')
			.replace(/=+$/, '');

		return hash;
	}

	private static _createChecksumPair(uri: URI, actual: string, expected: string): ChecksumPair {
		return {
			uri: uri,
			actual: actual,
			expected: expected,
			isPure: (actual === expected)
		};
	}
}

registerSingleton(IIntegrityService, IntegrityServiceImpl, true);
