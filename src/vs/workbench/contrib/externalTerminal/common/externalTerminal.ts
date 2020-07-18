/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IExternalTerminalService = createDecorator<IExternalTerminalService>('nativeTerminalService');

export interface IExternalTerminalSettings {
	linuxExec?: string;
	osxExec?: string;
	windowsExec?: string;
}

export interface IExternalTerminalService {
	readonly _serviceBrand: undefined;
	openTerminal(path: string): void;
	runInTerminal(title: string, cwd: string, args: string[], env: { [key: string]: string | null; }, settings: IExternalTerminalSettings): Promise<number | undefined>;
}

export interface IExternalTerminalConfiguration {
	terminal: {
		explorerKind: 'integrated' | 'external',
		external: IExternalTerminalSettings;
	};
}
