/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { basename, relativePath } from 'vs/base/common/resources';
import { IDisposable, dispose, Disposable, DisposableStore, combinedDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { VIEWLET_ID, ISCMService, ISCMRepository } from 'vs/workbench/contrib/scm/common/scm';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IStatusbarService, StatusbarAlignment as MainThreadStatusBarAlignment } from 'vs/workbench/services/statusbar/common/statusbar';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

function getCount(repository: ISCMRepository): number {
	if (typeof repository.provider.count === 'number') {
		return repository.provider.count;
	} else {
		return repository.provider.groups.elements.reduce<number>((r, g) => r + g.elements.length, 0);
	}
}

export class SCMStatusController implements IWorkbenchContribution {

	private statusBarDisposable: IDisposable = Disposable.None;
	private focusDisposable: IDisposable = Disposable.None;
	private focusedRepository: ISCMRepository | undefined = undefined;
	private focusedProviderContextKey: IContextKey<string | undefined>;
	private readonly badgeDisposable = new MutableDisposable<IDisposable>();
	private disposables: IDisposable[] = [];

	constructor(
		@ISCMService private readonly scmService: ISCMService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IContextKeyService readonly contextKeyService: IContextKeyService,
		@IActivityService private readonly activityService: IActivityService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		this.focusedProviderContextKey = contextKeyService.createKey<string | undefined>('scmProvider', undefined);
		this.scmService.onDidAddRepository(this.onDidAddRepository, this, this.disposables);

		const onDidChangeSCMCountBadge = Event.filter(configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.countBadge'));
		onDidChangeSCMCountBadge(this.renderActivityCount, this, this.disposables);

		for (const repository of this.scmService.repositories) {
			this.onDidAddRepository(repository);
		}

		editorService.onDidActiveEditorChange(this.tryFocusRepositoryBasedOnActiveEditor, this, this.disposables);
		this.renderActivityCount();
	}

	private tryFocusRepositoryBasedOnActiveEditor(): boolean {
		if (!this.editorService.activeEditor) {
			return false;
		}

		const resource = this.editorService.activeEditor.resource;

		if (!resource) {
			return false;
		}

		let bestRepository: ISCMRepository | null = null;
		let bestMatchLength = Number.POSITIVE_INFINITY;

		for (const repository of this.scmService.repositories) {
			const root = repository.provider.rootUri;

			if (!root) {
				continue;
			}

			const path = relativePath(root, resource);

			if (path && !/^\.\./.test(path) && path.length < bestMatchLength) {
				bestRepository = repository;
				bestMatchLength = path.length;
			}
		}

		if (!bestRepository) {
			return false;
		}

		this.focusRepository(bestRepository);
		return true;
	}

	private onDidAddRepository(repository: ISCMRepository): void {
		const focusDisposable = repository.onDidFocus(() => this.focusRepository(repository));

		const onDidChange = Event.any(repository.provider.onDidChange, repository.provider.onDidChangeResources);
		const changeDisposable = onDidChange(() => this.renderActivityCount());

		const onDidRemove = Event.filter(this.scmService.onDidRemoveRepository, e => e === repository);
		const removeDisposable = onDidRemove(() => {
			disposable.dispose();
			this.disposables = this.disposables.filter(d => d !== removeDisposable);

			if (this.scmService.repositories.length === 0) {
				this.focusRepository(undefined);
			} else if (this.focusedRepository === repository) {
				this.scmService.repositories[0].focus();
			}

			this.renderActivityCount();
		});

		const disposable = combinedDisposable(focusDisposable, changeDisposable, removeDisposable);
		this.disposables.push(disposable);

		if (this.focusedRepository) {
			return;
		}

		if (this.tryFocusRepositoryBasedOnActiveEditor()) {
			return;
		}

		this.focusRepository(repository);
	}

	private focusRepository(repository: ISCMRepository | undefined): void {
		if (this.focusedRepository === repository) {
			return;
		}

		this.focusedRepository = repository;
		this.focusedProviderContextKey.set(repository && repository.provider.id);
		this.focusDisposable.dispose();

		if (repository && repository.provider.onDidChangeStatusBarCommands) {
			this.focusDisposable = repository.provider.onDidChangeStatusBarCommands(() => this.renderStatusBar(repository));
		}

		this.renderStatusBar(repository);
		this.renderActivityCount();
	}

	private renderStatusBar(repository: ISCMRepository | undefined): void {
		this.statusBarDisposable.dispose();

		if (!repository) {
			return;
		}

		const commands = repository.provider.statusBarCommands || [];
		const label = repository.provider.rootUri
			? `${basename(repository.provider.rootUri)} (${repository.provider.label})`
			: repository.provider.label;

		const disposables = new DisposableStore();
		for (const c of commands) {
			const tooltip = `${label} - ${c.tooltip}`;

			disposables.add(this.statusbarService.addEntry({
				text: c.title,
				ariaLabel: c.tooltip || label,
				tooltip,
				command: c
			}, 'status.scm', localize('status.scm', "Source Control"), MainThreadStatusBarAlignment.LEFT, 10000));
		}

		this.statusBarDisposable = disposables;
	}

	private renderActivityCount(): void {
		this.badgeDisposable.clear();

		const countBadgeType = this.configurationService.getValue<'all' | 'focused' | 'off'>('scm.countBadge');

		let count = 0;

		if (countBadgeType === 'all') {
			count = this.scmService.repositories.reduce((r, repository) => r + getCount(repository), 0);
		} else if (countBadgeType === 'focused' && this.focusedRepository) {
			count = getCount(this.focusedRepository);
		}

		if (count > 0) {
			const badge = new NumberBadge(count, num => localize('scmPendingChangesBadge', '{0} pending changes', num));
			this.badgeDisposable.value = this.activityService.showViewContainerActivity(VIEWLET_ID, { badge, clazz: 'scm-viewlet-label' });
		} else {
			this.badgeDisposable.clear();
		}
	}

	dispose(): void {
		this.focusDisposable.dispose();
		this.statusBarDisposable.dispose();
		this.badgeDisposable.dispose();
		this.disposables = dispose(this.disposables);
	}
}
