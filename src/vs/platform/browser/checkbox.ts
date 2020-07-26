/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CheckboxActionViewItem } from 'vs/base/browser/ui/checkbox/checkbox';
import { IAction } from 'vs/base/common/actions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachCheckboxStyler } from 'vs/platform/theme/common/styler';
import { IBaseActionViewItemOptions } from 'vs/base/browser/ui/actionbar/actionViewItems';

export class ThemableCheckboxActionViewItem extends CheckboxActionViewItem {

	constructor(context: any, action: IAction, options: IBaseActionViewItemOptions | undefined, private readonly themeService: IThemeService) {
		super(context, action, options);
	}

	render(container: HTMLElement): void {
		super.render(container);
		if (this.checkbox) {
			this.disposables.add(attachCheckboxStyler(this.checkbox, this.themeService));
		}
	}

}

