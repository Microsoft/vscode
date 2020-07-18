/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Color } from 'vs/base/common/color';
import { Event } from 'vs/base/common/event';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { IDisposable } from 'vs/base/common/lifecycle';
import { isObject } from 'vs/base/common/types';
import { URI, UriComponents } from 'vs/base/common/uri';
import { Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { TokenizationResult, TokenizationResult2 } from 'vs/editor/common/core/token';
import * as model from 'vs/editor/common/model';
import { LanguageFeatureRegistry } from 'vs/editor/common/modes/languageFeatureRegistry';
import { TokenizationRegistryImpl } from 'vs/editor/common/modes/tokenizationRegistry';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IMarkerData } from 'vs/platform/markers/common/markers';
import { iconRegistry, Codicon } from 'vs/base/common/codicons';

/**
 * Open ended enum at runtime
 * @internal
 */
export const enum LanguageId {
	Null = 0,
	PlainText = 1
}

/**
 * @internal
 */
export class LanguageIdentifier {

	/**
	 * A string identifier. Unique across languages. e.g. 'javascript'.
	 */
	public readonly language: string;

	/**
	 * A numeric identifier. Unique across languages. e.g. 5
	 * Will vary at runtime based on registration order, etc.
	 */
	public readonly id: LanguageId;

	constructor(language: string, id: LanguageId) {
		this.language = language;
		this.id = id;
	}
}

/**
 * A mode. Will soon be obsolete.
 * @internal
 */
export interface IMode {

	getId(): string;

	getLanguageIdentifier(): LanguageIdentifier;

}

/**
 * A font style. Values are 2^x such that a bit mask can be used.
 * @internal
 */
export const enum FontStyle {
	NotSet = -1,
	None = 0,
	Italic = 1,
	Bold = 2,
	Underline = 4
}

/**
 * Open ended enum at runtime
 * @internal
 */
export const enum ColorId {
	None = 0,
	DefaultForeground = 1,
	DefaultBackground = 2
}

/**
 * A standard token type. Values are 2^x such that a bit mask can be used.
 * @internal
 */
export const enum StandardTokenType {
	Other = 0,
	Comment = 1,
	String = 2,
	RegEx = 4
}

/**
 * Helpers to manage the "collapsed" metadata of an entire StackElement stack.
 * The following assumptions have been made:
 *  - languageId < 256 => needs 8 bits
 *  - unique color count < 512 => needs 9 bits
 *
 * The binary format is:
 * - -------------------------------------------
 *     3322 2222 2222 1111 1111 1100 0000 0000
 *     1098 7654 3210 9876 5432 1098 7654 3210
 * - -------------------------------------------
 *     xxxx xxxx xxxx xxxx xxxx xxxx xxxx xxxx
 *     bbbb bbbb bfff ffff ffFF FTTT LLLL LLLL
 * - -------------------------------------------
 *  - L = LanguageId (8 bits)
 *  - T = StandardTokenType (3 bits)
 *  - F = FontStyle (3 bits)
 *  - f = foreground color (9 bits)
 *  - b = background color (9 bits)
 *
 * @internal
 */
export const enum MetadataConsts {
	LANGUAGEID_MASK = 0b00000000000000000000000011111111,
	TOKEN_TYPE_MASK = 0b00000000000000000000011100000000,
	FONT_STYLE_MASK = 0b00000000000000000011100000000000,
	FOREGROUND_MASK = 0b00000000011111111100000000000000,
	BACKGROUND_MASK = 0b11111111100000000000000000000000,

	ITALIC_MASK = 0b00000000000000000000100000000000,
	BOLD_MASK = 0b00000000000000000001000000000000,
	UNDERLINE_MASK = 0b00000000000000000010000000000000,

	SEMANTIC_USE_ITALIC = 0b00000000000000000000000000000001,
	SEMANTIC_USE_BOLD = 0b00000000000000000000000000000010,
	SEMANTIC_USE_UNDERLINE = 0b00000000000000000000000000000100,
	SEMANTIC_USE_FOREGROUND = 0b00000000000000000000000000001000,
	SEMANTIC_USE_BACKGROUND = 0b00000000000000000000000000010000,

	LANGUAGEID_OFFSET = 0,
	TOKEN_TYPE_OFFSET = 8,
	FONT_STYLE_OFFSET = 11,
	FOREGROUND_OFFSET = 14,
	BACKGROUND_OFFSET = 23
}

/**
 * @internal
 */
export class TokenMetadata {

	public static getLanguageId(metadata: number): LanguageId {
		return (metadata & MetadataConsts.LANGUAGEID_MASK) >>> MetadataConsts.LANGUAGEID_OFFSET;
	}

	public static getTokenType(metadata: number): StandardTokenType {
		return (metadata & MetadataConsts.TOKEN_TYPE_MASK) >>> MetadataConsts.TOKEN_TYPE_OFFSET;
	}

	public static getFontStyle(metadata: number): FontStyle {
		return (metadata & MetadataConsts.FONT_STYLE_MASK) >>> MetadataConsts.FONT_STYLE_OFFSET;
	}

	public static getForeground(metadata: number): ColorId {
		return (metadata & MetadataConsts.FOREGROUND_MASK) >>> MetadataConsts.FOREGROUND_OFFSET;
	}

	public static getBackground(metadata: number): ColorId {
		return (metadata & MetadataConsts.BACKGROUND_MASK) >>> MetadataConsts.BACKGROUND_OFFSET;
	}

	public static getClassNameFromMetadata(metadata: number): string {
		let foreground = this.getForeground(metadata);
		let className = 'mtk' + foreground;

		let fontStyle = this.getFontStyle(metadata);
		if (fontStyle & FontStyle.Italic) {
			className += ' mtki';
		}
		if (fontStyle & FontStyle.Bold) {
			className += ' mtkb';
		}
		if (fontStyle & FontStyle.Underline) {
			className += ' mtku';
		}

		return className;
	}

	public static getInlineStyleFromMetadata(metadata: number, colorMap: string[]): string {
		const foreground = this.getForeground(metadata);
		const fontStyle = this.getFontStyle(metadata);

		let result = `color: ${colorMap[foreground]};`;
		if (fontStyle & FontStyle.Italic) {
			result += 'font-style: italic;';
		}
		if (fontStyle & FontStyle.Bold) {
			result += 'font-weight: bold;';
		}
		if (fontStyle & FontStyle.Underline) {
			result += 'text-decoration: underline;';
		}
		return result;
	}
}

/**
 * @internal
 */
