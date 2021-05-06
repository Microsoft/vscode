/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IDecorationData, IDecorationsProvider } from 'vs/workbench/services/decorations/browser/decorations';
import { Event, Emitter } from 'vs/base/common/event';
import { Schemas } from 'vs/base/common/network';
import { getColorForSeverity } from 'vs/workbench/contrib/terminal/browser/terminalStatusList';

export interface ITerminalDecorationData {
	tooltip: string,
	statusIcon: string,
	color: string
}

export class TerminalDecorationsProvider implements IDecorationsProvider {
	readonly label: string = localize('label', "Terminal");
	private readonly _onDidChange = new Emitter<URI[]>();

	constructor(
		@ITerminalService private readonly _terminalService: ITerminalService
	) {
		this._terminalService.onInstancePrimaryStatusChanged(e => this._onDidChange.fire([e.resource]));
	}

	get onDidChange(): Event<URI[]> {
		return this._onDidChange.event;
	}

	provideDecorations(resource: URI): IDecorationData | undefined {
		if (resource.scheme !== Schemas.vscodeTerminal) {
			return undefined;
		}

		const instanceId = parseInt(resource.fragment);
		if (!instanceId) {
			return undefined;
		}

		const instance = this._terminalService.getInstanceFromId(parseInt(resource.fragment));
		const primaryStatus = instance?.statusList?.primary;
		if (!primaryStatus?.icon) {
			return undefined;
		}

		return {
			color: getColorForSeverity(primaryStatus.severity),
			letter: primaryStatus.icon,
			tooltip: primaryStatus.tooltip
		};
	}

	dispose(): void {
		this.dispose();
	}
}
