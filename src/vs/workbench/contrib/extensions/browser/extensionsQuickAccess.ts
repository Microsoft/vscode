/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IPickerQuickAccessItem, PickerQuickAccessProvider } from 'vs/platform/quickinput/browser/pickerQuickAccess';
import { CancellationToken } from 'vs/base/common/cancellation';
import { localize } from 'vs/nls';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { VIEWLET_ID, IExtensionsViewPaneContainer } from 'vs/workbench/contrib/extensions/common/extensions';
import { IExtensionGalleryService, IExtensionManagementService, IGalleryExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ILogService } from 'vs/platform/log/common/log';
import { DisposableStore } from 'vs/base/common/lifecycle';

export class InstallExtensionQuickAccessProvider extends PickerQuickAccessProvider<IPickerQuickAccessItem> {

	static PREFIX = 'ext install ';

	constructor(
		@IViewletService private readonly viewletService: IViewletService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IExtensionManagementService private readonly extensionsService: IExtensionManagementService,
		@INotificationService private readonly notificationService: INotificationService,
		@ILogService private readonly logService: ILogService
	) {
		super(InstallExtensionQuickAccessProvider.PREFIX);
	}

	protected _getPicks(filter: string, disposables: DisposableStore, token: CancellationToken): Array<IPickerQuickAccessItem | IQuickPickSeparator> | Promise<Array<IPickerQuickAccessItem | IQuickPickSeparator>> {

		// Nothing typed
		if (!filter) {
			return [{
				label: localize('type', "Type an extension name to install or search.")
			}];
		}

		const genericSearchPickItem: IPickerQuickAccessItem = {
			label: localize('searchFor', "Press Enter to search for extension '{0}'.", filter),
			accept: () => this.searchExtension(filter)
		};

		// Extension ID typed: try to find it
		if (/\./.test(filter)) {
			return this.getPicksForExtensionId(filter, genericSearchPickItem, token);
		}

		// Extension name typed: offer to search it
		return [genericSearchPickItem];
	}

	private async getPicksForExtensionId(filter: string, fallback: IPickerQuickAccessItem, token: CancellationToken): Promise<Array<IPickerQuickAccessItem | IQuickPickSeparator>> {
		try {
			const galleryResult = await this.galleryService.query({ names: [filter], pageSize: 1 }, token);
			if (token.isCancellationRequested) {
				return []; // return early if canceled
			}

			const galleryExtension = galleryResult.firstPage[0];
			if (!galleryExtension) {
				return [fallback];
			}

			return [{
				label: localize('install', "Press Enter to install extension '{0}'.", filter),
				accept: () => this.installExtension(galleryExtension, filter)
			}];
		} catch (error) {
			if (token.isCancellationRequested) {
				return []; // expected error
			}

			this.logService.error(error);

			return [fallback];
		}
	}

	private async installExtension(extension: IGalleryExtension, name: string): Promise<void> {
		try {
			await openExtensionsViewlet(this.viewletService, `@id:${name}`);
			await this.extensionsService.installFromGallery(extension);
		} catch (error) {
			this.notificationService.error(error);
		}
	}

	private async searchExtension(name: string): Promise<void> {
		openExtensionsViewlet(this.viewletService, name);
	}
}

export class ManageExtensionsQuickAccessProvider extends PickerQuickAccessProvider<IPickerQuickAccessItem> {

	static PREFIX = 'ext ';

	constructor(@IViewletService private readonly viewletService: IViewletService) {
		super(ManageExtensionsQuickAccessProvider.PREFIX);
	}

	protected _getPicks(): Array<IPickerQuickAccessItem | IQuickPickSeparator> {
		return [{
			label: localize('manage', "Press Enter to manage your extensions."),
			accept: () => openExtensionsViewlet(this.viewletService)
		}];
	}
}

async function openExtensionsViewlet(viewletService: IViewletService, search = ''): Promise<void> {
	const viewlet = await viewletService.openViewlet(VIEWLET_ID, true);
	const view = viewlet?.getViewPaneContainer() as IExtensionsViewPaneContainer | undefined;
	view?.search(search);
	view?.focus();
}
