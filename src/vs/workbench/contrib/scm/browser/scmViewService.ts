/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ISCMViewService, ISCMRepository, ISCMService, ISCMViewVisibleRepositoryChangeEvent, ISCMMenus } from 'vs/workbench/contrib/scm/common/scm';
import { Iterable } from 'vs/base/common/iterator';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { SCMMenus } from 'vs/workbench/contrib/scm/browser/menus';

export class SCMViewService implements ISCMViewService {

	declare readonly _serviceBrand: undefined;

	readonly menus: ISCMMenus;

	private disposables = new DisposableStore();

	private _visibleRepositoriesSet = new Set<ISCMRepository>();
	private _visibleRepositories: ISCMRepository[] = [];

	get visibleRepositories(): ISCMRepository[] {
		return this._visibleRepositories;
	}

	set visibleRepositories(visibleRepositories: ISCMRepository[]) {
		const set = new Set(visibleRepositories);
		const added = new Set<ISCMRepository>();
		const removed = new Set<ISCMRepository>();

		for (const repository of visibleRepositories) {
			if (!this._visibleRepositoriesSet.has(repository)) {
				added.add(repository);
			}
		}

		for (const repository of this._visibleRepositories) {
			if (!set.has(repository)) {
				removed.add(repository);
			}
		}

		if (added.size === 0 && removed.size === 0) {
			return;
		}

		this._visibleRepositories = visibleRepositories;
		this._visibleRepositoriesSet = set;
		this._onDidSetVisibleRepositories.fire({ added, removed });
	}

	private _onDidChangeRepositories = new Emitter<ISCMViewVisibleRepositoryChangeEvent>();
	private _onDidSetVisibleRepositories = new Emitter<ISCMViewVisibleRepositoryChangeEvent>();
	readonly onDidChangeVisibleRepositories = Event.any(
		this._onDidSetVisibleRepositories.event,
		Event.debounce(
			this._onDidChangeRepositories.event,
			(last, e) => {
				if (!last) {
					return e;
				}

				return {
					added: Iterable.concat(last.added, e.added),
					removed: Iterable.concat(last.removed, e.removed),
				};
			}, 0)
	);

	constructor(
		@ISCMService private readonly scmService: ISCMService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		this.menus = instantiationService.createInstance(SCMMenus);

		scmService.onDidAddRepository(this.onDidAddRepository, this, this.disposables);
		scmService.onDidRemoveRepository(this.onDidRemoveRepository, this, this.disposables);

		for (const repository of scmService.repositories) {
			this.onDidAddRepository(repository);
		}
	}

	private onDidAddRepository(repository: ISCMRepository): void {
		this._visibleRepositories.push(repository);
		this._visibleRepositoriesSet.add(repository);

		this._onDidChangeRepositories.fire({ added: [repository], removed: Iterable.empty() });
	}

	private onDidRemoveRepository(repository: ISCMRepository): void {
		const index = this._visibleRepositories.indexOf(repository);

		if (index > -1) {
			let added: Iterable<ISCMRepository> = Iterable.empty();

			this._visibleRepositories.splice(index, 1);
			this._visibleRepositoriesSet.delete(repository);

			if (this._visibleRepositories.length === 0 && this.scmService.repositories.length > 0) {
				const first = this.scmService.repositories[0];

				this._visibleRepositories.push(first);
				this._visibleRepositoriesSet.add(first);
				added = [first];
			}

			this._onDidChangeRepositories.fire({ added, removed: [repository] });
		}
	}

	isVisible(repository: ISCMRepository): boolean {
		return this._visibleRepositoriesSet.has(repository);
	}

	toggleVisibility(repository: ISCMRepository, visible?: boolean): void {
		if (typeof visible === 'undefined') {
			visible = !this.isVisible(repository);
		} else if (this.isVisible(repository) === visible) {
			return;
		}

		if (visible) {
			this.visibleRepositories = [...this.visibleRepositories, repository];
		} else {
			const index = this.visibleRepositories.indexOf(repository);

			if (index > -1) {
				this.visibleRepositories = [
					...this.visibleRepositories.slice(0, index),
					...this.visibleRepositories.slice(index + 1)
				];
			}
		}
	}

	dispose(): void {
		this.disposables.dispose();
		this._onDidChangeRepositories.dispose();
		this._onDidSetVisibleRepositories.dispose();
	}
}
