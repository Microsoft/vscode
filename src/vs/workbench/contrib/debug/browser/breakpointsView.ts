/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as resources from 'vs/base/common/resources';
import * as dom from 'vs/base/browser/dom';
import { IAction, Action, Separator } from 'vs/base/common/actions';
import { IDebugService, IBreakpoint, CONTEXT_BREAKPOINTS_FOCUSED, State, DEBUG_SCHEME, IFunctionBreakpoint, IExceptionBreakpoint, IEnablement, BREAKPOINT_EDITOR_CONTRIBUTION_ID, IBreakpointEditorContribution, IDebugModel, IDataBreakpoint } from 'vs/workbench/contrib/debug/common/debug';
import { ExceptionBreakpoint, FunctionBreakpoint, Breakpoint, DataBreakpoint } from 'vs/workbench/contrib/debug/common/debugModel';
import { AddFunctionBreakpointAction, ToggleBreakpointsActivatedAction, RemoveAllBreakpointsAction, RemoveBreakpointAction, EnableAllBreakpointsAction, DisableAllBreakpointsAction, ReapplyBreakpointsAction } from 'vs/workbench/contrib/debug/browser/debugActions';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { Constants } from 'vs/base/common/uint';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { IListVirtualDelegate, IListContextMenuEvent, IListRenderer } from 'vs/base/browser/ui/list/list';
import { IEditorPane } from 'vs/workbench/common/editor';
import { InputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { WorkbenchList, ListResourceNavigator } from 'vs/platform/list/browser/listService';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { attachInputBoxStyler } from 'vs/platform/theme/common/styler';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { ILabelService } from 'vs/platform/label/common/label';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Gesture } from 'vs/base/browser/touch';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { TextEditorSelectionRevealType } from 'vs/platform/editor/common/editor';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { Orientation } from 'vs/base/browser/ui/splitview/splitview';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';

const $ = dom.$;

function createCheckbox(): HTMLInputElement {
	const checkbox = <HTMLInputElement>$('input');
	checkbox.type = 'checkbox';
	checkbox.tabIndex = -1;
	Gesture.ignoreTarget(checkbox);

	return checkbox;
}

const MAX_VISIBLE_BREAKPOINTS = 9;
export function getExpandedBodySize(model: IDebugModel, countLimit: number): number {
	const length = model.getBreakpoints().length + model.getExceptionBreakpoints().length + model.getFunctionBreakpoints().length + model.getDataBreakpoints().length;
	return Math.min(countLimit, length) * 22;
}
type BreakpointItem = IBreakpoint | IFunctionBreakpoint | IDataBreakpoint | IExceptionBreakpoint;

export class BreakpointsView extends ViewPane {

	private list!: WorkbenchList<BreakpointItem>;
	private needsRefresh = false;
	private ignoreLayout = false;

	constructor(
		options: IViewletViewOptions,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IDebugService private readonly debugService: IDebugService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IEditorService private readonly editorService: IEditorService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IConfigurationService configurationService: IConfigurationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ILabelService private readonly labelService: ILabelService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		this._register(this.debugService.getModel().onDidChangeBreakpoints(() => this.onBreakpointsChange()));
	}

