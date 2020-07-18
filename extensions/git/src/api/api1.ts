/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Model } from '../model';
import { Repository as BaseRepository, Resource } from '../repository';
import { InputBox, Git, API, Repository, Remote, RepositoryState, Branch, Ref, Submodule, Commit, Change, RepositoryUIState, Status, LogOptions, APIState, CommitOptions, RefType, RemoteSourceProvider, CredentialsProvider, BranchQuery, PushErrorHandler } from './git';
import { Event, SourceControlInputBox, Uri, SourceControl, Disposable, commands } from 'vscode';
import { mapEvent } from '../util';
import { toGitUri } from '../uri';
import { pickRemoteSource, PickRemoteSourceOptions } from '../remoteSource';
import { GitExtensionImpl } from './extension';

class ApiInputBox implements InputBox {
	set value(value: string) { this._inputBox.value = value; }
	get value(): string { return this._inputBox.value; }
	constructor(private _inputBox: SourceControlInputBox) { }
}

export class ApiChange implements Change {

	get uri(): Uri { return this.resource.resourceUri; }
	get originalUri(): Uri { return this.resource.original; }
	get renameUri(): Uri | undefined { return this.resource.renameResourceUri; }
	get status(): Status { return this.resource.type; }

	constructor(private readonly resource: Resource) { }
}

export class ApiRepositoryState implements RepositoryState {

	get HEAD(): Branch | undefined { return this._repository.HEAD; }
	get refs(): Ref[] { return [...this._repository.refs]; }
	get remotes(): Remote[] { return [...this._repository.remotes]; }
	get submodules(): Submodule[] { return [...this._repository.submodules]; }
	get rebaseCommit(): Commit | undefined { return this._repository.rebaseCommit; }

	get mergeChanges(): Change[] { return this._repository.mergeGroup.resourceStates.map(r => new ApiChange(r)); }
	get indexChanges(): Change[] { return this._repository.indexGroup.resourceStates.map(r => new ApiChange(r)); }
	get workingTreeChanges(): Change[] { return this._repository.workingTreeGroup.resourceStates.map(r => new ApiChange(r)); }

	readonly onDidChange: Event<void> = this._repository.onDidRunGitStatus;

	constructor(private _repository: BaseRepository) { }
}

export class ApiRepositoryUIState implements RepositoryUIState {

	get selected(): boolean { return this._sourceControl.selected; }

	readonly onDidChange: Event<void> = mapEvent<boolean, void>(this._sourceControl.onDidChangeSelection, () => null);

	constructor(private _sourceControl: SourceControl) { }
}

export class ApiRepository implements Repository {

	readonly rootUri: Uri = Uri.file(this._repository.root);
	readonly inputBox: InputBox = new ApiInputBox(this._repository.inputBox);
	readonly state: RepositoryState = new ApiRepositoryState(this._repository);
	readonly ui: RepositoryUIState = new ApiRepositoryUIState(this._repository.sourceControl);

	constructor(private _repository: BaseRepository) { }

	apply(patch: string, reverse?: boolean): Promise<void> {
		return this._repository.apply(patch, reverse);
	}

	getConfigs(): Promise<{ key: string; value: string; }[]> {
		return this._repository.getConfigs();
	}

	getConfig(key: string): Promise<string> {
		return this._repository.getConfig(key);
	}

	setConfig(key: string, value: string): Promise<string> {
		return this._repository.setConfig(key, value);
	}

	getGlobalConfig(key: string): Promise<string> {
		return this._repository.getGlobalConfig(key);
	}

	getObjectDetails(treeish: string, path: string): Promise<{ mode: string; object: string; size: number; }> {
		return this._repository.getObjectDetails(treeish, path);
	}

	detectObjectType(object: string): Promise<{ mimetype: string, encoding?: string }> {
		return this._repository.detectObjectType(object);
	}

	buffer(ref: string, filePath: string): Promise<Buffer> {
		return this._repository.buffer(ref, filePath);
	}

	show(ref: string, path: string): Promise<string> {
		return this._repository.show(ref, path);
	}

	getCommit(ref: string): Promise<Commit> {
		return this._repository.getCommit(ref);
	}

	clean(paths: string[]) {
		return this._repository.clean(paths.map(p => Uri.file(p)));
	}

