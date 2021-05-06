/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./suggestEnabledInput';
import { $, Dimension, append } from 'vs/base/browser/dom';
import { Widget } from 'vs/base/browser/ui/widget';
import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IDisposable } from 'vs/base/common/lifecycle';
import { mixin } from 'vs/base/common/objects';
import { isMacintosh } from 'vs/base/common/platform';
import { URI as uri } from 'vs/base/common/uri';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ITextModel } from 'vs/editor/common/model';
import * as modes from 'vs/editor/common/modes';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ContextMenuController } from 'vs/editor/contrib/contextmenu/contextmenu';
import { SnippetController2 } from 'vs/editor/contrib/snippet/snippetController2';
import { SuggestController } from 'vs/editor/contrib/suggest/suggestController';
import { IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ColorIdentifier, editorSelectionBackground, inputBackground, inputBorder, inputForeground, inputPlaceholderForeground, selectionBackground } from 'vs/platform/theme/common/colorRegistry';
import { IStyleOverrides, attachStyler } from 'vs/platform/theme/common/styler';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { MenuPreventer } from 'vs/workbench/contrib/codeEditor/browser/menuPreventer';
import { getSimpleEditorOptions } from 'vs/workbench/contrib/codeEditor/browser/simpleEditorOptions';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { IThemable } from 'vs/base/common/styler';
import { DEFAULT_FONT_FAMILY } from 'vs/workbench/browser/style';

interface SuggestResultsProvider {
	/**
	 * Provider function for suggestion results.
	 *
	 * @param query the full text of the input.
	 */
	provideResults: (query: string) => string[];

	/**
	 * Trigger characters for this input. Suggestions will appear when one of these is typed,
	 * or upon `ctrl+space` triggering at a word boundary.
	 *
	 * Defaults to the empty array.
	 */
	triggerCharacters?: string[];

	/**
	 * Defines the sorting function used when showing results.
	 *
	 * Defaults to the identity function.
	 */
	sortKey?: (result: string) => string;
}

interface SuggestEnabledInputOptions {
	/**
	 * The text to show when no input is present.
	 *
	 * Defaults to the empty string.
	 */
	placeholderText?: string;
	value?: string;

	/**
	 * Context key tracking the focus state of this element
	 */
	focusContextKey?: IContextKey<boolean>;
}

export interface ISuggestEnabledInputStyleOverrides extends IStyleOverrides {
	inputBackground?: ColorIdentifier;
	inputForeground?: ColorIdentifier;
	inputBorder?: ColorIdentifier;
	inputPlaceholderForeground?: ColorIdentifier;
}

type ISuggestEnabledInputStyles = {
	[P in keyof ISuggestEnabledInputStyleOverrides]: Color | undefined;
};

export function attachSuggestEnabledInputBoxStyler(widget: IThemable, themeService: IThemeService, style?: ISuggestEnabledInputStyleOverrides): IDisposable {
	return attachStyler(themeService, {
		inputBackground: style?.inputBackground || inputBackground,
		inputForeground: style?.inputForeground || inputForeground,
		inputBorder: style?.inputBorder || inputBorder,
		inputPlaceholderForeground: style?.inputPlaceholderForeground || inputPlaceholderForeground,
	} as ISuggestEnabledInputStyleOverrides, widget);
}

export class SuggestEnabledInput extends Widget implements IThemable {

	private readonly _onShouldFocusResults = new Emitter<void>();
	readonly onShouldFocusResults: Event<void> = this._onShouldFocusResults.event;

	private readonly _onEnter = new Emitter<void>();
	readonly onEnter: Event<void> = this._onEnter.event;

	private readonly _onInputDidChange = new Emitter<string | undefined>();
	readonly onInputDidChange: Event<string | undefined> = this._onInputDidChange.event;

	private readonly inputWidget: CodeEditorWidget;
	private readonly inputModel: ITextModel;
	private stylingContainer: HTMLDivElement;
	private placeholderText: HTMLDivElement;

