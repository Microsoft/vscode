/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export const enum DispatchConfig {
	Code,
	KeyCode
}

export function getDispatchConfig(configurationService: IConfigurationService): DispatchConfig {
	const keyboard = configurationService.getValue('keyboard');
	const r = (keyboard ? (<any>keyboard).dispatch : null);
	return (r === 'keyCode' ? DispatchConfig.KeyCode : DispatchConfig.Code);
}
