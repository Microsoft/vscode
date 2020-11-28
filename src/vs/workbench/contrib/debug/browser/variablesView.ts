/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { RunOnceScheduler } from 'vs/base/common/async';
import * as dom from 'vs/base/browser/dom';
import { CollapseAction } from 'vs/workbench/browser/viewlet';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IDebugService, IExpression, IScope, CONTEXT_VARIABLES_FOCUSED, IStackFrame, CONTEXT_DEBUG_PROTOCOL_VARIABLE_MENU_CONTEXT, IDataBreakpointInfoResponse, CONTEXT_BREAK_WHEN_VALUE_CHANGES_SUPPORTED, CONTEXT_VARIABLE_EVALUATE_NAME_PRESENT } from 'vs/workbench/contrib/debug/common/debug';
import { Variable, Scope, ErrorScope, StackFrame } from 'vs/workbench/contrib/debug/common/debugModel';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { renderViewTree, renderVariable, IInputBoxOptions, AbstractExpressionsRenderer, IExpressionTemplateData } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { IAction } from 'vs/base/common/actions';
import { CopyValueAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITreeRenderer, ITreeNode, ITreeMouseEvent, ITreeContextMenuEvent, IAsyncDataSource } from 'vs/base/browser/ui/tree/tree';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { IAsyncDataTreeViewState } from 'vs/base/browser/ui/tree/asyncDataTree';
import { FuzzyScore, createMatches } from 'vs/base/common/filters';
import { HighlightedLabel, IHighlight } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { dispose } from 'vs/base/common/lifecycle';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { withUndefinedAsNull } from 'vs/base/common/types';
import { IMenuService, IMenu, MenuId } from 'vs/platform/actions/common/actions';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { debugCollapseAll } from 'vs/workbench/contrib/debug/browser/debugIcons';

const $ = dom.$;
let forgetScopes = true;

let variableInternalContext: Variable | undefined;
let dataBreakpointInfoResponse: IDataBreakpointInfoResponse | undefined;

interface IVariablesContext {
	container: DebugProtocol.Variable | DebugProtocol.Scope;
	variable: DebugProtocol.Variable;
}

export class VariablesView extends ViewPane {

	private updateTreeScheduler: RunOnceScheduler;
	private needsRefresh = false;
	private tree!: WorkbenchAsyncDataTree<IStackFrame | null, IExpression | IScope, FuzzyScore>;
	private savedViewState = new Map<string, IAsyncDataTreeViewState>();
	private autoExpandedScopes = new Set<string>();
	private menu: IMenu;
	private debugProtocolVariableMenuContext: IContextKey<string>;
	private breakWhenValueChangesSupported: IContextKey<boolean>;
	private variableEvaluateName: IContextKey<boolean>;

	constructor(
		options: IViewletViewOptions,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IDebugService private readonly debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IMenuService menuService: IMenuService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		this.menu = menuService.createMenu(MenuId.DebugVariablesContext, contextKeyService);
		this._register(this.menu);
		this.debugProtocolVariableMenuContext = CONTEXT_DEBUG_PROTOCOL_VARIABLE_MENU_CONTEXT.bindTo(contextKeyService);
		this.breakWhenValueChangesSupported = CONTEXT_BREAK_WHEN_VALUE_CHANGES_SUPPORTED.bindTo(contextKeyService);
		this.variableEvaluateName = CONTEXT_VARIABLE_EVALUATE_NAME_PRESENT.bindTo(contextKeyService);

		// Use scheduler to prevent unnecessary flashing
		this.updateTreeScheduler = new RunOnceScheduler(async () => {
			const stackFrame = this.debugService.getViewModel().focusedStackFrame;

			this.needsRefresh = false;
			const input = this.tree.getInput();
			if (input) {
				this.savedViewState.set(input.getId(), this.tree.getViewState());
			}
			if (!stackFrame) {
				await this.tree.setInput(null);
				return;
			}

			const viewState = this.savedViewState.get(stackFrame.getId());
			await this.tree.setInput(stackFrame, viewState);

			// Automatically expand the first scope if it is not expensive and if all scopes are collapsed
			const scopes = await stackFrame.getScopes();
			const toExpand = scopes.find(s => !s.expensive);
			if (toExpand && (scopes.every(s => this.tree.isCollapsed(s)) || !this.autoExpandedScopes.has(toExpand.getId()))) {
				this.autoExpandedScopes.add(toExpand.getId());
				await this.tree.expand(toExpand);
			}
		}, 400);
	}

	renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.element.classList.add('debug-pane');
		container.classList.add('debug-variables');
		const treeContainer = renderViewTree(container);

		this.tree = <WorkbenchAsyncDataTree<IStackFrame | null, IExpression | IScope, FuzzyScore>>this.instantiationService.createInstance(WorkbenchAsyncDataTree, 'VariablesView', treeContainer, new VariablesDelegate(),
			[this.instantiationService.createInstance(VariablesRenderer), new ScopesRenderer(), new ScopeErrorRenderer()],
			new VariablesDataSource(), {
			accessibilityProvider: new VariablesAccessibilityProvider(),
			identityProvider: { getId: (element: IExpression | IScope) => element.getId() },
			keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: (e: IExpression | IScope) => e },
			overrideStyles: {
				listBackground: this.getBackgroundColor()
			}
		});

		this.tree.setInput(withUndefinedAsNull(this.debugService.getViewModel().focusedStackFrame));

		CONTEXT_VARIABLES_FOCUSED.bindTo(this.tree.contextKeyService);

		this._register(this.debugService.getViewModel().onDidFocusStackFrame(sf => {
			if (!this.isBodyVisible()) {
				this.needsRefresh = true;
				return;
			}

			// Refresh the tree immediately if the user explictly changed stack frames.
			// Otherwise postpone the refresh until user stops stepping.
			const timeout = sf.explicit ? 0 : undefined;
			this.updateTreeScheduler.schedule(timeout);
		}));
		this._register(this.debugService.getViewModel().onWillUpdateViews(() => {
			const stackFrame = this.debugService.getViewModel().focusedStackFrame;
			if (stackFrame && forgetScopes) {
				stackFrame.forgetScopes();
			}
			forgetScopes = true;
			this.tree.updateChildren();
		}));
		this._register(this.tree.onMouseDblClick(e => this.onMouseDblClick(e)));
		this._register(this.tree.onContextMenu(async e => await this.onContextMenu(e)));

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible && this.needsRefresh) {
				this.updateTreeScheduler.schedule();
			}
		}));
		let horizontalScrolling: boolean | undefined;
		this._register(this.debugService.getViewModel().onDidSelectExpression(e => {
			if (e instanceof Variable) {
				horizontalScrolling = this.tree.options.horizontalScrolling;
				if (horizontalScrolling) {
					this.tree.updateOptions({ horizontalScrolling: false });
				}

				this.tree.rerender(e);
			} else if (!e && horizontalScrolling !== undefined) {
				this.tree.updateOptions({ horizontalScrolling: horizontalScrolling });
				horizontalScrolling = undefined;
			}
		}));
		this._register(this.debugService.onDidEndSession(() => {
			this.savedViewState.clear();
			this.autoExpandedScopes.clear();
		}));
	}

	getActions(): IAction[] {
		return [new CollapseAction(() => this.tree, true, 'explorer-action ' + ThemeIcon.asClassName(debugCollapseAll))];
	}

	layoutBody(width: number, height: number): void {
		super.layoutBody(height, width);
		this.tree.layout(width, height);
	}

	focus(): void {
		this.tree.domFocus();
	}

	private onMouseDblClick(e: ITreeMouseEvent<IExpression | IScope>): void {
		const session = this.debugService.getViewModel().focusedSession;
		if (session && e.element instanceof Variable && session.capabilities.supportsSetVariable) {
			this.debugService.getViewModel().setSelectedExpression(e.element);
		}
	}

	private async onContextMenu(e: ITreeContextMenuEvent<IExpression | IScope>): Promise<void> {
		const variable = e.element;
		if (variable instanceof Variable && !!variable.value) {
			this.debugProtocolVariableMenuContext.set(variable.variableMenuContext || '');
			variableInternalContext = variable;
			const session = this.debugService.getViewModel().focusedSession;
			this.variableEvaluateName.set(!!variable.evaluateName);
			this.breakWhenValueChangesSupported.reset();
			if (session && session.capabilities.supportsDataBreakpoints) {
				dataBreakpointInfoResponse = await session.dataBreakpointInfo(variable.name, variable.parent.reference);
				const dataBreakpointId = dataBreakpointInfoResponse?.dataId;
				this.breakWhenValueChangesSupported.set(!!dataBreakpointId);
			}

			const context: IVariablesContext = {
				container: (variable.parent as (Variable | Scope)).toDebugProtocolObject(),
				variable: variable.toDebugProtocolObject()
			};
			const actions: IAction[] = [];
			const actionsDisposable = createAndFillInContextMenuActions(this.menu, { arg: context, shouldForwardArgs: false }, actions);
			this.contextMenuService.showContextMenu({
				getAnchor: () => e.anchor,
				getActions: () => actions,
				onHide: () => dispose(actionsDisposable)
			});
		}
	}
}

