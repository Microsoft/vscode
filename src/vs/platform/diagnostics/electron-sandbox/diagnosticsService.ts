/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSharedProcessRemoteService } from 'vs/platform/ipc/electron-sandbox/services';
import { IDiagnosticsService } from 'vs/platform/diagnostics/common/diagnostics';

registerSharedProcessRemoteService(IDiagnosticsService, 'diagnostics', { supportsDelayedInstantiation: true });
