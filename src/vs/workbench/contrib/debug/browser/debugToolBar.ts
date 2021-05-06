/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/debugToolBar';
import * as errors from 'vs/base/common/errors';
import * as browser from 'vs/base/browser/browser';
import * as dom from 'vs/base/browser/dom';
import * as arrays from 'vs/base/common/arrays';
import { localize } from 'vs/nls';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { IAction, IRunEvent, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import { ActionBar, ActionsOrientation } from 'vs/base/browser/ui/actionbar/actionbar';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IDebugConfiguration, IDebugService, State, CONTEXT_DEBUG_STATE, CONTEXT_FOCUSED_SESSION_IS_ATTACH, CONTEXT_STEP_BACK_SUPPORTED, CONTEXT_MULTI_SESSION_DEBUG, VIEWLET_ID } from 'vs/workbench/contrib/debug/common/debug';
import { FocusSessionActionViewItem } from 'vs/workbench/contrib/debug/browser/debugActionViewItems';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService, Themable, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { contrastBorder, widgetShadow } from 'vs/platform/theme/common/colorRegistry';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { createActionViewItem, createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { ICommandAction, IMenu, IMenuService, MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { IContextKeyService, ContextKeyExpression, ContextKeyExpr, ContextKeyEqualsExpr } from 'vs/platform/contextkey/common/contextkey';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import * as icons from 'vs/workbench/contrib/debug/browser/debugIcons';
import { debugToolBarBackground, debugToolBarBorder } from 'vs/workbench/contrib/debug/browser/debugColors';
import { URI } from 'vs/base/common/uri';
import { CONTINUE_LABEL, CONTINUE_ID, PAUSE_ID, STOP_ID, DISCONNECT_ID, STEP_OVER_ID, STEP_INTO_ID, RESTART_SESSION_ID, STEP_OUT_ID, STEP_BACK_ID, REVERSE_CONTINUE_ID, RESTART_LABEL, STEP_OUT_LABEL, STEP_INTO_LABEL, STEP_OVER_LABEL, DISCONNECT_LABEL, STOP_LABEL, PAUSE_LABEL, FOCUS_SESSION_ID, FOCUS_SESSION_LABEL } from 'vs/workbench/contrib/debug/browser/debugCommands';

const DEBUG_TOOLBAR_POSITION_KEY = 'debug.actionswidgetposition';
const DEBUG_TOOLBAR_Y_KEY = 'debug.actionswidgety';

export class DebugToolBar extends Themable implements IWorkbenchContribution {

	private $el: HTMLElement;
	private dragArea: HTMLElement;
	private actionBar: ActionBar;
	private activeActions: IAction[];
	private updateScheduler: RunOnceScheduler;
	private debugToolBarMenu: IMenu;
	private disposeOnUpdate: IDisposable | undefined;
	private yCoordinate = 0;

	private isVisible = false;
	private isBuilt = false;

	constructor(
		@INotificationService private readonly notificationService: INotificationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IDebugService private readonly debugService: IDebugService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super(themeService);

		this.$el = dom.$('div.debug-toolbar');
		this.$el.style.top = `${layoutService.offset?.top ?? 0}px`;

		this.dragArea = dom.append(this.$el, dom.$('div.drag-area' + ThemeIcon.asCSSSelector(icons.debugGripper)));

		const actionBarContainer = dom.append(this.$el, dom.$('div.action-bar-container'));
		this.debugToolBarMenu = menuService.createMenu(MenuId.DebugToolBar, contextKeyService);
		this._register(this.debugToolBarMenu);

		this.activeActions = [];
		this.actionBar = this._register(new ActionBar(actionBarContainer, {
			orientation: ActionsOrientation.HORIZONTAL,
			actionViewItemProvider: (action: IAction) => {
				if (action.id === FOCUS_SESSION_ID) {
					return this.instantiationService.createInstance(FocusSessionActionViewItem, action, undefined);
				}
				return createActionViewItem(this.instantiationService, action);
			}
		}));

		this.updateScheduler = this._register(new RunOnceScheduler(() => {
			const state = this.debugService.state;
			const toolBarLocation = this.configurationService.getValue<IDebugConfiguration>('debug').toolBarLocation;
			if (state === State.Inactive || toolBarLocation === 'docked' || toolBarLocation === 'hidden') {
				return this.hide();
			}

			const actions: IAction[] = [];
			const disposable = createAndFillInActionBarActions(this.debugToolBarMenu, { shouldForwardArgs: true }, actions);
			if (!arrays.equals(actions, this.activeActions, (first, second) => first.id === second.id && first.enabled === second.enabled)) {
				this.actionBar.clear();
				this.actionBar.push(actions, { icon: true, label: false });
				this.activeActions = actions;
			}
			if (this.disposeOnUpdate) {
				dispose(this.disposeOnUpdate);
			}
			this.disposeOnUpdate = disposable;

			this.show();
		}, 20));

		this.updateStyles();
		this.registerListeners();
		this.hide();
	}

	private registerListeners(): void {
		this._register(this.debugService.onDidChangeState(() => this.updateScheduler.schedule()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('debug.toolBarLocation')) {
				this.updateScheduler.schedule();
			}
		}));
		this._register(this.debugToolBarMenu.onDidChange(() => this.updateScheduler.schedule()));
		this._register(this.actionBar.actionRunner.onDidRun((e: IRunEvent) => {
			// check for error
			if (e.error && !errors.isPromiseCanceledError(e.error)) {
				this.notificationService.error(e.error);
			}

			// log in telemetry
			this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: e.action.id, from: 'debugActionsWidget' });
		}));
		this._register(dom.addDisposableListener(window, dom.EventType.RESIZE, () => this.setCoordinates()));

		this._register(dom.addDisposableGenericMouseUpListner(this.dragArea, (event: MouseEvent) => {
			const mouseClickEvent = new StandardMouseEvent(event);
			if (mouseClickEvent.detail === 2) {
				// double click on debug bar centers it again #8250
				const widgetWidth = this.$el.clientWidth;
				this.setCoordinates(0.5 * window.innerWidth - 0.5 * widgetWidth, 0);
				this.storePosition();
			}
		}));

		this._register(dom.addDisposableGenericMouseDownListner(this.dragArea, (event: MouseEvent) => {
			this.dragArea.classList.add('dragged');

			const mouseMoveListener = dom.addDisposableGenericMouseMoveListner(window, (e: MouseEvent) => {
				const mouseMoveEvent = new StandardMouseEvent(e);
				// Prevent default to stop editor selecting text #8524
				mouseMoveEvent.preventDefault();
				// Reduce x by width of drag handle to reduce jarring #16604
				this.setCoordinates(mouseMoveEvent.posx - 14, mouseMoveEvent.posy - (this.layoutService.offset?.top ?? 0));
			});

			const mouseUpListener = dom.addDisposableGenericMouseUpListner(window, (e: MouseEvent) => {
				this.storePosition();
				this.dragArea.classList.remove('dragged');

				mouseMoveListener.dispose();
				mouseUpListener.dispose();
			});
		}));

		this._register(this.layoutService.onDidChangePartVisibility(() => this.setYCoordinate()));
		this._register(browser.onDidChangeZoomLevel(() => this.setYCoordinate()));
	}

	private storePosition(): void {
		const left = dom.getComputedStyle(this.$el).left;
		if (left) {
			const position = parseFloat(left) / window.innerWidth;
			this.storageService.store(DEBUG_TOOLBAR_POSITION_KEY, position, StorageScope.GLOBAL, StorageTarget.MACHINE);
		}
	}

	protected override updateStyles(): void {
		super.updateStyles();

		if (this.$el) {
			this.$el.style.backgroundColor = this.getColor(debugToolBarBackground) || '';

			const widgetShadowColor = this.getColor(widgetShadow);
			this.$el.style.boxShadow = widgetShadowColor ? `0 0 8px 2px ${widgetShadowColor}` : '';

			const contrastBorderColor = this.getColor(contrastBorder);
			const borderColor = this.getColor(debugToolBarBorder);

			if (contrastBorderColor) {
				this.$el.style.border = `1px solid ${contrastBorderColor}`;
			} else {
				this.$el.style.border = borderColor ? `solid ${borderColor}` : 'none';
				this.$el.style.border = '1px 0';
			}
		}
	}

	private setYCoordinate(y = this.yCoordinate): void {
		const titlebarOffset = this.layoutService.offset?.top ?? 0;
		this.$el.style.top = `${titlebarOffset + y}px`;
		this.yCoordinate = y;
	}

	private setCoordinates(x?: number, y?: number): void {
		if (!this.isVisible) {
			return;
		}
		const widgetWidth = this.$el.clientWidth;
		if (x === undefined) {
			const positionPercentage = this.storageService.get(DEBUG_TOOLBAR_POSITION_KEY, StorageScope.GLOBAL);
			x = positionPercentage !== undefined ? parseFloat(positionPercentage) * window.innerWidth : (0.5 * window.innerWidth - 0.5 * widgetWidth);
		}

		x = Math.max(0, Math.min(x, window.innerWidth - widgetWidth)); // do not allow the widget to overflow on the right
		this.$el.style.left = `${x}px`;

		if (y === undefined) {
			y = this.storageService.getNumber(DEBUG_TOOLBAR_Y_KEY, StorageScope.GLOBAL, 0);
		}
		const titleAreaHeight = 35;
		if ((y < titleAreaHeight / 2) || (y > titleAreaHeight + titleAreaHeight / 2)) {
			const moveToTop = y < titleAreaHeight;
			this.setYCoordinate(moveToTop ? 0 : titleAreaHeight);
			this.storageService.store(DEBUG_TOOLBAR_Y_KEY, moveToTop ? 0 : 2 * titleAreaHeight, StorageScope.GLOBAL, StorageTarget.MACHINE);
		}
	}

	private show(): void {
		if (this.isVisible) {
			this.setCoordinates();
			return;
		}
		if (!this.isBuilt) {
			this.isBuilt = true;
			this.layoutService.container.appendChild(this.$el);
		}

		this.isVisible = true;
		dom.show(this.$el);
		this.setCoordinates();
	}

	private hide(): void {
		this.isVisible = false;
		dom.hide(this.$el);
	}

	override dispose(): void {
		super.dispose();

		if (this.$el) {
			this.$el.remove();
		}
		if (this.disposeOnUpdate) {
			dispose(this.disposeOnUpdate);
		}
	}
}

