/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { startExtensionHostProcess } from 'vs/workbench/services/extensions/node/extensionHostProcessSetup';

startExtensionHostProcess().catch((err) => console.log(err));
