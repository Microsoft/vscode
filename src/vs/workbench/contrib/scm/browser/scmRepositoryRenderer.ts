/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/scm';
import { IDisposable, Disposable, DisposableStore, combinedDisposable } from 'vs/base/common/lifecycle';
import { append, $ } from 'vs/base/browser/dom';
import { ISCMRepository, ISCMViewService } from 'vs/workbench/contrib/scm/common/scm';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IAction, IActionViewItemProvider } from 'vs/base/common/actions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { connectPrimaryMenu, isSCMRepository, StatusBarAction } from './util';
import { attachBadgeStyler } from 'vs/platform/theme/common/styler';
import { ITreeNode } from 'vs/base/browser/ui/tree/tree';
import { ICompressibleTreeRenderer } from 'vs/base/browser/ui/tree/objectTree';
import { FuzzyScore } from 'vs/base/common/filters';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { IListRenderer } from 'vs/base/browser/ui/list/list';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { basename } from 'vs/base/common/resources';

interface RepositoryTemplate {
	readonly label: HTMLElement;
	readonly name: HTMLElement;
	readonly description: HTMLElement;
	readonly countContainer: HTMLElement;
	readonly count: CountBadge;
	readonly toolBar: ToolBar;
	disposable: IDisposable;
	readonly templateDisposable: IDisposable;
}

export class RepositoryRenderer implements ICompressibleTreeRenderer<ISCMRepository, FuzzyScore, RepositoryTemplate>, IListRenderer<ISCMRepository, RepositoryTemplate> {

	static readonly TEMPLATE_ID = 'repository';
	get templateId(): string { return RepositoryRenderer.TEMPLATE_ID; }

	constructor(
		private actionViewItemProvider: IActionViewItemProvider,
		@ISCMViewService private scmViewService: ISCMViewService,
		@ICommandService private commandService: ICommandService,
		@IContextMenuService private contextMenuService: IContextMenuService,
		@IThemeService private themeService: IThemeService,
		@IWorkspaceContextService private workspaceContextService: IWorkspaceContextService,
	) { }

	renderTemplate(container: HTMLElement): RepositoryTemplate {
		// hack
		if (container.classList.contains('monaco-tl-contents')) {
			(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-twistie');
		}

		const provider = append(container, $('.scm-provider'));
		const label = append(provider, $('.label'));
		const name = append(label, $('span.name'));
		const description = append(label, $('span.description'));
		const actions = append(provider, $('.actions'));
		const toolBar = new ToolBar(actions, this.contextMenuService, { actionViewItemProvider: this.actionViewItemProvider });
		const countContainer = append(provider, $('.count'));
		const count = new CountBadge(countContainer);
		const badgeStyler = attachBadgeStyler(count, this.themeService);
		const visibilityDisposable = toolBar.onDidChangeDropdownVisibility(e => provider.classList.toggle('active', e));

		const disposable = Disposable.None;
		const templateDisposable = combinedDisposable(visibilityDisposable, toolBar, badgeStyler);

		return { label, name, description, countContainer, count, toolBar, disposable, templateDisposable };
	}

	renderElement(arg: ISCMRepository | ITreeNode<ISCMRepository, FuzzyScore>, index: number, templateData: RepositoryTemplate, height: number | undefined): void {
		templateData.disposable.dispose();

		const disposables = new DisposableStore();
		const repository = isSCMRepository(arg) ? arg : arg.element;

		if (repository.provider.rootUri) {
			const folder = this.workspaceContextService.getWorkspaceFolder(repository.provider.rootUri);

			if (folder?.uri.toString() === repository.provider.rootUri.toString()) {
				templateData.name.textContent = folder.name;
			} else {
				templateData.name.textContent = basename(repository.provider.rootUri);
			}

			templateData.label.title = `${repository.provider.label}: ${repository.provider.rootUri.fsPath}`;
			templateData.description.textContent = repository.provider.label;
		} else {
			templateData.label.title = repository.provider.label;
			templateData.name.textContent = repository.provider.label;
			templateData.description.textContent = '';
		}

		let statusPrimaryActions: IAction[] = [];
		let menuPrimaryActions: IAction[] = [];
		let menuSecondaryActions: IAction[] = [];
		const updateToolbar = () => {
			templateData.toolBar.setActions([...statusPrimaryActions, ...menuPrimaryActions], menuSecondaryActions);
		};

		const onDidChangeProvider = () => {
			const commands = repository.provider.statusBarCommands || [];
			statusPrimaryActions = commands.map(c => new StatusBarAction(c, this.commandService));
			updateToolbar();

			const count = repository.provider.count || 0;
			templateData.countContainer.setAttribute('data-count', String(count));
			templateData.count.setCount(count);
		};
		disposables.add(repository.provider.onDidChange(onDidChangeProvider, null));
		onDidChangeProvider();

		const menus = this.scmViewService.menus.getRepositoryMenus(repository.provider);
		disposables.add(connectPrimaryMenu(menus.titleMenu.menu, (primary, secondary) => {
			menuPrimaryActions = primary;
			menuSecondaryActions = secondary;
			updateToolbar();
		}));
		templateData.toolBar.context = repository.provider;

		templateData.disposable = disposables;
	}

	renderCompressedElements(): void {
		throw new Error('Should never happen since node is incompressible');
	}

	disposeElement(group: ISCMRepository | ITreeNode<ISCMRepository, FuzzyScore>, index: number, template: RepositoryTemplate): void {
		template.disposable.dispose();
	}

	disposeTemplate(templateData: RepositoryTemplate): void {
		templateData.disposable.dispose();
		templateData.templateDisposable.dispose();
	}
}
