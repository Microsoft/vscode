/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/workbench/contrib/markers/browser/markersFileDecorations';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Extensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actions';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { localize } from 'vs/nls';
import { Marker, RelatedInformation } from 'vs/workbench/contrib/markers/browser/markersModel';
import { MarkersView } from 'vs/workbench/contrib/markers/browser/markersView';
import { MenuId, MenuRegistry, SyncActionDescriptor, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { Registry } from 'vs/platform/registry/common/platform';
import { ShowProblemsPanelAction } from 'vs/workbench/contrib/markers/browser/markersViewActions';
import Constants from 'vs/workbench/contrib/markers/browser/constants';
import Messages from 'vs/workbench/contrib/markers/browser/messages';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IMarkersWorkbenchService, MarkersWorkbenchService, ActivityUpdater } from 'vs/workbench/contrib/markers/browser/markers';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { Disposable } from 'vs/base/common/lifecycle';
import { IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment, IStatusbarEntry } from 'vs/workbench/services/statusbar/common/statusbar';
import { IMarkerService, MarkerStatistics } from 'vs/platform/markers/common/markers';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ViewContainer, IViewContainersRegistry, Extensions as ViewContainerExtensions, ViewContainerLocation, IViewsRegistry, IViewsService, getVisbileViewContextKey, FocusedViewContext, IViewDescriptorService } from 'vs/workbench/common/views';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import type { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ToggleViewAction } from 'vs/workbench/browser/actions/layoutActions';
import { Codicon } from 'vs/base/common/codicons';

registerSingleton(IMarkersWorkbenchService, MarkersWorkbenchService, false);

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.MARKER_OPEN_SIDE_ACTION_ID,
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(Constants.MarkerFocusContextKey),
	primary: KeyMod.CtrlCmd | KeyCode.Enter,
	mac: {
		primary: KeyMod.WinCtrl | KeyCode.Enter
	},
	handler: (accessor, args: any) => {
		const markersView = accessor.get(IViewsService).getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID)!;
		markersView.openFileAtElement(markersView.getFocusElement(), false, true, true);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.MARKER_SHOW_PANEL_ID,
	weight: KeybindingWeight.WorkbenchContrib,
	when: undefined,
	primary: undefined,
	handler: async (accessor, args: any) => {
		await accessor.get(IViewsService).openView(Constants.MARKERS_VIEW_ID);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: Constants.MARKER_SHOW_QUICK_FIX,
	weight: KeybindingWeight.WorkbenchContrib,
	when: Constants.MarkerFocusContextKey,
	primary: KeyMod.CtrlCmd | KeyCode.US_DOT,
	handler: (accessor, args: any) => {
		const markersView = accessor.get(IViewsService).getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID)!;
		const focusedElement = markersView.getFocusElement();
		if (focusedElement instanceof Marker) {
			markersView.showQuickFixes(focusedElement);
		}
	}
});

// configuration
Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerConfiguration({
	'id': 'problems',
	'order': 101,
	'title': Messages.PROBLEMS_PANEL_CONFIGURATION_TITLE,
	'type': 'object',
	'properties': {
		'problems.autoReveal': {
			'description': Messages.PROBLEMS_PANEL_CONFIGURATION_AUTO_REVEAL,
			'type': 'boolean',
			'default': true
		},
		'problems.showCurrentInStatus': {
			'description': Messages.PROBLEMS_PANEL_CONFIGURATION_SHOW_CURRENT_STATUS,
			'type': 'boolean',
			'default': false
		}
	}
});

class ToggleMarkersPanelAction extends ToggleViewAction {

	public static readonly ID = 'workbench.actions.view.problems';
	public static readonly LABEL = Messages.MARKERS_PANEL_TOGGLE_LABEL;

	constructor(id: string, label: string,
		@IViewsService viewsService: IViewsService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService
	) {
		super(id, label, Constants.MARKERS_VIEW_ID, viewsService, viewDescriptorService, contextKeyService, layoutService);
	}
}

// markers view container
const VIEW_CONTAINER: ViewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: Constants.MARKERS_CONTAINER_ID,
	name: Messages.MARKERS_PANEL_TITLE_PROBLEMS,
	icon: Codicon.warning.classNames,
	hideIfEmpty: true,
	order: 0,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [Constants.MARKERS_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	storageId: Constants.MARKERS_VIEW_STORAGE_ID,
	focusCommand: {
		id: ToggleMarkersPanelAction.ID, keybindings: {
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_M
		}
	}
}, ViewContainerLocation.Panel);

Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: Constants.MARKERS_VIEW_ID,
	containerIcon: Codicon.warning.classNames,
	name: Messages.MARKERS_PANEL_TITLE_PROBLEMS,
	canToggleVisibility: false,
	canMoveView: true,
	ctorDescriptor: new SyncDescriptor(MarkersView),
}], VIEW_CONTAINER);

