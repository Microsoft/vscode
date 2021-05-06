/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./textAreaHandler';
import * as nls from 'vs/nls';
import * as browser from 'vs/base/browser/browser';
import { FastDomNode, createFastDomNode } from 'vs/base/browser/fastDomNode';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import * as platform from 'vs/base/common/platform';
import * as strings from 'vs/base/common/strings';
import { Configuration } from 'vs/editor/browser/config/configuration';
import { CopyOptions, ICompositionData, IPasteData, ITextAreaInputHost, TextAreaInput, ClipboardDataToCopy } from 'vs/editor/browser/controller/textAreaInput';
import { ISimpleModel, ITypeData, PagedScreenReaderStrategy, TextAreaState, _debugComposition } from 'vs/editor/browser/controller/textAreaState';
import { ViewController } from 'vs/editor/browser/view/viewController';
import { PartFingerprint, PartFingerprints, ViewPart } from 'vs/editor/browser/view/viewPart';
import { LineNumbersOverlay } from 'vs/editor/browser/viewParts/lineNumbers/lineNumbers';
import { Margin } from 'vs/editor/browser/viewParts/margin/margin';
import { RenderLineNumbersType, EditorOption, IComputedEditorOptions, EditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { WordCharacterClass, getMapForWordSeparators } from 'vs/editor/common/controller/wordCharacterClassifier';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { EndOfLinePreference } from 'vs/editor/common/model';
import { RenderingContext, RestrictedRenderingContext, HorizontalPosition } from 'vs/editor/common/view/renderingContext';
import { ViewContext } from 'vs/editor/common/view/viewContext';
import * as viewEvents from 'vs/editor/common/view/viewEvents';
import { AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { IEditorAriaOptions } from 'vs/editor/browser/editorBrowser';
import { MOUSE_CURSOR_TEXT_CSS_CLASS_NAME } from 'vs/base/browser/ui/mouseCursor/mouseCursor';

export interface ITextAreaHandlerHelper {
	visibleRangeForPositionRelativeToEditor(lineNumber: number, column: number): HorizontalPosition | null;
}

class VisibleTextAreaData {
	_visibleTextAreaBrand: void;

	public readonly top: number;
	public readonly left: number;
	public readonly width: number;

	constructor(top: number, left: number, width: number) {
		this.top = top;
		this.left = left;
		this.width = width;
	}

	public setWidth(width: number): VisibleTextAreaData {
		return new VisibleTextAreaData(this.top, this.left, width);
	}
}

const canUseZeroSizeTextarea = (browser.isFirefox);

export class TextAreaHandler extends ViewPart {

	private readonly _viewController: ViewController;
	private readonly _viewHelper: ITextAreaHandlerHelper;
	private _scrollLeft: number;
	private _scrollTop: number;

	private _accessibilitySupport!: AccessibilitySupport;
	private _accessibilityPageSize!: number;
	private _contentLeft: number;
	private _contentWidth: number;
	private _contentHeight: number;
	private _fontInfo: BareFontInfo;
	private _lineHeight: number;
	private _emptySelectionClipboard: boolean;
	private _copyWithSyntaxHighlighting: boolean;

	/**
	 * Defined only when the text area is visible (composition case).
	 */
	private _visibleTextArea: VisibleTextAreaData | null;
	private _selections: Selection[];
	private _modelSelections: Selection[];

	/**
	 * The position at which the textarea was rendered.
	 * This is useful for hit-testing and determining the mouse position.
	 */
	private _lastRenderPosition: Position | null;

	public readonly textArea: FastDomNode<HTMLTextAreaElement>;
	public readonly textAreaCover: FastDomNode<HTMLElement>;
	private readonly _textAreaInput: TextAreaInput;

	constructor(context: ViewContext, viewController: ViewController, viewHelper: ITextAreaHandlerHelper) {
		super(context);

		this._viewController = viewController;
		this._viewHelper = viewHelper;
		this._scrollLeft = 0;
		this._scrollTop = 0;

		const options = this._context.configuration.options;
		const layoutInfo = options.get(EditorOption.layoutInfo);

		this._setAccessibilityOptions(options);
		this._contentLeft = layoutInfo.contentLeft;
		this._contentWidth = layoutInfo.contentWidth;
		this._contentHeight = layoutInfo.height;
		this._fontInfo = options.get(EditorOption.fontInfo);
		this._lineHeight = options.get(EditorOption.lineHeight);
		this._emptySelectionClipboard = options.get(EditorOption.emptySelectionClipboard);
		this._copyWithSyntaxHighlighting = options.get(EditorOption.copyWithSyntaxHighlighting);

		this._visibleTextArea = null;
		this._selections = [new Selection(1, 1, 1, 1)];
		this._modelSelections = [new Selection(1, 1, 1, 1)];
		this._lastRenderPosition = null;

		// Text Area (The focus will always be in the textarea when the cursor is blinking)
		this.textArea = createFastDomNode(document.createElement('textarea'));
		PartFingerprints.write(this.textArea, PartFingerprint.TextArea);
		this.textArea.setClassName(`inputarea ${MOUSE_CURSOR_TEXT_CSS_CLASS_NAME}`);
		this.textArea.setAttribute('wrap', 'off');
		this.textArea.setAttribute('autocorrect', 'off');
		this.textArea.setAttribute('autocapitalize', 'off');
		this.textArea.setAttribute('autocomplete', 'off');
		this.textArea.setAttribute('spellcheck', 'false');
		this.textArea.setAttribute('aria-label', this._getAriaLabel(options));
		this.textArea.setAttribute('tabindex', String(options.get(EditorOption.tabIndex)));
		this.textArea.setAttribute('role', 'textbox');
		this.textArea.setAttribute('aria-roledescription', nls.localize('editor', "editor"));
		this.textArea.setAttribute('aria-multiline', 'true');
		this.textArea.setAttribute('aria-haspopup', 'false');
		this.textArea.setAttribute('aria-autocomplete', 'both');

		if (options.get(EditorOption.domReadOnly) && options.get(EditorOption.readOnly)) {
			this.textArea.setAttribute('readonly', 'true');
		}

		this.textAreaCover = createFastDomNode(document.createElement('div'));
		this.textAreaCover.setPosition('absolute');

		const simpleModel: ISimpleModel = {
			getLineCount: (): number => {
				return this._context.model.getLineCount();
			},
			getLineMaxColumn: (lineNumber: number): number => {
				return this._context.model.getLineMaxColumn(lineNumber);
			},
			getValueInRange: (range: Range, eol: EndOfLinePreference): string => {
				return this._context.model.getValueInRange(range, eol);
			}
		};

		const textAreaInputHost: ITextAreaInputHost = {
			getDataToCopy: (generateHTML: boolean): ClipboardDataToCopy => {
				const rawTextToCopy = this._context.model.getPlainTextToCopy(this._modelSelections, this._emptySelectionClipboard, platform.isWindows);
				const newLineCharacter = this._context.model.getEOL();

				const isFromEmptySelection = (this._emptySelectionClipboard && this._modelSelections.length === 1 && this._modelSelections[0].isEmpty());
				const multicursorText = (Array.isArray(rawTextToCopy) ? rawTextToCopy : null);
				const text = (Array.isArray(rawTextToCopy) ? rawTextToCopy.join(newLineCharacter) : rawTextToCopy);

				let html: string | null | undefined = undefined;
				let mode: string | null = null;
				if (generateHTML) {
					if (CopyOptions.forceCopyWithSyntaxHighlighting || (this._copyWithSyntaxHighlighting && text.length < 65536)) {
						const richText = this._context.model.getRichTextToCopy(this._modelSelections, this._emptySelectionClipboard);
						if (richText) {
							html = richText.html;
							mode = richText.mode;
						}
					}
				}
				return {
					isFromEmptySelection,
					multicursorText,
					text,
					html,
					mode
				};
			},
			getScreenReaderContent: (currentState: TextAreaState): TextAreaState => {
				if (this._accessibilitySupport === AccessibilitySupport.Disabled) {
					// We know for a fact that a screen reader is not attached
					// On OSX, we write the character before the cursor to allow for "long-press" composition
					// Also on OSX, we write the word before the cursor to allow for the Accessibility Keyboard to give good hints
					if (platform.isMacintosh) {
						const selection = this._selections[0];
						if (selection.isEmpty()) {
							const position = selection.getStartPosition();

							let textBefore = this._getWordBeforePosition(position);
							if (textBefore.length === 0) {
								textBefore = this._getCharacterBeforePosition(position);
							}

							if (textBefore.length > 0) {
								return new TextAreaState(textBefore, textBefore.length, textBefore.length, position, position);
							}
						}
					}
					return TextAreaState.EMPTY;
				}

				if (browser.isAndroid) {
					// when tapping in the editor on a word, Android enters composition mode.
					// in the `compositionstart` event we cannot clear the textarea, because
					// it then forgets to ever send a `compositionend`.
					// we therefore only write the current word in the textarea
					const selection = this._selections[0];
					if (selection.isEmpty()) {
						const position = selection.getStartPosition();
						const [wordAtPosition, positionOffsetInWord] = this._getAndroidWordAtPosition(position);
						if (wordAtPosition.length > 0) {
							return new TextAreaState(wordAtPosition, positionOffsetInWord, positionOffsetInWord, position, position);
						}
					}
					return TextAreaState.EMPTY;
				}

				return PagedScreenReaderStrategy.fromEditorSelection(currentState, simpleModel, this._selections[0], this._accessibilityPageSize, this._accessibilitySupport === AccessibilitySupport.Unknown);
			},

			deduceModelPosition: (viewAnchorPosition: Position, deltaOffset: number, lineFeedCnt: number): Position => {
				return this._context.model.deduceModelPositionRelativeToViewPosition(viewAnchorPosition, deltaOffset, lineFeedCnt);
			}
		};

		this._textAreaInput = this._register(new TextAreaInput(textAreaInputHost, this.textArea));

		this._register(this._textAreaInput.onKeyDown((e: IKeyboardEvent) => {
			this._viewController.emitKeyDown(e);
		}));

		this._register(this._textAreaInput.onKeyUp((e: IKeyboardEvent) => {
			this._viewController.emitKeyUp(e);
		}));

		this._register(this._textAreaInput.onPaste((e: IPasteData) => {
			let pasteOnNewLine = false;
			let multicursorText: string[] | null = null;
			let mode: string | null = null;
			if (e.metadata) {
				pasteOnNewLine = (this._emptySelectionClipboard && !!e.metadata.isFromEmptySelection);
				multicursorText = (typeof e.metadata.multicursorText !== 'undefined' ? e.metadata.multicursorText : null);
				mode = e.metadata.mode;
			}
			this._viewController.paste(e.text, pasteOnNewLine, multicursorText, mode);
		}));

		this._register(this._textAreaInput.onCut(() => {
			this._viewController.cut();
		}));

		this._register(this._textAreaInput.onType((e: ITypeData) => {
			if (e.replacePrevCharCnt || e.replaceNextCharCnt || e.positionDelta) {
				// must be handled through the new command
				if (_debugComposition) {
					console.log(` => compositionType: <<${e.text}>>, ${e.replacePrevCharCnt}, ${e.replaceNextCharCnt}, ${e.positionDelta}`);
				}
				this._viewController.compositionType(e.text, e.replacePrevCharCnt, e.replaceNextCharCnt, e.positionDelta);
			} else {
				if (_debugComposition) {
					console.log(` => type: <<${e.text}>>`);
				}
				this._viewController.type(e.text);
			}
		}));

		this._register(this._textAreaInput.onSelectionChangeRequest((modelSelection: Selection) => {
			this._viewController.setSelection(modelSelection);
		}));

		this._register(this._textAreaInput.onCompositionStart((e) => {
			const lineNumber = this._selections[0].startLineNumber;
			const column = this._selections[0].startColumn + e.revealDeltaColumns;

			this._context.model.revealRange(
				'keyboard',
				true,
				new Range(lineNumber, column, lineNumber, column),
				viewEvents.VerticalRevealType.Simple,
				ScrollType.Immediate
			);

			// Find range pixel position
			const visibleRange = this._viewHelper.visibleRangeForPositionRelativeToEditor(lineNumber, column);

			if (visibleRange) {
				this._visibleTextArea = new VisibleTextAreaData(
					this._context.viewLayout.getVerticalOffsetForLineNumber(lineNumber),
					visibleRange.left,
					canUseZeroSizeTextarea ? 0 : 1
				);
				this._render();
			}

			// Show the textarea
			this.textArea.setClassName(`inputarea ${MOUSE_CURSOR_TEXT_CSS_CLASS_NAME} ime-input`);

			this._viewController.compositionStart();
			this._context.model.onCompositionStart();
		}));

		this._register(this._textAreaInput.onCompositionUpdate((e: ICompositionData) => {
			if (!this._visibleTextArea) {
				return;
			}
			// adjust width by its size
			this._visibleTextArea = this._visibleTextArea.setWidth(measureText(e.data, this._fontInfo));
			this._render();
		}));

		this._register(this._textAreaInput.onCompositionEnd(() => {

			this._visibleTextArea = null;
			this._render();

			this.textArea.setClassName(`inputarea ${MOUSE_CURSOR_TEXT_CSS_CLASS_NAME}`);
			this._viewController.compositionEnd();
			this._context.model.onCompositionEnd();
		}));

		this._register(this._textAreaInput.onFocus(() => {
			this._context.model.setHasFocus(true);
		}));

		this._register(this._textAreaInput.onBlur(() => {
			this._context.model.setHasFocus(false);
		}));
	}

	public override dispose(): void {
		super.dispose();
	}

	private _getAndroidWordAtPosition(position: Position): [string, number] {
		const ANDROID_WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:",.<>/?';
		const lineContent = this._context.model.getLineContent(position.lineNumber);
		const wordSeparators = getMapForWordSeparators(ANDROID_WORD_SEPARATORS);

		let goingLeft = true;
		let startColumn = position.column;
		let goingRight = true;
		let endColumn = position.column;
		let distance = 0;
		while (distance < 50 && (goingLeft || goingRight)) {
			if (goingLeft && startColumn <= 1) {
				goingLeft = false;
			}
			if (goingLeft) {
				const charCode = lineContent.charCodeAt(startColumn - 2);
				const charClass = wordSeparators.get(charCode);
				if (charClass !== WordCharacterClass.Regular) {
					goingLeft = false;
				} else {
					startColumn--;
				}
			}
			if (goingRight && endColumn > lineContent.length) {
				goingRight = false;
			}
			if (goingRight) {
				const charCode = lineContent.charCodeAt(endColumn - 1);
				const charClass = wordSeparators.get(charCode);
				if (charClass !== WordCharacterClass.Regular) {
					goingRight = false;
				} else {
					endColumn++;
				}
			}
			distance++;
		}

		return [lineContent.substring(startColumn - 1, endColumn - 1), position.column - startColumn];
	}

	private _getWordBeforePosition(position: Position): string {
		const lineContent = this._context.model.getLineContent(position.lineNumber);
		const wordSeparators = getMapForWordSeparators(this._context.configuration.options.get(EditorOption.wordSeparators));

		let column = position.column;
		let distance = 0;
		while (column > 1) {
			const charCode = lineContent.charCodeAt(column - 2);
			const charClass = wordSeparators.get(charCode);
			if (charClass !== WordCharacterClass.Regular || distance > 50) {
				return lineContent.substring(column - 1, position.column - 1);
			}
			distance++;
			column--;
		}
		return lineContent.substring(0, position.column - 1);
	}

	private _getCharacterBeforePosition(position: Position): string {
		if (position.column > 1) {
			const lineContent = this._context.model.getLineContent(position.lineNumber);
			const charBefore = lineContent.charAt(position.column - 2);
			if (!strings.isHighSurrogate(charBefore.charCodeAt(0))) {
				return charBefore;
			}
		}
		return '';
	}

	private _getAriaLabel(options: IComputedEditorOptions): string {
		const accessibilitySupport = options.get(EditorOption.accessibilitySupport);
		if (accessibilitySupport === AccessibilitySupport.Disabled) {
			return nls.localize('accessibilityOffAriaLabel', "The editor is not accessible at this time. Press {0} for options.", platform.isLinux ? 'Shift+Alt+F1' : 'Alt+F1');
		}
		return options.get(EditorOption.ariaLabel);
	}

	private _setAccessibilityOptions(options: IComputedEditorOptions): void {
		this._accessibilitySupport = options.get(EditorOption.accessibilitySupport);
		const accessibilityPageSize = options.get(EditorOption.accessibilityPageSize);
		if (this._accessibilitySupport === AccessibilitySupport.Enabled && accessibilityPageSize === EditorOptions.accessibilityPageSize.defaultValue) {
			// If a screen reader is attached and the default value is not set we shuold automatically increase the page size to 500 for a better experience
			this._accessibilityPageSize = 500;
		} else {
			this._accessibilityPageSize = accessibilityPageSize;
		}
	}

	// --- begin event handlers

	public override onConfigurationChanged(e: viewEvents.ViewConfigurationChangedEvent): boolean {
		const options = this._context.configuration.options;
		const layoutInfo = options.get(EditorOption.layoutInfo);

		this._setAccessibilityOptions(options);
		this._contentLeft = layoutInfo.contentLeft;
		this._contentWidth = layoutInfo.contentWidth;
		this._contentHeight = layoutInfo.height;
		this._fontInfo = options.get(EditorOption.fontInfo);
		this._lineHeight = options.get(EditorOption.lineHeight);
		this._emptySelectionClipboard = options.get(EditorOption.emptySelectionClipboard);
		this._copyWithSyntaxHighlighting = options.get(EditorOption.copyWithSyntaxHighlighting);
		this.textArea.setAttribute('aria-label', this._getAriaLabel(options));
		this.textArea.setAttribute('tabindex', String(options.get(EditorOption.tabIndex)));

		if (e.hasChanged(EditorOption.domReadOnly) || e.hasChanged(EditorOption.readOnly)) {
			if (options.get(EditorOption.domReadOnly) && options.get(EditorOption.readOnly)) {
				this.textArea.setAttribute('readonly', 'true');
			} else {
				this.textArea.removeAttribute('readonly');
			}
		}

		if (e.hasChanged(EditorOption.accessibilitySupport)) {
			this._textAreaInput.writeScreenReaderContent('strategy changed');
		}

		return true;
	}
	public override onCursorStateChanged(e: viewEvents.ViewCursorStateChangedEvent): boolean {
		this._selections = e.selections.slice(0);
		this._modelSelections = e.modelSelections.slice(0);
		this._textAreaInput.writeScreenReaderContent('selection changed');
		return true;
	}
	public override onDecorationsChanged(e: viewEvents.ViewDecorationsChangedEvent): boolean {
		// true for inline decorations that can end up relayouting text
		return true;
	}
	public override onFlushed(e: viewEvents.ViewFlushedEvent): boolean {
		return true;
	}
	public override onLinesChanged(e: viewEvents.ViewLinesChangedEvent): boolean {
		return true;
	}
	public override onLinesDeleted(e: viewEvents.ViewLinesDeletedEvent): boolean {
		return true;
	}
	public override onLinesInserted(e: viewEvents.ViewLinesInsertedEvent): boolean {
		return true;
	}
	public override onScrollChanged(e: viewEvents.ViewScrollChangedEvent): boolean {
		this._scrollLeft = e.scrollLeft;
		this._scrollTop = e.scrollTop;
		return true;
	}
	public override onZonesChanged(e: viewEvents.ViewZonesChangedEvent): boolean {
		return true;
	}

	// --- end event handlers

	// --- begin view API

	public isFocused(): boolean {
		return this._textAreaInput.isFocused();
	}

	public focusTextArea(): void {
		this._textAreaInput.focusTextArea();
	}

	public refreshFocusState() {
		this._textAreaInput.refreshFocusState();
	}

	public getLastRenderData(): Position | null {
		return this._lastRenderPosition;
	}

	public setAriaOptions(options: IEditorAriaOptions): void {
		if (options.activeDescendant) {
			this.textArea.setAttribute('aria-haspopup', 'true');
			this.textArea.setAttribute('aria-autocomplete', 'list');
			this.textArea.setAttribute('aria-activedescendant', options.activeDescendant);
		} else {
			this.textArea.setAttribute('aria-haspopup', 'false');
			this.textArea.setAttribute('aria-autocomplete', 'both');
			this.textArea.removeAttribute('aria-activedescendant');
		}
		if (options.role) {
			this.textArea.setAttribute('role', options.role);
		}
	}

	// --- end view API

	private _primaryCursorPosition: Position = new Position(1, 1);
	private _primaryCursorVisibleRange: HorizontalPosition | null = null;

	public prepareRender(ctx: RenderingContext): void {
		this._primaryCursorPosition = new Position(this._selections[0].positionLineNumber, this._selections[0].positionColumn);
		this._primaryCursorVisibleRange = ctx.visibleRangeForPosition(this._primaryCursorPosition);
	}

	public render(ctx: RestrictedRenderingContext): void {
		this._textAreaInput.writeScreenReaderContent('render');
		this._render();
	}

	private _render(): void {
		if (this._visibleTextArea) {
			// The text area is visible for composition reasons
			this._renderInsideEditor(
				null,
				this._visibleTextArea.top - this._scrollTop,
				this._contentLeft + this._visibleTextArea.left - this._scrollLeft,
				this._visibleTextArea.width,
				this._lineHeight
			);
			return;
		}

		if (!this._primaryCursorVisibleRange) {
			// The primary cursor is outside the viewport => place textarea to the top left
			this._renderAtTopLeft();
			return;
		}

		const left = this._contentLeft + this._primaryCursorVisibleRange.left - this._scrollLeft;
		if (left < this._contentLeft || left > this._contentLeft + this._contentWidth) {
			// cursor is outside the viewport
			this._renderAtTopLeft();
			return;
		}

		const top = this._context.viewLayout.getVerticalOffsetForLineNumber(this._selections[0].positionLineNumber) - this._scrollTop;
		if (top < 0 || top > this._contentHeight) {
			// cursor is outside the viewport
			this._renderAtTopLeft();
			return;
		}

		// The primary cursor is in the viewport (at least vertically) => place textarea on the cursor

		if (platform.isMacintosh) {
			// For the popup emoji input, we will make the text area as high as the line height
			// We will also make the fontSize and lineHeight the correct dimensions to help with the placement of these pickers
			this._renderInsideEditor(
				this._primaryCursorPosition,
				top, left,
				canUseZeroSizeTextarea ? 0 : 1, this._lineHeight
			);
			return;
		}

		this._renderInsideEditor(
			this._primaryCursorPosition,
			top, left,
			canUseZeroSizeTextarea ? 0 : 1, canUseZeroSizeTextarea ? 0 : 1
		);
	}

	private _renderInsideEditor(renderedPosition: Position | null, top: number, left: number, width: number, height: number): void {
		this._lastRenderPosition = renderedPosition;
		const ta = this.textArea;
		const tac = this.textAreaCover;

		Configuration.applyFontInfo(ta, this._fontInfo);

		ta.setTop(top);
		ta.setLeft(left);
		ta.setWidth(width);
		ta.setHeight(height);

		tac.setTop(0);
		tac.setLeft(0);
		tac.setWidth(0);
		tac.setHeight(0);
	}

	private _renderAtTopLeft(): void {
		this._lastRenderPosition = null;
		const ta = this.textArea;
		const tac = this.textAreaCover;

		Configuration.applyFontInfo(ta, this._fontInfo);
		ta.setTop(0);
		ta.setLeft(0);
		tac.setTop(0);
		tac.setLeft(0);

		if (canUseZeroSizeTextarea) {
			ta.setWidth(0);
			ta.setHeight(0);
			tac.setWidth(0);
			tac.setHeight(0);
			return;
		}

		// (in WebKit the textarea is 1px by 1px because it cannot handle input to a 0x0 textarea)
		// specifically, when doing Korean IME, setting the textarea to 0x0 breaks IME badly.

		ta.setWidth(1);
		ta.setHeight(1);
		tac.setWidth(1);
		tac.setHeight(1);

		const options = this._context.configuration.options;

		if (options.get(EditorOption.glyphMargin)) {
			tac.setClassName('monaco-editor-background textAreaCover ' + Margin.OUTER_CLASS_NAME);
		} else {
			if (options.get(EditorOption.lineNumbers).renderType !== RenderLineNumbersType.Off) {
				tac.setClassName('monaco-editor-background textAreaCover ' + LineNumbersOverlay.CLASS_NAME);
			} else {
				tac.setClassName('monaco-editor-background textAreaCover');
			}
		}
	}
}

function measureText(text: string, fontInfo: BareFontInfo): number {
	// adjust width by its size
	const canvasElem = <HTMLCanvasElement>document.createElement('canvas');
	const context = canvasElem.getContext('2d')!;
	context.font = createFontString(fontInfo);
	const metrics = context.measureText(text);

	if (browser.isFirefox) {
		return metrics.width + 2; // +2 for Japanese...
	} else {
		return metrics.width;
	}
}

function createFontString(bareFontInfo: BareFontInfo): string {
	return doCreateFontString('normal', bareFontInfo.fontWeight, bareFontInfo.fontSize, bareFontInfo.lineHeight, bareFontInfo.fontFamily);
}

function doCreateFontString(fontStyle: string, fontWeight: string, fontSize: number, lineHeight: number, fontFamily: string): string {
	// The full font syntax is:
	// style | variant | weight | stretch | size/line-height | fontFamily
	// (https://developer.mozilla.org/en-US/docs/Web/CSS/font)
	// But it appears Edge and IE11 cannot properly parse `stretch`.
	return `${fontStyle} normal ${fontWeight} ${fontSize}px / ${lineHeight}px ${fontFamily}`;
}
