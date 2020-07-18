/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServerChannel, IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IRemoteDiagnosticInfo, IRemoteDiagnosticError, SystemInfo, PerformanceInfo } from 'vs/platform/diagnostics/common/diagnostics';
import { IDiagnosticsService } from './diagnosticsService';
import { Event } from 'vs/base/common/event';
import { IMainProcessInfo } from 'vs/platform/launch/common/launch';
import { IWorkspace } from 'vs/platform/workspace/common/workspace';

export class DiagnosticsChannel implements IServerChannel {

	constructor(private service: IDiagnosticsService) { }

	listen(context: any, event: string): Event<any> {
		throw new Error('Invalid listen');
	}

	call(context: any, command: string, args?: any): Promise<any> {
		switch (command) {
			case 'getDiagnostics':
				return this.service.getDiagnostics(args[0], args[1]);
			case 'getSystemInfo':
				return this.service.getSystemInfo(args[0], args[1]);
			case 'getPerformanceInfo':
				return this.service.getPerformanceInfo(args[0], args[1]);
			case 'reportWorkspaceStats':
				return this.service.reportWorkspaceStats(args);
		}

		throw new Error('Invalid call');
	}
}

export class DiagnosticsService implements IDiagnosticsService {

	declare readonly _serviceBrand: undefined;

	constructor(private channel: IChannel) { }

	public getDiagnostics(mainProcessInfo: IMainProcessInfo, remoteInfo: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]): Promise<string> {
		return this.channel.call('getDiagnostics', [mainProcessInfo, remoteInfo]);
	}

	public getSystemInfo(mainProcessInfo: IMainProcessInfo, remoteInfo: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]): Promise<SystemInfo> {
		return this.channel.call('getSystemInfo', [mainProcessInfo, remoteInfo]);
	}

	public getPerformanceInfo(mainProcessInfo: IMainProcessInfo, remoteInfo: (IRemoteDiagnosticInfo | IRemoteDiagnosticError)[]): Promise<PerformanceInfo> {
		return this.channel.call('getPerformanceInfo', [mainProcessInfo, remoteInfo]);
	}

	public reportWorkspaceStats(workspace: IWorkspace): Promise<void> {
		return this.channel.call('reportWorkspaceStats', workspace);
	}
}