// workbench
const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(ActivityUpdater, LifecyclePhase.Restored);

// actions
const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleMarkersPanelAction, {
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_M
}), 'View: Toggle Problems (Errors, Warnings, Infos)', Messages.MARKERS_PANEL_VIEW_CATEGORY);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ShowProblemsPanelAction), 'View: Focus Problems (Errors, Warnings, Infos)', Messages.MARKERS_PANEL_VIEW_CATEGORY);
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: Constants.MARKER_COPY_ACTION_ID,
			title: { value: localize('copyMarker', "Copy"), original: 'Copy' },
			menu: {
				id: MenuId.ProblemsPanelContext,
				when: Constants.MarkerFocusContextKey,
				group: 'navigation'
			},
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
				when: Constants.MarkerFocusContextKey
			},
		});
	}
	async run(accessor: ServicesAccessor) {
		await copyMarker(accessor.get(IViewsService), accessor.get(IClipboardService));
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: Constants.MARKER_COPY_MESSAGE_ACTION_ID,
			title: { value: localize('copyMessage', "Copy Message"), original: 'Copy Message' },
			menu: {
				id: MenuId.ProblemsPanelContext,
				when: Constants.MarkerFocusContextKey,
				group: 'navigation'
			},
		});
	}
	async run(accessor: ServicesAccessor) {
		await copyMessage(accessor.get(IViewsService), accessor.get(IClipboardService));
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: Constants.RELATED_INFORMATION_COPY_MESSAGE_ACTION_ID,
			title: { value: localize('copyMessage', "Copy Message"), original: 'Copy Message' },
			menu: {
				id: MenuId.ProblemsPanelContext,
				when: Constants.RelatedInformationFocusContextKey,
				group: 'navigation'
			}
		});
	}
	async run(accessor: ServicesAccessor) {
		await copyRelatedInformationMessage(accessor.get(IViewsService), accessor.get(IClipboardService));
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: Constants.FOCUS_PROBLEMS_FROM_FILTER,
			title: localize('focusProblemsList', "Focus problems view"),
			keybinding: {
				when: Constants.MarkerViewFilterFocusContextKey,
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.DownArrow
			}
		});
	}
	run(accessor: ServicesAccessor) {
		focusProblemsView(accessor.get(IViewsService));
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: Constants.MARKERS_VIEW_FOCUS_FILTER,
			title: localize('focusProblemsFilter', "Focus problems filter"),
			keybinding: {
				when: FocusedViewContext.isEqualTo(Constants.MARKERS_VIEW_ID),
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyCode.KEY_F
			}
		});
	}
	run(accessor: ServicesAccessor) {
		focusProblemsFilter(accessor.get(IViewsService));
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: Constants.MARKERS_VIEW_SHOW_MULTILINE_MESSAGE,
			title: { value: localize('show multiline', "Show message in multiple lines"), original: 'Problems: Show message in multiple lines' },
			category: localize('problems', "Problems"),
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyExpr.has(getVisbileViewContextKey(Constants.MARKERS_VIEW_ID))
			}
		});
	}
	run(accessor: ServicesAccessor) {
		const markersView = accessor.get(IViewsService).getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID)!;
		if (markersView) {
			markersView.markersViewModel.multiline = true;
		}
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: Constants.MARKERS_VIEW_SHOW_SINGLELINE_MESSAGE,
			title: { value: localize('show singleline', "Show message in single line"), original: 'Problems: Show message in single line' },
			category: localize('problems', "Problems"),
			menu: {
				id: MenuId.CommandPalette,
				when: ContextKeyExpr.has(getVisbileViewContextKey(Constants.MARKERS_VIEW_ID))
			}
		});
	}
	run(accessor: ServicesAccessor) {
		const markersView = accessor.get(IViewsService).getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID);
		if (markersView) {
			markersView.markersViewModel.multiline = false;
		}
	}
});
registerAction2(class extends Action2 {
	constructor() {
		super({
			id: Constants.MARKERS_VIEW_CLEAR_FILTER_TEXT,
			title: localize('clearFiltersText', "Clear filters text"),
			category: localize('problems', "Problems"),
			keybinding: {
				when: Constants.MarkerViewFilterFocusContextKey,
				weight: KeybindingWeight.WorkbenchContrib,
			}
		});
	}
	run(accessor: ServicesAccessor) {
		const markersView = accessor.get(IViewsService).getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID);
		if (markersView) {
			markersView.clearFilterText();
		}
	}
});