	public renderBody(container: HTMLElement): void {
		super.renderBody(container);

		dom.addClass(this.element, 'debug-pane');
		dom.addClass(container, 'debug-breakpoints');
		const delegate = new BreakpointsDelegate(this.debugService);

		this.list = <WorkbenchList<BreakpointItem>>this.instantiationService.createInstance(WorkbenchList, 'Breakpoints', container, delegate, [
			this.instantiationService.createInstance(BreakpointsRenderer),
			new ExceptionBreakpointsRenderer(this.debugService),
			this.instantiationService.createInstance(FunctionBreakpointsRenderer),
			this.instantiationService.createInstance(DataBreakpointsRenderer),
			new FunctionBreakpointInputRenderer(this.debugService, this.contextViewService, this.themeService, this.labelService)
		], {
			identityProvider: { getId: (element: IEnablement) => element.getId() },
			multipleSelectionSupport: false,
			keyboardNavigationLabelProvider: { getKeyboardNavigationLabel: (e: IEnablement) => e },
			accessibilityProvider: new BreakpointsAccessibilityProvider(this.debugService, this.labelService),
			overrideStyles: {
				listBackground: this.getBackgroundColor()
			}
		});

		CONTEXT_BREAKPOINTS_FOCUSED.bindTo(this.list.contextKeyService);

		this._register(this.list.onContextMenu(this.onListContextMenu, this));

		this.list.onMouseMiddleClick(async ({ element }) => {
			if (element instanceof Breakpoint) {
				await this.debugService.removeBreakpoints(element.getId());
			} else if (element instanceof FunctionBreakpoint) {
				await this.debugService.removeFunctionBreakpoints(element.getId());
			} else if (element instanceof DataBreakpoint) {
				await this.debugService.removeDataBreakpoints(element.getId());
			}
		});

		const resourceNavigator = this._register(new ListResourceNavigator(this.list, { configurationService: this.configurationService }));
		this._register(resourceNavigator.onDidOpen(async e => {
			if (e.element === null) {
				return;
			}

			if (e.browserEvent instanceof MouseEvent && e.browserEvent.button === 1) { // middle click
				return;
			}

			const element = this.list.element(e.element);

			if (element instanceof Breakpoint) {
				openBreakpointSource(element, e.sideBySide, e.editorOptions.preserveFocus || false, this.debugService, this.editorService);
			}
			if (e.browserEvent instanceof MouseEvent && e.browserEvent.detail === 2 && element instanceof FunctionBreakpoint && element !== this.debugService.getViewModel().getSelectedFunctionBreakpoint()) {
				// double click
				this.debugService.getViewModel().setSelectedFunctionBreakpoint(element);
				this.onBreakpointsChange();
			}
		}));

		this.list.splice(0, this.list.length, this.elements);

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible && this.needsRefresh) {
				this.onBreakpointsChange();
			}
		}));

		const containerModel = this.viewDescriptorService.getViewContainerModel(this.viewDescriptorService.getViewContainerByViewId(this.id)!)!;
		this._register(containerModel.onDidChangeAllViewDescriptors(() => {
			this.updateSize();
		}));
	}

	public focus(): void {
		super.focus();
		if (this.list) {
			this.list.domFocus();
		}
	}

	protected layoutBody(height: number, width: number): void {
		if (this.ignoreLayout) {
			return;
		}

		super.layoutBody(height, width);
		if (this.list) {
			this.list.layout(height, width);
		}
		try {
			this.ignoreLayout = true;
			this.updateSize();
		} finally {
			this.ignoreLayout = false;
		}
	}

	private onListContextMenu(e: IListContextMenuEvent<IEnablement>): void {
		if (!e.element) {
			return;
		}

		const actions: IAction[] = [];
		const element = e.element;

		const breakpointType = element instanceof Breakpoint && element.logMessage ? nls.localize('Logpoint', "Logpoint") : nls.localize('Breakpoint', "Breakpoint");
		if (element instanceof Breakpoint || element instanceof FunctionBreakpoint) {
			actions.push(new Action('workbench.action.debug.openEditorAndEditBreakpoint', nls.localize('editBreakpoint', "Edit {0}...", breakpointType), '', true, async () => {
				if (element instanceof Breakpoint) {
					const editor = await openBreakpointSource(element, false, false, this.debugService, this.editorService);
					if (editor) {
						const codeEditor = editor.getControl();
						if (isCodeEditor(codeEditor)) {
							codeEditor.getContribution<IBreakpointEditorContribution>(BREAKPOINT_EDITOR_CONTRIBUTION_ID).showBreakpointWidget(element.lineNumber, element.column);
						}
					}
				} else {
					this.debugService.getViewModel().setSelectedFunctionBreakpoint(element);
					this.onBreakpointsChange();
				}
			}));
			actions.push(new Separator());
		}

		actions.push(new RemoveBreakpointAction(RemoveBreakpointAction.ID, nls.localize('removeBreakpoint', "Remove {0}", breakpointType), this.debugService));

		if (this.debugService.getModel().getBreakpoints().length + this.debugService.getModel().getFunctionBreakpoints().length > 1) {
			actions.push(new RemoveAllBreakpointsAction(RemoveAllBreakpointsAction.ID, RemoveAllBreakpointsAction.LABEL, this.debugService, this.keybindingService));
			actions.push(new Separator());

			actions.push(new EnableAllBreakpointsAction(EnableAllBreakpointsAction.ID, EnableAllBreakpointsAction.LABEL, this.debugService, this.keybindingService));
			actions.push(new DisableAllBreakpointsAction(DisableAllBreakpointsAction.ID, DisableAllBreakpointsAction.LABEL, this.debugService, this.keybindingService));
		}

		actions.push(new Separator());
		actions.push(new ReapplyBreakpointsAction(ReapplyBreakpointsAction.ID, ReapplyBreakpointsAction.LABEL, this.debugService, this.keybindingService));

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor,
			getActions: () => actions,
			getActionsContext: () => element,
			onHide: () => dispose(actions)
		});
	}

	public getActions(): IAction[] {
		return [
			new AddFunctionBreakpointAction(AddFunctionBreakpointAction.ID, AddFunctionBreakpointAction.LABEL, this.debugService, this.keybindingService),
			new ToggleBreakpointsActivatedAction(ToggleBreakpointsActivatedAction.ID, ToggleBreakpointsActivatedAction.ACTIVATE_LABEL, this.debugService, this.keybindingService),
			new RemoveAllBreakpointsAction(RemoveAllBreakpointsAction.ID, RemoveAllBreakpointsAction.LABEL, this.debugService, this.keybindingService)
		];
	}

	private updateSize(): void {
		const containerModel = this.viewDescriptorService.getViewContainerModel(this.viewDescriptorService.getViewContainerByViewId(this.id)!)!;

		// Adjust expanded body size
		this.minimumBodySize = this.orientation === Orientation.VERTICAL ? getExpandedBodySize(this.debugService.getModel(), MAX_VISIBLE_BREAKPOINTS) : 170;
		this.maximumBodySize = this.orientation === Orientation.VERTICAL && containerModel.visibleViewDescriptors.length > 1 ? getExpandedBodySize(this.debugService.getModel(), Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
	}

	private onBreakpointsChange(): void {
		if (this.isBodyVisible()) {
			this.updateSize();
			if (this.list) {
				const lastFocusIndex = this.list.getFocus()[0];
				// Check whether focused element was removed
				const needsRefocus = lastFocusIndex && !this.elements.includes(this.list.element(lastFocusIndex));
				this.list.splice(0, this.list.length, this.elements);
				this.needsRefresh = false;
				if (needsRefocus) {
					this.list.focusNth(Math.min(lastFocusIndex, this.list.length - 1));
				}
			}
		} else {
			this.needsRefresh = true;
		}
	}

	private get elements(): BreakpointItem[] {
		const model = this.debugService.getModel();
		const elements = (<ReadonlyArray<IEnablement>>model.getExceptionBreakpoints()).concat(model.getFunctionBreakpoints()).concat(model.getDataBreakpoints()).concat(model.getBreakpoints());

		return elements as BreakpointItem[];
	}
}

