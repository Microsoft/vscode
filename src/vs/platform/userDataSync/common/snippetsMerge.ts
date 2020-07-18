/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from 'vs/base/common/collections';

export interface IMergeResult {
	local: {
		added: IStringDictionary<string>;
		updated: IStringDictionary<string>;
		removed: string[];
	};
	remote: {
		added: IStringDictionary<string>;
		updated: IStringDictionary<string>;
		removed: string[];
	};
	conflicts: string[];
}

export function merge(local: IStringDictionary<string>, remote: IStringDictionary<string> | null, base: IStringDictionary<string> | null): IMergeResult {
	const localAdded: IStringDictionary<string> = {};
	const localUpdated: IStringDictionary<string> = {};
	const localRemoved: Set<string> = new Set<string>();

	if (!remote) {
		return {
			local: { added: localAdded, updated: localUpdated, removed: [...localRemoved.values()] },
			remote: { added: local, updated: {}, removed: [] },
			conflicts: []
		};
	}

	const localToRemote = compare(local, remote);
	if (localToRemote.added.size === 0 && localToRemote.removed.size === 0 && localToRemote.updated.size === 0) {
		// No changes found between local and remote.
		return {
			local: { added: localAdded, updated: localUpdated, removed: [...localRemoved.values()] },
			remote: { added: {}, updated: {}, removed: [] },
			conflicts: []
		};
	}

	const baseToLocal = compare(base, local);
	const baseToRemote = compare(base, remote);

	const remoteAdded: IStringDictionary<string> = {};
	const remoteUpdated: IStringDictionary<string> = {};
	const remoteRemoved: Set<string> = new Set<string>();

	const conflicts: Set<string> = new Set<string>();

	// Removed snippets in Local
	for (const key of baseToLocal.removed.values()) {
		// Conflict - Got updated in remote.
		if (baseToRemote.updated.has(key)) {
			// Add to local
			localAdded[key] = remote[key];
		}
		// Remove it in remote
		else {
			remoteRemoved.add(key);
		}
	}

	// Removed snippets in Remote
	for (const key of baseToRemote.removed.values()) {
		if (conflicts.has(key)) {
			continue;
		}
		// Conflict - Got updated in local
		if (baseToLocal.updated.has(key)) {
			conflicts.add(key);
		}
		// Also remove in Local
		else {
			localRemoved.add(key);
		}
	}

	// Updated snippets in Local
	for (const key of baseToLocal.updated.values()) {
		if (conflicts.has(key)) {
			continue;
		}
		// Got updated in remote
		if (baseToRemote.updated.has(key)) {
			// Has different value
			if (localToRemote.updated.has(key)) {
				conflicts.add(key);
			}
		} else {
			remoteUpdated[key] = local[key];
		}
	}

	// Updated snippets in Remote
	for (const key of baseToRemote.updated.values()) {
		if (conflicts.has(key)) {
			continue;
		}
		// Got updated in local
		if (baseToLocal.updated.has(key)) {
			// Has different value
			if (localToRemote.updated.has(key)) {
				conflicts.add(key);
			}
		} else if (local[key] !== undefined) {
			localUpdated[key] = remote[key];
		}
	}

	// Added snippets in Local
	for (const key of baseToLocal.added.values()) {
		if (conflicts.has(key)) {
			continue;
		}
		// Got added in remote
		if (baseToRemote.added.has(key)) {
			// Has different value
			if (localToRemote.updated.has(key)) {
				conflicts.add(key);
			}
		} else {
			remoteAdded[key] = local[key];
		}
	}

	// Added snippets in remote
	for (const key of baseToRemote.added.values()) {
		if (conflicts.has(key)) {
			continue;
		}
		// Got added in local
		if (baseToLocal.added.has(key)) {
			// Has different value
			if (localToRemote.updated.has(key)) {
				conflicts.add(key);
			}
		} else {
			localAdded[key] = remote[key];
		}
	}

	return {
		local: { added: localAdded, removed: [...localRemoved.values()], updated: localUpdated },
		remote: { added: remoteAdded, removed: [...remoteRemoved.values()], updated: remoteUpdated },
		conflicts: [...conflicts.values()],
	};
}

function compare(from: IStringDictionary<string> | null, to: IStringDictionary<string> | null): { added: Set<string>, removed: Set<string>, updated: Set<string> } {
	const fromKeys = from ? Object.keys(from) : [];
	const toKeys = to ? Object.keys(to) : [];
	const added = toKeys.filter(key => fromKeys.indexOf(key) === -1).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const removed = fromKeys.filter(key => toKeys.indexOf(key) === -1).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const updated: Set<string> = new Set<string>();

	for (const key of fromKeys) {
		if (removed.has(key)) {
			continue;
		}
		const fromSnippet = from![key]!;
		const toSnippet = to![key]!;
		if (fromSnippet !== toSnippet) {
			updated.add(key);
		}
	}

	return { added, removed, updated };
}

export function areSame(a: IStringDictionary<string>, b: IStringDictionary<string>): boolean {
	const { added, removed, updated } = compare(a, b);
	return added.size === 0 && removed.size === 0 && updated.size === 0;
}
