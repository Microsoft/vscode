/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as extensionsRegistry from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { ITerminalTypeContribution, ITerminalContributions, terminalContributionsDescriptor } from 'vs/workbench/contrib/terminal/common/terminal';
import { flatten } from 'vs/base/common/arrays';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

// terminal extension point
export const terminalsExtPoint = extensionsRegistry.ExtensionsRegistry.registerExtensionPoint<ITerminalContributions>(terminalContributionsDescriptor);

export interface ITerminalContributionService {
	readonly _serviceBrand: undefined;

	readonly terminalTypes: ReadonlyArray<ITerminalTypeContribution>;
}

export const ITerminalContributionService = createDecorator<ITerminalContributionService>('terminalContributionsService');

export class TerminalContributionService implements ITerminalContributionService {
	declare _serviceBrand: undefined;

	private _terminalTypes: ReadonlyArray<ITerminalTypeContribution> = [];

	get terminalTypes() {
		return this._terminalTypes;
	}

	constructor() {
		terminalsExtPoint.setHandler(contributions => {
			this._terminalTypes = flatten(contributions.filter(c => c.description.enableProposedApi).map(c => {
				return c.value?.types?.map(e => {
					// TODO: Remove after adoption in js-debug
					if (!e.icon && c.description.identifier.value === 'ms-vscode.js-debug') {
						e.icon = '$(debug)';
					}
					// Only support $(id) for now, without that it should point to a path to be
					// consistent with other icon APIs
					if (e.icon && e.icon.startsWith('$(') && e.icon.endsWith(')')) {
						e.icon = e.icon.substr(2, e.icon.length - 3);
					} else {
						e.icon = undefined;
					}
					return e;
				}) || [];
			}));
		});
	}
}