class BreakpointsDelegate implements IListVirtualDelegate<BreakpointItem> {

	constructor(private debugService: IDebugService) {
		// noop
	}

	getHeight(_element: BreakpointItem): number {
		return 22;
	}

	getTemplateId(element: BreakpointItem): string {
		if (element instanceof Breakpoint) {
			return BreakpointsRenderer.ID;
		}
		if (element instanceof FunctionBreakpoint) {
			const selected = this.debugService.getViewModel().getSelectedFunctionBreakpoint();
			if (!element.name || (selected && selected.getId() === element.getId())) {
				return FunctionBreakpointInputRenderer.ID;
			}

			return FunctionBreakpointsRenderer.ID;
		}
		if (element instanceof ExceptionBreakpoint) {
			return ExceptionBreakpointsRenderer.ID;
		}
		if (element instanceof DataBreakpoint) {
			return DataBreakpointsRenderer.ID;
		}

		return '';
	}
}

interface IBaseBreakpointTemplateData {
	breakpoint: HTMLElement;
	name: HTMLElement;
	checkbox: HTMLInputElement;
	context: BreakpointItem;
	toDispose: IDisposable[];
}

interface IBaseBreakpointWithIconTemplateData extends IBaseBreakpointTemplateData {
	icon: HTMLElement;
}