export interface ITokenizationSupport {

	getInitialState(): IState;

	// add offsetDelta to each of the returned indices
	tokenize(line: string, state: IState, offsetDelta: number): TokenizationResult;

	tokenize2(line: string, state: IState, offsetDelta: number): TokenizationResult2;
}

/**
 * The state of the tokenizer between two lines.
 * It is useful to store flags such as in multiline comment, etc.
 * The model will clone the previous line's state and pass it in to tokenize the next line.
 */
export interface IState {
	clone(): IState;
	equals(other: IState): boolean;
}

/**
 * A provider result represents the values a provider, like the [`HoverProvider`](#HoverProvider),
 * may return. For once this is the actual result type `T`, like `Hover`, or a thenable that resolves
 * to that type `T`. In addition, `null` and `undefined` can be returned - either directly or from a
 * thenable.
 */
export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

/**
 * A hover represents additional information for a symbol or word. Hovers are
 * rendered in a tooltip-like widget.
 */
export interface Hover {
	/**
	 * The contents of this hover.
	 */
	contents: IMarkdownString[];

	/**
	 * The range to which this hover applies. When missing, the
	 * editor will use the range at the current position or the
	 * current position itself.
	 */
	range?: IRange;
}

/**
 * The hover provider interface defines the contract between extensions and
 * the [hover](https://code.visualstudio.com/docs/editor/intellisense)-feature.
 */
export interface HoverProvider {
	/**
	 * Provide a hover for the given position and document. Multiple hovers at the same
	 * position will be merged by the editor. A hover can have a range which defaults
	 * to the word range at the position when omitted.
	 */
	provideHover(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<Hover>;
}

/**
 * An evaluatable expression represents additional information for an expression in a document. Evaluatable expression are
 * evaluated by a debugger or runtime and their result is rendered in a tooltip-like widget.
 */
export interface EvaluatableExpression {
	/**
	 * The range to which this expression applies.
	 */
	range: IRange;
	/*
	 * This expression overrides the expression extracted from the range.
	 */
	expression?: string;
}

/**
 * The hover provider interface defines the contract between extensions and
 * the [hover](https://code.visualstudio.com/docs/editor/intellisense)-feature.
 */
export interface EvaluatableExpressionProvider {
	/**
	 * Provide a hover for the given position and document. Multiple hovers at the same
	 * position will be merged by the editor. A hover can have a range which defaults
	 * to the word range at the position when omitted.
	 */
	provideEvaluatableExpression(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<EvaluatableExpression>;
}

export const enum CompletionItemKind {
	Method,
	Function,
	Constructor,
	Field,
	Variable,
	Class,
	Struct,
	Interface,
	Module,
	Property,
	Event,
	Operator,
	Unit,
	Value,
	Constant,
	Enum,
	EnumMember,
	Keyword,
	Text,
	Color,
	File,
	Reference,
	Customcolor,
	Folder,
	TypeParameter,
	User,
	Issue,
	Snippet, // <- highest value (used for compare!)
}

/**
 * @internal
 */
export const completionKindToCssClass = (function () {
	let data = Object.create(null);
	data[CompletionItemKind.Method] = 'symbol-method';
	data[CompletionItemKind.Function] = 'symbol-function';
	data[CompletionItemKind.Constructor] = 'symbol-constructor';
	data[CompletionItemKind.Field] = 'symbol-field';
	data[CompletionItemKind.Variable] = 'symbol-variable';
	data[CompletionItemKind.Class] = 'symbol-class';
	data[CompletionItemKind.Struct] = 'symbol-struct';
	data[CompletionItemKind.Interface] = 'symbol-interface';
	data[CompletionItemKind.Module] = 'symbol-module';
	data[CompletionItemKind.Property] = 'symbol-property';
	data[CompletionItemKind.Event] = 'symbol-event';
	data[CompletionItemKind.Operator] = 'symbol-operator';
	data[CompletionItemKind.Unit] = 'symbol-unit';
	data[CompletionItemKind.Value] = 'symbol-value';
	data[CompletionItemKind.Constant] = 'symbol-constant';
	data[CompletionItemKind.Enum] = 'symbol-enum';
	data[CompletionItemKind.EnumMember] = 'symbol-enum-member';
	data[CompletionItemKind.Keyword] = 'symbol-keyword';
	data[CompletionItemKind.Snippet] = 'symbol-snippet';
	data[CompletionItemKind.Text] = 'symbol-text';
	data[CompletionItemKind.Color] = 'symbol-color';
	data[CompletionItemKind.File] = 'symbol-file';
	data[CompletionItemKind.Reference] = 'symbol-reference';
	data[CompletionItemKind.Customcolor] = 'symbol-customcolor';
	data[CompletionItemKind.Folder] = 'symbol-folder';
	data[CompletionItemKind.TypeParameter] = 'symbol-type-parameter';
	data[CompletionItemKind.User] = 'account';
	data[CompletionItemKind.Issue] = 'issues';

	return function (kind: CompletionItemKind) {
		const name = data[kind];
		let codicon = name && iconRegistry.get(name);
		if (!codicon) {
			console.info('No codicon found for CompletionItemKind ' + kind);
			codicon = Codicon.symbolProperty;
		}
		return codicon.classNames;
	};
})();

/**
 * @internal
 */
export let completionKindFromString: {
	(value: string): CompletionItemKind;
	(value: string, strict: true): CompletionItemKind | undefined;
} = (function () {
	let data: Record<string, CompletionItemKind> = Object.create(null);
	data['method'] = CompletionItemKind.Method;
	data['function'] = CompletionItemKind.Function;
	data['constructor'] = <any>CompletionItemKind.Constructor;
	data['field'] = CompletionItemKind.Field;
	data['variable'] = CompletionItemKind.Variable;
	data['class'] = CompletionItemKind.Class;
	data['struct'] = CompletionItemKind.Struct;
	data['interface'] = CompletionItemKind.Interface;
	data['module'] = CompletionItemKind.Module;
	data['property'] = CompletionItemKind.Property;
	data['event'] = CompletionItemKind.Event;
	data['operator'] = CompletionItemKind.Operator;
	data['unit'] = CompletionItemKind.Unit;
	data['value'] = CompletionItemKind.Value;
	data['constant'] = CompletionItemKind.Constant;
	data['enum'] = CompletionItemKind.Enum;
	data['enum-member'] = CompletionItemKind.EnumMember;
	data['enumMember'] = CompletionItemKind.EnumMember;
	data['keyword'] = CompletionItemKind.Keyword;
	data['snippet'] = CompletionItemKind.Snippet;
	data['text'] = CompletionItemKind.Text;
	data['color'] = CompletionItemKind.Color;
	data['file'] = CompletionItemKind.File;
	data['reference'] = CompletionItemKind.Reference;
	data['customcolor'] = CompletionItemKind.Customcolor;
	data['folder'] = CompletionItemKind.Folder;
	data['type-parameter'] = CompletionItemKind.TypeParameter;
	data['typeParameter'] = CompletionItemKind.TypeParameter;
	data['account'] = CompletionItemKind.User;
	data['issue'] = CompletionItemKind.Issue;
	return function (value: string, strict?: true) {
		let res = data[value];
		if (typeof res === 'undefined' && !strict) {
			res = CompletionItemKind.Property;
		}
		return res;
	};
})();

export interface CompletionItemLabel {
	/**
	 * The function or variable. Rendered leftmost.
	 */
	name: string;

