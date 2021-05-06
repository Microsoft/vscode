/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import severity from 'vs/base/common/severity';
import * as dom from 'vs/base/browser/dom';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { Variable } from 'vs/workbench/contrib/debug/common/debugModel';
import { SimpleReplElement, RawObjectReplElement, ReplEvaluationInput, ReplEvaluationResult, ReplGroup } from 'vs/workbench/contrib/debug/common/replModel';
import { CachedListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITreeRenderer, ITreeNode, IAsyncDataSource } from 'vs/base/browser/ui/tree/tree';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { renderExpressionValue, AbstractExpressionsRenderer, IExpressionTemplateData, renderVariable, IInputBoxOptions } from 'vs/workbench/contrib/debug/browser/baseDebugView';
import { handleANSIOutput } from 'vs/workbench/contrib/debug/browser/debugANSIHandling';
import { ILabelService } from 'vs/platform/label/common/label';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { FuzzyScore, createMatches } from 'vs/base/common/filters';
import { HighlightedLabel, IHighlight } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IReplElementSource, IDebugService, IExpression, IReplElement, IDebugConfiguration, IDebugSession, IExpressionContainer } from 'vs/workbench/contrib/debug/common/debug';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { localize } from 'vs/nls';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { attachBadgeStyler } from 'vs/platform/theme/common/styler';
import { debugConsoleEvaluationInput } from 'vs/workbench/contrib/debug/browser/debugIcons';

const $ = dom.$;

interface IReplEvaluationInputTemplateData {
	label: HighlightedLabel;
}

interface IReplGroupTemplateData {
	label: HTMLElement;
}

interface IReplEvaluationResultTemplateData {
	value: HTMLElement;
}

interface ISimpleReplElementTemplateData {
	container: HTMLElement;
	count: CountBadge;
	countContainer: HTMLElement;
	value: HTMLElement;
	source: HTMLElement;
	getReplElementSource(): IReplElementSource | undefined;
	toDispose: IDisposable[];
	elementListener: IDisposable;
}

interface IRawObjectReplTemplateData {
	container: HTMLElement;
	expression: HTMLElement;
	name: HTMLElement;
	value: HTMLElement;
	label: HighlightedLabel;
}

export class ReplEvaluationInputsRenderer implements ITreeRenderer<ReplEvaluationInput, FuzzyScore, IReplEvaluationInputTemplateData> {
	static readonly ID = 'replEvaluationInput';

	get templateId(): string {
		return ReplEvaluationInputsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IReplEvaluationInputTemplateData {
		dom.append(container, $('span.arrow' + ThemeIcon.asCSSSelector(debugConsoleEvaluationInput)));
		const input = dom.append(container, $('.expression'));
		const label = new HighlightedLabel(input, false);
		return { label };
	}

	renderElement(element: ITreeNode<ReplEvaluationInput, FuzzyScore>, index: number, templateData: IReplEvaluationInputTemplateData): void {
		const evaluation = element.element;
		templateData.label.set(evaluation.value, createMatches(element.filterData));
	}

	disposeTemplate(templateData: IReplEvaluationInputTemplateData): void {
		// noop
	}
}

export class ReplGroupRenderer implements ITreeRenderer<ReplGroup, FuzzyScore, IReplGroupTemplateData> {
	static readonly ID = 'replGroup';

	constructor(
		private readonly linkDetector: LinkDetector,
		@IThemeService private readonly themeService: IThemeService
	) { }

	get templateId(): string {
		return ReplGroupRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IReplGroupTemplateData {
		const label = dom.append(container, $('.expression'));
		return { label };
	}

	renderElement(element: ITreeNode<ReplGroup, FuzzyScore>, _index: number, templateData: IReplGroupTemplateData): void {
		const replGroup = element.element;
		dom.clearNode(templateData.label);
		const result = handleANSIOutput(replGroup.name, this.linkDetector, this.themeService, undefined);
		templateData.label.appendChild(result);
	}

	disposeTemplate(_templateData: IReplGroupTemplateData): void {
		// noop
	}
}

export class ReplEvaluationResultsRenderer implements ITreeRenderer<ReplEvaluationResult | Variable, FuzzyScore, IReplEvaluationResultTemplateData> {
	static readonly ID = 'replEvaluationResult';

	get templateId(): string {
		return ReplEvaluationResultsRenderer.ID;
	}

	constructor(private readonly linkDetector: LinkDetector) { }

	renderTemplate(container: HTMLElement): IReplEvaluationResultTemplateData {
		const output = dom.append(container, $('.evaluation-result.expression'));
		const value = dom.append(output, $('span.value'));

		return { value };
	}

	renderElement(element: ITreeNode<ReplEvaluationResult | Variable, FuzzyScore>, index: number, templateData: IReplEvaluationResultTemplateData): void {
		const expression = element.element;
		renderExpressionValue(expression, templateData.value, {
			showHover: false,
			colorize: true,
			linkDetector: this.linkDetector
		});
	}

