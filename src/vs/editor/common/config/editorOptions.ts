/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as platform from 'vs/base/common/platform';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { FontInfo } from 'vs/editor/common/config/fontInfo';
import { Constants } from 'vs/base/common/uint';
import { USUAL_WORD_SEPARATORS } from 'vs/editor/common/model/wordHelper';
import { AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { IConfigurationPropertySchema } from 'vs/platform/configuration/common/configurationRegistry';
import { IJSONSchema } from 'vs/base/common/jsonSchema';

//#region typed options

/**
 * Configuration options for auto closing quotes and brackets
 */
export type EditorAutoClosingStrategy = 'always' | 'languageDefined' | 'beforeWhitespace' | 'never';

/**
 * Configuration options for auto wrapping quotes and brackets
 */
export type EditorAutoSurroundStrategy = 'languageDefined' | 'quotes' | 'brackets' | 'never';

/**
 * Configuration options for typing over closing quotes or brackets
 */
export type EditorAutoClosingEditStrategy = 'always' | 'auto' | 'never';

/**
 * Configuration options for auto indentation in the editor
 */
export const enum EditorAutoIndentStrategy {
	None = 0,
	Keep = 1,
	Brackets = 2,
	Advanced = 3,
	Full = 4
}

/**
 * Configuration options for the editor.
 */
export interface IEditorOptions {
	/**
	 * This editor is used inside a diff editor.
	 */
	inDiffEditor?: boolean;
	/**
	 * The aria label for the editor's textarea (when it is focused).
	 */
	ariaLabel?: string;
	/**
	 * The `tabindex` property of the editor's textarea
	 */
	tabIndex?: number;
	/**
	 * Render vertical lines at the specified columns.
	 * Defaults to empty array.
	 */
	rulers?: (number | IRulerOption)[];
	/**
	 * A string containing the word separators used when doing word navigation.
	 * Defaults to `~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?
	 */
	wordSeparators?: string;
	/**
	 * Enable Linux primary clipboard.
	 * Defaults to true.
	 */
	selectionClipboard?: boolean;
	/**
	 * Control the rendering of line numbers.
	 * If it is a function, it will be invoked when rendering a line number and the return value will be rendered.
	 * Otherwise, if it is a truey, line numbers will be rendered normally (equivalent of using an identity function).
	 * Otherwise, line numbers will not be rendered.
	 * Defaults to `on`.
	 */
	lineNumbers?: LineNumbersType;
	/**
	 * Controls the minimal number of visible leading and trailing lines surrounding the cursor.
	 * Defaults to 0.
	*/
	cursorSurroundingLines?: number;
	/**
	 * Controls when `cursorSurroundingLines` should be enforced
	 * Defaults to `default`, `cursorSurroundingLines` is not enforced when cursor position is changed
	 * by mouse.
	*/
	cursorSurroundingLinesStyle?: 'default' | 'all';
	/**
	 * Render last line number when the file ends with a newline.
	 * Defaults to true.
	*/
	renderFinalNewline?: boolean;
	/**
	 * Remove unusual line terminators like LINE SEPARATOR (LS), PARAGRAPH SEPARATOR (PS).
	 * Defaults to 'prompt'.
	 */
	unusualLineTerminators?: 'auto' | 'off' | 'prompt';
	/**
	 * Should the corresponding line be selected when clicking on the line number?
	 * Defaults to true.
	 */
	selectOnLineNumbers?: boolean;
	/**
	 * Control the width of line numbers, by reserving horizontal space for rendering at least an amount of digits.
	 * Defaults to 5.
	 */
	lineNumbersMinChars?: number;
	/**
	 * Enable the rendering of the glyph margin.
	 * Defaults to true in vscode and to false in monaco-editor.
	 */
	glyphMargin?: boolean;
	/**
	 * The width reserved for line decorations (in px).
	 * Line decorations are placed between line numbers and the editor content.
	 * You can pass in a string in the format floating point followed by "ch". e.g. 1.3ch.
	 * Defaults to 10.
	 */
	lineDecorationsWidth?: number | string;
	/**
	 * When revealing the cursor, a virtual padding (px) is added to the cursor, turning it into a rectangle.
	 * This virtual padding ensures that the cursor gets revealed before hitting the edge of the viewport.
	 * Defaults to 30 (px).
	 */
	revealHorizontalRightPadding?: number;
	/**
	 * Render the editor selection with rounded borders.
	 * Defaults to true.
	 */
	roundedSelection?: boolean;
	/**
	 * Class name to be added to the editor.
	 */
	extraEditorClassName?: string;
	/**
	 * Should the editor be read only. See also `domReadOnly`.
	 * Defaults to false.
	 */
	readOnly?: boolean;
	/**
	 * Should the textarea used for input use the DOM `readonly` attribute.
	 * Defaults to false.
	 */
	domReadOnly?: boolean;
	/**
	 * Enable linked editing.
	 * Defaults to false.
	 */
	linkedEditing?: boolean;
	/**
	 * deprecated, use linkedEditing instead
	 */
	renameOnType?: boolean;
	/**
	 * Should the editor render validation decorations.
	 * Defaults to editable.
	 */
	renderValidationDecorations?: 'editable' | 'on' | 'off';
	/**
	 * Control the behavior and rendering of the scrollbars.
	 */
	scrollbar?: IEditorScrollbarOptions;
	/**
	 * Control the behavior and rendering of the minimap.
	 */
	minimap?: IEditorMinimapOptions;
	/**
	 * Control the behavior of the find widget.
	 */
	find?: IEditorFindOptions;
	/**
	 * Display overflow widgets as `fixed`.
	 * Defaults to `false`.
	 */
	fixedOverflowWidgets?: boolean;
	/**
	 * The number of vertical lanes the overview ruler should render.
	 * Defaults to 3.
	 */
	overviewRulerLanes?: number;
	/**
	 * Controls if a border should be drawn around the overview ruler.
	 * Defaults to `true`.
	 */
	overviewRulerBorder?: boolean;
	/**
	 * Control the cursor animation style, possible values are 'blink', 'smooth', 'phase', 'expand' and 'solid'.
	 * Defaults to 'blink'.
	 */
	cursorBlinking?: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid';
	/**
	 * Zoom the font in the editor when using the mouse wheel in combination with holding Ctrl.
	 * Defaults to false.
	 */
	mouseWheelZoom?: boolean;
	/**
	 * Control the mouse pointer style, either 'text' or 'default' or 'copy'
	 * Defaults to 'text'
	 */
	mouseStyle?: 'text' | 'default' | 'copy';
	/**
	 * Enable smooth caret animation.
	 * Defaults to false.
	 */
	cursorSmoothCaretAnimation?: boolean;
	/**
	 * Control the cursor style, either 'block' or 'line'.
	 * Defaults to 'line'.
	 */
	cursorStyle?: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin';
	/**
	 * Control the width of the cursor when cursorStyle is set to 'line'
	 */
	cursorWidth?: number;
	/**
	 * Enable font ligatures.
	 * Defaults to false.
	 */
	fontLigatures?: boolean | string;
	/**
	 * Disable the use of `transform: translate3d(0px, 0px, 0px)` for the editor margin and lines layers.
	 * The usage of `transform: translate3d(0px, 0px, 0px)` acts as a hint for browsers to create an extra layer.
	 * Defaults to false.
	 */
	disableLayerHinting?: boolean;
	/**
	 * Disable the optimizations for monospace fonts.
	 * Defaults to false.
	 */
	disableMonospaceOptimizations?: boolean;
	/**
	 * Should the cursor be hidden in the overview ruler.
	 * Defaults to false.
	 */
	hideCursorInOverviewRuler?: boolean;
	/**
	 * Enable that scrolling can go one screen size after the last line.
	 * Defaults to true.
	 */
	scrollBeyondLastLine?: boolean;
	/**
	 * Enable that scrolling can go beyond the last column by a number of columns.
	 * Defaults to 5.
	 */
	scrollBeyondLastColumn?: number;
	/**
	 * Enable that the editor animates scrolling to a position.
	 * Defaults to false.
	 */
	smoothScrolling?: boolean;
	/**
	 * Enable that the editor will install an interval to check if its container dom node size has changed.
	 * Enabling this might have a severe performance impact.
	 * Defaults to false.
	 */
	automaticLayout?: boolean;
	/**
	 * Control the wrapping of the editor.
	 * When `wordWrap` = "off", the lines will never wrap.
	 * When `wordWrap` = "on", the lines will wrap at the viewport width.
	 * When `wordWrap` = "wordWrapColumn", the lines will wrap at `wordWrapColumn`.
	 * When `wordWrap` = "bounded", the lines will wrap at min(viewport width, wordWrapColumn).
	 * Defaults to "off".
	 */
	wordWrap?: 'off' | 'on' | 'wordWrapColumn' | 'bounded';
	/**
	 * Override the `wordWrap` setting.
	 */
	wordWrapOverride1?: 'off' | 'on' | 'inherit';
	/**
	 * Override the `wordWrapOverride1` setting.
	 */
	wordWrapOverride2?: 'off' | 'on' | 'inherit';
	/**
	 * Control the wrapping of the editor.
	 * When `wordWrap` = "off", the lines will never wrap.
	 * When `wordWrap` = "on", the lines will wrap at the viewport width.
	 * When `wordWrap` = "wordWrapColumn", the lines will wrap at `wordWrapColumn`.
	 * When `wordWrap` = "bounded", the lines will wrap at min(viewport width, wordWrapColumn).
	 * Defaults to 80.
	 */
	wordWrapColumn?: number;
	/**
	 * Control indentation of wrapped lines. Can be: 'none', 'same', 'indent' or 'deepIndent'.
	 * Defaults to 'same' in vscode and to 'none' in monaco-editor.
	 */
	wrappingIndent?: 'none' | 'same' | 'indent' | 'deepIndent';
	/**
	 * Controls the wrapping strategy to use.
	 * Defaults to 'simple'.
	 */
	wrappingStrategy?: 'simple' | 'advanced';
	/**
	 * Configure word wrapping characters. A break will be introduced before these characters.
	 * Defaults to '([{‘“〈《「『【〔（［｛｢£¥＄￡￥+＋'.
	 */
	wordWrapBreakBeforeCharacters?: string;
	/**
	 * Configure word wrapping characters. A break will be introduced after these characters.
	 * Defaults to ' \t})]?|/&.,;¢°′″‰℃、。｡､￠，．：；？！％・･ゝゞヽヾーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻ｧｨｩｪｫｬｭｮｯｰ”〉》」』】〕）］｝｣'.
	 */
	wordWrapBreakAfterCharacters?: string;
	/**
	 * Performance guard: Stop rendering a line after x characters.
	 * Defaults to 10000.
	 * Use -1 to never stop rendering
	 */
	stopRenderingLineAfter?: number;
	/**
	 * Configure the editor's hover.
	 */
	hover?: IEditorHoverOptions;
	/**
	 * Enable detecting links and making them clickable.
	 * Defaults to true.
	 */
	links?: boolean;
	/**
	 * Enable inline color decorators and color picker rendering.
	 */
	colorDecorators?: boolean;
	/**
	 * Control the behaviour of comments in the editor.
	 */
	comments?: IEditorCommentsOptions;
	/**
	 * Enable custom contextmenu.
	 * Defaults to true.
	 */
	contextmenu?: boolean;
	/**
	 * A multiplier to be used on the `deltaX` and `deltaY` of mouse wheel scroll events.
	 * Defaults to 1.
	 */
	mouseWheelScrollSensitivity?: number;
	/**
	 * FastScrolling mulitplier speed when pressing `Alt`
	 * Defaults to 5.
	 */
	fastScrollSensitivity?: number;
	/**
	 * Enable that the editor scrolls only the predominant axis. Prevents horizontal drift when scrolling vertically on a trackpad.
	 * Defaults to true.
	 */
	scrollPredominantAxis?: boolean;
	/**
	 * Enable that the selection with the mouse and keys is doing column selection.
	 * Defaults to false.
	 */
	columnSelection?: boolean;
	/**
	 * The modifier to be used to add multiple cursors with the mouse.
	 * Defaults to 'alt'
	 */
	multiCursorModifier?: 'ctrlCmd' | 'alt';
	/**
	 * Merge overlapping selections.
	 * Defaults to true
	 */
	multiCursorMergeOverlapping?: boolean;
	/**
	 * Configure the behaviour when pasting a text with the line count equal to the cursor count.
	 * Defaults to 'spread'.
	 */
	multiCursorPaste?: 'spread' | 'full';
	/**
	 * Configure the editor's accessibility support.
	 * Defaults to 'auto'. It is best to leave this to 'auto'.
	 */
	accessibilitySupport?: 'auto' | 'off' | 'on';
	/**
	 * Controls the number of lines in the editor that can be read out by a screen reader
	 */
	accessibilityPageSize?: number;
	/**
	 * Suggest options.
	 */
	suggest?: ISuggestOptions;
	inlineSuggest?: IInlineSuggestOptions;
	/**
	 * Smart select options.
	 */
	smartSelect?: ISmartSelectOptions;
	/**
	 *
	 */
	gotoLocation?: IGotoLocationOptions;
	/**
	 * Enable quick suggestions (shadow suggestions)
	 * Defaults to true.
	 */
	quickSuggestions?: boolean | IQuickSuggestionsOptions;
	/**
	 * Quick suggestions show delay (in ms)
	 * Defaults to 10 (ms)
	 */
	quickSuggestionsDelay?: number;
	/**
	 * Controls the spacing around the editor.
	 */
	padding?: IEditorPaddingOptions;
	/**
	 * Parameter hint options.
	 */
	parameterHints?: IEditorParameterHintOptions;
	/**
	 * Options for auto closing brackets.
	 * Defaults to language defined behavior.
	 */
	autoClosingBrackets?: EditorAutoClosingStrategy;
	/**
	 * Options for auto closing quotes.
	 * Defaults to language defined behavior.
	 */
	autoClosingQuotes?: EditorAutoClosingStrategy;
	/**
	 * Options for pressing backspace near quotes or bracket pairs.
	 */
	autoClosingDelete?: EditorAutoClosingEditStrategy;
	/**
	 * Options for typing over closing quotes or brackets.
	 */
	autoClosingOvertype?: EditorAutoClosingEditStrategy;
	/**
	 * Options for auto surrounding.
	 * Defaults to always allowing auto surrounding.
	 */
	autoSurround?: EditorAutoSurroundStrategy;
	/**
	 * Controls whether the editor should automatically adjust the indentation when users type, paste, move or indent lines.
	 * Defaults to advanced.
	 */
	autoIndent?: 'none' | 'keep' | 'brackets' | 'advanced' | 'full';
	/**
	 * Emulate selection behaviour of tab characters when using spaces for indentation.
	 * This means selection will stick to tab stops.
	 */
	stickyTabStops?: boolean;
	/**
	 * Enable format on type.
	 * Defaults to false.
	 */
	formatOnType?: boolean;
	/**
	 * Enable format on paste.
	 * Defaults to false.
	 */
	formatOnPaste?: boolean;
	/**
	 * Controls if the editor should allow to move selections via drag and drop.
	 * Defaults to false.
	 */
	dragAndDrop?: boolean;
	/**
	 * Enable the suggestion box to pop-up on trigger characters.
	 * Defaults to true.
	 */
	suggestOnTriggerCharacters?: boolean;
	/**
	 * Accept suggestions on ENTER.
	 * Defaults to 'on'.
	 */
	acceptSuggestionOnEnter?: 'on' | 'smart' | 'off';
	/**
	 * Accept suggestions on provider defined characters.
	 * Defaults to true.
	 */
	acceptSuggestionOnCommitCharacter?: boolean;
	/**
	 * Enable snippet suggestions. Default to 'true'.
	 */
	snippetSuggestions?: 'top' | 'bottom' | 'inline' | 'none';
	/**
	 * Copying without a selection copies the current line.
	 */
	emptySelectionClipboard?: boolean;
	/**
	 * Syntax highlighting is copied.
	 */
	copyWithSyntaxHighlighting?: boolean;
	/**
	 * The history mode for suggestions.
	 */
	suggestSelection?: 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix';
	/**
	 * The font size for the suggest widget.
	 * Defaults to the editor font size.
	 */
	suggestFontSize?: number;
	/**
	 * The line height for the suggest widget.
	 * Defaults to the editor line height.
	 */
	suggestLineHeight?: number;
	/**
	 * Enable tab completion.
	 */
	tabCompletion?: 'on' | 'off' | 'onlySnippets';
	/**
	 * Enable selection highlight.
	 * Defaults to true.
	 */
	selectionHighlight?: boolean;
	/**
	 * Enable semantic occurrences highlight.
	 * Defaults to true.
	 */
	occurrencesHighlight?: boolean;
	/**
	 * Show code lens
	 * Defaults to true.
	 */
	codeLens?: boolean;
	/**
	 * Code lens font family. Defaults to editor font family.
	 */
	codeLensFontFamily?: string;
	/**
	 * Code lens font size. Default to 90% of the editor font size
	 */
	codeLensFontSize?: number;
	/**
	 * Control the behavior and rendering of the code action lightbulb.
	 */
	lightbulb?: IEditorLightbulbOptions;
	/**
	 * Timeout for running code actions on save.
	 */
	codeActionsOnSaveTimeout?: number;
	/**
	 * Enable code folding.
	 * Defaults to true.
	 */
	folding?: boolean;
	/**
	 * Selects the folding strategy. 'auto' uses the strategies contributed for the current document, 'indentation' uses the indentation based folding strategy.
	 * Defaults to 'auto'.
	 */
	foldingStrategy?: 'auto' | 'indentation';
	/**
	 * Enable highlight for folded regions.
	 * Defaults to true.
	 */
	foldingHighlight?: boolean;
	/**
	 * Controls whether the fold actions in the gutter stay always visible or hide unless the mouse is over the gutter.
	 * Defaults to 'mouseover'.
	 */
	showFoldingControls?: 'always' | 'mouseover';
	/**
	 * Controls whether clicking on the empty content after a folded line will unfold the line.
	 * Defaults to false.
	 */
	unfoldOnClickAfterEndOfLine?: boolean;
	/**
	 * Enable highlighting of matching brackets.
	 * Defaults to 'always'.
	 */
	matchBrackets?: 'never' | 'near' | 'always';
	/**
	 * Enable rendering of whitespace.
	 * Defaults to 'selection'.
	 */
	renderWhitespace?: 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
	/**
	 * Enable rendering of control characters.
	 * Defaults to false.
	 */
	renderControlCharacters?: boolean;
	/**
	 * Enable rendering of indent guides.
	 * Defaults to true.
	 */
	renderIndentGuides?: boolean;
	/**
	 * Enable highlighting of the active indent guide.
	 * Defaults to true.
	 */
	highlightActiveIndentGuide?: boolean;
	/**
	 * Enable rendering of current line highlight.
	 * Defaults to all.
	 */
	renderLineHighlight?: 'none' | 'gutter' | 'line' | 'all';
	/**
	 * Control if the current line highlight should be rendered only the editor is focused.
	 * Defaults to false.
	 */
	renderLineHighlightOnlyWhenFocus?: boolean;
	/**
	 * Inserting and deleting whitespace follows tab stops.
	 */
	useTabStops?: boolean;
	/**
	 * The font family
	 */
	fontFamily?: string;
	/**
	 * The font weight
	 */
	fontWeight?: string;
	/**
	 * The font size
	 */
	fontSize?: number;
	/**
	 * The line height
	 */
	lineHeight?: number;
	/**
	 * The letter spacing
	 */
	letterSpacing?: number;
	/**
	 * Controls fading out of unused variables.
	 */
	showUnused?: boolean;
	/**
	 * Controls whether to focus the inline editor in the peek widget by default.
	 * Defaults to false.
	 */
	peekWidgetDefaultFocus?: 'tree' | 'editor';
	/**
	 * Controls whether the definition link opens element in the peek widget.
	 * Defaults to false.
	 */
	definitionLinkOpensInPeek?: boolean;
	/**
	 * Controls strikethrough deprecated variables.
	 */
	showDeprecated?: boolean;
	/**
	 * Control the behavior and rendering of the inline hints.
	 */
	inlayHints?: IEditorInlayHintsOptions;
	/**
	 * Control if the editor should use shadow DOM.
	 */
	useShadowDOM?: boolean;
}

/**
 * @internal
 * The width of the minimap gutter, in pixels.
 */
export const MINIMAP_GUTTER_WIDTH = 8;

/**
 * Configuration options for the diff editor.
 */
export interface IDiffEditorOptions extends IEditorOptions {
	/**
	 * Allow the user to resize the diff editor split view.
	 * Defaults to true.
	 */
	enableSplitViewResizing?: boolean;
	/**
	 * Render the differences in two side-by-side editors.
	 * Defaults to true.
	 */
	renderSideBySide?: boolean;
	/**
	 * Timeout in milliseconds after which diff computation is cancelled.
	 * Defaults to 5000.
	 */
	maxComputationTime?: number;
	/**
	 * Compute the diff by ignoring leading/trailing whitespace
	 * Defaults to true.
	 */
	ignoreTrimWhitespace?: boolean;
	/**
	 * Render +/- indicators for added/deleted changes.
	 * Defaults to true.
	 */
	renderIndicators?: boolean;
	/**
	 * Original model should be editable?
	 * Defaults to false.
	 */
	originalEditable?: boolean;
	/**
	 * Should the diff editor enable code lens?
	 * Defaults to false.
	 */
	diffCodeLens?: boolean;
	/**
	 * Is the diff editor inside another editor
	 * Defaults to false
	 */
	isInEmbeddedEditor?: boolean;
	/**
	 * Is the diff editor should render overview ruler
	 * Defaults to true
	 */
	renderOverviewRuler?: boolean;
	/**
	 * Control the wrapping of the diff editor.
	 */
	diffWordWrap?: 'off' | 'on' | 'inherit';
	/**
	 * Aria label for original editor.
	 */
	originalAriaLabel?: string;
	/**
	 * Aria label for modifed editor.
	 */
	modifiedAriaLabel?: string;
}

//#endregion

/**
 * An event describing that the configuration of the editor has changed.
 */
export class ConfigurationChangedEvent {
	private readonly _values: boolean[];
	/**
	 * @internal
	 */
	constructor(values: boolean[]) {
		this._values = values;
	}
	public hasChanged(id: EditorOption): boolean {
		return this._values[id];
	}
}

/**
 * @internal
 */
export class ValidatedEditorOptions {
	private readonly _values: any[] = [];
	public _read<T>(option: EditorOption): T {
		return this._values[option];
	}
	public get<T extends EditorOption>(id: T): FindComputedEditorOptionValueById<T> {
		return this._values[id];
	}
	public _write<T>(option: EditorOption, value: T): void {
		this._values[option] = value;
	}
}

/**
 * All computed editor options.
 */
export interface IComputedEditorOptions {
	get<T extends EditorOption>(id: T): FindComputedEditorOptionValueById<T>;
}

//#region IEditorOption

/**
 * @internal
 */
export interface IEnvironmentalOptions {
	readonly memory: ComputeOptionsMemory | null;
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly fontInfo: FontInfo;
	readonly extraEditorClassName: string;
	readonly isDominatedByLongLines: boolean;
	readonly viewLineCount: number;
	readonly lineNumbersDigitCount: number;
	readonly emptySelectionClipboard: boolean;
	readonly pixelRatio: number;
	readonly tabFocusMode: boolean;
	readonly accessibilitySupport: AccessibilitySupport;
}

/**
 * @internal
 */
export class ComputeOptionsMemory {

	public stableMinimapLayoutInput: IMinimapLayoutInput | null;
	public stableFitMaxMinimapScale: number;
	public stableFitRemainingWidth: number;

	constructor() {
		this.stableMinimapLayoutInput = null;
		this.stableFitMaxMinimapScale = 0;
		this.stableFitRemainingWidth = 0;
	}
}

export interface IEditorOption<K1 extends EditorOption, V> {
	readonly id: K1;
	readonly name: string;
	defaultValue: V;
	/**
	 * @internal
	 */
	readonly schema: IConfigurationPropertySchema | { [path: string]: IConfigurationPropertySchema; } | undefined;
	/**
	 * @internal
	 */
	validate(input: any): V;
	/**
	 * @internal
	 */
	compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: V): V;
}

