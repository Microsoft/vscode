/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ILocalizationsService } from 'vs/platform/localizations/common/localizations';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IJSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditing';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { language } from 'vs/base/common/platform';
import { IExtensionsViewPaneContainer, VIEWLET_ID as EXTENSIONS_VIEWLET_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IProductService } from 'vs/platform/product/common/productService';

export class ConfigureLocaleAction extends Action {
	public static readonly ID = 'workbench.action.configureLocale';
	public static readonly LABEL = localize('configureLocale', "Configure Display Language");

	constructor(id: string, label: string,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@ILocalizationsService private readonly localizationService: ILocalizationsService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IJSONEditingService private readonly jsonEditingService: IJSONEditingService,
		@IHostService private readonly hostService: IHostService,
		@INotificationService private readonly notificationService: INotificationService,
		@IViewletService private readonly viewletService: IViewletService,
		@IDialogService private readonly dialogService: IDialogService,
		@IProductService private readonly productService: IProductService
	) {
		super(id, label);
	}

	private async getLanguageOptions(): Promise<IQuickPickItem[]> {
		const availableLanguages = await this.localizationService.getLanguageIds();
		availableLanguages.sort();

		return availableLanguages
			.map(language => { return { label: language }; })
			.concat({ label: localize('installAdditionalLanguages', "Install additional languages...") });
	}

	public override async run(): Promise<void> {
		const languageOptions = await this.getLanguageOptions();
		const currentLanguageIndex = languageOptions.findIndex(l => l.label === language);

		try {
			const selectedLanguage = await this.quickInputService.pick(languageOptions,
				{
					canPickMany: false,
					placeHolder: localize('chooseDisplayLanguage', "Select Display Language"),
					activeItem: languageOptions[currentLanguageIndex]
				});

			if (selectedLanguage === languageOptions[languageOptions.length - 1]) {
				return this.viewletService.openViewlet(EXTENSIONS_VIEWLET_ID, true)
					.then(viewlet => viewlet?.getViewPaneContainer())
					.then(viewlet => {
						const extensionsViewlet = viewlet as IExtensionsViewPaneContainer;
						extensionsViewlet.search('@category:"language packs"');
						extensionsViewlet.focus();
					});
			}

			if (selectedLanguage) {
				await this.jsonEditingService.write(this.environmentService.argvResource, [{ path: ['locale'], value: selectedLanguage.label }], true);
				const restart = await this.dialogService.confirm({
					type: 'info',
					message: localize('relaunchDisplayLanguageMessage', "A restart is required for the change in display language to take effect."),
					detail: localize('relaunchDisplayLanguageDetail', "Press the restart button to restart {0} and change the display language.", this.productService.nameLong),
					primaryButton: localize('restart', "&&Restart")
				});

				if (restart.confirmed) {
					this.hostService.restart();
				}
			}
		} catch (e) {
			this.notificationService.error(e);
		}
	}
}