	constructor(
		id: string,
		parent: HTMLElement,
		suggestionProvider: SuggestResultsProvider,
		ariaLabel: string,
		resourceHandle: string,
		options: SuggestEnabledInputOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IModelService modelService: IModelService,
	) {
		super();

		this.stylingContainer = append(parent, $('.suggest-input-container'));
		this.placeholderText = append(this.stylingContainer, $('.suggest-input-placeholder', undefined, options.placeholderText || ''));

		const editorOptions: IEditorOptions = mixin(
			getSimpleEditorOptions(),
			getSuggestEnabledInputOptions(ariaLabel));

		this.inputWidget = instantiationService.createInstance(CodeEditorWidget, this.stylingContainer,
			editorOptions,
			{
				contributions: EditorExtensionsRegistry.getSomeEditorContributions([
					SuggestController.ID,
					SnippetController2.ID,
					ContextMenuController.ID,
					MenuPreventer.ID,
					SelectionClipboardContributionID,
				]),
				isSimpleWidget: true,
			});
		this._register(this.inputWidget);

		let scopeHandle = uri.parse(resourceHandle);
		this.inputModel = modelService.createModel('', null, scopeHandle, true);
		this.inputWidget.setModel(this.inputModel);

		this._register(this.inputWidget.onDidPaste(() => this.setValue(this.getValue()))); // setter cleanses

		this._register((this.inputWidget.onDidFocusEditorText(() => {
			if (options.focusContextKey) { options.focusContextKey.set(true); }
			this.stylingContainer.classList.add('synthetic-focus');
		})));
		this._register((this.inputWidget.onDidBlurEditorText(() => {
			if (options.focusContextKey) { options.focusContextKey.set(false); }
			this.stylingContainer.classList.remove('synthetic-focus');
		})));

		const onKeyDownMonaco = Event.chain(this.inputWidget.onKeyDown);
		this._register(onKeyDownMonaco.filter(e => e.keyCode === KeyCode.Enter).on(e => { e.preventDefault(); this._onEnter.fire(); }, this));
		this._register(onKeyDownMonaco.filter(e => e.keyCode === KeyCode.DownArrow && (isMacintosh ? e.metaKey : e.ctrlKey)).on(() => this._onShouldFocusResults.fire(), this));

		let preexistingContent = this.getValue();
		const inputWidgetModel = this.inputWidget.getModel();
		if (inputWidgetModel) {
			this._register(inputWidgetModel.onDidChangeContent(() => {
				let content = this.getValue();
				this.placeholderText.style.visibility = content ? 'hidden' : 'visible';
				if (preexistingContent.trim() === content.trim()) { return; }
				this._onInputDidChange.fire(undefined);
				preexistingContent = content;
			}));
		}

		let validatedSuggestProvider = {
			provideResults: suggestionProvider.provideResults,
			sortKey: suggestionProvider.sortKey || (a => a),
			triggerCharacters: suggestionProvider.triggerCharacters || []
		};

		this.setValue(options.value || '');

		this._register(modes.CompletionProviderRegistry.register({ scheme: scopeHandle.scheme, pattern: '**/' + scopeHandle.path, hasAccessToAllModels: true }, {
			triggerCharacters: validatedSuggestProvider.triggerCharacters,
			provideCompletionItems: (model: ITextModel, position: Position, _context: modes.CompletionContext) => {
				let query = model.getValue();

				const zeroIndexedColumn = position.column - 1;

				let zeroIndexedWordStart = query.lastIndexOf(' ', zeroIndexedColumn - 1) + 1;
				let alreadyTypedCount = zeroIndexedColumn - zeroIndexedWordStart;

				// dont show suggestions if the user has typed something, but hasn't used the trigger character
				if (alreadyTypedCount > 0 && validatedSuggestProvider.triggerCharacters.indexOf(query[zeroIndexedWordStart]) === -1) {
					return { suggestions: [] };
				}

				return {
					suggestions: suggestionProvider.provideResults(query).map(result => {
						return <modes.CompletionItem>{
							label: result,
							insertText: result,
							range: Range.fromPositions(position.delta(0, -alreadyTypedCount), position),
							sortText: validatedSuggestProvider.sortKey(result),
							kind: modes.CompletionItemKind.Keyword
						};
					})
				};
			}
		}));
	}

