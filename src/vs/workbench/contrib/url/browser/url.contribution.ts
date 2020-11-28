/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { MenuId, MenuRegistry, Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { Registry } from 'vs/platform/registry/common/platform';
import { IURLService } from 'vs/platform/url/common/url';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { ExternalUriResolverContribution } from 'vs/workbench/contrib/url/browser/externalUriResolver';
import { manageTrustedDomainSettingsCommand } from 'vs/workbench/contrib/url/browser/trustedDomains';
import { TrustedDomainsFileSystemProvider } from 'vs/workbench/contrib/url/browser/trustedDomainsFileSystemProvider';
import { OpenerValidatorContributions } from 'vs/workbench/contrib/url/browser/trustedDomainsValidator';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { CATEGORIES } from 'vs/workbench/common/actions';

class OpenUrlAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.url.openUrl',
			title: { value: localize('openUrl', "Open URL"), original: 'Open URL' },
			category: CATEGORIES.Developer,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const urlService = accessor.get(IURLService);

		return quickInputService.input({ prompt: localize('urlToOpen', "URL to open") }).then(input => {
			if (input) {
				const uri = URI.parse(input);
				urlService.open(uri, { originalUrl: input });
			}
		});
	}
}

registerAction2(OpenUrlAction);

/**
 * Trusted Domains Contribution
 */

CommandsRegistry.registerCommand(manageTrustedDomainSettingsCommand);
MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: manageTrustedDomainSettingsCommand.id,
		title: {
			value: manageTrustedDomainSettingsCommand.description.description,
			original: 'Manage Trusted Domains'
		}
	}
});

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	OpenerValidatorContributions,
	LifecyclePhase.Restored
);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	TrustedDomainsFileSystemProvider,
	LifecyclePhase.Ready
);
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(
	ExternalUriResolverContribution,
	LifecyclePhase.Ready
);
