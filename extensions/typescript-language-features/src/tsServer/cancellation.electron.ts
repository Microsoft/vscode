/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { getTempFile } from '../utils/temp.electron';
import Tracer from '../utils/tracer';
import { OngoingRequestCanceller, OngoingRequestCancellerFactory } from './cancellation';

export class NodeRequestCanceller implements OngoingRequestCanceller {
	public readonly cancellationPipeName: string;

	public constructor(
		private readonly _serverId: string,
		private readonly _tracer: Tracer,
	) {
		this.cancellationPipeName = getTempFile('tscancellation');
	}

	public tryCancelOngoingRequest(seq: number): boolean {
		if (!this.cancellationPipeName) {
			return false;
		}
		this._tracer.logTrace(this._serverId, `TypeScript Server: trying to cancel ongoing request with sequence number ${seq}`);
		try {
			fs.writeFileSync(this.cancellationPipeName + seq, '');
		} catch {
			// noop
		}
		return true;
	}
}


export const nodeRequestCancellerFactory = new class implements OngoingRequestCancellerFactory {
	create(serverId: string, tracer: Tracer): OngoingRequestCanceller {
		return new NodeRequestCanceller(serverId, tracer);
	}
};
