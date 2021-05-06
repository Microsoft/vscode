/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { IURLService } from 'vs/platform/url/common/url';
import { IProductService } from 'vs/platform/product/common/productService';
import { app, Event as ElectronEvent } from 'electron';
import { URI } from 'vs/base/common/uri';
import { IDisposable, DisposableStore, Disposable } from 'vs/base/common/lifecycle';
import { IWindowsMainService } from 'vs/platform/windows/electron-main/windows';
import { isWindows } from 'vs/base/common/platform';
import { disposableTimeout } from 'vs/base/common/async';

function uriFromRawUrl(url: string): URI | null {
	try {
		return URI.parse(url);
	} catch (e) {
		return null;
	}
}

/**
 * A listener for URLs that are opened from the OS and handled by VSCode.
 * Depending on the platform, this works differently:
 * - Windows: we use `app.setAsDefaultProtocolClient()` to register VSCode with the OS
 *            and additionally add the `open-url` command line argument to identify.
 * - macOS:   we rely on `app.on('open-url')` to be called by the OS
 * - Linux:   we have a special shortcut installed (`resources/linux/code-url-handler.desktop`)
 *            that calls VSCode with the `open-url` command line argument
 *            (https://github.com/microsoft/vscode/pull/56727)
 */
export class ElectronURLListener {

	private uris: { uri: URI, url: string }[] = [];
	private retryCount = 0;
	private flushDisposable: IDisposable = Disposable.None;
	private disposables = new DisposableStore();

	constructor(
		initialUrisToHandle: { uri: URI, url: string }[],
		private readonly urlService: IURLService,
		windowsMainService: IWindowsMainService,
		environmentMainService: IEnvironmentMainService,
		productService: IProductService
	) {

		// the initial set of URIs we need to handle once the window is ready
		this.uris = initialUrisToHandle;

		// Windows: install as protocol handler
		if (isWindows) {
			const windowsParameters = environmentMainService.isBuilt ? [] : [`"${environmentMainService.appRoot}"`];
			windowsParameters.push('--open-url', '--');
			app.setAsDefaultProtocolClient(productService.urlProtocol, process.execPath, windowsParameters);
		}

		// macOS: listen to `open-url` events from here on to handle
		const onOpenElectronUrl = Event.map(
			Event.fromNodeEventEmitter(app, 'open-url', (event: ElectronEvent, url: string) => ({ event, url })),
			({ event, url }) => {
				event.preventDefault(); // always prevent default and return the url as string
				return url;
			});

		this.disposables.add(onOpenElectronUrl(url => {
			const uri = uriFromRawUrl(url);

			if (!uri) {
				return;
			}

			this.urlService.open(uri, { originalUrl: url });
		}));

		// Send initial links to the window once it has loaded
		const isWindowReady = windowsMainService.getWindows()
			.filter(w => w.isReady)
			.length > 0;

		if (isWindowReady) {
			this.flush();
		} else {
			Event.once(windowsMainService.onDidSignalReadyWindow)(this.flush, this, this.disposables);
		}
	}

	private async flush(): Promise<void> {
		if (this.retryCount++ > 10) {
			return;
		}

		const uris: { uri: URI, url: string }[] = [];

		for (const obj of this.uris) {
			const handled = await this.urlService.open(obj.uri, { originalUrl: obj.url });

			if (!handled) {
				uris.push(obj);
			}
		}

		if (uris.length === 0) {
			return;
		}

		this.uris = uris;
		this.flushDisposable = disposableTimeout(() => this.flush(), 500);
	}

	dispose(): void {
		this.disposables.dispose();
		this.flushDisposable.dispose();
	}
}
