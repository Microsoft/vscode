/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as path from 'path';
import { Command, commands, Disposable, LineChange, MessageOptions, OutputChannel, Position, ProgressLocation, QuickPickItem, Range, SourceControlResourceState, TextDocumentShowOptions, TextEditor, Uri, ViewColumn, window, workspace, WorkspaceEdit, WorkspaceFolder, TimelineItem, env, Selection, TextDocumentContentProvider } from 'vscode';
import TelemetryReporter from 'vscode-extension-telemetry';
import * as nls from 'vscode-nls';
import { Branch, ForcePushMode, GitErrorCodes, Ref, RefType, Status, CommitOptions, RemoteSourceProvider } from './api/git';
import { Git, Stash } from './git';
import { Model } from './model';
import { Repository, Resource, ResourceGroupType } from './repository';
import { applyLineChanges, getModifiedRange, intersectDiffWithRange, invertLineChange, toLineRanges } from './staging';
import { fromGitUri, toGitUri, isGitUri } from './uri';
import { grep, isDescendant, pathEquals } from './util';
import { Log, LogLevel } from './log';
import { GitTimelineItem } from './timelineProvider';
import { ApiRepository } from './api/api1';
import { pickRemoteSource } from './remoteSource';

const localize = nls.loadMessageBundle();

class CheckoutItem implements QuickPickItem {

	protected get shortCommit(): string { return (this.ref.commit || '').substr(0, 8); }
	get label(): string { return this.ref.name || this.shortCommit; }
	get description(): string { return this.shortCommit; }

	constructor(protected ref: Ref) { }

	async run(repository: Repository, opts?: { detached?: boolean }): Promise<void> {
		const ref = this.ref.name;

		if (!ref) {
			return;
		}

		await repository.checkout(ref, opts);
	}
}

class CheckoutTagItem extends CheckoutItem {

	override get description(): string {
		return localize('tag at', "Tag at {0}", this.shortCommit);
	}
}

class CheckoutRemoteHeadItem extends CheckoutItem {

	override get description(): string {
		return localize('remote branch at', "Remote branch at {0}", this.shortCommit);
	}

	override async run(repository: Repository, opts?: { detached?: boolean }): Promise<void> {
		if (!this.ref.name) {
			return;
		}

		const branches = await repository.findTrackingBranches(this.ref.name);

		if (branches.length > 0) {
			await repository.checkout(branches[0].name!, opts);
		} else {
			await repository.checkoutTracking(this.ref.name, opts);
		}
	}
}

class BranchDeleteItem implements QuickPickItem {

	private get shortCommit(): string { return (this.ref.commit || '').substr(0, 8); }
	get branchName(): string | undefined { return this.ref.name; }
	get label(): string { return this.branchName || ''; }
	get description(): string { return this.shortCommit; }

	constructor(private ref: Ref) { }

	async run(repository: Repository, force?: boolean): Promise<void> {
		if (!this.branchName) {
			return;
		}
		await repository.deleteBranch(this.branchName, force);
	}
}

class MergeItem implements QuickPickItem {

	get label(): string { return this.ref.name || ''; }
	get description(): string { return this.ref.name || ''; }

	constructor(protected ref: Ref) { }

	async run(repository: Repository): Promise<void> {
		await repository.merge(this.ref.name! || this.ref.commit!);
	}
}

class RebaseItem implements QuickPickItem {

	get label(): string { return this.ref.name || ''; }
	description: string = '';

	constructor(readonly ref: Ref) { }

	async run(repository: Repository): Promise<void> {
		if (this.ref?.name) {
			await repository.rebase(this.ref.name);
		}
	}
}

class CreateBranchItem implements QuickPickItem {
	get label(): string { return '$(plus) ' + localize('create branch', 'Create new branch...'); }
	get description(): string { return ''; }
	get alwaysShow(): boolean { return true; }
}

class CreateBranchFromItem implements QuickPickItem {
	get label(): string { return '$(plus) ' + localize('create branch from', 'Create new branch from...'); }
	get description(): string { return ''; }
	get alwaysShow(): boolean { return true; }
}

class CheckoutDetachedItem implements QuickPickItem {
	get label(): string { return '$(debug-disconnect) ' + localize('checkout detached', 'Checkout detached...'); }
	get description(): string { return ''; }
	get alwaysShow(): boolean { return true; }
}

class HEADItem implements QuickPickItem {

	constructor(private repository: Repository) { }

	get label(): string { return 'HEAD'; }
	get description(): string { return (this.repository.HEAD && this.repository.HEAD.commit || '').substr(0, 8); }
	get alwaysShow(): boolean { return true; }
}

class AddRemoteItem implements QuickPickItem {

	constructor(private cc: CommandCenter) { }

	get label(): string { return '$(plus) ' + localize('add remote', 'Add a new remote...'); }
	get description(): string { return ''; }

	get alwaysShow(): boolean { return true; }

	async run(repository: Repository): Promise<void> {
		await this.cc.addRemote(repository);
	}
}

interface ScmCommandOptions {
	repository?: boolean;
	diff?: boolean;
}

interface ScmCommand {
	commandId: string;
	key: string;
	method: Function;
	options: ScmCommandOptions;
}

const Commands: ScmCommand[] = [];

function command(commandId: string, options: ScmCommandOptions = {}): Function {
	return (_target: any, key: string, descriptor: any) => {
		if (!(typeof descriptor.value === 'function')) {
			throw new Error('not supported');
		}

		Commands.push({ commandId, key, method: descriptor.value, options });
	};
}

// const ImageMimetypes = [
// 	'image/png',
// 	'image/gif',
// 	'image/jpeg',
// 	'image/webp',
// 	'image/tiff',
// 	'image/bmp'
// ];

async function categorizeResourceByResolution(resources: Resource[]): Promise<{ merge: Resource[], resolved: Resource[], unresolved: Resource[], deletionConflicts: Resource[] }> {
	const selection = resources.filter(s => s instanceof Resource) as Resource[];
	const merge = selection.filter(s => s.resourceGroupType === ResourceGroupType.Merge);
	const isBothAddedOrModified = (s: Resource) => s.type === Status.BOTH_MODIFIED || s.type === Status.BOTH_ADDED;
	const isAnyDeleted = (s: Resource) => s.type === Status.DELETED_BY_THEM || s.type === Status.DELETED_BY_US;
	const possibleUnresolved = merge.filter(isBothAddedOrModified);
	const promises = possibleUnresolved.map(s => grep(s.resourceUri.fsPath, /^<{7}|^={7}|^>{7}/));
	const unresolvedBothModified = await Promise.all<boolean>(promises);
	const resolved = possibleUnresolved.filter((_s, i) => !unresolvedBothModified[i]);
	const deletionConflicts = merge.filter(s => isAnyDeleted(s));
	const unresolved = [
		...merge.filter(s => !isBothAddedOrModified(s) && !isAnyDeleted(s)),
		...possibleUnresolved.filter((_s, i) => unresolvedBothModified[i])
	];

	return { merge, resolved, unresolved, deletionConflicts };
}

function createCheckoutItems(repository: Repository): CheckoutItem[] {
	const config = workspace.getConfiguration('git');
	const checkoutTypeConfig = config.get<string | string[]>('checkoutType');
	let checkoutTypes: string[];

	if (checkoutTypeConfig === 'all' || !checkoutTypeConfig || checkoutTypeConfig.length === 0) {
		checkoutTypes = ['local', 'remote', 'tags'];
	} else if (typeof checkoutTypeConfig === 'string') {
		checkoutTypes = [checkoutTypeConfig];
	} else {
		checkoutTypes = checkoutTypeConfig;
	}

	const processors = checkoutTypes.map(getCheckoutProcessor)
		.filter(p => !!p) as CheckoutProcessor[];

	for (const ref of repository.refs) {
		for (const processor of processors) {
			processor.onRef(ref);
		}
	}

	return processors.reduce<CheckoutItem[]>((r, p) => r.concat(...p.items), []);
}

class CheckoutProcessor {

	private refs: Ref[] = [];
	get items(): CheckoutItem[] { return this.refs.map(r => new this.ctor(r)); }
	constructor(private type: RefType, private ctor: { new(ref: Ref): CheckoutItem }) { }

	onRef(ref: Ref): void {
		if (ref.type === this.type) {
			this.refs.push(ref);
		}
	}
}

function getCheckoutProcessor(type: string): CheckoutProcessor | undefined {
	switch (type) {
		case 'local':
			return new CheckoutProcessor(RefType.Head, CheckoutItem);
		case 'remote':
			return new CheckoutProcessor(RefType.RemoteHead, CheckoutRemoteHeadItem);
		case 'tags':
			return new CheckoutProcessor(RefType.Tag, CheckoutTagItem);
	}

	return undefined;
}

function sanitizeRemoteName(name: string) {
	name = name.trim();
	return name && name.replace(/^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$|\[|\]$/g, '-');
}

class TagItem implements QuickPickItem {
	get label(): string { return this.ref.name ?? ''; }
	get description(): string { return this.ref.commit?.substr(0, 8) ?? ''; }
	constructor(readonly ref: Ref) { }
}

enum PushType {
	Push,
	PushTo,
	PushFollowTags,
	PushTags
}

interface PushOptions {
	pushType: PushType;
	forcePush?: boolean;
	silent?: boolean;

	pushTo?: {
		remote?: string;
		refspec?: string;
		setUpstream?: boolean;
	}
}

class CommandErrorOutputTextDocumentContentProvider implements TextDocumentContentProvider {

	private items = new Map<string, string>();

	set(uri: Uri, contents: string): void {
		this.items.set(uri.path, contents);
	}

	delete(uri: Uri): void {
		this.items.delete(uri.path);
	}

	provideTextDocumentContent(uri: Uri): string | undefined {
		return this.items.get(uri.path);
	}
}

export class CommandCenter {

	private disposables: Disposable[];
	private commandErrors = new CommandErrorOutputTextDocumentContentProvider();

	constructor(
		private git: Git,
		private model: Model,
		private outputChannel: OutputChannel,
		private telemetryReporter: TelemetryReporter
	) {
		this.disposables = Commands.map(({ commandId, key, method, options }) => {
			const command = this.createCommand(commandId, key, method, options);

			if (options.diff) {
				return commands.registerDiffInformationCommand(commandId, command);
			} else {
				return commands.registerCommand(commandId, command);
			}
		});

		this.disposables.push(workspace.registerTextDocumentContentProvider('git-output', this.commandErrors));
	}

	@command('git.setLogLevel')
	async setLogLevel(): Promise<void> {
		const createItem = (logLevel: LogLevel) => ({
			label: LogLevel[logLevel],
			logLevel,
			description: Log.logLevel === logLevel ? localize('current', "Current") : undefined
		});

		const items = [
			createItem(LogLevel.Trace),
			createItem(LogLevel.Debug),
			createItem(LogLevel.Info),
			createItem(LogLevel.Warning),
			createItem(LogLevel.Error),
			createItem(LogLevel.Critical),
			createItem(LogLevel.Off)
		];

		const choice = await window.showQuickPick(items, {
			placeHolder: localize('select log level', "Select log level")
		});

		if (!choice) {
			return;
		}

		Log.logLevel = choice.logLevel;
		this.outputChannel.appendLine(localize('changed', "Log level changed to: {0}", LogLevel[Log.logLevel]));
	}

	@command('git.refresh', { repository: true })
	async refresh(repository: Repository): Promise<void> {
		await repository.status();
	}

	@command('git.openResource')
	async openResource(resource: Resource): Promise<void> {
		const repository = this.model.getRepository(resource.resourceUri);

		if (!repository) {
			return;
		}

		await resource.open();
	}

	@command('git.openAllChanges', { repository: true })
	async openChanges(repository: Repository): Promise<void> {
		for (const resource of [...repository.workingTreeGroup.resourceStates, ...repository.untrackedGroup.resourceStates]) {
			if (
				resource.type === Status.DELETED || resource.type === Status.DELETED_BY_THEM ||
				resource.type === Status.DELETED_BY_US || resource.type === Status.BOTH_DELETED
			) {
				continue;
			}

			void commands.executeCommand(
				'vscode.open',
				resource.resourceUri,
				{ background: true, preview: false, }
			);
		}
	}

