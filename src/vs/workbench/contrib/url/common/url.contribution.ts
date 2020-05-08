/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { MenuId, MenuRegistry, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { Registry } from 'vs/platform/registry/common/platform';
import { IURLService } from 'vs/platform/url/common/url';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { ExternalUriResolverContribution } from 'vs/workbench/contrib/url/common/externalUriResolver';
import { manageTrustedDomainSettingsCommand } from 'vs/workbench/contrib/url/common/trustedDomains';
import { TrustedDomainsFileSystemProvider } from 'vs/workbench/contrib/url/common/trustedDomainsFileSystemProvider';
import { OpenerValidatorContributions } from 'vs/workbench/contrib/url/common/trustedDomainsValidator';

export class OpenUrlAction extends Action {
	static readonly ID = 'workbench.action.url.openUrl';
	static readonly LABEL = localize('openUrl', 'Open URL');

	constructor(
		id: string,
		label: string,
		@IURLService private readonly urlService: IURLService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super(id, label);
	}

	run(): Promise<any> {
		return this.quickInputService.input({ prompt: 'URL to open' }).then(input => {
			if (input) {
				const uri = URI.parse(input);
				this.urlService.open(uri, { trusted: true });
			}
		});
	}
}

Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions).registerWorkbenchAction(
	SyncActionDescriptor.from(OpenUrlAction),
	'Open URL',
	localize('developer', 'Developer')
);

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
