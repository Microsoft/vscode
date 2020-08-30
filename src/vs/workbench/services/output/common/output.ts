/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Registry } from 'vs/platform/registry/common/platform';
import { URI } from 'vs/base/common/uri';

export const Extensions = {
	OutputChannels: 'workbench.contributions.outputChannels'
};

export interface IOutputChannelDescriptor {
	id: string;
	label: string;
	log: boolean;
	file?: URI;
}

export interface IFileOutputChannelDescriptor extends IOutputChannelDescriptor {
	file: URI;
}

export interface IOutputChannelRegistry {

	readonly onDidRegisterChannel: Event<string>;
	readonly onDidRemoveChannel: Event<string>;

	/**
	 * Make an output channel known to the output world.
	 */
	registerChannel(descriptor: IOutputChannelDescriptor): void;

	/**
	 * Returns the list of channels known to the output world.
	 */
	getChannels(): IOutputChannelDescriptor[];

	/**
	 * Returns the channel with the passed id.
	 */
	getChannel(id: string): IOutputChannelDescriptor | undefined;

	/**
	 * Remove the output channel with the passed id.
	 */
	removeChannel(id: string): void;
}

class OutputChannelRegistry implements IOutputChannelRegistry {
	private channels = new Map<string, IOutputChannelDescriptor>();

	private readonly _onDidRegisterChannel = new Emitter<string>();
	readonly onDidRegisterChannel: Event<string> = this._onDidRegisterChannel.event;

	private readonly _onDidRemoveChannel = new Emitter<string>();
	readonly onDidRemoveChannel: Event<string> = this._onDidRemoveChannel.event;

	public registerChannel(descriptor: IOutputChannelDescriptor): void {
		if (!this.channels.has(descriptor.id)) {
			this.channels.set(descriptor.id, descriptor);
			this._onDidRegisterChannel.fire(descriptor.id);
		}
	}

	public getChannels(): IOutputChannelDescriptor[] {
		const result: IOutputChannelDescriptor[] = [];
		this.channels.forEach(value => result.push(value));
		return result;
	}

	public getChannel(id: string): IOutputChannelDescriptor | undefined {
		return this.channels.get(id);
	}

	public removeChannel(id: string): void {
		this.channels.delete(id);
		this._onDidRemoveChannel.fire(id);
	}
}

Registry.add(Extensions.OutputChannels, new OutputChannelRegistry());
