/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalInstance, ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';

export class UrlFinder extends Disposable {
	private static readonly terminalCodesRegex = /(?:\u001B|\u009B)[\[\]()#;?]*(?:(?:(?:[a-zA-Z0-9]*(?:;[a-zA-Z0-9]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-PR-TZcf-ntqry=><~]))/g;
	/**
	 * Local server url pattern matching following urls:
	 * http://localhost:3000/ - commonly used across multiple frameworks
	 * https://127.0.0.1:5001/ - ASP.NET
	 * http://:8080 - Beego Golang
	 * http://0.0.0.0:4000 - Elixir Phoenix
	 */
	private static readonly localUrlRegex = /\b\w{2,20}:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|:\d{2,5})[\w\-\.\~:\/\?\#[\]\@!\$&\(\)\*\+\,\;\=]*/gim;

	private _onDidMatchLocalUrl: Emitter<{ host: string, port: number }> = new Emitter();
	public readonly onDidMatchLocalUrl = this._onDidMatchLocalUrl.event;
	private listeners: Map<ITerminalInstance, IDisposable> = new Map();

	constructor(terminalService: ITerminalService) {
		super();
		terminalService.terminalInstances.forEach(instance => {
			this.listeners.set(instance, instance.onData(data => {
				this.processData(data);
			}));
		});
		this._register(terminalService.onInstanceCreated(instance => {
			this.listeners.set(instance, instance.onData(data => {
				this.processData(data);
			}));
		}));
		this._register(terminalService.onInstanceDisposed(instance => {
			this.listeners.delete(instance);
		}));
	}

	dispose() {
		super.dispose();
		const listeners = this.listeners.values();
		for (const listener of listeners) {
			listener.dispose();
		}
	}

	private processData(data: string) {
		// strip ANSI terminal codes
		data = data.replace(UrlFinder.terminalCodesRegex, '');
		const urlMatches = data.match(UrlFinder.localUrlRegex) || [];
		urlMatches.forEach((match) => {
			// check if valid url
			const serverUrl = new URL(match);
			if (serverUrl) {
				// check if the port is a valid integer value
				const port = parseFloat(serverUrl.port!);
				if (!isNaN(port) && Number.isInteger(port) && port > 0 && port <= 65535) {
					// normalize the host name
					let host = serverUrl.hostname;
					if (host !== '0.0.0.0' && host !== '127.0.0.1') {
						host = 'localhost';
					}
					this._onDidMatchLocalUrl.fire({ port, host });
				}
			}
		});
	}
}
