/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { resolveCommonProperties } from 'vs/platform/telemetry/node/commonProperties';
import { instanceStorageKey, firstSessionDateStorageKey, lastSessionDateStorageKey } from 'vs/platform/telemetry/common/telemetry';
import { cleanRemoteAuthority } from 'vs/platform/telemetry/common/telemetryUtils';

export async function resolveWorkbenchCommonProperties(
	storageService: IStorageService,
	commit: string | undefined,
	version: string | undefined,
	machineId: string,
	msftInternalDomains: string[] | undefined,
	installSourcePath: string,
	remoteAuthority?: string
): Promise<{ [name: string]: string | boolean | undefined }> {
	const result = await resolveCommonProperties(commit, version, machineId, msftInternalDomains, installSourcePath, undefined);
	const instanceId = storageService.get(instanceStorageKey, StorageScope.GLOBAL)!;
	const firstSessionDate = storageService.get(firstSessionDateStorageKey, StorageScope.GLOBAL)!;
	const lastSessionDate = storageService.get(lastSessionDateStorageKey, StorageScope.GLOBAL)!;

	// __GDPR__COMMON__ "common.version.shell" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['common.version.shell'] = process.versions && process.versions['electron'];
	// __GDPR__COMMON__ "common.version.renderer" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['common.version.renderer'] = process.versions && process.versions['chrome'];
	// __GDPR__COMMON__ "common.firstSessionDate" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.firstSessionDate'] = firstSessionDate;
	// __GDPR__COMMON__ "common.lastSessionDate" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.lastSessionDate'] = lastSessionDate || '';
	// __GDPR__COMMON__ "common.isNewSession" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.isNewSession'] = !lastSessionDate ? '1' : '0';
	// __GDPR__COMMON__ "common.instanceId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.instanceId'] = instanceId;
	// __GDPR__COMMON__ "common.remoteAuthority" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['common.remoteAuthority'] = cleanRemoteAuthority(remoteAuthority);

	return result;
}