type PossibleKeyName0<V> = { [K in keyof IEditorOptions]: IEditorOptions[K] extends V | undefined ? K : never }[keyof IEditorOptions];
type PossibleKeyName<V> = NonNullable<PossibleKeyName0<V>>;

/**
 * @internal
 */
abstract class BaseEditorOption<K1 extends EditorOption, V> implements IEditorOption<K1, V> {

	public readonly id: K1;
	public readonly name: string;
	public readonly defaultValue: V;
	public readonly schema: IConfigurationPropertySchema | { [path: string]: IConfigurationPropertySchema; } | undefined;

	constructor(id: K1, name: string, defaultValue: V, schema?: IConfigurationPropertySchema | { [path: string]: IConfigurationPropertySchema; }) {
		this.id = id;
		this.name = name;
		this.defaultValue = defaultValue;
		this.schema = schema;
	}

	public abstract validate(input: any): V;

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: V): V {
		return value;
	}
}

/**
 * @internal
 */
abstract class ComputedEditorOption<K1 extends EditorOption, V> implements IEditorOption<K1, V> {

	public readonly id: K1;
	public readonly name: '_never_';
	public readonly defaultValue: V;
	public readonly deps: EditorOption[] | null;
	public readonly schema: IConfigurationPropertySchema | undefined = undefined;

	constructor(id: K1, deps: EditorOption[] | null = null) {
		this.id = id;
		this.name = '_never_';
		this.defaultValue = <any>undefined;
		this.deps = deps;
	}

	public validate(input: any): V {
		return this.defaultValue;
	}

	public abstract compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: V): V;
}

class SimpleEditorOption<K1 extends EditorOption, V> implements IEditorOption<K1, V> {

	public readonly id: K1;
	public readonly name: PossibleKeyName<V>;
	public readonly defaultValue: V;
	public readonly schema: IConfigurationPropertySchema | undefined;

	constructor(id: K1, name: PossibleKeyName<V>, defaultValue: V, schema?: IConfigurationPropertySchema) {
		this.id = id;
		this.name = name;
		this.defaultValue = defaultValue;
		this.schema = schema;
	}

	public validate(input: any): V {
		if (typeof input === 'undefined') {
			return this.defaultValue;
		}
		return input as any;
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: V): V {
		return value;
	}
}

/**
 * @internal
 */
export function boolean(value: any, defaultValue: boolean): boolean {
	if (typeof value === 'undefined') {
		return defaultValue;
	}
	if (value === 'false') {
		// treat the string 'false' as false
		return false;
	}
	return Boolean(value);
}

class EditorBooleanOption<K1 extends EditorOption> extends SimpleEditorOption<K1, boolean> {

	constructor(id: K1, name: PossibleKeyName<boolean>, defaultValue: boolean, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'boolean';
			schema.default = defaultValue;
		}
		super(id, name, defaultValue, schema);
	}

	public override validate(input: any): boolean {
		return boolean(input, this.defaultValue);
	}
}

class EditorIntOption<K1 extends EditorOption> extends SimpleEditorOption<K1, number> {

	public static clampedInt<T>(value: any, defaultValue: T, minimum: number, maximum: number): number | T {
		if (typeof value === 'undefined') {
			return defaultValue;
		}
		let r = parseInt(value, 10);
		if (isNaN(r)) {
			return defaultValue;
		}
		r = Math.max(minimum, r);
		r = Math.min(maximum, r);
		return r | 0;
	}

	public readonly minimum: number;
	public readonly maximum: number;

	constructor(id: K1, name: PossibleKeyName<number>, defaultValue: number, minimum: number, maximum: number, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'integer';
			schema.default = defaultValue;
			schema.minimum = minimum;
			schema.maximum = maximum;
		}
		super(id, name, defaultValue, schema);
		this.minimum = minimum;
		this.maximum = maximum;
	}

	public override validate(input: any): number {
		return EditorIntOption.clampedInt(input, this.defaultValue, this.minimum, this.maximum);
	}
}

class EditorFloatOption<K1 extends EditorOption> extends SimpleEditorOption<K1, number> {

	public static clamp(n: number, min: number, max: number): number {
		if (n < min) {
			return min;
		}
		if (n > max) {
			return max;
		}
		return n;
	}

	public static float(value: any, defaultValue: number): number {
		if (typeof value === 'number') {
			return value;
		}
		if (typeof value === 'undefined') {
			return defaultValue;
		}
		const r = parseFloat(value);
		return (isNaN(r) ? defaultValue : r);
	}

	public readonly validationFn: (value: number) => number;

	constructor(id: K1, name: PossibleKeyName<number>, defaultValue: number, validationFn: (value: number) => number, schema?: IConfigurationPropertySchema) {
		if (typeof schema !== 'undefined') {
			schema.type = 'number';
			schema.default = defaultValue;
		}
		super(id, name, defaultValue, schema);
		this.validationFn = validationFn;
	}

	public override validate(input: any): number {
		return this.validationFn(EditorFloatOption.float(input, this.defaultValue));
	}
}

class EditorStringOption<K1 extends EditorOption> extends SimpleEditorOption<K1, string> {

	public static string(value: any, defaultValue: string): string {
		if (typeof value !== 'string') {
			return defaultValue;
		}
		return value;
	}

	constructor(id: K1, name: PossibleKeyName<string>, defaultValue: string, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'string';
			schema.default = defaultValue;
		}
		super(id, name, defaultValue, schema);
	}

	public override validate(input: any): string {
		return EditorStringOption.string(input, this.defaultValue);
	}
}

/**
 * @internal
 */
export function stringSet<T>(value: T | undefined, defaultValue: T, allowedValues: ReadonlyArray<T>): T {
	if (typeof value !== 'string') {
		return defaultValue;
	}
	if (allowedValues.indexOf(value) === -1) {
		return defaultValue;
	}
	return value;
}

class EditorStringEnumOption<K1 extends EditorOption, V extends string> extends SimpleEditorOption<K1, V> {

	private readonly _allowedValues: ReadonlyArray<V>;

	constructor(id: K1, name: PossibleKeyName<V>, defaultValue: V, allowedValues: ReadonlyArray<V>, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'string';
			schema.enum = <any>allowedValues;
			schema.default = defaultValue;
		}
		super(id, name, defaultValue, schema);
		this._allowedValues = allowedValues;
	}

	public override validate(input: any): V {
		return stringSet<V>(input, this.defaultValue, this._allowedValues);
	}
}

class EditorEnumOption<K1 extends EditorOption, T extends string, V> extends BaseEditorOption<K1, V> {

	private readonly _allowedValues: T[];
	private readonly _convert: (value: T) => V;

	constructor(id: K1, name: PossibleKeyName<T>, defaultValue: V, defaultStringValue: string, allowedValues: T[], convert: (value: T) => V, schema: IConfigurationPropertySchema | undefined = undefined) {
		if (typeof schema !== 'undefined') {
			schema.type = 'string';
			schema.enum = allowedValues;
			schema.default = defaultStringValue;
		}
		super(id, name, defaultValue, schema);
		this._allowedValues = allowedValues;
		this._convert = convert;
	}

	public validate(input: any): V {
		if (typeof input !== 'string') {
			return this.defaultValue;
		}
		if (this._allowedValues.indexOf(<T>input) === -1) {
			return this.defaultValue;
		}
		return this._convert(<any>input);
	}
}

//#endregion

//#region autoIndent

function _autoIndentFromString(autoIndent: 'none' | 'keep' | 'brackets' | 'advanced' | 'full'): EditorAutoIndentStrategy {
	switch (autoIndent) {
		case 'none': return EditorAutoIndentStrategy.None;
		case 'keep': return EditorAutoIndentStrategy.Keep;
		case 'brackets': return EditorAutoIndentStrategy.Brackets;
		case 'advanced': return EditorAutoIndentStrategy.Advanced;
		case 'full': return EditorAutoIndentStrategy.Full;
	}
}

//#endregion

//#region accessibilitySupport

class EditorAccessibilitySupport extends BaseEditorOption<EditorOption.accessibilitySupport, AccessibilitySupport> {

	constructor() {
		super(
			EditorOption.accessibilitySupport, 'accessibilitySupport', AccessibilitySupport.Unknown,
			{
				type: 'string',
				enum: ['auto', 'on', 'off'],
				enumDescriptions: [
					nls.localize('accessibilitySupport.auto', "The editor will use platform APIs to detect when a Screen Reader is attached."),
					nls.localize('accessibilitySupport.on', "The editor will be permanently optimized for usage with a Screen Reader. Word wrapping will be disabled."),
					nls.localize('accessibilitySupport.off', "The editor will never be optimized for usage with a Screen Reader."),
				],
				default: 'auto',
				description: nls.localize('accessibilitySupport', "Controls whether the editor should run in a mode where it is optimized for screen readers. Setting to on will disable word wrapping.")
			}
		);
	}

	public validate(input: any): AccessibilitySupport {
		switch (input) {
			case 'auto': return AccessibilitySupport.Unknown;
			case 'off': return AccessibilitySupport.Disabled;
			case 'on': return AccessibilitySupport.Enabled;
		}
		return this.defaultValue;
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: AccessibilitySupport): AccessibilitySupport {
		if (value === AccessibilitySupport.Unknown) {
			// The editor reads the `accessibilitySupport` from the environment
			return env.accessibilitySupport;
		}
		return value;
	}
}

//#endregion

//#region comments

/**
 * Configuration options for editor comments
 */
export interface IEditorCommentsOptions {
	/**
	 * Insert a space after the line comment token and inside the block comments tokens.
	 * Defaults to true.
	 */
	insertSpace?: boolean;
	/**
	 * Ignore empty lines when inserting line comments.
	 * Defaults to true.
	 */
	ignoreEmptyLines?: boolean;
}

export type EditorCommentsOptions = Readonly<Required<IEditorCommentsOptions>>;

class EditorComments extends BaseEditorOption<EditorOption.comments, EditorCommentsOptions> {

	constructor() {
		const defaults: EditorCommentsOptions = {
			insertSpace: true,
			ignoreEmptyLines: true,
		};
		super(
			EditorOption.comments, 'comments', defaults,
			{
				'editor.comments.insertSpace': {
					type: 'boolean',
					default: defaults.insertSpace,
					description: nls.localize('comments.insertSpace', "Controls whether a space character is inserted when commenting.")
				},
				'editor.comments.ignoreEmptyLines': {
					type: 'boolean',
					default: defaults.ignoreEmptyLines,
					description: nls.localize('comments.ignoreEmptyLines', 'Controls if empty lines should be ignored with toggle, add or remove actions for line comments.')
				},
			}
		);
	}

	public validate(_input: any): EditorCommentsOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IEditorCommentsOptions;
		return {
			insertSpace: boolean(input.insertSpace, this.defaultValue.insertSpace),
			ignoreEmptyLines: boolean(input.ignoreEmptyLines, this.defaultValue.ignoreEmptyLines),
		};
	}
}

//#endregion

//#region cursorBlinking

/**
 * The kind of animation in which the editor's cursor should be rendered.
 */
export const enum TextEditorCursorBlinkingStyle {
	/**
	 * Hidden
	 */
	Hidden = 0,
	/**
	 * Blinking
	 */
	Blink = 1,
	/**
	 * Blinking with smooth fading
	 */
	Smooth = 2,
	/**
	 * Blinking with prolonged filled state and smooth fading
	 */
	Phase = 3,
	/**
	 * Expand collapse animation on the y axis
	 */
	Expand = 4,
	/**
	 * No-Blinking
	 */
	Solid = 5
}

function _cursorBlinkingStyleFromString(cursorBlinkingStyle: 'blink' | 'smooth' | 'phase' | 'expand' | 'solid'): TextEditorCursorBlinkingStyle {
	switch (cursorBlinkingStyle) {
		case 'blink': return TextEditorCursorBlinkingStyle.Blink;
		case 'smooth': return TextEditorCursorBlinkingStyle.Smooth;
		case 'phase': return TextEditorCursorBlinkingStyle.Phase;
		case 'expand': return TextEditorCursorBlinkingStyle.Expand;
		case 'solid': return TextEditorCursorBlinkingStyle.Solid;
	}
}

//#endregion

//#region cursorStyle

/**
 * The style in which the editor's cursor should be rendered.
 */
export enum TextEditorCursorStyle {
	/**
	 * As a vertical line (sitting between two characters).
	 */
	Line = 1,
	/**
	 * As a block (sitting on top of a character).
	 */
	Block = 2,
	/**
	 * As a horizontal line (sitting under a character).
	 */
	Underline = 3,
	/**
	 * As a thin vertical line (sitting between two characters).
	 */
	LineThin = 4,
	/**
	 * As an outlined block (sitting on top of a character).
	 */
	BlockOutline = 5,
	/**
	 * As a thin horizontal line (sitting under a character).
	 */
	UnderlineThin = 6
}

/**
 * @internal
 */
export function cursorStyleToString(cursorStyle: TextEditorCursorStyle): 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin' {
	switch (cursorStyle) {
		case TextEditorCursorStyle.Line: return 'line';
		case TextEditorCursorStyle.Block: return 'block';
		case TextEditorCursorStyle.Underline: return 'underline';
		case TextEditorCursorStyle.LineThin: return 'line-thin';
		case TextEditorCursorStyle.BlockOutline: return 'block-outline';
		case TextEditorCursorStyle.UnderlineThin: return 'underline-thin';
	}
}

function _cursorStyleFromString(cursorStyle: 'line' | 'block' | 'underline' | 'line-thin' | 'block-outline' | 'underline-thin'): TextEditorCursorStyle {
	switch (cursorStyle) {
		case 'line': return TextEditorCursorStyle.Line;
		case 'block': return TextEditorCursorStyle.Block;
		case 'underline': return TextEditorCursorStyle.Underline;
		case 'line-thin': return TextEditorCursorStyle.LineThin;
		case 'block-outline': return TextEditorCursorStyle.BlockOutline;
		case 'underline-thin': return TextEditorCursorStyle.UnderlineThin;
	}
}

//#endregion

//#region editorClassName

class EditorClassName extends ComputedEditorOption<EditorOption.editorClassName, string> {

	constructor() {
		super(EditorOption.editorClassName, [EditorOption.mouseStyle, EditorOption.extraEditorClassName]);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: string): string {
		const classNames = ['monaco-editor'];
		if (options.get(EditorOption.extraEditorClassName)) {
			classNames.push(options.get(EditorOption.extraEditorClassName));
		}
		if (env.extraEditorClassName) {
			classNames.push(env.extraEditorClassName);
		}
		if (options.get(EditorOption.mouseStyle) === 'default') {
			classNames.push('mouse-default');
		} else if (options.get(EditorOption.mouseStyle) === 'copy') {
			classNames.push('mouse-copy');
		}

		if (options.get(EditorOption.showUnused)) {
			classNames.push('showUnused');
		}

		if (options.get(EditorOption.showDeprecated)) {
			classNames.push('showDeprecated');
		}

		return classNames.join(' ');
	}
}

//#endregion

//#region emptySelectionClipboard

class EditorEmptySelectionClipboard extends EditorBooleanOption<EditorOption.emptySelectionClipboard> {

	constructor() {
		super(
			EditorOption.emptySelectionClipboard, 'emptySelectionClipboard', true,
			{ description: nls.localize('emptySelectionClipboard', "Controls whether copying without a selection copies the current line.") }
		);
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: boolean): boolean {
		return value && env.emptySelectionClipboard;
	}
}

//#endregion

//#region find

/**
 * Configuration options for editor find widget
 */
export interface IEditorFindOptions {
	/**
	* Controls whether the cursor should move to find matches while typing.
	*/
	cursorMoveOnType?: boolean;
	/**
	 * Controls if we seed search string in the Find Widget with editor selection.
	 */
	seedSearchStringFromSelection?: boolean;
	/**
	 * Controls if we seed search string in the Find Widget with editor cursor position.
	 */
	seedSearchStringFromCursor?: boolean;
	/**
	 * Controls if Find in Selection flag is turned on in the editor.
	 */
	autoFindInSelection?: 'never' | 'always' | 'multiline';
	/*
	 * Controls whether the Find Widget should add extra lines on top of the editor.
	 */
	addExtraSpaceOnTop?: boolean;
	/**
	 * @internal
	 * Controls if the Find Widget should read or modify the shared find clipboard on macOS
	 */
	globalFindClipboard?: boolean;
	/**
	 * Controls whether the search automatically restarts from the beginning (or the end) when no further matches can be found
	 */
	loop?: boolean;
}

export type EditorFindOptions = Readonly<Required<IEditorFindOptions>>;

class EditorFind extends BaseEditorOption<EditorOption.find, EditorFindOptions> {

	constructor() {
		const defaults: EditorFindOptions = {
			cursorMoveOnType: true,
			seedSearchStringFromSelection: true,
			seedSearchStringFromCursor: true,
			autoFindInSelection: 'never',
			globalFindClipboard: false,
			addExtraSpaceOnTop: true,
			loop: true
		};
		super(
			EditorOption.find, 'find', defaults,
			{
				'editor.find.cursorMoveOnType': {
					type: 'boolean',
					default: defaults.cursorMoveOnType,
					description: nls.localize('find.cursorMoveOnType', "Controls whether the cursor should jump to find matches while typing.")
				},
				'editor.find.seedSearchStringFromSelection': {
					type: 'boolean',
					default: defaults.seedSearchStringFromSelection,
					description: nls.localize('find.seedSearchStringFromSelection', "Controls whether the search string in the Find Widget is seeded from the editor selection.")
				},
				'editor.find.seedSearchStringFromCursor': {
					type: 'boolean',
					default: defaults.seedSearchStringFromCursor,
					description: nls.localize('find.seedSearchStringFromCursor', "Controls whether the search string in the Find Widget is seeded from the editor cursor.")
				},
				'editor.find.autoFindInSelection': {
					type: 'string',
					enum: ['never', 'always', 'multiline'],
					default: defaults.autoFindInSelection,
					enumDescriptions: [
						nls.localize('editor.find.autoFindInSelection.never', 'Never turn on Find in selection automatically (default).'),
						nls.localize('editor.find.autoFindInSelection.always', 'Always turn on Find in selection automatically.'),
						nls.localize('editor.find.autoFindInSelection.multiline', 'Turn on Find in selection automatically when multiple lines of content are selected.')
					],
					description: nls.localize('find.autoFindInSelection', "Controls the condition for turning on find in selection automatically.")
				},
				'editor.find.globalFindClipboard': {
					type: 'boolean',
					default: defaults.globalFindClipboard,
					description: nls.localize('find.globalFindClipboard', "Controls whether the Find Widget should read or modify the shared find clipboard on macOS."),
					included: platform.isMacintosh
				},
				'editor.find.addExtraSpaceOnTop': {
					type: 'boolean',
					default: defaults.addExtraSpaceOnTop,
					description: nls.localize('find.addExtraSpaceOnTop', "Controls whether the Find Widget should add extra lines on top of the editor. When true, you can scroll beyond the first line when the Find Widget is visible.")
				},
				'editor.find.loop': {
					type: 'boolean',
					default: defaults.loop,
					description: nls.localize('find.loop', "Controls whether the search automatically restarts from the beginning (or the end) when no further matches can be found.")
				},

			}
		);
	}