	/**
	 * The parameters without the return type. Render after `name`.
	 */
	parameters?: string;

	/**
	 * The fully qualified name, like package name or file path. Rendered after `signature`.
	 */
	qualifier?: string;

	/**
	 * The return-type of a function or type of a property/variable. Rendered rightmost.
	 */
	type?: string;
}

export const enum CompletionItemTag {
	Deprecated = 1
}

export const enum CompletionItemInsertTextRule {
	/**
	 * Adjust whitespace/indentation of multiline insert texts to
	 * match the current line indentation.
	 */
	KeepWhitespace = 0b001,

	/**
	 * `insertText` is a snippet.
	 */
	InsertAsSnippet = 0b100,
}

/**
 * A completion item represents a text snippet that is
 * proposed to complete text that is being typed.
 */
export interface CompletionItem {
	/**
	 * The label of this completion item. By default
	 * this is also the text that is inserted when selecting
	 * this completion.
	 */
	label: string | CompletionItemLabel;
	/**
	 * The kind of this completion item. Based on the kind
	 * an icon is chosen by the editor.
	 */
	kind: CompletionItemKind;
	/**
	 * A modifier to the `kind` which affect how the item
	 * is rendered, e.g. Deprecated is rendered with a strikeout
	 */
	tags?: ReadonlyArray<CompletionItemTag>;
	/**
	 * A human-readable string with additional information
	 * about this item, like type or symbol information.
	 */
	detail?: string;
	/**
	 * A human-readable string that represents a doc-comment.
	 */
	documentation?: string | IMarkdownString;
	/**
	 * A string that should be used when comparing this item
	 * with other items. When `falsy` the [label](#CompletionItem.label)
	 * is used.
	 */
	sortText?: string;
	/**
	 * A string that should be used when filtering a set of
	 * completion items. When `falsy` the [label](#CompletionItem.label)
	 * is used.
	 */
	filterText?: string;
	/**
	 * Select this item when showing. *Note* that only one completion item can be selected and
	 * that the editor decides which item that is. The rule is that the *first* item of those
	 * that match best is selected.
	 */
	preselect?: boolean;
	/**
	 * A string or snippet that should be inserted in a document when selecting
	 * this completion.
	 * is used.
	 */
	insertText: string;
	/**
	 * Addition rules (as bitmask) that should be applied when inserting
	 * this completion.
	 */
	insertTextRules?: CompletionItemInsertTextRule;
	/**
	 * A range of text that should be replaced by this completion item.
	 *
	 * Defaults to a range from the start of the [current word](#TextDocument.getWordRangeAtPosition) to the
	 * current position.
	 *
	 * *Note:* The range must be a [single line](#Range.isSingleLine) and it must
	 * [contain](#Range.contains) the position at which completion has been [requested](#CompletionItemProvider.provideCompletionItems).
	 */
	range: IRange | { insert: IRange, replace: IRange };
	/**
	 * An optional set of characters that when pressed while this completion is active will accept it first and
	 * then type that character. *Note* that all commit characters should have `length=1` and that superfluous
	 * characters will be ignored.
	 */
	commitCharacters?: string[];
	/**
	 * An optional array of additional text edits that are applied when
	 * selecting this completion. Edits must not overlap with the main edit
	 * nor with themselves.
	 */
	additionalTextEdits?: model.ISingleEditOperation[];
	/**
	 * A command that should be run upon acceptance of this item.
	 */
	command?: Command;

	/**
	 * @internal
	 */
	_id?: [number, number];
}

export interface CompletionList {
	suggestions: CompletionItem[];
	incomplete?: boolean;
	dispose?(): void;
}

/**
 * How a suggest provider was triggered.
 */
export const enum CompletionTriggerKind {
	Invoke = 0,
	TriggerCharacter = 1,
	TriggerForIncompleteCompletions = 2
}
/**
 * Contains additional information about the context in which
 * [completion provider](#CompletionItemProvider.provideCompletionItems) is triggered.
 */
export interface CompletionContext {
	/**
	 * How the completion was triggered.
	 */
	triggerKind: CompletionTriggerKind;
	/**
	 * Character that triggered the completion item provider.
	 *
	 * `undefined` if provider was not triggered by a character.
	 */
	triggerCharacter?: string;
}
/**
 * The completion item provider interface defines the contract between extensions and
 * the [IntelliSense](https://code.visualstudio.com/docs/editor/intellisense).
 *
 * When computing *complete* completion items is expensive, providers can optionally implement
 * the `resolveCompletionItem`-function. In that case it is enough to return completion
 * items with a [label](#CompletionItem.label) from the
 * [provideCompletionItems](#CompletionItemProvider.provideCompletionItems)-function. Subsequently,
 * when a completion item is shown in the UI and gains focus this provider is asked to resolve
 * the item, like adding [doc-comment](#CompletionItem.documentation) or [details](#CompletionItem.detail).
 */
export interface CompletionItemProvider {

	/**
	 * @internal
	 */
	_debugDisplayName?: string;

	triggerCharacters?: string[];
	/**
	 * Provide completion items for the given position and document.
	 */
	provideCompletionItems(model: model.ITextModel, position: Position, context: CompletionContext, token: CancellationToken): ProviderResult<CompletionList>;