function isStackFrame(obj: any): obj is IStackFrame {
	return obj instanceof StackFrame;
}

export class VariablesDataSource implements IAsyncDataSource<IStackFrame | null, IExpression | IScope> {

	hasChildren(element: IStackFrame | null | IExpression | IScope): boolean {
		if (!element) {
			return false;
		}
		if (isStackFrame(element)) {
			return true;
		}

		return element.hasChildren;
	}

	getChildren(element: IStackFrame | IExpression | IScope): Promise<(IExpression | IScope)[]> {
		if (isStackFrame(element)) {
			return element.getScopes();
		}

		return element.getChildren();
	}
}

interface IScopeTemplateData {
	name: HTMLElement;
	label: HighlightedLabel;
}

class VariablesDelegate implements IListVirtualDelegate<IExpression | IScope> {

	getHeight(element: IExpression | IScope): number {
		return 22;
	}

	getTemplateId(element: IExpression | IScope): string {
		if (element instanceof ErrorScope) {
			return ScopeErrorRenderer.ID;
		}

		if (element instanceof Scope) {
			return ScopesRenderer.ID;
		}

		return VariablesRenderer.ID;
	}
}

class ScopesRenderer implements ITreeRenderer<IScope, FuzzyScore, IScopeTemplateData> {

	static readonly ID = 'scope';

	get templateId(): string {
		return ScopesRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IScopeTemplateData {
		const name = dom.append(container, $('.scope'));
		const label = new HighlightedLabel(name, false);

		return { name, label };
	}

	renderElement(element: ITreeNode<IScope, FuzzyScore>, index: number, templateData: IScopeTemplateData): void {
		templateData.label.set(element.element.name, createMatches(element.filterData));
	}

	disposeTemplate(templateData: IScopeTemplateData): void {
		// noop
	}
}

interface IScopeErrorTemplateData {
	error: HTMLElement;
}

class ScopeErrorRenderer implements ITreeRenderer<IScope, FuzzyScore, IScopeErrorTemplateData> {

	static readonly ID = 'scopeError';

	get templateId(): string {
		return ScopeErrorRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IScopeErrorTemplateData {
		const wrapper = dom.append(container, $('.scope'));
		const error = dom.append(wrapper, $('.error'));
		return { error };
	}

	renderElement(element: ITreeNode<IScope, FuzzyScore>, index: number, templateData: IScopeErrorTemplateData): void {
		templateData.error.innerText = element.element.name;
	}

	disposeTemplate(): void {
		// noop
	}
}

export class VariablesRenderer extends AbstractExpressionsRenderer {

