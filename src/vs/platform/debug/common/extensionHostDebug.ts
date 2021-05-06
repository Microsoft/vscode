/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';

export const IExtensionHostDebugService = createDecorator<IExtensionHostDebugService>('extensionHostDebugService');

export interface IAttachSessionEvent {
	sessionId: string;
	subId?: string;
	port: number;
}

export interface ITerminateSessionEvent {
	sessionId: string;
	subId?: string;
}

export interface IReloadSessionEvent {
	sessionId: string;
}

export interface ICloseSessionEvent {
	sessionId: string;
}

export interface IOpenExtensionWindowResult {
	rendererDebugPort?: number;
	success: boolean;
}

/**
 * Like a IProcessEnvironment, but the value "null" deletes an environment variable
 */
export interface INullableProcessEnvironment {
	[key: string]: string | null;
}

export interface IExtensionHostDebugService {
	readonly _serviceBrand: undefined;

	reload(sessionId: string): void;
	readonly onReload: Event<IReloadSessionEvent>;

	close(sessionId: string): void;
	readonly onClose: Event<ICloseSessionEvent>;

	attachSession(sessionId: string, port: number, subId?: string): void;
	readonly onAttachSession: Event<IAttachSessionEvent>;

	terminateSession(sessionId: string, subId?: string): void;
	readonly onTerminateSession: Event<ITerminateSessionEvent>;

	openExtensionDevelopmentHostWindow(args: string[], env: INullableProcessEnvironment | undefined, debugRenderer: boolean): Promise<IOpenExtensionWindowResult>;
}
