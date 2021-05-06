/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { setFullscreen } from 'vs/base/browser/browser';
import { addDisposableListener, addDisposableThrottledListener, detectFullscreen, EventHelper, EventType, windowOpenNoOpener } from 'vs/base/browser/dom';
import { domEvent } from 'vs/base/browser/event';
import { timeout } from 'vs/base/common/async';
import { Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { isIOS, isMacintosh } from 'vs/base/common/platform';
import Severity from 'vs/base/common/severity';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { registerWindowDriver } from 'vs/platform/driver/browser/driver';
import { ILabelService } from 'vs/platform/label/common/label';
import { ILogService } from 'vs/platform/log/common/log';
import { IOpenerService, matchesScheme } from 'vs/platform/opener/common/opener';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { BrowserLifecycleService } from 'vs/workbench/services/lifecycle/browser/lifecycleService';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';

export class BrowserWindow extends Disposable {

	constructor(
		@IOpenerService private readonly openerService: IOpenerService,
		@ILifecycleService private readonly lifecycleService: BrowserLifecycleService,
		@IDialogService private readonly dialogService: IDialogService,
		@IHostService private readonly hostService: IHostService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@ILogService private readonly logService: ILogService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService
	) {
		super();

		this.registerListeners();
		this.create();
	}

	private registerListeners(): void {

		// Lifecycle
		this._register(this.lifecycleService.onWillShutdown(() => this.onWillShutdown()));

		// Layout
		const viewport = isIOS && window.visualViewport ? window.visualViewport /** Visual viewport */ : window /** Layout viewport */;
		this._register(addDisposableListener(viewport, EventType.RESIZE, () => this.onWindowResize()));

		// Prevent the back/forward gestures in macOS
		this._register(addDisposableListener(this.layoutService.container, EventType.WHEEL, e => e.preventDefault(), { passive: false }));

		// Prevent native context menus in web
		this._register(addDisposableListener(this.layoutService.container, EventType.CONTEXT_MENU, e => EventHelper.stop(e, true)));

		// Prevent default navigation on drop
		this._register(addDisposableListener(this.layoutService.container, EventType.DROP, e => EventHelper.stop(e, true)));

		// Fullscreen (Browser)
		[EventType.FULLSCREEN_CHANGE, EventType.WK_FULLSCREEN_CHANGE].forEach(event => {
			this._register(addDisposableListener(document, event, () => setFullscreen(!!detectFullscreen())));
		});

		// Fullscreen (Native)
		this._register(addDisposableThrottledListener(viewport, EventType.RESIZE, () => {
			setFullscreen(!!detectFullscreen());
		}, undefined, isMacintosh ? 2000 /* adjust for macOS animation */ : 800 /* can be throttled */));
	}

	private onWindowResize(): void {
		this.logService.trace(`web.main#${isIOS && window.visualViewport ? 'visualViewport' : 'window'}Resize`);

		this.layoutService.layout();
	}

	private onWillShutdown(): void {

		// Try to detect some user interaction with the workbench
		// when shutdown has happened to not show the dialog e.g.
		// when navigation takes a longer time.
		Event.toPromise(Event.any(
			Event.once(domEvent(document.body, EventType.KEY_DOWN, true)),
			Event.once(domEvent(document.body, EventType.MOUSE_DOWN, true))
		)).then(async () => {

			// Delay the dialog in case the user interacted
			// with the page before it transitioned away
			await timeout(3000);

			// This should normally not happen, but if for some reason
			// the workbench was shutdown while the page is still there,
			// inform the user that only a reload can bring back a working
			// state.
			const res = await this.dialogService.show(
				Severity.Error,
				localize('shutdownError', "An unexpected error occurred that requires a reload of this page."),
				[
					localize('reload', "Reload")
				],
				{
					detail: localize('shutdownErrorDetail', "The workbench was unexpectedly disposed while running.")
				}
			);

			if (res.choice === 0) {
				this.hostService.reload();
			}
		});
	}

	private create(): void {

		// Driver
		if (this.environmentService.options?.developmentOptions?.enableSmokeTestDriver) {
			(async () => this._register(await registerWindowDriver()))();
		}

		// Handle open calls
		this.setupOpenHandlers();

		// Label formatting
		this.registerLabelFormatters();
	}

	private setupOpenHandlers(): void {

		// We need to ignore the `beforeunload` event while
		// we handle external links to open specifically for
		// the case of application protocols that e.g. invoke
		// vscode itself. We do not want to open these links
		// in a new window because that would leave a blank
		// window to the user, but using `window.location.href`
		// will trigger the `beforeunload`.
		this.openerService.setDefaultExternalOpener({
			openExternal: async (href: string) => {
				if (matchesScheme(href, Schemas.http) || matchesScheme(href, Schemas.https)) {
					const opened = windowOpenNoOpener(href);
					if (!opened) {
						const showResult = await this.dialogService.show(Severity.Warning, localize('unableToOpenExternal', "The browser interrupted the opening of a new tab or window. Press 'Open' to open it anyway."),
							[localize('open', "Open"), localize('learnMore', "Learn More"), localize('cancel', "Cancel")], { cancelId: 2, detail: href });
						if (showResult.choice === 0) {
							windowOpenNoOpener(href);
						}
						if (showResult.choice === 1) {
							await this.openerService.open(URI.parse('https://aka.ms/allow-vscode-popup'));
						}
					}
				} else {
					this.lifecycleService.withExpectedUnload(() => window.location.href = href);
				}

				return true;
			}
		});
	}

	private registerLabelFormatters() {
		this.labelService.registerFormatter({
			scheme: Schemas.userData,
			priority: true,
			formatting: {
				label: '(Settings) ${path}',
				separator: '/',
			}
		});
	}
}