	/**
	 * Given a completion item fill in more data, like [doc-comment](#CompletionItem.documentation)
	 * or [details](#CompletionItem.detail).
	 *
	 * The editor will only resolve a completion item once.
	 */
	resolveCompletionItem?(item: CompletionItem, token: CancellationToken): ProviderResult<CompletionItem>;
}

export interface CodeAction {
	title: string;
	command?: Command;
	edit?: WorkspaceEdit;
	diagnostics?: IMarkerData[];
	kind?: string;
	isPreferred?: boolean;
	disabled?: string;
}

/**
 * @internal
 */
export const enum CodeActionTriggerType {
	Auto = 1,
	Manual = 2,
}

/**
 * @internal
 */
export interface CodeActionContext {
	only?: string;
	trigger: CodeActionTriggerType;
}

export interface CodeActionList extends IDisposable {
	readonly actions: ReadonlyArray<CodeAction>;
}

/**
 * The code action interface defines the contract between extensions and
 * the [light bulb](https://code.visualstudio.com/docs/editor/editingevolved#_code-action) feature.
 * @internal
 */
export interface CodeActionProvider {

	displayName?: string

	/**
	 * Provide commands for the given document and range.
	 */
	provideCodeActions(model: model.ITextModel, range: Range | Selection, context: CodeActionContext, token: CancellationToken): ProviderResult<CodeActionList>;

	/**
	 * Optional list of CodeActionKinds that this provider returns.
	 */
	readonly providedCodeActionKinds?: ReadonlyArray<string>;

	readonly documentation?: ReadonlyArray<{ readonly kind: string, readonly command: Command }>;

	/**
	 * @internal
	 */
	_getAdditionalMenuItems?(context: CodeActionContext, actions: readonly CodeAction[]): Command[];
}

/**
 * Represents a parameter of a callable-signature. A parameter can
 * have a label and a doc-comment.
 */
export interface ParameterInformation {
	/**
	 * The label of this signature. Will be shown in
	 * the UI.
	 */
	label: string | [number, number];
	/**
	 * The human-readable doc-comment of this signature. Will be shown
	 * in the UI but can be omitted.
	 */
	documentation?: string | IMarkdownString;
}
/**
 * Represents the signature of something callable. A signature
 * can have a label, like a function-name, a doc-comment, and
 * a set of parameters.
 */
export interface SignatureInformation {
	/**
	 * The label of this signature. Will be shown in
	 * the UI.
	 */
	label: string;
	/**
	 * The human-readable doc-comment of this signature. Will be shown
	 * in the UI but can be omitted.
	 */
	documentation?: string | IMarkdownString;
	/**
	 * The parameters of this signature.
	 */
	parameters: ParameterInformation[];
	/**
	 * Index of the active parameter.
	 *
	 * If provided, this is used in place of `SignatureHelp.activeSignature`.
	 */
	activeParameter?: number;
}
/**
 * Signature help represents the signature of something
 * callable. There can be multiple signatures but only one
 * active and only one active parameter.
 */
export interface SignatureHelp {
	/**
	 * One or more signatures.
	 */
	signatures: SignatureInformation[];
	/**
	 * The active signature.
	 */
	activeSignature: number;
	/**
	 * The active parameter of the active signature.
	 */
	activeParameter: number;
}

export interface SignatureHelpResult extends IDisposable {
	value: SignatureHelp;
}

export enum SignatureHelpTriggerKind {
	Invoke = 1,
	TriggerCharacter = 2,
	ContentChange = 3,
}

export interface SignatureHelpContext {
	readonly triggerKind: SignatureHelpTriggerKind;
	readonly triggerCharacter?: string;
	readonly isRetrigger: boolean;
	readonly activeSignatureHelp?: SignatureHelp;
}

/**
 * The signature help provider interface defines the contract between extensions and
 * the [parameter hints](https://code.visualstudio.com/docs/editor/intellisense)-feature.
 */
export interface SignatureHelpProvider {

	readonly signatureHelpTriggerCharacters?: ReadonlyArray<string>;
	readonly signatureHelpRetriggerCharacters?: ReadonlyArray<string>;

	/**
	 * Provide help for the signature at the given position and document.
	 */
	provideSignatureHelp(model: model.ITextModel, position: Position, token: CancellationToken, context: SignatureHelpContext): ProviderResult<SignatureHelpResult>;
}

/**
 * A document highlight kind.
 */
export enum DocumentHighlightKind {
	/**
	 * A textual occurrence.
	 */
	Text,
	/**
	 * Read-access of a symbol, like reading a variable.
	 */
	Read,
	/**
	 * Write-access of a symbol, like writing to a variable.
	 */
	Write
}
/**
 * A document highlight is a range inside a text document which deserves
 * special attention. Usually a document highlight is visualized by changing
 * the background color of its range.
 */
export interface DocumentHighlight {
	/**
	 * The range this highlight applies to.
	 */
	range: IRange;
	/**
	 * The highlight kind, default is [text](#DocumentHighlightKind.Text).
	 */
	kind?: DocumentHighlightKind;
}
/**
 * The document highlight provider interface defines the contract between extensions and
 * the word-highlight-feature.
 */
export interface DocumentHighlightProvider {
	/**
	 * Provide a set of document highlights, like all occurrences of a variable or
	 * all exit-points of a function.
	 */
	provideDocumentHighlights(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<DocumentHighlight[]>;
}

/**
 * The rename provider interface defines the contract between extensions and
 * the live-rename feature.
 */
export interface OnTypeRenameProvider {

	stopPattern?: RegExp;

	/**
	 * Provide a list of ranges that can be live-renamed together.
	 */
	provideOnTypeRenameRanges(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<IRange[]>;
}

/**
 * Value-object that contains additional information when
 * requesting references.
 */
export interface ReferenceContext {
	/**
	 * Include the declaration of the current symbol.
	 */
	includeDeclaration: boolean;
}
/**
 * The reference provider interface defines the contract between extensions and
 * the [find references](https://code.visualstudio.com/docs/editor/editingevolved#_peek)-feature.
 */
export interface ReferenceProvider {
	/**
	 * Provide a set of project-wide references for the given position and document.
	 */
	provideReferences(model: model.ITextModel, position: Position, context: ReferenceContext, token: CancellationToken): ProviderResult<Location[]>;
}

/**
 * Represents a location inside a resource, such as a line
 * inside a text file.
 */
export interface Location {
	/**
	 * The resource identifier of this location.
	 */
	uri: URI;
	/**
	 * The document range of this locations.
	 */
	range: IRange;
}

export interface LocationLink {
	/**
	 * A range to select where this link originates from.
	 */
	originSelectionRange?: IRange;

	/**
	 * The target uri this link points to.
	 */
	uri: URI;

	/**
	 * The full range this link points to.
	 */
	range: IRange;