interface IBreakpointTemplateData extends IBaseBreakpointWithIconTemplateData {
	lineNumber: HTMLElement;
	filePath: HTMLElement;
}

interface IInputTemplateData {
	inputBox: InputBox;
	checkbox: HTMLInputElement;
	icon: HTMLElement;
	breakpoint: IFunctionBreakpoint;
	reactedOnEvent: boolean;
	toDispose: IDisposable[];
}

class BreakpointsRenderer implements IListRenderer<IBreakpoint, IBreakpointTemplateData> {

	constructor(
		@IDebugService private readonly debugService: IDebugService,
		@ILabelService private readonly labelService: ILabelService
	) {
		// noop
	}

	static readonly ID = 'breakpoints';

	get templateId() {
		return BreakpointsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IBreakpointTemplateData {
		const data: IBreakpointTemplateData = Object.create(null);
		data.breakpoint = dom.append(container, $('.breakpoint'));

		data.icon = $('.icon');
		data.checkbox = createCheckbox();
		data.toDispose = [];
		data.toDispose.push(dom.addStandardDisposableListener(data.checkbox, 'change', (e) => {
			this.debugService.enableOrDisableBreakpoints(!data.context.enabled, data.context);
		}));

		dom.append(data.breakpoint, data.icon);
		dom.append(data.breakpoint, data.checkbox);

		data.name = dom.append(data.breakpoint, $('span.name'));

		data.filePath = dom.append(data.breakpoint, $('span.file-path'));
		const lineNumberContainer = dom.append(data.breakpoint, $('.line-number-container'));
		data.lineNumber = dom.append(lineNumberContainer, $('span.line-number.monaco-count-badge'));

		return data;
	}

	renderElement(breakpoint: IBreakpoint, index: number, data: IBreakpointTemplateData): void {
		data.context = breakpoint;
		dom.toggleClass(data.breakpoint, 'disabled', !this.debugService.getModel().areBreakpointsActivated());

		data.name.textContent = resources.basenameOrAuthority(breakpoint.uri);
		data.lineNumber.textContent = breakpoint.lineNumber.toString();
		if (breakpoint.column) {
			data.lineNumber.textContent += `:${breakpoint.column}`;
		}
		data.filePath.textContent = this.labelService.getUriLabel(resources.dirname(breakpoint.uri), { relative: true });
		data.checkbox.checked = breakpoint.enabled;

		const { message, className } = getBreakpointMessageAndClassName(this.debugService.state, this.debugService.getModel().areBreakpointsActivated(), breakpoint, this.labelService);
		data.icon.className = `codicon ${className}`;
		data.breakpoint.title = breakpoint.message || message || '';

		const debugActive = this.debugService.state === State.Running || this.debugService.state === State.Stopped;
		if (debugActive && !breakpoint.verified) {
			dom.addClass(data.breakpoint, 'disabled');
		}
	}

	disposeTemplate(templateData: IBreakpointTemplateData): void {
		dispose(templateData.toDispose);
	}
}

class ExceptionBreakpointsRenderer implements IListRenderer<IExceptionBreakpoint, IBaseBreakpointTemplateData> {

