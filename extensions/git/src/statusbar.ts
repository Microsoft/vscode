/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, Command, EventEmitter, Event, workspace, Uri } from 'vscode';
import { Repository, Operation } from './repository';
import { anyEvent, dispose, filterEvent } from './util';
import * as nls from 'vscode-nls';
import { Branch, RemoteSourceProvider } from './api/git';
import { IRemoteSourceProviderRegistry } from './remoteProvider';

const localize = nls.loadMessageBundle();

class CheckoutStatusBar {

	private _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> { return this._onDidChange.event; }
	private disposables: Disposable[] = [];

	constructor(private repository: Repository) {
		repository.onDidRunGitStatus(this._onDidChange.fire, this._onDidChange, this.disposables);
	}

	get command(): Command | undefined {
		const rebasing = !!this.repository.rebaseCommit;
		const title = `$(git-branch) ${this.repository.headLabel}${rebasing ? ` (${localize('rebasing', 'Rebasing')})` : ''}`;

		return {
			command: 'git.checkout',
			tooltip: `${this.repository.headLabel}`,
			title,
			arguments: [this.repository.sourceControl]
		};
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}

interface SyncStatusBarState {
	readonly enabled: boolean;
	readonly isSyncRunning: boolean;
	readonly hasRemotes: boolean;
	readonly HEAD: Branch | undefined;
	readonly remoteSourceProviders: RemoteSourceProvider[];
}

class SyncStatusBar {

	private _onDidChange = new EventEmitter<void>();
	get onDidChange(): Event<void> { return this._onDidChange.event; }
	private disposables: Disposable[] = [];

	private _state: SyncStatusBarState;
	private get state() { return this._state; }
	private set state(state: SyncStatusBarState) {
		this._state = state;
		this._onDidChange.fire();
	}

	constructor(private repository: Repository, private remoteSourceProviderRegistry: IRemoteSourceProviderRegistry) {
		repository.onDidRunGitStatus(this.onDidRunGitStatus, this, this.disposables);
		repository.onDidChangeOperations(this.onDidChangeOperations, this, this.disposables);

		anyEvent(remoteSourceProviderRegistry.onDidAddRemoteSourceProvider, remoteSourceProviderRegistry.onDidRemoveRemoteSourceProvider)
			(this.onDidChangeRemoteSourceProviders, this, this.disposables);

		const onEnablementChange = filterEvent(workspace.onDidChangeConfiguration, e => e.affectsConfiguration('git.enableStatusBarSync'));
		onEnablementChange(this.updateEnablement, this, this.disposables);
		this.updateEnablement();

		this._state = {
			enabled: true,
			isSyncRunning: false,
			hasRemotes: false,
			HEAD: undefined,
			remoteSourceProviders: this.remoteSourceProviderRegistry.getRemoteProviders()
				.filter(p => !!p.publishRepository)
		};
	}

	private updateEnablement(): void {
		const config = workspace.getConfiguration('git', Uri.file(this.repository.root));
		const enabled = config.get<boolean>('enableStatusBarSync', true);

		this.state = { ... this.state, enabled };
	}

	private onDidChangeOperations(): void {
		const isSyncRunning = this.repository.operations.isRunning(Operation.Sync) ||
			this.repository.operations.isRunning(Operation.Push) ||
			this.repository.operations.isRunning(Operation.Pull);

		this.state = { ...this.state, isSyncRunning };
	}

	private onDidRunGitStatus(): void {
		this.state = {
			...this.state,
			hasRemotes: this.repository.remotes.length > 0,
			HEAD: this.repository.HEAD
		};
	}

	private onDidChangeRemoteSourceProviders(): void {
		this.state = {
			...this.state,
			remoteSourceProviders: this.remoteSourceProviderRegistry.getRemoteProviders()
				.filter(p => !!p.publishRepository)
		};
	}

	get command(): Command | undefined {
		if (!this.state.enabled) {
			return;
		}

		if (!this.state.hasRemotes) {
			if (this.state.remoteSourceProviders.length === 0) {
				return;
			}

			const tooltip = this.state.remoteSourceProviders.length === 1
				? localize('publish to', "Publish to {0}", this.state.remoteSourceProviders[0].name)
				: localize('publish to...', "Publish to...");

			return {
				command: 'git.publish',
				title: `$(cloud-upload)`,
				tooltip,
				arguments: [this.repository.sourceControl]
			};
		}

		const HEAD = this.state.HEAD;
		let icon = '$(sync)';
		let text = '';
		let command = '';
		let tooltip = '';

		if (HEAD && HEAD.name && HEAD.commit) {
			if (HEAD.upstream) {
				if (HEAD.ahead || HEAD.behind) {
					text += this.repository.syncLabel;
				}

				const config = workspace.getConfiguration('git', Uri.file(this.repository.root));
				const rebaseWhenSync = config.get<string>('rebaseWhenSync');

				command = rebaseWhenSync ? 'git.syncRebase' : 'git.sync';
				tooltip = localize('sync changes', "Synchronize Changes");
			} else {
				icon = '$(cloud-upload)';
				command = 'git.publish';
				tooltip = localize('publish changes', "Publish Changes");
			}
		} else {
			command = '';
			tooltip = '';
		}

		if (this.state.isSyncRunning) {
			icon = '$(sync~spin)';
			command = '';
			tooltip = localize('syncing changes', "Synchronizing Changes...");
		}

		return {
			command,
			title: [icon, text].join(' ').trim(),
			tooltip,
			arguments: [this.repository.sourceControl]
		};
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}

export class StatusBarCommands {

	readonly onDidChange: Event<void>;

	private syncStatusBar: SyncStatusBar;
	private checkoutStatusBar: CheckoutStatusBar;
	private disposables: Disposable[] = [];

	constructor(repository: Repository, remoteSourceProviderRegistry: IRemoteSourceProviderRegistry) {
		this.syncStatusBar = new SyncStatusBar(repository, remoteSourceProviderRegistry);
		this.checkoutStatusBar = new CheckoutStatusBar(repository);
		this.onDidChange = anyEvent(this.syncStatusBar.onDidChange, this.checkoutStatusBar.onDidChange);
	}

	get commands(): Command[] {
		return [this.checkoutStatusBar.command, this.syncStatusBar.command]
			.filter((c): c is Command => !!c);
	}

	dispose(): void {
		this.syncStatusBar.dispose();
		this.checkoutStatusBar.dispose();
		this.disposables = dispose(this.disposables);
	}
}