	public validate(_input: any): EditorFindOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IEditorFindOptions;
		return {
			cursorMoveOnType: boolean(input.cursorMoveOnType, this.defaultValue.cursorMoveOnType),
			seedSearchStringFromSelection: boolean(input.seedSearchStringFromSelection, this.defaultValue.seedSearchStringFromSelection),
			seedSearchStringFromCursor: boolean(input.seedSearchStringFromCursor, this.defaultValue.seedSearchStringFromCursor),
			autoFindInSelection: typeof _input.autoFindInSelection === 'boolean'
				? (_input.autoFindInSelection ? 'always' : 'never')
				: stringSet<'never' | 'always' | 'multiline'>(input.autoFindInSelection, this.defaultValue.autoFindInSelection, ['never', 'always', 'multiline']),
			globalFindClipboard: boolean(input.globalFindClipboard, this.defaultValue.globalFindClipboard),
			addExtraSpaceOnTop: boolean(input.addExtraSpaceOnTop, this.defaultValue.addExtraSpaceOnTop),
			loop: boolean(input.loop, this.defaultValue.loop),
		};
	}
}

//#endregion

//#region fontLigatures

/**
 * @internal
 */
export class EditorFontLigatures extends BaseEditorOption<EditorOption.fontLigatures, string> {

	public static OFF = '"liga" off, "calt" off';
	public static ON = '"liga" on, "calt" on';

	constructor() {
		super(
			EditorOption.fontLigatures, 'fontLigatures', EditorFontLigatures.OFF,
			{
				anyOf: [
					{
						type: 'boolean',
						description: nls.localize('fontLigatures', "Enables/Disables font ligatures ('calt' and 'liga' font features). Change this to a string for fine-grained control of the 'font-feature-settings' CSS property."),
					},
					{
						type: 'string',
						description: nls.localize('fontFeatureSettings', "Explicit 'font-feature-settings' CSS property. A boolean can be passed instead if one only needs to turn on/off ligatures.")
					}
				],
				description: nls.localize('fontLigaturesGeneral', "Configures font ligatures or font features. Can be either a boolean to enable/disable ligatures or a string for the value of the CSS 'font-feature-settings' property."),
				default: false
			}
		);
	}

	public validate(input: any): string {
		if (typeof input === 'undefined') {
			return this.defaultValue;
		}
		if (typeof input === 'string') {
			if (input === 'false') {
				return EditorFontLigatures.OFF;
			}
			if (input === 'true') {
				return EditorFontLigatures.ON;
			}
			return input;
		}
		if (Boolean(input)) {
			return EditorFontLigatures.ON;
		}
		return EditorFontLigatures.OFF;
	}
}

//#endregion

//#region fontInfo

class EditorFontInfo extends ComputedEditorOption<EditorOption.fontInfo, FontInfo> {

	constructor() {
		super(EditorOption.fontInfo);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: FontInfo): FontInfo {
		return env.fontInfo;
	}
}

//#endregion

//#region fontSize

class EditorFontSize extends SimpleEditorOption<EditorOption.fontSize, number> {

	constructor() {
		super(
			EditorOption.fontSize, 'fontSize', EDITOR_FONT_DEFAULTS.fontSize,
			{
				type: 'number',
				minimum: 6,
				maximum: 100,
				default: EDITOR_FONT_DEFAULTS.fontSize,
				description: nls.localize('fontSize', "Controls the font size in pixels.")
			}
		);
	}

	public override validate(input: any): number {
		let r = EditorFloatOption.float(input, this.defaultValue);
		if (r === 0) {
			return EDITOR_FONT_DEFAULTS.fontSize;
		}
		return EditorFloatOption.clamp(r, 6, 100);
	}
	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: number): number {
		// The final fontSize respects the editor zoom level.
		// So take the result from env.fontInfo
		return env.fontInfo.fontSize;
	}
}

//#endregion

//#region fontWeight

class EditorFontWeight extends BaseEditorOption<EditorOption.fontWeight, string> {
	private static SUGGESTION_VALUES = ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'];
	private static MINIMUM_VALUE = 1;
	private static MAXIMUM_VALUE = 1000;

	constructor() {
		super(
			EditorOption.fontWeight, 'fontWeight', EDITOR_FONT_DEFAULTS.fontWeight,
			{
				anyOf: [
					{
						type: 'number',
						minimum: EditorFontWeight.MINIMUM_VALUE,
						maximum: EditorFontWeight.MAXIMUM_VALUE,
						errorMessage: nls.localize('fontWeightErrorMessage', "Only \"normal\" and \"bold\" keywords or numbers between 1 and 1000 are allowed.")
					},
					{
						type: 'string',
						pattern: '^(normal|bold|1000|[1-9][0-9]{0,2})$'
					},
					{
						enum: EditorFontWeight.SUGGESTION_VALUES
					}
				],
				default: EDITOR_FONT_DEFAULTS.fontWeight,
				description: nls.localize('fontWeight', "Controls the font weight. Accepts \"normal\" and \"bold\" keywords or numbers between 1 and 1000.")
			}
		);
	}

	public validate(input: any): string {
		if (input === 'normal' || input === 'bold') {
			return input;
		}
		return String(EditorIntOption.clampedInt(input, EDITOR_FONT_DEFAULTS.fontWeight, EditorFontWeight.MINIMUM_VALUE, EditorFontWeight.MAXIMUM_VALUE));
	}
}

//#endregion

//#region gotoLocation

export type GoToLocationValues = 'peek' | 'gotoAndPeek' | 'goto';

/**
 * Configuration options for go to location
 */
export interface IGotoLocationOptions {

	multiple?: GoToLocationValues;

	multipleDefinitions?: GoToLocationValues;
	multipleTypeDefinitions?: GoToLocationValues;
	multipleDeclarations?: GoToLocationValues;
	multipleImplementations?: GoToLocationValues;
	multipleReferences?: GoToLocationValues;

	alternativeDefinitionCommand?: string;
	alternativeTypeDefinitionCommand?: string;
	alternativeDeclarationCommand?: string;
	alternativeImplementationCommand?: string;
	alternativeReferenceCommand?: string;
}

export type GoToLocationOptions = Readonly<Required<IGotoLocationOptions>>;

class EditorGoToLocation extends BaseEditorOption<EditorOption.gotoLocation, GoToLocationOptions> {

