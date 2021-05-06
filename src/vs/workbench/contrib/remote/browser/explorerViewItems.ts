/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachSelectBoxStyler } from 'vs/platform/theme/common/styler';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IRemoteExplorerService, REMOTE_EXPLORER_TYPE_KEY } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { ISelectOptionItem } from 'vs/base/browser/ui/selectBox/selectBox';
import { IViewDescriptor } from 'vs/workbench/common/views';
import { isStringArray } from 'vs/base/common/types';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ContextKeyEqualsExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { SelectActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { Action2, MenuId } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { VIEWLET_ID } from 'vs/workbench/contrib/remote/browser/remoteExplorer';

export interface IRemoteSelectItem extends ISelectOptionItem {
	authority: string[];
}

export class SwitchRemoteViewItem extends SelectActionViewItem {

	constructor(
		action: IAction,
		private readonly optionsItems: IRemoteSelectItem[],
		@IThemeService themeService: IThemeService,
		@IContextViewService contextViewService: IContextViewService,
		@IRemoteExplorerService private remoteExplorerService: IRemoteExplorerService,
		@IWorkbenchEnvironmentService private environmentService: IWorkbenchEnvironmentService,
		@IStorageService private readonly storageService: IStorageService
	) {
		super(null, action, optionsItems, 0, contextViewService, { ariaLabel: nls.localize('remotes', 'Switch Remote') });
		this._register(attachSelectBoxStyler(this.selectBox, themeService));
	}

	public setSelectionForConnection(): boolean {
		let isSetForConnection = false;
		if (this.optionsItems.length > 0) {
			let index = 0;
			const remoteAuthority = this.environmentService.remoteAuthority;
			isSetForConnection = true;
			const explorerType: string[] | undefined = remoteAuthority ? [remoteAuthority.split('+')[0]] :
				this.storageService.get(REMOTE_EXPLORER_TYPE_KEY, StorageScope.WORKSPACE)?.split(',') ?? this.storageService.get(REMOTE_EXPLORER_TYPE_KEY, StorageScope.GLOBAL)?.split(',');
			if (explorerType !== undefined) {
				index = this.getOptionIndexForExplorerType(explorerType);
			}
			this.select(index);
			this.remoteExplorerService.targetType = this.optionsItems[index].authority;
		}
		return isSetForConnection;
	}

	public setSelection() {
		const index = this.getOptionIndexForExplorerType(this.remoteExplorerService.targetType);
		this.select(index);
	}

	private getOptionIndexForExplorerType(explorerType: string[]): number {
		let index = 0;
		for (let optionIterator = 0; (optionIterator < this.optionsItems.length) && (index === 0); optionIterator++) {
			for (let authorityIterator = 0; authorityIterator < this.optionsItems[optionIterator].authority.length; authorityIterator++) {
				for (let i = 0; i < explorerType.length; i++) {
					if (this.optionsItems[optionIterator].authority[authorityIterator] === explorerType[i]) {
						index = optionIterator;
						break;
					}
				}
			}
		}
		return index;
	}

	override render(container: HTMLElement) {
		if (this.optionsItems.length > 1) {
			super.render(container);
			container.classList.add('switch-remote');
		}
	}

	protected override getActionContext(_: string, index: number): any {
		return this.optionsItems[index];
	}

	static createOptionItems(views: IViewDescriptor[], contextKeyService: IContextKeyService): IRemoteSelectItem[] {
		let options: IRemoteSelectItem[] = [];
		views.forEach(view => {
			if (view.group && view.group.startsWith('targets') && view.remoteAuthority && (!view.when || contextKeyService.contextMatchesRules(view.when))) {
				options.push({ text: view.name, authority: isStringArray(view.remoteAuthority) ? view.remoteAuthority : [view.remoteAuthority] });
			}
		});
		return options;
	}
}

export class SwitchRemoteAction extends Action2 {

	public static readonly ID = 'remote.explorer.switch';
	public static readonly LABEL = nls.localize('remote.explorer.switch', "Switch Remote");

	constructor() {
		super({
			id: SwitchRemoteAction.ID,
			title: SwitchRemoteAction.LABEL,
			menu: [{
				id: MenuId.ViewContainerTitle,
				when: ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID),
				group: 'navigation',
				order: 1
			}],
		});
	}

	public async run(accessor: ServicesAccessor, args: IRemoteSelectItem): Promise<any> {
		accessor.get(IRemoteExplorerService).targetType = args.authority;
	}
}
