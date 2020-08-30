/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { BaseWindowDriver } from 'vs/platform/driver/browser/baseDriver';

class BrowserWindowDriver extends BaseWindowDriver {
	click(selector: string, xoffset?: number | undefined, yoffset?: number | undefined): Promise<void> {
		throw new Error('Method not implemented.');
	}
	doubleClick(selector: string): Promise<void> {
		throw new Error('Method not implemented.');
	}
	openDevTools(): Promise<void> {
		throw new Error('Method not implemented.');
	}
}

export async function registerWindowDriver(): Promise<IDisposable> {
	(<any>window).driver = new BrowserWindowDriver();

	return Disposable.None;
}
