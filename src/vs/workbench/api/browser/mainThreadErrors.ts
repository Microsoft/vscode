/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SerializedError, onUnexpectedError } from 'vs/base/common/errors';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { MainContext, MainThreadErrorsShape } from 'vs/workbench/api/common/extHost.protocol';

@extHostNamedCustomer(MainContext.MainThreadErrors)
export class MainThreadErrors implements MainThreadErrorsShape {

	dispose(): void {
		//
	}

	$onUnexpectedError(err: any | SerializedError): void {
		if (err && err.$isError) {
			const { name, message, stack } = err;
			err = new Error();
			err.message = message;
			err.name = name;
			err.stack = stack;
		}
		onUnexpectedError(err);
	}
}