	constructor() {
		const defaults: GoToLocationOptions = {
			multiple: 'peek',
			multipleDefinitions: 'peek',
			multipleTypeDefinitions: 'peek',
			multipleDeclarations: 'peek',
			multipleImplementations: 'peek',
			multipleReferences: 'peek',
			alternativeDefinitionCommand: 'editor.action.goToReferences',
			alternativeTypeDefinitionCommand: 'editor.action.goToReferences',
			alternativeDeclarationCommand: 'editor.action.goToReferences',
			alternativeImplementationCommand: '',
			alternativeReferenceCommand: '',
		};
		const jsonSubset: IJSONSchema = {
			type: 'string',
			enum: ['peek', 'gotoAndPeek', 'goto'],
			default: defaults.multiple,
			enumDescriptions: [
				nls.localize('editor.gotoLocation.multiple.peek', 'Show peek view of the results (default)'),
				nls.localize('editor.gotoLocation.multiple.gotoAndPeek', 'Go to the primary result and show a peek view'),
				nls.localize('editor.gotoLocation.multiple.goto', 'Go to the primary result and enable peek-less navigation to others')
			]
		};
		const alternativeCommandOptions = ['', 'editor.action.referenceSearch.trigger', 'editor.action.goToReferences', 'editor.action.peekImplementation', 'editor.action.goToImplementation', 'editor.action.peekTypeDefinition', 'editor.action.goToTypeDefinition', 'editor.action.peekDeclaration', 'editor.action.revealDeclaration', 'editor.action.peekDefinition', 'editor.action.revealDefinitionAside', 'editor.action.revealDefinition'];
		super(
			EditorOption.gotoLocation, 'gotoLocation', defaults,
			{
				'editor.gotoLocation.multiple': {
					deprecationMessage: nls.localize('editor.gotoLocation.multiple.deprecated', "This setting is deprecated, please use separate settings like 'editor.editor.gotoLocation.multipleDefinitions' or 'editor.editor.gotoLocation.multipleImplementations' instead."),
				},
				'editor.gotoLocation.multipleDefinitions': {
					description: nls.localize('editor.editor.gotoLocation.multipleDefinitions', "Controls the behavior the 'Go to Definition'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.multipleTypeDefinitions': {
					description: nls.localize('editor.editor.gotoLocation.multipleTypeDefinitions', "Controls the behavior the 'Go to Type Definition'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.multipleDeclarations': {
					description: nls.localize('editor.editor.gotoLocation.multipleDeclarations', "Controls the behavior the 'Go to Declaration'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.multipleImplementations': {
					description: nls.localize('editor.editor.gotoLocation.multipleImplemenattions', "Controls the behavior the 'Go to Implementations'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.multipleReferences': {
					description: nls.localize('editor.editor.gotoLocation.multipleReferences', "Controls the behavior the 'Go to References'-command when multiple target locations exist."),
					...jsonSubset,
				},
				'editor.gotoLocation.alternativeDefinitionCommand': {
					type: 'string',
					default: defaults.alternativeDefinitionCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeDefinitionCommand', "Alternative command id that is being executed when the result of 'Go to Definition' is the current location.")
				},
				'editor.gotoLocation.alternativeTypeDefinitionCommand': {
					type: 'string',
					default: defaults.alternativeTypeDefinitionCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeTypeDefinitionCommand', "Alternative command id that is being executed when the result of 'Go to Type Definition' is the current location.")
				},
				'editor.gotoLocation.alternativeDeclarationCommand': {
					type: 'string',
					default: defaults.alternativeDeclarationCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeDeclarationCommand', "Alternative command id that is being executed when the result of 'Go to Declaration' is the current location.")
				},
				'editor.gotoLocation.alternativeImplementationCommand': {
					type: 'string',
					default: defaults.alternativeImplementationCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeImplementationCommand', "Alternative command id that is being executed when the result of 'Go to Implementation' is the current location.")
				},
				'editor.gotoLocation.alternativeReferenceCommand': {
					type: 'string',
					default: defaults.alternativeReferenceCommand,
					enum: alternativeCommandOptions,
					description: nls.localize('alternativeReferenceCommand', "Alternative command id that is being executed when the result of 'Go to Reference' is the current location.")
				},
			}
		);
	}

	public validate(_input: any): GoToLocationOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IGotoLocationOptions;
		return {
			multiple: stringSet<GoToLocationValues>(input.multiple, this.defaultValue.multiple!, ['peek', 'gotoAndPeek', 'goto']),
			multipleDefinitions: input.multipleDefinitions ?? stringSet<GoToLocationValues>(input.multipleDefinitions, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			multipleTypeDefinitions: input.multipleTypeDefinitions ?? stringSet<GoToLocationValues>(input.multipleTypeDefinitions, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			multipleDeclarations: input.multipleDeclarations ?? stringSet<GoToLocationValues>(input.multipleDeclarations, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			multipleImplementations: input.multipleImplementations ?? stringSet<GoToLocationValues>(input.multipleImplementations, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			multipleReferences: input.multipleReferences ?? stringSet<GoToLocationValues>(input.multipleReferences, 'peek', ['peek', 'gotoAndPeek', 'goto']),
			alternativeDefinitionCommand: EditorStringOption.string(input.alternativeDefinitionCommand, this.defaultValue.alternativeDefinitionCommand),
			alternativeTypeDefinitionCommand: EditorStringOption.string(input.alternativeTypeDefinitionCommand, this.defaultValue.alternativeTypeDefinitionCommand),
			alternativeDeclarationCommand: EditorStringOption.string(input.alternativeDeclarationCommand, this.defaultValue.alternativeDeclarationCommand),
			alternativeImplementationCommand: EditorStringOption.string(input.alternativeImplementationCommand, this.defaultValue.alternativeImplementationCommand),
			alternativeReferenceCommand: EditorStringOption.string(input.alternativeReferenceCommand, this.defaultValue.alternativeReferenceCommand),
		};
	}
}

//#endregion

//#region hover

/**
 * Configuration options for editor hover
 */
export interface IEditorHoverOptions {
	/**
	 * Enable the hover.
	 * Defaults to true.
	 */
	enabled?: boolean;
	/**
	 * Delay for showing the hover.
	 * Defaults to 300.
	 */
	delay?: number;
	/**
	 * Is the hover sticky such that it can be clicked and its contents selected?
	 * Defaults to true.
	 */
	sticky?: boolean;
}

export type EditorHoverOptions = Readonly<Required<IEditorHoverOptions>>;

class EditorHover extends BaseEditorOption<EditorOption.hover, EditorHoverOptions> {

	constructor() {
		const defaults: EditorHoverOptions = {
			enabled: true,
			delay: 300,
			sticky: true
		};
		super(
			EditorOption.hover, 'hover', defaults,
			{
				'editor.hover.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('hover.enabled', "Controls whether the hover is shown.")
				},
				'editor.hover.delay': {
					type: 'number',
					default: defaults.delay,
					description: nls.localize('hover.delay', "Controls the delay in milliseconds after which the hover is shown.")
				},
				'editor.hover.sticky': {
					type: 'boolean',
					default: defaults.sticky,
					description: nls.localize('hover.sticky', "Controls whether the hover should remain visible when mouse is moved over it.")
				},
			}
		);
	}

	public validate(_input: any): EditorHoverOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IEditorHoverOptions;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			delay: EditorIntOption.clampedInt(input.delay, this.defaultValue.delay, 0, 10000),
			sticky: boolean(input.sticky, this.defaultValue.sticky)
		};
	}
}

//#endregion

//#region layoutInfo

/**
 * A description for the overview ruler position.
 */
export interface OverviewRulerPosition {
	/**
	 * Width of the overview ruler
	 */
	readonly width: number;
	/**
	 * Height of the overview ruler
	 */
	readonly height: number;
	/**
	 * Top position for the overview ruler
	 */
	readonly top: number;
	/**
	 * Right position for the overview ruler
	 */
	readonly right: number;
}

export const enum RenderMinimap {
	None = 0,
	Text = 1,
	Blocks = 2,
}

/**
 * The internal layout details of the editor.
 */
export interface EditorLayoutInfo {

	/**
	 * Full editor width.
	 */
	readonly width: number;
	/**
	 * Full editor height.
	 */
	readonly height: number;

	/**
	 * Left position for the glyph margin.
	 */
	readonly glyphMarginLeft: number;
	/**
	 * The width of the glyph margin.
	 */
	readonly glyphMarginWidth: number;

	/**
	 * Left position for the line numbers.
	 */
	readonly lineNumbersLeft: number;
	/**
	 * The width of the line numbers.
	 */
	readonly lineNumbersWidth: number;

	/**
	 * Left position for the line decorations.
	 */
	readonly decorationsLeft: number;
	/**
	 * The width of the line decorations.
	 */
	readonly decorationsWidth: number;

	/**
	 * Left position for the content (actual text)
	 */
	readonly contentLeft: number;
	/**
	 * The width of the content (actual text)
	 */
	readonly contentWidth: number;

	/**
	 * Layout information for the minimap
	 */
	readonly minimap: EditorMinimapLayoutInfo;

	/**
	 * The number of columns (of typical characters) fitting on a viewport line.
	 */
	readonly viewportColumn: number;

	readonly isWordWrapMinified: boolean;
	readonly isViewportWrapping: boolean;
	readonly wrappingColumn: number;

	/**
	 * The width of the vertical scrollbar.
	 */
	readonly verticalScrollbarWidth: number;
	/**
	 * The height of the horizontal scrollbar.
	 */
	readonly horizontalScrollbarHeight: number;

	/**
	 * The position of the overview ruler.
	 */
	readonly overviewRuler: OverviewRulerPosition;
}

/**
 * The internal layout details of the editor.
 */
export interface EditorMinimapLayoutInfo {
	readonly renderMinimap: RenderMinimap;
	readonly minimapLeft: number;
	readonly minimapWidth: number;
	readonly minimapHeightIsEditorHeight: boolean;
	readonly minimapIsSampling: boolean;
	readonly minimapScale: number;
	readonly minimapLineHeight: number;
	readonly minimapCanvasInnerWidth: number;
	readonly minimapCanvasInnerHeight: number;
	readonly minimapCanvasOuterWidth: number;
	readonly minimapCanvasOuterHeight: number;
}

/**
 * @internal
 */
export interface EditorLayoutInfoComputerEnv {
	readonly memory: ComputeOptionsMemory | null;
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly isDominatedByLongLines: boolean;
	readonly lineHeight: number;
	readonly viewLineCount: number;
	readonly lineNumbersDigitCount: number;
	readonly typicalHalfwidthCharacterWidth: number;
	readonly maxDigitWidth: number;
	readonly pixelRatio: number;
}

/**
 * @internal
 */
export interface IEditorLayoutComputerInput {
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly isDominatedByLongLines: boolean;
	readonly lineHeight: number;
	readonly lineNumbersDigitCount: number;
	readonly typicalHalfwidthCharacterWidth: number;
	readonly maxDigitWidth: number;
	readonly pixelRatio: number;
	readonly glyphMargin: boolean;
	readonly lineDecorationsWidth: string | number;
	readonly folding: boolean;
	readonly minimap: Readonly<Required<IEditorMinimapOptions>>;
	readonly scrollbar: InternalEditorScrollbarOptions;
	readonly lineNumbers: InternalEditorRenderLineNumbersOptions;
	readonly lineNumbersMinChars: number;
	readonly scrollBeyondLastLine: boolean;
	readonly wordWrap: 'wordWrapColumn' | 'on' | 'off' | 'bounded';
	readonly wordWrapColumn: number;
	readonly wordWrapMinified: boolean;
	readonly accessibilitySupport: AccessibilitySupport;
}

/**
 * @internal
 */
export interface IMinimapLayoutInput {
	readonly outerWidth: number;
	readonly outerHeight: number;
	readonly lineHeight: number;
	readonly typicalHalfwidthCharacterWidth: number;
	readonly pixelRatio: number;
	readonly scrollBeyondLastLine: boolean;
	readonly minimap: Readonly<Required<IEditorMinimapOptions>>;
	readonly verticalScrollbarWidth: number;
	readonly viewLineCount: number;
	readonly remainingWidth: number;
	readonly isViewportWrapping: boolean;
}

/**
 * @internal
 */
export class EditorLayoutInfoComputer extends ComputedEditorOption<EditorOption.layoutInfo, EditorLayoutInfo> {

	constructor() {
		super(
			EditorOption.layoutInfo,
			[
				EditorOption.glyphMargin, EditorOption.lineDecorationsWidth, EditorOption.folding,
				EditorOption.minimap, EditorOption.scrollbar, EditorOption.lineNumbers,
				EditorOption.lineNumbersMinChars, EditorOption.scrollBeyondLastLine,
				EditorOption.wordWrap, EditorOption.wordWrapColumn, EditorOption.wordWrapOverride1, EditorOption.wordWrapOverride2,
				EditorOption.accessibilitySupport
			]
		);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: EditorLayoutInfo): EditorLayoutInfo {
		return EditorLayoutInfoComputer.computeLayout(options, {
			memory: env.memory,
			outerWidth: env.outerWidth,
			outerHeight: env.outerHeight,
			isDominatedByLongLines: env.isDominatedByLongLines,
			lineHeight: env.fontInfo.lineHeight,
			viewLineCount: env.viewLineCount,
			lineNumbersDigitCount: env.lineNumbersDigitCount,
			typicalHalfwidthCharacterWidth: env.fontInfo.typicalHalfwidthCharacterWidth,
			maxDigitWidth: env.fontInfo.maxDigitWidth,
			pixelRatio: env.pixelRatio
		});
	}

	public static computeContainedMinimapLineCount(input: {
		viewLineCount: number;
		scrollBeyondLastLine: boolean;
		height: number;
		lineHeight: number;
		pixelRatio: number;
	}): { typicalViewportLineCount: number; extraLinesBeyondLastLine: number; desiredRatio: number; minimapLineCount: number; } {
		const typicalViewportLineCount = input.height / input.lineHeight;
		const extraLinesBeyondLastLine = input.scrollBeyondLastLine ? (typicalViewportLineCount - 1) : 0;
		const desiredRatio = (input.viewLineCount + extraLinesBeyondLastLine) / (input.pixelRatio * input.height);
		const minimapLineCount = Math.floor(input.viewLineCount / desiredRatio);
		return { typicalViewportLineCount, extraLinesBeyondLastLine, desiredRatio, minimapLineCount };
	}

	private static _computeMinimapLayout(input: IMinimapLayoutInput, memory: ComputeOptionsMemory): EditorMinimapLayoutInfo {
		const outerWidth = input.outerWidth;
		const outerHeight = input.outerHeight;
		const pixelRatio = input.pixelRatio;

		if (!input.minimap.enabled) {
			return {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: Math.floor(pixelRatio * outerHeight),
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: outerHeight,
			};
		}

		// Can use memory if only the `viewLineCount` and `remainingWidth` have changed
		const stableMinimapLayoutInput = memory.stableMinimapLayoutInput;
		const couldUseMemory = (
			stableMinimapLayoutInput
			// && input.outerWidth === lastMinimapLayoutInput.outerWidth !!! INTENTIONAL OMITTED
			&& input.outerHeight === stableMinimapLayoutInput.outerHeight
			&& input.lineHeight === stableMinimapLayoutInput.lineHeight
			&& input.typicalHalfwidthCharacterWidth === stableMinimapLayoutInput.typicalHalfwidthCharacterWidth
			&& input.pixelRatio === stableMinimapLayoutInput.pixelRatio
			&& input.scrollBeyondLastLine === stableMinimapLayoutInput.scrollBeyondLastLine
			&& input.minimap.enabled === stableMinimapLayoutInput.minimap.enabled
			&& input.minimap.side === stableMinimapLayoutInput.minimap.side
			&& input.minimap.size === stableMinimapLayoutInput.minimap.size
			&& input.minimap.showSlider === stableMinimapLayoutInput.minimap.showSlider
			&& input.minimap.renderCharacters === stableMinimapLayoutInput.minimap.renderCharacters
			&& input.minimap.maxColumn === stableMinimapLayoutInput.minimap.maxColumn
			&& input.minimap.scale === stableMinimapLayoutInput.minimap.scale
			&& input.verticalScrollbarWidth === stableMinimapLayoutInput.verticalScrollbarWidth
			// && input.viewLineCount === lastMinimapLayoutInput.viewLineCount !!! INTENTIONAL OMITTED
			// && input.remainingWidth === lastMinimapLayoutInput.remainingWidth !!! INTENTIONAL OMITTED
			&& input.isViewportWrapping === stableMinimapLayoutInput.isViewportWrapping
		);

		const lineHeight = input.lineHeight;
		const typicalHalfwidthCharacterWidth = input.typicalHalfwidthCharacterWidth;
		const scrollBeyondLastLine = input.scrollBeyondLastLine;
		const minimapRenderCharacters = input.minimap.renderCharacters;
		let minimapScale = (pixelRatio >= 2 ? Math.round(input.minimap.scale * 2) : input.minimap.scale);
		const minimapMaxColumn = input.minimap.maxColumn;
		const minimapSize = input.minimap.size;
		const minimapSide = input.minimap.side;
		const verticalScrollbarWidth = input.verticalScrollbarWidth;
		const viewLineCount = input.viewLineCount;
		const remainingWidth = input.remainingWidth;
		const isViewportWrapping = input.isViewportWrapping;

		const baseCharHeight = minimapRenderCharacters ? 2 : 3;
		let minimapCanvasInnerHeight = Math.floor(pixelRatio * outerHeight);
		const minimapCanvasOuterHeight = minimapCanvasInnerHeight / pixelRatio;
		let minimapHeightIsEditorHeight = false;
		let minimapIsSampling = false;
		let minimapLineHeight = baseCharHeight * minimapScale;
		let minimapCharWidth = minimapScale / pixelRatio;
		let minimapWidthMultiplier: number = 1;

		if (minimapSize === 'fill' || minimapSize === 'fit') {
			const { typicalViewportLineCount, extraLinesBeyondLastLine, desiredRatio, minimapLineCount } = EditorLayoutInfoComputer.computeContainedMinimapLineCount({
				viewLineCount: viewLineCount,
				scrollBeyondLastLine: scrollBeyondLastLine,
				height: outerHeight,
				lineHeight: lineHeight,
				pixelRatio: pixelRatio
			});
			// ratio is intentionally not part of the layout to avoid the layout changing all the time
			// when doing sampling
			const ratio = viewLineCount / minimapLineCount;

			if (ratio > 1) {
				minimapHeightIsEditorHeight = true;
				minimapIsSampling = true;
				minimapScale = 1;
				minimapLineHeight = 1;
				minimapCharWidth = minimapScale / pixelRatio;
			} else {
				let fitBecomesFill = false;
				let maxMinimapScale = minimapScale + 1;

				if (minimapSize === 'fit') {
					const effectiveMinimapHeight = Math.ceil((viewLineCount + extraLinesBeyondLastLine) * minimapLineHeight);
					if (isViewportWrapping && couldUseMemory && remainingWidth <= memory.stableFitRemainingWidth) {
						// There is a loop when using `fit` and viewport wrapping:
						// - view line count impacts minimap layout
						// - minimap layout impacts viewport width
						// - viewport width impacts view line count
						// To break the loop, once we go to a smaller minimap scale, we try to stick with it.
						fitBecomesFill = true;
						maxMinimapScale = memory.stableFitMaxMinimapScale;
					} else {
						fitBecomesFill = (effectiveMinimapHeight > minimapCanvasInnerHeight);
					}
				}

				if (minimapSize === 'fill' || fitBecomesFill) {
					minimapHeightIsEditorHeight = true;
					const configuredMinimapScale = minimapScale;
					minimapLineHeight = Math.min(lineHeight * pixelRatio, Math.max(1, Math.floor(1 / desiredRatio)));
					if (isViewportWrapping && couldUseMemory && remainingWidth <= memory.stableFitRemainingWidth) {
						// There is a loop when using `fill` and viewport wrapping:
						// - view line count impacts minimap layout
						// - minimap layout impacts viewport width
						// - viewport width impacts view line count
						// To break the loop, once we go to a smaller minimap scale, we try to stick with it.
						maxMinimapScale = memory.stableFitMaxMinimapScale;
					}
					minimapScale = Math.min(maxMinimapScale, Math.max(1, Math.floor(minimapLineHeight / baseCharHeight)));
					if (minimapScale > configuredMinimapScale) {
						minimapWidthMultiplier = Math.min(2, minimapScale / configuredMinimapScale);
					}
					minimapCharWidth = minimapScale / pixelRatio / minimapWidthMultiplier;
					minimapCanvasInnerHeight = Math.ceil((Math.max(typicalViewportLineCount, viewLineCount + extraLinesBeyondLastLine)) * minimapLineHeight);
					if (isViewportWrapping) {
						// remember for next time
						memory.stableMinimapLayoutInput = input;
						memory.stableFitRemainingWidth = remainingWidth;
						memory.stableFitMaxMinimapScale = minimapScale;
					} else {
						memory.stableMinimapLayoutInput = null;
						memory.stableFitRemainingWidth = 0;
					}
				}
			}
		}

		// Given:
		// (leaving 2px for the cursor to have space after the last character)
		// viewportColumn = (contentWidth - verticalScrollbarWidth - 2) / typicalHalfwidthCharacterWidth
		// minimapWidth = viewportColumn * minimapCharWidth
		// contentWidth = remainingWidth - minimapWidth
		// What are good values for contentWidth and minimapWidth ?

		// minimapWidth = ((contentWidth - verticalScrollbarWidth - 2) / typicalHalfwidthCharacterWidth) * minimapCharWidth
		// typicalHalfwidthCharacterWidth * minimapWidth = (contentWidth - verticalScrollbarWidth - 2) * minimapCharWidth
		// typicalHalfwidthCharacterWidth * minimapWidth = (remainingWidth - minimapWidth - verticalScrollbarWidth - 2) * minimapCharWidth
		// (typicalHalfwidthCharacterWidth + minimapCharWidth) * minimapWidth = (remainingWidth - verticalScrollbarWidth - 2) * minimapCharWidth
		// minimapWidth = ((remainingWidth - verticalScrollbarWidth - 2) * minimapCharWidth) / (typicalHalfwidthCharacterWidth + minimapCharWidth)

		const minimapMaxWidth = Math.floor(minimapMaxColumn * minimapCharWidth);
		const minimapWidth = Math.min(minimapMaxWidth, Math.max(0, Math.floor(((remainingWidth - verticalScrollbarWidth - 2) * minimapCharWidth) / (typicalHalfwidthCharacterWidth + minimapCharWidth))) + MINIMAP_GUTTER_WIDTH);

		let minimapCanvasInnerWidth = Math.floor(pixelRatio * minimapWidth);
		const minimapCanvasOuterWidth = minimapCanvasInnerWidth / pixelRatio;
		minimapCanvasInnerWidth = Math.floor(minimapCanvasInnerWidth * minimapWidthMultiplier);

		const renderMinimap = (minimapRenderCharacters ? RenderMinimap.Text : RenderMinimap.Blocks);
		const minimapLeft = (minimapSide === 'left' ? 0 : (outerWidth - minimapWidth - verticalScrollbarWidth));

		return {
			renderMinimap,
			minimapLeft,
			minimapWidth,
			minimapHeightIsEditorHeight,
			minimapIsSampling,
			minimapScale,
			minimapLineHeight,
			minimapCanvasInnerWidth,
			minimapCanvasInnerHeight,
			minimapCanvasOuterWidth,
			minimapCanvasOuterHeight,
		};
	}

	public static computeLayout(options: IComputedEditorOptions, env: EditorLayoutInfoComputerEnv): EditorLayoutInfo {
		const outerWidth = env.outerWidth | 0;
		const outerHeight = env.outerHeight | 0;
		const lineHeight = env.lineHeight | 0;
		const lineNumbersDigitCount = env.lineNumbersDigitCount | 0;
		const typicalHalfwidthCharacterWidth = env.typicalHalfwidthCharacterWidth;
		const maxDigitWidth = env.maxDigitWidth;
		const pixelRatio = env.pixelRatio;
		const viewLineCount = env.viewLineCount;

		const wordWrapOverride2 = options.get(EditorOption.wordWrapOverride2);
		const wordWrapOverride1 = (wordWrapOverride2 === 'inherit' ? options.get(EditorOption.wordWrapOverride1) : wordWrapOverride2);
		const wordWrap = (wordWrapOverride1 === 'inherit' ? options.get(EditorOption.wordWrap) : wordWrapOverride1);

		const wordWrapColumn = options.get(EditorOption.wordWrapColumn);
		const accessibilitySupport = options.get(EditorOption.accessibilitySupport);
		const isDominatedByLongLines = env.isDominatedByLongLines;

		const showGlyphMargin = options.get(EditorOption.glyphMargin);
		const showLineNumbers = (options.get(EditorOption.lineNumbers).renderType !== RenderLineNumbersType.Off);
		const lineNumbersMinChars = options.get(EditorOption.lineNumbersMinChars);
		const scrollBeyondLastLine = options.get(EditorOption.scrollBeyondLastLine);
		const minimap = options.get(EditorOption.minimap);

		const scrollbar = options.get(EditorOption.scrollbar);
		const verticalScrollbarWidth = scrollbar.verticalScrollbarSize;
		const verticalScrollbarHasArrows = scrollbar.verticalHasArrows;
		const scrollbarArrowSize = scrollbar.arrowSize;
		const horizontalScrollbarHeight = scrollbar.horizontalScrollbarSize;

		const rawLineDecorationsWidth = options.get(EditorOption.lineDecorationsWidth);
		const folding = options.get(EditorOption.folding);

		let lineDecorationsWidth: number;
		if (typeof rawLineDecorationsWidth === 'string' && /^\d+(\.\d+)?ch$/.test(rawLineDecorationsWidth)) {
			const multiple = parseFloat(rawLineDecorationsWidth.substr(0, rawLineDecorationsWidth.length - 2));
			lineDecorationsWidth = EditorIntOption.clampedInt(multiple * typicalHalfwidthCharacterWidth, 0, 0, 1000);
		} else {
			lineDecorationsWidth = EditorIntOption.clampedInt(rawLineDecorationsWidth, 0, 0, 1000);
		}
		if (folding) {
			lineDecorationsWidth += 16;
		}

		let lineNumbersWidth = 0;
		if (showLineNumbers) {
			const digitCount = Math.max(lineNumbersDigitCount, lineNumbersMinChars);
			lineNumbersWidth = Math.round(digitCount * maxDigitWidth);
		}

		let glyphMarginWidth = 0;
		if (showGlyphMargin) {
			glyphMarginWidth = lineHeight;
		}

		let glyphMarginLeft = 0;
		let lineNumbersLeft = glyphMarginLeft + glyphMarginWidth;
		let decorationsLeft = lineNumbersLeft + lineNumbersWidth;
		let contentLeft = decorationsLeft + lineDecorationsWidth;

		const remainingWidth = outerWidth - glyphMarginWidth - lineNumbersWidth - lineDecorationsWidth;

		let isWordWrapMinified = false;
		let isViewportWrapping = false;
		let wrappingColumn = -1;

		if (accessibilitySupport !== AccessibilitySupport.Enabled) {
			// See https://github.com/microsoft/vscode/issues/27766
			// Never enable wrapping when a screen reader is attached
			// because arrow down etc. will not move the cursor in the way
			// a screen reader expects.
			if (wordWrapOverride1 === 'inherit' && isDominatedByLongLines) {
				// Force viewport width wrapping if model is dominated by long lines
				isWordWrapMinified = true;
				isViewportWrapping = true;
			} else if (wordWrap === 'on' || wordWrap === 'bounded') {
				isViewportWrapping = true;
			} else if (wordWrap === 'wordWrapColumn') {
				wrappingColumn = wordWrapColumn;
			}
		}

		const minimapLayout = EditorLayoutInfoComputer._computeMinimapLayout({
			outerWidth: outerWidth,
			outerHeight: outerHeight,
			lineHeight: lineHeight,
			typicalHalfwidthCharacterWidth: typicalHalfwidthCharacterWidth,
			pixelRatio: pixelRatio,
			scrollBeyondLastLine: scrollBeyondLastLine,
			minimap: minimap,
			verticalScrollbarWidth: verticalScrollbarWidth,
			viewLineCount: viewLineCount,
			remainingWidth: remainingWidth,
			isViewportWrapping: isViewportWrapping,
		}, env.memory || new ComputeOptionsMemory());

		if (minimapLayout.renderMinimap !== RenderMinimap.None && minimapLayout.minimapLeft === 0) {
			// the minimap is rendered to the left, so move everything to the right
			glyphMarginLeft += minimapLayout.minimapWidth;
			lineNumbersLeft += minimapLayout.minimapWidth;
			decorationsLeft += minimapLayout.minimapWidth;
			contentLeft += minimapLayout.minimapWidth;
		}
		const contentWidth = remainingWidth - minimapLayout.minimapWidth;

		// (leaving 2px for the cursor to have space after the last character)
		const viewportColumn = Math.max(1, Math.floor((contentWidth - verticalScrollbarWidth - 2) / typicalHalfwidthCharacterWidth));

		const verticalArrowSize = (verticalScrollbarHasArrows ? scrollbarArrowSize : 0);

		if (isViewportWrapping) {
			// compute the actual wrappingColumn
			wrappingColumn = Math.max(1, viewportColumn);
			if (wordWrap === 'bounded') {
				wrappingColumn = Math.min(wrappingColumn, wordWrapColumn);
			}
		}

		return {
			width: outerWidth,
			height: outerHeight,

			glyphMarginLeft: glyphMarginLeft,
			glyphMarginWidth: glyphMarginWidth,

			lineNumbersLeft: lineNumbersLeft,
			lineNumbersWidth: lineNumbersWidth,

			decorationsLeft: decorationsLeft,
			decorationsWidth: lineDecorationsWidth,

			contentLeft: contentLeft,
			contentWidth: contentWidth,

			minimap: minimapLayout,

			viewportColumn: viewportColumn,

			isWordWrapMinified: isWordWrapMinified,
			isViewportWrapping: isViewportWrapping,
			wrappingColumn: wrappingColumn,

			verticalScrollbarWidth: verticalScrollbarWidth,
			horizontalScrollbarHeight: horizontalScrollbarHeight,

			overviewRuler: {
				top: verticalArrowSize,
				width: verticalScrollbarWidth,
				height: (outerHeight - 2 * verticalArrowSize),
				right: 0
			}
		};
	}
}

//#endregion

//#region lightbulb

/**
 * Configuration options for editor lightbulb
 */
export interface IEditorLightbulbOptions {
	/**
	 * Enable the lightbulb code action.
	 * Defaults to true.
	 */
	enabled?: boolean;
}

export type EditorLightbulbOptions = Readonly<Required<IEditorLightbulbOptions>>;

class EditorLightbulb extends BaseEditorOption<EditorOption.lightbulb, EditorLightbulbOptions> {

	constructor() {
		const defaults: EditorLightbulbOptions = { enabled: true };
		super(
			EditorOption.lightbulb, 'lightbulb', defaults,
			{
				'editor.lightbulb.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('codeActions', "Enables the code action lightbulb in the editor.")
				},
			}
		);
	}

	public validate(_input: any): EditorLightbulbOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IEditorLightbulbOptions;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled)
		};
	}
}

//#endregion

//#region inlayHints

/**
 * Configuration options for editor inlayHints
 */
export interface IEditorInlayHintsOptions {
	/**
	 * Enable the inline hints.
	 * Defaults to true.
	 */
	enabled?: boolean;

	/**
	 * Font size of inline hints.
	 * Default to 90% of the editor font size.
	 */
	fontSize?: number;

	/**
	 * Font family of inline hints.
	 * Defaults to editor font family.
	 */
	fontFamily?: string;
}

export type EditorInlayHintsOptions = Readonly<Required<IEditorInlayHintsOptions>>;

class EditorInlayHints extends BaseEditorOption<EditorOption.inlayHints, EditorInlayHintsOptions> {

	constructor() {
		const defaults: EditorInlayHintsOptions = { enabled: true, fontSize: 0, fontFamily: '' };
		super(
			EditorOption.inlayHints, 'inlayHints', defaults,
			{
				'editor.inlayHints.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('inlayHints.enable', "Enables the inlay hints in the editor.")
				},
				'editor.inlayHints.fontSize': {
					type: 'number',
					default: defaults.fontSize,
					markdownDescription: nls.localize('inlayHints.fontSize', "Controls font size of inlay hints in the editor. When set to `0`, the 90% of `#editor.fontSize#` is used.")
				},
				'editor.inlayHints.fontFamily': {
					type: 'string',
					default: defaults.fontFamily,
					description: nls.localize('inlayHints.fontFamily', "Controls font family of inlay hints in the editor. When set to empty, the `#editor.fontFamily#` is used.")
				},
			}
		);
	}

	public validate(_input: any): EditorInlayHintsOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IEditorInlayHintsOptions;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			fontSize: EditorIntOption.clampedInt(input.fontSize, this.defaultValue.fontSize, 0, 100),
			fontFamily: EditorStringOption.string(input.fontFamily, this.defaultValue.fontFamily)
		};
	}
}

//#endregion

//#region lineHeight

class EditorLineHeight extends EditorFloatOption<EditorOption.lineHeight> {

	constructor() {
		super(
			EditorOption.lineHeight, 'lineHeight',
			EDITOR_FONT_DEFAULTS.lineHeight,
			x => EditorFloatOption.clamp(x, 0, 150),
			{ markdownDescription: nls.localize('lineHeight', "Controls the line height. \n - Use 0 to automatically compute the line height from the font size.\n - Values between 0 and 8 will be used as a multiplier with the font size.\n - Values greater than or equal to 8 will be used as effective values.") }
		);
	}

	public override compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, value: number): number {
		// The lineHeight is computed from the fontSize if it is 0.
		// Moreover, the final lineHeight respects the editor zoom level.
		// So take the result from env.fontInfo
		return env.fontInfo.lineHeight;
	}
}

//#endregion

//#region minimap

/**
 * Configuration options for editor minimap
 */
export interface IEditorMinimapOptions {
	/**
	 * Enable the rendering of the minimap.
	 * Defaults to true.
	 */
	enabled?: boolean;
	/**
	 * Control the side of the minimap in editor.
	 * Defaults to 'right'.
	 */
	side?: 'right' | 'left';
	/**
	 * Control the minimap rendering mode.
	 * Defaults to 'actual'.
	 */
	size?: 'proportional' | 'fill' | 'fit';
	/**
	 * Control the rendering of the minimap slider.
	 * Defaults to 'mouseover'.
	 */
	showSlider?: 'always' | 'mouseover';
	/**
	 * Render the actual text on a line (as opposed to color blocks).
	 * Defaults to true.
	 */
	renderCharacters?: boolean;
	/**
	 * Limit the width of the minimap to render at most a certain number of columns.
	 * Defaults to 120.
	 */
	maxColumn?: number;
	/**
	 * Relative size of the font in the minimap. Defaults to 1.
	 */
	scale?: number;
}

export type EditorMinimapOptions = Readonly<Required<IEditorMinimapOptions>>;

class EditorMinimap extends BaseEditorOption<EditorOption.minimap, EditorMinimapOptions> {

