/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainContext, MainThreadLabelServiceShape, IExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { ResourceLabelFormatter, ILabelService } from 'vs/platform/label/common/label';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';

@extHostNamedCustomer(MainContext.MainThreadLabelService)
export class MainThreadLabelService implements MainThreadLabelServiceShape {

	private readonly _resourceLabelFormatters = new Map<number, IDisposable>();

	constructor(
		_: IExtHostContext,
		@ILabelService private readonly _labelService: ILabelService
	) { }

	$registerResourceLabelFormatter(handle: number, formatter: ResourceLabelFormatter): void {
		// Dynamicily registered formatters should have priority over those contributed via package.json
		formatter.priority = true;
		const disposable = this._labelService.registerFormatter(formatter);
		this._resourceLabelFormatters.set(handle, disposable);
	}

	$unregisterResourceLabelFormatter(handle: number): void {
		dispose(this._resourceLabelFormatters.get(handle));
		this._resourceLabelFormatters.delete(handle);
	}

	dispose(): void {
		// noop
	}
}
