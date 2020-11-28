/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vscode-nls';
import { CancellationToken, ConfigurationChangeEvent, Disposable, env, Event, EventEmitter, ThemeIcon, Timeline, TimelineChangeEvent, TimelineItem, TimelineOptions, TimelineProvider, Uri, workspace } from 'vscode';
import { Model } from './model';
import { Repository, Resource } from './repository';
import { debounce } from './decorators';
import { emojify, ensureEmojis } from './emoji';

const localize = nls.loadMessageBundle();

export class GitTimelineItem extends TimelineItem {
	static is(item: TimelineItem): item is GitTimelineItem {
		return item instanceof GitTimelineItem;
	}

	readonly ref: string;
	readonly previousRef: string;
	readonly message: string;

	constructor(
		ref: string,
		previousRef: string,
		message: string,
		timestamp: number,
		id: string,
		contextValue: string
	) {
		const index = message.indexOf('\n');
		const label = index !== -1 ? `${message.substring(0, index)} \u2026` : message;

		super(label, timestamp);

		this.ref = ref;
		this.previousRef = previousRef;
		this.message = message;
		this.id = id;
		this.contextValue = contextValue;
	}

	get shortRef() {
		return this.shortenRef(this.ref);
	}

	get shortPreviousRef() {
		return this.shortenRef(this.previousRef);
	}

	private shortenRef(ref: string): string {
		if (ref === '' || ref === '~' || ref === 'HEAD') {
			return ref;
		}
		return ref.endsWith('^') ? `${ref.substr(0, 8)}^` : ref.substr(0, 8);
	}
}

export class GitTimelineProvider implements TimelineProvider {
	private _onDidChange = new EventEmitter<TimelineChangeEvent>();
	get onDidChange(): Event<TimelineChangeEvent> {
		return this._onDidChange.event;
	}

	readonly id = 'git-history';
	readonly label = localize('git.timeline.source', 'Git History');

	private readonly disposable: Disposable;
	private providerDisposable: Disposable | undefined;

	private repo: Repository | undefined;
	private repoDisposable: Disposable | undefined;
	private repoStatusDate: Date | undefined;

	constructor(private readonly model: Model) {
		this.disposable = Disposable.from(
			model.onDidOpenRepository(this.onRepositoriesChanged, this),
			workspace.onDidChangeConfiguration(this.onConfigurationChanged, this)
		);

		if (model.repositories.length) {
			this.ensureProviderRegistration();
		}
	}

	dispose() {
		this.providerDisposable?.dispose();
		this.disposable.dispose();
	}

