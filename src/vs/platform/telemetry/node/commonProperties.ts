/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Platform from 'vs/base/common/platform';
import * as os from 'os';
import * as uuid from 'vs/base/common/uuid';
import { readFile } from 'vs/base/node/pfs';

export async function resolveCommonProperties(
	commit: string | undefined,
	version: string | undefined,
	machineId: string | undefined,
	msftInternalDomains: string[] | undefined,
	installSourcePath: string,
	product?: string
): Promise<{ [name: string]: string | boolean | undefined; }> {
	const result: { [name: string]: string | boolean | undefined; } = Object.create(null);

	// __GDPR__COMMON__ "common.machineId" : { "endPoint": "MacAddressHash", "classification": "EndUserPseudonymizedInformation", "purpose": "FeatureInsight" }
	result['common.machineId'] = machineId;
	// __GDPR__COMMON__ "sessionID" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['sessionID'] = uuid.generateUuid() + Date.now();
	// __GDPR__COMMON__ "commitHash" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['commitHash'] = commit;
	// __GDPR__COMMON__ "version" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['version'] = version;
	// __GDPR__COMMON__ "common.platformVersion" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.platformVersion'] = (os.release() || '').replace(/^(\d+)(\.\d+)?(\.\d+)?(.*)/, '$1$2$3');
	// __GDPR__COMMON__ "common.platform" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	result['common.platform'] = Platform.PlatformToString(Platform.platform);
	// __GDPR__COMMON__ "common.nodePlatform" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['common.nodePlatform'] = process.platform;
	// __GDPR__COMMON__ "common.nodeArch" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['common.nodeArch'] = process.arch;
	// __GDPR__COMMON__ "common.product" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" }
	result['common.product'] = product || 'desktop';

	const msftInternal = verifyMicrosoftInternalDomain(msftInternalDomains || []);
	if (msftInternal) {
		// __GDPR__COMMON__ "common.msftInternal" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
		result['common.msftInternal'] = msftInternal;
	}

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

	if (process.platform === 'linux' && process.env.SNAP && process.env.SNAP_REVISION) {
		// __GDPR__COMMON__ "common.snap" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
		result['common.snap'] = 'true';
	}

	try {
		const contents = await readFile(installSourcePath, 'utf8');

		// __GDPR__COMMON__ "common.source" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
		result['common.source'] = contents.slice(0, 30);
	} catch (error) {
		// ignore error
	}

	return result;
}

function verifyMicrosoftInternalDomain(domainList: readonly string[]): boolean {
	if (!process || !process.env || !process.env['USERDNSDOMAIN']) {
		return false;
	}

	const domain = process.env['USERDNSDOMAIN']!.toLowerCase();
	return domainList.some(msftDomain => domain === msftDomain);
}