// Debug toolbar

const registerDebugToolBarItem = (id: string, title: string, order: number, icon?: { light?: URI, dark?: URI } | ThemeIcon, when?: ContextKeyExpression, precondition?: ContextKeyExpression, alt?: ICommandAction) => {
	MenuRegistry.appendMenuItem(MenuId.DebugToolBar, {
		group: 'navigation',
		when,
		order,
		command: {
			id,
			title,
			icon,
			precondition
		},
		alt
	});

	// Register actions in debug viewlet when toolbar is docked
	MenuRegistry.appendMenuItem(MenuId.ViewContainerTitle, {
		group: 'navigation',
		when: ContextKeyExpr.and(when, ContextKeyEqualsExpr.create('viewContainer', VIEWLET_ID), CONTEXT_DEBUG_STATE.notEqualsTo('inactive'), ContextKeyExpr.equals('config.debug.toolBarLocation', 'docked')),
		order,
		command: {
			id,
			title,
			icon,
			precondition
		}
	});
};

registerDebugToolBarItem(CONTINUE_ID, CONTINUE_LABEL, 10, icons.debugContinue, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugToolBarItem(PAUSE_ID, PAUSE_LABEL, 10, icons.debugPause, CONTEXT_DEBUG_STATE.notEqualsTo('stopped'), CONTEXT_DEBUG_STATE.isEqualTo('running'));
registerDebugToolBarItem(STOP_ID, STOP_LABEL, 70, icons.debugStop, CONTEXT_FOCUSED_SESSION_IS_ATTACH.toNegated(), undefined, { id: DISCONNECT_ID, title: DISCONNECT_LABEL, icon: icons.debugDisconnect });
registerDebugToolBarItem(DISCONNECT_ID, DISCONNECT_LABEL, 70, icons.debugDisconnect, CONTEXT_FOCUSED_SESSION_IS_ATTACH, undefined, { id: STOP_ID, title: STOP_LABEL, icon: icons.debugStop });
registerDebugToolBarItem(STEP_OVER_ID, STEP_OVER_LABEL, 20, icons.debugStepOver, undefined, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugToolBarItem(STEP_INTO_ID, STEP_INTO_LABEL, 30, icons.debugStepInto, undefined, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugToolBarItem(STEP_OUT_ID, STEP_OUT_LABEL, 40, icons.debugStepOut, undefined, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugToolBarItem(RESTART_SESSION_ID, RESTART_LABEL, 60, icons.debugRestart);
registerDebugToolBarItem(STEP_BACK_ID, localize('stepBackDebug', "Step Back"), 50, icons.debugStepBack, CONTEXT_STEP_BACK_SUPPORTED, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugToolBarItem(REVERSE_CONTINUE_ID, localize('reverseContinue', "Reverse"), 60, icons.debugReverseContinue, CONTEXT_STEP_BACK_SUPPORTED, CONTEXT_DEBUG_STATE.isEqualTo('stopped'));
registerDebugToolBarItem(FOCUS_SESSION_ID, FOCUS_SESSION_LABEL, 100, undefined, CONTEXT_MULTI_SESSION_DEBUG);
