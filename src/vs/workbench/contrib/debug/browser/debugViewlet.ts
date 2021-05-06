/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/debugViewlet';
import * as nls from 'vs/nls';
import { IAction } from 'vs/base/common/actions';
import { IDebugService, VIEWLET_ID, State, BREAKPOINTS_VIEW_ID, CONTEXT_DEBUG_UX, CONTEXT_DEBUG_UX_KEY, REPL_VIEW_ID, CONTEXT_DEBUG_STATE, ILaunch, getStateLabel, CONTEXT_DEBUGGERS_AVAILABLE } from 'vs/workbench/contrib/debug/common/debug';
import { StartDebugActionViewItem, FocusSessionActionViewItem } from 'vs/workbench/contrib/debug/browser/debugActionViewItems';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IProgressService } from 'vs/platform/progress/common/progress';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPaneContainer, ViewsSubMenu } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { MenuId, registerAction2, Action2, MenuRegistry } from 'vs/platform/actions/common/actions';
import { IContextKeyService, ContextKeyEqualsExpr, ContextKeyExpr, ContextKeyDefinedExpr } from 'vs/platform/contextkey/common/contextkey';
import { createActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IViewDescriptorService, IViewsService } from 'vs/workbench/common/views';
import { WelcomeView } from 'vs/workbench/contrib/debug/browser/welcomeView';
import { debugConfigure } from 'vs/workbench/contrib/debug/browser/debugIcons';
import { WorkbenchStateContext } from 'vs/workbench/browser/contextkeys';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { FOCUS_SESSION_ID, SELECT_AND_START_ID, DEBUG_CONFIGURE_COMMAND_ID, DEBUG_CONFIGURE_LABEL, DEBUG_START_LABEL, DEBUG_START_COMMAND_ID } from 'vs/workbench/contrib/debug/browser/debugCommands';
import { IActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';

export class DebugViewPaneContainer extends ViewPaneContainer {

	private startDebugActionViewItem: StartDebugActionViewItem | undefined;
	private progressResolve: (() => void) | undefined;
	private breakpointView: ViewPane | undefined;
	private paneListeners = new Map<string, IDisposable>();

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IProgressService private readonly progressService: IProgressService,
		@IDebugService private readonly debugService: IDebugService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@IThemeService themeService: IThemeService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IExtensionService extensionService: IExtensionService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService
	) {
		super(VIEWLET_ID, { mergeViewWithContainerWhenSingleView: true }, instantiationService, configurationService, layoutService, contextMenuService, telemetryService, extensionService, themeService, storageService, contextService, viewDescriptorService);

		// When there are potential updates to the docked debug toolbar we need to update it
		this._register(this.debugService.onDidChangeState(state => this.onDebugServiceStateChange(state)));

		this._register(this.contextKeyService.onDidChangeContext(e => {
			if (e.affectsSome(new Set([CONTEXT_DEBUG_UX_KEY]))) {
				this.updateTitleArea();
			}
		}));

		this._register(this.contextService.onDidChangeWorkbenchState(() => this.updateTitleArea()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('debug.toolBarLocation')) {
				this.updateTitleArea();
			}
		}));
	}

	override create(parent: HTMLElement): void {
		super.create(parent);
		parent.classList.add('debug-viewlet');
	}

	override focus(): void {
		super.focus();

		if (this.startDebugActionViewItem) {
			this.startDebugActionViewItem.focus();
		} else {
			this.focusView(WelcomeView.ID);
		}
	}

	override getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (action.id === DEBUG_START_COMMAND_ID) {
			this.startDebugActionViewItem = this.instantiationService.createInstance(StartDebugActionViewItem, null, action);
			return this.startDebugActionViewItem;
		}
		if (action.id === FOCUS_SESSION_ID) {
			return new FocusSessionActionViewItem(action, undefined, this.debugService, this.themeService, this.contextViewService, this.configurationService);
		}
		return createActionViewItem(this.instantiationService, action);
	}

	focusView(id: string): void {
		const view = this.getView(id);
		if (view) {
			view.focus();
		}
	}

	private onDebugServiceStateChange(state: State): void {
		if (this.progressResolve) {
			this.progressResolve();
			this.progressResolve = undefined;
		}

		if (state === State.Initializing) {
			this.progressService.withProgress({ location: VIEWLET_ID, }, _progress => {
				return new Promise<void>(resolve => this.progressResolve = resolve);
			});
		}
	}

	override addPanes(panes: { pane: ViewPane, size: number, index?: number }[]): void {
		super.addPanes(panes);

		for (const { pane: pane } of panes) {
			// attach event listener to
			if (pane.id === BREAKPOINTS_VIEW_ID) {
				this.breakpointView = pane;
				this.updateBreakpointsMaxSize();
			} else {
				this.paneListeners.set(pane.id, pane.onDidChange(() => this.updateBreakpointsMaxSize()));
			}
		}
	}

	override removePanes(panes: ViewPane[]): void {
		super.removePanes(panes);
		for (const pane of panes) {
			dispose(this.paneListeners.get(pane.id));
			this.paneListeners.delete(pane.id);
		}
	}

	private updateBreakpointsMaxSize(): void {
		if (this.breakpointView) {
			// We need to update the breakpoints view since all other views are collapsed #25384
			const allOtherCollapsed = this.panes.every(view => !view.isExpanded() || view === this.breakpointView);
			this.breakpointView.maximumBodySize = allOtherCollapsed ? Number.POSITIVE_INFINITY : this.breakpointView.minimumBodySize;
		}
	}
}