	diff(cached?: boolean) {
		return this._repository.diff(cached);
	}

	diffWithHEAD(): Promise<Change[]>;
	diffWithHEAD(path: string): Promise<string>;
	diffWithHEAD(path?: string): Promise<string | Change[]> {
		return this._repository.diffWithHEAD(path);
	}

	diffWith(ref: string): Promise<Change[]>;
	diffWith(ref: string, path: string): Promise<string>;
	diffWith(ref: string, path?: string): Promise<string | Change[]> {
		return this._repository.diffWith(ref, path);
	}

	diffIndexWithHEAD(): Promise<Change[]>;
	diffIndexWithHEAD(path: string): Promise<string>;
	diffIndexWithHEAD(path?: string): Promise<string | Change[]> {
		return this._repository.diffIndexWithHEAD(path);
	}

	diffIndexWith(ref: string): Promise<Change[]>;
	diffIndexWith(ref: string, path: string): Promise<string>;
	diffIndexWith(ref: string, path?: string): Promise<string | Change[]> {
		return this._repository.diffIndexWith(ref, path);
	}

	diffBlobs(object1: string, object2: string): Promise<string> {
		return this._repository.diffBlobs(object1, object2);
	}

	diffBetween(ref1: string, ref2: string): Promise<Change[]>;
	diffBetween(ref1: string, ref2: string, path: string): Promise<string>;
	diffBetween(ref1: string, ref2: string, path?: string): Promise<string | Change[]> {
		return this._repository.diffBetween(ref1, ref2, path);
	}

	hashObject(data: string): Promise<string> {
		return this._repository.hashObject(data);
	}

	createBranch(name: string, checkout: boolean, ref?: string | undefined): Promise<void> {
		return this._repository.branch(name, checkout, ref);
	}

	deleteBranch(name: string, force?: boolean): Promise<void> {
		return this._repository.deleteBranch(name, force);
	}

	getBranch(name: string): Promise<Branch> {
		return this._repository.getBranch(name);
	}

	getBranches(query: BranchQuery): Promise<Ref[]> {
		return this._repository.getBranches(query);
	}

	setBranchUpstream(name: string, upstream: string): Promise<void> {
		return this._repository.setBranchUpstream(name, upstream);
	}

	getMergeBase(ref1: string, ref2: string): Promise<string> {
		return this._repository.getMergeBase(ref1, ref2);
	}

	status(): Promise<void> {
		return this._repository.status();
	}

	checkout(treeish: string): Promise<void> {
		return this._repository.checkout(treeish);
	}

	addRemote(name: string, url: string): Promise<void> {
		return this._repository.addRemote(name, url);
	}

	removeRemote(name: string): Promise<void> {
		return this._repository.removeRemote(name);
	}

	renameRemote(name: string, newName: string): Promise<void> {
		return this._repository.renameRemote(name, newName);
	}

	fetch(remote?: string | undefined, ref?: string | undefined, depth?: number | undefined): Promise<void> {
		return this._repository.fetch(remote, ref, depth);
	}

	pull(unshallow?: boolean): Promise<void> {
		return this._repository.pull(undefined, unshallow);
	}

	push(remoteName?: string, branchName?: string, setUpstream: boolean = false): Promise<void> {
		return this._repository.pushTo(remoteName, branchName, setUpstream);
	}

	blame(path: string): Promise<string> {
		return this._repository.blame(path);
	}

	log(options?: LogOptions): Promise<Commit[]> {
		return this._repository.log(options);
	}

	commit(message: string, opts?: CommitOptions): Promise<void> {
		return this._repository.commit(message, opts);
	}
}

export class ApiGit implements Git {

	get path(): string { return this._model.git.path; }

	constructor(private _model: Model) { }
}

export class ApiImpl implements API {

	readonly git = new ApiGit(this._model);

	get state(): APIState {
		return this._model.state;
	}

	get onDidChangeState(): Event<APIState> {
		return this._model.onDidChangeState;
	}

	get onDidOpenRepository(): Event<Repository> {
		return mapEvent(this._model.onDidOpenRepository, r => new ApiRepository(r));
	}