	/**
	 * A range to select this link points to. Must be contained
	 * in `LocationLink.range`.
	 */
	targetSelectionRange?: IRange;
}

/**
 * @internal
 */
export function isLocationLink(thing: any): thing is LocationLink {
	return thing
		&& URI.isUri((thing as LocationLink).uri)
		&& Range.isIRange((thing as LocationLink).range)
		&& (Range.isIRange((thing as LocationLink).originSelectionRange) || Range.isIRange((thing as LocationLink).targetSelectionRange));
}

export type Definition = Location | Location[] | LocationLink[];

/**
 * The definition provider interface defines the contract between extensions and
 * the [go to definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-definition)
 * and peek definition features.
 */
export interface DefinitionProvider {
	/**
	 * Provide the definition of the symbol at the given position and document.
	 */
	provideDefinition(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
}

/**
 * The definition provider interface defines the contract between extensions and
 * the [go to definition](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-definition)
 * and peek definition features.
 */
export interface DeclarationProvider {
	/**
	 * Provide the declaration of the symbol at the given position and document.
	 */
	provideDeclaration(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
}

/**
 * The implementation provider interface defines the contract between extensions and
 * the go to implementation feature.
 */
export interface ImplementationProvider {
	/**
	 * Provide the implementation of the symbol at the given position and document.
	 */
	provideImplementation(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
}

/**
 * The type definition provider interface defines the contract between extensions and
 * the go to type definition feature.
 */
export interface TypeDefinitionProvider {
	/**
	 * Provide the type definition of the symbol at the given position and document.
	 */
	provideTypeDefinition(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<Definition | LocationLink[]>;
}

/**
 * A symbol kind.
 */
export const enum SymbolKind {
	File = 0,
	Module = 1,
	Namespace = 2,
	Package = 3,
	Class = 4,
	Method = 5,
	Property = 6,
	Field = 7,
	Constructor = 8,
	Enum = 9,
	Interface = 10,
	Function = 11,
	Variable = 12,
	Constant = 13,
	String = 14,
	Number = 15,
	Boolean = 16,
	Array = 17,
	Object = 18,
	Key = 19,
	Null = 20,
	EnumMember = 21,
	Struct = 22,
	Event = 23,
	Operator = 24,
	TypeParameter = 25
}

export const enum SymbolTag {
	Deprecated = 1,
}

/**
 * @internal
 */
export namespace SymbolKinds {

	const byName = new Map<string, SymbolKind>();
	byName.set('file', SymbolKind.File);
	byName.set('module', SymbolKind.Module);
	byName.set('namespace', SymbolKind.Namespace);
	byName.set('package', SymbolKind.Package);
	byName.set('class', SymbolKind.Class);
	byName.set('method', SymbolKind.Method);
	byName.set('property', SymbolKind.Property);
	byName.set('field', SymbolKind.Field);
	byName.set('constructor', SymbolKind.Constructor);
	byName.set('enum', SymbolKind.Enum);
	byName.set('interface', SymbolKind.Interface);
	byName.set('function', SymbolKind.Function);
	byName.set('variable', SymbolKind.Variable);
	byName.set('constant', SymbolKind.Constant);
	byName.set('string', SymbolKind.String);
	byName.set('number', SymbolKind.Number);
	byName.set('boolean', SymbolKind.Boolean);
	byName.set('array', SymbolKind.Array);
	byName.set('object', SymbolKind.Object);
	byName.set('key', SymbolKind.Key);
	byName.set('null', SymbolKind.Null);
	byName.set('enum-member', SymbolKind.EnumMember);
	byName.set('struct', SymbolKind.Struct);
	byName.set('event', SymbolKind.Event);
	byName.set('operator', SymbolKind.Operator);
	byName.set('type-parameter', SymbolKind.TypeParameter);

	const byKind = new Map<SymbolKind, string>();
	byKind.set(SymbolKind.File, 'file');
	byKind.set(SymbolKind.Module, 'module');
	byKind.set(SymbolKind.Namespace, 'namespace');
	byKind.set(SymbolKind.Package, 'package');
	byKind.set(SymbolKind.Class, 'class');
	byKind.set(SymbolKind.Method, 'method');
	byKind.set(SymbolKind.Property, 'property');
	byKind.set(SymbolKind.Field, 'field');
	byKind.set(SymbolKind.Constructor, 'constructor');
	byKind.set(SymbolKind.Enum, 'enum');
	byKind.set(SymbolKind.Interface, 'interface');
	byKind.set(SymbolKind.Function, 'function');
	byKind.set(SymbolKind.Variable, 'variable');
	byKind.set(SymbolKind.Constant, 'constant');
	byKind.set(SymbolKind.String, 'string');
	byKind.set(SymbolKind.Number, 'number');
	byKind.set(SymbolKind.Boolean, 'boolean');
	byKind.set(SymbolKind.Array, 'array');
	byKind.set(SymbolKind.Object, 'object');
	byKind.set(SymbolKind.Key, 'key');
	byKind.set(SymbolKind.Null, 'null');
	byKind.set(SymbolKind.EnumMember, 'enum-member');
	byKind.set(SymbolKind.Struct, 'struct');
	byKind.set(SymbolKind.Event, 'event');
	byKind.set(SymbolKind.Operator, 'operator');
	byKind.set(SymbolKind.TypeParameter, 'type-parameter');
	/**
	 * @internal
	 */
	export function fromString(value: string): SymbolKind | undefined {
		return byName.get(value);
	}
	/**
	 * @internal
	 */
	export function toString(kind: SymbolKind): string | undefined {
		return byKind.get(kind);
	}
	/**
	 * @internal
	 */
	export function toCssClassName(kind: SymbolKind, inline?: boolean): string {
		const symbolName = byKind.get(kind);
		let codicon = symbolName && iconRegistry.get('symbol-' + symbolName);
		if (!codicon) {
			console.info('No codicon found for SymbolKind ' + kind);
			codicon = Codicon.symbolProperty;
		}
		return `${inline ? 'inline' : 'block'} ${codicon.classNames}`;
	}
}

export interface DocumentSymbol {
	name: string;
	detail: string;
	kind: SymbolKind;
	tags: ReadonlyArray<SymbolTag>;
	containerName?: string;
	range: IRange;
	selectionRange: IRange;
	children?: DocumentSymbol[];
}

/**
 * The document symbol provider interface defines the contract between extensions and
 * the [go to symbol](https://code.visualstudio.com/docs/editor/editingevolved#_go-to-symbol)-feature.
 */
export interface DocumentSymbolProvider {

