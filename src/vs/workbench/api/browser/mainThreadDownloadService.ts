/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { MainContext, IExtHostContext, MainThreadDownloadServiceShape } from 'vs/workbench/api/common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IDownloadService } from 'vs/platform/download/common/download';
import { UriComponents, URI } from 'vs/base/common/uri';

@extHostNamedCustomer(MainContext.MainThreadDownloadService)
export class MainThreadDownloadService extends Disposable implements MainThreadDownloadServiceShape {

	constructor(
		extHostContext: IExtHostContext,
		@IDownloadService private readonly downloadService: IDownloadService
	) {
		super();
	}

	$download(uri: UriComponents, to: UriComponents): Promise<void> {
		return this.downloadService.download(URI.revive(uri), URI.revive(to));
	}

}
