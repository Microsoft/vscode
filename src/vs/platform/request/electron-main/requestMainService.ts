/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRequestOptions, IRequestContext } from 'vs/base/parts/request/common/request';
import { RequestService as NodeRequestService, IRawRequestFunction } from 'vs/platform/request/node/requestService';
import { assign } from 'vs/base/common/objects';
import { net } from 'electron';
import { CancellationToken } from 'vs/base/common/cancellation';

function getRawRequest(options: IRequestOptions): IRawRequestFunction {
	return net.request as any as IRawRequestFunction;
}

export class RequestMainService extends NodeRequestService {

	request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
		return super.request(assign({}, options || {}, { getRawRequest }), token);
	}
}
