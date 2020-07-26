/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { RunOnceScheduler } from 'vs/base/common/async';
import * as dom from 'vs/base/browser/dom';
import { CollapseAction } from 'vs/workbench/browser/viewlet';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IDebugService, IExpression, CONTEXT_WATCH_EXPRESSIONS_FOCUSED } from 'vs/workbench/contrib/debug/common/debug';
import { Expression, Variable } from 'vs/workbench/contrib/debug/common/debugModel';
import { AddWatchExpressionAction, RemoveAllWatchExpressionsAction, CopyValueAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IAction, Action, Separator } from 'vs/base/common/actions';
import { renderExpressionValue, renderViewTree, IInputBoxOptions, AbstractExpressionsRenderer, IExpressionTemplateData } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { WorkbenchAsyncDataTree } from 'vs/platform/list/browser/listService';
import { IAsyncDataSource, ITreeMouseEvent, ITreeContextMenuEvent, ITreeDragAndDrop, ITreeDragOverReaction } from 'vs/base/browser/ui/tree/tree';
import { IDragAndDropData } from 'vs/base/browser/dnd';
import { ElementsDragAndDropData } from 'vs/base/browser/ui/list/listView';
import { FuzzyScore } from 'vs/base/common/filters';
import { IHighlight } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { variableSetEmitter, VariablesRenderer } from 'vs/workbench/contrib/debug/browser/variablesView';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { dispose } from 'vs/base/common/lifecycle';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';

const MAX_VALUE_RENDER_LENGTH_IN_VIEWLET = 1024;
let ignoreVariableSetEmitter = false;
let useCachedEvaluation = false;

export class WatchExpressionsView extends ViewPane {

	private onWatchExpressionsUpdatedScheduler: RunOnceScheduler;
	private needsRefresh = false;
	private tree!: WorkbenchAsyncDataTree<IDebugService | IExpression, IExpression, FuzzyScore>;

	constructor(
		options: IViewletViewOptions,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IDebugService private readonly debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		this.onWatchExpressionsUpdatedScheduler = new RunOnceScheduler(() => {
			this.needsRefresh = false;
			this.tree.updateChildren();
		}, 50);
	}