	constructor(
		private debugService: IDebugService
	) {
		// noop
	}

	static readonly ID = 'exceptionbreakpoints';

	get templateId() {
		return ExceptionBreakpointsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IBaseBreakpointTemplateData {
		const data: IBreakpointTemplateData = Object.create(null);
		data.breakpoint = dom.append(container, $('.breakpoint'));

		data.checkbox = createCheckbox();
		data.toDispose = [];
		data.toDispose.push(dom.addStandardDisposableListener(data.checkbox, 'change', (e) => {
			this.debugService.enableOrDisableBreakpoints(!data.context.enabled, data.context);
		}));

		dom.append(data.breakpoint, data.checkbox);

		data.name = dom.append(data.breakpoint, $('span.name'));
		dom.addClass(data.breakpoint, 'exception');

		return data;
	}

	renderElement(exceptionBreakpoint: IExceptionBreakpoint, index: number, data: IBaseBreakpointTemplateData): void {
		data.context = exceptionBreakpoint;
		data.name.textContent = exceptionBreakpoint.label || `${exceptionBreakpoint.filter} exceptions`;
		data.breakpoint.title = data.name.textContent;
		data.checkbox.checked = exceptionBreakpoint.enabled;
	}

	disposeTemplate(templateData: IBaseBreakpointTemplateData): void {
		dispose(templateData.toDispose);
	}
}

class FunctionBreakpointsRenderer implements IListRenderer<FunctionBreakpoint, IBaseBreakpointWithIconTemplateData> {

	constructor(
		@IDebugService private readonly debugService: IDebugService,
		@ILabelService private readonly labelService: ILabelService
	) {
		// noop
	}

	static readonly ID = 'functionbreakpoints';

	get templateId() {
		return FunctionBreakpointsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IBaseBreakpointWithIconTemplateData {
		const data: IBreakpointTemplateData = Object.create(null);
		data.breakpoint = dom.append(container, $('.breakpoint'));

		data.icon = $('.icon');
		data.checkbox = createCheckbox();
		data.toDispose = [];
		data.toDispose.push(dom.addStandardDisposableListener(data.checkbox, 'change', (e) => {
			this.debugService.enableOrDisableBreakpoints(!data.context.enabled, data.context);
		}));

		dom.append(data.breakpoint, data.icon);
		dom.append(data.breakpoint, data.checkbox);

		data.name = dom.append(data.breakpoint, $('span.name'));

		return data;
	}

	renderElement(functionBreakpoint: FunctionBreakpoint, _index: number, data: IBaseBreakpointWithIconTemplateData): void {
		data.context = functionBreakpoint;
		data.name.textContent = functionBreakpoint.name;
		const { className, message } = getBreakpointMessageAndClassName(this.debugService.state, this.debugService.getModel().areBreakpointsActivated(), functionBreakpoint, this.labelService);
		data.icon.className = `codicon ${className}`;
		data.icon.title = message ? message : '';
		data.checkbox.checked = functionBreakpoint.enabled;
		data.breakpoint.title = message ? message : '';

		// Mark function breakpoints as disabled if deactivated or if debug type does not support them #9099
		const session = this.debugService.getViewModel().focusedSession;
		dom.toggleClass(data.breakpoint, 'disabled', (session && !session.capabilities.supportsFunctionBreakpoints) || !this.debugService.getModel().areBreakpointsActivated());
		if (session && !session.capabilities.supportsFunctionBreakpoints) {
			data.breakpoint.title = nls.localize('functionBreakpointsNotSupported', "Function breakpoints are not supported by this debug type");
		}
	}

	disposeTemplate(templateData: IBaseBreakpointWithIconTemplateData): void {
		dispose(templateData.toDispose);
	}
}

class DataBreakpointsRenderer implements IListRenderer<DataBreakpoint, IBaseBreakpointWithIconTemplateData> {