	constructor() {
		const defaults: EditorMinimapOptions = {
			enabled: true,
			size: 'proportional',
			side: 'right',
			showSlider: 'mouseover',
			renderCharacters: true,
			maxColumn: 120,
			scale: 1,
		};
		super(
			EditorOption.minimap, 'minimap', defaults,
			{
				'editor.minimap.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('minimap.enabled', "Controls whether the minimap is shown.")
				},
				'editor.minimap.size': {
					type: 'string',
					enum: ['proportional', 'fill', 'fit'],
					enumDescriptions: [
						nls.localize('minimap.size.proportional', "The minimap has the same size as the editor contents (and might scroll)."),
						nls.localize('minimap.size.fill', "The minimap will stretch or shrink as necessary to fill the height of the editor (no scrolling)."),
						nls.localize('minimap.size.fit', "The minimap will shrink as necessary to never be larger than the editor (no scrolling)."),
					],
					default: defaults.size,
					description: nls.localize('minimap.size', "Controls the size of the minimap.")
				},
				'editor.minimap.side': {
					type: 'string',
					enum: ['left', 'right'],
					default: defaults.side,
					description: nls.localize('minimap.side', "Controls the side where to render the minimap.")
				},
				'editor.minimap.showSlider': {
					type: 'string',
					enum: ['always', 'mouseover'],
					default: defaults.showSlider,
					description: nls.localize('minimap.showSlider', "Controls when the minimap slider is shown.")
				},
				'editor.minimap.scale': {
					type: 'number',
					default: defaults.scale,
					minimum: 1,
					maximum: 3,
					enum: [1, 2, 3],
					description: nls.localize('minimap.scale', "Scale of content drawn in the minimap: 1, 2 or 3.")
				},
				'editor.minimap.renderCharacters': {
					type: 'boolean',
					default: defaults.renderCharacters,
					description: nls.localize('minimap.renderCharacters', "Render the actual characters on a line as opposed to color blocks.")
				},
				'editor.minimap.maxColumn': {
					type: 'number',
					default: defaults.maxColumn,
					description: nls.localize('minimap.maxColumn', "Limit the width of the minimap to render at most a certain number of columns.")
				}
			}
		);
	}

	public validate(_input: any): EditorMinimapOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IEditorMinimapOptions;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			size: stringSet<'proportional' | 'fill' | 'fit'>(input.size, this.defaultValue.size, ['proportional', 'fill', 'fit']),
			side: stringSet<'right' | 'left'>(input.side, this.defaultValue.side, ['right', 'left']),
			showSlider: stringSet<'always' | 'mouseover'>(input.showSlider, this.defaultValue.showSlider, ['always', 'mouseover']),
			renderCharacters: boolean(input.renderCharacters, this.defaultValue.renderCharacters),
			scale: EditorIntOption.clampedInt(input.scale, 1, 1, 3),
			maxColumn: EditorIntOption.clampedInt(input.maxColumn, this.defaultValue.maxColumn, 1, 10000),
		};
	}
}

//#endregion

//#region multiCursorModifier

function _multiCursorModifierFromString(multiCursorModifier: 'ctrlCmd' | 'alt'): 'altKey' | 'metaKey' | 'ctrlKey' {
	if (multiCursorModifier === 'ctrlCmd') {
		return (platform.isMacintosh ? 'metaKey' : 'ctrlKey');
	}
	return 'altKey';
}

//#endregion

//#region padding

/**
 * Configuration options for editor padding
 */
export interface IEditorPaddingOptions {
	/**
	 * Spacing between top edge of editor and first line.
	 */
	top?: number;
	/**
	 * Spacing between bottom edge of editor and last line.
	 */
	bottom?: number;
}

export interface InternalEditorPaddingOptions {
	readonly top: number;
	readonly bottom: number;
}

class EditorPadding extends BaseEditorOption<EditorOption.padding, InternalEditorPaddingOptions> {

	constructor() {
		super(
			EditorOption.padding, 'padding', { top: 0, bottom: 0 },
			{
				'editor.padding.top': {
					type: 'number',
					default: 0,
					minimum: 0,
					maximum: 1000,
					description: nls.localize('padding.top', "Controls the amount of space between the top edge of the editor and the first line.")
				},
				'editor.padding.bottom': {
					type: 'number',
					default: 0,
					minimum: 0,
					maximum: 1000,
					description: nls.localize('padding.bottom', "Controls the amount of space between the bottom edge of the editor and the last line.")
				}
			}
		);
	}

	public validate(_input: any): InternalEditorPaddingOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IEditorPaddingOptions;

		return {
			top: EditorIntOption.clampedInt(input.top, 0, 0, 1000),
			bottom: EditorIntOption.clampedInt(input.bottom, 0, 0, 1000)
		};
	}
}
//#endregion

//#region parameterHints

/**
 * Configuration options for parameter hints
 */
export interface IEditorParameterHintOptions {
	/**
	 * Enable parameter hints.
	 * Defaults to true.
	 */
	enabled?: boolean;
	/**
	 * Enable cycling of parameter hints.
	 * Defaults to false.
	 */
	cycle?: boolean;
}

export type InternalParameterHintOptions = Readonly<Required<IEditorParameterHintOptions>>;

class EditorParameterHints extends BaseEditorOption<EditorOption.parameterHints, InternalParameterHintOptions> {

	constructor() {
		const defaults: InternalParameterHintOptions = {
			enabled: true,
			cycle: false
		};
		super(
			EditorOption.parameterHints, 'parameterHints', defaults,
			{
				'editor.parameterHints.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('parameterHints.enabled', "Enables a pop-up that shows parameter documentation and type information as you type.")
				},
				'editor.parameterHints.cycle': {
					type: 'boolean',
					default: defaults.cycle,
					description: nls.localize('parameterHints.cycle', "Controls whether the parameter hints menu cycles or closes when reaching the end of the list.")
				},
			}
		);
	}

	public validate(_input: any): InternalParameterHintOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IEditorParameterHintOptions;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			cycle: boolean(input.cycle, this.defaultValue.cycle)
		};
	}
}

//#endregion

//#region pixelRatio

class EditorPixelRatio extends ComputedEditorOption<EditorOption.pixelRatio, number> {

	constructor() {
		super(EditorOption.pixelRatio);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: number): number {
		return env.pixelRatio;
	}
}

//#endregion

//#region quickSuggestions

/**
 * Configuration options for quick suggestions
 */
export interface IQuickSuggestionsOptions {
	other?: boolean;
	comments?: boolean;
	strings?: boolean;
}

export type ValidQuickSuggestionsOptions = boolean | Readonly<Required<IQuickSuggestionsOptions>>;

class EditorQuickSuggestions extends BaseEditorOption<EditorOption.quickSuggestions, ValidQuickSuggestionsOptions> {

	public override readonly defaultValue: Readonly<Required<IQuickSuggestionsOptions>>;

	constructor() {
		const defaults: ValidQuickSuggestionsOptions = {
			other: true,
			comments: false,
			strings: false
		};
		super(
			EditorOption.quickSuggestions, 'quickSuggestions', defaults,
			{
				anyOf: [
					{
						type: 'boolean',
					},
					{
						type: 'object',
						properties: {
							strings: {
								type: 'boolean',
								default: defaults.strings,
								description: nls.localize('quickSuggestions.strings', "Enable quick suggestions inside strings.")
							},
							comments: {
								type: 'boolean',
								default: defaults.comments,
								description: nls.localize('quickSuggestions.comments', "Enable quick suggestions inside comments.")
							},
							other: {
								type: 'boolean',
								default: defaults.other,
								description: nls.localize('quickSuggestions.other', "Enable quick suggestions outside of strings and comments.")
							},
						}
					}
				],
				default: defaults,
				description: nls.localize('quickSuggestions', "Controls whether suggestions should automatically show up while typing.")
			}
		);
		this.defaultValue = defaults;
	}

	public validate(_input: any): ValidQuickSuggestionsOptions {
		if (typeof _input === 'boolean') {
			return _input;
		}
		if (_input && typeof _input === 'object') {
			const input = _input as IQuickSuggestionsOptions;
			const opts = {
				other: boolean(input.other, this.defaultValue.other),
				comments: boolean(input.comments, this.defaultValue.comments),
				strings: boolean(input.strings, this.defaultValue.strings),
			};
			if (opts.other && opts.comments && opts.strings) {
				return true; // all on
			} else if (!opts.other && !opts.comments && !opts.strings) {
				return false; // all off
			} else {
				return opts;
			}
		}
		return this.defaultValue;
	}
}

//#endregion

//#region renderLineNumbers

export type LineNumbersType = 'on' | 'off' | 'relative' | 'interval' | ((lineNumber: number) => string);

export const enum RenderLineNumbersType {
	Off = 0,
	On = 1,
	Relative = 2,
	Interval = 3,
	Custom = 4
}

export interface InternalEditorRenderLineNumbersOptions {
	readonly renderType: RenderLineNumbersType;
	readonly renderFn: ((lineNumber: number) => string) | null;
}

class EditorRenderLineNumbersOption extends BaseEditorOption<EditorOption.lineNumbers, InternalEditorRenderLineNumbersOptions> {

	constructor() {
		super(
			EditorOption.lineNumbers, 'lineNumbers', { renderType: RenderLineNumbersType.On, renderFn: null },
			{
				type: 'string',
				enum: ['off', 'on', 'relative', 'interval'],
				enumDescriptions: [
					nls.localize('lineNumbers.off', "Line numbers are not rendered."),
					nls.localize('lineNumbers.on', "Line numbers are rendered as absolute number."),
					nls.localize('lineNumbers.relative', "Line numbers are rendered as distance in lines to cursor position."),
					nls.localize('lineNumbers.interval', "Line numbers are rendered every 10 lines.")
				],
				default: 'on',
				description: nls.localize('lineNumbers', "Controls the display of line numbers.")
			}
		);
	}

	public validate(lineNumbers: any): InternalEditorRenderLineNumbersOptions {
		let renderType: RenderLineNumbersType = this.defaultValue.renderType;
		let renderFn: ((lineNumber: number) => string) | null = this.defaultValue.renderFn;

		if (typeof lineNumbers !== 'undefined') {
			if (typeof lineNumbers === 'function') {
				renderType = RenderLineNumbersType.Custom;
				renderFn = lineNumbers;
			} else if (lineNumbers === 'interval') {
				renderType = RenderLineNumbersType.Interval;
			} else if (lineNumbers === 'relative') {
				renderType = RenderLineNumbersType.Relative;
			} else if (lineNumbers === 'on') {
				renderType = RenderLineNumbersType.On;
			} else {
				renderType = RenderLineNumbersType.Off;
			}
		}

		return {
			renderType,
			renderFn
		};
	}
}

//#endregion

//#region renderValidationDecorations

/**
 * @internal
 */
export function filterValidationDecorations(options: IComputedEditorOptions): boolean {
	const renderValidationDecorations = options.get(EditorOption.renderValidationDecorations);
	if (renderValidationDecorations === 'editable') {
		return options.get(EditorOption.readOnly);
	}
	return renderValidationDecorations === 'on' ? false : true;
}

//#endregion

//#region rulers

export interface IRulerOption {
	readonly column: number;
	readonly color: string | null;
}

class EditorRulers extends BaseEditorOption<EditorOption.rulers, IRulerOption[]> {

	constructor() {
		const defaults: IRulerOption[] = [];
		const columnSchema: IJSONSchema = { type: 'number', description: nls.localize('rulers.size', "Number of monospace characters at which this editor ruler will render.") };
		super(
			EditorOption.rulers, 'rulers', defaults,
			{
				type: 'array',
				items: {
					anyOf: [
						columnSchema,
						{
							type: [
								'object'
							],
							properties: {
								column: columnSchema,
								color: {
									type: 'string',
									description: nls.localize('rulers.color', "Color of this editor ruler."),
									format: 'color-hex'
								}
							}
						}
					]
				},
				default: defaults,
				description: nls.localize('rulers', "Render vertical rulers after a certain number of monospace characters. Use multiple values for multiple rulers. No rulers are drawn if array is empty.")
			}
		);
	}

	public validate(input: any): IRulerOption[] {
		if (Array.isArray(input)) {
			let rulers: IRulerOption[] = [];
			for (let _element of input) {
				if (typeof _element === 'number') {
					rulers.push({
						column: EditorIntOption.clampedInt(_element, 0, 0, 10000),
						color: null
					});
				} else if (_element && typeof _element === 'object') {
					const element = _element as IRulerOption;
					rulers.push({
						column: EditorIntOption.clampedInt(element.column, 0, 0, 10000),
						color: element.color
					});
				}
			}
			rulers.sort((a, b) => a.column - b.column);
			return rulers;
		}
		return this.defaultValue;
	}
}

//#endregion

//#region scrollbar

/**
 * Configuration options for editor scrollbars
 */
export interface IEditorScrollbarOptions {
	/**
	 * The size of arrows (if displayed).
	 * Defaults to 11.
	 * **NOTE**: This option cannot be updated using `updateOptions()`
	 */
	arrowSize?: number;
	/**
	 * Render vertical scrollbar.
	 * Defaults to 'auto'.
	 */
	vertical?: 'auto' | 'visible' | 'hidden';
	/**
	 * Render horizontal scrollbar.
	 * Defaults to 'auto'.
	 */
	horizontal?: 'auto' | 'visible' | 'hidden';
	/**
	 * Cast horizontal and vertical shadows when the content is scrolled.
	 * Defaults to true.
	 * **NOTE**: This option cannot be updated using `updateOptions()`
	 */
	useShadows?: boolean;
	/**
	 * Render arrows at the top and bottom of the vertical scrollbar.
	 * Defaults to false.
	 * **NOTE**: This option cannot be updated using `updateOptions()`
	 */
	verticalHasArrows?: boolean;
	/**
	 * Render arrows at the left and right of the horizontal scrollbar.
	 * Defaults to false.
	 * **NOTE**: This option cannot be updated using `updateOptions()`
	 */
	horizontalHasArrows?: boolean;
	/**
	 * Listen to mouse wheel events and react to them by scrolling.
	 * Defaults to true.
	 */
	handleMouseWheel?: boolean;
	/**
	 * Always consume mouse wheel events (always call preventDefault() and stopPropagation() on the browser events).
	 * Defaults to true.
	 * **NOTE**: This option cannot be updated using `updateOptions()`
	 */
	alwaysConsumeMouseWheel?: boolean;
	/**
	 * Height in pixels for the horizontal scrollbar.
	 * Defaults to 10 (px).
	 */
	horizontalScrollbarSize?: number;
	/**
	 * Width in pixels for the vertical scrollbar.
	 * Defaults to 10 (px).
	 */
	verticalScrollbarSize?: number;
	/**
	 * Width in pixels for the vertical slider.
	 * Defaults to `verticalScrollbarSize`.
	 * **NOTE**: This option cannot be updated using `updateOptions()`
	 */
	verticalSliderSize?: number;
	/**
	 * Height in pixels for the horizontal slider.
	 * Defaults to `horizontalScrollbarSize`.
	 * **NOTE**: This option cannot be updated using `updateOptions()`
	 */
	horizontalSliderSize?: number;
	/**
	 * Scroll gutter clicks move by page vs jump to position.
	 * Defaults to false.
	 */
	scrollByPage?: boolean;
}

export interface InternalEditorScrollbarOptions {
	readonly arrowSize: number;
	readonly vertical: ScrollbarVisibility;
	readonly horizontal: ScrollbarVisibility;
	readonly useShadows: boolean;
	readonly verticalHasArrows: boolean;
	readonly horizontalHasArrows: boolean;
	readonly handleMouseWheel: boolean;
	readonly alwaysConsumeMouseWheel: boolean;
	readonly horizontalScrollbarSize: number;
	readonly horizontalSliderSize: number;
	readonly verticalScrollbarSize: number;
	readonly verticalSliderSize: number;
	readonly scrollByPage: boolean;
}

function _scrollbarVisibilityFromString(visibility: string | undefined, defaultValue: ScrollbarVisibility): ScrollbarVisibility {
	if (typeof visibility !== 'string') {
		return defaultValue;
	}
	switch (visibility) {
		case 'hidden': return ScrollbarVisibility.Hidden;
		case 'visible': return ScrollbarVisibility.Visible;
		default: return ScrollbarVisibility.Auto;
	}
}

class EditorScrollbar extends BaseEditorOption<EditorOption.scrollbar, InternalEditorScrollbarOptions> {

	constructor() {
		const defaults: InternalEditorScrollbarOptions = {
			vertical: ScrollbarVisibility.Auto,
			horizontal: ScrollbarVisibility.Auto,
			arrowSize: 11,
			useShadows: true,
			verticalHasArrows: false,
			horizontalHasArrows: false,
			horizontalScrollbarSize: 12,
			horizontalSliderSize: 12,
			verticalScrollbarSize: 14,
			verticalSliderSize: 14,
			handleMouseWheel: true,
			alwaysConsumeMouseWheel: true,
			scrollByPage: false
		};
		super(
			EditorOption.scrollbar, 'scrollbar', defaults,
			{
				'editor.scrollbar.vertical': {
					type: 'string',
					enum: ['auto', 'visible', 'hidden'],
					enumDescriptions: [
						nls.localize('scrollbar.vertical.auto', "The vertical scrollbar will be visible only when necessary."),
						nls.localize('scrollbar.vertical.visible', "The vertical scrollbar will always be visible."),
						nls.localize('scrollbar.vertical.fit', "The vertical scrollbar will always be hidden."),
					],
					default: 'auto',
					description: nls.localize('scrollbar.vertical', "Controls the visibility of the vertical scrollbar.")
				},
				'editor.scrollbar.horizontal': {
					type: 'string',
					enum: ['auto', 'visible', 'hidden'],
					enumDescriptions: [
						nls.localize('scrollbar.horizontal.auto', "The horizontal scrollbar will be visible only when necessary."),
						nls.localize('scrollbar.horizontal.visible', "The horizontal scrollbar will always be visible."),
						nls.localize('scrollbar.horizontal.fit', "The horizontal scrollbar will always be hidden."),
					],
					default: 'auto',
					description: nls.localize('scrollbar.horizontal', "Controls the visibility of the horizontal scrollbar.")
				},
				'editor.scrollbar.verticalScrollbarSize': {
					type: 'number',
					default: defaults.verticalScrollbarSize,
					description: nls.localize('scrollbar.verticalScrollbarSize', "The width of the vertical scrollbar.")
				},
				'editor.scrollbar.horizontalScrollbarSize': {
					type: 'number',
					default: defaults.horizontalScrollbarSize,
					description: nls.localize('scrollbar.horizontalScrollbarSize', "The height of the horizontal scrollbar.")
				},
				'editor.scrollbar.scrollByPage': {
					type: 'boolean',
					default: defaults.scrollByPage,
					description: nls.localize('scrollbar.scrollByPage', "Controls whether clicks scroll by page or jump to click position.")
				}
			}
		);
	}

	public validate(_input: any): InternalEditorScrollbarOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IEditorScrollbarOptions;
		const horizontalScrollbarSize = EditorIntOption.clampedInt(input.horizontalScrollbarSize, this.defaultValue.horizontalScrollbarSize, 0, 1000);
		const verticalScrollbarSize = EditorIntOption.clampedInt(input.verticalScrollbarSize, this.defaultValue.verticalScrollbarSize, 0, 1000);
		return {
			arrowSize: EditorIntOption.clampedInt(input.arrowSize, this.defaultValue.arrowSize, 0, 1000),
			vertical: _scrollbarVisibilityFromString(input.vertical, this.defaultValue.vertical),
			horizontal: _scrollbarVisibilityFromString(input.horizontal, this.defaultValue.horizontal),
			useShadows: boolean(input.useShadows, this.defaultValue.useShadows),
			verticalHasArrows: boolean(input.verticalHasArrows, this.defaultValue.verticalHasArrows),
			horizontalHasArrows: boolean(input.horizontalHasArrows, this.defaultValue.horizontalHasArrows),
			handleMouseWheel: boolean(input.handleMouseWheel, this.defaultValue.handleMouseWheel),
			alwaysConsumeMouseWheel: boolean(input.alwaysConsumeMouseWheel, this.defaultValue.alwaysConsumeMouseWheel),
			horizontalScrollbarSize: horizontalScrollbarSize,
			horizontalSliderSize: EditorIntOption.clampedInt(input.horizontalSliderSize, horizontalScrollbarSize, 0, 1000),
			verticalScrollbarSize: verticalScrollbarSize,
			verticalSliderSize: EditorIntOption.clampedInt(input.verticalSliderSize, verticalScrollbarSize, 0, 1000),
			scrollByPage: boolean(input.scrollByPage, this.defaultValue.scrollByPage),
		};
	}
}

//#endregion

//#region inlineSuggest

export interface IInlineSuggestOptions {
	/**
	 * Enable or disable the rendering of automatic inline completions.
	*/
	enabled?: boolean;

	/**
	 * Configures the mode.
	 * Use `prefix` to only show ghost text if the text to replace is a prefix of the suggestion text.
	 * Use `subword` to only show ghost text if the replace text is a subword of the suggestion text.
	 * Use `subwordSmart` to only show ghost text if the replace text is a subword of the suggestion text, but the subword must start after the cursor position.
	 * Defaults to `prefix`.
	*/
	mode?: 'prefix' | 'subword' | 'subwordSmart';
}

export type InternalInlineSuggestOptions = Readonly<Required<IInlineSuggestOptions>>;

/**
 * Configuration options for inline suggestions
 */