	async cloneRepository(url?: string, parentPath?: string, options: { recursive?: boolean } = {}): Promise<void> {
		if (!url || typeof url !== 'string') {
			url = await pickRemoteSource(this.model, {
				providerLabel: provider => localize('clonefrom', "Clone from {0}", provider.name),
				urlLabel: localize('repourl', "Clone from URL")
			});
		}

		if (!url) {
			/* __GDPR__
				"clone" : {
					"outcome" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryReporter.sendTelemetryEvent('clone', { outcome: 'no_URL' });
			return;
		}

		url = url.trim().replace(/^git\s+clone\s+/, '');

		if (!parentPath) {
			const config = workspace.getConfiguration('git');
			let defaultCloneDirectory = config.get<string>('defaultCloneDirectory') || os.homedir();
			defaultCloneDirectory = defaultCloneDirectory.replace(/^~/, os.homedir());

			const uris = await window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				defaultUri: Uri.file(defaultCloneDirectory),
				openLabel: localize('selectFolder', "Select Repository Location")
			});

			if (!uris || uris.length === 0) {
				/* __GDPR__
					"clone" : {
						"outcome" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
					}
				*/
				this.telemetryReporter.sendTelemetryEvent('clone', { outcome: 'no_directory' });
				return;
			}

			const uri = uris[0];
			parentPath = uri.fsPath;
		}

