/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOutputChannelModelService, AsbtractOutputChannelModelService } from 'vs/workbench/services/output/common/outputChannelModel';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export class OutputChannelModelService extends AsbtractOutputChannelModelService implements IOutputChannelModelService {
	declare readonly _serviceBrand: undefined;
}

registerSingleton(IOutputChannelModelService, OutputChannelModelService);