	constructor(
		@IDebugService private readonly debugService: IDebugService,
		@ILabelService private readonly labelService: ILabelService
	) {
		// noop
	}

	static readonly ID = 'databreakpoints';

	get templateId() {
		return DataBreakpointsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IBaseBreakpointWithIconTemplateData {
		const data: IBreakpointTemplateData = Object.create(null);
		data.breakpoint = dom.append(container, $('.breakpoint'));

		data.icon = $('.icon');
		data.checkbox = createCheckbox();
		data.toDispose = [];
		data.toDispose.push(dom.addStandardDisposableListener(data.checkbox, 'change', (e) => {
			this.debugService.enableOrDisableBreakpoints(!data.context.enabled, data.context);
		}));

		dom.append(data.breakpoint, data.icon);
		dom.append(data.breakpoint, data.checkbox);

		data.name = dom.append(data.breakpoint, $('span.name'));

		return data;
	}

	renderElement(dataBreakpoint: DataBreakpoint, _index: number, data: IBaseBreakpointWithIconTemplateData): void {
		data.context = dataBreakpoint;
		data.name.textContent = dataBreakpoint.description;
		const { className, message } = getBreakpointMessageAndClassName(this.debugService.state, this.debugService.getModel().areBreakpointsActivated(), dataBreakpoint, this.labelService);
		data.icon.className = `codicon ${className}`;
		data.icon.title = message ? message : '';
		data.checkbox.checked = dataBreakpoint.enabled;
		data.breakpoint.title = message ? message : '';

		// Mark function breakpoints as disabled if deactivated or if debug type does not support them #9099
		const session = this.debugService.getViewModel().focusedSession;
		dom.toggleClass(data.breakpoint, 'disabled', (session && !session.capabilities.supportsDataBreakpoints) || !this.debugService.getModel().areBreakpointsActivated());
		if (session && !session.capabilities.supportsDataBreakpoints) {
			data.breakpoint.title = nls.localize('dataBreakpointsNotSupported', "Data breakpoints are not supported by this debug type");
		}
	}

	disposeTemplate(templateData: IBaseBreakpointWithIconTemplateData): void {
		dispose(templateData.toDispose);
	}
}

class FunctionBreakpointInputRenderer implements IListRenderer<IFunctionBreakpoint, IInputTemplateData> {

	constructor(
		private debugService: IDebugService,
		private contextViewService: IContextViewService,
		private themeService: IThemeService,
		private labelService: ILabelService
	) {
		// noop
	}

	static readonly ID = 'functionbreakpointinput';