		try {
			const opts = {
				location: ProgressLocation.Notification,
				title: localize('cloning', "Cloning git repository '{0}'...", url),
				cancellable: true
			};

			const repositoryPath = await window.withProgress(
				opts,
				(progress, token) => this.git.clone(url!, { parentPath: parentPath!, progress, recursive: options.recursive }, token)
			);

			const config = workspace.getConfiguration('git');
			const openAfterClone = config.get<'always' | 'alwaysNewWindow' | 'whenNoFolderOpen' | 'prompt'>('openAfterClone');

			enum PostCloneAction { Open, OpenNewWindow, AddToWorkspace }
			let action: PostCloneAction | undefined = undefined;

			if (openAfterClone === 'always') {
				action = PostCloneAction.Open;
			} else if (openAfterClone === 'alwaysNewWindow') {
				action = PostCloneAction.OpenNewWindow;
			} else if (openAfterClone === 'whenNoFolderOpen' && !workspace.workspaceFolders) {
				action = PostCloneAction.Open;
			}

			if (action === undefined) {
				let message = localize('proposeopen', "Would you like to open the cloned repository?");
				const open = localize('openrepo', "Open");
				const openNewWindow = localize('openreponew', "Open in New Window");
				const choices = [open, openNewWindow];

				const addToWorkspace = localize('add', "Add to Workspace");
				if (workspace.workspaceFolders) {
					message = localize('proposeopen2', "Would you like to open the cloned repository, or add it to the current workspace?");
					choices.push(addToWorkspace);
				}

				const result = await window.showInformationMessage(message, ...choices);

				action = result === open ? PostCloneAction.Open
					: result === openNewWindow ? PostCloneAction.OpenNewWindow
						: result === addToWorkspace ? PostCloneAction.AddToWorkspace : undefined;
			}

			/* __GDPR__
				"clone" : {
					"outcome" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
					"openFolder": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
				}
			*/
			this.telemetryReporter.sendTelemetryEvent('clone', { outcome: 'success' }, { openFolder: action === PostCloneAction.Open || action === PostCloneAction.OpenNewWindow ? 1 : 0 });

			const uri = Uri.file(repositoryPath);

			if (action === PostCloneAction.Open) {
				commands.executeCommand('vscode.openFolder', uri, { forceReuseWindow: true });
			} else if (action === PostCloneAction.AddToWorkspace) {
				workspace.updateWorkspaceFolders(workspace.workspaceFolders!.length, 0, { uri });
			} else if (action === PostCloneAction.OpenNewWindow) {
				commands.executeCommand('vscode.openFolder', uri, { forceNewWindow: true });
			}
		} catch (err) {
			if (/already exists and is not an empty directory/.test(err && err.stderr || '')) {
				/* __GDPR__
					"clone" : {
						"outcome" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
					}
				*/
				this.telemetryReporter.sendTelemetryEvent('clone', { outcome: 'directory_not_empty' });
			} else if (/Cancelled/i.test(err && (err.message || err.stderr || ''))) {
				return;
			} else {
				/* __GDPR__
					"clone" : {
						"outcome" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
					}
				*/
				this.telemetryReporter.sendTelemetryEvent('clone', { outcome: 'error' });
			}

			throw err;
		}
	}

	@command('git.clone')
	async clone(url?: string, parentPath?: string): Promise<void> {
		await this.cloneRepository(url, parentPath);
	}

	@command('git.cloneRecursive')
	async cloneRecursive(url?: string, parentPath?: string): Promise<void> {
		await this.cloneRepository(url, parentPath, { recursive: true });
	}

	@command('git.init')
	async init(skipFolderPrompt = false): Promise<void> {
		let repositoryPath: string | undefined = undefined;
		let askToOpen = true;

		if (workspace.workspaceFolders) {
			if (skipFolderPrompt && workspace.workspaceFolders.length === 1) {
				repositoryPath = workspace.workspaceFolders[0].uri.fsPath;
				askToOpen = false;
			} else {
				const placeHolder = localize('init', "Pick workspace folder to initialize git repo in");
				const pick = { label: localize('choose', "Choose Folder...") };
				const items: { label: string, folder?: WorkspaceFolder }[] = [
					...workspace.workspaceFolders.map(folder => ({ label: folder.name, description: folder.uri.fsPath, folder })),
					pick
				];
				const item = await window.showQuickPick(items, { placeHolder, ignoreFocusOut: true });

				if (!item) {
					return;
				} else if (item.folder) {
					repositoryPath = item.folder.uri.fsPath;
					askToOpen = false;
				}
			}
		}

		if (!repositoryPath) {
			const homeUri = Uri.file(os.homedir());
			const defaultUri = workspace.workspaceFolders && workspace.workspaceFolders.length > 0
				? Uri.file(workspace.workspaceFolders[0].uri.fsPath)
				: homeUri;

			const result = await window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				defaultUri,
				openLabel: localize('init repo', "Initialize Repository")
			});

			if (!result || result.length === 0) {
				return;
			}

			const uri = result[0];

			if (homeUri.toString().startsWith(uri.toString())) {
				const yes = localize('create repo', "Initialize Repository");
				const answer = await window.showWarningMessage(localize('are you sure', "This will create a Git repository in '{0}'. Are you sure you want to continue?", uri.fsPath), yes);

				if (answer !== yes) {
					return;
				}
			}

			repositoryPath = uri.fsPath;

			if (workspace.workspaceFolders && workspace.workspaceFolders.some(w => w.uri.toString() === uri.toString())) {
				askToOpen = false;
			}
		}

		await this.git.init(repositoryPath);

		let message = localize('proposeopen init', "Would you like to open the initialized repository?");
		const open = localize('openrepo', "Open");
		const openNewWindow = localize('openreponew', "Open in New Window");
		const choices = [open, openNewWindow];

		if (!askToOpen) {
			return;
		}

		const addToWorkspace = localize('add', "Add to Workspace");
		if (workspace.workspaceFolders) {
			message = localize('proposeopen2 init', "Would you like to open the initialized repository, or add it to the current workspace?");
			choices.push(addToWorkspace);
		}

		const result = await window.showInformationMessage(message, ...choices);
		const uri = Uri.file(repositoryPath);

		if (result === open) {
			commands.executeCommand('vscode.openFolder', uri);
		} else if (result === addToWorkspace) {
			workspace.updateWorkspaceFolders(workspace.workspaceFolders!.length, 0, { uri });
		} else if (result === openNewWindow) {
			commands.executeCommand('vscode.openFolder', uri, true);
		} else {
			await this.model.openRepository(repositoryPath);
		}
	}

	@command('git.openRepository', { repository: false })
	async openRepository(path?: string): Promise<void> {
		if (!path) {
			const result = await window.showOpenDialog({
				canSelectFiles: false,
				canSelectFolders: true,
				canSelectMany: false,
				defaultUri: Uri.file(os.homedir()),
				openLabel: localize('open repo', "Open Repository")
			});

			if (!result || result.length === 0) {
				return;
			}

			path = result[0].fsPath;
		}

		await this.model.openRepository(path);
	}

	@command('git.close', { repository: true })
	async close(repository: Repository): Promise<void> {
		this.model.close(repository);
	}

	@command('git.openFile')
	async openFile(arg?: Resource | Uri, ...resourceStates: SourceControlResourceState[]): Promise<void> {
		const preserveFocus = arg instanceof Resource;

		let uris: Uri[] | undefined;

		if (arg instanceof Uri) {
			if (isGitUri(arg)) {
				uris = [Uri.file(fromGitUri(arg).path)];
			} else if (arg.scheme === 'file') {
				uris = [arg];
			}
		} else {
			let resource = arg;

			if (!(resource instanceof Resource)) {
				// can happen when called from a keybinding
				resource = this.getSCMResource();
			}

			if (resource) {
				uris = ([resource, ...resourceStates] as Resource[])
					.filter(r => r.type !== Status.DELETED && r.type !== Status.INDEX_DELETED)
					.map(r => r.resourceUri);
			} else if (window.activeTextEditor) {
				uris = [window.activeTextEditor.document.uri];
			}
		}

		if (!uris) {
			return;
		}

		const activeTextEditor = window.activeTextEditor;

		for (const uri of uris) {
			const opts: TextDocumentShowOptions = {
				preserveFocus,
				preview: false,
				viewColumn: ViewColumn.Active
			};

			let document;
			try {
				document = await workspace.openTextDocument(uri);
			} catch (error) {
				await commands.executeCommand('vscode.open', uri, {
					...opts,
					override: arg instanceof Resource && arg.type === Status.BOTH_MODIFIED ? false : undefined
				});
				continue;
			}

			// Check if active text editor has same path as other editor. we cannot compare via
			// URI.toString() here because the schemas can be different. Instead we just go by path.
			if (activeTextEditor && activeTextEditor.document.uri.path === uri.path) {
				// preserve not only selection but also visible range
				opts.selection = activeTextEditor.selection;
				const previousVisibleRanges = activeTextEditor.visibleRanges;
				const editor = await window.showTextDocument(document, opts);
				editor.revealRange(previousVisibleRanges[0]);
			} else {
				await commands.executeCommand('vscode.open', uri, opts);
			}
		}
	}

	@command('git.openFile2')
	async openFile2(arg?: Resource | Uri, ...resourceStates: SourceControlResourceState[]): Promise<void> {
		this.openFile(arg, ...resourceStates);
	}

	@command('git.openHEADFile')
	async openHEADFile(arg?: Resource | Uri): Promise<void> {
		let resource: Resource | undefined = undefined;
		const preview = !(arg instanceof Resource);

		if (arg instanceof Resource) {
			resource = arg;
		} else if (arg instanceof Uri) {
			resource = this.getSCMResource(arg);
		} else {
			resource = this.getSCMResource();
		}

		if (!resource) {
			return;
		}

		const HEAD = resource.leftUri;
		const basename = path.basename(resource.resourceUri.fsPath);
		const title = `${basename} (HEAD)`;

		if (!HEAD) {
			window.showWarningMessage(localize('HEAD not available', "HEAD version of '{0}' is not available.", path.basename(resource.resourceUri.fsPath)));
			return;
		}

		const opts: TextDocumentShowOptions = {
			preview
		};

		return await commands.executeCommand<void>('vscode.open', HEAD, opts, title);
	}

	@command('git.openChange')
	async openChange(arg?: Resource | Uri, ...resourceStates: SourceControlResourceState[]): Promise<void> {
		let resources: Resource[] | undefined = undefined;

		if (arg instanceof Uri) {
			const resource = this.getSCMResource(arg);
			if (resource !== undefined) {
				resources = [resource];
			}
		} else {
			let resource: Resource | undefined = undefined;

			if (arg instanceof Resource) {
				resource = arg;
			} else {
				resource = this.getSCMResource();
			}

			if (resource) {
				resources = [...resourceStates as Resource[], resource];
			}
		}

		if (!resources) {
			return;
		}

		for (const resource of resources) {
			await resource.openChange();
		}
	}

	@command('git.rename', { repository: true })
	async rename(repository: Repository, fromUri: Uri | undefined): Promise<void> {
		fromUri = fromUri ?? window.activeTextEditor?.document.uri;

		if (!fromUri) {
			return;
		}

		const from = path.relative(repository.root, fromUri.fsPath);
		let to = await window.showInputBox({
			value: from,
			valueSelection: [from.length - path.basename(from).length, from.length]
		});

		to = to?.trim();

		if (!to) {
			return;
		}

		await repository.move(from, to);
	}

	@command('git.stage')
	async stage(...resourceStates: SourceControlResourceState[]): Promise<void> {
		this.outputChannel.appendLine(`git.stage ${resourceStates.length}`);

		resourceStates = resourceStates.filter(s => !!s);

		if (resourceStates.length === 0 || (resourceStates[0] && !(resourceStates[0].resourceUri instanceof Uri))) {
			const resource = this.getSCMResource();

			this.outputChannel.appendLine(`git.stage.getSCMResource ${resource ? resource.resourceUri.toString() : null}`);

			if (!resource) {
				return;
			}

			resourceStates = [resource];
		}

		const selection = resourceStates.filter(s => s instanceof Resource) as Resource[];
		const { resolved, unresolved, deletionConflicts } = await categorizeResourceByResolution(selection);

		if (unresolved.length > 0) {
			const message = unresolved.length > 1
				? localize('confirm stage files with merge conflicts', "Are you sure you want to stage {0} files with merge conflicts?", unresolved.length)
				: localize('confirm stage file with merge conflicts', "Are you sure you want to stage {0} with merge conflicts?", path.basename(unresolved[0].resourceUri.fsPath));

			const yes = localize('yes', "Yes");
			const pick = await window.showWarningMessage(message, { modal: true }, yes);

			if (pick !== yes) {
				return;
			}
		}

		try {
			await this.runByRepository(deletionConflicts.map(r => r.resourceUri), async (repository, resources) => {
				for (const resource of resources) {
					await this._stageDeletionConflict(repository, resource);
				}
			});
		} catch (err) {
			if (/Cancelled/.test(err.message)) {
				return;
			}

			throw err;
		}

		const workingTree = selection.filter(s => s.resourceGroupType === ResourceGroupType.WorkingTree);
		const untracked = selection.filter(s => s.resourceGroupType === ResourceGroupType.Untracked);
		const scmResources = [...workingTree, ...untracked, ...resolved, ...unresolved];

		this.outputChannel.appendLine(`git.stage.scmResources ${scmResources.length}`);
		if (!scmResources.length) {
			return;
		}

		const resources = scmResources.map(r => r.resourceUri);
		await this.runByRepository(resources, async (repository, resources) => repository.add(resources));
	}

	@command('git.stageAll', { repository: true })
	async stageAll(repository: Repository): Promise<void> {
		const resources = [...repository.workingTreeGroup.resourceStates, ...repository.untrackedGroup.resourceStates];
		const uris = resources.map(r => r.resourceUri);

		if (uris.length > 0) {
			const config = workspace.getConfiguration('git', Uri.file(repository.root));
			const untrackedChanges = config.get<'mixed' | 'separate' | 'hidden'>('untrackedChanges');
			await repository.add(uris, untrackedChanges === 'mixed' ? undefined : { update: true });
		}
	}

	private async _stageDeletionConflict(repository: Repository, uri: Uri): Promise<void> {
		const uriString = uri.toString();
		const resource = repository.mergeGroup.resourceStates.filter(r => r.resourceUri.toString() === uriString)[0];

		if (!resource) {
			return;
		}

		if (resource.type === Status.DELETED_BY_THEM) {
			const keepIt = localize('keep ours', "Keep Our Version");
			const deleteIt = localize('delete', "Delete File");
			const result = await window.showInformationMessage(localize('deleted by them', "File '{0}' was deleted by them and modified by us.\n\nWhat would you like to do?", path.basename(uri.fsPath)), { modal: true }, keepIt, deleteIt);

			if (result === keepIt) {
				await repository.add([uri]);
			} else if (result === deleteIt) {
				await repository.rm([uri]);
			} else {
				throw new Error('Cancelled');
			}
		} else if (resource.type === Status.DELETED_BY_US) {
			const keepIt = localize('keep theirs', "Keep Their Version");
			const deleteIt = localize('delete', "Delete File");
			const result = await window.showInformationMessage(localize('deleted by us', "File '{0}' was deleted by us and modified by them.\n\nWhat would you like to do?", path.basename(uri.fsPath)), { modal: true }, keepIt, deleteIt);

			if (result === keepIt) {
				await repository.add([uri]);
			} else if (result === deleteIt) {
				await repository.rm([uri]);
			} else {
				throw new Error('Cancelled');
			}
		}
	}

	@command('git.stageAllTracked', { repository: true })
	async stageAllTracked(repository: Repository): Promise<void> {
		const resources = repository.workingTreeGroup.resourceStates
			.filter(r => r.type !== Status.UNTRACKED && r.type !== Status.IGNORED);
		const uris = resources.map(r => r.resourceUri);

		await repository.add(uris);
	}

	@command('git.stageAllUntracked', { repository: true })
	async stageAllUntracked(repository: Repository): Promise<void> {
		const resources = [...repository.workingTreeGroup.resourceStates, ...repository.untrackedGroup.resourceStates]
			.filter(r => r.type === Status.UNTRACKED || r.type === Status.IGNORED);
		const uris = resources.map(r => r.resourceUri);

		await repository.add(uris);
	}

	@command('git.stageAllMerge', { repository: true })
	async stageAllMerge(repository: Repository): Promise<void> {
		const resources = repository.mergeGroup.resourceStates.filter(s => s instanceof Resource) as Resource[];
		const { merge, unresolved, deletionConflicts } = await categorizeResourceByResolution(resources);

		try {
			for (const deletionConflict of deletionConflicts) {
				await this._stageDeletionConflict(repository, deletionConflict.resourceUri);
			}
		} catch (err) {
			if (/Cancelled/.test(err.message)) {
				return;
			}

			throw err;
		}

		if (unresolved.length > 0) {
			const message = unresolved.length > 1
				? localize('confirm stage files with merge conflicts', "Are you sure you want to stage {0} files with merge conflicts?", merge.length)
				: localize('confirm stage file with merge conflicts', "Are you sure you want to stage {0} with merge conflicts?", path.basename(merge[0].resourceUri.fsPath));

			const yes = localize('yes', "Yes");
			const pick = await window.showWarningMessage(message, { modal: true }, yes);

			if (pick !== yes) {
				return;
			}
		}

		const uris = resources.map(r => r.resourceUri);

		if (uris.length > 0) {
			await repository.add(uris);
		}
	}

	@command('git.stageChange')
	async stageChange(uri: Uri, changes: LineChange[], index: number): Promise<void> {
		if (!uri) {
			return;
		}

		const textEditor = window.visibleTextEditors.filter(e => e.document.uri.toString() === uri.toString())[0];

		if (!textEditor) {
			return;
		}

		await this._stageChanges(textEditor, [changes[index]]);

		const firstStagedLine = changes[index].modifiedStartLineNumber - 1;
		textEditor.selections = [new Selection(firstStagedLine, 0, firstStagedLine, 0)];
	}

	@command('git.stageSelectedRanges', { diff: true })
	async stageSelectedChanges(changes: LineChange[]): Promise<void> {
		const textEditor = window.activeTextEditor;

		if (!textEditor) {
			return;
		}

		const modifiedDocument = textEditor.document;
		const selectedLines = toLineRanges(textEditor.selections, modifiedDocument);
		const selectedChanges = changes
			.map(diff => selectedLines.reduce<LineChange | null>((result, range) => result || intersectDiffWithRange(modifiedDocument, diff, range), null))
			.filter(d => !!d) as LineChange[];

		if (!selectedChanges.length) {
			return;
		}

		await this._stageChanges(textEditor, selectedChanges);
	}

	private async _stageChanges(textEditor: TextEditor, changes: LineChange[]): Promise<void> {
		const modifiedDocument = textEditor.document;
		const modifiedUri = modifiedDocument.uri;

		if (modifiedUri.scheme !== 'file') {
			return;
		}

		const originalUri = toGitUri(modifiedUri, '~');
		const originalDocument = await workspace.openTextDocument(originalUri);
		const result = applyLineChanges(originalDocument, modifiedDocument, changes);

		await this.runByRepository(modifiedUri, async (repository, resource) => await repository.stage(resource, result));
	}

	@command('git.revertChange')
	async revertChange(uri: Uri, changes: LineChange[], index: number): Promise<void> {
		if (!uri) {
			return;
		}

		const textEditor = window.visibleTextEditors.filter(e => e.document.uri.toString() === uri.toString())[0];

		if (!textEditor) {
			return;
		}

		await this._revertChanges(textEditor, [...changes.slice(0, index), ...changes.slice(index + 1)]);

		const firstStagedLine = changes[index].modifiedStartLineNumber - 1;
		textEditor.selections = [new Selection(firstStagedLine, 0, firstStagedLine, 0)];
	}

	@command('git.revertSelectedRanges', { diff: true })
	async revertSelectedRanges(changes: LineChange[]): Promise<void> {
		const textEditor = window.activeTextEditor;

		if (!textEditor) {
			return;
		}

		const modifiedDocument = textEditor.document;
		const selections = textEditor.selections;
		const selectedChanges = changes.filter(change => {
			const modifiedRange = getModifiedRange(modifiedDocument, change);
			return selections.every(selection => !selection.intersection(modifiedRange));
		});

		if (selectedChanges.length === changes.length) {
			return;
		}

		const selectionsBeforeRevert = textEditor.selections;
		await this._revertChanges(textEditor, selectedChanges);
		textEditor.selections = selectionsBeforeRevert;
	}

	private async _revertChanges(textEditor: TextEditor, changes: LineChange[]): Promise<void> {
		const modifiedDocument = textEditor.document;
		const modifiedUri = modifiedDocument.uri;

		if (modifiedUri.scheme !== 'file') {
			return;
		}

		const originalUri = toGitUri(modifiedUri, '~');
		const originalDocument = await workspace.openTextDocument(originalUri);
		const visibleRangesBeforeRevert = textEditor.visibleRanges;
		const result = applyLineChanges(originalDocument, modifiedDocument, changes);

		const edit = new WorkspaceEdit();
		edit.replace(modifiedUri, new Range(new Position(0, 0), modifiedDocument.lineAt(modifiedDocument.lineCount - 1).range.end), result);
		workspace.applyEdit(edit);

		await modifiedDocument.save();

		textEditor.revealRange(visibleRangesBeforeRevert[0]);
	}

	@command('git.unstage')
	async unstage(...resourceStates: SourceControlResourceState[]): Promise<void> {
		resourceStates = resourceStates.filter(s => !!s);

		if (resourceStates.length === 0 || (resourceStates[0] && !(resourceStates[0].resourceUri instanceof Uri))) {
			const resource = this.getSCMResource();

			if (!resource) {
				return;
			}

			resourceStates = [resource];
		}

		const scmResources = resourceStates
			.filter(s => s instanceof Resource && s.resourceGroupType === ResourceGroupType.Index) as Resource[];

		if (!scmResources.length) {
			return;
		}

		const resources = scmResources.map(r => r.resourceUri);
		await this.runByRepository(resources, async (repository, resources) => repository.revert(resources));
	}

	@command('git.unstageAll', { repository: true })
	async unstageAll(repository: Repository): Promise<void> {
		await repository.revert([]);
	}

	@command('git.unstageSelectedRanges', { diff: true })
	async unstageSelectedRanges(diffs: LineChange[]): Promise<void> {
		const textEditor = window.activeTextEditor;

		if (!textEditor) {
			return;
		}

		const modifiedDocument = textEditor.document;
		const modifiedUri = modifiedDocument.uri;

		if (!isGitUri(modifiedUri)) {
			return;
		}

		const { ref } = fromGitUri(modifiedUri);

		if (ref !== '') {
			return;
		}

		const originalUri = toGitUri(modifiedUri, 'HEAD');
		const originalDocument = await workspace.openTextDocument(originalUri);
		const selectedLines = toLineRanges(textEditor.selections, modifiedDocument);
		const selectedDiffs = diffs
			.map(diff => selectedLines.reduce<LineChange | null>((result, range) => result || intersectDiffWithRange(modifiedDocument, diff, range), null))
			.filter(d => !!d) as LineChange[];

		if (!selectedDiffs.length) {
			return;
		}

		const invertedDiffs = selectedDiffs.map(invertLineChange);
		const result = applyLineChanges(modifiedDocument, originalDocument, invertedDiffs);

		await this.runByRepository(modifiedUri, async (repository, resource) => await repository.stage(resource, result));
	}

	@command('git.clean')
	async clean(...resourceStates: SourceControlResourceState[]): Promise<void> {
		resourceStates = resourceStates.filter(s => !!s);

		if (resourceStates.length === 0 || (resourceStates[0] && !(resourceStates[0].resourceUri instanceof Uri))) {
			const resource = this.getSCMResource();

			if (!resource) {
				return;
			}

			resourceStates = [resource];
		}

		const scmResources = resourceStates.filter(s => s instanceof Resource
			&& (s.resourceGroupType === ResourceGroupType.WorkingTree || s.resourceGroupType === ResourceGroupType.Untracked)) as Resource[];

		if (!scmResources.length) {
			return;
		}

		const untrackedCount = scmResources.reduce((s, r) => s + (r.type === Status.UNTRACKED ? 1 : 0), 0);
		let message: string;
		let yes = localize('discard', "Discard Changes");

		if (scmResources.length === 1) {
			if (untrackedCount > 0) {
				message = localize('confirm delete', "Are you sure you want to DELETE {0}?\nThis is IRREVERSIBLE!\nThis file will be FOREVER LOST if you proceed.", path.basename(scmResources[0].resourceUri.fsPath));
				yes = localize('delete file', "Delete file");
			} else {
				if (scmResources[0].type === Status.DELETED) {
					yes = localize('restore file', "Restore file");
					message = localize('confirm restore', "Are you sure you want to restore {0}?", path.basename(scmResources[0].resourceUri.fsPath));
				} else {
					message = localize('confirm discard', "Are you sure you want to discard changes in {0}?", path.basename(scmResources[0].resourceUri.fsPath));
				}
			}
		} else {
			if (scmResources.every(resource => resource.type === Status.DELETED)) {
				yes = localize('restore files', "Restore files");
				message = localize('confirm restore multiple', "Are you sure you want to restore {0} files?", scmResources.length);
			} else {
				message = localize('confirm discard multiple', "Are you sure you want to discard changes in {0} files?", scmResources.length);
			}

			if (untrackedCount > 0) {
				message = `${message}\n\n${localize('warn untracked', "This will DELETE {0} untracked files!\nThis is IRREVERSIBLE!\nThese files will be FOREVER LOST.", untrackedCount)}`;
			}
		}

		const pick = await window.showWarningMessage(message, { modal: true }, yes);

		if (pick !== yes) {
			return;
		}

		const resources = scmResources.map(r => r.resourceUri);
		await this.runByRepository(resources, async (repository, resources) => repository.clean(resources));
	}

	@command('git.cleanAll', { repository: true })
	async cleanAll(repository: Repository): Promise<void> {
		let resources = repository.workingTreeGroup.resourceStates;

		if (resources.length === 0) {
			return;
		}

		const trackedResources = resources.filter(r => r.type !== Status.UNTRACKED && r.type !== Status.IGNORED);
		const untrackedResources = resources.filter(r => r.type === Status.UNTRACKED || r.type === Status.IGNORED);

		if (untrackedResources.length === 0) {
			await this._cleanTrackedChanges(repository, resources);
		} else if (resources.length === 1) {
			await this._cleanUntrackedChange(repository, resources[0]);
		} else if (trackedResources.length === 0) {
			await this._cleanUntrackedChanges(repository, resources);
		} else { // resources.length > 1 && untrackedResources.length > 0 && trackedResources.length > 0
			const untrackedMessage = untrackedResources.length === 1
				? localize('there are untracked files single', "The following untracked file will be DELETED FROM DISK if discarded: {0}.", path.basename(untrackedResources[0].resourceUri.fsPath))
				: localize('there are untracked files', "There are {0} untracked files which will be DELETED FROM DISK if discarded.", untrackedResources.length);

			const message = localize('confirm discard all 2', "{0}\n\nThis is IRREVERSIBLE, your current working set will be FOREVER LOST.", untrackedMessage, resources.length);

			const yesTracked = trackedResources.length === 1
				? localize('yes discard tracked', "Discard 1 Tracked File", trackedResources.length)
				: localize('yes discard tracked multiple', "Discard {0} Tracked Files", trackedResources.length);

			const yesAll = localize('discardAll', "Discard All {0} Files", resources.length);
			const pick = await window.showWarningMessage(message, { modal: true }, yesTracked, yesAll);

			if (pick === yesTracked) {
				resources = trackedResources;
			} else if (pick !== yesAll) {
				return;
			}

			await repository.clean(resources.map(r => r.resourceUri));
		}
	}

	@command('git.cleanAllTracked', { repository: true })
	async cleanAllTracked(repository: Repository): Promise<void> {
		const resources = repository.workingTreeGroup.resourceStates
			.filter(r => r.type !== Status.UNTRACKED && r.type !== Status.IGNORED);

		if (resources.length === 0) {
			return;
		}

		await this._cleanTrackedChanges(repository, resources);
	}

	@command('git.cleanAllUntracked', { repository: true })
	async cleanAllUntracked(repository: Repository): Promise<void> {
		const resources = [...repository.workingTreeGroup.resourceStates, ...repository.untrackedGroup.resourceStates]
			.filter(r => r.type === Status.UNTRACKED || r.type === Status.IGNORED);

		if (resources.length === 0) {
			return;
		}

		if (resources.length === 1) {
			await this._cleanUntrackedChange(repository, resources[0]);
		} else {
			await this._cleanUntrackedChanges(repository, resources);
		}
	}

	private async _cleanTrackedChanges(repository: Repository, resources: Resource[]): Promise<void> {
		const message = resources.length === 1
			? localize('confirm discard all single', "Are you sure you want to discard changes in {0}?", path.basename(resources[0].resourceUri.fsPath))
			: localize('confirm discard all', "Are you sure you want to discard ALL changes in {0} files?\nThis is IRREVERSIBLE!\nYour current working set will be FOREVER LOST if you proceed.", resources.length);
		const yes = resources.length === 1
			? localize('discardAll multiple', "Discard 1 File")
			: localize('discardAll', "Discard All {0} Files", resources.length);
		const pick = await window.showWarningMessage(message, { modal: true }, yes);

		if (pick !== yes) {
			return;
		}

		await repository.clean(resources.map(r => r.resourceUri));
	}

	private async _cleanUntrackedChange(repository: Repository, resource: Resource): Promise<void> {
		const message = localize('confirm delete', "Are you sure you want to DELETE {0}?\nThis is IRREVERSIBLE!\nThis file will be FOREVER LOST if you proceed.", path.basename(resource.resourceUri.fsPath));
		const yes = localize('delete file', "Delete file");
		const pick = await window.showWarningMessage(message, { modal: true }, yes);

		if (pick !== yes) {
			return;
		}

		await repository.clean([resource.resourceUri]);
	}

	private async _cleanUntrackedChanges(repository: Repository, resources: Resource[]): Promise<void> {
		const message = localize('confirm delete multiple', "Are you sure you want to DELETE {0} files?\nThis is IRREVERSIBLE!\nThese files will be FOREVER LOST if you proceed.", resources.length);
		const yes = localize('delete files', "Delete Files");
		const pick = await window.showWarningMessage(message, { modal: true }, yes);

		if (pick !== yes) {
			return;
		}

		await repository.clean(resources.map(r => r.resourceUri));
	}

	private async smartCommit(
		repository: Repository,
		getCommitMessage: () => Promise<string | undefined>,
		opts?: CommitOptions
	): Promise<boolean> {
		const config = workspace.getConfiguration('git', Uri.file(repository.root));
		let promptToSaveFilesBeforeCommit = config.get<'always' | 'staged' | 'never'>('promptToSaveFilesBeforeCommit');

		// migration
		if (promptToSaveFilesBeforeCommit as any === true) {
			promptToSaveFilesBeforeCommit = 'always';
		} else if (promptToSaveFilesBeforeCommit as any === false) {
			promptToSaveFilesBeforeCommit = 'never';
		}

		const enableSmartCommit = config.get<boolean>('enableSmartCommit') === true;
		const enableCommitSigning = config.get<boolean>('enableCommitSigning') === true;
		let noStagedChanges = repository.indexGroup.resourceStates.length === 0;
		let noUnstagedChanges = repository.workingTreeGroup.resourceStates.length === 0;

		if (promptToSaveFilesBeforeCommit !== 'never') {
			let documents = workspace.textDocuments
				.filter(d => !d.isUntitled && d.isDirty && isDescendant(repository.root, d.uri.fsPath));

			if (promptToSaveFilesBeforeCommit === 'staged' || repository.indexGroup.resourceStates.length > 0) {
				documents = documents
					.filter(d => repository.indexGroup.resourceStates.some(s => pathEquals(s.resourceUri.fsPath, d.uri.fsPath)));
			}

			if (documents.length > 0) {
				const message = documents.length === 1
					? localize('unsaved files single', "The following file has unsaved changes which won't be included in the commit if you proceed: {0}.\n\nWould you like to save it before committing?", path.basename(documents[0].uri.fsPath))
					: localize('unsaved files', "There are {0} unsaved files.\n\nWould you like to save them before committing?", documents.length);
				const saveAndCommit = localize('save and commit', "Save All & Commit");
				const commit = localize('commit', "Commit Staged Changes");
				const pick = await window.showWarningMessage(message, { modal: true }, saveAndCommit, commit);

				if (pick === saveAndCommit) {
					await Promise.all(documents.map(d => d.save()));
					await repository.add(documents.map(d => d.uri));

					noStagedChanges = repository.indexGroup.resourceStates.length === 0;
					noUnstagedChanges = repository.workingTreeGroup.resourceStates.length === 0;
				} else if (pick !== commit) {
					return false; // do not commit on cancel
				}
			}
		}

		if (!opts) {
			opts = { all: noStagedChanges };
		} else if (!opts.all && noStagedChanges && !opts.empty) {
			opts = { ...opts, all: true };
		}

		// no changes, and the user has not configured to commit all in this case
		if (!noUnstagedChanges && noStagedChanges && !enableSmartCommit && !opts.empty) {
			const suggestSmartCommit = config.get<boolean>('suggestSmartCommit') === true;

			if (!suggestSmartCommit) {
				return false;
			}

			// prompt the user if we want to commit all or not
			const message = localize('no staged changes', "There are no staged changes to commit.\n\nWould you like to stage all your changes and commit them directly?");
			const yes = localize('yes', "Yes");
			const always = localize('always', "Always");
			const never = localize('never', "Never");
			const pick = await window.showWarningMessage(message, { modal: true }, yes, always, never);

			if (pick === always) {
				config.update('enableSmartCommit', true, true);
			} else if (pick === never) {
				config.update('suggestSmartCommit', false, true);
				return false;
			} else if (pick !== yes) {
				return false; // do not commit on cancel
			}
		}

		// enable signing of commits if configured
		opts.signCommit = enableCommitSigning;

		if (config.get<boolean>('alwaysSignOff')) {
			opts.signoff = true;
		}

		const smartCommitChanges = config.get<'all' | 'tracked'>('smartCommitChanges');

		if (
			(
				// no changes
				(noStagedChanges && noUnstagedChanges)
				// or no staged changes and not `all`
				|| (!opts.all && noStagedChanges)
				// no staged changes and no tracked unstaged changes
				|| (noStagedChanges && smartCommitChanges === 'tracked' && repository.workingTreeGroup.resourceStates.every(r => r.type === Status.UNTRACKED))
			)
			// amend allows changing only the commit message
			&& !opts.amend
			&& !opts.empty
		) {
			const commitAnyway = localize('commit anyway', "Create Empty Commit");
			const answer = await window.showInformationMessage(localize('no changes', "There are no changes to commit."), commitAnyway);

			if (answer !== commitAnyway) {
				return false;
			}

			opts.empty = true;
		}

		if (opts.noVerify) {
			if (!config.get<boolean>('allowNoVerifyCommit')) {
				await window.showErrorMessage(localize('no verify commit not allowed', "Commits without verification are not allowed, please enable them with the 'git.allowNoVerifyCommit' setting."));
				return false;
			}

			if (config.get<boolean>('confirmNoVerifyCommit')) {
				const message = localize('confirm no verify commit', "You are about to commit your changes without verification, this skips pre-commit hooks and can be undesirable.\n\nAre you sure to continue?");
				const yes = localize('ok', "OK");
				const neverAgain = localize('never ask again', "OK, Don't Ask Again");
				const pick = await window.showWarningMessage(message, { modal: true }, yes, neverAgain);

				if (pick === neverAgain) {
					config.update('confirmNoVerifyCommit', false, true);
				} else if (pick !== yes) {
					return false;
				}
			}
		}

		let message = await getCommitMessage();

		if (!message && !opts.amend) {
			return false;
		}

		if (opts.all && smartCommitChanges === 'tracked') {
			opts.all = 'tracked';
		}

		if (opts.all && config.get<'mixed' | 'separate' | 'hidden'>('untrackedChanges') !== 'mixed') {
			opts.all = 'tracked';
		}

		await repository.commit(message, opts);

		const postCommitCommand = config.get<'none' | 'push' | 'sync'>('postCommitCommand');

		switch (postCommitCommand) {
			case 'push':
				await this._push(repository, { pushType: PushType.Push, silent: true });
				break;
			case 'sync':
				await this.sync(repository);
				break;
		}

		return true;
	}

	private async commitWithAnyInput(repository: Repository, opts?: CommitOptions): Promise<void> {
		const message = repository.inputBox.value;
		const getCommitMessage = async () => {
			let _message: string | undefined = message;

			if (!_message) {
				let value: string | undefined = undefined;

				if (opts && opts.amend && repository.HEAD && repository.HEAD.commit) {
					return undefined;
				}

				const branchName = repository.headShortName;
				let placeHolder: string;

				if (branchName) {
					placeHolder = localize('commitMessageWithHeadLabel2', "Message (commit on '{0}')", branchName);
				} else {
					placeHolder = localize('commit message', "Commit message");
				}

				_message = await window.showInputBox({
					value,
					placeHolder,
					prompt: localize('provide commit message', "Please provide a commit message"),
					ignoreFocusOut: true
				});
			}

			return _message;
		};

		const didCommit = await this.smartCommit(repository, getCommitMessage, opts);

		if (message && didCommit) {
			repository.inputBox.value = await repository.getInputTemplate();
		}
	}

	@command('git.commit', { repository: true })
	async commit(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository);
	}

	@command('git.commitStaged', { repository: true })
	async commitStaged(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: false });
	}

	@command('git.commitStagedSigned', { repository: true })
	async commitStagedSigned(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: false, signoff: true });
	}

	@command('git.commitStagedAmend', { repository: true })
	async commitStagedAmend(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: false, amend: true });
	}

	@command('git.commitAll', { repository: true })
	async commitAll(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: true });
	}

	@command('git.commitAllSigned', { repository: true })
	async commitAllSigned(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: true, signoff: true });
	}

	@command('git.commitAllAmend', { repository: true })
	async commitAllAmend(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: true, amend: true });
	}

	private async _commitEmpty(repository: Repository, noVerify?: boolean): Promise<void> {
		const root = Uri.file(repository.root);
		const config = workspace.getConfiguration('git', root);
		const shouldPrompt = config.get<boolean>('confirmEmptyCommits') === true;

		if (shouldPrompt) {
			const message = localize('confirm emtpy commit', "Are you sure you want to create an empty commit?");
			const yes = localize('yes', "Yes");
			const neverAgain = localize('yes never again', "Yes, Don't Show Again");
			const pick = await window.showWarningMessage(message, { modal: true }, yes, neverAgain);

			if (pick === neverAgain) {
				await config.update('confirmEmptyCommits', false, true);
			} else if (pick !== yes) {
				return;
			}
		}

		await this.commitWithAnyInput(repository, { empty: true, noVerify });
	}

	@command('git.commitEmpty', { repository: true })
	async commitEmpty(repository: Repository): Promise<void> {
		await this._commitEmpty(repository);
	}

	@command('git.commitNoVerify', { repository: true })
	async commitNoVerify(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { noVerify: true });
	}

	@command('git.commitStagedNoVerify', { repository: true })
	async commitStagedNoVerify(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: false, noVerify: true });
	}

	@command('git.commitStagedSignedNoVerify', { repository: true })
	async commitStagedSignedNoVerify(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: false, signoff: true, noVerify: true });
	}

	@command('git.commitStagedAmendNoVerify', { repository: true })
	async commitStagedAmendNoVerify(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: false, amend: true, noVerify: true });
	}

	@command('git.commitAllNoVerify', { repository: true })
	async commitAllNoVerify(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: true, noVerify: true });
	}

	@command('git.commitAllSignedNoVerify', { repository: true })
	async commitAllSignedNoVerify(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: true, signoff: true, noVerify: true });
	}

	@command('git.commitAllAmendNoVerify', { repository: true })
	async commitAllAmendNoVerify(repository: Repository): Promise<void> {
		await this.commitWithAnyInput(repository, { all: true, amend: true, noVerify: true });
	}

	@command('git.commitEmptyNoVerify', { repository: true })
	async commitEmptyNoVerify(repository: Repository): Promise<void> {
		await this._commitEmpty(repository, true);
	}

	@command('git.restoreCommitTemplate', { repository: true })
	async restoreCommitTemplate(repository: Repository): Promise<void> {
		repository.inputBox.value = await repository.getCommitTemplate();
	}

	@command('git.undoCommit', { repository: true })
	async undoCommit(repository: Repository): Promise<void> {
		const HEAD = repository.HEAD;

		if (!HEAD || !HEAD.commit) {
			window.showWarningMessage(localize('no more', "Can't undo because HEAD doesn't point to any commit."));
			return;
		}

		const commit = await repository.getCommit('HEAD');

		if (commit.parents.length > 1) {
			const yes = localize('undo commit', "Undo merge commit");
			const result = await window.showWarningMessage(localize('merge commit', "The last commit was a merge commit. Are you sure you want to undo it?"), { modal: true }, yes);

			if (result !== yes) {
				return;
			}
		}

		if (commit.parents.length > 0) {
			await repository.reset('HEAD~');
		} else {
			await repository.deleteRef('HEAD');
			await this.unstageAll(repository);
		}

		repository.inputBox.value = commit.message;
	}

	@command('git.checkout', { repository: true })
	async checkout(repository: Repository, treeish?: string): Promise<boolean> {
		return this._checkout(repository, { treeish });
	}

	@command('git.checkoutDetached', { repository: true })
	async checkoutDetached(repository: Repository, treeish?: string): Promise<boolean> {
		return this._checkout(repository, { detached: true, treeish });
	}

	private async _checkout(repository: Repository, opts?: { detached?: boolean, treeish?: string }): Promise<boolean> {
		if (typeof opts?.treeish === 'string') {
			await repository.checkout(opts?.treeish, opts);
			return true;
		}

		const createBranch = new CreateBranchItem();
		const createBranchFrom = new CreateBranchFromItem();
		const checkoutDetached = new CheckoutDetachedItem();
		const picks: QuickPickItem[] = [];

		if (!opts?.detached) {
			picks.push(createBranch, createBranchFrom, checkoutDetached);
		}

		picks.push(...createCheckoutItems(repository));

		const quickpick = window.createQuickPick();
		quickpick.items = picks;
		quickpick.placeholder = opts?.detached
			? localize('select a ref to checkout detached', 'Select a ref to checkout in detached mode')
			: localize('select a ref to checkout', 'Select a ref to checkout');

		quickpick.show();

		const choice = await new Promise<QuickPickItem | undefined>(c => quickpick.onDidAccept(() => c(quickpick.activeItems[0])));
		quickpick.hide();

		if (!choice) {
			return false;
		}

		if (choice === createBranch) {
			await this._branch(repository, quickpick.value);
		} else if (choice === createBranchFrom) {
			await this._branch(repository, quickpick.value, true);
		} else if (choice === checkoutDetached) {
			return this._checkout(repository, { detached: true });
		} else {
			const item = choice as CheckoutItem;

			try {
				await item.run(repository, opts);
			} catch (err) {
				if (err.gitErrorCode !== GitErrorCodes.DirtyWorkTree) {
					throw err;
				}

				const force = localize('force', "Force Checkout");
				const stash = localize('stashcheckout', "Stash & Checkout");
				const choice = await window.showWarningMessage(localize('local changes', "Your local changes would be overwritten by checkout."), { modal: true }, force, stash);

				if (choice === force) {
					await this.cleanAll(repository);
					await item.run(repository, opts);
				} else if (choice === stash) {
					await this.stash(repository);
					await item.run(repository, opts);
					await this.stashPopLatest(repository);
				}
			}
		}

		return true;
	}

	@command('git.branch', { repository: true })
	async branch(repository: Repository): Promise<void> {
		await this._branch(repository);
	}

	@command('git.branchFrom', { repository: true })
	async branchFrom(repository: Repository): Promise<void> {
		await this._branch(repository, undefined, true);
	}

	private async promptForBranchName(defaultName?: string, initialValue?: string): Promise<string> {
		const config = workspace.getConfiguration('git');
		const branchWhitespaceChar = config.get<string>('branchWhitespaceChar')!;
		const branchValidationRegex = config.get<string>('branchValidationRegex')!;
		const sanitize = (name: string) => name ?
			name.trim().replace(/^-+/, '').replace(/^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$|\[|\]$/g, branchWhitespaceChar)
			: name;

		const rawBranchName = defaultName || await window.showInputBox({
			placeHolder: localize('branch name', "Branch name"),
			prompt: localize('provide branch name', "Please provide a new branch name"),
			value: initialValue,
			ignoreFocusOut: true,
			validateInput: (name: string) => {
				const validateName = new RegExp(branchValidationRegex);
				if (validateName.test(sanitize(name))) {
					return null;
				}

				return localize('branch name format invalid', "Branch name needs to match regex: {0}", branchValidationRegex);
			}
		});

		return sanitize(rawBranchName || '');
	}

	private async _branch(repository: Repository, defaultName?: string, from = false): Promise<void> {
		const branchName = await this.promptForBranchName(defaultName);

		if (!branchName) {
			return;
		}

		let target = 'HEAD';

		if (from) {
			const picks = [new HEADItem(repository), ...createCheckoutItems(repository)];
			const placeHolder = localize('select a ref to create a new branch from', 'Select a ref to create the \'{0}\' branch from', branchName);
			const choice = await window.showQuickPick(picks, { placeHolder });

			if (!choice) {
				return;
			}

			target = choice.label;
		}

		await repository.branch(branchName, true, target);
	}

	@command('git.deleteBranch', { repository: true })
	async deleteBranch(repository: Repository, name: string, force?: boolean): Promise<void> {
		let run: (force?: boolean) => Promise<void>;
		if (typeof name === 'string') {
			run = force => repository.deleteBranch(name, force);
		} else {
			const currentHead = repository.HEAD && repository.HEAD.name;
			const heads = repository.refs.filter(ref => ref.type === RefType.Head && ref.name !== currentHead)
				.map(ref => new BranchDeleteItem(ref));

			const placeHolder = localize('select branch to delete', 'Select a branch to delete');
			const choice = await window.showQuickPick<BranchDeleteItem>(heads, { placeHolder });

			if (!choice || !choice.branchName) {
				return;
			}
			name = choice.branchName;
			run = force => choice.run(repository, force);
		}

		try {
			await run(force);
		} catch (err) {
			if (err.gitErrorCode !== GitErrorCodes.BranchNotFullyMerged) {
				throw err;
			}

			const message = localize('confirm force delete branch', "The branch '{0}' is not fully merged. Delete anyway?", name);
			const yes = localize('delete branch', "Delete Branch");
			const pick = await window.showWarningMessage(message, { modal: true }, yes);

			if (pick === yes) {
				await run(true);
			}
		}
	}

	@command('git.renameBranch', { repository: true })
	async renameBranch(repository: Repository): Promise<void> {
		const currentBranchName = repository.HEAD && repository.HEAD.name;
		const branchName = await this.promptForBranchName(undefined, currentBranchName);

		if (!branchName) {
			return;
		}

		try {
			await repository.renameBranch(branchName);
		} catch (err) {
			switch (err.gitErrorCode) {
				case GitErrorCodes.InvalidBranchName:
					window.showErrorMessage(localize('invalid branch name', 'Invalid branch name'));
					return;
				case GitErrorCodes.BranchAlreadyExists:
					window.showErrorMessage(localize('branch already exists', "A branch named '{0}' already exists", branchName));
					return;
				default:
					throw err;
			}
		}
	}

	@command('git.merge', { repository: true })
	async merge(repository: Repository): Promise<void> {
		const config = workspace.getConfiguration('git');
		const checkoutType = config.get<string | string[]>('checkoutType');
		const includeRemotes = checkoutType === 'all' || checkoutType === 'remote' || checkoutType?.includes('remote');

		const heads = repository.refs.filter(ref => ref.type === RefType.Head)
			.filter(ref => ref.name || ref.commit)
			.map(ref => new MergeItem(ref as Branch));

		const remoteHeads = (includeRemotes ? repository.refs.filter(ref => ref.type === RefType.RemoteHead) : [])
			.filter(ref => ref.name || ref.commit)
			.map(ref => new MergeItem(ref as Branch));

		const picks = [...heads, ...remoteHeads];
		const placeHolder = localize('select a branch to merge from', 'Select a branch to merge from');
		const choice = await window.showQuickPick<MergeItem>(picks, { placeHolder });

		if (!choice) {
			return;
		}

		await choice.run(repository);
	}

	@command('git.rebase', { repository: true })
	async rebase(repository: Repository): Promise<void> {
		const config = workspace.getConfiguration('git');
		const checkoutType = config.get<string | string[]>('checkoutType');
		const includeRemotes = checkoutType === 'all' || checkoutType === 'remote' || checkoutType?.includes('remote');

		const heads = repository.refs.filter(ref => ref.type === RefType.Head)
			.filter(ref => ref.name !== repository.HEAD?.name)
			.filter(ref => ref.name || ref.commit);

		const remoteHeads = (includeRemotes ? repository.refs.filter(ref => ref.type === RefType.RemoteHead) : [])
			.filter(ref => ref.name || ref.commit);

		const picks = [...heads, ...remoteHeads]
			.map(ref => new RebaseItem(ref));

		// set upstream branch as first
		if (repository.HEAD?.upstream) {
			const upstreamName = `${repository.HEAD?.upstream.remote}/${repository.HEAD?.upstream.name}`;
			const index = picks.findIndex(e => e.ref.name === upstreamName);

			if (index > -1) {
				const [ref] = picks.splice(index, 1);
				ref.description = '(upstream)';
				picks.unshift(ref);
			}
		}

		const placeHolder = localize('select a branch to rebase onto', 'Select a branch to rebase onto');
		const choice = await window.showQuickPick<RebaseItem>(picks, { placeHolder });

		if (!choice) {
			return;
		}

		await choice.run(repository);
	}

	@command('git.createTag', { repository: true })
	async createTag(repository: Repository): Promise<void> {
		const inputTagName = await window.showInputBox({
			placeHolder: localize('tag name', "Tag name"),
			prompt: localize('provide tag name', "Please provide a tag name"),
			ignoreFocusOut: true
		});

		if (!inputTagName) {
			return;
		}

		const inputMessage = await window.showInputBox({
			placeHolder: localize('tag message', "Message"),
			prompt: localize('provide tag message', "Please provide a message to annotate the tag"),
			ignoreFocusOut: true
		});

		const name = inputTagName.replace(/^\.|\/\.|\.\.|~|\^|:|\/$|\.lock$|\.lock\/|\\|\*|\s|^\s*$|\.$/g, '-');
		await repository.tag(name, inputMessage);
	}

	@command('git.deleteTag', { repository: true })
	async deleteTag(repository: Repository): Promise<void> {
		const picks = repository.refs.filter(ref => ref.type === RefType.Tag)
			.map(ref => new TagItem(ref));

		if (picks.length === 0) {
			window.showWarningMessage(localize('no tags', "This repository has no tags."));
			return;
		}

		const placeHolder = localize('select a tag to delete', 'Select a tag to delete');
		const choice = await window.showQuickPick(picks, { placeHolder });

		if (!choice) {
			return;
		}

		await repository.deleteTag(choice.label);
	}

	@command('git.fetch', { repository: true })
	async fetch(repository: Repository): Promise<void> {
		if (repository.remotes.length === 0) {
			window.showWarningMessage(localize('no remotes to fetch', "This repository has no remotes configured to fetch from."));
			return;
		}

		await repository.fetchDefault();
	}

	@command('git.fetchPrune', { repository: true })
	async fetchPrune(repository: Repository): Promise<void> {
		if (repository.remotes.length === 0) {
			window.showWarningMessage(localize('no remotes to fetch', "This repository has no remotes configured to fetch from."));
			return;
		}

		await repository.fetchPrune();
	}


	@command('git.fetchAll', { repository: true })
	async fetchAll(repository: Repository): Promise<void> {
		if (repository.remotes.length === 0) {
			window.showWarningMessage(localize('no remotes to fetch', "This repository has no remotes configured to fetch from."));
			return;
		}

		await repository.fetchAll();
	}

	@command('git.pullFrom', { repository: true })
	async pullFrom(repository: Repository): Promise<void> {
		const remotes = repository.remotes;

		if (remotes.length === 0) {
			window.showWarningMessage(localize('no remotes to pull', "Your repository has no remotes configured to pull from."));
			return;
		}

		const remotePicks = remotes.filter(r => r.fetchUrl !== undefined).map(r => ({ label: r.name, description: r.fetchUrl! }));
		const placeHolder = localize('pick remote pull repo', "Pick a remote to pull the branch from");
		const remotePick = await window.showQuickPick(remotePicks, { placeHolder });

		if (!remotePick) {
			return;
		}

		const remoteRefs = repository.refs;
		const remoteRefsFiltered = remoteRefs.filter(r => (r.remote === remotePick.label));
		const branchPicks = remoteRefsFiltered.map(r => ({ label: r.name! }));
		const branchPlaceHolder = localize('pick branch pull', "Pick a branch to pull from");
		const branchPick = await window.showQuickPick(branchPicks, { placeHolder: branchPlaceHolder });

		if (!branchPick) {
			return;
		}

		const remoteCharCnt = remotePick.label.length;

		await repository.pullFrom(false, remotePick.label, branchPick.label.slice(remoteCharCnt + 1));
	}

	@command('git.pull', { repository: true })
	async pull(repository: Repository): Promise<void> {
		const remotes = repository.remotes;

		if (remotes.length === 0) {
			window.showWarningMessage(localize('no remotes to pull', "Your repository has no remotes configured to pull from."));
			return;
		}

		await repository.pull(repository.HEAD);
	}

	@command('git.pullRebase', { repository: true })
	async pullRebase(repository: Repository): Promise<void> {
		const remotes = repository.remotes;

		if (remotes.length === 0) {
			window.showWarningMessage(localize('no remotes to pull', "Your repository has no remotes configured to pull from."));
			return;
		}

		await repository.pullWithRebase(repository.HEAD);
	}

	private async _push(repository: Repository, pushOptions: PushOptions) {
		const remotes = repository.remotes;

		if (remotes.length === 0) {
			if (pushOptions.silent) {
				return;
			}

			const addRemote = localize('addremote', 'Add Remote');
			const result = await window.showWarningMessage(localize('no remotes to push', "Your repository has no remotes configured to push to."), addRemote);

			if (result === addRemote) {
				await this.addRemote(repository);
			}

			return;
		}

		const config = workspace.getConfiguration('git', Uri.file(repository.root));
		let forcePushMode: ForcePushMode | undefined = undefined;

		if (pushOptions.forcePush) {
			if (!config.get<boolean>('allowForcePush')) {
				await window.showErrorMessage(localize('force push not allowed', "Force push is not allowed, please enable it with the 'git.allowForcePush' setting."));
				return;
			}

			forcePushMode = config.get<boolean>('useForcePushWithLease') === true ? ForcePushMode.ForceWithLease : ForcePushMode.Force;

			if (config.get<boolean>('confirmForcePush')) {
				const message = localize('confirm force push', "You are about to force push your changes, this can be destructive and could inadvertently overwrite changes made by others.\n\nAre you sure to continue?");
				const yes = localize('ok', "OK");
				const neverAgain = localize('never ask again', "OK, Don't Ask Again");
				const pick = await window.showWarningMessage(message, { modal: true }, yes, neverAgain);

				if (pick === neverAgain) {
					config.update('confirmForcePush', false, true);
				} else if (pick !== yes) {
					return;
				}
			}
		}

		if (pushOptions.pushType === PushType.PushFollowTags) {
			await repository.pushFollowTags(undefined, forcePushMode);
			return;
		}

		if (pushOptions.pushType === PushType.PushTags) {
			await repository.pushTags(undefined, forcePushMode);
		}

		if (!repository.HEAD || !repository.HEAD.name) {
			if (!pushOptions.silent) {
				window.showWarningMessage(localize('nobranch', "Please check out a branch to push to a remote."));
			}
			return;
		}

		if (pushOptions.pushType === PushType.Push) {
			try {
				await repository.push(repository.HEAD, forcePushMode);
			} catch (err) {
				if (err.gitErrorCode !== GitErrorCodes.NoUpstreamBranch) {
					throw err;
				}

				if (pushOptions.silent) {
					return;
				}

				const branchName = repository.HEAD.name;
				const message = localize('confirm publish branch', "The branch '{0}' has no upstream branch. Would you like to publish this branch?", branchName);
				const yes = localize('ok', "OK");
				const pick = await window.showWarningMessage(message, { modal: true }, yes);

				if (pick === yes) {
					await this.publish(repository);
				}
			}
		} else {
			const branchName = repository.HEAD.name;
			if (!pushOptions.pushTo?.remote) {
				const addRemote = new AddRemoteItem(this);
				const picks = [...remotes.filter(r => r.pushUrl !== undefined).map(r => ({ label: r.name, description: r.pushUrl })), addRemote];
				const placeHolder = localize('pick remote', "Pick a remote to publish the branch '{0}' to:", branchName);
				const choice = await window.showQuickPick(picks, { placeHolder });

				if (!choice) {
					return;
				}

				if (choice === addRemote) {
					const newRemote = await this.addRemote(repository);

					if (newRemote) {
						await repository.pushTo(newRemote, branchName, undefined, forcePushMode);
					}
				} else {
					await repository.pushTo(choice.label, branchName, undefined, forcePushMode);
				}
			} else {
				await repository.pushTo(pushOptions.pushTo.remote, pushOptions.pushTo.refspec || branchName, pushOptions.pushTo.setUpstream, forcePushMode);
			}
		}
	}

	@command('git.push', { repository: true })
	async push(repository: Repository): Promise<void> {
		await this._push(repository, { pushType: PushType.Push });
	}

	@command('git.pushForce', { repository: true })
	async pushForce(repository: Repository): Promise<void> {
		await this._push(repository, { pushType: PushType.Push, forcePush: true });
	}

	@command('git.pushWithTags', { repository: true })
	async pushFollowTags(repository: Repository): Promise<void> {
		await this._push(repository, { pushType: PushType.PushFollowTags });
	}

	@command('git.pushWithTagsForce', { repository: true })
	async pushFollowTagsForce(repository: Repository): Promise<void> {
		await this._push(repository, { pushType: PushType.PushFollowTags, forcePush: true });
	}

	@command('git.cherryPick', { repository: true })
	async cherryPick(repository: Repository): Promise<void> {
		const hash = await window.showInputBox({
			placeHolder: localize('commit hash', "Commit Hash"),
			prompt: localize('provide commit hash', "Please provide the commit hash"),
			ignoreFocusOut: true
		});

		if (!hash) {
			return;
		}

		await repository.cherryPick(hash);
	}

	@command('git.pushTo', { repository: true })
	async pushTo(repository: Repository, remote?: string, refspec?: string, setUpstream?: boolean): Promise<void> {
		await this._push(repository, { pushType: PushType.PushTo, pushTo: { remote: remote, refspec: refspec, setUpstream: setUpstream } });
	}

	@command('git.pushToForce', { repository: true })
	async pushToForce(repository: Repository, remote?: string, refspec?: string, setUpstream?: boolean): Promise<void> {
		await this._push(repository, { pushType: PushType.PushTo, pushTo: { remote: remote, refspec: refspec, setUpstream: setUpstream }, forcePush: true });
	}

	@command('git.pushTags', { repository: true })
	async pushTags(repository: Repository): Promise<void> {
		await this._push(repository, { pushType: PushType.PushTags });
	}

	@command('git.addRemote', { repository: true })
	async addRemote(repository: Repository): Promise<string | undefined> {
		const url = await pickRemoteSource(this.model, {
			providerLabel: provider => localize('addfrom', "Add remote from {0}", provider.name),
			urlLabel: localize('addFrom', "Add remote from URL")
		});

		if (!url) {
			return;
		}

		const resultName = await window.showInputBox({
			placeHolder: localize('remote name', "Remote name"),
			prompt: localize('provide remote name', "Please provide a remote name"),
			ignoreFocusOut: true,
			validateInput: (name: string) => {
				if (!sanitizeRemoteName(name)) {
					return localize('remote name format invalid', "Remote name format invalid");
				} else if (repository.remotes.find(r => r.name === name)) {
					return localize('remote already exists', "Remote '{0}' already exists.", name);
				}

				return null;
			}
		});

		const name = sanitizeRemoteName(resultName || '');

		if (!name) {
			return;
		}

		await repository.addRemote(name, url.trim());
		await repository.fetch({ remote: name });
		return name;
	}

	@command('git.removeRemote', { repository: true })
	async removeRemote(repository: Repository): Promise<void> {
		const remotes = repository.remotes;

		if (remotes.length === 0) {
			window.showErrorMessage(localize('no remotes added', "Your repository has no remotes."));
			return;
		}

		const picks = remotes.map(r => r.name);
		const placeHolder = localize('remove remote', "Pick a remote to remove");

		const remoteName = await window.showQuickPick(picks, { placeHolder });

		if (!remoteName) {
			return;
		}

		await repository.removeRemote(remoteName);
	}

	private async _sync(repository: Repository, rebase: boolean): Promise<void> {
		const HEAD = repository.HEAD;

		if (!HEAD) {
			return;
		} else if (!HEAD.upstream) {
			const branchName = HEAD.name;
			const message = localize('confirm publish branch', "The branch '{0}' has no upstream branch. Would you like to publish this branch?", branchName);
			const yes = localize('ok', "OK");
			const pick = await window.showWarningMessage(message, { modal: true }, yes);

			if (pick === yes) {
				await this.publish(repository);
			}
			return;
		}

		const remoteName = HEAD.remote || HEAD.upstream.remote;
		const remote = repository.remotes.find(r => r.name === remoteName);
		const isReadonly = remote && remote.isReadOnly;

		const config = workspace.getConfiguration('git');
		const shouldPrompt = !isReadonly && config.get<boolean>('confirmSync') === true;

		if (shouldPrompt) {
			const message = localize('sync is unpredictable', "This action will push and pull commits to and from '{0}/{1}'.", HEAD.upstream.remote, HEAD.upstream.name);
			const yes = localize('ok', "OK");
			const neverAgain = localize('never again', "OK, Don't Show Again");
			const pick = await window.showWarningMessage(message, { modal: true }, yes, neverAgain);

			if (pick === neverAgain) {
				await config.update('confirmSync', false, true);
			} else if (pick !== yes) {
				return;
			}
		}

		if (rebase) {
			await repository.syncRebase(HEAD);
		} else {
			await repository.sync(HEAD);
		}
	}

	@command('git.sync', { repository: true })
	async sync(repository: Repository): Promise<void> {
		try {
			await this._sync(repository, false);
		} catch (err) {
			if (/Cancelled/i.test(err && (err.message || err.stderr || ''))) {
				return;
			}

			throw err;
		}
	}

	@command('git._syncAll')
	async syncAll(): Promise<void> {
		await Promise.all(this.model.repositories.map(async repository => {
			const HEAD = repository.HEAD;

			if (!HEAD || !HEAD.upstream) {
				return;
			}

			await repository.sync(HEAD);
		}));
	}

	@command('git.syncRebase', { repository: true })
	async syncRebase(repository: Repository): Promise<void> {
		try {
			await this._sync(repository, true);
		} catch (err) {
			if (/Cancelled/i.test(err && (err.message || err.stderr || ''))) {
				return;
			}

			throw err;
		}
	}

	@command('git.publish', { repository: true })
	async publish(repository: Repository): Promise<void> {
		const branchName = repository.HEAD && repository.HEAD.name || '';
		const remotes = repository.remotes;

		if (remotes.length === 0) {
			const providers = this.model.getRemoteProviders().filter(p => !!p.publishRepository);

			if (providers.length === 0) {
				window.showWarningMessage(localize('no remotes to publish', "Your repository has no remotes configured to publish to."));
				return;
			}

			let provider: RemoteSourceProvider;

			if (providers.length === 1) {
				provider = providers[0];
			} else {
				const picks = providers
					.map(provider => ({ label: (provider.icon ? `$(${provider.icon}) ` : '') + localize('publish to', "Publish to {0}", provider.name), alwaysShow: true, provider }));
				const placeHolder = localize('pick provider', "Pick a provider to publish the branch '{0}' to:", branchName);
				const choice = await window.showQuickPick(picks, { placeHolder });

				if (!choice) {
					return;
				}

				provider = choice.provider;
			}

			await provider.publishRepository!(new ApiRepository(repository));
			this.model.firePublishEvent(repository, branchName);

			return;
		}

		if (remotes.length === 1) {
			await repository.pushTo(remotes[0].name, branchName, true);
			this.model.firePublishEvent(repository, branchName);

			return;
		}

		const addRemote = new AddRemoteItem(this);
		const picks = [...repository.remotes.map(r => ({ label: r.name, description: r.pushUrl })), addRemote];
		const placeHolder = localize('pick remote', "Pick a remote to publish the branch '{0}' to:", branchName);
		const choice = await window.showQuickPick(picks, { placeHolder });

		if (!choice) {
			return;
		}

		if (choice === addRemote) {
			const newRemote = await this.addRemote(repository);

			if (newRemote) {
				await repository.pushTo(newRemote, branchName, true);

				this.model.firePublishEvent(repository, branchName);
			}
		} else {
			await repository.pushTo(choice.label, branchName, true);

			this.model.firePublishEvent(repository, branchName);
		}
	}

	@command('git.ignore')
	async ignore(...resourceStates: SourceControlResourceState[]): Promise<void> {
		resourceStates = resourceStates.filter(s => !!s);

		if (resourceStates.length === 0 || (resourceStates[0] && !(resourceStates[0].resourceUri instanceof Uri))) {
			const resource = this.getSCMResource();

			if (!resource) {
				return;
			}

			resourceStates = [resource];
		}

		const resources = resourceStates
			.filter(s => s instanceof Resource)
			.map(r => r.resourceUri);

		if (!resources.length) {
			return;
		}

		await this.runByRepository(resources, async (repository, resources) => repository.ignore(resources));
	}

	@command('git.revealInExplorer')
	async revealInExplorer(resourceState: SourceControlResourceState): Promise<void> {
		if (!resourceState) {
			return;
		}

		if (!(resourceState.resourceUri instanceof Uri)) {
			return;
		}

		await commands.executeCommand('revealInExplorer', resourceState.resourceUri);
	}

	private async _stash(repository: Repository, includeUntracked = false): Promise<void> {
		const noUnstagedChanges = repository.workingTreeGroup.resourceStates.length === 0
			&& (!includeUntracked || repository.untrackedGroup.resourceStates.length === 0);
		const noStagedChanges = repository.indexGroup.resourceStates.length === 0;

		if (noUnstagedChanges && noStagedChanges) {
			window.showInformationMessage(localize('no changes stash', "There are no changes to stash."));
			return;
		}

		const config = workspace.getConfiguration('git', Uri.file(repository.root));
		const promptToSaveFilesBeforeStashing = config.get<'always' | 'staged' | 'never'>('promptToSaveFilesBeforeStash');

		if (promptToSaveFilesBeforeStashing !== 'never') {
			let documents = workspace.textDocuments
				.filter(d => !d.isUntitled && d.isDirty && isDescendant(repository.root, d.uri.fsPath));

			if (promptToSaveFilesBeforeStashing === 'staged' || repository.indexGroup.resourceStates.length > 0) {
				documents = documents
					.filter(d => repository.indexGroup.resourceStates.some(s => pathEquals(s.resourceUri.fsPath, d.uri.fsPath)));
			}

			if (documents.length > 0) {
				const message = documents.length === 1
					? localize('unsaved stash files single', "The following file has unsaved changes which won't be included in the stash if you proceed: {0}.\n\nWould you like to save it before stashing?", path.basename(documents[0].uri.fsPath))
					: localize('unsaved stash files', "There are {0} unsaved files.\n\nWould you like to save them before stashing?", documents.length);
				const saveAndStash = localize('save and stash', "Save All & Stash");
				const stash = localize('stash', "Stash Anyway");
				const pick = await window.showWarningMessage(message, { modal: true }, saveAndStash, stash);

				if (pick === saveAndStash) {
					await Promise.all(documents.map(d => d.save()));
				} else if (pick !== stash) {
					return; // do not stash on cancel
				}
			}
		}

		let message: string | undefined;

		if (config.get<boolean>('useCommitInputAsStashMessage') && (!repository.sourceControl.commitTemplate || repository.inputBox.value !== repository.sourceControl.commitTemplate)) {
			message = repository.inputBox.value;
		}

		message = await window.showInputBox({
			value: message,
			prompt: localize('provide stash message', "Optionally provide a stash message"),
			placeHolder: localize('stash message', "Stash message")
		});

		if (typeof message === 'undefined') {
			return;
		}

		await repository.createStash(message, includeUntracked);
	}

	@command('git.stash', { repository: true })
	stash(repository: Repository): Promise<void> {
		return this._stash(repository);
	}

	@command('git.stashIncludeUntracked', { repository: true })
	stashIncludeUntracked(repository: Repository): Promise<void> {
		return this._stash(repository, true);
	}

	@command('git.stashPop', { repository: true })
	async stashPop(repository: Repository): Promise<void> {
		const placeHolder = localize('pick stash to pop', "Pick a stash to pop");
		const stash = await this.pickStash(repository, placeHolder);

		if (!stash) {
			return;
		}

		await repository.popStash(stash.index);
	}

	@command('git.stashPopLatest', { repository: true })
	async stashPopLatest(repository: Repository): Promise<void> {
		const stashes = await repository.getStashes();

		if (stashes.length === 0) {
			window.showInformationMessage(localize('no stashes', "There are no stashes in the repository."));
			return;
		}

		await repository.popStash();
	}

	@command('git.stashApply', { repository: true })
	async stashApply(repository: Repository): Promise<void> {
		const placeHolder = localize('pick stash to apply', "Pick a stash to apply");
		const stash = await this.pickStash(repository, placeHolder);

		if (!stash) {
			return;
		}

		await repository.applyStash(stash.index);
	}

	@command('git.stashApplyLatest', { repository: true })
	async stashApplyLatest(repository: Repository): Promise<void> {
		const stashes = await repository.getStashes();

		if (stashes.length === 0) {
			window.showInformationMessage(localize('no stashes', "There are no stashes in the repository."));
			return;
		}

		await repository.applyStash();
	}

	@command('git.stashDrop', { repository: true })
	async stashDrop(repository: Repository): Promise<void> {
		const placeHolder = localize('pick stash to drop', "Pick a stash to drop");
		const stash = await this.pickStash(repository, placeHolder);

		if (!stash) {
			return;
		}

		// request confirmation for the operation
		const yes = localize('yes', "Yes");
		const result = await window.showWarningMessage(
			localize('sure drop', "Are you sure you want to drop the stash: {0}?", stash.description),
			yes
		);
		if (result !== yes) {
			return;
		}

		await repository.dropStash(stash.index);
	}

	private async pickStash(repository: Repository, placeHolder: string): Promise<Stash | undefined> {
		const stashes = await repository.getStashes();

		if (stashes.length === 0) {
			window.showInformationMessage(localize('no stashes', "There are no stashes in the repository."));
			return;
		}

		const picks = stashes.map(stash => ({ label: `#${stash.index}:  ${stash.description}`, description: '', details: '', stash }));
		const result = await window.showQuickPick(picks, { placeHolder });
		return result && result.stash;
	}

	@command('git.timeline.openDiff', { repository: false })
	async timelineOpenDiff(item: TimelineItem, uri: Uri | undefined, _source: string) {
		const cmd = this.resolveTimelineOpenDiffCommand(
			item, uri,
			{
				preserveFocus: true,
				preview: true,
				viewColumn: ViewColumn.Active
			},
		);
		if (cmd === undefined) {
			return undefined;
		}

		return commands.executeCommand(cmd.command, ...(cmd.arguments ?? []));
	}

	resolveTimelineOpenDiffCommand(item: TimelineItem, uri: Uri | undefined, options?: TextDocumentShowOptions): Command | undefined {
		if (uri === undefined || uri === null || !GitTimelineItem.is(item)) {
			return undefined;
		}

		const basename = path.basename(uri.fsPath);

		let title;
		if ((item.previousRef === 'HEAD' || item.previousRef === '~') && item.ref === '') {
			title = localize('git.title.workingTree', '{0} (Working Tree)', basename);
		}
		else if (item.previousRef === 'HEAD' && item.ref === '~') {
			title = localize('git.title.index', '{0} (Index)', basename);
		} else {
			title = localize('git.title.diffRefs', '{0} ({1}) ⟷ {0} ({2})', basename, item.shortPreviousRef, item.shortRef);
		}

		return {
			command: 'vscode.diff',
			title: 'Open Comparison',
			arguments: [toGitUri(uri, item.previousRef), item.ref === '' ? uri : toGitUri(uri, item.ref), title, options]
		};
	}

	@command('git.timeline.copyCommitId', { repository: false })
	async timelineCopyCommitId(item: TimelineItem, _uri: Uri | undefined, _source: string) {
		if (!GitTimelineItem.is(item)) {
			return;
		}

		env.clipboard.writeText(item.ref);
	}

	@command('git.timeline.copyCommitMessage', { repository: false })
	async timelineCopyCommitMessage(item: TimelineItem, _uri: Uri | undefined, _source: string) {
		if (!GitTimelineItem.is(item)) {
			return;
		}

		env.clipboard.writeText(item.message);
	}

	private _selectedForCompare: { uri: Uri, item: GitTimelineItem } | undefined;

	@command('git.timeline.selectForCompare', { repository: false })
	async timelineSelectForCompare(item: TimelineItem, uri: Uri | undefined, _source: string) {
		if (!GitTimelineItem.is(item) || !uri) {
			return;
		}

		this._selectedForCompare = { uri, item };
		await commands.executeCommand('setContext', 'git.timeline.selectedForCompare', true);
	}

	@command('git.timeline.compareWithSelected', { repository: false })
	async timelineCompareWithSelected(item: TimelineItem, uri: Uri | undefined, _source: string) {
		if (!GitTimelineItem.is(item) || !uri || !this._selectedForCompare || uri.toString() !== this._selectedForCompare.uri.toString()) {
			return;
		}

		const { item: selected } = this._selectedForCompare;

		const basename = path.basename(uri.fsPath);
		let leftTitle;
		if ((selected.previousRef === 'HEAD' || selected.previousRef === '~') && selected.ref === '') {
			leftTitle = localize('git.title.workingTree', '{0} (Working Tree)', basename);
		}
		else if (selected.previousRef === 'HEAD' && selected.ref === '~') {
			leftTitle = localize('git.title.index', '{0} (Index)', basename);
		} else {
			leftTitle = localize('git.title.ref', '{0} ({1})', basename, selected.shortRef);
		}

		let rightTitle;
		if ((item.previousRef === 'HEAD' || item.previousRef === '~') && item.ref === '') {
			rightTitle = localize('git.title.workingTree', '{0} (Working Tree)', basename);
		}
		else if (item.previousRef === 'HEAD' && item.ref === '~') {
			rightTitle = localize('git.title.index', '{0} (Index)', basename);
		} else {
			rightTitle = localize('git.title.ref', '{0} ({1})', basename, item.shortRef);
		}


		const title = localize('git.title.diff', '{0} ⟷ {1}', leftTitle, rightTitle);
		await commands.executeCommand('vscode.diff', selected.ref === '' ? uri : toGitUri(uri, selected.ref), item.ref === '' ? uri : toGitUri(uri, item.ref), title);
	}

	@command('git.rebaseAbort', { repository: true })
	async rebaseAbort(repository: Repository): Promise<void> {
		if (repository.rebaseCommit) {
			await repository.rebaseAbort();
		} else {
			await window.showInformationMessage(localize('no rebase', "No rebase in progress."));
		}
	}

	private createCommand(id: string, key: string, method: Function, options: ScmCommandOptions): (...args: any[]) => any {
		const result = (...args: any[]) => {
			let result: Promise<any>;

			if (!options.repository) {
				result = Promise.resolve(method.apply(this, args));
			} else {
				// try to guess the repository based on the first argument
				const repository = this.model.getRepository(args[0]);
				let repositoryPromise: Promise<Repository | undefined>;

				if (repository) {
					repositoryPromise = Promise.resolve(repository);
				} else if (this.model.repositories.length === 1) {
					repositoryPromise = Promise.resolve(this.model.repositories[0]);
				} else {
					repositoryPromise = this.model.pickRepository();
				}

				result = repositoryPromise.then(repository => {
					if (!repository) {
						return Promise.resolve();
					}

					return Promise.resolve(method.apply(this, [repository, ...args.slice(1)]));
				});
			}

			/* __GDPR__
				"git.command" : {
					"command" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryReporter.sendTelemetryEvent('git.command', { command: id });

			return result.catch(async err => {
				const options: MessageOptions = {
					modal: true
				};

				let message: string;
				let type: 'error' | 'warning' = 'error';

				const choices = new Map<string, () => void>();
				const openOutputChannelChoice = localize('open git log', "Open Git Log");
				const outputChannel = this.outputChannel as OutputChannel;
				choices.set(openOutputChannelChoice, () => outputChannel.show());

				const showCommandOutputChoice = localize('show command output', "Show Command Output");
				if (err.stderr) {
					choices.set(showCommandOutputChoice, async () => {
						const timestamp = new Date().getTime();
						const uri = Uri.parse(`git-output:/git-error-${timestamp}`);

						let command = 'git';

						if (err.gitArgs) {
							command = `${command} ${err.gitArgs.join(' ')}`;
						} else if (err.gitCommand) {
							command = `${command} ${err.gitCommand}`;
						}

						this.commandErrors.set(uri, `> ${command}\n${err.stderr}`);

						try {
							const doc = await workspace.openTextDocument(uri);
							await window.showTextDocument(doc);
						} finally {
							this.commandErrors.delete(uri);
						}
					});
				}

				switch (err.gitErrorCode) {
					case GitErrorCodes.DirtyWorkTree:
						message = localize('clean repo', "Please clean your repository working tree before checkout.");
						break;
					case GitErrorCodes.PushRejected:
						message = localize('cant push', "Can't push refs to remote. Try running 'Pull' first to integrate your changes.");
						break;
					case GitErrorCodes.Conflict:
						message = localize('merge conflicts', "There are merge conflicts. Resolve them before committing.");
						type = 'warning';
						options.modal = false;
						break;
					case GitErrorCodes.StashConflict:
						message = localize('stash merge conflicts', "There were merge conflicts while applying the stash.");
						type = 'warning';
						options.modal = false;
						break;
					case GitErrorCodes.AuthenticationFailed:
						const regex = /Authentication failed for '(.*)'/i;
						const match = regex.exec(err.stderr || String(err));

						message = match
							? localize('auth failed specific', "Failed to authenticate to git remote:\n\n{0}", match[1])
							: localize('auth failed', "Failed to authenticate to git remote.");
						break;
					case GitErrorCodes.NoUserNameConfigured:
					case GitErrorCodes.NoUserEmailConfigured:
						message = localize('missing user info', "Make sure you configure your 'user.name' and 'user.email' in git.");
						choices.set(localize('learn more', "Learn More"), () => commands.executeCommand('vscode.open', Uri.parse('https://git-scm.com/book/en/v2/Getting-Started-First-Time-Git-Setup')));
						break;
					default:
						const hint = (err.stderr || err.message || String(err))
							.replace(/^error: /mi, '')
							.replace(/^> husky.*$/mi, '')
							.split(/[\r\n]/)
							.filter((line: string) => !!line)
						[0];

						message = hint
							? localize('git error details', "Git: {0}", hint)
							: localize('git error', "Git error");

						break;
				}

				if (!message) {
					console.error(err);
					return;
				}

				const allChoices = Array.from(choices.keys());
				const result = type === 'error'
					? await window.showErrorMessage(message, options, ...allChoices)
					: await window.showWarningMessage(message, options, ...allChoices);

				if (result) {
					const resultFn = choices.get(result);

					if (resultFn) {
						resultFn();
					}
				}
			});
		};

		// patch this object, so people can call methods directly
		(this as any)[key] = result;

		return result;
	}

	private getSCMResource(uri?: Uri): Resource | undefined {
		uri = uri ? uri : (window.activeTextEditor && window.activeTextEditor.document.uri);

		this.outputChannel.appendLine(`git.getSCMResource.uri ${uri && uri.toString()}`);

		for (const r of this.model.repositories.map(r => r.root)) {
			this.outputChannel.appendLine(`repo root ${r}`);
		}

		if (!uri) {
			return undefined;
		}

		if (isGitUri(uri)) {
			const { path } = fromGitUri(uri);
			uri = Uri.file(path);
		}

		if (uri.scheme === 'file') {
			const uriString = uri.toString();
			const repository = this.model.getRepository(uri);

			if (!repository) {
				return undefined;
			}

			return repository.workingTreeGroup.resourceStates.filter(r => r.resourceUri.toString() === uriString)[0]
				|| repository.indexGroup.resourceStates.filter(r => r.resourceUri.toString() === uriString)[0];
		}
		return undefined;
	}

	private runByRepository<T>(resource: Uri, fn: (repository: Repository, resource: Uri) => Promise<T>): Promise<T[]>;
	private runByRepository<T>(resources: Uri[], fn: (repository: Repository, resources: Uri[]) => Promise<T>): Promise<T[]>;
	private async runByRepository<T>(arg: Uri | Uri[], fn: (repository: Repository, resources: any) => Promise<T>): Promise<T[]> {
		const resources = arg instanceof Uri ? [arg] : arg;
		const isSingleResource = arg instanceof Uri;

		const groups = resources.reduce((result, resource) => {
			let repository = this.model.getRepository(resource);

			if (!repository) {
				console.warn('Could not find git repository for ', resource);
				return result;
			}

			// Could it be a submodule?
			if (pathEquals(resource.fsPath, repository.root)) {
				repository = this.model.getRepositoryForSubmodule(resource) || repository;
			}

			const tuple = result.filter(p => p.repository === repository)[0];

			if (tuple) {
				tuple.resources.push(resource);
			} else {
				result.push({ repository, resources: [resource] });
			}

			return result;
		}, [] as { repository: Repository, resources: Uri[] }[]);

		const promises = groups
			.map(({ repository, resources }) => fn(repository as Repository, isSingleResource ? resources[0] : resources));

		return Promise.all(promises);
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}
