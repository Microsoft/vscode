/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { IExpression, IDebugService, IExpressionContainer } from 'vs/workbench/contrib/debug/common/debug';
import { Expression, Variable, ExpressionContainer } from 'vs/workbench/contrib/debug/common/debugModel';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInputValidationOptions, InputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { ITreeRenderer, ITreeNode } from 'vs/base/browser/ui/tree/tree';
import { IDisposable, dispose, Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { attachInputBoxStyler } from 'vs/platform/theme/common/styler';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { HighlightedLabel, IHighlight } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { FuzzyScore, createMatches } from 'vs/base/common/filters';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { ReplEvaluationResult } from 'vs/workbench/contrib/debug/common/replModel';
import { once } from 'vs/base/common/functional';

export const MAX_VALUE_RENDER_LENGTH_IN_VIEWLET = 1024;
export const twistiePixels = 20;
const booleanRegex = /^true|false$/i;
const stringRegex = /^(['"]).*\1$/;
const $ = dom.$;

export interface IRenderValueOptions {
	showChanged?: boolean;
	maxValueLength?: number;
	showHover?: boolean;
	colorize?: boolean;
	linkDetector?: LinkDetector;
}

export interface IVariableTemplateData {
	expression: HTMLElement;
	name: HTMLElement;
	value: HTMLElement;
	label: HighlightedLabel;
}

export function renderViewTree(container: HTMLElement): HTMLElement {
	const treeContainer = $('.');
	treeContainer.classList.add('debug-view-content');
	container.appendChild(treeContainer);
	return treeContainer;
}

export function renderExpressionValue(expressionOrValue: IExpressionContainer | string, container: HTMLElement, options: IRenderValueOptions): void {
	let value = typeof expressionOrValue === 'string' ? expressionOrValue : expressionOrValue.value;

	// remove stale classes
	container.className = 'value';
	// when resolving expressions we represent errors from the server as a variable with name === null.
	if (value === null || ((expressionOrValue instanceof Expression || expressionOrValue instanceof Variable || expressionOrValue instanceof ReplEvaluationResult) && !expressionOrValue.available)) {
		container.classList.add('unavailable');
		if (value !== Expression.DEFAULT_VALUE) {
			container.classList.add('error');
		}
	} else if ((expressionOrValue instanceof ExpressionContainer) && options.showChanged && expressionOrValue.valueChanged && value !== Expression.DEFAULT_VALUE) {
		// value changed color has priority over other colors.
		container.className = 'value changed';
		expressionOrValue.valueChanged = false;
	}

	if (options.colorize && typeof expressionOrValue !== 'string') {
		if (expressionOrValue.type === 'number' || expressionOrValue.type === 'boolean' || expressionOrValue.type === 'string') {
			container.classList.add(expressionOrValue.type);
		} else if (!isNaN(+value)) {
			container.classList.add('number');
		} else if (booleanRegex.test(value)) {
			container.classList.add('boolean');
		} else if (stringRegex.test(value)) {
			container.classList.add('string');
		}
	}

	if (options.maxValueLength && value && value.length > options.maxValueLength) {
		value = value.substr(0, options.maxValueLength) + '...';
	}
	if (!value) {
		value = '';
	}

	if (options.linkDetector) {
		container.textContent = '';
		const session = (expressionOrValue instanceof ExpressionContainer) ? expressionOrValue.getSession() : undefined;
		container.appendChild(options.linkDetector.linkify(value, false, session ? session.root : undefined));
	} else {
		container.textContent = value;
	}
	if (options.showHover) {
		container.title = value || '';
	}
}

export function renderVariable(variable: Variable, data: IVariableTemplateData, showChanged: boolean, highlights: IHighlight[], linkDetector?: LinkDetector): void {
	if (variable.available) {
		let text = variable.name;
		if (variable.value && typeof variable.name === 'string') {
			text += ':';
		}
		data.label.set(text, highlights, variable.type ? variable.type : variable.name);
		data.name.classList.toggle('virtual', !!variable.presentationHint && variable.presentationHint.kind === 'virtual');
	} else if (variable.value && typeof variable.name === 'string' && variable.name) {
		data.label.set(':');
	}

	renderExpressionValue(variable, data.value, {
		showChanged,
		maxValueLength: MAX_VALUE_RENDER_LENGTH_IN_VIEWLET,
		showHover: true,
		colorize: true,
		linkDetector
	});
}

export interface IInputBoxOptions {
	initialValue: string;
	ariaLabel: string;
	placeholder?: string;
	validationOptions?: IInputValidationOptions;
	onFinish: (value: string, success: boolean) => void;
}

export interface IExpressionTemplateData {
	expression: HTMLElement;
	name: HTMLSpanElement;
	value: HTMLSpanElement;
	inputBoxContainer: HTMLElement;
	toDispose: IDisposable;
	label: HighlightedLabel;
}

export abstract class AbstractExpressionsRenderer implements ITreeRenderer<IExpression, FuzzyScore, IExpressionTemplateData> {

	constructor(
		@IDebugService protected debugService: IDebugService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly themeService: IThemeService
	) { }

	abstract get templateId(): string;

	renderTemplate(container: HTMLElement): IExpressionTemplateData {
		const expression = dom.append(container, $('.expression'));
		const name = dom.append(expression, $('span.name'));
		const value = dom.append(expression, $('span.value'));
		const label = new HighlightedLabel(name, false);

		const inputBoxContainer = dom.append(expression, $('.inputBoxContainer'));

		return { expression, name, value, label, inputBoxContainer, toDispose: Disposable.None };
	}

	renderElement(node: ITreeNode<IExpression, FuzzyScore>, index: number, data: IExpressionTemplateData): void {
		data.toDispose.dispose();
		data.toDispose = Disposable.None;
		const { element } = node;
		this.renderExpression(element, data, createMatches(node.filterData));
		const selectedExpression = this.debugService.getViewModel().getSelectedExpression();
		if (element === selectedExpression?.expression || (element instanceof Variable && element.errorMessage)) {
			const options = this.getInputBoxOptions(element, !!selectedExpression?.settingWatch);
			if (options) {
				data.toDispose = this.renderInputBox(data.name, data.value, data.inputBoxContainer, options);
				return;
			}
		}
	}

	renderInputBox(nameElement: HTMLElement, valueElement: HTMLElement, inputBoxContainer: HTMLElement, options: IInputBoxOptions): IDisposable {
		nameElement.style.display = 'none';
		valueElement.style.display = 'none';
		inputBoxContainer.style.display = 'initial';

		const inputBox = new InputBox(inputBoxContainer, this.contextViewService, options);
		const styler = attachInputBoxStyler(inputBox, this.themeService);

		inputBox.value = options.initialValue;
		inputBox.focus();
		inputBox.select();

		const done = once((success: boolean, finishEditing: boolean) => {
			nameElement.style.display = 'initial';
			valueElement.style.display = 'initial';
			inputBoxContainer.style.display = 'none';
			const value = inputBox.value;
			dispose(toDispose);

			if (finishEditing) {
				this.debugService.getViewModel().setSelectedExpression(undefined, false);
				options.onFinish(value, success);
			}
		});

		const toDispose = [
			inputBox,
			dom.addStandardDisposableListener(inputBox.inputElement, dom.EventType.KEY_DOWN, (e: IKeyboardEvent) => {
				const isEscape = e.equals(KeyCode.Escape);
				const isEnter = e.equals(KeyCode.Enter);
				if (isEscape || isEnter) {
					e.preventDefault();
					e.stopPropagation();
					done(isEnter, true);
				}
			}),
			dom.addDisposableListener(inputBox.inputElement, dom.EventType.BLUR, () => {
				done(true, true);
			}),
			dom.addDisposableListener(inputBox.inputElement, dom.EventType.CLICK, e => {
				// Do not expand / collapse selected elements
				e.preventDefault();
				e.stopPropagation();
			}),
			styler
		];

		return toDisposable(() => {
			done(false, false);
		});
	}

	protected abstract renderExpression(expression: IExpression, data: IExpressionTemplateData, highlights: IHighlight[]): void;
	protected abstract getInputBoxOptions(expression: IExpression, settingValue: boolean): IInputBoxOptions | undefined;

	disposeElement(node: ITreeNode<IExpression, FuzzyScore>, index: number, templateData: IExpressionTemplateData): void {
		templateData.toDispose.dispose();
	}

	disposeTemplate(templateData: IExpressionTemplateData): void {
		templateData.toDispose.dispose();
	}
}
