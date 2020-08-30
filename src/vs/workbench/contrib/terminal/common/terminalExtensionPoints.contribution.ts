/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalContributionService, TerminalContributionService } from './terminalExtensionPoints';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

registerSingleton(ITerminalContributionService, TerminalContributionService, true);
