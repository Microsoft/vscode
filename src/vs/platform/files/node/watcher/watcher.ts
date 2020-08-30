/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI as uri } from 'vs/base/common/uri';
import { FileChangeType, isParent, IFileChange } from 'vs/platform/files/common/files';
import { isLinux } from 'vs/base/common/platform';

export interface IDiskFileChange {
	type: FileChangeType;
	path: string;
}

export interface ILogMessage {
	type: 'trace' | 'warn' | 'error';
	message: string;
}

export function toFileChanges(changes: IDiskFileChange[]): IFileChange[] {
	return changes.map(change => ({
		type: change.type,
		resource: uri.file(change.path)
	}));
}

export function normalizeFileChanges(changes: IDiskFileChange[]): IDiskFileChange[] {

	// Build deltas
	const normalizer = new EventNormalizer();
	for (const event of changes) {
		normalizer.processEvent(event);
	}

	return normalizer.normalize();
}

class EventNormalizer {
	private normalized: IDiskFileChange[] = [];
	private mapPathToChange: Map<string, IDiskFileChange> = new Map();

	processEvent(event: IDiskFileChange): void {
		const existingEvent = this.mapPathToChange.get(event.path);

		// Event path already exists
		if (existingEvent) {
			const currentChangeType = existingEvent.type;
			const newChangeType = event.type;

			// ignore CREATE followed by DELETE in one go
			if (currentChangeType === FileChangeType.ADDED && newChangeType === FileChangeType.DELETED) {
				this.mapPathToChange.delete(event.path);
				this.normalized.splice(this.normalized.indexOf(existingEvent), 1);
			}

			// flatten DELETE followed by CREATE into CHANGE
			else if (currentChangeType === FileChangeType.DELETED && newChangeType === FileChangeType.ADDED) {
				existingEvent.type = FileChangeType.UPDATED;
			}

			// Do nothing. Keep the created event
			else if (currentChangeType === FileChangeType.ADDED && newChangeType === FileChangeType.UPDATED) { }

			// Otherwise apply change type
			else {
				existingEvent.type = newChangeType;
			}
		}

		// Otherwise store new
		else {
			this.normalized.push(event);
			this.mapPathToChange.set(event.path, event);
		}
	}

	normalize(): IDiskFileChange[] {
		const addedChangeEvents: IDiskFileChange[] = [];
		const deletedPaths: string[] = [];

		// This algorithm will remove all DELETE events up to the root folder
		// that got deleted if any. This ensures that we are not producing
		// DELETE events for each file inside a folder that gets deleted.
		//
		// 1.) split ADD/CHANGE and DELETED events
		// 2.) sort short deleted paths to the top
		// 3.) for each DELETE, check if there is a deleted parent and ignore the event in that case
		return this.normalized.filter(e => {
			if (e.type !== FileChangeType.DELETED) {
				addedChangeEvents.push(e);

				return false; // remove ADD / CHANGE
			}

			return true; // keep DELETE
		}).sort((e1, e2) => {
			return e1.path.length - e2.path.length; // shortest path first
		}).filter(e => {
			if (deletedPaths.some(d => isParent(e.path, d, !isLinux /* ignorecase */))) {
				return false; // DELETE is ignored if parent is deleted already
			}

			// otherwise mark as deleted
			deletedPaths.push(e.path);

			return true;
		}).concat(addedChangeEvents);
	}
}
