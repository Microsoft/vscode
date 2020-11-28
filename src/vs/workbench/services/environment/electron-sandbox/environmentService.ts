/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchConfiguration, IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { INativeWindowConfiguration, IOSConfiguration } from 'vs/platform/windows/common/windows';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const INativeWorkbenchEnvironmentService = createDecorator<INativeWorkbenchEnvironmentService>('nativeEnvironmentService');

export interface INativeWorkbenchConfiguration extends IWorkbenchConfiguration, INativeWindowConfiguration { }

/**
 * A subclass of the `IWorkbenchEnvironmentService` to be used only in native
 * environments (Windows, Linux, macOS) but not e.g. web.
 */
export interface INativeWorkbenchEnvironmentService extends IWorkbenchEnvironmentService, INativeEnvironmentService {

	readonly machineId: string;

	readonly crashReporterDirectory?: string;
	readonly crashReporterId?: string;

	readonly execPath: string;

	readonly log?: string;

	readonly os: IOSConfiguration;

	/**
	 * @deprecated this property will go away eventually as it
	 * duplicates many properties of the environment service
	 *
	 * Please consider using the environment service directly
	 * if you can.
	 */
	readonly configuration: INativeWorkbenchConfiguration;
}