	get templateId() {
		return FunctionBreakpointInputRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IInputTemplateData {
		const template: IInputTemplateData = Object.create(null);

		const breakpoint = dom.append(container, $('.breakpoint'));
		template.icon = $('.icon');
		template.checkbox = createCheckbox();

		dom.append(breakpoint, template.icon);
		dom.append(breakpoint, template.checkbox);
		const inputBoxContainer = dom.append(breakpoint, $('.inputBoxContainer'));
		const inputBox = new InputBox(inputBoxContainer, this.contextViewService, {
			placeholder: nls.localize('functionBreakpointPlaceholder', "Function to break on"),
			ariaLabel: nls.localize('functionBreakPointInputAriaLabel', "Type function breakpoint")
		});
		const styler = attachInputBoxStyler(inputBox, this.themeService);
		const toDispose: IDisposable[] = [inputBox, styler];

		const wrapUp = (renamed: boolean) => {
			if (!template.reactedOnEvent) {
				template.reactedOnEvent = true;
				this.debugService.getViewModel().setSelectedFunctionBreakpoint(undefined);
				if (inputBox.value && (renamed || template.breakpoint.name)) {
					this.debugService.renameFunctionBreakpoint(template.breakpoint.getId(), renamed ? inputBox.value : template.breakpoint.name);
				} else {
					this.debugService.removeFunctionBreakpoints(template.breakpoint.getId());
				}
			}
		};

		toDispose.push(dom.addStandardDisposableListener(inputBox.inputElement, 'keydown', (e: IKeyboardEvent) => {
			const isEscape = e.equals(KeyCode.Escape);
			const isEnter = e.equals(KeyCode.Enter);
			if (isEscape || isEnter) {
				e.preventDefault();
				e.stopPropagation();
				wrapUp(isEnter);
			}
		}));
		toDispose.push(dom.addDisposableListener(inputBox.inputElement, 'blur', () => {
			// Need to react with a timeout on the blur event due to possible concurent splices #56443
			setTimeout(() => {
				if (!template.breakpoint.name) {
					wrapUp(true);
				}
			});
		}));

		template.inputBox = inputBox;
		template.toDispose = toDispose;
		return template;
	}

	renderElement(functionBreakpoint: FunctionBreakpoint, _index: number, data: IInputTemplateData): void {
		data.breakpoint = functionBreakpoint;
		data.reactedOnEvent = false;
		const { className, message } = getBreakpointMessageAndClassName(this.debugService.state, this.debugService.getModel().areBreakpointsActivated(), functionBreakpoint, this.labelService);

		data.icon.className = `codicon ${className}`;
		data.icon.title = message ? message : '';
		data.checkbox.checked = functionBreakpoint.enabled;
		data.checkbox.disabled = true;
		data.inputBox.value = functionBreakpoint.name || '';
		setTimeout(() => {
			data.inputBox.focus();
			data.inputBox.select();
		}, 0);
	}

	disposeTemplate(templateData: IInputTemplateData): void {
		dispose(templateData.toDispose);
	}
}

class BreakpointsAccessibilityProvider implements IListAccessibilityProvider<BreakpointItem> {

	constructor(
		private readonly debugService: IDebugService,
		private readonly labelService: ILabelService
	) { }

	getWidgetAriaLabel(): string {
		return nls.localize('breakpoints', "Breakpoints");
	}

	getRole() {
		return 'checkbox';
	}

	isChecked(breakpoint: IEnablement) {
		return breakpoint.enabled;
	}

