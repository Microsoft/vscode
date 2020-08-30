/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as processes from 'vs/base/node/processes';

const sender = processes.createQueuedSender(<any>process);

process.on('message', msg => {
	sender.send(msg);
});

sender.send('ready');
