/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from 'vs/base/parts/ipc/node/ipc.cp';
import { WatcherChannel } from 'vs/platform/files/node/watcher/nsfw/watcherIpc';
import { NsfwWatcherService } from 'vs/platform/files/node/watcher/nsfw/nsfwWatcherService';

const server = new Server('watcher');
const service = new NsfwWatcherService();
const channel = new WatcherChannel(service);
server.registerChannel('watcher', channel);
