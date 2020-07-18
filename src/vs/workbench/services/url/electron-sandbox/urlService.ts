/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IURLService, IURLHandler, IOpenURLOptions } from 'vs/platform/url/common/url';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { URLHandlerChannel } from 'vs/platform/url/common/urlIpc';
import { IOpenerService, IOpener, matchesScheme } from 'vs/platform/opener/common/opener';
import { IProductService } from 'vs/platform/product/common/productService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createChannelSender } from 'vs/base/parts/ipc/common/ipc';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { NativeURLService } from 'vs/platform/url/common/urlService';

export interface IRelayOpenURLOptions extends IOpenURLOptions {
	openToSide?: boolean;
	openExternal?: boolean;
}

export class RelayURLService extends NativeURLService implements IURLHandler, IOpener {

	private urlService: IURLService;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IOpenerService openerService: IOpenerService,
		@IElectronService private readonly electronService: IElectronService,
		@IProductService private readonly productService: IProductService
	) {
		super();

		this.urlService = createChannelSender(mainProcessService.getChannel('url'));

		mainProcessService.registerChannel('urlHandler', new URLHandlerChannel(this));
		openerService.registerOpener(this);
	}

	create(options?: Partial<UriComponents>): URI {
		const uri = super.create(options);

		let query = uri.query;
		if (!query) {
			query = `windowId=${encodeURIComponent(this.electronService.windowId)}`;
		} else {
			query += `&windowId=${encodeURIComponent(this.electronService.windowId)}`;
		}

		return uri.with({ query });
	}

	async open(resource: URI | string, options?: IRelayOpenURLOptions): Promise<boolean> {

		if (!matchesScheme(resource, this.productService.urlProtocol)) {
			return false;
		}

		if (typeof resource === 'string') {
			resource = URI.parse(resource);
		}
		return await this.urlService.open(resource, options);
	}

	async handleURL(uri: URI, options?: IOpenURLOptions): Promise<boolean> {
		const result = await super.open(uri, options);

		if (result) {
			await this.electronService.focusWindow();
		}

		return result;
	}
}

registerSingleton(IURLService, RelayURLService);
