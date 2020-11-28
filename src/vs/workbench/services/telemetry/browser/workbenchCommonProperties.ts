/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import * as Platform from 'vs/base/common/platform';
import * as uuid from 'vs/base/common/uuid';
import { cleanRemoteAuthority } from 'vs/platform/telemetry/common/telemetryUtils';
import { mixin } from 'vs/base/common/objects';
import { firstSessionDateStorageKey, lastSessionDateStorageKey, machineIdKey } from 'vs/platform/telemetry/common/telemetry';

export async function resolveWorkbenchCommonProperties(
	storageService: IStorageService,
	commit: string | undefined,
	version: string | undefined,
	remoteAuthority?: string,
	resolveAdditionalProperties?: () => { [key: string]: any }
): Promise<{ [name: string]: string | undefined }> {
	const result: { [name: string]: string | undefined; } = Object.create(null);
	const firstSessionDate = storageService.get(firstSessionDateStorageKey, StorageScope.GLOBAL)!;
	const lastSessionDate = storageService.get(lastSessionDateStorageKey, StorageScope.GLOBAL)!;

	let machineId = storageService.get(machineIdKey, StorageScope.GLOBAL);
	if (!machineId) {
		machineId = uuid.generateUuid();
		storageService.store(machineIdKey, machineId, StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	/**
	 * Note: In the web, session date information is fetched from browser storage, so these dates are tied to a specific
	 * browser and not the machine overall.
	 */
	// __GDPR__COMMON__ "common.firstSessionDate" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.firstSessionDate'] = firstSessionDate;
	// __GDPR__COMMON__ "common.lastSessionDate" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.lastSessionDate'] = lastSessionDate || '';
	// __GDPR__COMMON__ "common.isNewSession" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.isNewSession'] = !lastSessionDate ? '1' : '0';
	// __GDPR__COMMON__ "common.remoteAuthority" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['common.remoteAuthority'] = cleanRemoteAuthority(remoteAuthority);

	// __GDPR__COMMON__ "common.machineId" : { "endPoint": "MacAddressHash", "classification": "EndUserPseudonymizedInformation", "purpose": "FeatureInsight" }
	result['common.machineId'] = machineId;
	// __GDPR__COMMON__ "sessionID" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['sessionID'] = uuid.generateUuid() + Date.now();
	// __GDPR__COMMON__ "commitHash" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['commitHash'] = commit;
	// __GDPR__COMMON__ "version" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['version'] = version;
	// __GDPR__COMMON__ "common.platform" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.platform'] = Platform.PlatformToString(Platform.platform);
	// __GDPR__COMMON__ "common.product" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['common.product'] = 'web';
	// __GDPR__COMMON__ "common.userAgent" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.userAgent'] = Platform.userAgent;

	// dynamic properties which value differs on each call
	let seq = 0;
	const startTime = Date.now();
	Object.defineProperties(result, {
		// __GDPR__COMMON__ "timestamp" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
		'timestamp': {
			get: () => new Date(),
			enumerable: true
		},
		// __GDPR__COMMON__ "common.timesincesessionstart" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
		'common.timesincesessionstart': {
			get: () => Date.now() - startTime,
			enumerable: true
		},
		// __GDPR__COMMON__ "common.sequence" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
		'common.sequence': {
			get: () => seq++,
			enumerable: true
		}
	});

	if (resolveAdditionalProperties) {
		mixin(result, resolveAdditionalProperties());
	}

	return result;
}

