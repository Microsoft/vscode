/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';

import { IAction, Action } from 'vs/base/common/actions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachSelectBoxStyler } from 'vs/platform/theme/common/styler';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IRemoteExplorerService, REMOTE_EXPLORER_TYPE_KEY } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { ISelectOptionItem } from 'vs/base/browser/ui/selectBox/selectBox';
import { IViewDescriptor } from 'vs/workbench/common/views';
import { startsWith } from 'vs/base/common/strings';
import { isStringArray } from 'vs/base/common/types';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { SelectActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';

export interface IRemoteSelectItem extends ISelectOptionItem {
	authority: string[];
}

export class SwitchRemoteViewItem extends SelectActionViewItem {

	constructor(
		action: IAction,
		private readonly optionsItems: IRemoteSelectItem[],
		@IThemeService themeService: IThemeService,
		@IContextViewService contextViewService: IContextViewService,
		@IRemoteExplorerService remoteExplorerService: IRemoteExplorerService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super(null, action, optionsItems, 0, contextViewService, { ariaLabel: nls.localize('remotes', 'Switch Remote') });
		this._register(attachSelectBoxStyler(this.selectBox, themeService));

		this.setSelectionForConnection(optionsItems, environmentService, remoteExplorerService);
	}

	private setSelectionForConnection(optionsItems: IRemoteSelectItem[], environmentService: IWorkbenchEnvironmentService, remoteExplorerService: IRemoteExplorerService) {
		if (this.optionsItems.length > 0) {
			let index = 0;
			const remoteAuthority = environmentService.configuration.remoteAuthority;
			const explorerType: string[] | undefined = remoteAuthority ? [remoteAuthority.split('+')[0]] :
				this.storageService.get(REMOTE_EXPLORER_TYPE_KEY, StorageScope.WORKSPACE)?.split(',') ?? this.storageService.get(REMOTE_EXPLORER_TYPE_KEY, StorageScope.GLOBAL)?.split(',');
			if (explorerType !== undefined) {
				index = this.getOptionIndexForExplorerType(optionsItems, explorerType);
			}
			this.select(index);
			remoteExplorerService.targetType = optionsItems[index].authority;
		}
	}

	private getOptionIndexForExplorerType(optionsItems: IRemoteSelectItem[], explorerType: string[]): number {
		let index = 0;
		for (let optionIterator = 0; (optionIterator < this.optionsItems.length) && (index === 0); optionIterator++) {
			for (let authorityIterator = 0; authorityIterator < optionsItems[optionIterator].authority.length; authorityIterator++) {
				for (let i = 0; i < explorerType.length; i++) {
					if (optionsItems[optionIterator].authority[authorityIterator] === explorerType[i]) {
						index = optionIterator;
						break;
					}
				}
			}
		}
		return index;
	}

	render(container: HTMLElement) {
		if (this.optionsItems.length > 1) {
			super.render(container);
			dom.addClass(container, 'switch-remote');
		}
	}

	protected getActionContext(_: string, index: number): any {
		return this.optionsItems[index];
	}

	static createOptionItems(views: IViewDescriptor[], contextKeyService: IContextKeyService): IRemoteSelectItem[] {
		let options: IRemoteSelectItem[] = [];
		views.forEach(view => {
			if (view.group && startsWith(view.group, 'targets') && view.remoteAuthority && (!view.when || contextKeyService.contextMatchesRules(view.when))) {
				options.push({ text: view.name, authority: isStringArray(view.remoteAuthority) ? view.remoteAuthority : [view.remoteAuthority] });
			}
		});
		return options;
	}
}

export class SwitchRemoteAction extends Action {

	public static readonly ID = 'remote.explorer.switch';
	public static readonly LABEL = nls.localize('remote.explorer.switch', "Switch Remote");

	constructor(
		id: string, label: string,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService
	) {
		super(id, label);
	}

	public async run(item: IRemoteSelectItem): Promise<any> {
		this.remoteExplorerService.targetType = item.authority;
	}
}
