/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction } from 'vs/editor/browser/editorExtensions';
import { IStandaloneThemeService } from 'vs/editor/standalone/common/standaloneThemeService';
import { ToggleHighContrastNLS } from 'vs/editor/common/standaloneStrings';

class ToggleHighContrast extends EditorAction {

	private _originalThemeName: string | null;

	constructor() {
		super({
			id: 'editor.action.toggleHighContrast',
			label: ToggleHighContrastNLS.toggleHighContrast,
			alias: 'Toggle High Contrast Theme',
			precondition: undefined
		});
		this._originalThemeName = null;
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const standaloneThemeService = accessor.get(IStandaloneThemeService);
		if (this._originalThemeName) {
			// We must toggle back to the integrator's theme
			standaloneThemeService.setTheme(this._originalThemeName);
			this._originalThemeName = null;
		} else {
			this._originalThemeName = standaloneThemeService.getColorTheme().themeName;
			standaloneThemeService.setTheme('hc-black');
		}
	}
}

registerEditorAction(ToggleHighContrast);
