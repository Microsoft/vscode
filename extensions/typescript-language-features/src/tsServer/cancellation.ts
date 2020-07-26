/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Tracer from '../utils/tracer';

export interface OngoingRequestCanceller {
	readonly cancellationPipeName: string | undefined;
	tryCancelOngoingRequest(seq: number): boolean;
}

export interface OngoingRequestCancellerFactory {
	create(serverId: string, tracer: Tracer): OngoingRequestCanceller;
}

const noopRequestCanceller = new class implements OngoingRequestCanceller {
	public readonly cancellationPipeName = undefined;

	public tryCancelOngoingRequest(_seq: number): boolean {
		return false;
	}
};

export const noopRequestCancellerFactory = new class implements OngoingRequestCancellerFactory {
	create(_serverId: string, _tracer: Tracer): OngoingRequestCanceller {
		return noopRequestCanceller;
	}
};
