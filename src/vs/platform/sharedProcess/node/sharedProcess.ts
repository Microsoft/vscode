/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISandboxConfiguration } from 'vs/base/parts/sandbox/common/sandboxTypes';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { LogLevel } from 'vs/platform/log/common/log';

export interface ISharedProcess {

	/**
	 * Toggles the visibility of the otherwise hidden
	 * shared process window.
	 */
	toggle(): Promise<void>;
}

export interface ISharedProcessConfiguration extends ISandboxConfiguration {
	readonly machineId: string;

	readonly args: NativeParsedArgs;

	readonly logLevel: LogLevel;

	readonly backupWorkspacesPath: string;
}
