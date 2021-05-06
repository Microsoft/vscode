/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IChannel, IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { IDriverOptions, IElement, IWindowDriver, IWindowDriverRegistry } from 'vs/platform/driver/common/driver';

export class WindowDriverChannel implements IServerChannel {

	constructor(private driver: IWindowDriver) { }

	listen<T>(_: unknown, event: string): Event<T> {
		throw new Error(`No event found: ${event}`);
	}

	call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'click': return this.driver.click(arg[0], arg[1], arg[2]);
			case 'doubleClick': return this.driver.doubleClick(arg);
			case 'setValue': return this.driver.setValue(arg[0], arg[1]);
			case 'getTitle': return this.driver.getTitle();
			case 'isActiveElement': return this.driver.isActiveElement(arg);
			case 'getElements': return this.driver.getElements(arg[0], arg[1]);
			case 'getElementXY': return this.driver.getElementXY(arg[0], arg[1], arg[2]);
			case 'typeInEditor': return this.driver.typeInEditor(arg[0], arg[1]);
			case 'getTerminalBuffer': return this.driver.getTerminalBuffer(arg);
			case 'writeInTerminal': return this.driver.writeInTerminal(arg[0], arg[1]);
		}

		throw new Error(`Call not found: ${command}`);
	}
}

export class WindowDriverChannelClient implements IWindowDriver {

	declare readonly _serviceBrand: undefined;

	constructor(private channel: IChannel) { }

	click(selector: string, xoffset?: number, yoffset?: number): Promise<void> {
		return this.channel.call('click', [selector, xoffset, yoffset]);
	}

	doubleClick(selector: string): Promise<void> {
		return this.channel.call('doubleClick', selector);
	}

	setValue(selector: string, text: string): Promise<void> {
		return this.channel.call('setValue', [selector, text]);
	}

	getTitle(): Promise<string> {
		return this.channel.call('getTitle');
	}

	isActiveElement(selector: string): Promise<boolean> {
		return this.channel.call('isActiveElement', selector);
	}

	getElements(selector: string, recursive: boolean): Promise<IElement[]> {
		return this.channel.call('getElements', [selector, recursive]);
	}

	getElementXY(selector: string, xoffset?: number, yoffset?: number): Promise<{ x: number, y: number }> {
		return this.channel.call('getElementXY', [selector, xoffset, yoffset]);
	}

	typeInEditor(selector: string, text: string): Promise<void> {
		return this.channel.call('typeInEditor', [selector, text]);
	}

	getTerminalBuffer(selector: string): Promise<string[]> {
		return this.channel.call('getTerminalBuffer', selector);
	}

	writeInTerminal(selector: string, text: string): Promise<void> {
		return this.channel.call('writeInTerminal', [selector, text]);
	}
}

export class WindowDriverRegistryChannelClient implements IWindowDriverRegistry {

	declare readonly _serviceBrand: undefined;

	constructor(private channel: IChannel) { }

	registerWindowDriver(windowId: number): Promise<IDriverOptions> {
		return this.channel.call('registerWindowDriver', windowId);
	}

	reloadWindowDriver(windowId: number): Promise<void> {
		return this.channel.call('reloadWindowDriver', windowId);
	}
}
