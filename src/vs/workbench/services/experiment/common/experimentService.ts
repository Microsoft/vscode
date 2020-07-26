/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const ITASExperimentService = createDecorator<ITASExperimentService>('TASExperimentService');

export interface ITASExperimentService {
	readonly _serviceBrand: undefined;
	getTreatment<T extends string | number | boolean>(name: string): Promise<T | undefined>;
}