MenuRegistry.appendMenuItem(MenuId.ViewContainerTitle, {
	when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID), CONTEXT_DEBUG_UX.notEqualsTo('simple'), WorkbenchStateContext.notEqualsTo('empty'),
		ContextKeyExpr.or(CONTEXT_DEBUG_STATE.isEqualTo('inactive'), ContextKeyExpr.notEquals('config.debug.toolBarLocation', 'docked'))),
	order: 10,
	group: 'navigation',
	command: {
		precondition: CONTEXT_DEBUG_STATE.notEqualsTo(getStateLabel(State.Initializing)),
		id: DEBUG_START_COMMAND_ID,
		title: DEBUG_START_LABEL
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: DEBUG_CONFIGURE_COMMAND_ID,
			title: {
				value: DEBUG_CONFIGURE_LABEL,
				original: 'Open \'launch.json\'',
				mnemonicTitle: nls.localize({ key: 'miOpenConfigurations', comment: ['&& denotes a mnemonic'] }, "Open &&Configurations")
			},
			f1: true,
			icon: debugConfigure,
			precondition: CONTEXT_DEBUG_UX.notEqualsTo('simple'),
			menu: [{
				id: MenuId.ViewContainerTitle,
				group: 'navigation',
				order: 20,
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID), CONTEXT_DEBUG_UX.notEqualsTo('simple'), WorkbenchStateContext.notEqualsTo('empty'),
					ContextKeyExpr.or(CONTEXT_DEBUG_STATE.isEqualTo('inactive'), ContextKeyExpr.notEquals('config.debug.toolBarLocation', 'docked')))
			}, {
				id: MenuId.ViewContainerTitle,
				order: 20,
				// Show in debug viewlet secondary actions when debugging and debug toolbar is docked
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID), CONTEXT_DEBUG_STATE.notEqualsTo('inactive'), ContextKeyExpr.equals('config.debug.toolBarLocation', 'docked'))
			}, {
				id: MenuId.MenubarDebugMenu,
				group: '2_configuration',
				order: 1,
				when: CONTEXT_DEBUGGERS_AVAILABLE
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const debugService = accessor.get(IDebugService);
		const quickInputService = accessor.get(IQuickInputService);
		const configurationManager = debugService.getConfigurationManager();
		let launch: ILaunch | undefined;
		if (configurationManager.selectedConfiguration.name) {
			launch = configurationManager.selectedConfiguration.launch;
		} else {
			const launches = configurationManager.getLaunches().filter(l => !l.hidden);
			if (launches.length === 1) {
				launch = launches[0];
			} else {
				const picks = launches.map(l => ({ label: l.name, launch: l }));
				const picked = await quickInputService.pick<{ label: string, launch: ILaunch }>(picks, {
					activeItem: picks[0],
					placeHolder: nls.localize({ key: 'selectWorkspaceFolder', comment: ['User picks a workspace folder or a workspace configuration file here. Workspace configuration files can contain settings and thus a launch.json configuration can be written into one.'] }, "Select a workspace folder to create a launch.json file in or add it to the workspace config file")
				});
				if (picked) {
					launch = picked.launch;
				}
			}
		}

		if (launch) {
			await launch.openConfigFile(false);
		}
	}
});


registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'debug.toggleReplIgnoreFocus',
			title: nls.localize('debugPanel', "Debug Console"),
			toggled: ContextKeyDefinedExpr.create(`view.${REPL_VIEW_ID}.visible`),
			menu: [{
				id: ViewsSubMenu,
				group: '3_toggleRepl',
				order: 30,
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID))
			}]
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewsService = accessor.get(IViewsService);
		if (viewsService.isViewVisible(REPL_VIEW_ID)) {
			viewsService.closeView(REPL_VIEW_ID);
		} else {
			await viewsService.openView(REPL_VIEW_ID);
		}
	}
});

MenuRegistry.appendMenuItem(MenuId.ViewContainerTitle, {
	when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID), CONTEXT_DEBUG_STATE.notEqualsTo('inactive'), ContextKeyExpr.equals('config.debug.toolBarLocation', 'docked')),
	order: 10,
	command: {
		id: SELECT_AND_START_ID,
		title: nls.localize('startAdditionalSession', "Start Additional Session"),
	}
});
