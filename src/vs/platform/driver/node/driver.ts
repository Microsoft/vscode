/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client } from 'vs/base/parts/ipc/common/ipc.net';
import { connect as connectNet } from 'vs/base/parts/ipc/node/ipc.net';
import { IChannel, IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { Event } from 'vs/base/common/event';
import { IDriver, IElement, IWindowDriverRegistry } from 'vs/platform/driver/common/driver';

export class DriverChannel implements IServerChannel {

	constructor(private driver: IDriver) { }

	listen<T>(_: unknown, event: string): Event<T> {
		throw new Error('No event found');
	}

	call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'getWindowIds': return this.driver.getWindowIds();
			case 'capturePage': return this.driver.capturePage(arg);
			case 'reloadWindow': return this.driver.reloadWindow(arg);
			case 'exitApplication': return this.driver.exitApplication();
			case 'dispatchKeybinding': return this.driver.dispatchKeybinding(arg[0], arg[1]);
			case 'click': return this.driver.click(arg[0], arg[1], arg[2], arg[3]);
			case 'doubleClick': return this.driver.doubleClick(arg[0], arg[1]);
			case 'setValue': return this.driver.setValue(arg[0], arg[1], arg[2]);
			case 'getTitle': return this.driver.getTitle(arg[0]);
			case 'isActiveElement': return this.driver.isActiveElement(arg[0], arg[1]);
			case 'getElements': return this.driver.getElements(arg[0], arg[1], arg[2]);
			case 'getElementXY': return this.driver.getElementXY(arg[0], arg[1], arg[2]);
			case 'typeInEditor': return this.driver.typeInEditor(arg[0], arg[1], arg[2]);
			case 'getTerminalBuffer': return this.driver.getTerminalBuffer(arg[0], arg[1]);
			case 'writeInTerminal': return this.driver.writeInTerminal(arg[0], arg[1], arg[2]);
		}

		throw new Error(`Call not found: ${command}`);
	}
}

export class DriverChannelClient implements IDriver {

	declare readonly _serviceBrand: undefined;

	constructor(private channel: IChannel) { }

	getWindowIds(): Promise<number[]> {
		return this.channel.call('getWindowIds');
	}

	capturePage(windowId: number): Promise<string> {
		return this.channel.call('capturePage', windowId);
	}

	reloadWindow(windowId: number): Promise<void> {
		return this.channel.call('reloadWindow', windowId);
	}

	exitApplication(): Promise<void> {
		return this.channel.call('exitApplication');
	}

	dispatchKeybinding(windowId: number, keybinding: string): Promise<void> {
		return this.channel.call('dispatchKeybinding', [windowId, keybinding]);
	}

	click(windowId: number, selector: string, xoffset: number | undefined, yoffset: number | undefined): Promise<void> {
		return this.channel.call('click', [windowId, selector, xoffset, yoffset]);
	}

	doubleClick(windowId: number, selector: string): Promise<void> {
		return this.channel.call('doubleClick', [windowId, selector]);
	}

	setValue(windowId: number, selector: string, text: string): Promise<void> {
		return this.channel.call('setValue', [windowId, selector, text]);
	}

	getTitle(windowId: number): Promise<string> {
		return this.channel.call('getTitle', [windowId]);
	}

	isActiveElement(windowId: number, selector: string): Promise<boolean> {
		return this.channel.call('isActiveElement', [windowId, selector]);
	}

	getElements(windowId: number, selector: string, recursive: boolean): Promise<IElement[]> {
		return this.channel.call('getElements', [windowId, selector, recursive]);
	}

	getElementXY(windowId: number, selector: string, xoffset: number | undefined, yoffset: number | undefined): Promise<{ x: number, y: number }> {
		return this.channel.call('getElementXY', [windowId, selector, xoffset, yoffset]);
	}

	typeInEditor(windowId: number, selector: string, text: string): Promise<void> {
		return this.channel.call('typeInEditor', [windowId, selector, text]);
	}

	getTerminalBuffer(windowId: number, selector: string): Promise<string[]> {
		return this.channel.call('getTerminalBuffer', [windowId, selector]);
	}

	writeInTerminal(windowId: number, selector: string, text: string): Promise<void> {
		return this.channel.call('writeInTerminal', [windowId, selector, text]);
	}
}

export class WindowDriverRegistryChannel implements IServerChannel {

	constructor(private registry: IWindowDriverRegistry) { }

	listen<T>(_: unknown, event: string): Event<T> {
		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'registerWindowDriver': return this.registry.registerWindowDriver(arg);
			case 'reloadWindowDriver': return this.registry.reloadWindowDriver(arg);
		}

		throw new Error(`Call not found: ${command}`);
	}
}

export async function connect(handle: string): Promise<{ client: Client, driver: IDriver }> {
	const client = await connectNet(handle, 'driverClient');
	const channel = client.getChannel('driver');
	const driver = new DriverChannelClient(channel);
	return { client, driver };
}
