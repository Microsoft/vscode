/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfiguration } from 'vs/editor/common/editorCommon';
import { ViewEventHandler } from 'vs/editor/common/viewModel/viewEventHandler';
import { IViewLayout, IViewModel } from 'vs/editor/common/viewModel/viewModel';
import { IColorTheme, ThemeType } from 'vs/platform/theme/common/themeService';
import { ColorIdentifier } from 'vs/platform/theme/common/colorRegistry';
import { Color } from 'vs/base/common/color';

export class EditorTheme {

	private _theme: IColorTheme;

	public get type(): ThemeType {
		return this._theme.type;
	}

	constructor(theme: IColorTheme) {
		this._theme = theme;
	}

	public update(theme: IColorTheme): void {
		this._theme = theme;
	}

	public getColor(color: ColorIdentifier): Color | undefined {
		return this._theme.getColor(color);
	}
}

export class ViewContext {

	public readonly configuration: IConfiguration;
	public readonly model: IViewModel;
	public readonly viewLayout: IViewLayout;
	public readonly theme: EditorTheme;

	constructor(
		configuration: IConfiguration,
		theme: IColorTheme,
		model: IViewModel
	) {
		this.configuration = configuration;
		this.theme = new EditorTheme(theme);
		this.model = model;
		this.viewLayout = model.viewLayout;
	}

	public addEventHandler(eventHandler: ViewEventHandler): void {
		this.model.addViewEventHandler(eventHandler);
	}

	public removeEventHandler(eventHandler: ViewEventHandler): void {
		this.model.removeViewEventHandler(eventHandler);
	}
}