	displayName?: string;

	/**
	 * Provide symbol information for the given document.
	 */
	provideDocumentSymbols(model: model.ITextModel, token: CancellationToken): ProviderResult<DocumentSymbol[]>;
}

export type TextEdit = { range: IRange; text: string; eol?: model.EndOfLineSequence; };

/**
 * Interface used to format a model
 */
export interface FormattingOptions {
	/**
	 * Size of a tab in spaces.
	 */
	tabSize: number;
	/**
	 * Prefer spaces over tabs.
	 */
	insertSpaces: boolean;
}
/**
 * The document formatting provider interface defines the contract between extensions and
 * the formatting-feature.
 */
export interface DocumentFormattingEditProvider {

	/**
	 * @internal
	 */
	readonly extensionId?: ExtensionIdentifier;

	readonly displayName?: string;

	/**
	 * Provide formatting edits for a whole document.
	 */
	provideDocumentFormattingEdits(model: model.ITextModel, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
}
/**
 * The document formatting provider interface defines the contract between extensions and
 * the formatting-feature.
 */
export interface DocumentRangeFormattingEditProvider {
	/**
	 * @internal
	 */
	readonly extensionId?: ExtensionIdentifier;

	readonly displayName?: string;

	/**
	 * Provide formatting edits for a range in a document.
	 *
	 * The given range is a hint and providers can decide to format a smaller
	 * or larger range. Often this is done by adjusting the start and end
	 * of the range to full syntax nodes.
	 */
	provideDocumentRangeFormattingEdits(model: model.ITextModel, range: Range, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
}
/**
 * The document formatting provider interface defines the contract between extensions and
 * the formatting-feature.
 */
export interface OnTypeFormattingEditProvider {


	/**
	 * @internal
	 */
	readonly extensionId?: ExtensionIdentifier;

	autoFormatTriggerCharacters: string[];

	/**
	 * Provide formatting edits after a character has been typed.
	 *
	 * The given position and character should hint to the provider
	 * what range the position to expand to, like find the matching `{`
	 * when `}` has been entered.
	 */
	provideOnTypeFormattingEdits(model: model.ITextModel, position: Position, ch: string, options: FormattingOptions, token: CancellationToken): ProviderResult<TextEdit[]>;
}

/**
 * @internal
 */
export interface IInplaceReplaceSupportResult {
	value: string;
	range: IRange;
}

/**
 * A link inside the editor.
 */
export interface ILink {
	range: IRange;
	url?: URI | string;
	tooltip?: string;
}

export interface ILinksList {
	links: ILink[];
	dispose?(): void;
}
/**
 * A provider of links.
 */
export interface LinkProvider {
	provideLinks(model: model.ITextModel, token: CancellationToken): ProviderResult<ILinksList>;
	resolveLink?: (link: ILink, token: CancellationToken) => ProviderResult<ILink>;
}

/**
 * A color in RGBA format.
 */
export interface IColor {

	/**
	 * The red component in the range [0-1].
	 */
	readonly red: number;

	/**
	 * The green component in the range [0-1].
	 */
	readonly green: number;

	/**
	 * The blue component in the range [0-1].
	 */
	readonly blue: number;

	/**
	 * The alpha component in the range [0-1].
	 */
	readonly alpha: number;
}

/**
 * String representations for a color
 */
export interface IColorPresentation {
	/**
	 * The label of this color presentation. It will be shown on the color
	 * picker header. By default this is also the text that is inserted when selecting
	 * this color presentation.
	 */
	label: string;
	/**
	 * An [edit](#TextEdit) which is applied to a document when selecting
	 * this presentation for the color.
	 */
	textEdit?: TextEdit;
	/**
	 * An optional array of additional [text edits](#TextEdit) that are applied when
	 * selecting this color presentation.
	 */
	additionalTextEdits?: TextEdit[];
}

/**
 * A color range is a range in a text model which represents a color.
 */
export interface IColorInformation {

	/**
	 * The range within the model.
	 */
	range: IRange;

	/**
	 * The color represented in this range.
	 */
	color: IColor;
}

/**
 * A provider of colors for editor models.
 */
export interface DocumentColorProvider {
	/**
	 * Provides the color ranges for a specific model.
	 */
	provideDocumentColors(model: model.ITextModel, token: CancellationToken): ProviderResult<IColorInformation[]>;
	/**
	 * Provide the string representations for a color.
	 */
	provideColorPresentations(model: model.ITextModel, colorInfo: IColorInformation, token: CancellationToken): ProviderResult<IColorPresentation[]>;
}

export interface SelectionRange {
	range: IRange;
}

export interface SelectionRangeProvider {
	/**
	 * Provide ranges that should be selected from the given position.
	 */
	provideSelectionRanges(model: model.ITextModel, positions: Position[], token: CancellationToken): ProviderResult<SelectionRange[][]>;
}

export interface FoldingContext {
}
/**
 * A provider of folding ranges for editor models.
 */
export interface FoldingRangeProvider {
	/**
	 * Provides the folding ranges for a specific model.
	 */
	provideFoldingRanges(model: model.ITextModel, context: FoldingContext, token: CancellationToken): ProviderResult<FoldingRange[]>;
}

export interface FoldingRange {

	/**
	 * The one-based start line of the range to fold. The folded area starts after the line's last character.
	 */
	start: number;

	/**
	 * The one-based end line of the range to fold. The folded area ends with the line's last character.
	 */
	end: number;

	/**
	 * Describes the [Kind](#FoldingRangeKind) of the folding range such as [Comment](#FoldingRangeKind.Comment) or
	 * [Region](#FoldingRangeKind.Region). The kind is used to categorize folding ranges and used by commands
	 * like 'Fold all comments'. See
	 * [FoldingRangeKind](#FoldingRangeKind) for an enumeration of standardized kinds.
	 */
	kind?: FoldingRangeKind;
}
export class FoldingRangeKind {
	/**
	 * Kind for folding range representing a comment. The value of the kind is 'comment'.
	 */
	static readonly Comment = new FoldingRangeKind('comment');
	/**
	 * Kind for folding range representing a import. The value of the kind is 'imports'.
	 */
	static readonly Imports = new FoldingRangeKind('imports');
	/**
	 * Kind for folding range representing regions (for example marked by `#region`, `#endregion`).
	 * The value of the kind is 'region'.
	 */
	static readonly Region = new FoldingRangeKind('region');