	renderBody(container: HTMLElement): void {
		super.renderBody(container);

		dom.addClass(this.element, 'debug-pane');
		dom.addClass(container, 'debug-watch');
		const treeContainer = renderViewTree(container);

		const expressionsRenderer = this.instantiationService.createInstance(WatchExpressionsRenderer);
		this.tree = <WorkbenchAsyncDataTree<IDebugService | IExpression, IExpression, FuzzyScore>>this.instantiationService.createInstance(WorkbenchAsyncDataTree, 'WatchExpressions', treeContainer, new WatchExpressionsDelegate(), [expressionsRenderer, this.instantiationService.createInstance(VariablesRenderer)],
			new WatchExpressionsDataSource(), {
			accessibilityProvider: new WatchExpressionsAccessibilityProvider(),
			identityProvider: { getId: (element: IExpression) => element.getId() },
			keyboardNavigationLabelProvider: {
				getKeyboardNavigationLabel: (e: IExpression) => {
					if (e === this.debugService.getViewModel().getSelectedExpression()) {
						// Don't filter input box
						return undefined;
					}

					return e;
				}
			},
			dnd: new WatchExpressionsDragAndDrop(this.debugService),
			overrideStyles: {
				listBackground: this.getBackgroundColor()
			}
		});
		this.tree.setInput(this.debugService);
		CONTEXT_WATCH_EXPRESSIONS_FOCUSED.bindTo(this.tree.contextKeyService);

		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));
		this._register(this.tree.onMouseDblClick(e => this.onMouseDblClick(e)));
		this._register(this.debugService.getModel().onDidChangeWatchExpressions(async we => {
			if (!this.isBodyVisible()) {
				this.needsRefresh = true;
			} else {
				if (we && !we.name) {
					// We are adding a new input box, no need to re-evaluate watch expressions
					useCachedEvaluation = true;
				}
				await this.tree.updateChildren();
				useCachedEvaluation = false;
				if (we instanceof Expression) {
					this.tree.reveal(we);
				}
			}
		}));
		this._register(this.debugService.getViewModel().onDidFocusStackFrame(() => {
			if (!this.isBodyVisible()) {
				this.needsRefresh = true;
				return;
			}

			if (!this.onWatchExpressionsUpdatedScheduler.isScheduled()) {
				this.onWatchExpressionsUpdatedScheduler.schedule();
			}
		}));
		this._register(variableSetEmitter.event(() => {
			if (!ignoreVariableSetEmitter) {
				this.tree.updateChildren();
			}
		}));

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible && this.needsRefresh) {
				this.onWatchExpressionsUpdatedScheduler.schedule();
			}
		}));
		let horizontalScrolling: boolean | undefined;
		this._register(this.debugService.getViewModel().onDidSelectExpression(e => {
			if (e instanceof Expression && e.name) {
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
	}

	layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
	}

	focus(): void {
		this.tree.domFocus();
	}

	getActions(): IAction[] {
		return [
			new AddWatchExpressionAction(AddWatchExpressionAction.ID, AddWatchExpressionAction.LABEL, this.debugService, this.keybindingService),
			new CollapseAction(() => this.tree, true, 'explorer-action codicon-collapse-all'),
			new RemoveAllWatchExpressionsAction(RemoveAllWatchExpressionsAction.ID, RemoveAllWatchExpressionsAction.LABEL, this.debugService, this.keybindingService)
		];
	}

	private onMouseDblClick(e: ITreeMouseEvent<IExpression>): void {
		if ((e.browserEvent.target as HTMLElement).className.indexOf('twistie') >= 0) {
			// Ignore double click events on twistie
			return;
		}

		const element = e.element;
		// double click on primitive value: open input box to be able to select and copy value.
		if (element instanceof Expression && element !== this.debugService.getViewModel().getSelectedExpression()) {
			this.debugService.getViewModel().setSelectedExpression(element);
		} else if (!element) {
			// Double click in watch panel triggers to add a new watch expression
			this.debugService.addWatchExpression();
		}
	}

	private onContextMenu(e: ITreeContextMenuEvent<IExpression>): void {
		const element = e.element;
		const anchor = e.anchor;
		if (!anchor) {
			return;
		}
		const actions: IAction[] = [];

		if (element instanceof Expression) {
			const expression = <Expression>element;
			actions.push(new AddWatchExpressionAction(AddWatchExpressionAction.ID, AddWatchExpressionAction.LABEL, this.debugService, this.keybindingService));
			actions.push(new Action('debug.editWatchExpression', nls.localize('editWatchExpression', "Edit Expression"), undefined, true, () => {
				this.debugService.getViewModel().setSelectedExpression(expression);
				return Promise.resolve();
			}));
			actions.push(this.instantiationService.createInstance(CopyValueAction, CopyValueAction.ID, CopyValueAction.LABEL, expression, 'watch'));
			actions.push(new Separator());

			actions.push(new Action('debug.removeWatchExpression', nls.localize('removeWatchExpression', "Remove Expression"), undefined, true, () => {
				this.debugService.removeWatchExpressions(expression.getId());
				return Promise.resolve();
			}));
			actions.push(new RemoveAllWatchExpressionsAction(RemoveAllWatchExpressionsAction.ID, RemoveAllWatchExpressionsAction.LABEL, this.debugService, this.keybindingService));
		} else {
			actions.push(new AddWatchExpressionAction(AddWatchExpressionAction.ID, AddWatchExpressionAction.LABEL, this.debugService, this.keybindingService));
			if (element instanceof Variable) {
				const variable = element as Variable;
				actions.push(this.instantiationService.createInstance(CopyValueAction, CopyValueAction.ID, CopyValueAction.LABEL, variable, 'watch'));
				actions.push(new Separator());
			}
			actions.push(new RemoveAllWatchExpressionsAction(RemoveAllWatchExpressionsAction.ID, RemoveAllWatchExpressionsAction.LABEL, this.debugService, this.keybindingService));
		}

		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions,
			getActionsContext: () => element,
			onHide: () => dispose(actions)
		});
	}
}

class WatchExpressionsDelegate implements IListVirtualDelegate<IExpression> {

	getHeight(_element: IExpression): number {
		return 22;
	}

	getTemplateId(element: IExpression): string {
		if (element instanceof Expression) {
			return WatchExpressionsRenderer.ID;
		}

		// Variable
		return VariablesRenderer.ID;
	}
}