	async provideTimeline(uri: Uri, options: TimelineOptions, _token: CancellationToken): Promise<Timeline> {
		// console.log(`GitTimelineProvider.provideTimeline: uri=${uri} state=${this._model.state}`);

		const repo = this.model.getRepository(uri);
		if (!repo) {
			this.repoDisposable?.dispose();
			this.repoStatusDate = undefined;
			this.repo = undefined;

			return { items: [] };
		}

		if (this.repo?.root !== repo.root) {
			this.repoDisposable?.dispose();

			this.repo = repo;
			this.repoStatusDate = new Date();
			this.repoDisposable = Disposable.from(
				repo.onDidChangeRepository(uri => this.onRepositoryChanged(repo, uri)),
				repo.onDidRunGitStatus(() => this.onRepositoryStatusChanged(repo))
			);
		}

		const config = workspace.getConfiguration('git.timeline');

		// TODO@eamodio: Ensure that the uri is a file -- if not we could get the history of the repo?

		let limit: number | undefined;
		if (options.limit !== undefined && typeof options.limit !== 'number') {
			try {
				const result = await this.model.git.exec(repo.root, ['rev-list', '--count', `${options.limit.id}..`, '--', uri.fsPath]);
				if (!result.exitCode) {
					// Ask for 2 more (1 for the limit commit and 1 for the next commit) than so we can determine if there are more commits
					limit = Number(result.stdout) + 2;
				}
			}
			catch {
				limit = undefined;
			}
		} else {
			// If we are not getting everything, ask for 1 more than so we can determine if there are more commits
			limit = options.limit === undefined ? undefined : options.limit + 1;
		}

		await ensureEmojis();

		const commits = await repo.logFile(uri, {
			maxEntries: limit,
			hash: options.cursor,
			// sortByAuthorDate: true
		});

		const paging = commits.length ? {
			cursor: limit === undefined ? undefined : (commits.length >= limit ? commits[commits.length - 1]?.hash : undefined)
		} : undefined;

		// If we asked for an extra commit, strip it off
		if (limit !== undefined && commits.length >= limit) {
			commits.splice(commits.length - 1, 1);
		}

		const dateFormatter = new Intl.DateTimeFormat(env.language, { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric' });

		const dateType = config.get<'committed' | 'authored'>('date');
		const showAuthor = config.get<boolean>('showAuthor');

		const items = commits.map<GitTimelineItem>((c, i) => {
			const date = dateType === 'authored' ? c.authorDate : c.commitDate;

			const message = emojify(c.message);

			const item = new GitTimelineItem(c.hash, commits[i + 1]?.hash ?? `${c.hash}^`, message, date?.getTime() ?? 0, c.hash, 'git:file:commit');
			item.iconPath = new (ThemeIcon as any)('git-commit');
			if (showAuthor) {
				item.description = c.authorName;
			}
			item.detail = `${c.authorName} (${c.authorEmail}) — ${c.hash.substr(0, 8)}\n${dateFormatter.format(date)}\n\n${message}`;
			item.command = {
				title: 'Open Comparison',
				command: 'git.timeline.openDiff',
				arguments: [item, uri, this.id]
			};

			return item;
		});

		if (options.cursor === undefined) {
			const you = localize('git.timeline.you', 'You');

			const index = repo.indexGroup.resourceStates.find(r => r.resourceUri.fsPath === uri.fsPath);
			if (index) {
				const date = this.repoStatusDate ?? new Date();

				const item = new GitTimelineItem('~', 'HEAD', localize('git.timeline.stagedChanges', 'Staged Changes'), date.getTime(), 'index', 'git:file:index');
				// TODO@eamodio: Replace with a better icon -- reflecting its status maybe?
				item.iconPath = new (ThemeIcon as any)('git-commit');
				item.description = '';
				item.detail = localize('git.timeline.detail', '{0}  — {1}\n{2}\n\n{3}', you, localize('git.index', 'Index'), dateFormatter.format(date), Resource.getStatusText(index.type));
				item.command = {
					title: 'Open Comparison',
					command: 'git.timeline.openDiff',
					arguments: [item, uri, this.id]
				};

				items.splice(0, 0, item);
			}

			const working = repo.workingTreeGroup.resourceStates.find(r => r.resourceUri.fsPath === uri.fsPath);
			if (working) {
				const date = new Date();

				const item = new GitTimelineItem('', index ? '~' : 'HEAD', localize('git.timeline.uncommitedChanges', 'Uncommitted Changes'), date.getTime(), 'working', 'git:file:working');
				// TODO@eamodio: Replace with a better icon -- reflecting its status maybe?
				item.iconPath = new (ThemeIcon as any)('git-commit');
				item.description = '';
				item.detail = localize('git.timeline.detail', '{0}  — {1}\n{2}\n\n{3}', you, localize('git.workingTree', 'Working Tree'), dateFormatter.format(date), Resource.getStatusText(working.type));
				item.command = {
					title: 'Open Comparison',
					command: 'git.timeline.openDiff',
					arguments: [item, uri, this.id]
				};

				items.splice(0, 0, item);
			}
		}

		return {
			items: items,
			paging: paging
		};
	}

	private ensureProviderRegistration() {
		if (this.providerDisposable === undefined) {
			this.providerDisposable = workspace.registerTimelineProvider(['file', 'git', 'vscode-remote', 'gitlens-git'], this);
		}
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (e.affectsConfiguration('git.timeline.date') || e.affectsConfiguration('git.timeline.showAuthor')) {
			this.fireChanged();
		}
	}

	private onRepositoriesChanged(_repo: Repository) {
		// console.log(`GitTimelineProvider.onRepositoriesChanged`);

		this.ensureProviderRegistration();

		// TODO@eamodio: Being naive for now and just always refreshing each time there is a new repository
		this.fireChanged();
	}

	private onRepositoryChanged(_repo: Repository, _uri: Uri) {
		// console.log(`GitTimelineProvider.onRepositoryChanged: uri=${uri.toString(true)}`);

		this.fireChanged();
	}

	private onRepositoryStatusChanged(_repo: Repository) {
		// console.log(`GitTimelineProvider.onRepositoryStatusChanged`);

		// This is less than ideal, but for now just save the last time a status was run and use that as the timestamp for staged items
		this.repoStatusDate = new Date();

		this.fireChanged();
	}

	@debounce(500)
	private fireChanged() {
		this._onDidChange.fire(undefined);
	}
}