async function copyMarker(viewsService: IViewsService, clipboardService: IClipboardService) {
	const markersView = viewsService.getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID);
	if (markersView) {
		const element = markersView.getFocusElement();
		if (element instanceof Marker) {
			await clipboardService.writeText(`${element}`);
		}
	}
}

async function copyMessage(viewsService: IViewsService, clipboardService: IClipboardService) {
	const markersView = viewsService.getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID);
	if (markersView) {
		const element = markersView.getFocusElement();
		if (element instanceof Marker) {
			await clipboardService.writeText(element.marker.message);
		}
	}
}

async function copyRelatedInformationMessage(viewsService: IViewsService, clipboardService: IClipboardService) {
	const markersView = viewsService.getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID);
	if (markersView) {
		const element = markersView.getFocusElement();
		if (element instanceof RelatedInformation) {
			await clipboardService.writeText(element.raw.message);
		}
	}
}

function focusProblemsView(viewsService: IViewsService) {
	const markersView = viewsService.getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID);
	if (markersView) {
		markersView.focus();
	}
}

function focusProblemsFilter(viewsService: IViewsService): void {
	const markersView = viewsService.getActiveViewWithId<MarkersView>(Constants.MARKERS_VIEW_ID);
	if (markersView) {
		markersView.focusFilter();
	}
}

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '4_panels',
	command: {
		id: ToggleMarkersPanelAction.ID,
		title: localize({ key: 'miMarker', comment: ['&& denotes a mnemonic'] }, "&&Problems")
	},
	order: 4
});

CommandsRegistry.registerCommand(Constants.TOGGLE_MARKERS_VIEW_ACTION_ID, async (accessor) => {
	const viewsService = accessor.get(IViewsService);
	if (viewsService.isViewVisible(Constants.MARKERS_VIEW_ID)) {
		viewsService.closeView(Constants.MARKERS_VIEW_ID);
	} else {
		viewsService.openView(Constants.MARKERS_VIEW_ID, true);
	}
});

class MarkersStatusBarContributions extends Disposable implements IWorkbenchContribution {

	private markersStatusItem: IStatusbarEntryAccessor;

	constructor(
		@IMarkerService private readonly markerService: IMarkerService,
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();
		this.markersStatusItem = this._register(this.statusbarService.addEntry(this.getMarkersItem(), 'status.problems', localize('status.problems', "Problems"), StatusbarAlignment.LEFT, 50 /* Medium Priority */));
		this.markerService.onMarkerChanged(() => this.markersStatusItem.update(this.getMarkersItem()));
	}

	private getMarkersItem(): IStatusbarEntry {
		const markersStatistics = this.markerService.getStatistics();
		const tooltip = this.getMarkersTooltip(markersStatistics);
		return {
			text: this.getMarkersText(markersStatistics),
			ariaLabel: tooltip,
			tooltip,
			command: 'workbench.actions.view.toggleProblems'
		};
	}

	private getMarkersTooltip(stats: MarkerStatistics): string {
		const errorTitle = (n: number) => localize('totalErrors', "{0} Errors", n);
		const warningTitle = (n: number) => localize('totalWarnings', "{0} Warnings", n);
		const infoTitle = (n: number) => localize('totalInfos', "{0} Infos", n);

		const titles: string[] = [];

		if (stats.errors > 0) {
			titles.push(errorTitle(stats.errors));
		}

		if (stats.warnings > 0) {
			titles.push(warningTitle(stats.warnings));
		}

		if (stats.infos > 0) {
			titles.push(infoTitle(stats.infos));
		}

		if (titles.length === 0) {
			return localize('noProblems', "No Problems");
		}

		return titles.join(', ');
	}

	private getMarkersText(stats: MarkerStatistics): string {
		const problemsText: string[] = [];

		// Errors
		problemsText.push('$(error) ' + this.packNumber(stats.errors));

		// Warnings
		problemsText.push('$(warning) ' + this.packNumber(stats.warnings));

		// Info (only if any)
		if (stats.infos > 0) {
			problemsText.push('$(info) ' + this.packNumber(stats.infos));
		}

		return problemsText.join(' ');
	}

	private packNumber(n: number): string {
		const manyProblems = localize('manyProblems', "10K+");
		return n > 9999 ? manyProblems : n > 999 ? n.toString().charAt(0) + 'K' : n.toString();
	}
}

workbenchRegistry.registerWorkbenchContribution(MarkersStatusBarContributions, LifecyclePhase.Restored);
