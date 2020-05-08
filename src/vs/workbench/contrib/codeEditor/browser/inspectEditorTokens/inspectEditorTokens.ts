/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./inspectEditorTokens';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { CharCode } from 'vs/base/common/charCode';
import { Color } from 'vs/base/common/color';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable } from 'vs/base/common/lifecycle';
import { escape } from 'vs/base/common/strings';
import { ContentWidgetPositionPreference, IActiveCodeEditor, ICodeEditor, IContentWidget, IContentWidgetPosition } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction, registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IEditorContribution } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { FontStyle, LanguageIdentifier, StandardTokenType, TokenMetadata, DocumentSemanticTokensProviderRegistry, SemanticTokensLegend, SemanticTokens, LanguageId, ColorId, DocumentRangeSemanticTokensProviderRegistry } from 'vs/editor/common/modes';
import { IModeService } from 'vs/editor/common/services/modeService';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { editorHoverBackground, editorHoverBorder } from 'vs/platform/theme/common/colorRegistry';
import { HIGH_CONTRAST, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { findMatchingThemeRule } from 'vs/workbench/services/textMate/common/TMHelper';
import { ITextMateService, IGrammar, IToken, StackElement } from 'vs/workbench/services/textMate/common/textMateService';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { ColorThemeData, TokenStyleDefinitions, TokenStyleDefinition, TextMateThemingRuleDefinitions } from 'vs/workbench/services/themes/common/colorThemeData';
import { SemanticTokenRule, TokenStyleData, TokenStyle } from 'vs/platform/theme/common/tokenClassificationRegistry';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

export interface IEditorSemanticHighlightingOptions {
	enabled?: boolean;
}

class InspectEditorTokensController extends Disposable implements IEditorContribution {

	public static readonly ID = 'editor.contrib.inspectEditorTokens';

	public static get(editor: ICodeEditor): InspectEditorTokensController {
		return editor.getContribution<InspectEditorTokensController>(InspectEditorTokensController.ID);
	}

	private _editor: ICodeEditor;
	private _textMateService: ITextMateService;
	private _themeService: IWorkbenchThemeService;
	private _modeService: IModeService;
	private _notificationService: INotificationService;
	private _configurationService: IConfigurationService;
	private _widget: InspectEditorTokensWidget | null;

	constructor(
		editor: ICodeEditor,
		@ITextMateService textMateService: ITextMateService,
		@IModeService modeService: IModeService,
		@IWorkbenchThemeService themeService: IWorkbenchThemeService,
		@INotificationService notificationService: INotificationService,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super();
		this._editor = editor;
		this._textMateService = textMateService;
		this._themeService = themeService;
		this._modeService = modeService;
		this._notificationService = notificationService;
		this._configurationService = configurationService;
		this._widget = null;

		this._register(this._editor.onDidChangeModel((e) => this.stop()));
		this._register(this._editor.onDidChangeModelLanguage((e) => this.stop()));
		this._register(this._editor.onKeyUp((e) => e.keyCode === KeyCode.Escape && this.stop()));
	}

	public dispose(): void {
		this.stop();
		super.dispose();
	}

	public launch(): void {
		if (this._widget) {
			return;
		}
		if (!this._editor.hasModel()) {
			return;
		}
		this._widget = new InspectEditorTokensWidget(this._editor, this._textMateService, this._modeService, this._themeService, this._notificationService, this._configurationService);
	}

	public stop(): void {
		if (this._widget) {
			this._widget.dispose();
			this._widget = null;
		}
	}

	public toggle(): void {
		if (!this._widget) {
			this.launch();
		} else {
			this.stop();
		}
	}
}

class InspectEditorTokens extends EditorAction {

	constructor() {
		super({
			id: 'editor.action.inspectTMScopes',
			label: nls.localize('inspectEditorTokens', "Developer: Inspect Editor Tokens and Scopes"),
			alias: 'Developer: Inspect Editor Tokens and Scopes',
			precondition: undefined
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		let controller = InspectEditorTokensController.get(editor);
		if (controller) {
			controller.toggle();
		}
	}
}

interface ITextMateTokenInfo {
	token: IToken;
	metadata: IDecodedMetadata;
}

interface ISemanticTokenInfo {
	type: string;
	modifiers: string[];
	range: Range;
	metadata?: IDecodedMetadata,
	definitions: TokenStyleDefinitions
}

interface IDecodedMetadata {
	languageIdentifier: LanguageIdentifier;
	tokenType: StandardTokenType;
	bold?: boolean;
	italic?: boolean;
	underline?: boolean;
	foreground?: string;
	background?: string;
}

function renderTokenText(tokenText: string): string {
	if (tokenText.length > 40) {
		tokenText = tokenText.substr(0, 20) + '…' + tokenText.substr(tokenText.length - 20);
	}
	let result: string = '';
	for (let charIndex = 0, len = tokenText.length; charIndex < len; charIndex++) {
		let charCode = tokenText.charCodeAt(charIndex);
		switch (charCode) {
			case CharCode.Tab:
				result += '&rarr;';
				break;

			case CharCode.Space:
				result += '&middot;';
				break;

			case CharCode.LessThan:
				result += '&lt;';
				break;

			case CharCode.GreaterThan:
				result += '&gt;';
				break;

			case CharCode.Ampersand:
				result += '&amp;';
				break;

			default:
				result += String.fromCharCode(charCode);
		}
	}
	return result;
}

type SemanticTokensResult = { tokens: SemanticTokens, legend: SemanticTokensLegend };

class InspectEditorTokensWidget extends Disposable implements IContentWidget {

	private static readonly _ID = 'editor.contrib.inspectEditorTokensWidget';

	// Editor.IContentWidget.allowEditorOverflow
	public readonly allowEditorOverflow = true;

	private _isDisposed: boolean;
	private readonly _editor: IActiveCodeEditor;
	private readonly _modeService: IModeService;
	private readonly _themeService: IWorkbenchThemeService;
	private readonly _textMateService: ITextMateService;
	private readonly _notificationService: INotificationService;
	private readonly _configurationService: IConfigurationService;
	private readonly _model: ITextModel;
	private readonly _domNode: HTMLElement;
	private readonly _currentRequestCancellationTokenSource: CancellationTokenSource;

	constructor(
		editor: IActiveCodeEditor,
		textMateService: ITextMateService,
		modeService: IModeService,
		themeService: IWorkbenchThemeService,
		notificationService: INotificationService,
		configurationService: IConfigurationService
	) {
		super();
		this._isDisposed = false;
		this._editor = editor;
		this._modeService = modeService;
		this._themeService = themeService;
		this._textMateService = textMateService;
		this._notificationService = notificationService;
		this._configurationService = configurationService;
		this._model = this._editor.getModel();
		this._domNode = document.createElement('div');
		this._domNode.className = 'token-inspect-widget';
		this._currentRequestCancellationTokenSource = new CancellationTokenSource();
		this._beginCompute(this._editor.getPosition());
		this._register(this._editor.onDidChangeCursorPosition((e) => this._beginCompute(this._editor.getPosition())));
		this._register(themeService.onDidColorThemeChange(_ => this._beginCompute(this._editor.getPosition())));
		this._register(configurationService.onDidChangeConfiguration(e => e.affectsConfiguration('editor.semanticHighlighting.enabled') && this._beginCompute(this._editor.getPosition())));
		this._editor.addContentWidget(this);
	}

	public dispose(): void {
		this._isDisposed = true;
		this._editor.removeContentWidget(this);
		this._currentRequestCancellationTokenSource.cancel();
		super.dispose();
	}

	public getId(): string {
		return InspectEditorTokensWidget._ID;
	}

	private _beginCompute(position: Position): void {
		const grammar = this._textMateService.createGrammar(this._model.getLanguageIdentifier().language);
		const semanticTokens = this._computeSemanticTokens(position);

		dom.clearNode(this._domNode);
		this._domNode.appendChild(document.createTextNode(nls.localize('inspectTMScopesWidget.loading', "Loading...")));

		Promise.all([grammar, semanticTokens]).then(([grammar, semanticTokens]) => {
			if (this._isDisposed) {
				return;
			}
			let text = this._compute(grammar, semanticTokens, position);
			this._domNode.innerHTML = text;
			this._domNode.style.maxWidth = `${Math.max(this._editor.getLayoutInfo().width * 0.66, 500)}px`;
			this._editor.layoutContentWidget(this);
		}, (err) => {
			this._notificationService.warn(err);

			setTimeout(() => {
				InspectEditorTokensController.get(this._editor).stop();
			});
		});

	}

	private _isSemanticColoringEnabled() {
		if (!this._themeService.getColorTheme().semanticHighlighting) {
			return false;
		}
		const options = this._configurationService.getValue<IEditorSemanticHighlightingOptions>('editor.semanticHighlighting', { overrideIdentifier: this._model.getLanguageIdentifier().language, resource: this._model.uri });
		return options && options.enabled;
	}

	private _compute(grammar: IGrammar | null, semanticTokens: SemanticTokensResult | null, position: Position): string {
		const textMateTokenInfo = grammar && this._getTokensAtPosition(grammar, position);
		const semanticTokenInfo = semanticTokens && this._getSemanticTokenAtPosition(semanticTokens, position);
		if (!textMateTokenInfo && !semanticTokenInfo) {
			return 'No grammar or semantic tokens available.';
		}

		let tmMetadata = textMateTokenInfo?.metadata;
		let semMetadata = semanticTokenInfo?.metadata;

		const semTokenText = semanticTokenInfo && renderTokenText(this._model.getValueInRange(semanticTokenInfo.range));
		const tmTokenText = textMateTokenInfo && renderTokenText(this._model.getLineContent(position.lineNumber).substring(textMateTokenInfo.token.startIndex, textMateTokenInfo.token.endIndex));

		const tokenText = semTokenText || tmTokenText || '';

		let result = '';
		result += `<h2 class="tiw-token">${tokenText}<span class="tiw-token-length">(${tokenText.length} ${tokenText.length === 1 ? 'char' : 'chars'})</span></h2>`;
		result += `<hr class="tiw-metadata-separator" style="clear:both"/>`;

		result += `<table class="tiw-metadata-table"><tbody>`;
		result += `<tr><td class="tiw-metadata-key">language</td><td class="tiw-metadata-value">${escape(tmMetadata?.languageIdentifier.language || '')}</td></tr>`;
		result += `<tr><td class="tiw-metadata-key">standard token type</td><td class="tiw-metadata-value">${this._tokenTypeToString(tmMetadata?.tokenType || StandardTokenType.Other)}</td></tr>`;

		result += this._formatMetadata(semMetadata, tmMetadata);
		result += `</tbody></table>`;

		if (semanticTokenInfo) {
			result += `<hr class="tiw-metadata-separator"/>`;
			result += `<table class="tiw-metadata-table"><tbody>`;
			result += `<tr><td class="tiw-metadata-key">semantic token type</td><td class="tiw-metadata-value">${semanticTokenInfo.type}</td></tr>`;
			if (semanticTokenInfo.modifiers.length) {
				result += `<tr><td class="tiw-metadata-key">modifiers</td><td class="tiw-metadata-value">${semanticTokenInfo.modifiers.join(' ')}</td></tr>`;
			}
			if (semanticTokenInfo.metadata) {
				const properties: (keyof TokenStyleData)[] = ['foreground', 'bold', 'italic', 'underline'];
				const propertiesByDefValue: { [rule: string]: string[] } = {};
				const allDefValues = []; // remember the order
				// first collect to detect when the same rule is used for multiple properties
				for (let property of properties) {
					if (semanticTokenInfo.metadata[property] !== undefined) {
						const definition = semanticTokenInfo.definitions[property];
						const defValue = this._renderTokenStyleDefinition(definition, property);
						let properties = propertiesByDefValue[defValue];
						if (!properties) {
							propertiesByDefValue[defValue] = properties = [];
							allDefValues.push(defValue);
						}
						properties.push(property);
					}
				}
				for (let defValue of allDefValues) {
					result += `<tr><td class="tiw-metadata-key">${propertiesByDefValue[defValue].join(', ')}</td><td class="tiw-metadata-value">${defValue}</td></tr>`;
				}
			}
			result += `</tbody></table>`;
		}

		if (textMateTokenInfo) {
			let theme = this._themeService.getColorTheme();
			result += `<hr class="tiw-metadata-separator"/>`;
			result += `<table class="tiw-metadata-table"><tbody>`;
			if (tmTokenText && tmTokenText !== tokenText) {
				result += `<tr><td class="tiw-metadata-key">textmate token</td><td class="tiw-metadata-value">${tmTokenText} (${tmTokenText.length})</td></tr>`;
			}
			let scopes = '';
			for (let i = textMateTokenInfo.token.scopes.length - 1; i >= 0; i--) {
				scopes += escape(textMateTokenInfo.token.scopes[i]);
				if (i > 0) {
					scopes += '<br>';
				}
			}
			result += `<tr><td class="tiw-metadata-key">textmate scopes</td><td class="tiw-metadata-value tiw-metadata-scopes">${scopes}</td></tr>`;

			let matchingRule = findMatchingThemeRule(theme, textMateTokenInfo.token.scopes, false);
			const semForeground = semanticTokenInfo?.metadata?.foreground;
			if (matchingRule) {
				let defValue = `<code class="tiw-theme-selector">${matchingRule.rawSelector}\n${JSON.stringify(matchingRule.settings, null, '\t')}</code>`;
				if (semForeground !== textMateTokenInfo.metadata.foreground) {
					if (semForeground) {
						defValue = `<s>${defValue}</s>`;
					}
					result += `<tr><td class="tiw-metadata-key">foreground</td><td class="tiw-metadata-value">${defValue}</td></tr>`;
				}
			} else if (!semForeground) {
				result += `<tr><td class="tiw-metadata-key">foreground</td><td class="tiw-metadata-value">No theme selector</td></tr>`;
			}
			result += `</tbody></table>`;
		}
		return result;
	}

	private _formatMetadata(semantic?: IDecodedMetadata, tm?: IDecodedMetadata) {
		let result = '';

		function render(property: 'foreground' | 'background') {
			let value = semantic?.[property] || tm?.[property];
			if (value !== undefined) {
				const semanticStyle = semantic?.[property] ? 'tiw-metadata-semantic' : '';
				result += `<tr><td class="tiw-metadata-key">${property}</td><td class="tiw-metadata-value ${semanticStyle}">${value}</td></tr>`;

			}
			return value;
		}

		const foreground = render('foreground');
		const background = render('background');
		if (foreground && background) {
			const backgroundColor = Color.fromHex(background), foregroundColor = Color.fromHex(foreground);
			if (backgroundColor.isOpaque()) {
				result += `<tr><td class="tiw-metadata-key">contrast ratio</td><td class="tiw-metadata-value">${backgroundColor.getContrastRatio(foregroundColor.makeOpaque(backgroundColor)).toFixed(2)}</td></tr>`;
			} else {
				result += '<tr><td class="tiw-metadata-key">Contrast ratio cannot be precise for background colors that use transparency</td><td class="tiw-metadata-value"></td></tr>';
			}
		}

		let fontStyleLabels: string[] = [];

		function addStyle(key: 'bold' | 'italic' | 'underline') {
			if (semantic && semantic[key]) {
				fontStyleLabels.push(`<span class='tiw-metadata-semantic'>${key}</span>`);
			} else if (tm && tm[key]) {
				fontStyleLabels.push(key);
			}
		}
		addStyle('bold');
		addStyle('italic');
		addStyle('underline');
		if (fontStyleLabels.length) {
			result += `<tr><td class="tiw-metadata-key">font style</td><td class="tiw-metadata-value">${fontStyleLabels.join(' ')}</td></tr>`;
		}
		return result;
	}

	private _decodeMetadata(metadata: number): IDecodedMetadata {
		let colorMap = this._themeService.getColorTheme().tokenColorMap;
		let languageId = TokenMetadata.getLanguageId(metadata);
		let tokenType = TokenMetadata.getTokenType(metadata);
		let fontStyle = TokenMetadata.getFontStyle(metadata);
		let foreground = TokenMetadata.getForeground(metadata);
		let background = TokenMetadata.getBackground(metadata);
		return {
			languageIdentifier: this._modeService.getLanguageIdentifier(languageId)!,
			tokenType: tokenType,
			bold: (fontStyle & FontStyle.Bold) ? true : undefined,
			italic: (fontStyle & FontStyle.Italic) ? true : undefined,
			underline: (fontStyle & FontStyle.Underline) ? true : undefined,
			foreground: colorMap[foreground],
			background: colorMap[background]
		};
	}

	private _tokenTypeToString(tokenType: StandardTokenType): string {
		switch (tokenType) {
			case StandardTokenType.Other: return 'Other';
			case StandardTokenType.Comment: return 'Comment';
			case StandardTokenType.String: return 'String';
			case StandardTokenType.RegEx: return 'RegEx';
		}
		return '??';
	}

	private _getTokensAtPosition(grammar: IGrammar, position: Position): ITextMateTokenInfo {
		const lineNumber = position.lineNumber;
		let stateBeforeLine = this._getStateBeforeLine(grammar, lineNumber);

		let tokenizationResult1 = grammar.tokenizeLine(this._model.getLineContent(lineNumber), stateBeforeLine);
		let tokenizationResult2 = grammar.tokenizeLine2(this._model.getLineContent(lineNumber), stateBeforeLine);

		let token1Index = 0;
		for (let i = tokenizationResult1.tokens.length - 1; i >= 0; i--) {
			let t = tokenizationResult1.tokens[i];
			if (position.column - 1 >= t.startIndex) {
				token1Index = i;
				break;
			}
		}

		let token2Index = 0;
		for (let i = (tokenizationResult2.tokens.length >>> 1); i >= 0; i--) {
			if (position.column - 1 >= tokenizationResult2.tokens[(i << 1)]) {
				token2Index = i;
				break;
			}
		}

		return {
			token: tokenizationResult1.tokens[token1Index],
			metadata: this._decodeMetadata(tokenizationResult2.tokens[(token2Index << 1) + 1])
		};
	}

	private _getStateBeforeLine(grammar: IGrammar, lineNumber: number): StackElement | null {
		let state: StackElement | null = null;

		for (let i = 1; i < lineNumber; i++) {
			let tokenizationResult = grammar.tokenizeLine(this._model.getLineContent(i), state);
			state = tokenizationResult.ruleStack;
		}

		return state;
	}

	private isSemanticTokens(token: any): token is SemanticTokens {
		return token && token.data;
	}

	private async _computeSemanticTokens(position: Position): Promise<SemanticTokensResult | null> {
		if (!this._isSemanticColoringEnabled()) {
			return null;
		}

		const tokenProviders = DocumentSemanticTokensProviderRegistry.ordered(this._model);
		if (tokenProviders.length) {
			const provider = tokenProviders[0];
			const tokens = await Promise.resolve(provider.provideDocumentSemanticTokens(this._model, null, this._currentRequestCancellationTokenSource.token));
			if (this.isSemanticTokens(tokens)) {
				return { tokens, legend: provider.getLegend() };
			}
		}
		const rangeTokenProviders = DocumentRangeSemanticTokensProviderRegistry.ordered(this._model);
		if (rangeTokenProviders.length) {
			const provider = rangeTokenProviders[0];
			const lineNumber = position.lineNumber;
			const range = new Range(lineNumber, 1, lineNumber, this._model.getLineMaxColumn(lineNumber));
			const tokens = await Promise.resolve(provider.provideDocumentRangeSemanticTokens(this._model, range, this._currentRequestCancellationTokenSource.token));
			if (this.isSemanticTokens(tokens)) {
				return { tokens, legend: provider.getLegend() };
			}
		}
		return null;
	}

	private _getSemanticTokenAtPosition(semanticTokens: SemanticTokensResult, pos: Position): ISemanticTokenInfo | null {
		const tokenData = semanticTokens.tokens.data;
		const defaultLanguage = this._model.getLanguageIdentifier().language;
		let lastLine = 0;
		let lastCharacter = 0;
		const posLine = pos.lineNumber - 1, posCharacter = pos.column - 1; // to 0-based position
		for (let i = 0; i < tokenData.length; i += 5) {
			const lineDelta = tokenData[i], charDelta = tokenData[i + 1], len = tokenData[i + 2], typeIdx = tokenData[i + 3], modSet = tokenData[i + 4];
			const line = lastLine + lineDelta; // 0-based
			const character = lineDelta === 0 ? lastCharacter + charDelta : charDelta; // 0-based
			if (posLine === line && character <= posCharacter && posCharacter < character + len) {
				const type = semanticTokens.legend.tokenTypes[typeIdx] || 'not in legend (ignored)';
				const modifiers = [];
				let modifierSet = modSet;
				for (let modifierIndex = 0; modifierSet > 0 && modifierIndex < semanticTokens.legend.tokenModifiers.length; modifierIndex++) {
					if (modifierSet & 1) {
						modifiers.push(semanticTokens.legend.tokenModifiers[modifierIndex]);
					}
					modifierSet = modifierSet >> 1;
				}
				if (modifierSet > 0) {
					modifiers.push('not in legend (ignored)');
				}
				const range = new Range(line + 1, character + 1, line + 1, character + 1 + len);
				const definitions = {};
				const colorMap = this._themeService.getColorTheme().tokenColorMap;
				const theme = this._themeService.getColorTheme() as ColorThemeData;
				const tokenStyle = theme.getTokenStyleMetadata(type, modifiers, defaultLanguage, true, definitions);

				let metadata: IDecodedMetadata | undefined = undefined;
				if (tokenStyle) {
					metadata = {
						languageIdentifier: this._modeService.getLanguageIdentifier(LanguageId.Null)!,
						tokenType: StandardTokenType.Other,
						bold: tokenStyle?.bold,
						italic: tokenStyle?.italic,
						underline: tokenStyle?.underline,
						foreground: colorMap[tokenStyle?.foreground || ColorId.None]
					};
				}

				return { type, modifiers, range, metadata, definitions };
			}
			lastLine = line;
			lastCharacter = character;
		}
		return null;
	}

	private _renderTokenStyleDefinition(definition: TokenStyleDefinition | undefined, property: keyof TokenStyleData): string {
		if (definition === undefined) {
			return '';
		}
		const theme = this._themeService.getColorTheme() as ColorThemeData;

		if (Array.isArray(definition)) {
			const scopesDefinition: TextMateThemingRuleDefinitions = {};
			theme.resolveScopes(definition, scopesDefinition);
			const matchingRule = scopesDefinition[property];
			if (matchingRule && scopesDefinition.scope) {
				const strScopes = Array.isArray(matchingRule.scope) ? matchingRule.scope.join(', ') : String(matchingRule.scope);
				return `${escape(scopesDefinition.scope.join(' '))}<br><code class="tiw-theme-selector">${strScopes}\n${JSON.stringify(matchingRule.settings, null, '\t')}</code>`;
			}
			return '';
		} else if (SemanticTokenRule.is(definition)) {
			const scope = theme.getTokenStylingRuleScope(definition);
			if (scope === 'setting') {
				return `User settings: ${definition.selector.id} - ${this._renderStyleProperty(definition.style, property)}`;
			} else if (scope === 'theme') {
				return `Color theme: ${definition.selector.id} - ${this._renderStyleProperty(definition.style, property)}`;
			}
			return '';
		} else {
			const style = theme.resolveTokenStyleValue(definition);
			return `Default: ${style ? this._renderStyleProperty(style, property) : ''}`;
		}
	}

	private _renderStyleProperty(style: TokenStyle, property: keyof TokenStyleData) {
		switch (property) {
			case 'foreground': return style.foreground ? Color.Format.CSS.formatHexA(style.foreground, true) : '';
			default: return style[property] !== undefined ? String(style[property]) : '';
		}
	}

	public getDomNode(): HTMLElement {
		return this._domNode;
	}

	public getPosition(): IContentWidgetPosition {
		return {
			position: this._editor.getPosition(),
			preference: [ContentWidgetPositionPreference.BELOW, ContentWidgetPositionPreference.ABOVE]
		};
	}
}

registerEditorContribution(InspectEditorTokensController.ID, InspectEditorTokensController);
registerEditorAction(InspectEditorTokens);

registerThemingParticipant((theme, collector) => {
	const border = theme.getColor(editorHoverBorder);
	if (border) {
		let borderWidth = theme.type === HIGH_CONTRAST ? 2 : 1;
		collector.addRule(`.monaco-editor .token-inspect-widget { border: ${borderWidth}px solid ${border}; }`);
		collector.addRule(`.monaco-editor .token-inspect-widget .tiw-metadata-separator { background-color: ${border}; }`);
	}
	const background = theme.getColor(editorHoverBackground);
	if (background) {
		collector.addRule(`.monaco-editor .token-inspect-widget { background-color: ${background}; }`);
	}
});
