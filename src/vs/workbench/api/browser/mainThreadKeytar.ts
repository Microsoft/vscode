/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { MainContext, MainThreadKeytarShape, IExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { ICredentialsService } from 'vs/platform/credentials/common/credentials';

@extHostNamedCustomer(MainContext.MainThreadKeytar)
export class MainThreadKeytar implements MainThreadKeytarShape {

	constructor(
		_extHostContext: IExtHostContext,
		@ICredentialsService private readonly _credentialsService: ICredentialsService,
	) { }

	async $getPassword(service: string, account: string): Promise<string | null> {
		return this._credentialsService.getPassword(service, account);
	}

	async $setPassword(service: string, account: string, password: string): Promise<void> {
		return this._credentialsService.setPassword(service, account, password);
	}

	async $deletePassword(service: string, account: string): Promise<boolean> {
		return this._credentialsService.deletePassword(service, account);
	}

	async $findPassword(service: string): Promise<string | null> {
		return this._credentialsService.findPassword(service);
	}

	async $findCredentials(service: string): Promise<Array<{ account: string, password: string }>> {
		return this._credentialsService.findCredentials(service);
	}

	dispose(): void {
		//
	}
}
