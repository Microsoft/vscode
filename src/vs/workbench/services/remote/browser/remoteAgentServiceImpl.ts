/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IRemoteAgentConnection, IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { AbstractRemoteAgentService, RemoteAgentConnection } from 'vs/workbench/services/remote/common/abstractRemoteAgentService';
import { IProductService } from 'vs/platform/product/common/productService';
import { IWebSocketFactory, BrowserSocketFactory } from 'vs/platform/remote/browser/browserSocketFactory';
import { ISignService } from 'vs/platform/sign/common/sign';
import { ISocketFactory } from 'vs/platform/remote/common/remoteAgentConnection';
import { ILogService } from 'vs/platform/log/common/log';

export class RemoteAgentService extends AbstractRemoteAgentService implements IRemoteAgentService {

	public readonly socketFactory: ISocketFactory;

	private readonly _connection: IRemoteAgentConnection | null = null;

	constructor(
		webSocketFactory: IWebSocketFactory | null | undefined,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IProductService productService: IProductService,
		@IRemoteAuthorityResolverService remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@ISignService signService: ISignService,
		@ILogService logService: ILogService
	) {
		super(environmentService, remoteAuthorityResolverService);

		this.socketFactory = new BrowserSocketFactory(webSocketFactory);
		const remoteAuthority = environmentService.configuration.remoteAuthority;
		if (remoteAuthority) {
			this._connection = this._register(new RemoteAgentConnection(remoteAuthority, productService.commit, this.socketFactory, remoteAuthorityResolverService, signService, logService));
		}
	}

	getConnection(): IRemoteAgentConnection | null {
		return this._connection;
	}
}