	public updateAriaLabel(label: string): void {
		this.inputWidget.updateOptions({ ariaLabel: label });
	}

	public get onFocus(): Event<void> { return this.inputWidget.onDidFocusEditorText; }

	public setValue(val: string) {
		val = val.replace(/\s/g, ' ');
		const fullRange = this.inputModel.getFullModelRange();
		this.inputWidget.executeEdits('suggestEnabledInput.setValue', [EditOperation.replace(fullRange, val)]);
		this.inputWidget.setScrollTop(0);
		this.inputWidget.setPosition(new Position(1, val.length + 1));
	}

	public getValue(): string {
		return this.inputWidget.getValue();
	}


	public style(colors: ISuggestEnabledInputStyles): void {
		this.stylingContainer.style.backgroundColor = colors.inputBackground ? colors.inputBackground.toString() : '';
		this.stylingContainer.style.color = colors.inputForeground ? colors.inputForeground.toString() : '';
		this.placeholderText.style.color = colors.inputPlaceholderForeground ? colors.inputPlaceholderForeground.toString() : '';

		this.stylingContainer.style.borderWidth = '1px';
		this.stylingContainer.style.borderStyle = 'solid';
		this.stylingContainer.style.borderColor = colors.inputBorder ?
			colors.inputBorder.toString() :
			'transparent';

		const cursor = this.stylingContainer.getElementsByClassName('cursor')[0] as HTMLDivElement;
		if (cursor) {
			cursor.style.backgroundColor = colors.inputForeground ? colors.inputForeground.toString() : '';
		}
	}

	public focus(selectAll?: boolean): void {
		this.inputWidget.focus();

		if (selectAll && this.inputWidget.getValue()) {
			this.selectAll();
		}
	}

	public onHide(): void {
		this.inputWidget.onHide();
	}

	public layout(dimension: Dimension): void {
		this.inputWidget.layout(dimension);
		this.placeholderText.style.width = `${dimension.width - 2}px`;
	}

	private selectAll(): void {
		this.inputWidget.setSelection(new Range(1, 1, 1, this.getValue().length + 1));
	}
}

// Override styles in selections.ts
registerThemingParticipant((theme, collector) => {
	let selectionColor = theme.getColor(selectionBackground);
	if (selectionColor) {
		selectionColor = selectionColor.transparent(0.4);
	} else {
		selectionColor = theme.getColor(editorSelectionBackground);
	}

	if (selectionColor) {
		collector.addRule(`.suggest-input-container .monaco-editor .focused .selected-text { background-color: ${selectionColor}; }`);
	}

	// Override inactive selection bg
	const inputBackgroundColor = theme.getColor(inputBackground);
	if (inputBackgroundColor) {
		collector.addRule(`.suggest-input-container .monaco-editor .selected-text { background-color: ${inputBackgroundColor.transparent(0.4)}; }`);
	}

	// Override selected fg
	const inputForegroundColor = theme.getColor(inputForeground);
	if (inputForegroundColor) {
		collector.addRule(`.suggest-input-container .monaco-editor .view-line span.inline-selected-text { color: ${inputForegroundColor}; }`);
	}

	const backgroundColor = theme.getColor(inputBackground);
	if (backgroundColor) {
		collector.addRule(`.suggest-input-container .monaco-editor-background { background-color: ${backgroundColor}; } `);
	}
});


function getSuggestEnabledInputOptions(ariaLabel?: string): IEditorOptions {
	return {
		fontSize: 13,
		lineHeight: 20,
		wordWrap: 'off',
		scrollbar: { vertical: 'hidden', },
		roundedSelection: false,
		renderIndentGuides: false,
		cursorWidth: 1,
		fontFamily: DEFAULT_FONT_FAMILY,
		ariaLabel: ariaLabel || '',
		snippetSuggestions: 'none',
		suggest: { filterGraceful: false, showIcons: false },
		autoClosingBrackets: 'never'
	};
}