	static readonly ID = 'variable';

	get templateId(): string {
		return VariablesRenderer.ID;
	}

	protected renderExpression(expression: IExpression, data: IExpressionTemplateData, highlights: IHighlight[]): void {
		renderVariable(expression as Variable, data, true, highlights);
	}

	protected getInputBoxOptions(expression: IExpression): IInputBoxOptions {
		const variable = <Variable>expression;
		return {
			initialValue: expression.value,
			ariaLabel: nls.localize('variableValueAriaLabel', "Type new variable value"),
			validationOptions: {
				validation: () => variable.errorMessage ? ({ content: variable.errorMessage }) : null
			},
			onFinish: (value: string, success: boolean) => {
				variable.errorMessage = undefined;
				if (success && variable.value !== value) {
					variable.setVariable(value)
						// Need to force watch expressions and variables to update since a variable change can have an effect on both
						.then(() => {
							// Do not refresh scopes due to a node limitation #15520
							forgetScopes = false;
							this.debugService.getViewModel().updateViews();
						});
				}
			}
		};
	}
}

class VariablesAccessibilityProvider implements IListAccessibilityProvider<IExpression | IScope> {

	getWidgetAriaLabel(): string {
		return nls.localize('variablesAriaTreeLabel', "Debug Variables");
	}

	getAriaLabel(element: IExpression | IScope): string | null {
		if (element instanceof Scope) {
			return nls.localize('variableScopeAriaLabel', "Scope {0}", element.name);
		}
		if (element instanceof Variable) {
			return nls.localize({ key: 'variableAriaLabel', comment: ['Placeholders are variable name and variable value respectivly. They should not be translated.'] }, "{0}, value {1}", element.name, element.value);
		}

		return null;
	}
}

export const SET_VARIABLE_ID = 'debug.setVariable';
CommandsRegistry.registerCommand({
	id: SET_VARIABLE_ID,
	handler: (accessor: ServicesAccessor) => {
		const debugService = accessor.get(IDebugService);
		debugService.getViewModel().setSelectedExpression(variableInternalContext);
	}
});

export const COPY_VALUE_ID = 'debug.copyValue';
CommandsRegistry.registerCommand({
	id: COPY_VALUE_ID,
	handler: async (accessor: ServicesAccessor) => {
		const instantiationService = accessor.get(IInstantiationService);
		if (variableInternalContext) {
			const action = instantiationService.createInstance(CopyValueAction, CopyValueAction.ID, CopyValueAction.LABEL, variableInternalContext, 'variables');
			await action.run();
		}
	}
});

export const BREAK_WHEN_VALUE_CHANGES_ID = 'debug.breakWhenValueChanges';
CommandsRegistry.registerCommand({
	id: BREAK_WHEN_VALUE_CHANGES_ID,
	handler: async (accessor: ServicesAccessor) => {
		const debugService = accessor.get(IDebugService);
		if (dataBreakpointInfoResponse) {
			await debugService.addDataBreakpoint(dataBreakpointInfoResponse.description, dataBreakpointInfoResponse.dataId!, !!dataBreakpointInfoResponse.canPersist, dataBreakpointInfoResponse.accessTypes);
		}
	}
});

export const COPY_EVALUATE_PATH_ID = 'debug.copyEvaluatePath';
CommandsRegistry.registerCommand({
	id: COPY_EVALUATE_PATH_ID,
	handler: async (accessor: ServicesAccessor, context: IVariablesContext) => {
		const clipboardService = accessor.get(IClipboardService);
		await clipboardService.writeText(context.variable.evaluateName!);
	}
});

export const ADD_TO_WATCH_ID = 'debug.addToWatchExpressions';
CommandsRegistry.registerCommand({
	id: ADD_TO_WATCH_ID,
	handler: async (accessor: ServicesAccessor, context: IVariablesContext) => {
		const debugService = accessor.get(IDebugService);
		debugService.addWatchExpression(context.variable.evaluateName);
	}
});

