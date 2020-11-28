/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { window, workspace, Uri, Disposable, Event, EventEmitter, FileDecoration, FileDecorationProvider, ThemeColor } from 'vscode';
import * as path from 'path';
import { Repository, GitResourceGroup } from './repository';
import { Model } from './model';
import { debounce } from './decorators';
import { filterEvent, dispose, anyEvent, fireEvent, PromiseSource } from './util';
import { GitErrorCodes, Status } from './api/git';

class GitIgnoreDecorationProvider implements FileDecorationProvider {

	private static Decoration: FileDecoration = { color: new ThemeColor('gitDecoration.ignoredResourceForeground') };

	readonly onDidChangeFileDecorations: Event<Uri[]>;
	private queue = new Map<string, { repository: Repository; queue: Map<string, PromiseSource<FileDecoration | undefined>>; }>();
	private disposables: Disposable[] = [];

	constructor(private model: Model) {
		this.onDidChangeFileDecorations = fireEvent(anyEvent<any>(
			filterEvent(workspace.onDidSaveTextDocument, e => /\.gitignore$|\.git\/info\/exclude$/.test(e.uri.path)),
			model.onDidOpenRepository,
			model.onDidCloseRepository
		));

		this.disposables.push(window.registerFileDecorationProvider(this));
	}

	async provideFileDecoration(uri: Uri): Promise<FileDecoration | undefined> {
		const repository = this.model.getRepository(uri);

		if (!repository) {
			return;
		}

		let queueItem = this.queue.get(repository.root);

		if (!queueItem) {
			queueItem = { repository, queue: new Map<string, PromiseSource<FileDecoration | undefined>>() };
			this.queue.set(repository.root, queueItem);
		}

		let promiseSource = queueItem.queue.get(uri.fsPath);

		if (!promiseSource) {
			promiseSource = new PromiseSource();
			queueItem!.queue.set(uri.fsPath, promiseSource);
			this.checkIgnoreSoon();
		}

		return await promiseSource.promise;
	}

	@debounce(500)
	private checkIgnoreSoon(): void {
		const queue = new Map(this.queue.entries());
		this.queue.clear();

		for (const [, item] of queue) {
			const paths = [...item.queue.keys()];

			item.repository.checkIgnore(paths).then(ignoreSet => {
				for (const [path, promiseSource] of item.queue.entries()) {
					promiseSource.resolve(ignoreSet.has(path) ? GitIgnoreDecorationProvider.Decoration : undefined);
				}
			}, err => {
				if (err.gitErrorCode !== GitErrorCodes.IsInSubmodule) {
					console.error(err);
				}

				for (const [, promiseSource] of item.queue.entries()) {
					promiseSource.reject(err);
				}
			});
		}
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
		this.queue.clear();
	}
}

class GitDecorationProvider implements FileDecorationProvider {

	private static SubmoduleDecorationData: FileDecoration = {
		tooltip: 'Submodule',
		badge: 'S',
		color: new ThemeColor('gitDecoration.submoduleResourceForeground')
	};

	private readonly _onDidChangeDecorations = new EventEmitter<Uri[]>();
	readonly onDidChangeFileDecorations: Event<Uri[]> = this._onDidChangeDecorations.event;

	private disposables: Disposable[] = [];
	private decorations = new Map<string, FileDecoration>();

	constructor(private repository: Repository) {
		this.disposables.push(
			window.registerFileDecorationProvider(this),
			repository.onDidRunGitStatus(this.onDidRunGitStatus, this)
		);
	}

	private onDidRunGitStatus(): void {
		let newDecorations = new Map<string, FileDecoration>();

		this.collectSubmoduleDecorationData(newDecorations);
		this.collectDecorationData(this.repository.indexGroup, newDecorations);
		this.collectDecorationData(this.repository.untrackedGroup, newDecorations);
		this.collectDecorationData(this.repository.workingTreeGroup, newDecorations);
		this.collectDecorationData(this.repository.mergeGroup, newDecorations);

		const uris = new Set([...this.decorations.keys()].concat([...newDecorations.keys()]));
		this.decorations = newDecorations;
		this._onDidChangeDecorations.fire([...uris.values()].map(value => Uri.parse(value, true)));
	}

	private collectDecorationData(group: GitResourceGroup, bucket: Map<string, FileDecoration>): void {
		for (const r of group.resourceStates) {
			const decoration = r.resourceDecoration;

			if (decoration) {
				// not deleted and has a decoration
				bucket.set(r.original.toString(), decoration);

				if (r.type === Status.INDEX_RENAMED) {
					bucket.set(r.resourceUri.toString(), decoration);
				}
			}
		}
	}

	private collectSubmoduleDecorationData(bucket: Map<string, FileDecoration>): void {
		for (const submodule of this.repository.submodules) {
			bucket.set(Uri.file(path.join(this.repository.root, submodule.path)).toString(), GitDecorationProvider.SubmoduleDecorationData);
		}
	}

	provideFileDecoration(uri: Uri): FileDecoration | undefined {
		return this.decorations.get(uri.toString());
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}
}


export class GitDecorations {

	private disposables: Disposable[] = [];
	private modelDisposables: Disposable[] = [];
	private providers = new Map<Repository, Disposable>();

	constructor(private model: Model) {
		this.disposables.push(new GitIgnoreDecorationProvider(model));

		const onEnablementChange = filterEvent(workspace.onDidChangeConfiguration, e => e.affectsConfiguration('git.decorations.enabled'));
		onEnablementChange(this.update, this, this.disposables);
		this.update();
	}

	private update(): void {
		const enabled = workspace.getConfiguration('git').get('decorations.enabled');

		if (enabled) {
			this.enable();
		} else {
			this.disable();
		}
	}

	private enable(): void {
		this.model.onDidOpenRepository(this.onDidOpenRepository, this, this.modelDisposables);
		this.model.onDidCloseRepository(this.onDidCloseRepository, this, this.modelDisposables);
		this.model.repositories.forEach(this.onDidOpenRepository, this);
	}

	private disable(): void {
		this.modelDisposables = dispose(this.modelDisposables);
		this.providers.forEach(value => value.dispose());
		this.providers.clear();
	}

	private onDidOpenRepository(repository: Repository): void {
		const provider = new GitDecorationProvider(repository);
		this.providers.set(repository, provider);
	}

	private onDidCloseRepository(repository: Repository): void {
		const provider = this.providers.get(repository);

		if (provider) {
			provider.dispose();
			this.providers.delete(repository);
		}
	}

	dispose(): void {
		this.disable();
		this.disposables = dispose(this.disposables);
	}
}
