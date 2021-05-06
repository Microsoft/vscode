/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { language } from 'vs/base/common/platform';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IWorkbenchContributionsRegistry, IWorkbenchContribution, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IProductService } from 'vs/platform/product/common/productService';
import { ISurveyData } from 'vs/base/common/product';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Severity, INotificationService } from 'vs/platform/notification/common/notification';
import { ITextFileService, ITextFileEditorModel } from 'vs/workbench/services/textfile/common/textfiles';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';
import { platform } from 'vs/base/common/process';
import { RunOnceWorker } from 'vs/base/common/async';
import { Disposable } from 'vs/base/common/lifecycle';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';

class LanguageSurvey extends Disposable {

	constructor(
		data: ISurveyData,
		storageService: IStorageService,
		notificationService: INotificationService,
		telemetryService: ITelemetryService,
		modeService: IModeService,
		textFileService: ITextFileService,
		openerService: IOpenerService,
		productService: IProductService
	) {
		super();

		const SESSION_COUNT_KEY = `${data.surveyId}.sessionCount`;
		const LAST_SESSION_DATE_KEY = `${data.surveyId}.lastSessionDate`;
		const SKIP_VERSION_KEY = `${data.surveyId}.skipVersion`;
		const IS_CANDIDATE_KEY = `${data.surveyId}.isCandidate`;
		const EDITED_LANGUAGE_COUNT_KEY = `${data.surveyId}.editedCount`;
		const EDITED_LANGUAGE_DATE_KEY = `${data.surveyId}.editedDate`;

		const skipVersion = storageService.get(SKIP_VERSION_KEY, StorageScope.GLOBAL, '');
		if (skipVersion) {
			return;
		}

		const date = new Date().toDateString();

		if (storageService.getNumber(EDITED_LANGUAGE_COUNT_KEY, StorageScope.GLOBAL, 0) < data.editCount) {

			// Process model-save event every 250ms to reduce load
			const onModelsSavedWorker = this._register(new RunOnceWorker<ITextFileEditorModel>(models => {
				models.forEach(m => {
					if (m.getMode() === data.languageId && date !== storageService.get(EDITED_LANGUAGE_DATE_KEY, StorageScope.GLOBAL)) {
						const editedCount = storageService.getNumber(EDITED_LANGUAGE_COUNT_KEY, StorageScope.GLOBAL, 0) + 1;
						storageService.store(EDITED_LANGUAGE_COUNT_KEY, editedCount, StorageScope.GLOBAL, StorageTarget.USER);
						storageService.store(EDITED_LANGUAGE_DATE_KEY, date, StorageScope.GLOBAL, StorageTarget.USER);
					}
				});
			}, 250));

			this._register(textFileService.files.onDidSave(e => onModelsSavedWorker.work(e.model)));
		}

		const lastSessionDate = storageService.get(LAST_SESSION_DATE_KEY, StorageScope.GLOBAL, new Date(0).toDateString());
		if (date === lastSessionDate) {
			return;
		}

		const sessionCount = storageService.getNumber(SESSION_COUNT_KEY, StorageScope.GLOBAL, 0) + 1;
		storageService.store(LAST_SESSION_DATE_KEY, date, StorageScope.GLOBAL, StorageTarget.USER);
		storageService.store(SESSION_COUNT_KEY, sessionCount, StorageScope.GLOBAL, StorageTarget.USER);

		if (sessionCount < 9) {
			return;
		}

		if (storageService.getNumber(EDITED_LANGUAGE_COUNT_KEY, StorageScope.GLOBAL, 0) < data.editCount) {
			return;
		}

		const isCandidate = storageService.getBoolean(IS_CANDIDATE_KEY, StorageScope.GLOBAL, false)
			|| Math.random() < data.userProbability;

		storageService.store(IS_CANDIDATE_KEY, isCandidate, StorageScope.GLOBAL, StorageTarget.USER);

		if (!isCandidate) {
			storageService.store(SKIP_VERSION_KEY, productService.version, StorageScope.GLOBAL, StorageTarget.USER);
			return;
		}

		// __GDPR__TODO__ Need to move away from dynamic event names as those cannot be registered statically
		telemetryService.publicLog(`${data.surveyId}.survey/userAsked`);

		notificationService.prompt(
			Severity.Info,
			localize('helpUs', "Help us improve our support for {0}", modeService.getLanguageName(data.languageId) ?? data.languageId),
			[{
				label: localize('takeShortSurvey', "Take Short Survey"),
				run: () => {
					telemetryService.publicLog(`${data.surveyId}.survey/takeShortSurvey`);
					telemetryService.getTelemetryInfo().then(info => {
						openerService.open(URI.parse(`${data.surveyUrl}?o=${encodeURIComponent(platform)}&v=${encodeURIComponent(productService.version)}&m=${encodeURIComponent(info.machineId)}`));
						storageService.store(IS_CANDIDATE_KEY, false, StorageScope.GLOBAL, StorageTarget.USER);
						storageService.store(SKIP_VERSION_KEY, productService.version, StorageScope.GLOBAL, StorageTarget.USER);
					});
				}
			}, {
				label: localize('remindLater', "Remind Me later"),
				run: () => {
					telemetryService.publicLog(`${data.surveyId}.survey/remindMeLater`);
					storageService.store(SESSION_COUNT_KEY, sessionCount - 3, StorageScope.GLOBAL, StorageTarget.USER);
				}
			}, {
				label: localize('neverAgain', "Don't Show Again"),
				isSecondary: true,
				run: () => {
					telemetryService.publicLog(`${data.surveyId}.survey/dontShowAgain`);
					storageService.store(IS_CANDIDATE_KEY, false, StorageScope.GLOBAL, StorageTarget.USER);
					storageService.store(SKIP_VERSION_KEY, productService.version, StorageScope.GLOBAL, StorageTarget.USER);
				}
			}],
			{ sticky: true }
		);
	}
}

class LanguageSurveysContribution implements IWorkbenchContribution {

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService,
		@IModeService private readonly modeService: IModeService,
		@IExtensionService private readonly extensionService: IExtensionService
	) {
		this.handleSurveys();
	}

	private async handleSurveys() {
		if (!this.productService.surveys) {
			return;
		}

		// Make sure to wait for installed extensions
		// being registered to show notifications
		// properly (https://github.com/microsoft/vscode/issues/121216)
		await this.extensionService.whenInstalledExtensionsRegistered();

		// Handle surveys
		this.productService.surveys
			.filter(surveyData => surveyData.surveyId && surveyData.editCount && surveyData.languageId && surveyData.surveyUrl && surveyData.userProbability)
			.map(surveyData => new LanguageSurvey(surveyData, this.storageService, this.notificationService, this.telemetryService, this.modeService, this.textFileService, this.openerService, this.productService));
	}
}

if (language === 'en') {
	const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
	workbenchRegistry.registerWorkbenchContribution(LanguageSurveysContribution, LifecyclePhase.Restored);
}