	disposeTemplate(templateData: IReplEvaluationResultTemplateData): void {
		// noop
	}
}

export class ReplSimpleElementsRenderer implements ITreeRenderer<SimpleReplElement, FuzzyScore, ISimpleReplElementTemplateData> {
	static readonly ID = 'simpleReplElement';

	constructor(
		private readonly linkDetector: LinkDetector,
		@IEditorService private readonly editorService: IEditorService,
		@ILabelService private readonly labelService: ILabelService,
		@IThemeService private readonly themeService: IThemeService
	) { }

	get templateId(): string {
		return ReplSimpleElementsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): ISimpleReplElementTemplateData {
		const data: ISimpleReplElementTemplateData = Object.create(null);
		container.classList.add('output');
		const expression = dom.append(container, $('.output.expression.value-and-source'));

		data.container = container;
		data.countContainer = dom.append(expression, $('.count-badge-wrapper'));
		data.count = new CountBadge(data.countContainer);
		data.value = dom.append(expression, $('span.value'));
		data.source = dom.append(expression, $('.source'));
		data.toDispose = [];
		data.toDispose.push(attachBadgeStyler(data.count, this.themeService));
		data.toDispose.push(dom.addDisposableListener(data.source, 'click', e => {
			e.preventDefault();
			e.stopPropagation();
			const source = data.getReplElementSource();
			if (source) {
				source.source.openInEditor(this.editorService, {
					startLineNumber: source.lineNumber,
					startColumn: source.column,
					endLineNumber: source.lineNumber,
					endColumn: source.column
				});
			}
		}));

		return data;
	}

	renderElement({ element }: ITreeNode<SimpleReplElement, FuzzyScore>, index: number, templateData: ISimpleReplElementTemplateData): void {
		this.setElementCount(element, templateData);
		templateData.elementListener = element.onDidChangeCount(() => this.setElementCount(element, templateData));
		// value
		dom.clearNode(templateData.value);
		// Reset classes to clear ansi decorations since templates are reused
		templateData.value.className = 'value';
		const result = handleANSIOutput(element.value, this.linkDetector, this.themeService, element.session.root);
		templateData.value.appendChild(result);

		templateData.value.classList.add((element.severity === severity.Warning) ? 'warn' : (element.severity === severity.Error) ? 'error' : (element.severity === severity.Ignore) ? 'ignore' : 'info');
		templateData.source.textContent = element.sourceData ? `${element.sourceData.source.name}:${element.sourceData.lineNumber}` : '';
		templateData.source.title = element.sourceData ? `${this.labelService.getUriLabel(element.sourceData.source.uri)}:${element.sourceData.lineNumber}` : '';
		templateData.getReplElementSource = () => element.sourceData;
	}

	private setElementCount(element: SimpleReplElement, templateData: ISimpleReplElementTemplateData): void {
		if (element.count >= 2) {
			templateData.count.setCount(element.count);
			templateData.countContainer.hidden = false;
		} else {
			templateData.countContainer.hidden = true;
		}
	}

	disposeTemplate(templateData: ISimpleReplElementTemplateData): void {
		dispose(templateData.toDispose);
	}

	disposeElement(_element: ITreeNode<SimpleReplElement, FuzzyScore>, _index: number, templateData: ISimpleReplElementTemplateData): void {
		templateData.elementListener.dispose();
	}
}

export class ReplVariablesRenderer extends AbstractExpressionsRenderer {

	static readonly ID = 'replVariable';

	get templateId(): string {
		return ReplVariablesRenderer.ID;
	}

	constructor(
		private readonly linkDetector: LinkDetector,
		@IDebugService debugService: IDebugService,
		@IContextViewService contextViewService: IContextViewService,
		@IThemeService themeService: IThemeService,
	) {
		super(debugService, contextViewService, themeService);
	}

	protected renderExpression(expression: IExpression, data: IExpressionTemplateData, highlights: IHighlight[]): void {
		renderVariable(expression as Variable, data, true, highlights, this.linkDetector);
	}

	protected getInputBoxOptions(expression: IExpression): IInputBoxOptions | undefined {
		return undefined;
	}
}

export class ReplRawObjectsRenderer implements ITreeRenderer<RawObjectReplElement, FuzzyScore, IRawObjectReplTemplateData> {
	static readonly ID = 'rawObject';

	constructor(private readonly linkDetector: LinkDetector) { }