	get onDidCloseRepository(): Event<Repository> {
		return mapEvent(this._model.onDidCloseRepository, r => new ApiRepository(r));
	}

	get repositories(): Repository[] {
		return this._model.repositories.map(r => new ApiRepository(r));
	}

	toGitUri(uri: Uri, ref: string): Uri {
		return toGitUri(uri, ref);
	}

	getRepository(uri: Uri): Repository | null {
		const result = this._model.getRepository(uri);
		return result ? new ApiRepository(result) : null;
	}

	async init(root: Uri): Promise<Repository | null> {
		const path = root.fsPath;
		await this._model.git.init(path);
		await this._model.openRepository(path);
		return this.getRepository(root) || null;
	}

	registerRemoteSourceProvider(provider: RemoteSourceProvider): Disposable {
		return this._model.registerRemoteSourceProvider(provider);
	}

	registerCredentialsProvider(provider: CredentialsProvider): Disposable {
		return this._model.registerCredentialsProvider(provider);
	}

	registerPushErrorHandler(handler: PushErrorHandler): Disposable {
		return this._model.registerPushErrorHandler(handler);
	}

	constructor(private _model: Model) { }
}

function getRefType(type: RefType): string {
	switch (type) {
		case RefType.Head: return 'Head';
		case RefType.RemoteHead: return 'RemoteHead';
		case RefType.Tag: return 'Tag';
	}

	return 'unknown';
}

function getStatus(status: Status): string {
	switch (status) {
		case Status.INDEX_MODIFIED: return 'INDEX_MODIFIED';
		case Status.INDEX_ADDED: return 'INDEX_ADDED';
		case Status.INDEX_DELETED: return 'INDEX_DELETED';
		case Status.INDEX_RENAMED: return 'INDEX_RENAMED';
		case Status.INDEX_COPIED: return 'INDEX_COPIED';
		case Status.MODIFIED: return 'MODIFIED';
		case Status.DELETED: return 'DELETED';
		case Status.UNTRACKED: return 'UNTRACKED';
		case Status.IGNORED: return 'IGNORED';
		case Status.INTENT_TO_ADD: return 'INTENT_TO_ADD';
		case Status.ADDED_BY_US: return 'ADDED_BY_US';
		case Status.ADDED_BY_THEM: return 'ADDED_BY_THEM';
		case Status.DELETED_BY_US: return 'DELETED_BY_US';
		case Status.DELETED_BY_THEM: return 'DELETED_BY_THEM';
		case Status.BOTH_ADDED: return 'BOTH_ADDED';
		case Status.BOTH_DELETED: return 'BOTH_DELETED';
		case Status.BOTH_MODIFIED: return 'BOTH_MODIFIED';
	}

	return 'UNKNOWN';
}

export function registerAPICommands(extension: GitExtensionImpl): Disposable {
	const disposables: Disposable[] = [];

	disposables.push(commands.registerCommand('git.api.getRepositories', () => {
		const api = extension.getAPI(1);
		return api.repositories.map(r => r.rootUri.toString());
	}));

	disposables.push(commands.registerCommand('git.api.getRepositoryState', (uri: string) => {
		const api = extension.getAPI(1);
		const repository = api.getRepository(Uri.parse(uri));

		if (!repository) {
			return null;
		}

		const state = repository.state;

		const ref = (ref: Ref | undefined) => (ref && { ...ref, type: getRefType(ref.type) });
		const change = (change: Change) => ({
			uri: change.uri.toString(),
			originalUri: change.originalUri.toString(),
			renameUri: change.renameUri?.toString(),
			status: getStatus(change.status)
		});

		return {
			HEAD: ref(state.HEAD),
			refs: state.refs.map(ref),
			remotes: state.remotes,
			submodules: state.submodules,
			rebaseCommit: state.rebaseCommit,
			mergeChanges: state.mergeChanges.map(change),
			indexChanges: state.indexChanges.map(change),
			workingTreeChanges: state.workingTreeChanges.map(change)
		};
	}));

	disposables.push(commands.registerCommand('git.api.getRemoteSources', (opts?: PickRemoteSourceOptions) => {
		if (!extension.model) {
			return;
		}

		return pickRemoteSource(extension.model, opts);
	}));

	return Disposable.from(...disposables);
}