class InlineEditorSuggest extends BaseEditorOption<EditorOption.inlineSuggest, InternalInlineSuggestOptions> {
	constructor() {
		const defaults: InternalInlineSuggestOptions = {
			enabled: false,
			mode: 'subwordSmart'
		};

		super(
			EditorOption.inlineSuggest, 'inlineSuggest', defaults,
			{
				'editor.inlineSuggest.enabled': {
					type: 'boolean',
					default: defaults.enabled,
					description: nls.localize('inlineSuggest.enabled', "Controls whether to automatically show inline suggestions in the editor.")
				},
				'editor.inlineSuggest.mode': {
					type: 'string',
					enum: ['prefix', 'subword', 'subwordSmart'],
					enumDescriptions: [
						nls.localize('inlineSuggest.mode.prefix', "Only render an inline suggestion if the replace text is a prefix of the insert text."),
						nls.localize('inlineSuggest.mode.subword', "Only render an inline suggestion if the replace text is a subword of the insert text."),
						nls.localize('inlineSuggest.mode.subwordSmart', "Only render an inline suggestion if the replace text is a subword of the insert text, but the subword must start after the cursor."),
					],
					default: defaults.mode,
					description: nls.localize('inlineSuggest.mode', "Controls which mode to use for rendering inline suggestions.")
				},
			}
		);
	}

	public validate(_input: any): InternalInlineSuggestOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as IInlineSuggestOptions;
		return {
			enabled: boolean(input.enabled, this.defaultValue.enabled),
			mode: stringSet(input.mode, this.defaultValue.mode, ['prefix', 'subword', 'subwordSmart']),
		};
	}
}

//#endregion

//#region suggest

/**
 * Configuration options for editor suggest widget
 */
export interface ISuggestOptions {
	/**
	 * Overwrite word ends on accept. Default to false.
	 */
	insertMode?: 'insert' | 'replace';
	/**
	 * Enable graceful matching. Defaults to true.
	 */
	filterGraceful?: boolean;
	/**
	 * Prevent quick suggestions when a snippet is active. Defaults to true.
	 */
	snippetsPreventQuickSuggestions?: boolean;
	/**
	 * Favors words that appear close to the cursor.
	 */
	localityBonus?: boolean;
	/**
	 * Enable using global storage for remembering suggestions.
	 */
	shareSuggestSelections?: boolean;
	/**
	 * Enable or disable icons in suggestions. Defaults to true.
	 */
	showIcons?: boolean;
	/**
	 * Enable or disable the suggest status bar.
	 */
	showStatusBar?: boolean;
	/**
	 * Enable or disable the rendering of the suggestion preview.
	 */
	preview?: boolean;
	/**
	 * Configures the mode of the preview.
	*/
	previewMode?: 'prefix' | 'subword' | 'subwordSmart';
	/**
	 * Show details inline with the label. Defaults to true.
	 */
	showInlineDetails?: boolean;
	/**
	 * Show method-suggestions.
	 */
	showMethods?: boolean;
	/**
	 * Show function-suggestions.
	 */
	showFunctions?: boolean;
	/**
	 * Show constructor-suggestions.
	 */
	showConstructors?: boolean;
	/**
	 * Show deprecated-suggestions.
	 */
	showDeprecated?: boolean;
	/**
	 * Show field-suggestions.
	 */
	showFields?: boolean;
	/**
	 * Show variable-suggestions.
	 */
	showVariables?: boolean;
	/**
	 * Show class-suggestions.
	 */
	showClasses?: boolean;
	/**
	 * Show struct-suggestions.
	 */
	showStructs?: boolean;
	/**
	 * Show interface-suggestions.
	 */
	showInterfaces?: boolean;
	/**
	 * Show module-suggestions.
	 */
	showModules?: boolean;
	/**
	 * Show property-suggestions.
	 */
	showProperties?: boolean;
	/**
	 * Show event-suggestions.
	 */
	showEvents?: boolean;
	/**
	 * Show operator-suggestions.
	 */
	showOperators?: boolean;
	/**
	 * Show unit-suggestions.
	 */
	showUnits?: boolean;
	/**
	 * Show value-suggestions.
	 */
	showValues?: boolean;
	/**
	 * Show constant-suggestions.
	 */
	showConstants?: boolean;
	/**
	 * Show enum-suggestions.
	 */
	showEnums?: boolean;
	/**
	 * Show enumMember-suggestions.
	 */
	showEnumMembers?: boolean;
	/**
	 * Show keyword-suggestions.
	 */
	showKeywords?: boolean;
	/**
	 * Show text-suggestions.
	 */
	showWords?: boolean;
	/**
	 * Show color-suggestions.
	 */
	showColors?: boolean;
	/**
	 * Show file-suggestions.
	 */
	showFiles?: boolean;
	/**
	 * Show reference-suggestions.
	 */
	showReferences?: boolean;
	/**
	 * Show folder-suggestions.
	 */
	showFolders?: boolean;
	/**
	 * Show typeParameter-suggestions.
	 */
	showTypeParameters?: boolean;
	/**
	 * Show issue-suggestions.
	 */
	showIssues?: boolean;
	/**
	 * Show user-suggestions.
	 */
	showUsers?: boolean;
	/**
	 * Show snippet-suggestions.
	 */
	showSnippets?: boolean;
}

export type InternalSuggestOptions = Readonly<Required<ISuggestOptions>>;

class EditorSuggest extends BaseEditorOption<EditorOption.suggest, InternalSuggestOptions> {

	constructor() {
		const defaults: InternalSuggestOptions = {
			insertMode: 'insert',
			filterGraceful: true,
			snippetsPreventQuickSuggestions: true,
			localityBonus: false,
			shareSuggestSelections: false,
			showIcons: true,
			showStatusBar: false,
			preview: false,
			previewMode: 'subwordSmart',
			showInlineDetails: true,
			showMethods: true,
			showFunctions: true,
			showConstructors: true,
			showDeprecated: true,
			showFields: true,
			showVariables: true,
			showClasses: true,
			showStructs: true,
			showInterfaces: true,
			showModules: true,
			showProperties: true,
			showEvents: true,
			showOperators: true,
			showUnits: true,
			showValues: true,
			showConstants: true,
			showEnums: true,
			showEnumMembers: true,
			showKeywords: true,
			showWords: true,
			showColors: true,
			showFiles: true,
			showReferences: true,
			showFolders: true,
			showTypeParameters: true,
			showSnippets: true,
			showUsers: true,
			showIssues: true,
		};
		super(
			EditorOption.suggest, 'suggest', defaults,
			{
				'editor.suggest.insertMode': {
					type: 'string',
					enum: ['insert', 'replace'],
					enumDescriptions: [
						nls.localize('suggest.insertMode.insert', "Insert suggestion without overwriting text right of the cursor."),
						nls.localize('suggest.insertMode.replace', "Insert suggestion and overwrite text right of the cursor."),
					],
					default: defaults.insertMode,
					description: nls.localize('suggest.insertMode', "Controls whether words are overwritten when accepting completions. Note that this depends on extensions opting into this feature.")
				},
				'editor.suggest.filterGraceful': {
					type: 'boolean',
					default: defaults.filterGraceful,
					description: nls.localize('suggest.filterGraceful', "Controls whether filtering and sorting suggestions accounts for small typos.")
				},
				'editor.suggest.localityBonus': {
					type: 'boolean',
					default: defaults.localityBonus,
					description: nls.localize('suggest.localityBonus', "Controls whether sorting favors words that appear close to the cursor.")
				},
				'editor.suggest.shareSuggestSelections': {
					type: 'boolean',
					default: defaults.shareSuggestSelections,
					markdownDescription: nls.localize('suggest.shareSuggestSelections', "Controls whether remembered suggestion selections are shared between multiple workspaces and windows (needs `#editor.suggestSelection#`).")
				},
				'editor.suggest.snippetsPreventQuickSuggestions': {
					type: 'boolean',
					default: defaults.snippetsPreventQuickSuggestions,
					description: nls.localize('suggest.snippetsPreventQuickSuggestions', "Controls whether an active snippet prevents quick suggestions.")
				},
				'editor.suggest.showIcons': {
					type: 'boolean',
					default: defaults.showIcons,
					description: nls.localize('suggest.showIcons', "Controls whether to show or hide icons in suggestions.")
				},
				'editor.suggest.showStatusBar': {
					type: 'boolean',
					default: defaults.showStatusBar,
					description: nls.localize('suggest.showStatusBar', "Controls the visibility of the status bar at the bottom of the suggest widget.")
				},
				'editor.suggest.preview': {
					type: 'boolean',
					default: defaults.preview,
					description: nls.localize('suggest.preview', "Controls whether to preview the suggestion outcome in the editor.")
				},
				'editor.suggest.previewMode': {
					type: 'string',
					enum: ['prefix', 'subword', 'subwordSmart'],
					enumDescriptions: [
						nls.localize('suggest.previewMode.prefix', "Only render a preview if the replace text is a prefix of the insert text."),
						nls.localize('suggest.previewMode.subword', "Only render a preview if the replace text is a subword of the insert text."),
						nls.localize('suggest.previewMode.subwordSmart', "Render a preview if the replace text is a subword of the insert text, or if it is a prefix of the insert text."),
					],
					default: defaults.previewMode,
					description: nls.localize('suggest.previewMode', "Controls which mode to use for rendering the suggest preview.")
				},
				'editor.suggest.showInlineDetails': {
					type: 'boolean',
					default: defaults.showInlineDetails,
					description: nls.localize('suggest.showInlineDetails', "Controls whether suggest details show inline with the label or only in the details widget")
				},
				'editor.suggest.maxVisibleSuggestions': {
					type: 'number',
					deprecationMessage: nls.localize('suggest.maxVisibleSuggestions.dep', "This setting is deprecated. The suggest widget can now be resized."),
				},
				'editor.suggest.filteredTypes': {
					type: 'object',
					deprecationMessage: nls.localize('deprecated', "This setting is deprecated, please use separate settings like 'editor.suggest.showKeywords' or 'editor.suggest.showSnippets' instead.")
				},
				'editor.suggest.showMethods': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showMethods', "When enabled IntelliSense shows `method`-suggestions.")
				},
				'editor.suggest.showFunctions': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showFunctions', "When enabled IntelliSense shows `function`-suggestions.")
				},
				'editor.suggest.showConstructors': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showConstructors', "When enabled IntelliSense shows `constructor`-suggestions.")
				},
				'editor.suggest.showDeprecated': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showDeprecated', "When enabled IntelliSense shows `deprecated`-suggestions.")
				},
				'editor.suggest.showFields': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showFields', "When enabled IntelliSense shows `field`-suggestions.")
				},
				'editor.suggest.showVariables': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showVariables', "When enabled IntelliSense shows `variable`-suggestions.")
				},
				'editor.suggest.showClasses': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showClasss', "When enabled IntelliSense shows `class`-suggestions.")
				},
				'editor.suggest.showStructs': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showStructs', "When enabled IntelliSense shows `struct`-suggestions.")
				},
				'editor.suggest.showInterfaces': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showInterfaces', "When enabled IntelliSense shows `interface`-suggestions.")
				},
				'editor.suggest.showModules': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showModules', "When enabled IntelliSense shows `module`-suggestions.")
				},
				'editor.suggest.showProperties': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showPropertys', "When enabled IntelliSense shows `property`-suggestions.")
				},
				'editor.suggest.showEvents': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showEvents', "When enabled IntelliSense shows `event`-suggestions.")
				},
				'editor.suggest.showOperators': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showOperators', "When enabled IntelliSense shows `operator`-suggestions.")
				},
				'editor.suggest.showUnits': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showUnits', "When enabled IntelliSense shows `unit`-suggestions.")
				},
				'editor.suggest.showValues': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showValues', "When enabled IntelliSense shows `value`-suggestions.")
				},
				'editor.suggest.showConstants': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showConstants', "When enabled IntelliSense shows `constant`-suggestions.")
				},
				'editor.suggest.showEnums': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showEnums', "When enabled IntelliSense shows `enum`-suggestions.")
				},
				'editor.suggest.showEnumMembers': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showEnumMembers', "When enabled IntelliSense shows `enumMember`-suggestions.")
				},
				'editor.suggest.showKeywords': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showKeywords', "When enabled IntelliSense shows `keyword`-suggestions.")
				},
				'editor.suggest.showWords': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showTexts', "When enabled IntelliSense shows `text`-suggestions.")
				},
				'editor.suggest.showColors': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showColors', "When enabled IntelliSense shows `color`-suggestions.")
				},
				'editor.suggest.showFiles': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showFiles', "When enabled IntelliSense shows `file`-suggestions.")
				},
				'editor.suggest.showReferences': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showReferences', "When enabled IntelliSense shows `reference`-suggestions.")
				},
				'editor.suggest.showCustomcolors': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showCustomcolors', "When enabled IntelliSense shows `customcolor`-suggestions.")
				},
				'editor.suggest.showFolders': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showFolders', "When enabled IntelliSense shows `folder`-suggestions.")
				},
				'editor.suggest.showTypeParameters': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showTypeParameters', "When enabled IntelliSense shows `typeParameter`-suggestions.")
				},
				'editor.suggest.showSnippets': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showSnippets', "When enabled IntelliSense shows `snippet`-suggestions.")
				},
				'editor.suggest.showUsers': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showUsers', "When enabled IntelliSense shows `user`-suggestions.")
				},
				'editor.suggest.showIssues': {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('editor.suggest.showIssues', "When enabled IntelliSense shows `issues`-suggestions.")
				}
			}
		);
	}

	public validate(_input: any): InternalSuggestOptions {
		if (!_input || typeof _input !== 'object') {
			return this.defaultValue;
		}
		const input = _input as ISuggestOptions;
		return {
			insertMode: stringSet(input.insertMode, this.defaultValue.insertMode, ['insert', 'replace']),
			filterGraceful: boolean(input.filterGraceful, this.defaultValue.filterGraceful),
			snippetsPreventQuickSuggestions: boolean(input.snippetsPreventQuickSuggestions, this.defaultValue.filterGraceful),
			localityBonus: boolean(input.localityBonus, this.defaultValue.localityBonus),
			shareSuggestSelections: boolean(input.shareSuggestSelections, this.defaultValue.shareSuggestSelections),
			showIcons: boolean(input.showIcons, this.defaultValue.showIcons),
			showStatusBar: boolean(input.showStatusBar, this.defaultValue.showStatusBar),
			preview: boolean(input.preview, this.defaultValue.preview),
			previewMode: stringSet(input.previewMode, this.defaultValue.previewMode, ['prefix', 'subword', 'subwordSmart']),
			showInlineDetails: boolean(input.showInlineDetails, this.defaultValue.showInlineDetails),
			showMethods: boolean(input.showMethods, this.defaultValue.showMethods),
			showFunctions: boolean(input.showFunctions, this.defaultValue.showFunctions),
			showConstructors: boolean(input.showConstructors, this.defaultValue.showConstructors),
			showDeprecated: boolean(input.showDeprecated, this.defaultValue.showDeprecated),
			showFields: boolean(input.showFields, this.defaultValue.showFields),
			showVariables: boolean(input.showVariables, this.defaultValue.showVariables),
			showClasses: boolean(input.showClasses, this.defaultValue.showClasses),
			showStructs: boolean(input.showStructs, this.defaultValue.showStructs),
			showInterfaces: boolean(input.showInterfaces, this.defaultValue.showInterfaces),
			showModules: boolean(input.showModules, this.defaultValue.showModules),
			showProperties: boolean(input.showProperties, this.defaultValue.showProperties),
			showEvents: boolean(input.showEvents, this.defaultValue.showEvents),
			showOperators: boolean(input.showOperators, this.defaultValue.showOperators),
			showUnits: boolean(input.showUnits, this.defaultValue.showUnits),
			showValues: boolean(input.showValues, this.defaultValue.showValues),
			showConstants: boolean(input.showConstants, this.defaultValue.showConstants),
			showEnums: boolean(input.showEnums, this.defaultValue.showEnums),
			showEnumMembers: boolean(input.showEnumMembers, this.defaultValue.showEnumMembers),
			showKeywords: boolean(input.showKeywords, this.defaultValue.showKeywords),
			showWords: boolean(input.showWords, this.defaultValue.showWords),
			showColors: boolean(input.showColors, this.defaultValue.showColors),
			showFiles: boolean(input.showFiles, this.defaultValue.showFiles),
			showReferences: boolean(input.showReferences, this.defaultValue.showReferences),
			showFolders: boolean(input.showFolders, this.defaultValue.showFolders),
			showTypeParameters: boolean(input.showTypeParameters, this.defaultValue.showTypeParameters),
			showSnippets: boolean(input.showSnippets, this.defaultValue.showSnippets),
			showUsers: boolean(input.showUsers, this.defaultValue.showUsers),
			showIssues: boolean(input.showIssues, this.defaultValue.showIssues),
		};
	}
}

//#endregion

//#region smart select

export interface ISmartSelectOptions {
	selectLeadingAndTrailingWhitespace?: boolean
}

export type SmartSelectOptions = Readonly<Required<ISmartSelectOptions>>;

class SmartSelect extends BaseEditorOption<EditorOption.smartSelect, SmartSelectOptions> {

	constructor() {
		super(
			EditorOption.smartSelect, 'smartSelect',
			{
				selectLeadingAndTrailingWhitespace: true
			},
			{
				'editor.smartSelect.selectLeadingAndTrailingWhitespace': {
					description: nls.localize('selectLeadingAndTrailingWhitespace', "Whether leading and trailing whitespace should always be selected."),
					default: true,
					type: 'boolean'
				}
			}
		);
	}

	public validate(input: any): Readonly<Required<ISmartSelectOptions>> {
		if (!input || typeof input !== 'object') {
			return this.defaultValue;
		}
		return {
			selectLeadingAndTrailingWhitespace: boolean((input as ISmartSelectOptions).selectLeadingAndTrailingWhitespace, this.defaultValue.selectLeadingAndTrailingWhitespace)
		};
	}
}

//#endregion

//#region tabFocusMode

class EditorTabFocusMode extends ComputedEditorOption<EditorOption.tabFocusMode, boolean> {

	constructor() {
		super(EditorOption.tabFocusMode, [EditorOption.readOnly]);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: boolean): boolean {
		const readOnly = options.get(EditorOption.readOnly);
		return (readOnly ? true : env.tabFocusMode);
	}
}

//#endregion

//#region wrappingIndent

/**
 * Describes how to indent wrapped lines.
 */
export const enum WrappingIndent {
	/**
	 * No indentation => wrapped lines begin at column 1.
	 */
	None = 0,
	/**
	 * Same => wrapped lines get the same indentation as the parent.
	 */
	Same = 1,
	/**
	 * Indent => wrapped lines get +1 indentation toward the parent.
	 */
	Indent = 2,
	/**
	 * DeepIndent => wrapped lines get +2 indentation toward the parent.
	 */
	DeepIndent = 3
}

function _wrappingIndentFromString(wrappingIndent: 'none' | 'same' | 'indent' | 'deepIndent'): WrappingIndent {
	switch (wrappingIndent) {
		case 'none': return WrappingIndent.None;
		case 'same': return WrappingIndent.Same;
		case 'indent': return WrappingIndent.Indent;
		case 'deepIndent': return WrappingIndent.DeepIndent;
	}
}

//#endregion

//#region wrappingInfo

export interface EditorWrappingInfo {
	readonly isDominatedByLongLines: boolean;
	readonly isWordWrapMinified: boolean;
	readonly isViewportWrapping: boolean;
	readonly wrappingColumn: number;
}

class EditorWrappingInfoComputer extends ComputedEditorOption<EditorOption.wrappingInfo, EditorWrappingInfo> {

	constructor() {
		super(EditorOption.wrappingInfo, [EditorOption.layoutInfo]);
	}

	public compute(env: IEnvironmentalOptions, options: IComputedEditorOptions, _: EditorWrappingInfo): EditorWrappingInfo {
		const layoutInfo = options.get(EditorOption.layoutInfo);

		return {
			isDominatedByLongLines: env.isDominatedByLongLines,
			isWordWrapMinified: layoutInfo.isWordWrapMinified,
			isViewportWrapping: layoutInfo.isViewportWrapping,
			wrappingColumn: layoutInfo.wrappingColumn,
		};
	}
}

//#endregion

const DEFAULT_WINDOWS_FONT_FAMILY = 'Consolas, \'Courier New\', monospace';
const DEFAULT_MAC_FONT_FAMILY = 'Menlo, Monaco, \'Courier New\', monospace';
const DEFAULT_LINUX_FONT_FAMILY = '\'Droid Sans Mono\', \'monospace\', monospace, \'Droid Sans Fallback\'';

/**
 * @internal
 */
export const EDITOR_FONT_DEFAULTS = {
	fontFamily: (
		platform.isMacintosh ? DEFAULT_MAC_FONT_FAMILY : (platform.isLinux ? DEFAULT_LINUX_FONT_FAMILY : DEFAULT_WINDOWS_FONT_FAMILY)
	),
	fontWeight: 'normal',
	fontSize: (
		platform.isMacintosh ? 12 : 14
	),
	lineHeight: 0,
	letterSpacing: 0,
};

/**
 * @internal
 */
export const EDITOR_MODEL_DEFAULTS = {
	tabSize: 4,
	indentSize: 4,
	insertSpaces: true,
	detectIndentation: true,
	trimAutoWhitespace: true,
	largeFileOptimizations: true
};

/**
 * @internal
 */
export const editorOptionsRegistry: IEditorOption<EditorOption, any>[] = [];

function register<K1 extends EditorOption, V>(option: IEditorOption<K1, V>): IEditorOption<K1, V> {
	editorOptionsRegistry[option.id] = option;
	return option;
}

