/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from 'vs/base/parts/ipc/node/ipc.cp';
import { WatcherChannel } from 'vs/platform/files/node/watcher/unix/watcherIpc';
import { ChokidarWatcherService } from 'vs/platform/files/node/watcher/unix/chokidarWatcherService';

const server = new Server('watcher');
const service = new ChokidarWatcherService();
const channel = new WatcherChannel(service);
server.registerChannel('watcher', channel);
