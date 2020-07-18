/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRemoteAgentConnection, IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IProductService } from 'vs/platform/product/common/productService';
import { nodeSocketFactory } from 'vs/platform/remote/node/nodeSocketFactory';
import { AbstractRemoteAgentService, RemoteAgentConnection } from 'vs/workbench/services/remote/common/abstractRemoteAgentService';
import { ISignService } from 'vs/platform/sign/common/sign';
import { ISocketFactory } from 'vs/platform/remote/common/remoteAgentConnection';
import { ILogService } from 'vs/platform/log/common/log';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

export class RemoteAgentService extends AbstractRemoteAgentService implements IRemoteAgentService {

	public readonly socketFactory: ISocketFactory;

	private readonly _connection: IRemoteAgentConnection | null = null;

	constructor(
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IRemoteAuthorityResolverService remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@ISignService signService: ISignService,
		@ILogService logService: ILogService,
		@IProductService productService: IProductService
	) {
		super(environmentService, remoteAuthorityResolverService);
		this.socketFactory = nodeSocketFactory;
		if (environmentService.configuration.remoteAuthority) {
			this._connection = this._register(new RemoteAgentConnection(environmentService.configuration.remoteAuthority, productService.commit, nodeSocketFactory, remoteAuthorityResolverService, signService, logService));
		}
	}

	getConnection(): IRemoteAgentConnection | null {
		return this._connection;
	}
}
