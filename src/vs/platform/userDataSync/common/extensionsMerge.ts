/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISyncExtension } from 'vs/platform/userDataSync/common/userDataSync';
import { IExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { deepClone } from 'vs/base/common/objects';
import { ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { distinct } from 'vs/base/common/arrays';

export interface IMergeResult {
	added: ISyncExtension[];
	removed: IExtensionIdentifier[];
	updated: ISyncExtension[];
	remote: ISyncExtension[] | null;
}

export function merge(localExtensions: ISyncExtension[], remoteExtensions: ISyncExtension[] | null, lastSyncExtensions: ISyncExtension[] | null, skippedExtensions: ISyncExtension[], ignoredExtensions: string[]): IMergeResult {
	const added: ISyncExtension[] = [];
	const removed: IExtensionIdentifier[] = [];
	const updated: ISyncExtension[] = [];

	if (!remoteExtensions) {
		const remote = localExtensions.filter(({ identifier }) => ignoredExtensions.every(id => id.toLowerCase() !== identifier.id.toLowerCase()));
		return {
			added,
			removed,
			updated,
			remote: remote.length > 0 ? remote : null
		};
	}

	localExtensions = localExtensions.map(massageIncomingExtension);
	remoteExtensions = remoteExtensions.map(massageIncomingExtension);
	lastSyncExtensions = lastSyncExtensions ? lastSyncExtensions.map(massageIncomingExtension) : null;

	const uuids: Map<string, string> = new Map<string, string>();
	const addUUID = (identifier: IExtensionIdentifier) => { if (identifier.uuid) { uuids.set(identifier.id.toLowerCase(), identifier.uuid); } };
	localExtensions.forEach(({ identifier }) => addUUID(identifier));
	remoteExtensions.forEach(({ identifier }) => addUUID(identifier));
	if (lastSyncExtensions) {
		lastSyncExtensions.forEach(({ identifier }) => addUUID(identifier));
	}

	const getKey = (extension: ISyncExtension): string => {
		const uuid = extension.identifier.uuid || uuids.get(extension.identifier.id.toLowerCase());
		return uuid ? `uuid:${uuid}` : `id:${extension.identifier.id.toLowerCase()}`;
	};
	const addExtensionToMap = (map: Map<string, ISyncExtension>, extension: ISyncExtension) => {
		map.set(getKey(extension), extension);
		return map;
	};
	const localExtensionsMap = localExtensions.reduce(addExtensionToMap, new Map<string, ISyncExtension>());
	const remoteExtensionsMap = remoteExtensions.reduce(addExtensionToMap, new Map<string, ISyncExtension>());
	const newRemoteExtensionsMap = remoteExtensions.reduce((map: Map<string, ISyncExtension>, extension: ISyncExtension) => {
		const key = getKey(extension);
		extension = deepClone(extension);
		if (localExtensionsMap.get(key)?.installed) {
			extension.installed = true;
		}
		return addExtensionToMap(map, extension);
	}, new Map<string, ISyncExtension>());
	const lastSyncExtensionsMap = lastSyncExtensions ? lastSyncExtensions.reduce(addExtensionToMap, new Map<string, ISyncExtension>()) : null;
	const skippedExtensionsMap = skippedExtensions.reduce(addExtensionToMap, new Map<string, ISyncExtension>());
	const ignoredExtensionsSet = ignoredExtensions.reduce((set, id) => {
		const uuid = uuids.get(id.toLowerCase());
		return set.add(uuid ? `uuid:${uuid}` : `id:${id.toLowerCase()}`);
	}, new Set<string>());

	const localToRemote = compare(localExtensionsMap, remoteExtensionsMap, ignoredExtensionsSet);
	if (localToRemote.added.size > 0 || localToRemote.removed.size > 0 || localToRemote.updated.size > 0) {

		const baseToLocal = compare(lastSyncExtensionsMap, localExtensionsMap, ignoredExtensionsSet);
		const baseToRemote = compare(lastSyncExtensionsMap, remoteExtensionsMap, ignoredExtensionsSet);

		// Remotely removed extension.
		for (const key of baseToRemote.removed.values()) {
			const e = localExtensionsMap.get(key);
			if (e) {
				removed.push(e.identifier);
			}
		}

		// Remotely added extension
		for (const key of baseToRemote.added.values()) {
			// Got added in local
			if (baseToLocal.added.has(key)) {
				// Is different from local to remote
				if (localToRemote.updated.has(key)) {
					updated.push(massageOutgoingExtension(remoteExtensionsMap.get(key)!, key));
				}
			} else {
				// Add only installed extension to local
				const remoteExtension = remoteExtensionsMap.get(key)!;
				if (remoteExtension.installed) {
					added.push(massageOutgoingExtension(remoteExtension, key));
				}
			}
		}

		// Remotely updated extensions
		for (const key of baseToRemote.updated.values()) {
			// Update in local always
			updated.push(massageOutgoingExtension(remoteExtensionsMap.get(key)!, key));
		}

		// Locally added extensions
		for (const key of baseToLocal.added.values()) {
			// Not there in remote
			if (!baseToRemote.added.has(key)) {
				newRemoteExtensionsMap.set(key, localExtensionsMap.get(key)!);
			}
		}

		// Locally updated extensions
		for (const key of baseToLocal.updated.values()) {
			// If removed in remote
			if (baseToRemote.removed.has(key)) {
				continue;
			}

			// If not updated in remote
			if (!baseToRemote.updated.has(key)) {
				const extension = deepClone(localExtensionsMap.get(key)!);
				// Retain installed property
				if (newRemoteExtensionsMap.get(key)?.installed) {
					extension.installed = true;
				}
				newRemoteExtensionsMap.set(key, extension);
			}
		}

		// Locally removed extensions
		for (const key of baseToLocal.removed.values()) {
			// If not skipped and not updated in remote
			if (!skippedExtensionsMap.has(key) && !baseToRemote.updated.has(key)) {
				// Remove only if it is an installed extension
				if (lastSyncExtensionsMap?.get(key)?.installed) {
					newRemoteExtensionsMap.delete(key);
				}
			}
		}
	}

	const remote: ISyncExtension[] = [];
	const remoteChanges = compare(remoteExtensionsMap, newRemoteExtensionsMap, new Set<string>(), { checkInstalledProperty: true });
	if (remoteChanges.added.size > 0 || remoteChanges.updated.size > 0 || remoteChanges.removed.size > 0) {
		newRemoteExtensionsMap.forEach((value, key) => remote.push(massageOutgoingExtension(value, key)));
	}

	return { added, removed, updated, remote: remote.length ? remote : null };
}

function compare(from: Map<string, ISyncExtension> | null, to: Map<string, ISyncExtension>, ignoredExtensions: Set<string>, { checkInstalledProperty }: { checkInstalledProperty: boolean } = { checkInstalledProperty: false }): { added: Set<string>, removed: Set<string>, updated: Set<string> } {
	const fromKeys = from ? [...from.keys()].filter(key => !ignoredExtensions.has(key)) : [];
	const toKeys = [...to.keys()].filter(key => !ignoredExtensions.has(key));
	const added = toKeys.filter(key => fromKeys.indexOf(key) === -1).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const removed = fromKeys.filter(key => toKeys.indexOf(key) === -1).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const updated: Set<string> = new Set<string>();

	for (const key of fromKeys) {
		if (removed.has(key)) {
			continue;
		}
		const fromExtension = from!.get(key)!;
		const toExtension = to.get(key);
		if (!toExtension
			|| fromExtension.disabled !== toExtension.disabled
			|| fromExtension.version !== toExtension.version
			|| (checkInstalledProperty && fromExtension.installed !== toExtension.installed)
		) {
			updated.add(key);
		}
	}

	return { added, removed, updated };
}

// massage incoming extension - add optional properties
function massageIncomingExtension(extension: ISyncExtension): ISyncExtension {
	return { ...extension, ...{ disabled: !!extension.disabled, installed: !!extension.installed } };
}

// massage outgoing extension - remove optional properties
function massageOutgoingExtension(extension: ISyncExtension, key: string): ISyncExtension {
	const massagedExtension: ISyncExtension = {
		identifier: {
			id: extension.identifier.id,
			uuid: key.startsWith('uuid:') ? key.substring('uuid:'.length) : undefined
		},
	};
	if (extension.disabled) {
		massagedExtension.disabled = true;
	}
	if (extension.installed) {
		massagedExtension.installed = true;
	}
	if (extension.version) {
		massagedExtension.version = extension.version;
	}
	return massagedExtension;
}

export function getIgnoredExtensions(installed: ILocalExtension[], configurationService: IConfigurationService): string[] {
	const defaultIgnoredExtensions = installed.filter(i => i.isMachineScoped).map(i => i.identifier.id.toLowerCase());
	const value = (configurationService.getValue<string[]>('sync.ignoredExtensions') || []).map(id => id.toLowerCase());
	const added: string[] = [], removed: string[] = [];
	if (Array.isArray(value)) {
		for (const key of value) {
			if (key.startsWith('-')) {
				removed.push(key.substring(1));
			} else {
				added.push(key);
			}
		}
	}
	return distinct([...defaultIgnoredExtensions, ...added,].filter(setting => removed.indexOf(setting) === -1));
}
