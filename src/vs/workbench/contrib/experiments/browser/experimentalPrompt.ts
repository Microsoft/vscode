/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { INotificationService, Severity, IPromptChoice } from 'vs/platform/notification/common/notification';
import { IExperimentService, IExperiment, ExperimentActionType, IExperimentActionPromptProperties, IExperimentActionPromptCommand, ExperimentState } from 'vs/workbench/contrib/experiments/common/experimentService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IExtensionsViewPaneContainer } from 'vs/workbench/contrib/extensions/common/extensions';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Disposable } from 'vs/base/common/lifecycle';
import { language } from 'vs/base/common/platform';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';
import { ICommandService } from 'vs/platform/commands/common/commands';

export class ExperimentalPrompts extends Disposable implements IWorkbenchContribution {

	constructor(
		@IExperimentService private readonly experimentService: IExperimentService,
		@IViewletService private readonly viewletService: IViewletService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IOpenerService private readonly openerService: IOpenerService,
		@ICommandService private readonly commandService: ICommandService

	) {
		super();
		this._register(this.experimentService.onExperimentEnabled(e => {
			if (e.action && e.action.type === ExperimentActionType.Prompt && e.state === ExperimentState.Run) {
				this.showExperimentalPrompts(e);
			}
		}, this));
	}

	private showExperimentalPrompts(experiment: IExperiment): void {
		if (!experiment || !experiment.enabled || !experiment.action || experiment.state !== ExperimentState.Run) {
			return;
		}

		const logTelemetry = (commandText?: string) => {
			/* __GDPR__
				"experimentalPrompts" : {
					"experimentId": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"commandText": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"cancelled": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
				}
			*/
			this.telemetryService.publicLog('experimentalPrompts', {
				experimentId: experiment.id,
				commandText,
				cancelled: !commandText
			});
		};

		const actionProperties = (<IExperimentActionPromptProperties>experiment.action.properties);
		const promptText = ExperimentalPrompts.getLocalizedText(actionProperties.promptText, language || '');
		if (!actionProperties || !promptText) {
			return;
		}
		if (!actionProperties.commands) {
			actionProperties.commands = [];
		}

		const choices: IPromptChoice[] = actionProperties.commands.map((command: IExperimentActionPromptCommand) => {
			const commandText = ExperimentalPrompts.getLocalizedText(command.text, language || '');
			return {
				label: commandText,
				run: () => {
					logTelemetry(commandText);
					if (command.externalLink) {
						this.openerService.open(URI.parse(command.externalLink));
					} else if (command.curatedExtensionsKey && Array.isArray(command.curatedExtensionsList)) {
						this.viewletService.openViewlet('workbench.view.extensions', true)
							.then(viewlet => viewlet?.getViewPaneContainer() as IExtensionsViewPaneContainer)
							.then(viewlet => {
								if (viewlet) {
									viewlet.search('curated:' + command.curatedExtensionsKey);
								}
							});
					} else if (command.codeCommand) {
						this.commandService.executeCommand(command.codeCommand.id, ...command.codeCommand.arguments);
					}

					this.experimentService.markAsCompleted(experiment.id);

				}
			};
		});

		this.notificationService.prompt(Severity.Info, promptText, choices, {
			onCancel: () => {
				logTelemetry();
				this.experimentService.markAsCompleted(experiment.id);
			}
		});
	}

	static getLocalizedText(text: string | { [key: string]: string; }, displayLanguage: string): string {
		if (typeof text === 'string') {
			return text;
		}
		const msgInEnglish = text['en'] || text['en-us'];
		displayLanguage = displayLanguage.toLowerCase();
		if (!text[displayLanguage] && displayLanguage.indexOf('-') === 2) {
			displayLanguage = displayLanguage.substr(0, 2);
		}
		return text[displayLanguage] || msgInEnglish;
	}
}
