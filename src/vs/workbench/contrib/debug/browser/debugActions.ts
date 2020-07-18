/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IDebugService, State, IEnablement, IBreakpoint, IDebugSession, ILaunch } from 'vs/workbench/contrib/debug/common/debug';
import { Variable, Breakpoint, FunctionBreakpoint, Expression } from 'vs/workbench/contrib/debug/common/debugModel';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { deepClone } from 'vs/base/common/objects';

export abstract class AbstractDebugAction extends Action {

	constructor(
		id: string, label: string, cssClass: string,
		@IDebugService protected debugService: IDebugService,
		@IKeybindingService protected keybindingService: IKeybindingService,
	) {
		super(id, label, cssClass, false);
		this._register(this.debugService.onDidChangeState(state => this.updateEnablement(state)));

		this.updateLabel(label);
		this.updateEnablement();
	}

	run(_: any): Promise<any> {
		throw new Error('implement me');
	}

	get tooltip(): string {
		const keybinding = this.keybindingService.lookupKeybinding(this.id);
		const keybindingLabel = keybinding && keybinding.getLabel();

		return keybindingLabel ? `${this.label} (${keybindingLabel})` : this.label;
	}

	protected updateLabel(newLabel: string): void {
		this.label = newLabel;
	}

	protected updateEnablement(state = this.debugService.state): void {
		this.enabled = this.isEnabled(state);
	}

	protected isEnabled(_: State): boolean {
		return true;
	}
}

export class ConfigureAction extends AbstractDebugAction {
	static readonly ID = 'workbench.action.debug.configure';
	static readonly LABEL = nls.localize('openLaunchJson', "Open {0}", 'launch.json');

	constructor(id: string, label: string,
		@IDebugService debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super(id, label, 'debug-action codicon codicon-gear', debugService, keybindingService);
		this._register(debugService.getConfigurationManager().onDidSelectConfiguration(() => this.updateClass()));
		this.updateClass();
	}

	get tooltip(): string {
		if (this.debugService.getConfigurationManager().selectedConfiguration.name) {
			return ConfigureAction.LABEL;
		}

		return nls.localize('launchJsonNeedsConfigurtion', "Configure or Fix 'launch.json'");
	}

	private updateClass(): void {
		const configurationManager = this.debugService.getConfigurationManager();
		this.class = configurationManager.selectedConfiguration.name ? 'debug-action codicon codicon-gear' : 'debug-action codicon codicon-gear notification';
	}

	async run(): Promise<any> {
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY || this.contextService.getWorkspace().folders.length === 0) {
			this.notificationService.info(nls.localize('noFolderDebugConfig', "Please first open a folder in order to do advanced debug configuration."));
			return;
		}

		const configurationManager = this.debugService.getConfigurationManager();
		let launch: ILaunch | undefined;
		if (configurationManager.selectedConfiguration.name) {
			launch = configurationManager.selectedConfiguration.launch;
		} else {
			const launches = configurationManager.getLaunches().filter(l => !l.hidden);
			if (launches.length === 1) {
				launch = launches[0];
			} else {
				const picks = launches.map(l => ({ label: l.name, launch: l }));
				const picked = await this.quickInputService.pick<{ label: string, launch: ILaunch }>(picks, {
					activeItem: picks[0],
					placeHolder: nls.localize({ key: 'selectWorkspaceFolder', comment: ['User picks a workspace folder or a workspace configuration file here. Workspace configuration files can contain settings and thus a launch.json configuration can be written into one.'] }, "Select a workspace folder to create a launch.json file in or add it to the workspace config file")
				});
				if (picked) {
					launch = picked.launch;
				}
			}
		}

		if (launch) {
			return launch.openConfigFile(false);
		}
	}
}

export class StartAction extends AbstractDebugAction {
	static ID = 'workbench.action.debug.start';
	static LABEL = nls.localize('startDebug', "Start Debugging");

	constructor(id: string, label: string,
		@IDebugService debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
	) {
		super(id, label, 'debug-action start', debugService, keybindingService);

		this._register(this.debugService.getConfigurationManager().onDidSelectConfiguration(() => this.updateEnablement()));
		this._register(this.debugService.onDidNewSession(() => this.updateEnablement()));
		this._register(this.debugService.onDidEndSession(() => this.updateEnablement()));
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.updateEnablement()));
	}

	async run(): Promise<boolean> {
		let { launch, name, config } = this.debugService.getConfigurationManager().selectedConfiguration;
		const clonedConfig = deepClone(config);
		return this.debugService.startDebugging(launch, clonedConfig || name, { noDebug: this.isNoDebug() });
	}

	protected isNoDebug(): boolean {
		return false;
	}

	static isEnabled(debugService: IDebugService) {
		const sessions = debugService.getModel().getSessions();

		if (debugService.state === State.Initializing) {
			return false;
		}
		let { name, config } = debugService.getConfigurationManager().selectedConfiguration;
		let nameToStart = name || config?.name;

		if (sessions.some(s => s.configuration.name === nameToStart)) {
			// There is already a debug session running and we do not have any launch configuration selected
			return false;
		}

		return true;
	}

	// Disabled if the launch drop down shows the launch config that is already running.
	protected isEnabled(): boolean {
		return StartAction.isEnabled(this.debugService);
	}
}