export const enum EditorOption {
	acceptSuggestionOnCommitCharacter,
	acceptSuggestionOnEnter,
	accessibilitySupport,
	accessibilityPageSize,
	ariaLabel,
	autoClosingBrackets,
	autoClosingDelete,
	autoClosingOvertype,
	autoClosingQuotes,
	autoIndent,
	automaticLayout,
	autoSurround,
	codeLens,
	codeLensFontFamily,
	codeLensFontSize,
	colorDecorators,
	columnSelection,
	comments,
	contextmenu,
	copyWithSyntaxHighlighting,
	cursorBlinking,
	cursorSmoothCaretAnimation,
	cursorStyle,
	cursorSurroundingLines,
	cursorSurroundingLinesStyle,
	cursorWidth,
	disableLayerHinting,
	disableMonospaceOptimizations,
	domReadOnly,
	dragAndDrop,
	emptySelectionClipboard,
	extraEditorClassName,
	fastScrollSensitivity,
	find,
	fixedOverflowWidgets,
	folding,
	foldingStrategy,
	foldingHighlight,
	unfoldOnClickAfterEndOfLine,
	fontFamily,
	fontInfo,
	fontLigatures,
	fontSize,
	fontWeight,
	formatOnPaste,
	formatOnType,
	glyphMargin,
	gotoLocation,
	hideCursorInOverviewRuler,
	highlightActiveIndentGuide,
	hover,
	inDiffEditor,
	inlineSuggest,
	letterSpacing,
	lightbulb,
	lineDecorationsWidth,
	lineHeight,
	lineNumbers,
	lineNumbersMinChars,
	linkedEditing,
	links,
	matchBrackets,
	minimap,
	mouseStyle,
	mouseWheelScrollSensitivity,
	mouseWheelZoom,
	multiCursorMergeOverlapping,
	multiCursorModifier,
	multiCursorPaste,
	occurrencesHighlight,
	overviewRulerBorder,
	overviewRulerLanes,
	padding,
	parameterHints,
	peekWidgetDefaultFocus,
	definitionLinkOpensInPeek,
	quickSuggestions,
	quickSuggestionsDelay,
	readOnly,
	renameOnType,
	renderControlCharacters,
	renderIndentGuides,
	renderFinalNewline,
	renderLineHighlight,
	renderLineHighlightOnlyWhenFocus,
	renderValidationDecorations,
	renderWhitespace,
	revealHorizontalRightPadding,
	roundedSelection,
	rulers,
	scrollbar,
	scrollBeyondLastColumn,
	scrollBeyondLastLine,
	scrollPredominantAxis,
	selectionClipboard,
	selectionHighlight,
	selectOnLineNumbers,
	showFoldingControls,
	showUnused,
	snippetSuggestions,
	smartSelect,
	smoothScrolling,
	stickyTabStops,
	stopRenderingLineAfter,
	suggest,
	suggestFontSize,
	suggestLineHeight,
	suggestOnTriggerCharacters,
	suggestSelection,
	tabCompletion,
	tabIndex,
	unusualLineTerminators,
	useShadowDOM,
	useTabStops,
	wordSeparators,
	wordWrap,
	wordWrapBreakAfterCharacters,
	wordWrapBreakBeforeCharacters,
	wordWrapColumn,
	wordWrapOverride1,
	wordWrapOverride2,
	wrappingIndent,
	wrappingStrategy,
	showDeprecated,
	inlayHints,
	// Leave these at the end (because they have dependencies!)
	editorClassName,
	pixelRatio,
	tabFocusMode,
	layoutInfo,
	wrappingInfo,
}

/**
 * WORKAROUND: TS emits "any" for complex editor options values (anything except string, bool, enum, etc. ends up being "any")
 * @monacodtsreplace
 * /accessibilitySupport, any/accessibilitySupport, AccessibilitySupport/
 * /comments, any/comments, EditorCommentsOptions/
 * /find, any/find, EditorFindOptions/
 * /fontInfo, any/fontInfo, FontInfo/
 * /gotoLocation, any/gotoLocation, GoToLocationOptions/
 * /hover, any/hover, EditorHoverOptions/
 * /lightbulb, any/lightbulb, EditorLightbulbOptions/
 * /minimap, any/minimap, EditorMinimapOptions/
 * /parameterHints, any/parameterHints, InternalParameterHintOptions/
 * /quickSuggestions, any/quickSuggestions, ValidQuickSuggestionsOptions/
 * /suggest, any/suggest, InternalSuggestOptions/
 */
