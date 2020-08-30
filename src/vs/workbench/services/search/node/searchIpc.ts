/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IChannel, IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { IRawFileQuery, IRawTextQuery, IRawSearchService, ISerializedSearchComplete, ISerializedSearchProgressItem } from 'vs/workbench/services/search/common/search';

export class SearchChannel implements IServerChannel {

	constructor(private service: IRawSearchService) { }

	listen(_: unknown, event: string, arg?: any): Event<any> {
		switch (event) {
			case 'fileSearch': return this.service.fileSearch(arg);
			case 'textSearch': return this.service.textSearch(arg);
		}
		throw new Error('Event not found');
	}

	call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'clearCache': return this.service.clearCache(arg);
		}
		throw new Error('Call not found');
	}
}

export class SearchChannelClient implements IRawSearchService {

	constructor(private channel: IChannel) { }

	fileSearch(search: IRawFileQuery): Event<ISerializedSearchProgressItem | ISerializedSearchComplete> {
		return this.channel.listen('fileSearch', search);
	}

	textSearch(search: IRawTextQuery): Event<ISerializedSearchProgressItem | ISerializedSearchComplete> {
		return this.channel.listen('textSearch', search);
	}

	clearCache(cacheKey: string): Promise<void> {
		return this.channel.call('clearCache', cacheKey);
	}
}