export class RunAction extends StartAction {
	static readonly ID = 'workbench.action.debug.run';
	static LABEL = nls.localize('startWithoutDebugging', "Start Without Debugging");

	protected isNoDebug(): boolean {
		return true;
	}
}

export class SelectAndStartAction extends AbstractDebugAction {
	static readonly ID = 'workbench.action.debug.selectandstart';
	static readonly LABEL = nls.localize('selectAndStartDebugging', "Select and Start Debugging");

	constructor(id: string, label: string,
		@IDebugService debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
	) {
		super(id, label, '', debugService, keybindingService);
	}

	async run(): Promise<any> {
		this.quickInputService.quickAccess.show('debug ');
	}
}

export class RemoveBreakpointAction extends Action {
	static readonly ID = 'workbench.debug.viewlet.action.removeBreakpoint';
	static readonly LABEL = nls.localize('removeBreakpoint', "Remove Breakpoint");

	constructor(id: string, label: string, @IDebugService private readonly debugService: IDebugService) {
		super(id, label, 'debug-action remove');
	}

	run(breakpoint: IBreakpoint): Promise<any> {
		return breakpoint instanceof Breakpoint ? this.debugService.removeBreakpoints(breakpoint.getId())
			: breakpoint instanceof FunctionBreakpoint ? this.debugService.removeFunctionBreakpoints(breakpoint.getId()) : this.debugService.removeDataBreakpoints(breakpoint.getId());
	}
}

export class RemoveAllBreakpointsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.removeAllBreakpoints';
	static readonly LABEL = nls.localize('removeAllBreakpoints', "Remove All Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action codicon-close-all', debugService, keybindingService);
		this._register(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	run(): Promise<any> {
		return Promise.all([this.debugService.removeBreakpoints(), this.debugService.removeFunctionBreakpoints(), this.debugService.removeDataBreakpoints()]);
	}

	protected isEnabled(_: State): boolean {
		const model = this.debugService.getModel();
		return (model.getBreakpoints().length > 0 || model.getFunctionBreakpoints().length > 0 || model.getDataBreakpoints().length > 0);
	}
}

export class EnableAllBreakpointsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.enableAllBreakpoints';
	static readonly LABEL = nls.localize('enableAllBreakpoints', "Enable All Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action enable-all-breakpoints', debugService, keybindingService);
		this._register(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	run(): Promise<any> {
		return this.debugService.enableOrDisableBreakpoints(true);
	}

	protected isEnabled(_: State): boolean {
		const model = this.debugService.getModel();
		return (<ReadonlyArray<IEnablement>>model.getBreakpoints()).concat(model.getFunctionBreakpoints()).concat(model.getExceptionBreakpoints()).some(bp => !bp.enabled);
	}
}

export class DisableAllBreakpointsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.disableAllBreakpoints';
	static readonly LABEL = nls.localize('disableAllBreakpoints', "Disable All Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action disable-all-breakpoints', debugService, keybindingService);
		this._register(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	run(): Promise<any> {
		return this.debugService.enableOrDisableBreakpoints(false);
	}

	protected isEnabled(_: State): boolean {
		const model = this.debugService.getModel();
		return (<ReadonlyArray<IEnablement>>model.getBreakpoints()).concat(model.getFunctionBreakpoints()).concat(model.getExceptionBreakpoints()).some(bp => bp.enabled);
	}
}

export class ToggleBreakpointsActivatedAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.toggleBreakpointsActivatedAction';
	static readonly ACTIVATE_LABEL = nls.localize('activateBreakpoints', "Activate Breakpoints");
	static readonly DEACTIVATE_LABEL = nls.localize('deactivateBreakpoints', "Deactivate Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action codicon-activate-breakpoints', debugService, keybindingService);
		this.updateLabel(this.debugService.getModel().areBreakpointsActivated() ? ToggleBreakpointsActivatedAction.DEACTIVATE_LABEL : ToggleBreakpointsActivatedAction.ACTIVATE_LABEL);

		this._register(this.debugService.getModel().onDidChangeBreakpoints(() => {
			this.updateLabel(this.debugService.getModel().areBreakpointsActivated() ? ToggleBreakpointsActivatedAction.DEACTIVATE_LABEL : ToggleBreakpointsActivatedAction.ACTIVATE_LABEL);
			this.updateEnablement();
		}));
	}

	run(): Promise<any> {
		return this.debugService.setBreakpointsActivated(!this.debugService.getModel().areBreakpointsActivated());
	}

	protected isEnabled(_: State): boolean {
		return !!(this.debugService.getModel().getFunctionBreakpoints().length || this.debugService.getModel().getBreakpoints().length || this.debugService.getModel().getDataBreakpoints().length);
	}
}

export class ReapplyBreakpointsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.reapplyBreakpointsAction';
	static readonly LABEL = nls.localize('reapplyAllBreakpoints', "Reapply All Breakpoints");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, '', debugService, keybindingService);
		this._register(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	run(): Promise<any> {
		return this.debugService.setBreakpointsActivated(true);
	}

	protected isEnabled(state: State): boolean {
		const model = this.debugService.getModel();
		return (state === State.Running || state === State.Stopped) &&
			((model.getFunctionBreakpoints().length + model.getBreakpoints().length + model.getExceptionBreakpoints().length + model.getDataBreakpoints().length) > 0);
	}
}

export class AddFunctionBreakpointAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.addFunctionBreakpointAction';
	static readonly LABEL = nls.localize('addFunctionBreakpoint', "Add Function Breakpoint");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action codicon-add', debugService, keybindingService);
		this._register(this.debugService.getModel().onDidChangeBreakpoints(() => this.updateEnablement()));
	}

	async run(): Promise<any> {
		this.debugService.addFunctionBreakpoint();
	}

	protected isEnabled(_: State): boolean {
		return !this.debugService.getViewModel().getSelectedFunctionBreakpoint()
			&& this.debugService.getModel().getFunctionBreakpoints().every(fbp => !!fbp.name);
	}
}