export const EditorOptions = {
	acceptSuggestionOnCommitCharacter: register(new EditorBooleanOption(
		EditorOption.acceptSuggestionOnCommitCharacter, 'acceptSuggestionOnCommitCharacter', true,
		{ markdownDescription: nls.localize('acceptSuggestionOnCommitCharacter', "Controls whether suggestions should be accepted on commit characters. For example, in JavaScript, the semi-colon (`;`) can be a commit character that accepts a suggestion and types that character.") }
	)),
	acceptSuggestionOnEnter: register(new EditorStringEnumOption(
		EditorOption.acceptSuggestionOnEnter, 'acceptSuggestionOnEnter',
		'on' as 'on' | 'smart' | 'off',
		['on', 'smart', 'off'] as const,
		{
			markdownEnumDescriptions: [
				'',
				nls.localize('acceptSuggestionOnEnterSmart', "Only accept a suggestion with `Enter` when it makes a textual change."),
				''
			],
			markdownDescription: nls.localize('acceptSuggestionOnEnter', "Controls whether suggestions should be accepted on `Enter`, in addition to `Tab`. Helps to avoid ambiguity between inserting new lines or accepting suggestions.")
		}
	)),
	accessibilitySupport: register(new EditorAccessibilitySupport()),
	accessibilityPageSize: register(new EditorIntOption(EditorOption.accessibilityPageSize, 'accessibilityPageSize', 10, 1, Constants.MAX_SAFE_SMALL_INTEGER,
		{
			description: nls.localize('accessibilityPageSize', "Controls the number of lines in the editor that can be read out by a screen reader at once. When we detect a screen reader we automatically set the default to be 500. Warning: this has a performance implication for numbers larger than the default.")
		})),
	ariaLabel: register(new EditorStringOption(
		EditorOption.ariaLabel, 'ariaLabel', nls.localize('editorViewAccessibleLabel', "Editor content")
	)),
	autoClosingBrackets: register(new EditorStringEnumOption(
		EditorOption.autoClosingBrackets, 'autoClosingBrackets',
		'languageDefined' as 'always' | 'languageDefined' | 'beforeWhitespace' | 'never',
		['always', 'languageDefined', 'beforeWhitespace', 'never'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingBrackets.languageDefined', "Use language configurations to determine when to autoclose brackets."),
				nls.localize('editor.autoClosingBrackets.beforeWhitespace', "Autoclose brackets only when the cursor is to the left of whitespace."),
				'',
			],
			description: nls.localize('autoClosingBrackets', "Controls whether the editor should automatically close brackets after the user adds an opening bracket.")
		}
	)),
	autoClosingDelete: register(new EditorStringEnumOption(
		EditorOption.autoClosingDelete, 'autoClosingDelete',
		'auto' as 'always' | 'auto' | 'never',
		['always', 'auto', 'never'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingDelete.auto', "Remove adjacent closing quotes or brackets only if they were automatically inserted."),
				'',
			],
			description: nls.localize('autoClosingDelete', "Controls whether the editor should remove adjacent closing quotes or brackets when deleting.")
		}
	)),
	autoClosingOvertype: register(new EditorStringEnumOption(
		EditorOption.autoClosingOvertype, 'autoClosingOvertype',
		'auto' as 'always' | 'auto' | 'never',
		['always', 'auto', 'never'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingOvertype.auto', "Type over closing quotes or brackets only if they were automatically inserted."),
				'',
			],
			description: nls.localize('autoClosingOvertype', "Controls whether the editor should type over closing quotes or brackets.")
		}
	)),
	autoClosingQuotes: register(new EditorStringEnumOption(
		EditorOption.autoClosingQuotes, 'autoClosingQuotes',
		'languageDefined' as 'always' | 'languageDefined' | 'beforeWhitespace' | 'never',
		['always', 'languageDefined', 'beforeWhitespace', 'never'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingQuotes.languageDefined', "Use language configurations to determine when to autoclose quotes."),
				nls.localize('editor.autoClosingQuotes.beforeWhitespace', "Autoclose quotes only when the cursor is to the left of whitespace."),
				'',
			],
			description: nls.localize('autoClosingQuotes', "Controls whether the editor should automatically close quotes after the user adds an opening quote.")
		}
	)),
	autoIndent: register(new EditorEnumOption(
		EditorOption.autoIndent, 'autoIndent',
		EditorAutoIndentStrategy.Full, 'full',
		['none', 'keep', 'brackets', 'advanced', 'full'],
		_autoIndentFromString,
		{
			enumDescriptions: [
				nls.localize('editor.autoIndent.none', "The editor will not insert indentation automatically."),
				nls.localize('editor.autoIndent.keep', "The editor will keep the current line's indentation."),
				nls.localize('editor.autoIndent.brackets', "The editor will keep the current line's indentation and honor language defined brackets."),
				nls.localize('editor.autoIndent.advanced', "The editor will keep the current line's indentation, honor language defined brackets and invoke special onEnterRules defined by languages."),
				nls.localize('editor.autoIndent.full', "The editor will keep the current line's indentation, honor language defined brackets, invoke special onEnterRules defined by languages, and honor indentationRules defined by languages."),
			],
			description: nls.localize('autoIndent', "Controls whether the editor should automatically adjust the indentation when users type, paste, move or indent lines.")
		}
	)),
	automaticLayout: register(new EditorBooleanOption(
		EditorOption.automaticLayout, 'automaticLayout', false,
	)),
	autoSurround: register(new EditorStringEnumOption(
		EditorOption.autoSurround, 'autoSurround',
		'languageDefined' as 'languageDefined' | 'quotes' | 'brackets' | 'never',
		['languageDefined', 'quotes', 'brackets', 'never'] as const,
		{
			enumDescriptions: [
				nls.localize('editor.autoSurround.languageDefined', "Use language configurations to determine when to automatically surround selections."),
				nls.localize('editor.autoSurround.quotes', "Surround with quotes but not brackets."),
				nls.localize('editor.autoSurround.brackets', "Surround with brackets but not quotes."),
				''
			],
			description: nls.localize('autoSurround', "Controls whether the editor should automatically surround selections when typing quotes or brackets.")
		}
	)),
	stickyTabStops: register(new EditorBooleanOption(
		EditorOption.stickyTabStops, 'stickyTabStops', false,
		{ description: nls.localize('stickyTabStops', "Emulate selection behavior of tab characters when using spaces for indentation. Selection will stick to tab stops.") }
	)),
	codeLens: register(new EditorBooleanOption(
		EditorOption.codeLens, 'codeLens', true,
		{ description: nls.localize('codeLens', "Controls whether the editor shows CodeLens.") }
	)),
	codeLensFontFamily: register(new EditorStringOption(
		EditorOption.codeLensFontFamily, 'codeLensFontFamily', '',
		{ description: nls.localize('codeLensFontFamily', "Controls the font family for CodeLens.") }
	)),
	codeLensFontSize: register(new EditorIntOption(EditorOption.codeLensFontSize, 'codeLensFontSize', 0, 0, 100, {
		type: 'number',
		default: 0,
		minimum: 0,
		maximum: 100,
		markdownDescription: nls.localize('codeLensFontSize', "Controls the font size in pixels for CodeLens. When set to `0`, the 90% of `#editor.fontSize#` is used.")
	})),
	colorDecorators: register(new EditorBooleanOption(
		EditorOption.colorDecorators, 'colorDecorators', true,
		{ description: nls.localize('colorDecorators', "Controls whether the editor should render the inline color decorators and color picker.") }
	)),
	columnSelection: register(new EditorBooleanOption(
		EditorOption.columnSelection, 'columnSelection', false,
		{ description: nls.localize('columnSelection', "Enable that the selection with the mouse and keys is doing column selection.") }
	)),
	comments: register(new EditorComments()),
	contextmenu: register(new EditorBooleanOption(
		EditorOption.contextmenu, 'contextmenu', true,
	)),
	copyWithSyntaxHighlighting: register(new EditorBooleanOption(
		EditorOption.copyWithSyntaxHighlighting, 'copyWithSyntaxHighlighting', true,
		{ description: nls.localize('copyWithSyntaxHighlighting', "Controls whether syntax highlighting should be copied into the clipboard.") }
	)),
	cursorBlinking: register(new EditorEnumOption(
		EditorOption.cursorBlinking, 'cursorBlinking',
		TextEditorCursorBlinkingStyle.Blink, 'blink',
		['blink', 'smooth', 'phase', 'expand', 'solid'],
		_cursorBlinkingStyleFromString,
		{ description: nls.localize('cursorBlinking', "Control the cursor animation style.") }
	)),
	cursorSmoothCaretAnimation: register(new EditorBooleanOption(
		EditorOption.cursorSmoothCaretAnimation, 'cursorSmoothCaretAnimation', false,
		{ description: nls.localize('cursorSmoothCaretAnimation', "Controls whether the smooth caret animation should be enabled.") }
	)),
	cursorStyle: register(new EditorEnumOption(
		EditorOption.cursorStyle, 'cursorStyle',
		TextEditorCursorStyle.Line, 'line',
		['line', 'block', 'underline', 'line-thin', 'block-outline', 'underline-thin'],
		_cursorStyleFromString,
		{ description: nls.localize('cursorStyle', "Controls the cursor style.") }
	)),
	cursorSurroundingLines: register(new EditorIntOption(
		EditorOption.cursorSurroundingLines, 'cursorSurroundingLines',
		0, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{ description: nls.localize('cursorSurroundingLines', "Controls the minimal number of visible leading and trailing lines surrounding the cursor. Known as 'scrollOff' or 'scrollOffset' in some other editors.") }
	)),
	cursorSurroundingLinesStyle: register(new EditorStringEnumOption(
		EditorOption.cursorSurroundingLinesStyle, 'cursorSurroundingLinesStyle',
		'default' as 'default' | 'all',
		['default', 'all'] as const,
		{
			enumDescriptions: [
				nls.localize('cursorSurroundingLinesStyle.default', "`cursorSurroundingLines` is enforced only when triggered via the keyboard or API."),
				nls.localize('cursorSurroundingLinesStyle.all', "`cursorSurroundingLines` is enforced always.")
			],
			description: nls.localize('cursorSurroundingLinesStyle', "Controls when `cursorSurroundingLines` should be enforced.")
		}
	)),
	cursorWidth: register(new EditorIntOption(
		EditorOption.cursorWidth, 'cursorWidth',
		0, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{ markdownDescription: nls.localize('cursorWidth', "Controls the width of the cursor when `#editor.cursorStyle#` is set to `line`.") }
	)),
	disableLayerHinting: register(new EditorBooleanOption(
		EditorOption.disableLayerHinting, 'disableLayerHinting', false,
	)),
	disableMonospaceOptimizations: register(new EditorBooleanOption(
		EditorOption.disableMonospaceOptimizations, 'disableMonospaceOptimizations', false
	)),
	domReadOnly: register(new EditorBooleanOption(
		EditorOption.domReadOnly, 'domReadOnly', false,
	)),
	dragAndDrop: register(new EditorBooleanOption(
		EditorOption.dragAndDrop, 'dragAndDrop', true,
		{ description: nls.localize('dragAndDrop', "Controls whether the editor should allow moving selections via drag and drop.") }
	)),
	emptySelectionClipboard: register(new EditorEmptySelectionClipboard()),
	extraEditorClassName: register(new EditorStringOption(
		EditorOption.extraEditorClassName, 'extraEditorClassName', '',
	)),
	fastScrollSensitivity: register(new EditorFloatOption(
		EditorOption.fastScrollSensitivity, 'fastScrollSensitivity',
		5, x => (x <= 0 ? 5 : x),
		{ markdownDescription: nls.localize('fastScrollSensitivity', "Scrolling speed multiplier when pressing `Alt`.") }
	)),
	find: register(new EditorFind()),
	fixedOverflowWidgets: register(new EditorBooleanOption(
		EditorOption.fixedOverflowWidgets, 'fixedOverflowWidgets', false,
	)),
	folding: register(new EditorBooleanOption(
		EditorOption.folding, 'folding', true,
		{ description: nls.localize('folding', "Controls whether the editor has code folding enabled.") }
	)),
	foldingStrategy: register(new EditorStringEnumOption(
		EditorOption.foldingStrategy, 'foldingStrategy',
		'auto' as 'auto' | 'indentation',
		['auto', 'indentation'] as const,
		{
			enumDescriptions: [
				nls.localize('foldingStrategy.auto', "Use a language-specific folding strategy if available, else the indentation-based one."),
				nls.localize('foldingStrategy.indentation', "Use the indentation-based folding strategy."),
			],
			description: nls.localize('foldingStrategy', "Controls the strategy for computing folding ranges.")
		}
	)),
	foldingHighlight: register(new EditorBooleanOption(
		EditorOption.foldingHighlight, 'foldingHighlight', true,
		{ description: nls.localize('foldingHighlight', "Controls whether the editor should highlight folded ranges.") }
	)),
	unfoldOnClickAfterEndOfLine: register(new EditorBooleanOption(
		EditorOption.unfoldOnClickAfterEndOfLine, 'unfoldOnClickAfterEndOfLine', false,
		{ description: nls.localize('unfoldOnClickAfterEndOfLine', "Controls whether clicking on the empty content after a folded line will unfold the line.") }
	)),
	fontFamily: register(new EditorStringOption(
		EditorOption.fontFamily, 'fontFamily', EDITOR_FONT_DEFAULTS.fontFamily,
		{ description: nls.localize('fontFamily', "Controls the font family.") }
	)),
	fontInfo: register(new EditorFontInfo()),
	fontLigatures2: register(new EditorFontLigatures()),
	fontSize: register(new EditorFontSize()),
	fontWeight: register(new EditorFontWeight()),
	formatOnPaste: register(new EditorBooleanOption(
		EditorOption.formatOnPaste, 'formatOnPaste', false,
		{ description: nls.localize('formatOnPaste', "Controls whether the editor should automatically format the pasted content. A formatter must be available and the formatter should be able to format a range in a document.") }
	)),
	formatOnType: register(new EditorBooleanOption(
		EditorOption.formatOnType, 'formatOnType', false,
		{ description: nls.localize('formatOnType', "Controls whether the editor should automatically format the line after typing.") }
	)),
	glyphMargin: register(new EditorBooleanOption(
		EditorOption.glyphMargin, 'glyphMargin', true,
		{ description: nls.localize('glyphMargin', "Controls whether the editor should render the vertical glyph margin. Glyph margin is mostly used for debugging.") }
	)),
	gotoLocation: register(new EditorGoToLocation()),
	hideCursorInOverviewRuler: register(new EditorBooleanOption(
		EditorOption.hideCursorInOverviewRuler, 'hideCursorInOverviewRuler', false,
		{ description: nls.localize('hideCursorInOverviewRuler', "Controls whether the cursor should be hidden in the overview ruler.") }
	)),
	highlightActiveIndentGuide: register(new EditorBooleanOption(
		EditorOption.highlightActiveIndentGuide, 'highlightActiveIndentGuide', true,
		{ description: nls.localize('highlightActiveIndentGuide', "Controls whether the editor should highlight the active indent guide.") }
	)),
	hover: register(new EditorHover()),
	inDiffEditor: register(new EditorBooleanOption(
		EditorOption.inDiffEditor, 'inDiffEditor', false
	)),
	letterSpacing: register(new EditorFloatOption(
		EditorOption.letterSpacing, 'letterSpacing',
		EDITOR_FONT_DEFAULTS.letterSpacing, x => EditorFloatOption.clamp(x, -5, 20),
		{ description: nls.localize('letterSpacing', "Controls the letter spacing in pixels.") }
	)),
	lightbulb: register(new EditorLightbulb()),
	lineDecorationsWidth: register(new SimpleEditorOption(EditorOption.lineDecorationsWidth, 'lineDecorationsWidth', 10 as number | string)),
	lineHeight: register(new EditorLineHeight()),
	lineNumbers: register(new EditorRenderLineNumbersOption()),
	lineNumbersMinChars: register(new EditorIntOption(
		EditorOption.lineNumbersMinChars, 'lineNumbersMinChars',
		5, 1, 300
	)),
	linkedEditing: register(new EditorBooleanOption(
		EditorOption.linkedEditing, 'linkedEditing', false,
		{ description: nls.localize('linkedEditing', "Controls whether the editor has linked editing enabled. Depending on the language, related symbols, e.g. HTML tags, are updated while editing.") }
	)),
	links: register(new EditorBooleanOption(
		EditorOption.links, 'links', true,
		{ description: nls.localize('links', "Controls whether the editor should detect links and make them clickable.") }
	)),
	matchBrackets: register(new EditorStringEnumOption(
		EditorOption.matchBrackets, 'matchBrackets',
		'always' as 'never' | 'near' | 'always',
		['always', 'near', 'never'] as const,
		{ description: nls.localize('matchBrackets', "Highlight matching brackets.") }
	)),
	minimap: register(new EditorMinimap()),
	mouseStyle: register(new EditorStringEnumOption(
		EditorOption.mouseStyle, 'mouseStyle',
		'text' as 'text' | 'default' | 'copy',
		['text', 'default', 'copy'] as const,
	)),
	mouseWheelScrollSensitivity: register(new EditorFloatOption(
		EditorOption.mouseWheelScrollSensitivity, 'mouseWheelScrollSensitivity',
		1, x => (x === 0 ? 1 : x),
		{ markdownDescription: nls.localize('mouseWheelScrollSensitivity', "A multiplier to be used on the `deltaX` and `deltaY` of mouse wheel scroll events.") }
	)),
	mouseWheelZoom: register(new EditorBooleanOption(
		EditorOption.mouseWheelZoom, 'mouseWheelZoom', false,
		{ markdownDescription: nls.localize('mouseWheelZoom', "Zoom the font of the editor when using mouse wheel and holding `Ctrl`.") }
	)),
	multiCursorMergeOverlapping: register(new EditorBooleanOption(
		EditorOption.multiCursorMergeOverlapping, 'multiCursorMergeOverlapping', true,
		{ description: nls.localize('multiCursorMergeOverlapping', "Merge multiple cursors when they are overlapping.") }
	)),
	multiCursorModifier: register(new EditorEnumOption(
		EditorOption.multiCursorModifier, 'multiCursorModifier',
		'altKey', 'alt',
		['ctrlCmd', 'alt'],
		_multiCursorModifierFromString,
		{
			markdownEnumDescriptions: [
				nls.localize('multiCursorModifier.ctrlCmd', "Maps to `Control` on Windows and Linux and to `Command` on macOS."),
				nls.localize('multiCursorModifier.alt', "Maps to `Alt` on Windows and Linux and to `Option` on macOS.")
			],
			markdownDescription: nls.localize({
				key: 'multiCursorModifier',
				comment: [
					'- `ctrlCmd` refers to a value the setting can take and should not be localized.',
					'- `Control` and `Command` refer to the modifier keys Ctrl or Cmd on the keyboard and can be localized.'
				]
			}, "The modifier to be used to add multiple cursors with the mouse. The Go To Definition and Open Link mouse gestures will adapt such that they do not conflict with the multicursor modifier. [Read more](https://code.visualstudio.com/docs/editor/codebasics#_multicursor-modifier).")
		}
	)),
	multiCursorPaste: register(new EditorStringEnumOption(
		EditorOption.multiCursorPaste, 'multiCursorPaste',
		'spread' as 'spread' | 'full',
		['spread', 'full'] as const,
		{
			markdownEnumDescriptions: [
				nls.localize('multiCursorPaste.spread', "Each cursor pastes a single line of the text."),
				nls.localize('multiCursorPaste.full', "Each cursor pastes the full text.")
			],
			markdownDescription: nls.localize('multiCursorPaste', "Controls pasting when the line count of the pasted text matches the cursor count.")
		}
	)),
	occurrencesHighlight: register(new EditorBooleanOption(
		EditorOption.occurrencesHighlight, 'occurrencesHighlight', true,
		{ description: nls.localize('occurrencesHighlight', "Controls whether the editor should highlight semantic symbol occurrences.") }
	)),
	overviewRulerBorder: register(new EditorBooleanOption(
		EditorOption.overviewRulerBorder, 'overviewRulerBorder', true,
		{ description: nls.localize('overviewRulerBorder', "Controls whether a border should be drawn around the overview ruler.") }
	)),
	overviewRulerLanes: register(new EditorIntOption(
		EditorOption.overviewRulerLanes, 'overviewRulerLanes',
		3, 0, 3
	)),
	padding: register(new EditorPadding()),
	parameterHints: register(new EditorParameterHints()),
	peekWidgetDefaultFocus: register(new EditorStringEnumOption(
		EditorOption.peekWidgetDefaultFocus, 'peekWidgetDefaultFocus',
		'tree' as 'tree' | 'editor',
		['tree', 'editor'] as const,
		{
			enumDescriptions: [
				nls.localize('peekWidgetDefaultFocus.tree', "Focus the tree when opening peek"),
				nls.localize('peekWidgetDefaultFocus.editor', "Focus the editor when opening peek")
			],
			description: nls.localize('peekWidgetDefaultFocus', "Controls whether to focus the inline editor or the tree in the peek widget.")
		}
	)),
	definitionLinkOpensInPeek: register(new EditorBooleanOption(
		EditorOption.definitionLinkOpensInPeek, 'definitionLinkOpensInPeek', false,
		{ description: nls.localize('definitionLinkOpensInPeek', "Controls whether the Go to Definition mouse gesture always opens the peek widget.") }
	)),
	quickSuggestions: register(new EditorQuickSuggestions()),
	quickSuggestionsDelay: register(new EditorIntOption(
		EditorOption.quickSuggestionsDelay, 'quickSuggestionsDelay',
		10, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{ description: nls.localize('quickSuggestionsDelay', "Controls the delay in milliseconds after which quick suggestions will show up.") }
	)),
	readOnly: register(new EditorBooleanOption(
		EditorOption.readOnly, 'readOnly', false,
	)),
	renameOnType: register(new EditorBooleanOption(
		EditorOption.renameOnType, 'renameOnType', false,
		{ description: nls.localize('renameOnType', "Controls whether the editor auto renames on type."), markdownDeprecationMessage: nls.localize('renameOnTypeDeprecate', "Deprecated, use `editor.linkedEditing` instead.") }
	)),
	renderControlCharacters: register(new EditorBooleanOption(
		EditorOption.renderControlCharacters, 'renderControlCharacters', false,
		{ description: nls.localize('renderControlCharacters', "Controls whether the editor should render control characters.") }
	)),
	renderIndentGuides: register(new EditorBooleanOption(
		EditorOption.renderIndentGuides, 'renderIndentGuides', true,
		{ description: nls.localize('renderIndentGuides', "Controls whether the editor should render indent guides.") }
	)),
	renderFinalNewline: register(new EditorBooleanOption(
		EditorOption.renderFinalNewline, 'renderFinalNewline', true,
		{ description: nls.localize('renderFinalNewline', "Render last line number when the file ends with a newline.") }
	)),
	renderLineHighlight: register(new EditorStringEnumOption(
		EditorOption.renderLineHighlight, 'renderLineHighlight',
		'line' as 'none' | 'gutter' | 'line' | 'all',
		['none', 'gutter', 'line', 'all'] as const,
		{
			enumDescriptions: [
				'',
				'',
				'',
				nls.localize('renderLineHighlight.all', "Highlights both the gutter and the current line."),
			],
			description: nls.localize('renderLineHighlight', "Controls how the editor should render the current line highlight.")
		}
	)),
	renderLineHighlightOnlyWhenFocus: register(new EditorBooleanOption(
		EditorOption.renderLineHighlightOnlyWhenFocus, 'renderLineHighlightOnlyWhenFocus', false,
		{ description: nls.localize('renderLineHighlightOnlyWhenFocus', "Controls if the editor should render the current line highlight only when the editor is focused.") }
	)),
	renderValidationDecorations: register(new EditorStringEnumOption(
		EditorOption.renderValidationDecorations, 'renderValidationDecorations',
		'editable' as 'editable' | 'on' | 'off',
		['editable', 'on', 'off'] as const
	)),
	renderWhitespace: register(new EditorStringEnumOption(
		EditorOption.renderWhitespace, 'renderWhitespace',
		'selection' as 'selection' | 'none' | 'boundary' | 'trailing' | 'all',
		['none', 'boundary', 'selection', 'trailing', 'all'] as const,
		{
			enumDescriptions: [
				'',
				nls.localize('renderWhitespace.boundary', "Render whitespace characters except for single spaces between words."),
				nls.localize('renderWhitespace.selection', "Render whitespace characters only on selected text."),
				nls.localize('renderWhitespace.trailing', "Render only trailing whitespace characters."),
				''
			],
			description: nls.localize('renderWhitespace', "Controls how the editor should render whitespace characters.")
		}
	)),
	revealHorizontalRightPadding: register(new EditorIntOption(
		EditorOption.revealHorizontalRightPadding, 'revealHorizontalRightPadding',
		30, 0, 1000,
	)),
	roundedSelection: register(new EditorBooleanOption(
		EditorOption.roundedSelection, 'roundedSelection', true,
		{ description: nls.localize('roundedSelection', "Controls whether selections should have rounded corners.") }
	)),
	rulers: register(new EditorRulers()),
	scrollbar: register(new EditorScrollbar()),
	scrollBeyondLastColumn: register(new EditorIntOption(
		EditorOption.scrollBeyondLastColumn, 'scrollBeyondLastColumn',
		5, 0, Constants.MAX_SAFE_SMALL_INTEGER,
		{ description: nls.localize('scrollBeyondLastColumn', "Controls the number of extra characters beyond which the editor will scroll horizontally.") }
	)),
	scrollBeyondLastLine: register(new EditorBooleanOption(
		EditorOption.scrollBeyondLastLine, 'scrollBeyondLastLine', true,
		{ description: nls.localize('scrollBeyondLastLine', "Controls whether the editor will scroll beyond the last line.") }
	)),
	scrollPredominantAxis: register(new EditorBooleanOption(
		EditorOption.scrollPredominantAxis, 'scrollPredominantAxis', true,
		{ description: nls.localize('scrollPredominantAxis', "Scroll only along the predominant axis when scrolling both vertically and horizontally at the same time. Prevents horizontal drift when scrolling vertically on a trackpad.") }
	)),
	selectionClipboard: register(new EditorBooleanOption(
		EditorOption.selectionClipboard, 'selectionClipboard', true,
		{
			description: nls.localize('selectionClipboard', "Controls whether the Linux primary clipboard should be supported."),
			included: platform.isLinux
		}
	)),
	selectionHighlight: register(new EditorBooleanOption(
		EditorOption.selectionHighlight, 'selectionHighlight', true,
		{ description: nls.localize('selectionHighlight', "Controls whether the editor should highlight matches similar to the selection.") }
	)),
	selectOnLineNumbers: register(new EditorBooleanOption(
		EditorOption.selectOnLineNumbers, 'selectOnLineNumbers', true,
	)),
	showFoldingControls: register(new EditorStringEnumOption(
		EditorOption.showFoldingControls, 'showFoldingControls',
		'mouseover' as 'always' | 'mouseover',
		['always', 'mouseover'] as const,
		{
			enumDescriptions: [
				nls.localize('showFoldingControls.always', "Always show the folding controls."),
				nls.localize('showFoldingControls.mouseover', "Only show the folding controls when the mouse is over the gutter."),
			],
			description: nls.localize('showFoldingControls', "Controls when the folding controls on the gutter are shown.")
		}
	)),
	showUnused: register(new EditorBooleanOption(
		EditorOption.showUnused, 'showUnused', true,
		{ description: nls.localize('showUnused', "Controls fading out of unused code.") }
	)),
	showDeprecated: register(new EditorBooleanOption(
		EditorOption.showDeprecated, 'showDeprecated', true,
		{ description: nls.localize('showDeprecated', "Controls strikethrough deprecated variables.") }
	)),
	inlayHints: register(new EditorInlayHints()),
	snippetSuggestions: register(new EditorStringEnumOption(
		EditorOption.snippetSuggestions, 'snippetSuggestions',
		'inline' as 'top' | 'bottom' | 'inline' | 'none',
		['top', 'bottom', 'inline', 'none'] as const,
		{
			enumDescriptions: [
				nls.localize('snippetSuggestions.top', "Show snippet suggestions on top of other suggestions."),
				nls.localize('snippetSuggestions.bottom', "Show snippet suggestions below other suggestions."),
				nls.localize('snippetSuggestions.inline', "Show snippets suggestions with other suggestions."),
				nls.localize('snippetSuggestions.none', "Do not show snippet suggestions."),
			],
			description: nls.localize('snippetSuggestions', "Controls whether snippets are shown with other suggestions and how they are sorted.")
		}
	)),
	smartSelect: register(new SmartSelect()),
	smoothScrolling: register(new EditorBooleanOption(
		EditorOption.smoothScrolling, 'smoothScrolling', false,
		{ description: nls.localize('smoothScrolling', "Controls whether the editor will scroll using an animation.") }
	)),
	stopRenderingLineAfter: register(new EditorIntOption(
		EditorOption.stopRenderingLineAfter, 'stopRenderingLineAfter',
		10000, -1, Constants.MAX_SAFE_SMALL_INTEGER,
	)),
	suggest: register(new EditorSuggest()),
	inlineSuggest: register(new InlineEditorSuggest()),
	suggestFontSize: register(new EditorIntOption(
		EditorOption.suggestFontSize, 'suggestFontSize',
		0, 0, 1000,
		{ markdownDescription: nls.localize('suggestFontSize', "Font size for the suggest widget. When set to `0`, the value of `#editor.fontSize#` is used.") }
	)),
	suggestLineHeight: register(new EditorIntOption(
		EditorOption.suggestLineHeight, 'suggestLineHeight',
		0, 0, 1000,
		{ markdownDescription: nls.localize('suggestLineHeight', "Line height for the suggest widget. When set to `0`, the value of `#editor.lineHeight#` is used. The minimum value is 8.") }
	)),
	suggestOnTriggerCharacters: register(new EditorBooleanOption(
		EditorOption.suggestOnTriggerCharacters, 'suggestOnTriggerCharacters', true,
		{ description: nls.localize('suggestOnTriggerCharacters', "Controls whether suggestions should automatically show up when typing trigger characters.") }
	)),
	suggestSelection: register(new EditorStringEnumOption(
		EditorOption.suggestSelection, 'suggestSelection',
		'recentlyUsed' as 'first' | 'recentlyUsed' | 'recentlyUsedByPrefix',
		['first', 'recentlyUsed', 'recentlyUsedByPrefix'] as const,
		{
			markdownEnumDescriptions: [
				nls.localize('suggestSelection.first', "Always select the first suggestion."),
				nls.localize('suggestSelection.recentlyUsed', "Select recent suggestions unless further typing selects one, e.g. `console.| -> console.log` because `log` has been completed recently."),
				nls.localize('suggestSelection.recentlyUsedByPrefix', "Select suggestions based on previous prefixes that have completed those suggestions, e.g. `co -> console` and `con -> const`."),
			],
			description: nls.localize('suggestSelection', "Controls how suggestions are pre-selected when showing the suggest list.")
		}
	)),
	tabCompletion: register(new EditorStringEnumOption(
		EditorOption.tabCompletion, 'tabCompletion',
		'off' as 'on' | 'off' | 'onlySnippets',
		['on', 'off', 'onlySnippets'] as const,
		{
			enumDescriptions: [
				nls.localize('tabCompletion.on', "Tab complete will insert the best matching suggestion when pressing tab."),
				nls.localize('tabCompletion.off', "Disable tab completions."),
				nls.localize('tabCompletion.onlySnippets', "Tab complete snippets when their prefix match. Works best when 'quickSuggestions' aren't enabled."),
			],
			description: nls.localize('tabCompletion', "Enables tab completions.")
		}
	)),
	tabIndex: register(new EditorIntOption(
		EditorOption.tabIndex, 'tabIndex',
		0, -1, Constants.MAX_SAFE_SMALL_INTEGER
	)),
	unusualLineTerminators: register(new EditorStringEnumOption(
		EditorOption.unusualLineTerminators, 'unusualLineTerminators',
		'prompt' as 'auto' | 'off' | 'prompt',
		['auto', 'off', 'prompt'] as const,
		{
			enumDescriptions: [
				nls.localize('unusualLineTerminators.auto', "Unusual line terminators are automatically removed."),
				nls.localize('unusualLineTerminators.off', "Unusual line terminators are ignored."),
				nls.localize('unusualLineTerminators.prompt', "Unusual line terminators prompt to be removed."),
			],
			description: nls.localize('unusualLineTerminators', "Remove unusual line terminators that might cause problems.")
		}
	)),
	useShadowDOM: register(new EditorBooleanOption(
		EditorOption.useShadowDOM, 'useShadowDOM', true
	)),
	useTabStops: register(new EditorBooleanOption(
		EditorOption.useTabStops, 'useTabStops', true,
		{ description: nls.localize('useTabStops', "Inserting and deleting whitespace follows tab stops.") }
	)),
	wordSeparators: register(new EditorStringOption(
		EditorOption.wordSeparators, 'wordSeparators', USUAL_WORD_SEPARATORS,
		{ description: nls.localize('wordSeparators', "Characters that will be used as word separators when doing word related navigations or operations.") }
	)),
	wordWrap: register(new EditorStringEnumOption(
		EditorOption.wordWrap, 'wordWrap',
		'off' as 'off' | 'on' | 'wordWrapColumn' | 'bounded',
		['off', 'on', 'wordWrapColumn', 'bounded'] as const,
		{
			markdownEnumDescriptions: [
				nls.localize('wordWrap.off', "Lines will never wrap."),
				nls.localize('wordWrap.on', "Lines will wrap at the viewport width."),
				nls.localize({
					key: 'wordWrap.wordWrapColumn',
					comment: [
						'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
					]
				}, "Lines will wrap at `#editor.wordWrapColumn#`."),
				nls.localize({
					key: 'wordWrap.bounded',
					comment: [
						'- viewport means the edge of the visible window size.',
						'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
					]
				}, "Lines will wrap at the minimum of viewport and `#editor.wordWrapColumn#`."),
			],
			description: nls.localize({
				key: 'wordWrap',
				comment: [
					'- \'off\', \'on\', \'wordWrapColumn\' and \'bounded\' refer to values the setting can take and should not be localized.',
					'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
				]
			}, "Controls how lines should wrap.")
		}
	)),
	wordWrapBreakAfterCharacters: register(new EditorStringOption(
		EditorOption.wordWrapBreakAfterCharacters, 'wordWrapBreakAfterCharacters',
		' \t})]?|/&.,;¢°′″‰℃、。｡､￠，．：；？！％・･ゝゞヽヾーァィゥェォッャュョヮヵヶぁぃぅぇぉっゃゅょゎゕゖㇰㇱㇲㇳㇴㇵㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ々〻ｧｨｩｪｫｬｭｮｯｰ”〉》」』】〕）］｝｣',
	)),
	wordWrapBreakBeforeCharacters: register(new EditorStringOption(
		EditorOption.wordWrapBreakBeforeCharacters, 'wordWrapBreakBeforeCharacters',
		'([{‘“〈《「『【〔（［｛｢£¥＄￡￥+＋'
	)),
	wordWrapColumn: register(new EditorIntOption(
		EditorOption.wordWrapColumn, 'wordWrapColumn',
		80, 1, Constants.MAX_SAFE_SMALL_INTEGER,
		{
			markdownDescription: nls.localize({
				key: 'wordWrapColumn',
				comment: [
					'- `editor.wordWrap` refers to a different setting and should not be localized.',
					'- \'wordWrapColumn\' and \'bounded\' refer to values the different setting can take and should not be localized.'
				]
			}, "Controls the wrapping column of the editor when `#editor.wordWrap#` is `wordWrapColumn` or `bounded`.")
		}
	)),
	wordWrapOverride1: register(new EditorStringEnumOption(
		EditorOption.wordWrapOverride1, 'wordWrapOverride1',
		'inherit' as 'off' | 'on' | 'inherit',
		['off', 'on', 'inherit'] as const
	)),
	wordWrapOverride2: register(new EditorStringEnumOption(
		EditorOption.wordWrapOverride2, 'wordWrapOverride2',
		'inherit' as 'off' | 'on' | 'inherit',
		['off', 'on', 'inherit'] as const
	)),
	wrappingIndent: register(new EditorEnumOption(
		EditorOption.wrappingIndent, 'wrappingIndent',
		WrappingIndent.Same, 'same',
		['none', 'same', 'indent', 'deepIndent'],
		_wrappingIndentFromString,
		{
			enumDescriptions: [
				nls.localize('wrappingIndent.none', "No indentation. Wrapped lines begin at column 1."),
				nls.localize('wrappingIndent.same', "Wrapped lines get the same indentation as the parent."),
				nls.localize('wrappingIndent.indent', "Wrapped lines get +1 indentation toward the parent."),
				nls.localize('wrappingIndent.deepIndent', "Wrapped lines get +2 indentation toward the parent."),
			],
			description: nls.localize('wrappingIndent', "Controls the indentation of wrapped lines."),
		}
	)),
	wrappingStrategy: register(new EditorStringEnumOption(
		EditorOption.wrappingStrategy, 'wrappingStrategy',
		'simple' as 'simple' | 'advanced',
		['simple', 'advanced'] as const,
		{
			enumDescriptions: [
				nls.localize('wrappingStrategy.simple', "Assumes that all characters are of the same width. This is a fast algorithm that works correctly for monospace fonts and certain scripts (like Latin characters) where glyphs are of equal width."),
				nls.localize('wrappingStrategy.advanced', "Delegates wrapping points computation to the browser. This is a slow algorithm, that might cause freezes for large files, but it works correctly in all cases.")
			],
			description: nls.localize('wrappingStrategy', "Controls the algorithm that computes wrapping points.")
		}
	)),

	// Leave these at the end (because they have dependencies!)
	editorClassName: register(new EditorClassName()),
	pixelRatio: register(new EditorPixelRatio()),
	tabFocusMode: register(new EditorTabFocusMode()),
	layoutInfo: register(new EditorLayoutInfoComputer()),
	wrappingInfo: register(new EditorWrappingInfoComputer())
};

type EditorOptionsType = typeof EditorOptions;
type FindEditorOptionsKeyById<T extends EditorOption> = { [K in keyof EditorOptionsType]: EditorOptionsType[K]['id'] extends T ? K : never }[keyof EditorOptionsType];
type ComputedEditorOptionValue<T extends IEditorOption<any, any>> = T extends IEditorOption<any, infer R> ? R : never;
export type FindComputedEditorOptionValueById<T extends EditorOption> = NonNullable<ComputedEditorOptionValue<EditorOptionsType[FindEditorOptionsKeyById<T>]>>;