	getAriaLabel(element: BreakpointItem): string | null {
		if (element instanceof ExceptionBreakpoint) {
			return element.toString();
		}

		const { message } = getBreakpointMessageAndClassName(this.debugService.state, this.debugService.getModel().areBreakpointsActivated(), element as IBreakpoint | IDataBreakpoint | IFunctionBreakpoint, this.labelService);
		const toString = element.toString();

		return message ? `${toString}, ${message}` : toString;
	}
}

export function openBreakpointSource(breakpoint: IBreakpoint, sideBySide: boolean, preserveFocus: boolean, debugService: IDebugService, editorService: IEditorService): Promise<IEditorPane | undefined> {
	if (breakpoint.uri.scheme === DEBUG_SCHEME && debugService.state === State.Inactive) {
		return Promise.resolve(undefined);
	}

	const selection = breakpoint.endLineNumber ? {
		startLineNumber: breakpoint.lineNumber,
		endLineNumber: breakpoint.endLineNumber,
		startColumn: breakpoint.column || 1,
		endColumn: breakpoint.endColumn || Constants.MAX_SAFE_SMALL_INTEGER
	} : {
			startLineNumber: breakpoint.lineNumber,
			startColumn: breakpoint.column || 1,
			endLineNumber: breakpoint.lineNumber,
			endColumn: breakpoint.column || Constants.MAX_SAFE_SMALL_INTEGER
		};

	return editorService.openEditor({
		resource: breakpoint.uri,
		options: {
			preserveFocus,
			selection,
			revealIfOpened: true,
			selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport,
			pinned: !preserveFocus
		}
	}, sideBySide ? SIDE_GROUP : ACTIVE_GROUP);
}

export function getBreakpointMessageAndClassName(state: State, breakpointsActivated: boolean, breakpoint: IBreakpoint | IFunctionBreakpoint | IDataBreakpoint, labelService?: ILabelService): { message?: string, className: string } {
	const debugActive = state === State.Running || state === State.Stopped;

	if (!breakpoint.enabled || !breakpointsActivated) {
		return {
			className: breakpoint instanceof DataBreakpoint ? 'codicon-debug-breakpoint-data-disabled' : breakpoint instanceof FunctionBreakpoint ? 'codicon-debug-breakpoint-function-disabled' : breakpoint.logMessage ? 'codicon-debug-breakpoint-log-disabled' : 'codicon-debug-breakpoint-disabled',
			message: breakpoint.logMessage ? nls.localize('disabledLogpoint', "Disabled Logpoint") : nls.localize('disabledBreakpoint', "Disabled Breakpoint"),
		};
	}

	const appendMessage = (text: string): string => {
		return ('message' in breakpoint && breakpoint.message) ? text.concat(', ' + breakpoint.message) : text;
	};
	if (debugActive && !breakpoint.verified) {
		return {
			className: breakpoint instanceof DataBreakpoint ? 'codicon-debug-breakpoint-data-unverified' : breakpoint instanceof FunctionBreakpoint ? 'codicon-debug-breakpoint-function-unverified' : breakpoint.logMessage ? 'codicon-debug-breakpoint-log-unverified' : 'codicon-debug-breakpoint-unverified',
			message: ('message' in breakpoint && breakpoint.message) ? breakpoint.message : (breakpoint.logMessage ? nls.localize('unverifiedLogpoint', "Unverified Logpoint") : nls.localize('unverifiedBreakopint', "Unverified Breakpoint")),
		};
	}

	if (breakpoint instanceof FunctionBreakpoint) {
		if (!breakpoint.supported) {
			return {
				className: 'codicon-debug-breakpoint-function-unverified',
				message: nls.localize('functionBreakpointUnsupported', "Function breakpoints not supported by this debug type"),
			};
		}

		return {
			className: 'codicon-debug-breakpoint-function',
			message: breakpoint.message || nls.localize('functionBreakpoint', "Function Breakpoint")
		};
	}

	if (breakpoint instanceof DataBreakpoint) {
		if (!breakpoint.supported) {
			return {
				className: 'codicon-debug-breakpoint-data-unverified',
				message: nls.localize('dataBreakpointUnsupported', "Data breakpoints not supported by this debug type"),
			};
		}

		return {
			className: 'codicon-debug-breakpoint-data',
			message: breakpoint.message || nls.localize('dataBreakpoint', "Data Breakpoint")
		};
	}

	if (breakpoint.logMessage || breakpoint.condition || breakpoint.hitCondition) {
		const messages: string[] = [];

		if (!breakpoint.supported) {
			return {
				className: 'codicon-debug-breakpoint-unsupported',
				message: nls.localize('breakpointUnsupported', "Breakpoints of this type are not supported by the debugger"),
			};
		}

		if (breakpoint.logMessage) {
			messages.push(nls.localize('logMessage', "Log Message: {0}", breakpoint.logMessage));
		}
		if (breakpoint.condition) {
			messages.push(nls.localize('expression', "Expression: {0}", breakpoint.condition));
		}
		if (breakpoint.hitCondition) {
			messages.push(nls.localize('hitCount', "Hit Count: {0}", breakpoint.hitCondition));
		}

		return {
			className: breakpoint.logMessage ? 'codicon-debug-breakpoint-log' : 'codicon-debug-breakpoint-conditional',
			message: appendMessage(messages.join('\n'))
		};
	}

	const message = ('message' in breakpoint && breakpoint.message) ? breakpoint.message : breakpoint instanceof Breakpoint && labelService ? labelService.getUriLabel(breakpoint.uri) : nls.localize('breakpoint', "Breakpoint");
	return {
		className: 'codicon-debug-breakpoint',
		message
	};
}
