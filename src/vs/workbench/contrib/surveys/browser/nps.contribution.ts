/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { language } from 'vs/base/common/platform';
import { IWorkbenchContributionsRegistry, IWorkbenchContribution, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IProductService } from 'vs/platform/product/common/productService';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Severity, INotificationService } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';
import { platform } from 'vs/base/common/process';

const PROBABILITY = 0.15;
const SESSION_COUNT_KEY = 'nps/sessionCount';
const LAST_SESSION_DATE_KEY = 'nps/lastSessionDate';
const SKIP_VERSION_KEY = 'nps/skipVersion';
const IS_CANDIDATE_KEY = 'nps/isCandidate';

class NPSContribution implements IWorkbenchContribution {

	constructor(
		@IStorageService storageService: IStorageService,
		@INotificationService notificationService: INotificationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IOpenerService openerService: IOpenerService,
		@IProductService productService: IProductService
	) {
		if (!productService.npsSurveyUrl) {
			return;
		}

		const skipVersion = storageService.get(SKIP_VERSION_KEY, StorageScope.GLOBAL, '');
		if (skipVersion) {
			return;
		}

		const date = new Date().toDateString();
		const lastSessionDate = storageService.get(LAST_SESSION_DATE_KEY, StorageScope.GLOBAL, new Date(0).toDateString());

		if (date === lastSessionDate) {
			return;
		}

		const sessionCount = (storageService.getNumber(SESSION_COUNT_KEY, StorageScope.GLOBAL, 0) || 0) + 1;
		storageService.store(LAST_SESSION_DATE_KEY, date, StorageScope.GLOBAL, StorageTarget.USER);
		storageService.store(SESSION_COUNT_KEY, sessionCount, StorageScope.GLOBAL, StorageTarget.USER);

		if (sessionCount < 9) {
			return;
		}

		const isCandidate = storageService.getBoolean(IS_CANDIDATE_KEY, StorageScope.GLOBAL, false)
			|| Math.random() < PROBABILITY;

		storageService.store(IS_CANDIDATE_KEY, isCandidate, StorageScope.GLOBAL, StorageTarget.USER);

		if (!isCandidate) {
			storageService.store(SKIP_VERSION_KEY, productService.version, StorageScope.GLOBAL, StorageTarget.USER);
			return;
		}

		notificationService.prompt(
			Severity.Info,
			nls.localize('surveyQuestion', "Do you mind taking a quick feedback survey?"),
			[{
				label: nls.localize('takeSurvey', "Take Survey"),
				run: () => {
					telemetryService.getTelemetryInfo().then(info => {
						openerService.open(URI.parse(`${productService.npsSurveyUrl}?o=${encodeURIComponent(platform)}&v=${encodeURIComponent(productService.version)}&m=${encodeURIComponent(info.machineId)}`));
						storageService.store(IS_CANDIDATE_KEY, false, StorageScope.GLOBAL, StorageTarget.USER);
						storageService.store(SKIP_VERSION_KEY, productService.version, StorageScope.GLOBAL, StorageTarget.USER);
					});
				}
			}, {
				label: nls.localize('remindLater', "Remind Me later"),
				run: () => storageService.store(SESSION_COUNT_KEY, sessionCount - 3, StorageScope.GLOBAL, StorageTarget.USER)
			}, {
				label: nls.localize('neverAgain', "Don't Show Again"),
				run: () => {
					storageService.store(IS_CANDIDATE_KEY, false, StorageScope.GLOBAL, StorageTarget.USER);
					storageService.store(SKIP_VERSION_KEY, productService.version, StorageScope.GLOBAL, StorageTarget.USER);
				}
			}],
			{ sticky: true }
		);
	}
}

if (language === 'en') {
	const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
	workbenchRegistry.registerWorkbenchContribution(NPSContribution, LifecyclePhase.Restored);
}
