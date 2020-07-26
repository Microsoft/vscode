/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyIdentifier, IRPCProtocol } from 'vs/workbench/services/extensions/common/proxyIdentifier';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IExtHostRpcService = createDecorator<IExtHostRpcService>('IExtHostRpcService');

export interface IExtHostRpcService extends IRPCProtocol {
	readonly _serviceBrand: undefined;
}

export class ExtHostRpcService implements IExtHostRpcService {
	readonly _serviceBrand: undefined;

	readonly getProxy: <T>(identifier: ProxyIdentifier<T>) => T;
	readonly set: <T, R extends T> (identifier: ProxyIdentifier<T>, instance: R) => R;
	readonly assertRegistered: (identifiers: ProxyIdentifier<any>[]) => void;
	readonly drain: () => Promise<void>;

	constructor(rpcProtocol: IRPCProtocol) {
		this.getProxy = rpcProtocol.getProxy.bind(rpcProtocol);
		this.set = rpcProtocol.set.bind(rpcProtocol);
		this.assertRegistered = rpcProtocol.assertRegistered.bind(rpcProtocol);
		this.drain = rpcProtocol.drain.bind(rpcProtocol);
	}
}
