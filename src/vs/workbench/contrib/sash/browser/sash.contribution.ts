/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { workbenchConfigurationNodeBase } from 'vs/workbench/common/configuration';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { SashSettingsController } from 'vs/workbench/contrib/sash/browser/sash';
import { isIPad } from 'vs/base/browser/browser';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { sashHoverBorder } from 'vs/platform/theme/common/colorRegistry';

// Sash size contribution
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(SashSettingsController, LifecyclePhase.Restored);

// Sash size configuration contribution
Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration({
		...workbenchConfigurationNodeBase,
		properties: {
			'workbench.sash.size': {
				type: 'number',
				default: isIPad ? 20 : 4,
				minimum: 1,
				maximum: 20,
				description: localize('sashSize', "Controls the feedback area size in pixels of the dragging area in between views/editors. Set it to a larger value if you feel it's hard to resize views using the mouse.")
			},
			'workbench.sash.hoverDelay': {
				type: 'number',
				default: 300,
				minimum: 0,
				maximum: 2000,
				description: localize('sashHoverDelay', "Controls the hover feedback delay in milliseconds of the dragging area in between views/editors.")
			},
		}
	});

registerThemingParticipant((theme, collector) => {
	const sashHoverBorderColor = theme.getColor(sashHoverBorder);
	collector.addRule(`
		.monaco-sash.hover:before,
		.monaco-sash.active:before {
			background: ${sashHoverBorderColor};
		}
	`);
});