export class AddWatchExpressionAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.addWatchExpression';
	static readonly LABEL = nls.localize('addWatchExpression', "Add Expression");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action codicon-add', debugService, keybindingService);
		this._register(this.debugService.getModel().onDidChangeWatchExpressions(() => this.updateEnablement()));
		this._register(this.debugService.getViewModel().onDidSelectExpression(() => this.updateEnablement()));
	}

	async run(): Promise<any> {
		this.debugService.addWatchExpression();
	}

	protected isEnabled(_: State): boolean {
		const focusedExpression = this.debugService.getViewModel().getSelectedExpression();
		return this.debugService.getModel().getWatchExpressions().every(we => !!we.name && we !== focusedExpression);
	}
}

export class RemoveAllWatchExpressionsAction extends AbstractDebugAction {
	static readonly ID = 'workbench.debug.viewlet.action.removeAllWatchExpressions';
	static readonly LABEL = nls.localize('removeAllWatchExpressions', "Remove All Expressions");

	constructor(id: string, label: string, @IDebugService debugService: IDebugService, @IKeybindingService keybindingService: IKeybindingService) {
		super(id, label, 'debug-action codicon-close-all', debugService, keybindingService);
		this._register(this.debugService.getModel().onDidChangeWatchExpressions(() => this.updateEnablement()));
	}

	async run(): Promise<any> {
		this.debugService.removeWatchExpressions();
	}

	protected isEnabled(_: State): boolean {
		return this.debugService.getModel().getWatchExpressions().length > 0;
	}
}

export class FocusSessionAction extends AbstractDebugAction {
	static readonly ID = 'workbench.action.debug.focusProcess';
	static readonly LABEL = nls.localize('focusSession', "Focus Session");

	constructor(id: string, label: string,
		@IDebugService debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(id, label, '', debugService, keybindingService);
	}

	async run(session: IDebugSession): Promise<any> {
		await this.debugService.focusStackFrame(undefined, undefined, session, true);
		const stackFrame = this.debugService.getViewModel().focusedStackFrame;
		if (stackFrame) {
			await stackFrame.openInEditor(this.editorService, true);
		}
	}
}

export class CopyValueAction extends Action {
	static readonly ID = 'workbench.debug.viewlet.action.copyValue';
	static readonly LABEL = nls.localize('copyValue', "Copy Value");

	constructor(
		id: string, label: string, private value: Variable | Expression, private context: string,
		@IDebugService private readonly debugService: IDebugService,
		@IClipboardService private readonly clipboardService: IClipboardService
	) {
		super(id, label);
		this._enabled = (this.value instanceof Expression) || (this.value instanceof Variable && !!this.value.evaluateName);
	}

	async run(): Promise<any> {
		const stackFrame = this.debugService.getViewModel().focusedStackFrame;
		const session = this.debugService.getViewModel().focusedSession;
		if (!stackFrame || !session) {
			return;
		}

		const context = session.capabilities.supportsClipboardContext ? 'clipboard' : this.context;
		const toEvaluate = this.value instanceof Variable ? (this.value.evaluateName || this.value.value) : this.value.name;

		try {
			const evaluation = await session.evaluate(toEvaluate, stackFrame.frameId, context);
			this.clipboardService.writeText(evaluation.body.result);
		} catch (e) {
			this.clipboardService.writeText(typeof this.value === 'string' ? this.value : this.value.value);
		}
	}
}
