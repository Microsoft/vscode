/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import { Disposable, StatusBarAlignment, StatusBarItem, Uri, window, workspace } from 'vscode';
import { ChangeStoreEvent, IChangeStore } from './changeStore';
import { GitHubApiContext } from './github/api';
import { isSha } from './extension';
import { ContextStore, WorkspaceFolderContext } from './contextStore';

export class StatusBar implements Disposable {
	private readonly disposable: Disposable;

	private readonly items = new Map<string, StatusBarItem>();

	constructor(
		private readonly contextStore: ContextStore<GitHubApiContext>,
		private readonly changeStore: IChangeStore
	) {
		this.disposable = Disposable.from(
			contextStore.onDidChange(this.onContextsChanged, this),
			changeStore.onDidChange(this.onChanged, this)
		);

		for (const context of this.contextStore.getForWorkspace()) {
			this.createOrUpdateStatusBarItem(context);
		}
	}

	dispose() {
		this.disposable?.dispose();
		this.items.forEach(i => i.dispose());
	}

	private createOrUpdateStatusBarItem(wc: WorkspaceFolderContext<GitHubApiContext>) {
		let item = this.items.get(wc.folderUri.toString());
		if (item === undefined) {
			item = window.createStatusBarItem({
				id: `githubBrowser.branch:${wc.folderUri.toString()}`,
				name: `GitHub Browser: ${wc.name}`,
				alignment: StatusBarAlignment.Left,
				priority: 1000
			});
		}

		if (isSha(wc.context.branch)) {
			item.text = `$(git-commit) ${wc.context.branch.substr(0, 8)}`;
			item.tooltip = `${wc.name} \u2022 ${wc.context.branch.substr(0, 8)}`;
		} else {
			item.text = `$(git-branch) ${wc.context.branch}`;
			item.tooltip = `${wc.name} \u2022 ${wc.context.branch}${wc.context.sha ? ` @ ${wc.context.sha?.substr(0, 8)}` : ''}`;
		}

		const hasChanges = this.changeStore.hasChanges(wc.folderUri);
		if (hasChanges) {
			item.text += '*';
		}

		item.show();

		this.items.set(wc.folderUri.toString(), item);
	}

	private onContextsChanged(uri: Uri) {
		const folder = workspace.getWorkspaceFolder(this.contextStore.getWorkspaceResource(uri));
		if (folder === undefined) {
			return;
		}

		const context = this.contextStore.get(uri);
		if (context === undefined) {
			return;
		}

		this.createOrUpdateStatusBarItem({
			context: context,
			name: folder.name,
			folderUri: folder.uri,
		});
	}

	private onChanged(e: ChangeStoreEvent) {
		const item = this.items.get(e.rootUri.toString());
		if (item !== undefined) {
			const hasChanges = this.changeStore.hasChanges(e.rootUri);
			if (hasChanges) {
				if (!item.text.endsWith('*')) {
					item.text += '*';
				}
			} else {
				if (item.text.endsWith('*')) {
					item.text = item.text.substr(0, item.text.length - 1);
				}
			}
		}
	}
}
