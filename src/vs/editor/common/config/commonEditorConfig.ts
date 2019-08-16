/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import * as platform from 'vs/base/common/platform';
import * as editorOptions from 'vs/editor/common/config/editorOptions';
import { EditorZoom } from 'vs/editor/common/config/editorZoom';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { ConfigurationScope, Extensions, IConfigurationNode, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import EDITOR_DEFAULTS = editorOptions.EDITOR_DEFAULTS;
import EDITOR_FONT_DEFAULTS = editorOptions.EDITOR_FONT_DEFAULTS;
import EDITOR_MODEL_DEFAULTS = editorOptions.EDITOR_MODEL_DEFAULTS;
import { AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';

/**
 * Control what pressing Tab does.
 * If it is false, pressing Tab or Shift-Tab will be handled by the editor.
 * If it is true, pressing Tab or Shift-Tab will move the browser focus.
 * Defaults to false.
 */
export interface ITabFocus {
	onDidChangeTabFocus: Event<boolean>;
	getTabFocusMode(): boolean;
	setTabFocusMode(tabFocusMode: boolean): void;
}

export const TabFocus: ITabFocus = new class implements ITabFocus {
	private _tabFocus: boolean = false;

	private readonly _onDidChangeTabFocus = new Emitter<boolean>();
	public readonly onDidChangeTabFocus: Event<boolean> = this._onDidChangeTabFocus.event;

	public getTabFocusMode(): boolean {
		return this._tabFocus;
	}

	public setTabFocusMode(tabFocusMode: boolean): void {
		if (this._tabFocus === tabFocusMode) {
			return;
		}

		this._tabFocus = tabFocusMode;
		this._onDidChangeTabFocus.fire(this._tabFocus);
	}
};

export interface IEnvConfiguration {
	extraEditorClassName: string;
	outerWidth: number;
	outerHeight: number;
	emptySelectionClipboard: boolean;
	pixelRatio: number;
	zoomLevel: number;
	accessibilitySupport: AccessibilitySupport;
}

const hasOwnProperty = Object.hasOwnProperty;

export abstract class CommonEditorConfiguration extends Disposable implements editorCommon.IConfiguration {

	public readonly isSimpleWidget: boolean;
	protected _rawOptions: editorOptions.IEditorOptions;
	protected _validatedOptions: editorOptions.IValidatedEditorOptions;
	public editor!: editorOptions.InternalEditorOptions;
	private _isDominatedByLongLines: boolean;
	private _lineNumbersDigitCount: number;

	private _onDidChange = this._register(new Emitter<editorOptions.IConfigurationChangedEvent>());
	public readonly onDidChange: Event<editorOptions.IConfigurationChangedEvent> = this._onDidChange.event;

	constructor(isSimpleWidget: boolean, options: editorOptions.IEditorOptions) {
		super();

		this.isSimpleWidget = isSimpleWidget;

		// Do a "deep clone of sorts" on the incoming options
		this._rawOptions = objects.mixin({}, options || {});
		this._rawOptions.scrollbar = objects.mixin({}, this._rawOptions.scrollbar || {});
		this._rawOptions.minimap = objects.mixin({}, this._rawOptions.minimap || {});
		this._rawOptions.find = objects.mixin({}, this._rawOptions.find || {});
		this._rawOptions.hover = objects.mixin({}, this._rawOptions.hover || {});
		this._rawOptions.parameterHints = objects.mixin({}, this._rawOptions.parameterHints || {});

		this._validatedOptions = editorOptions.EditorOptionsValidator.validate(this._rawOptions, EDITOR_DEFAULTS);
		this._isDominatedByLongLines = false;
		this._lineNumbersDigitCount = 1;

		this._register(EditorZoom.onDidChangeZoomLevel(_ => this._recomputeOptions()));
		this._register(TabFocus.onDidChangeTabFocus(_ => this._recomputeOptions()));
	}

	public observeReferenceElement(dimension?: editorCommon.IDimension): void {
	}

	public dispose(): void {
		super.dispose();
	}

	protected _recomputeOptions(): void {
		const oldOptions = this.editor;
		const newOptions = this._computeInternalOptions();

		if (oldOptions && oldOptions.equals(newOptions)) {
			return;
		}

		this.editor = newOptions;

		if (oldOptions) {
			this._onDidChange.fire(oldOptions.createChangeEvent(newOptions));
		}
	}

	public getRawOptions(): editorOptions.IEditorOptions {
		return this._rawOptions;
	}

	private _computeInternalOptions(): editorOptions.InternalEditorOptions {
		const opts = this._validatedOptions;
		const partialEnv = this._getEnvConfiguration();
		const bareFontInfo = BareFontInfo.createFromRawSettings(this._rawOptions, partialEnv.zoomLevel, this.isSimpleWidget);
		const env: editorOptions.IEnvironmentalOptions = {
			outerWidth: partialEnv.outerWidth,
			outerHeight: partialEnv.outerHeight,
			fontInfo: this.readConfiguration(bareFontInfo),
			extraEditorClassName: partialEnv.extraEditorClassName,
			isDominatedByLongLines: this._isDominatedByLongLines,
			lineNumbersDigitCount: this._lineNumbersDigitCount,
			emptySelectionClipboard: partialEnv.emptySelectionClipboard,
			pixelRatio: partialEnv.pixelRatio,
			tabFocusMode: TabFocus.getTabFocusMode(),
			accessibilitySupport: partialEnv.accessibilitySupport
		};
		return editorOptions.InternalEditorOptionsFactory.createInternalEditorOptions(env, opts);
	}

	private static _primitiveArrayEquals(a: any[], b: any[]): boolean {
		if (a.length !== b.length) {
			return false;
		}
		for (let i = 0; i < a.length; i++) {
			if (a[i] !== b[i]) {
				return false;
			}
		}
		return true;
	}

	private static _subsetEquals(base: { [key: string]: any }, subset: { [key: string]: any }): boolean {
		for (const key in subset) {
			if (hasOwnProperty.call(subset, key)) {
				const subsetValue = subset[key];
				const baseValue = base[key];

				if (baseValue === subsetValue) {
					continue;
				}
				if (Array.isArray(baseValue) && Array.isArray(subsetValue)) {
					if (!this._primitiveArrayEquals(baseValue, subsetValue)) {
						return false;
					}
					continue;
				}
				if (typeof baseValue === 'object' && typeof subsetValue === 'object') {
					if (!this._subsetEquals(baseValue, subsetValue)) {
						return false;
					}
					continue;
				}

				return false;
			}
		}
		return true;
	}

	public updateOptions(newOptions: editorOptions.IEditorOptions): void {
		if (typeof newOptions === 'undefined') {
			return;
		}
		if (CommonEditorConfiguration._subsetEquals(this._rawOptions, newOptions)) {
			return;
		}
		this._rawOptions = objects.mixin(this._rawOptions, newOptions || {});
		this._validatedOptions = editorOptions.EditorOptionsValidator.validate(this._rawOptions, EDITOR_DEFAULTS);
		this._recomputeOptions();
	}

	public setIsDominatedByLongLines(isDominatedByLongLines: boolean): void {
		this._isDominatedByLongLines = isDominatedByLongLines;
		this._recomputeOptions();
	}

	public setMaxLineNumber(maxLineNumber: number): void {
		let digitCount = CommonEditorConfiguration._digitCount(maxLineNumber);
		if (this._lineNumbersDigitCount === digitCount) {
			return;
		}
		this._lineNumbersDigitCount = digitCount;
		this._recomputeOptions();
	}

	private static _digitCount(n: number): number {
		let r = 0;
		while (n) {
			n = Math.floor(n / 10);
			r++;
		}
		return r ? r : 1;
	}
	protected abstract _getEnvConfiguration(): IEnvConfiguration;

	protected abstract readConfiguration(styling: BareFontInfo): FontInfo;

}

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
const editorConfiguration: IConfigurationNode = {
	'id': 'editor',
	'order': 5,
	'type': 'object',
	'title': nls.localize('editorConfigurationTitle', "Editor"),
	'overridable': true,
	'scope': ConfigurationScope.RESOURCE,
	'properties': {
		'editor.fontFamily': {
			'type': 'string',
			'default': EDITOR_FONT_DEFAULTS.fontFamily,
			'description': nls.localize('fontFamily', "Controls the font family.")
		},
		'editor.fontWeight': {
			'type': 'string',
			'enum': ['normal', 'bold', '100', '200', '300', '400', '500', '600', '700', '800', '900'],
			'default': EDITOR_FONT_DEFAULTS.fontWeight,
			'description': nls.localize('fontWeight', "Controls the font weight.")
		},
		'editor.fontSize': {
			'type': 'number',
			'default': EDITOR_FONT_DEFAULTS.fontSize,
			'description': nls.localize('fontSize', "Controls the font size in pixels.")
		},
		'editor.lineHeight': {
			'type': 'number',
			'default': EDITOR_FONT_DEFAULTS.lineHeight,
			'description': nls.localize('lineHeight', "Controls the line height. Use 0 to compute the line height from the font size.")
		},
		'editor.letterSpacing': {
			'type': 'number',
			'default': EDITOR_FONT_DEFAULTS.letterSpacing,
			'description': nls.localize('letterSpacing', "Controls the letter spacing in pixels.")
		},
		'editor.lineNumbers': {
			'type': 'string',
			'enum': ['off', 'on', 'relative', 'interval'],
			'enumDescriptions': [
				nls.localize('lineNumbers.off', "Line numbers are not rendered."),
				nls.localize('lineNumbers.on', "Line numbers are rendered as absolute number."),
				nls.localize('lineNumbers.relative', "Line numbers are rendered as distance in lines to cursor position."),
				nls.localize('lineNumbers.interval', "Line numbers are rendered every 10 lines.")
			],
			'default': 'on',
			'description': nls.localize('lineNumbers', "Controls the display of line numbers.")
		},
		'editor.cursorSurroundingLines': {
			'type': 'number',
			'default': EDITOR_DEFAULTS.viewInfo.cursorSurroundingLines,
			'description': nls.localize('cursorSurroundingLines', "Controls the minimal number of visible leading and trailing lines surrounding the cursor. Known as 'scrollOff' or `scrollOffset` in some other editors.")
		},
		'editor.renderFinalNewline': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.renderFinalNewline,
			'description': nls.localize('renderFinalNewline', "Render last line number when the file ends with a newline.")
		},
		'editor.rulers': {
			'type': 'array',
			'items': {
				'type': 'number'
			},
			'default': EDITOR_DEFAULTS.viewInfo.rulers,
			'description': nls.localize('rulers', "Render vertical rulers after a certain number of monospace characters. Use multiple values for multiple rulers. No rulers are drawn if array is empty.")
		},
		'editor.wordSeparators': {
			'type': 'string',
			'default': EDITOR_DEFAULTS.wordSeparators,
			'description': nls.localize('wordSeparators', "Characters that will be used as word separators when doing word related navigations or operations.")
		},
		'editor.tabSize': {
			'type': 'number',
			'default': EDITOR_MODEL_DEFAULTS.tabSize,
			'minimum': 1,
			'markdownDescription': nls.localize('tabSize', "The number of spaces a tab is equal to. This setting is overridden based on the file contents when `#editor.detectIndentation#` is on.")
		},
		// 'editor.indentSize': {
		// 	'anyOf': [
		// 		{
		// 			'type': 'string',
		// 			'enum': ['tabSize']
		// 		},
		// 		{
		// 			'type': 'number',
		// 			'minimum': 1
		// 		}
		// 	],
		// 	'default': 'tabSize',
		// 	'markdownDescription': nls.localize('indentSize', "The number of spaces used for indentation or 'tabSize' to use the value from `#editor.tabSize#`. This setting is overridden based on the file contents when `#editor.detectIndentation#` is on.")
		// },
		'editor.insertSpaces': {
			'type': 'boolean',
			'default': EDITOR_MODEL_DEFAULTS.insertSpaces,
			'markdownDescription': nls.localize('insertSpaces', "Insert spaces when pressing `Tab`. This setting is overridden based on the file contents when `#editor.detectIndentation#` is on.")
		},
		'editor.detectIndentation': {
			'type': 'boolean',
			'default': EDITOR_MODEL_DEFAULTS.detectIndentation,
			'markdownDescription': nls.localize('detectIndentation', "Controls whether `#editor.tabSize#` and `#editor.insertSpaces#` will be automatically detected when a file is opened based on the file contents.")
		},
		'editor.roundedSelection': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.roundedSelection,
			'description': nls.localize('roundedSelection', "Controls whether selections should have rounded corners.")
		},
		'editor.scrollBeyondLastLine': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.scrollBeyondLastLine,
			'description': nls.localize('scrollBeyondLastLine', "Controls whether the editor will scroll beyond the last line.")
		},
		'editor.scrollBeyondLastColumn': {
			'type': 'number',
			'default': EDITOR_DEFAULTS.viewInfo.scrollBeyondLastColumn,
			'description': nls.localize('scrollBeyondLastColumn', "Controls the number of extra characters beyond which the editor will scroll horizontally.")
		},
		'editor.smoothScrolling': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.smoothScrolling,
			'description': nls.localize('smoothScrolling', "Controls whether the editor will scroll using an animation.")
		},
		'editor.minimap.enabled': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.minimap.enabled,
			'description': nls.localize('minimap.enabled', "Controls whether the minimap is shown.")
		},
		'editor.minimap.side': {
			'type': 'string',
			'enum': ['left', 'right'],
			'default': EDITOR_DEFAULTS.viewInfo.minimap.side,
			'description': nls.localize('minimap.side', "Controls the side where to render the minimap.")
		},
		'editor.minimap.showSlider': {
			'type': 'string',
			'enum': ['always', 'mouseover'],
			'default': EDITOR_DEFAULTS.viewInfo.minimap.showSlider,
			'description': nls.localize('minimap.showSlider', "Controls whether the minimap slider is automatically hidden.")
		},
		'editor.minimap.renderCharacters': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.minimap.renderCharacters,
			'description': nls.localize('minimap.renderCharacters', "Render the actual characters on a line as opposed to color blocks.")
		},
		'editor.minimap.maxColumn': {
			'type': 'number',
			'default': EDITOR_DEFAULTS.viewInfo.minimap.maxColumn,
			'description': nls.localize('minimap.maxColumn', "Limit the width of the minimap to render at most a certain number of columns.")
		},
		'editor.hover.enabled': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.hover.enabled,
			'description': nls.localize('hover.enabled', "Controls whether the hover is shown.")
		},
		'editor.hover.delay': {
			'type': 'number',
			'default': EDITOR_DEFAULTS.contribInfo.hover.delay,
			'description': nls.localize('hover.delay', "Controls the delay in milliseconds after which the hover is shown.")
		},
		'editor.hover.sticky': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.hover.sticky,
			'description': nls.localize('hover.sticky', "Controls whether the hover should remain visible when mouse is moved over it.")
		},
		'editor.find.seedSearchStringFromSelection': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.find.seedSearchStringFromSelection,
			'description': nls.localize('find.seedSearchStringFromSelection', "Controls whether the search string in the Find Widget is seeded from the editor selection.")
		},
		'editor.find.autoFindInSelection': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.find.autoFindInSelection,
			'description': nls.localize('find.autoFindInSelection', "Controls whether the find operation is carried out on selected text or the entire file in the editor.")
		},
		'editor.find.globalFindClipboard': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.find.globalFindClipboard,
			'description': nls.localize('find.globalFindClipboard', "Controls whether the Find Widget should read or modify the shared find clipboard on macOS."),
			'included': platform.isMacintosh
		},
		'editor.find.addExtraSpaceOnTop': {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('find.addExtraSpaceOnTop', "Controls whether the Find Widget should add extra lines on top of the editor. When true, you can scroll beyond the first line when the Find Widget is visible.")
		},
		'editor.wordWrap': {
			'type': 'string',
			'enum': ['off', 'on', 'wordWrapColumn', 'bounded'],
			'markdownEnumDescriptions': [
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
			'default': EDITOR_DEFAULTS.wordWrap,
			'description': nls.localize({
				key: 'wordWrap',
				comment: [
					'- \'off\', \'on\', \'wordWrapColumn\' and \'bounded\' refer to values the setting can take and should not be localized.',
					'- `editor.wordWrapColumn` refers to a different setting and should not be localized.'
				]
			}, "Controls how lines should wrap.")
		},
		'editor.wordWrapColumn': {
			'type': 'integer',
			'default': EDITOR_DEFAULTS.wordWrapColumn,
			'minimum': 1,
			'markdownDescription': nls.localize({
				key: 'wordWrapColumn',
				comment: [
					'- `editor.wordWrap` refers to a different setting and should not be localized.',
					'- \'wordWrapColumn\' and \'bounded\' refer to values the different setting can take and should not be localized.'
				]
			}, "Controls the wrapping column of the editor when `#editor.wordWrap#` is `wordWrapColumn` or `bounded`.")
		},
		'editor.wrappingIndent': {
			'type': 'string',
			'enum': ['none', 'same', 'indent', 'deepIndent'],
			enumDescriptions: [
				nls.localize('wrappingIndent.none', "No indentation. Wrapped lines begin at column 1."),
				nls.localize('wrappingIndent.same', "Wrapped lines get the same indentation as the parent."),
				nls.localize('wrappingIndent.indent', "Wrapped lines get +1 indentation toward the parent."),
				nls.localize('wrappingIndent.deepIndent', "Wrapped lines get +2 indentation toward the parent."),
			],
			'default': 'same',
			'description': nls.localize('wrappingIndent', "Controls the indentation of wrapped lines."),
		},
		'editor.mouseWheelScrollSensitivity': {
			'type': 'number',
			'default': EDITOR_DEFAULTS.viewInfo.scrollbar.mouseWheelScrollSensitivity,
			'markdownDescription': nls.localize('mouseWheelScrollSensitivity', "A multiplier to be used on the `deltaX` and `deltaY` of mouse wheel scroll events.")
		},
		'editor.fastScrollSensitivity': {
			'type': 'number',
			'default': EDITOR_DEFAULTS.viewInfo.scrollbar.fastScrollSensitivity,
			'markdownDescription': nls.localize('fastScrollSensitivity', "Scrolling speed multiplier when pressing `Alt`.")
		},
		'editor.multiCursorModifier': {
			'type': 'string',
			'enum': ['ctrlCmd', 'alt'],
			'markdownEnumDescriptions': [
				nls.localize('multiCursorModifier.ctrlCmd', "Maps to `Control` on Windows and Linux and to `Command` on macOS."),
				nls.localize('multiCursorModifier.alt', "Maps to `Alt` on Windows and Linux and to `Option` on macOS.")
			],
			'default': 'alt',
			'markdownDescription': nls.localize({
				key: 'multiCursorModifier',
				comment: [
					'- `ctrlCmd` refers to a value the setting can take and should not be localized.',
					'- `Control` and `Command` refer to the modifier keys Ctrl or Cmd on the keyboard and can be localized.'
				]
			}, "The modifier to be used to add multiple cursors with the mouse. The Go To Definition and Open Link mouse gestures will adapt such that they do not conflict with the multicursor modifier. [Read more](https://code.visualstudio.com/docs/editor/codebasics#_multicursor-modifier).")
		},
		'editor.multiCursorMergeOverlapping': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.multiCursorMergeOverlapping,
			'description': nls.localize('multiCursorMergeOverlapping', "Merge multiple cursors when they are overlapping.")
		},
		'editor.quickSuggestions': {
			'anyOf': [
				{
					type: 'boolean',
				},
				{
					type: 'object',
					properties: {
						strings: {
							type: 'boolean',
							default: false,
							description: nls.localize('quickSuggestions.strings', "Enable quick suggestions inside strings.")
						},
						comments: {
							type: 'boolean',
							default: false,
							description: nls.localize('quickSuggestions.comments', "Enable quick suggestions inside comments.")
						},
						other: {
							type: 'boolean',
							default: true,
							description: nls.localize('quickSuggestions.other', "Enable quick suggestions outside of strings and comments.")
						},
					}
				}
			],
			'default': EDITOR_DEFAULTS.contribInfo.quickSuggestions,
			'description': nls.localize('quickSuggestions', "Controls whether suggestions should automatically show up while typing.")
		},
		'editor.quickSuggestionsDelay': {
			'type': 'integer',
			'default': EDITOR_DEFAULTS.contribInfo.quickSuggestionsDelay,
			'minimum': 0,
			'description': nls.localize('quickSuggestionsDelay', "Controls the delay in milliseconds after which quick suggestions will show up.")
		},
		'editor.parameterHints.enabled': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.parameterHints.enabled,
			'description': nls.localize('parameterHints.enabled', "Enables a pop-up that shows parameter documentation and type information as you type.")
		},
		'editor.parameterHints.cycle': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.parameterHints.cycle,
			'description': nls.localize('parameterHints.cycle', "Controls whether the parameter hints menu cycles or closes when reaching the end of the list.")
		},
		'editor.autoClosingBrackets': {
			type: 'string',
			enum: ['always', 'languageDefined', 'beforeWhitespace', 'never'],
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingBrackets.languageDefined', "Use language configurations to determine when to autoclose brackets."),
				nls.localize('editor.autoClosingBrackets.beforeWhitespace', "Autoclose brackets only when the cursor is to the left of whitespace."),
				'',

			],
			'default': EDITOR_DEFAULTS.autoClosingBrackets,
			'description': nls.localize('autoClosingBrackets', "Controls whether the editor should automatically close brackets after the user adds an opening bracket.")
		},
		'editor.autoClosingComments': {
			type: 'string',
			enum: ['always', 'languageDefined', 'beforeWhitespace', 'never'],
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingComments.languageDefined', "Use language configurations to determine when to autoclose comments."),
				nls.localize('editor.autoClosingComments.beforeWhitespace', "Autoclose comments only when the cursor is to the left of whitespace."),
				'',

			],
			'default': EDITOR_DEFAULTS.autoClosingComments,
			'description': nls.localize('autoClosingComments', "Controls whether the editor should automatically close comment after the user adds an opening comment.")
		},
		'editor.autoClosingQuotes': {
			type: 'string',
			enum: ['always', 'languageDefined', 'beforeWhitespace', 'never'],
			enumDescriptions: [
				'',
				nls.localize('editor.autoClosingQuotes.languageDefined', "Use language configurations to determine when to autoclose quotes."),
				nls.localize('editor.autoClosingQuotes.beforeWhitespace', "Autoclose quotes only when the cursor is to the left of whitespace."),
				'',
			],
			'default': EDITOR_DEFAULTS.autoClosingQuotes,
			'description': nls.localize('autoClosingQuotes', "Controls whether the editor should automatically close quotes after the user adds an opening quote.")
		},
		'editor.autoSurround': {
			type: 'string',
			enum: ['languageDefined', 'brackets', 'quotes', 'never'],
			enumDescriptions: [
				nls.localize('editor.autoSurround.languageDefined', "Use language configurations to determine when to automatically surround selections."),
				nls.localize('editor.autoSurround.brackets', "Surround with brackets but not quotes."),
				nls.localize('editor.autoSurround.quotes', "Surround with quotes but not brackets."),
				''
			],
			'default': EDITOR_DEFAULTS.autoSurround,
			'description': nls.localize('autoSurround', "Controls whether the editor should automatically surround selections.")
		},
		'editor.formatOnType': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.formatOnType,
			'description': nls.localize('formatOnType', "Controls whether the editor should automatically format the line after typing.")
		},
		'editor.formatOnPaste': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.formatOnPaste,
			'description': nls.localize('formatOnPaste', "Controls whether the editor should automatically format the pasted content. A formatter must be available and the formatter should be able to format a range in a document.")
		},
		'editor.autoIndent': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.autoIndent,
			'description': nls.localize('autoIndent', "Controls whether the editor should automatically adjust the indentation when users type, paste or move lines. Extensions with indentation rules of the language must be available.")
		},
		'editor.suggestOnTriggerCharacters': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.suggestOnTriggerCharacters,
			'description': nls.localize('suggestOnTriggerCharacters', "Controls whether suggestions should automatically show up when typing trigger characters.")
		},
		'editor.acceptSuggestionOnEnter': {
			'type': 'string',
			'enum': ['on', 'smart', 'off'],
			'default': EDITOR_DEFAULTS.contribInfo.acceptSuggestionOnEnter,
			'markdownEnumDescriptions': [
				'',
				nls.localize('acceptSuggestionOnEnterSmart', "Only accept a suggestion with `Enter` when it makes a textual change."),
				''
			],
			'markdownDescription': nls.localize('acceptSuggestionOnEnter', "Controls whether suggestions should be accepted on `Enter`, in addition to `Tab`. Helps to avoid ambiguity between inserting new lines or accepting suggestions.")
		},
		'editor.acceptSuggestionOnCommitCharacter': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.acceptSuggestionOnCommitCharacter,
			'markdownDescription': nls.localize('acceptSuggestionOnCommitCharacter', "Controls whether suggestions should be accepted on commit characters. For example, in JavaScript, the semi-colon (`;`) can be a commit character that accepts a suggestion and types that character.")
		},
		'editor.snippetSuggestions': {
			'type': 'string',
			'enum': ['top', 'bottom', 'inline', 'none'],
			'enumDescriptions': [
				nls.localize('snippetSuggestions.top', "Show snippet suggestions on top of other suggestions."),
				nls.localize('snippetSuggestions.bottom', "Show snippet suggestions below other suggestions."),
				nls.localize('snippetSuggestions.inline', "Show snippets suggestions with other suggestions."),
				nls.localize('snippetSuggestions.none', "Do not show snippet suggestions."),
			],
			'default': EDITOR_DEFAULTS.contribInfo.suggest.snippets,
			'description': nls.localize('snippetSuggestions', "Controls whether snippets are shown with other suggestions and how they are sorted.")
		},
		'editor.emptySelectionClipboard': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.emptySelectionClipboard,
			'description': nls.localize('emptySelectionClipboard', "Controls whether copying without a selection copies the current line.")
		},
		'editor.copyWithSyntaxHighlighting': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.copyWithSyntaxHighlighting,
			'description': nls.localize('copyWithSyntaxHighlighting', "Controls whether syntax highlighting should be copied into the clipboard.")
		},
		'editor.wordBasedSuggestions': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.wordBasedSuggestions,
			'description': nls.localize('wordBasedSuggestions', "Controls whether completions should be computed based on words in the document.")
		},
		'editor.suggestSelection': {
			'type': 'string',
			'enum': ['first', 'recentlyUsed', 'recentlyUsedByPrefix'],
			'markdownEnumDescriptions': [
				nls.localize('suggestSelection.first', "Always select the first suggestion."),
				nls.localize('suggestSelection.recentlyUsed', "Select recent suggestions unless further typing selects one, e.g. `console.| -> console.log` because `log` has been completed recently."),
				nls.localize('suggestSelection.recentlyUsedByPrefix', "Select suggestions based on previous prefixes that have completed those suggestions, e.g. `co -> console` and `con -> const`."),
			],
			'default': 'recentlyUsed',
			'description': nls.localize('suggestSelection', "Controls how suggestions are pre-selected when showing the suggest list.")
		},
		'editor.suggestFontSize': {
			'type': 'integer',
			'default': 0,
			'minimum': 0,
			'markdownDescription': nls.localize('suggestFontSize', "Font size for the suggest widget. When set to `0`, the value of `#editor.fontSize#` is used.")
		},
		'editor.suggestLineHeight': {
			'type': 'integer',
			'default': 0,
			'minimum': 0,
			'markdownDescription': nls.localize('suggestLineHeight', "Line height for the suggest widget. When set to `0`, the value of `#editor.lineHeight#` is used.")
		},
		'editor.tabCompletion': {
			type: 'string',
			default: 'off',
			enum: ['on', 'off', 'onlySnippets'],
			enumDescriptions: [
				nls.localize('tabCompletion.on', "Tab complete will insert the best matching suggestion when pressing tab."),
				nls.localize('tabCompletion.off', "Disable tab completions."),
				nls.localize('tabCompletion.onlySnippets', "Tab complete snippets when their prefix match. Works best when 'quickSuggestions' aren't enabled."),
			],
			description: nls.localize('tabCompletion', "Enables tab completions.")
		},
		'editor.suggest.filterGraceful': {
			type: 'boolean',
			default: true,
			description: nls.localize('suggest.filterGraceful', "Controls whether filtering and sorting suggestions accounts for small typos.")
		},
		'editor.suggest.localityBonus': {
			type: 'boolean',
			default: false,
			description: nls.localize('suggest.localityBonus', "Controls whether sorting favours words that appear close to the cursor.")
		},
		'editor.suggest.shareSuggestSelections': {
			type: 'boolean',
			default: false,
			markdownDescription: nls.localize('suggest.shareSuggestSelections', "Controls whether remembered suggestion selections are shared between multiple workspaces and windows (needs `#editor.suggestSelection#`).")
		},
		'editor.suggest.snippetsPreventQuickSuggestions': {
			type: 'boolean',
			default: true,
			description: nls.localize('suggest.snippetsPreventQuickSuggestions', "Control whether an active snippet prevents quick suggestions.")
		},
		'editor.suggest.showIcons': {
			type: 'boolean',
			default: EDITOR_DEFAULTS.contribInfo.suggest.showIcons,
			description: nls.localize('suggest.showIcons', "Controls whether to show or hide icons in suggestions.")
		},
		'editor.suggest.maxVisibleSuggestions': {
			type: 'number',
			default: EDITOR_DEFAULTS.contribInfo.suggest.maxVisibleSuggestions,
			minimum: 1,
			maximum: 15,
			description: nls.localize('suggest.maxVisibleSuggestions', "Controls how many suggestions IntelliSense will show before showing a scrollbar (maximum 15).")
		},
		'editor.suggest.filteredTypes': {
			type: 'object',
			default: { keyword: true, snippet: true },
			markdownDescription: nls.localize('suggest.filtered', "Controls whether some suggestion types should be filtered from IntelliSense. A list of suggestion types can be found here: https://code.visualstudio.com/docs/editor/intellisense#_types-of-completions."),
			properties: {
				method: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.method', "When set to `false` IntelliSense never shows `method` suggestions.")
				},
				function: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.function', "When set to `false` IntelliSense never shows `function` suggestions.")
				},
				constructor: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.constructor', "When set to `false` IntelliSense never shows `constructor` suggestions.")
				},
				field: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.field', "When set to `false` IntelliSense never shows `field` suggestions.")
				},
				variable: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.variable', "When set to `false` IntelliSense never shows `variable` suggestions.")
				},
				class: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.class', "When set to `false` IntelliSense never shows `class` suggestions.")
				},
				struct: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.struct', "When set to `false` IntelliSense never shows `struct` suggestions.")
				},
				interface: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.interface', "When set to `false` IntelliSense never shows `interface` suggestions.")
				},
				module: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.module', "When set to `false` IntelliSense never shows `module` suggestions.")
				},
				property: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.property', "When set to `false` IntelliSense never shows `property` suggestions.")
				},
				event: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.event', "When set to `false` IntelliSense never shows `event` suggestions.")
				},
				operator: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.operator', "When set to `false` IntelliSense never shows `operator` suggestions.")
				},
				unit: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.unit', "When set to `false` IntelliSense never shows `unit` suggestions.")
				},
				value: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.value', "When set to `false` IntelliSense never shows `value` suggestions.")
				},
				constant: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.constant', "When set to `false` IntelliSense never shows `constant` suggestions.")
				},
				enum: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.enum', "When set to `false` IntelliSense never shows `enum` suggestions.")
				},
				enumMember: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.enumMember', "When set to `false` IntelliSense never shows `enumMember` suggestions.")
				},
				keyword: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.keyword', "When set to `false` IntelliSense never shows `keyword` suggestions.")
				},
				text: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.text', "When set to `false` IntelliSense never shows `text` suggestions.")
				},
				color: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.color', "When set to `false` IntelliSense never shows `color` suggestions.")
				},
				file: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.file', "When set to `false` IntelliSense never shows `file` suggestions.")
				},
				reference: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.reference', "When set to `false` IntelliSense never shows `reference` suggestions.")
				},
				customcolor: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.customcolor', "When set to `false` IntelliSense never shows `customcolor` suggestions.")
				},
				folder: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.folder', "When set to `false` IntelliSense never shows `folder` suggestions.")
				},
				typeParameter: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.typeParameter', "When set to `false` IntelliSense never shows `typeParameter` suggestions.")
				},
				snippet: {
					type: 'boolean',
					default: true,
					markdownDescription: nls.localize('suggest.filtered.snippet', "When set to `false` IntelliSense never shows `snippet` suggestions.")
				},
			}
		},
		'editor.gotoLocation.multiple': {
			description: nls.localize('editor.gotoLocation.multiple', "Controls the behavior of 'Go To' commands, like Go To Definition, when multiple target locations exist."),
			type: 'string',
			enum: ['peek', 'gotoAndPeek', 'goto'],
			default: EDITOR_DEFAULTS.contribInfo.gotoLocation.multiple,
			enumDescriptions: [
				nls.localize('editor.gotoLocation.multiple.peek', 'Show peek view of the results (default)'),
				nls.localize('editor.gotoLocation.multiple.gotoAndPeek', 'Go to the primary result and show a peek view'),
				nls.localize('editor.gotoLocation.multiple.goto', 'Go to the primary result and enable peek-less navigation to others')
			]
		},
		'editor.selectionHighlight': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.selectionHighlight,
			'description': nls.localize('selectionHighlight', "Controls whether the editor should highlight matches similar to the selection.")
		},
		'editor.occurrencesHighlight': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.occurrencesHighlight,
			'description': nls.localize('occurrencesHighlight', "Controls whether the editor should highlight semantic symbol occurrences.")
		},
		'editor.overviewRulerLanes': {
			'type': 'integer',
			'default': 3,
			'description': nls.localize('overviewRulerLanes', "Controls the number of decorations that can show up at the same position in the overview ruler.")
		},
		'editor.overviewRulerBorder': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.overviewRulerBorder,
			'description': nls.localize('overviewRulerBorder', "Controls whether a border should be drawn around the overview ruler.")
		},
		'editor.cursorBlinking': {
			'type': 'string',
			'enum': ['blink', 'smooth', 'phase', 'expand', 'solid'],
			'default': editorOptions.blinkingStyleToString(EDITOR_DEFAULTS.viewInfo.cursorBlinking),
			'description': nls.localize('cursorBlinking', "Control the cursor animation style.")
		},
		'editor.mouseWheelZoom': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.mouseWheelZoom,
			'markdownDescription': nls.localize('mouseWheelZoom', "Zoom the font of the editor when using mouse wheel and holding `Ctrl`.")
		},
		'editor.cursorSmoothCaretAnimation': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.cursorSmoothCaretAnimation,
			'description': nls.localize('cursorSmoothCaretAnimation', "Controls whether the smooth caret animation should be enabled.")
		},
		'editor.cursorStyle': {
			'type': 'string',
			'enum': ['block', 'block-outline', 'line', 'line-thin', 'underline', 'underline-thin'],
			'default': editorOptions.cursorStyleToString(EDITOR_DEFAULTS.viewInfo.cursorStyle),
			'description': nls.localize('cursorStyle', "Controls the cursor style.")
		},
		'editor.cursorWidth': {
			'type': 'integer',
			'default': EDITOR_DEFAULTS.viewInfo.cursorWidth,
			'markdownDescription': nls.localize('cursorWidth', "Controls the width of the cursor when `#editor.cursorStyle#` is set to `line`.")
		},
		'editor.fontLigatures': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.fontLigatures,
			'description': nls.localize('fontLigatures', "Enables/Disables font ligatures.")
		},
		'editor.hideCursorInOverviewRuler': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.hideCursorInOverviewRuler,
			'description': nls.localize('hideCursorInOverviewRuler', "Controls whether the cursor should be hidden in the overview ruler.")
		},
		'editor.renderWhitespace': {
			'type': 'string',
			'enum': ['none', 'boundary', 'selection', 'all'],
			'enumDescriptions': [
				'',
				nls.localize('renderWhitespace.boundary', "Render whitespace characters except for single spaces between words."),
				nls.localize('renderWhitespace.selection', "Render whitespace characters only on selected text."),
				''
			],
			default: EDITOR_DEFAULTS.viewInfo.renderWhitespace,
			description: nls.localize('renderWhitespace', "Controls how the editor should render whitespace characters.")
		},
		'editor.renderControlCharacters': {
			'type': 'boolean',
			default: EDITOR_DEFAULTS.viewInfo.renderControlCharacters,
			description: nls.localize('renderControlCharacters', "Controls whether the editor should render control characters.")
		},
		'editor.renderIndentGuides': {
			'type': 'boolean',
			default: EDITOR_DEFAULTS.viewInfo.renderIndentGuides,
			description: nls.localize('renderIndentGuides', "Controls whether the editor should render indent guides.")
		},
		'editor.highlightActiveIndentGuide': {
			'type': 'boolean',
			default: EDITOR_DEFAULTS.viewInfo.highlightActiveIndentGuide,
			description: nls.localize('highlightActiveIndentGuide', "Controls whether the editor should highlight the active indent guide.")
		},
		'editor.renderLineHighlight': {
			'type': 'string',
			'enum': ['none', 'gutter', 'line', 'all'],
			'enumDescriptions': [
				'',
				'',
				'',
				nls.localize('renderLineHighlight.all', "Highlights both the gutter and the current line."),
			],
			default: EDITOR_DEFAULTS.viewInfo.renderLineHighlight,
			description: nls.localize('renderLineHighlight', "Controls how the editor should render the current line highlight.")
		},
		'editor.codeLens': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.codeLens,
			'description': nls.localize('codeLens', "Controls whether the editor shows CodeLens.")
		},
		'editor.folding': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.folding,
			'description': nls.localize('folding', "Controls whether the editor has code folding enabled.")
		},
		'editor.foldingStrategy': {
			'type': 'string',
			'enum': ['auto', 'indentation'],
			'default': EDITOR_DEFAULTS.contribInfo.foldingStrategy,
			'markdownDescription': nls.localize('foldingStrategy', "Controls the strategy for computing folding ranges. `auto` uses a language specific folding strategy, if available. `indentation` uses the indentation based folding strategy.")
		},
		'editor.showFoldingControls': {
			'type': 'string',
			'enum': ['always', 'mouseover'],
			'default': EDITOR_DEFAULTS.contribInfo.showFoldingControls,
			'description': nls.localize('showFoldingControls', "Controls whether the fold controls on the gutter are automatically hidden.")
		},
		'editor.matchBrackets': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.matchBrackets,
			'description': nls.localize('matchBrackets', "Highlight matching brackets when one of them is selected.")
		},
		'editor.glyphMargin': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.viewInfo.glyphMargin,
			'description': nls.localize('glyphMargin', "Controls whether the editor should render the vertical glyph margin. Glyph margin is mostly used for debugging.")
		},
		'editor.useTabStops': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.useTabStops,
			'description': nls.localize('useTabStops', "Inserting and deleting whitespace follows tab stops.")
		},
		'editor.trimAutoWhitespace': {
			'type': 'boolean',
			'default': EDITOR_MODEL_DEFAULTS.trimAutoWhitespace,
			'description': nls.localize('trimAutoWhitespace', "Remove trailing auto inserted whitespace.")
		},
		'editor.stablePeek': {
			'type': 'boolean',
			'default': false,
			'markdownDescription': nls.localize('stablePeek', "Keep peek editors open even when double clicking their content or when hitting `Escape`.")
		},
		'editor.dragAndDrop': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.dragAndDrop,
			'description': nls.localize('dragAndDrop', "Controls whether the editor should allow moving selections via drag and drop.")
		},
		'editor.accessibilitySupport': {
			'type': 'string',
			'enum': ['auto', 'on', 'off'],
			'enumDescriptions': [
				nls.localize('accessibilitySupport.auto', "The editor will use platform APIs to detect when a Screen Reader is attached."),
				nls.localize('accessibilitySupport.on', "The editor will be permanently optimized for usage with a Screen Reader."),
				nls.localize('accessibilitySupport.off', "The editor will never be optimized for usage with a Screen Reader."),
			],
			'default': EDITOR_DEFAULTS.accessibilitySupport,
			'description': nls.localize('accessibilitySupport', "Controls whether the editor should run in a mode where it is optimized for screen readers.")
		},
		'editor.showUnused': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.showUnused,
			'description': nls.localize('showUnused', "Controls fading out of unused code.")
		},
		'editor.links': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.links,
			'description': nls.localize('links', "Controls whether the editor should detect links and make them clickable.")
		},
		'editor.colorDecorators': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.colorDecorators,
			'description': nls.localize('colorDecorators', "Controls whether the editor should render the inline color decorators and color picker.")
		},
		'editor.lightbulb.enabled': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.lightbulbEnabled,
			'description': nls.localize('codeActions', "Enables the code action lightbulb in the editor.")
		},
		'editor.maxTokenizationLineLength': {
			'type': 'integer',
			'default': 20_000,
			'description': nls.localize('maxTokenizationLineLength', "Lines above this length will not be tokenized for performance reasons")
		},
		'editor.codeActionsOnSave': {
			'type': 'object',
			'properties': {
				'source.organizeImports': {
					'type': 'boolean',
					'description': nls.localize('codeActionsOnSave.organizeImports', "Controls whether organize imports action should be run on file save.")
				},
				'source.fixAll': {
					'type': 'boolean',
					'description': nls.localize('codeActionsOnSave.fixAll', "Controls whether auto fix action should be run on file save.")
				}
			},
			'additionalProperties': {
				'type': 'boolean'
			},
			'default': EDITOR_DEFAULTS.contribInfo.codeActionsOnSave,
			'description': nls.localize('codeActionsOnSave', "Code action kinds to be run on save.")
		},
		'editor.codeActionsOnSaveTimeout': {
			'type': 'number',
			'default': EDITOR_DEFAULTS.contribInfo.codeActionsOnSaveTimeout,
			'description': nls.localize('codeActionsOnSaveTimeout', "Timeout in milliseconds after which the code actions that are run on save are cancelled.")
		},
		'editor.selectionClipboard': {
			'type': 'boolean',
			'default': EDITOR_DEFAULTS.contribInfo.selectionClipboard,
			'description': nls.localize('selectionClipboard', "Controls whether the Linux primary clipboard should be supported."),
			'included': platform.isLinux
		},
		'diffEditor.renderSideBySide': {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('sideBySide', "Controls whether the diff editor shows the diff side by side or inline.")
		},
		'diffEditor.ignoreTrimWhitespace': {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('ignoreTrimWhitespace', "Controls whether the diff editor shows changes in leading or trailing whitespace as diffs.")
		},
		'editor.largeFileOptimizations': {
			'type': 'boolean',
			'default': EDITOR_MODEL_DEFAULTS.largeFileOptimizations,
			'description': nls.localize('largeFileOptimizations', "Special handling for large files to disable certain memory intensive features.")
		},
		'diffEditor.renderIndicators': {
			'type': 'boolean',
			'default': true,
			'description': nls.localize('renderIndicators', "Controls whether the diff editor shows +/- indicators for added/removed changes.")
		}
	}
};

let cachedEditorConfigurationKeys: { [key: string]: boolean; } | null = null;
function getEditorConfigurationKeys(): { [key: string]: boolean; } {
	if (cachedEditorConfigurationKeys === null) {
		cachedEditorConfigurationKeys = <{ [key: string]: boolean; }>Object.create(null);
		Object.keys(editorConfiguration.properties!).forEach((prop) => {
			cachedEditorConfigurationKeys![prop] = true;
		});
	}
	return cachedEditorConfigurationKeys;
}

export function isEditorConfigurationKey(key: string): boolean {
	const editorConfigurationKeys = getEditorConfigurationKeys();
	return (editorConfigurationKeys[`editor.${key}`] || false);
}
export function isDiffEditorConfigurationKey(key: string): boolean {
	const editorConfigurationKeys = getEditorConfigurationKeys();
	return (editorConfigurationKeys[`diffEditor.${key}`] || false);
}

configurationRegistry.registerConfiguration(editorConfiguration);