	get templateId(): string {
		return ReplRawObjectsRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IRawObjectReplTemplateData {
		container.classList.add('output');

		const expression = dom.append(container, $('.output.expression'));
		const name = dom.append(expression, $('span.name'));
		const label = new HighlightedLabel(name, false);
		const value = dom.append(expression, $('span.value'));

		return { container, expression, name, label, value };
	}

	renderElement(node: ITreeNode<RawObjectReplElement, FuzzyScore>, index: number, templateData: IRawObjectReplTemplateData): void {
		// key
		const element = node.element;
		templateData.label.set(element.name ? `${element.name}:` : '', createMatches(node.filterData));
		if (element.name) {
			templateData.name.textContent = `${element.name}:`;
		} else {
			templateData.name.textContent = '';
		}

		// value
		renderExpressionValue(element.value, templateData.value, {
			showHover: false,
			linkDetector: this.linkDetector
		});
	}

	disposeTemplate(templateData: IRawObjectReplTemplateData): void {
		// noop
	}
}

export class ReplDelegate extends CachedListVirtualDelegate<IReplElement> {

	constructor(private configurationService: IConfigurationService) {
		super();
	}

	override getHeight(element: IReplElement): number {
		const config = this.configurationService.getValue<IDebugConfiguration>('debug');

		if (!config.console.wordWrap) {
			return this.estimateHeight(element, true);
		}

		return super.getHeight(element);
	}

	protected estimateHeight(element: IReplElement, ignoreValueLength = false): number {
		const config = this.configurationService.getValue<IDebugConfiguration>('debug');
		const rowHeight = Math.ceil(1.3 * config.console.fontSize);
		const countNumberOfLines = (str: string) => Math.max(1, (str && str.match(/\r\n|\n/g) || []).length);
		const hasValue = (e: any): e is { value: string } => typeof e.value === 'string';

		// Calculate a rough overestimation for the height
		// For every 70 characters increase the number of lines needed beyond the first
		if (hasValue(element) && !(element instanceof Variable)) {
			let value = element.value;
			let valueRows = countNumberOfLines(value) + (ignoreValueLength ? 0 : Math.floor(value.length / 70));

			return valueRows * rowHeight;
		}

		return rowHeight;
	}

	getTemplateId(element: IReplElement): string {
		if (element instanceof Variable && element.name) {
			return ReplVariablesRenderer.ID;
		}
		if (element instanceof ReplEvaluationResult || (element instanceof Variable && !element.name)) {
			// Variable with no name is a top level variable which should be rendered like a repl element #17404
			return ReplEvaluationResultsRenderer.ID;
		}
		if (element instanceof ReplEvaluationInput) {
			return ReplEvaluationInputsRenderer.ID;
		}
		if (element instanceof SimpleReplElement) {
			return ReplSimpleElementsRenderer.ID;
		}
		if (element instanceof ReplGroup) {
			return ReplGroupRenderer.ID;
		}

		return ReplRawObjectsRenderer.ID;
	}

	hasDynamicHeight(element: IReplElement): boolean {
		if (element instanceof Variable) {
			// Variables should always be in one line #111843
			return false;
		}
		// Empty elements should not have dynamic height since they will be invisible
		return element.toString().length > 0;
	}
}

function isDebugSession(obj: any): obj is IDebugSession {
	return typeof obj.getReplElements === 'function';
}

export class ReplDataSource implements IAsyncDataSource<IDebugSession, IReplElement> {

	hasChildren(element: IReplElement | IDebugSession): boolean {
		if (isDebugSession(element)) {
			return true;
		}

		return !!(<IExpressionContainer | ReplGroup>element).hasChildren;
	}

	getChildren(element: IReplElement | IDebugSession): Promise<IReplElement[]> {
		if (isDebugSession(element)) {
			return Promise.resolve(element.getReplElements());
		}
		if (element instanceof RawObjectReplElement) {
			return element.getChildren();
		}
		if (element instanceof ReplGroup) {
			return Promise.resolve(element.getChildren());
		}

		return (<IExpression>element).getChildren();
	}
}

export class ReplAccessibilityProvider implements IListAccessibilityProvider<IReplElement> {

	getWidgetAriaLabel(): string {
		return localize('debugConsole', "Debug Console");
	}

	getAriaLabel(element: IReplElement): string {
		if (element instanceof Variable) {
			return localize('replVariableAriaLabel', "Variable {0}, value {1}", element.name, element.value);
		}
		if (element instanceof SimpleReplElement || element instanceof ReplEvaluationInput || element instanceof ReplEvaluationResult) {
			return element.value + (element instanceof SimpleReplElement && element.count > 1 ? localize({ key: 'occurred', comment: ['Front will the value of the debug console element. Placeholder will be replaced by a number which represents occurrance count.'] },
				", occured {0} times", element.count) : '');
		}
		if (element instanceof RawObjectReplElement) {
			return localize('replRawObjectAriaLabel', "Debug console variable {0}, value {1}", element.name, element.value);
		}
		if (element instanceof ReplGroup) {
			return localize('replGroup', "Debug console group {0}", element.name);
		}

		return '';
	}
}
