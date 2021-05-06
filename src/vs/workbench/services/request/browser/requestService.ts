/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRequestOptions, IRequestContext } from 'vs/base/parts/request/common/request';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { RequestChannelClient } from 'vs/platform/request/common/requestIpc';
import { IRemoteAgentService, IRemoteAgentConnection } from 'vs/workbench/services/remote/common/remoteAgentService';
import { RequestService } from 'vs/platform/request/browser/requestService';

export class BrowserRequestService extends RequestService {

	constructor(
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService
	) {
		super(configurationService, logService);
	}

	override async request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
		try {
			const context = await super.request(options, token);
			const connection = this.remoteAgentService.getConnection();
			if (connection && context.res.statusCode === 405) {
				return this._makeRemoteRequest(connection, options, token);
			}
			return context;
		} catch (error) {
			const connection = this.remoteAgentService.getConnection();
			if (connection) {
				return this._makeRemoteRequest(connection, options, token);
			}
			throw error;
		}
	}

	private _makeRemoteRequest(connection: IRemoteAgentConnection, options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
		return connection.withChannel('request', channel => RequestChannelClient.request(channel, options, token));
	}
}
