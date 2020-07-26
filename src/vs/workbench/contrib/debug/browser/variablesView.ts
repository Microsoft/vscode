/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { RunOnceScheduler } from 'vs/base/common/async';
import * as dom from 'vs/base/browser/dom';
import { CollapseAction } from 'vs/workbench/browser/viewlet';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IDebugService, IExpression, IScope, CONTEXT_VARIABLES_FOCUSED, IStackFrame } from 'vs/workbench/contrib/debug/common/debug';
import { Variable, Scope, ErrorScope, StackFrame } from 'vs/workbench/contrib/debug/common/debugModel';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { renderViewTree, renderVariable, IInputBoxOptions, AbstractExpressionsRenderer, IExpressionTemplateData } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { IAction, Action, Separator } from 'vs/base/common/actions';
import { CopyValueAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITreeRenderer, ITreeNode, ITreeMouseEvent, ITreeContextMenuEvent, IAsyncDataSource } from 'vs/base/browser/ui/tree/tree';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Emitter } from 'vs/base/common/event';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { IAsyncDataTreeViewState } from 'vs/base/browser/ui/tree/asyncDataTree';
import { FuzzyScore, createMatches } from 'vs/base/common/filters';
import { HighlightedLabel, IHighlight } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { dispose } from 'vs/base/common/lifecycle';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { withUndefinedAsNull } from 'vs/base/common/types';

const $ = dom.$;
let forgetScopes = true;

export const variableSetEmitter = new Emitter<void>();

export class VariablesView extends ViewPane {

	private onFocusStackFrameScheduler: RunOnceScheduler;
	private needsRefresh = false;
	private tree!: WorkbenchAsyncDataTree<IStackFrame | null, IExpression | IScope, FuzzyScore>;
	private savedViewState = new Map<string, IAsyncDataTreeViewState>();
	private autoExpandedScopes = new Set<string>();

	constructor(
		options: IViewletViewOptions,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IDebugService private readonly debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		// Use scheduler to prevent unnecessary flashing
		this.onFocusStackFrameScheduler = new RunOnceScheduler(async () => {
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

		dom.addClass(this.element, 'debug-pane');
		dom.addClass(container, 'debug-variables');
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
			this.onFocusStackFrameScheduler.schedule(timeout);
		}));
		this._register(variableSetEmitter.event(() => {
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
				this.onFocusStackFrameScheduler.schedule();
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
		return [new CollapseAction(() => this.tree, true, 'explorer-action codicon-collapse-all')];
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
			const actions: IAction[] = [];
			const session = this.debugService.getViewModel().focusedSession;
			if (session && session.capabilities.supportsSetVariable) {
				actions.push(new Action('workbench.setValue', nls.localize('setValue', "Set Value"), undefined, true, () => {
					this.debugService.getViewModel().setSelectedExpression(variable);
					return Promise.resolve();
				}));
			}
			actions.push(this.instantiationService.createInstance(CopyValueAction, CopyValueAction.ID, CopyValueAction.LABEL, variable, 'variables'));
			if (variable.evaluateName) {
				actions.push(new Action('debug.copyEvaluatePath', nls.localize('copyAsExpression', "Copy as Expression"), undefined, true, () => {
					return this.clipboardService.writeText(variable.evaluateName!);
				}));
				actions.push(new Separator());
				actions.push(new Action('debug.addToWatchExpressions', nls.localize('addToWatchExpressions', "Add to Watch"), undefined, true, () => {
					this.debugService.addWatchExpression(variable.evaluateName);
					return Promise.resolve(undefined);
				}));
			}
			if (session && session.capabilities.supportsDataBreakpoints) {
				const response = await session.dataBreakpointInfo(variable.name, variable.parent.reference);
				const dataid = response?.dataId;
				if (response && dataid) {
					actions.push(new Separator());
					actions.push(new Action('debug.breakWhenValueChanges', nls.localize('breakWhenValueChanges', "Break When Value Changes"), undefined, true, () => {
						return this.debugService.addDataBreakpoint(response.description, dataid, !!response.canPersist, response.accessTypes);
					}));
				}
			}

			this.contextMenuService.showContextMenu({
				getAnchor: () => e.anchor,
				getActions: () => actions,
				getActionsContext: () => variable,
				onHide: () => dispose(actions)
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
							variableSetEmitter.fire();
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
