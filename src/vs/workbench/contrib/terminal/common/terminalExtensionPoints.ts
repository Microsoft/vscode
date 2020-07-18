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
	public readonly _serviceBrand = undefined;

	private _terminalTypes: ReadonlyArray<ITerminalTypeContribution> = [];

	public get terminalTypes() {
		return this._terminalTypes;
	}

	constructor() {
		terminalsExtPoint.setHandler(contributions => {
			this._terminalTypes = flatten(contributions.filter(c => c.description.enableProposedApi).map(c => c.value?.types ?? []));
		});
	}
}
