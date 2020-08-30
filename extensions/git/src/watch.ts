/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, EventEmitter, Uri } from 'vscode';
import { join } from 'path';
import * as fs from 'fs';
import { IDisposable } from './util';

export interface IFileWatcher extends IDisposable {
	readonly event: Event<Uri>;
}

export function watch(location: string): IFileWatcher {
	const dotGitWatcher = fs.watch(location);
	const onDotGitFileChangeEmitter = new EventEmitter<Uri>();
	dotGitWatcher.on('change', (_, e) => onDotGitFileChangeEmitter.fire(Uri.file(join(location, e as string))));
	dotGitWatcher.on('error', err => console.error(err));

	return new class implements IFileWatcher {
		event = onDotGitFileChangeEmitter.event;
		dispose() { dotGitWatcher.close(); }
	};
}
