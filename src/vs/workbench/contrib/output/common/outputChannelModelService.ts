/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IOutputChannelModelService, AbstractOutputChannelModelService } from 'vs/workbench/contrib/output/common/outputChannelModel';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export class OutputChannelModelService extends AbstractOutputChannelModelService implements IOutputChannelModelService {
	declare readonly _serviceBrand: undefined;
}

registerSingleton(IOutputChannelModelService, OutputChannelModelService);