	/**
	 * Creates a new [FoldingRangeKind](#FoldingRangeKind).
	 *
	 * @param value of the kind.
	 */
	public constructor(public value: string) {
	}
}

/**
 * @internal
 */
export namespace WorkspaceFileEdit {
	/**
	 * @internal
	 */
	export function is(thing: any): thing is WorkspaceFileEdit {
		return isObject(thing) && (Boolean((<WorkspaceFileEdit>thing).newUri) || Boolean((<WorkspaceFileEdit>thing).oldUri));
	}
}

/**
 * @internal
 */
export namespace WorkspaceTextEdit {
	/**
	 * @internal
	 */
	export function is(thing: any): thing is WorkspaceTextEdit {
		return isObject(thing) && URI.isUri((<WorkspaceTextEdit>thing).resource) && isObject((<WorkspaceTextEdit>thing).edit);
	}
}

export interface WorkspaceEditMetadata {
	needsConfirmation: boolean;
	label: string;
	description?: string;
	iconPath?: { id: string } | URI | { light: URI, dark: URI };
}

export interface WorkspaceFileEditOptions {
	overwrite?: boolean;
	ignoreIfNotExists?: boolean;
	ignoreIfExists?: boolean;
	recursive?: boolean;
}

export interface WorkspaceFileEdit {
	oldUri?: URI;
	newUri?: URI;
	options?: WorkspaceFileEditOptions;
	metadata?: WorkspaceEditMetadata;
}

export interface WorkspaceTextEdit {
	resource: URI;
	edit: TextEdit;
	modelVersionId?: number;
	metadata?: WorkspaceEditMetadata;
}

export interface WorkspaceEdit {
	edits: Array<WorkspaceTextEdit | WorkspaceFileEdit>;
}

export interface Rejection {
	rejectReason?: string;
}
export interface RenameLocation {
	range: IRange;
	text: string;
}

export interface RenameProvider {
	provideRenameEdits(model: model.ITextModel, position: Position, newName: string, token: CancellationToken): ProviderResult<WorkspaceEdit & Rejection>;
	resolveRenameLocation?(model: model.ITextModel, position: Position, token: CancellationToken): ProviderResult<RenameLocation & Rejection>;
}

/**
 * @internal
 */
export interface AuthenticationSession {
	id: string;
	accessToken: string;
	account: {
		label: string;
		id: string;
	}
	scopes: ReadonlyArray<string>;
}

/**
 * @internal
 */
export interface AuthenticationSessionsChangeEvent {
	added: ReadonlyArray<string>;
	removed: ReadonlyArray<string>;
	changed: ReadonlyArray<string>;
}

/**
 * @internal
 */
export interface AuthenticationProviderInformation {
	id: string;
	label: string;
}

export interface Command {
	id: string;
	title: string;
	tooltip?: string;
	arguments?: any[];
}

/**
 * @internal
 */
export interface CommentThreadTemplate {
	controllerHandle: number;
	label: string;
	acceptInputCommand?: Command;
	additionalCommands?: Command[];
	deleteCommand?: Command;
}

/**
 * @internal
 */
export interface CommentInfo {
	extensionId?: string;
	threads: CommentThread[];
	commentingRanges: CommentingRanges;
}

/**
 * @internal
 */
export enum CommentThreadCollapsibleState {
	/**
	 * Determines an item is collapsed
	 */
	Collapsed = 0,
	/**
	 * Determines an item is expanded
	 */
	Expanded = 1
}



/**
 * @internal
 */
export interface CommentWidget {
	commentThread: CommentThread;
	comment?: Comment;
	input: string;
	onDidChangeInput: Event<string>;
}

/**
 * @internal
 */
export interface CommentInput {
	value: string;
	uri: URI;
}

/**
 * @internal
 */
export interface CommentThread {
	commentThreadHandle: number;
	controllerHandle: number;
	extensionId?: string;
	threadId: string;
	resource: string | null;
	range: IRange;
	label: string | undefined;
	contextValue: string | undefined;
	comments: Comment[] | undefined;
	onDidChangeComments: Event<Comment[] | undefined>;
	collapsibleState?: CommentThreadCollapsibleState;
	input?: CommentInput;
	onDidChangeInput: Event<CommentInput | undefined>;
	onDidChangeRange: Event<IRange>;
	onDidChangeLabel: Event<string | undefined>;
	onDidChangeCollasibleState: Event<CommentThreadCollapsibleState | undefined>;
	isDisposed: boolean;
}

/**
 * @internal
 */

export interface CommentingRanges {
	readonly resource: URI;
	ranges: IRange[];
}

/**
 * @internal
 */
export interface CommentReaction {
	readonly label?: string;
	readonly iconPath?: UriComponents;
	readonly count?: number;
	readonly hasReacted?: boolean;
	readonly canEdit?: boolean;
}

/**
 * @internal
 */
export interface CommentOptions {
	/**
	 * An optional string to show on the comment input box when it's collapsed.
	 */
	prompt?: string;

	/**
	 * An optional string to show as placeholder in the comment input box when it's focused.
	 */
	placeHolder?: string;
}

/**
 * @internal
 */
export enum CommentMode {
	Editing = 0,
	Preview = 1
}

/**
 * @internal
 */
export interface Comment {
	readonly uniqueIdInThread: number;
	readonly body: IMarkdownString;
	readonly userName: string;
	readonly userIconPath?: string;
	readonly contextValue?: string;
	readonly commentReactions?: CommentReaction[];
	readonly label?: string;
	readonly mode?: CommentMode;
}

/**
 * @internal
 */
export interface CommentThreadChangedEvent {
	/**
	 * Added comment threads.
	 */
	readonly added: CommentThread[];

	/**
	 * Removed comment threads.
	 */
	readonly removed: CommentThread[];

