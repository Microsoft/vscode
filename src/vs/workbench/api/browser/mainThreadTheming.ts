/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainContext, IExtHostContext, ExtHostThemingShape, ExtHostContext, MainThreadThemingShape } from '../common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IThemeService } from 'vs/platform/theme/common/themeService';

@extHostNamedCustomer(MainContext.MainThreadTheming)
export class MainThreadTheming implements MainThreadThemingShape {

	private readonly _themeService: IThemeService;
	private readonly _proxy: ExtHostThemingShape;
	private readonly _themeChangeListener: IDisposable;

	constructor(
		extHostContext: IExtHostContext,
		@IThemeService themeService: IThemeService
	) {
		this._themeService = themeService;
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostTheming);

		this._themeChangeListener = this._themeService.onDidColorThemeChange(e => {
			this._proxy.$onColorThemeChange(this._themeService.getColorTheme().type);
		});
		this._proxy.$onColorThemeChange(this._themeService.getColorTheme().type);
	}

	dispose(): void {
		this._themeChangeListener.dispose();
	}
}
