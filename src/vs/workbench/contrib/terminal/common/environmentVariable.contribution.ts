/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEnvironmentVariableService } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { EnvironmentVariableService } from 'vs/workbench/contrib/terminal/common/environmentVariableService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

registerSingleton(IEnvironmentVariableService, EnvironmentVariableService, true);