	/**
	 * Changed comment threads.
	 */
	readonly changed: CommentThread[];
}

/**
 * @internal
 */
export interface IWebviewPortMapping {
	webviewPort: number;
	extensionHostPort: number;
}

/**
 * @internal
 */
export interface IWebviewOptions {
	readonly enableScripts?: boolean;
	readonly enableCommandUris?: boolean;
	readonly localResourceRoots?: ReadonlyArray<UriComponents>;
	readonly portMapping?: ReadonlyArray<IWebviewPortMapping>;
}

/**
 * @internal
 */
export interface IWebviewPanelOptions {
	readonly enableFindWidget?: boolean;
	readonly retainContextWhenHidden?: boolean;
}


export interface CodeLens {
	range: IRange;
	id?: string;
	command?: Command;
}

export interface CodeLensList {
	lenses: CodeLens[];
	dispose(): void;
}

export interface CodeLensProvider {
	onDidChange?: Event<this>;
	provideCodeLenses(model: model.ITextModel, token: CancellationToken): ProviderResult<CodeLensList>;
	resolveCodeLens?(model: model.ITextModel, codeLens: CodeLens, token: CancellationToken): ProviderResult<CodeLens>;
}

export interface SemanticTokensLegend {
	readonly tokenTypes: string[];
	readonly tokenModifiers: string[];
}

export interface SemanticTokens {
	readonly resultId?: string;
	readonly data: Uint32Array;
}

export interface SemanticTokensEdit {
	readonly start: number;
	readonly deleteCount: number;
	readonly data?: Uint32Array;
}

export interface SemanticTokensEdits {
	readonly resultId?: string;
	readonly edits: SemanticTokensEdit[];
}

export interface DocumentSemanticTokensProvider {
	onDidChange?: Event<void>;
	getLegend(): SemanticTokensLegend;
	provideDocumentSemanticTokens(model: model.ITextModel, lastResultId: string | null, token: CancellationToken): ProviderResult<SemanticTokens | SemanticTokensEdits>;
	releaseDocumentSemanticTokens(resultId: string | undefined): void;
}

export interface DocumentRangeSemanticTokensProvider {
	getLegend(): SemanticTokensLegend;
	provideDocumentRangeSemanticTokens(model: model.ITextModel, range: Range, token: CancellationToken): ProviderResult<SemanticTokens>;
}

// --- feature registries ------

/**
 * @internal
 */
export const ReferenceProviderRegistry = new LanguageFeatureRegistry<ReferenceProvider>();

/**
 * @internal
 */
export const RenameProviderRegistry = new LanguageFeatureRegistry<RenameProvider>();

/**
 * @internal
 */
export const CompletionProviderRegistry = new LanguageFeatureRegistry<CompletionItemProvider>();

/**
 * @internal
 */
export const SignatureHelpProviderRegistry = new LanguageFeatureRegistry<SignatureHelpProvider>();

/**
 * @internal
 */
export const HoverProviderRegistry = new LanguageFeatureRegistry<HoverProvider>();

/**
 * @internal
 */
export const EvaluatableExpressionProviderRegistry = new LanguageFeatureRegistry<EvaluatableExpressionProvider>();

/**
 * @internal
 */
export const DocumentSymbolProviderRegistry = new LanguageFeatureRegistry<DocumentSymbolProvider>();

/**
 * @internal
 */
export const DocumentHighlightProviderRegistry = new LanguageFeatureRegistry<DocumentHighlightProvider>();

/**
 * @internal
 */
export const OnTypeRenameProviderRegistry = new LanguageFeatureRegistry<OnTypeRenameProvider>();

/**
 * @internal
 */
export const DefinitionProviderRegistry = new LanguageFeatureRegistry<DefinitionProvider>();

/**
 * @internal
 */
export const DeclarationProviderRegistry = new LanguageFeatureRegistry<DeclarationProvider>();

/**
 * @internal
 */
export const ImplementationProviderRegistry = new LanguageFeatureRegistry<ImplementationProvider>();

/**
 * @internal
 */
export const TypeDefinitionProviderRegistry = new LanguageFeatureRegistry<TypeDefinitionProvider>();

/**
 * @internal
 */
export const CodeLensProviderRegistry = new LanguageFeatureRegistry<CodeLensProvider>();

/**
 * @internal
 */
export const CodeActionProviderRegistry = new LanguageFeatureRegistry<CodeActionProvider>();

/**
 * @internal
 */
export const DocumentFormattingEditProviderRegistry = new LanguageFeatureRegistry<DocumentFormattingEditProvider>();

/**
 * @internal
 */
export const DocumentRangeFormattingEditProviderRegistry = new LanguageFeatureRegistry<DocumentRangeFormattingEditProvider>();

/**
 * @internal
 */
export const OnTypeFormattingEditProviderRegistry = new LanguageFeatureRegistry<OnTypeFormattingEditProvider>();

/**
 * @internal
 */
export const LinkProviderRegistry = new LanguageFeatureRegistry<LinkProvider>();

/**
 * @internal
 */
export const ColorProviderRegistry = new LanguageFeatureRegistry<DocumentColorProvider>();

/**
 * @internal
 */
export const SelectionRangeRegistry = new LanguageFeatureRegistry<SelectionRangeProvider>();

/**
 * @internal
 */
export const FoldingRangeProviderRegistry = new LanguageFeatureRegistry<FoldingRangeProvider>();

/**
 * @internal
 */
export const DocumentSemanticTokensProviderRegistry = new LanguageFeatureRegistry<DocumentSemanticTokensProvider>();

/**
 * @internal
 */
export const DocumentRangeSemanticTokensProviderRegistry = new LanguageFeatureRegistry<DocumentRangeSemanticTokensProvider>();

/**
 * @internal
 */
export interface ITokenizationSupportChangedEvent {
	changedLanguages: string[];
	changedColorMap: boolean;
}

/**
 * @internal
 */
export interface ITokenizationRegistry {

	/**
	 * An event triggered when:
	 *  - a tokenization support is registered, unregistered or changed.
	 *  - the color map is changed.
	 */
	onDidChange: Event<ITokenizationSupportChangedEvent>;

	/**
	 * Fire a change event for a language.
	 * This is useful for languages that embed other languages.
	 */
	fire(languages: string[]): void;

	/**
	 * Register a tokenization support.
	 */
	register(language: string, support: ITokenizationSupport): IDisposable;

	/**
	 * Register a promise for a tokenization support.
	 */
	registerPromise(language: string, promise: Thenable<ITokenizationSupport>): IDisposable;

	/**
	 * Get the tokenization support for a language.
	 * Returns `null` if not found.
	 */
	get(language: string): ITokenizationSupport | null;

	/**
	 * Get the promise of a tokenization support for a language.
	 * `null` is returned if no support is available and no promise for the support has been registered yet.
	 */
	getPromise(language: string): Thenable<ITokenizationSupport> | null;

	/**
	 * Set the new color map that all tokens will use in their ColorId binary encoded bits for foreground and background.
	 */
	setColorMap(colorMap: Color[]): void;

	getColorMap(): Color[] | null;

	getDefaultBackground(): Color | null;
}

/**
 * @internal
 */
export const TokenizationRegistry = new TokenizationRegistryImpl();