function isDebugService(element: any): element is IDebugService {
	return typeof element.getConfigurationManager === 'function';
}

class WatchExpressionsDataSource implements IAsyncDataSource<IDebugService, IExpression> {

	hasChildren(element: IExpression | IDebugService): boolean {
		return isDebugService(element) || element.hasChildren;
	}

	getChildren(element: IDebugService | IExpression): Promise<Array<IExpression>> {
		if (isDebugService(element)) {
			const debugService = element as IDebugService;
			const watchExpressions = debugService.getModel().getWatchExpressions();
			const viewModel = debugService.getViewModel();
			return Promise.all(watchExpressions.map(we => !!we.name && !useCachedEvaluation
				? we.evaluate(viewModel.focusedSession!, viewModel.focusedStackFrame!, 'watch').then(() => we)
				: Promise.resolve(we)));
		}

		return element.getChildren();
	}
}


export class WatchExpressionsRenderer extends AbstractExpressionsRenderer {

	static readonly ID = 'watchexpression';

	get templateId() {
		return WatchExpressionsRenderer.ID;
	}

	protected renderExpression(expression: IExpression, data: IExpressionTemplateData, highlights: IHighlight[]): void {
		const text = typeof expression.value === 'string' ? `${expression.name}:` : expression.name;
		data.label.set(text, highlights, expression.type ? expression.type : expression.value);
		renderExpressionValue(expression, data.value, {
			showChanged: true,
			maxValueLength: MAX_VALUE_RENDER_LENGTH_IN_VIEWLET,
			showHover: true,
			colorize: true
		});
	}

	protected getInputBoxOptions(expression: IExpression): IInputBoxOptions {
		return {
			initialValue: expression.name ? expression.name : '',
			ariaLabel: nls.localize('watchExpressionInputAriaLabel', "Type watch expression"),
			placeholder: nls.localize('watchExpressionPlaceholder', "Expression to watch"),
			onFinish: (value: string, success: boolean) => {
				if (success && value) {
					this.debugService.renameWatchExpression(expression.getId(), value);
					ignoreVariableSetEmitter = true;
					variableSetEmitter.fire();
					ignoreVariableSetEmitter = false;
				} else if (!expression.name) {
					this.debugService.removeWatchExpressions(expression.getId());
				}
			}
		};
	}
}

class WatchExpressionsAccessibilityProvider implements IListAccessibilityProvider<IExpression> {

	getWidgetAriaLabel(): string {
		return nls.localize({ comment: ['Debug is a noun in this context, not a verb.'], key: 'watchAriaTreeLabel' }, "Debug Watch Expressions");
	}

	getAriaLabel(element: IExpression): string {
		if (element instanceof Expression) {
			return nls.localize('watchExpressionAriaLabel', "{0}, value {1}", (<Expression>element).name, (<Expression>element).value);
		}

		// Variable
		return nls.localize('watchVariableAriaLabel', "{0}, value {1}", (<Variable>element).name, (<Variable>element).value);
	}
}

class WatchExpressionsDragAndDrop implements ITreeDragAndDrop<IExpression> {

	constructor(private debugService: IDebugService) { }

	onDragOver(data: IDragAndDropData): boolean | ITreeDragOverReaction {
		if (!(data instanceof ElementsDragAndDropData)) {
			return false;
		}

		const expressions = (data as ElementsDragAndDropData<IExpression>).elements;
		return expressions.length > 0 && expressions[0] instanceof Expression;
	}

	getDragURI(element: IExpression): string | null {
		if (!(element instanceof Expression) || element === this.debugService.getViewModel().getSelectedExpression()) {
			return null;
		}

		return element.getId();
	}

	getDragLabel(elements: IExpression[]): string | undefined {
		if (elements.length === 1) {
			return elements[0].name;
		}

		return undefined;
	}

	drop(data: IDragAndDropData, targetElement: IExpression): void {
		if (!(data instanceof ElementsDragAndDropData)) {
			return;
		}

		const draggedElement = (data as ElementsDragAndDropData<IExpression>).elements[0];
		const watches = this.debugService.getModel().getWatchExpressions();
		const position = targetElement instanceof Expression ? watches.indexOf(targetElement) : watches.length - 1;
		this.debugService.moveWatchExpression(draggedElement.getId(), position);
	}
}
