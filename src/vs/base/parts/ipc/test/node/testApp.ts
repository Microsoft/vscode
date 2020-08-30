/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Server } from 'vs/base/parts/ipc/node/ipc.cp';
import { TestChannel, TestService } from './testService';

const server = new Server('test');
const service = new TestService();
server.registerChannel('test', new TestChannel(service));
