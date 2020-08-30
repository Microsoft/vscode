/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyncDescriptor } from './descriptors';
import { ServiceIdentifier, BrandedService } from './instantiation';

const _registry: [ServiceIdentifier<any>, SyncDescriptor<any>][] = [];

export function registerSingleton<T, Services extends BrandedService[]>(id: ServiceIdentifier<T>, ctor: new (...services: Services) => T, supportsDelayedInstantiation?: boolean): void {
	_registry.push([id, new SyncDescriptor<T>(ctor as new (...args: any[]) => T, [], supportsDelayedInstantiation)]);
}

export function getSingletonServiceDescriptors(): [ServiceIdentifier<any>, SyncDescriptor<any>][] {
	return _registry;
}
