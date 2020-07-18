/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import { Event, EventEmitter, Memento, Uri, workspace } from 'vscode';

export interface WorkspaceFolderContext<T> {
	context: T;
	name: string;
	folderUri: Uri;
}

export class ContextStore<T> {
	private _onDidChange = new EventEmitter<Uri>();
	get onDidChange(): Event<Uri> {
		return this._onDidChange.event;
	}

	constructor(
		private readonly scheme: string,
		private readonly originalScheme: string,
		private readonly memento: Memento,
	) { }

	delete(uri: Uri) {
		return this.set(uri, undefined);
	}

	get(uri: Uri): T | undefined {
		return this.memento.get<T>(`${this.originalScheme}.context|${this.getOriginalResource(uri).toString()}`);
	}

	getForWorkspace(): WorkspaceFolderContext<T>[] {
		const folders = workspace.workspaceFolders?.filter(f => f.uri.scheme === this.scheme || f.uri.scheme === this.originalScheme) ?? [];
		return folders.map(f => ({ context: this.get(f.uri)!, name: f.name, folderUri: f.uri })).filter(c => c.context !== undefined);
	}

	async set(uri: Uri, context: T | undefined) {
		uri = this.getOriginalResource(uri);
		await this.memento.update(`${this.originalScheme}.context|${uri.toString()}`, context);
		this._onDidChange.fire(uri);
	}

	getOriginalResource(uri: Uri): Uri {
		return uri.with({ scheme: this.originalScheme });
	}

	getWorkspaceResource(uri: Uri): Uri {
		return uri.with({ scheme: this.scheme });
	}
}
