/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { release } from 'os';
import { OS, OperatingSystem } from 'vs/base/common/platform';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ConfigExtensions, IConfigurationNode, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigExtensions.Configuration);
const keyboardConfiguration: IConfigurationNode = {
	'id': 'keyboard',
	'order': 15,
	'type': 'object',
	'title': nls.localize('keyboardConfigurationTitle', "Keyboard"),
	'properties': {
		'keyboard.touchbar.enabled': {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('touchbar.enabled', "Enables the macOS touchbar buttons on the keyboard if available."),
			'included': OS === OperatingSystem.Macintosh && parseFloat(release()) >= 16 // Minimum: macOS Sierra (10.12.x = darwin 16.x)
		},
		'keyboard.touchbar.ignored': {
			'type': 'array',
			'items': {
				'type': 'string'
			},
			'default': [],
			'markdownDescription': nls.localize('touchbar.ignored', 'A set of identifiers for entries in the touchbar that should not show up (for example `workbench.action.navigateBack`.'),
			'included': OS === OperatingSystem.Macintosh && parseFloat(release()) >= 16 // Minimum: macOS Sierra (10.12.x = darwin 16.x)
		}
	}
};

configurationRegistry.registerConfiguration(keyboardConfiguration);
