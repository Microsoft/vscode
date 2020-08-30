/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceLabelFormatter } from 'vs/platform/label/common/label';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { MainThreadLabelServiceShape, ExtHostLabelServiceShape, MainContext, IMainContext } from 'vs/workbench/api/common/extHost.protocol';

export class ExtHostLabelService implements ExtHostLabelServiceShape {

	private readonly _proxy: MainThreadLabelServiceShape;
	private _handlePool: number = 0;

	constructor(mainContext: IMainContext) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadLabelService);
	}

	$registerResourceLabelFormatter(formatter: ResourceLabelFormatter): IDisposable {
		const handle = this._handlePool++;
		this._proxy.$registerResourceLabelFormatter(handle, formatter);

		return toDisposable(() => {
			this._proxy.$unregisterResourceLabelFormatter(handle);
		});
	}
}
