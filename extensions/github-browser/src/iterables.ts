/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

export namespace Iterables {
	export function* filterMap<T, TMapped>(
		source: Iterable<T> | IterableIterator<T>,
		predicateMapper: (item: T) => TMapped | undefined | null,
	): Iterable<TMapped> {
		for (const item of source) {
			const mapped = predicateMapper(item);
			if (mapped !== undefined && mapped !== null) {
				yield mapped;
			}
		}
	}

	export function* map<T, TMapped>(
		source: Iterable<T> | IterableIterator<T>,
		mapper: (item: T) => TMapped,
	): Iterable<TMapped> {
		for (const item of source) {
			yield mapper(item);
		}
	}
}
