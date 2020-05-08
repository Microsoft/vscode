/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/scmViewlet';
import { localize } from 'vs/nls';
import { Event, Emitter } from 'vs/base/common/event';
import { basename } from 'vs/base/common/resources';
import { IDisposable, dispose, Disposable, DisposableStore, combinedDisposable } from 'vs/base/common/lifecycle';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { append, $, toggleClass } from 'vs/base/browser/dom';
import { IListVirtualDelegate, IListRenderer, IListContextMenuEvent, IListEvent } from 'vs/base/browser/ui/list/list';
import { ISCMRepository } from 'vs/workbench/contrib/scm/common/scm';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IAction, Action } from 'vs/base/common/actions';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { ActionBar, ActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachBadgeStyler } from 'vs/platform/theme/common/styler';
import { Command } from 'vs/editor/common/modes';
import { renderCodicons, Codicon } from 'vs/base/common/codicons';
import { escape } from 'vs/base/common/strings';
import { WorkbenchList } from 'vs/platform/list/browser/listService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IViewDescriptor, IViewDescriptorService } from 'vs/workbench/common/views';
import { SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';

export interface ISpliceEvent<T> {
	index: number;
	deleteCount: number;
	elements: T[];
}

export interface IViewModel {
	readonly repositories: ISCMRepository[];
	readonly onDidSplice: Event<ISpliceEvent<ISCMRepository>>;

	readonly visibleRepositories: ISCMRepository[];
	readonly onDidChangeVisibleRepositories: Event<ISCMRepository[]>;
	setVisibleRepositories(repositories: ISCMRepository[]): void;

	isVisible(): boolean;
	readonly onDidChangeVisibility: Event<boolean>;
}

class ProvidersListDelegate implements IListVirtualDelegate<ISCMRepository> {

	getHeight(): number {
		return 22;
	}

	getTemplateId(): string {
		return 'provider';
	}
}

class StatusBarAction extends Action {

	constructor(
		private command: Command,
		private commandService: ICommandService
	) {
		super(`statusbaraction{${command.id}}`, command.title, '', true);
		this.tooltip = command.tooltip || '';
	}

	run(): Promise<void> {
		return this.commandService.executeCommand(this.command.id, ...(this.command.arguments || []));
	}
}

class StatusBarActionViewItem extends ActionViewItem {

	constructor(action: StatusBarAction) {
		super(null, action, {});
	}

	updateLabel(): void {
		if (this.options.label && this.label) {
			this.label.innerHTML = renderCodicons(escape(this.getAction().label));
		}
	}
}

interface RepositoryTemplateData {
	title: HTMLElement;
	type: HTMLElement;
	countContainer: HTMLElement;
	count: CountBadge;
	actionBar: ActionBar;
	disposable: IDisposable;
	templateDisposable: IDisposable;
}

class ProviderRenderer implements IListRenderer<ISCMRepository, RepositoryTemplateData> {

	readonly templateId = 'provider';

	private readonly _onDidRenderElement = new Emitter<ISCMRepository>();
	readonly onDidRenderElement = this._onDidRenderElement.event;

	constructor(
		@ICommandService protected commandService: ICommandService,
		@IThemeService protected themeService: IThemeService
	) { }

	renderTemplate(container: HTMLElement): RepositoryTemplateData {
		const provider = append(container, $('.scm-provider'));
		const name = append(provider, $('.name'));
		const title = append(name, $('span.title'));
		const type = append(name, $('span.type'));
		const countContainer = append(provider, $('.count'));
		const count = new CountBadge(countContainer);
		const badgeStyler = attachBadgeStyler(count, this.themeService);
		const actionBar = new ActionBar(provider, { actionViewItemProvider: a => new StatusBarActionViewItem(a as StatusBarAction) });
		const disposable = Disposable.None;
		const templateDisposable = combinedDisposable(actionBar, badgeStyler);

		return { title, type, countContainer, count, actionBar, disposable, templateDisposable };
	}

	renderElement(repository: ISCMRepository, index: number, templateData: RepositoryTemplateData): void {
		templateData.disposable.dispose();
		const disposables = new DisposableStore();

		if (repository.provider.rootUri) {
			templateData.title.textContent = basename(repository.provider.rootUri);
			templateData.type.textContent = repository.provider.label;
		} else {
			templateData.title.textContent = repository.provider.label;
			templateData.type.textContent = '';
		}

		const actions: IAction[] = [];
		const disposeActions = () => dispose(actions);
		disposables.add({ dispose: disposeActions });

		const update = () => {
			disposeActions();

			const commands = repository.provider.statusBarCommands || [];
			actions.splice(0, actions.length, ...commands.map(c => new StatusBarAction(c, this.commandService)));
			templateData.actionBar.clear();
			templateData.actionBar.push(actions);

			const count = repository.provider.count || 0;
			toggleClass(templateData.countContainer, 'hidden', count === 0);
			templateData.count.setCount(count);

			this._onDidRenderElement.fire(repository);
		};

		disposables.add(repository.provider.onDidChange(update, null));
		update();

		templateData.disposable = disposables;
	}

	disposeTemplate(templateData: RepositoryTemplateData): void {
		templateData.disposable.dispose();
		templateData.templateDisposable.dispose();
	}
}

export class MainPane extends ViewPane {

	static readonly ID = 'scm.mainPane';
	static readonly TITLE = localize('scm providers', "Source Control Providers");

	private list!: WorkbenchList<ISCMRepository>;

	constructor(
		protected viewModel: IViewModel,
		options: IViewPaneOptions,
		@IKeybindingService protected keybindingService: IKeybindingService,
		@IContextMenuService protected contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IMenuService private readonly menuService: IMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
	}

	protected renderBody(container: HTMLElement): void {
		super.renderBody(container);

		const delegate = new ProvidersListDelegate();
		const renderer = this.instantiationService.createInstance(ProviderRenderer);
		const identityProvider = { getId: (r: ISCMRepository) => r.provider.id };

		this.list = this.instantiationService.createInstance(WorkbenchList, `SCM Main`, container, delegate, [renderer], {
			identityProvider,
			horizontalScrolling: false,
			overrideStyles: {
				listBackground: SIDE_BAR_BACKGROUND
			},
			accessibilityProvider: {
				getAriaLabel(r: ISCMRepository) {
					return r.provider.label;
				},
				getWidgetAriaLabel() {
					return MainPane.TITLE;
				}
			}
		}) as WorkbenchList<ISCMRepository>;

		this._register(renderer.onDidRenderElement(e => this.list.updateWidth(this.viewModel.repositories.indexOf(e)), null));
		this._register(this.list.onDidChangeSelection(this.onListSelectionChange, this));
		this._register(this.list.onDidChangeFocus(this.onListFocusChange, this));
		this._register(this.list.onContextMenu(this.onListContextMenu, this));

		this._register(this.viewModel.onDidChangeVisibleRepositories(this.updateListSelection, this));

		this._register(this.viewModel.onDidSplice(({ index, deleteCount, elements }) => this.splice(index, deleteCount, elements), null));
		this.splice(0, 0, this.viewModel.repositories);

		this._register(this.list);

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('scm.providers.visible')) {
				this.updateBodySize();
			}
		}));

		this.updateListSelection();
	}

	private splice(index: number, deleteCount: number, repositories: ISCMRepository[] = []): void {
		this.list.splice(index, deleteCount, repositories);

		const empty = this.list.length === 0;
		toggleClass(this.element, 'empty', empty);

		this.updateBodySize();
	}

	focus(): void {
		this.list.domFocus();
	}

	protected layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.list.layout(height, width);
	}

	private updateBodySize(): void {
		const visibleCount = this.configurationService.getValue<number>('scm.providers.visible');
		const empty = this.list.length === 0;
		const size = Math.min(this.viewModel.repositories.length, visibleCount) * 22;

		this.minimumBodySize = visibleCount === 0 ? 22 : size;
		this.maximumBodySize = visibleCount === 0 ? Number.POSITIVE_INFINITY : empty ? Number.POSITIVE_INFINITY : size;
	}

	private onListContextMenu(e: IListContextMenuEvent<ISCMRepository>): void {
		if (!e.element) {
			return;
		}

		const repository = e.element;
		const contextKeyService = this.contextKeyService.createScoped();
		const scmProviderKey = contextKeyService.createKey<string | undefined>('scmProvider', undefined);
		scmProviderKey.set(repository.provider.contextValue);

		const menu = this.menuService.createMenu(MenuId.SCMSourceControl, contextKeyService);
		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };

		const disposable = createAndFillInContextMenuActions(menu, { shouldForwardArgs: true }, result, this.contextMenuService, g => g === 'inline');

		menu.dispose();
		contextKeyService.dispose();

		if (secondary.length === 0) {
			return;
		}

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor,
			getActions: () => secondary,
			getActionsContext: () => repository.provider
		});

		disposable.dispose();
	}

	private onListSelectionChange(e: IListEvent<ISCMRepository>): void {
		if (e.browserEvent && e.elements.length > 0) {
			const scrollTop = this.list.scrollTop;
			this.viewModel.setVisibleRepositories(e.elements);
			this.list.scrollTop = scrollTop;
		}
	}

	private onListFocusChange(e: IListEvent<ISCMRepository>): void {
		if (e.browserEvent && e.elements.length > 0) {
			e.elements[0].focus();
		}
	}

	private updateListSelection(): void {
		const set = new Set();

		for (const repository of this.viewModel.visibleRepositories) {
			set.add(repository);
		}

		const selection: number[] = [];

		for (let i = 0; i < this.list.length; i++) {
			if (set.has(this.list.element(i))) {
				selection.push(i);
			}
		}

		this.list.setSelection(selection);

		if (selection.length > 0) {
			this.list.setFocus([selection[0]]);
		}
	}
}

export class MainPaneDescriptor implements IViewDescriptor {

	readonly id = MainPane.ID;
	readonly name = MainPane.TITLE;
	readonly containerIcon = Codicon.sourceControl.classNames;
	readonly ctorDescriptor: SyncDescriptor<MainPane>;
	readonly canToggleVisibility = true;
	readonly hideByDefault = false;
	readonly order = -1000;
	readonly workspace = true;
	readonly when = ContextKeyExpr.or(ContextKeyExpr.equals('config.scm.alwaysShowProviders', true), ContextKeyExpr.and(ContextKeyExpr.notEquals('scm.providerCount', 0), ContextKeyExpr.notEquals('scm.providerCount', 1)));

	constructor(viewModel: IViewModel) {
		this.ctorDescriptor = new SyncDescriptor(MainPane, [viewModel]);
	}
}
