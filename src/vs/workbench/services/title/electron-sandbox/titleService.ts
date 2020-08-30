/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { TitlebarPart } from 'vs/workbench/electron-sandbox/parts/titlebar/titlebarPart';
import { ITitleService } from 'vs/workbench/services/title/common/titleService';

registerSingleton(ITitleService, TitlebarPart);
