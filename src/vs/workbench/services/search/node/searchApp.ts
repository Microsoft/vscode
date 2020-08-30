/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from 'vs/base/parts/ipc/node/ipc.cp';
import { SearchChannel } from './searchIpc';
import { SearchService } from './rawSearchService';

const server = new Server('search');
const service = new SearchService();
const channel = new SearchChannel(service);
server.registerChannel('search', channel);
