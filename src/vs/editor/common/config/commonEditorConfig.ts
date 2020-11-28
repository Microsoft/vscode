/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as objects from 'vs/base/common/objects';
import * as arrays from 'vs/base/common/arrays';
import { IEditorOptions, editorOptionsRegistry, ValidatedEditorOptions, IEnvironmentalOptions, IComputedEditorOptions, ConfigurationChangedEvent, EDITOR_MODEL_DEFAULTS, EditorOption, FindComputedEditorOptionValueById, ComputeOptionsMemory } from 'vs/editor/common/config/editorOptions';
import { EditorZoom } from 'vs/editor/common/config/editorZoom';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { IConfiguration, IDimension } from 'vs/editor/common/editorCommon';
import { ConfigurationScope, Extensions, IConfigurationNode, IConfigurationRegistry, IConfigurationPropertySchema } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { forEach } from 'vs/base/common/collections';

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

export class ComputedEditorOptions implements IComputedEditorOptions {
	private readonly _values: any[] = [];
	public _read<T>(id: EditorOption): T {
		return this._values[id];
	}
	public get<T extends EditorOption>(id: T): FindComputedEditorOptionValueById<T> {
		return this._values[id];
	}
	public _write<T>(id: EditorOption, value: T): void {
		this._values[id] = value;
	}
}

class RawEditorOptions {
	private readonly _values: any[] = [];
	public _read<T>(id: EditorOption): T | undefined {
		return this._values[id];
	}
	public _write<T>(id: EditorOption, value: T | undefined): void {
		this._values[id] = value;
	}
}

class EditorConfiguration2 {
	public static readOptions(_options: IEditorOptions): RawEditorOptions {
		const options: { [key: string]: any; } = _options;
		const result = new RawEditorOptions();
		for (const editorOption of editorOptionsRegistry) {
			const value = (editorOption.name === '_never_' ? undefined : options[editorOption.name]);
			result._write(editorOption.id, value);
		}
		return result;
	}

	public static validateOptions(options: RawEditorOptions): ValidatedEditorOptions {
		const result = new ValidatedEditorOptions();
		for (const editorOption of editorOptionsRegistry) {
			result._write(editorOption.id, editorOption.validate(options._read(editorOption.id)));
		}
		return result;
	}

	public static computeOptions(options: ValidatedEditorOptions, env: IEnvironmentalOptions): ComputedEditorOptions {
		const result = new ComputedEditorOptions();
		for (const editorOption of editorOptionsRegistry) {
			result._write(editorOption.id, editorOption.compute(env, result, options._read(editorOption.id)));
		}
		return result;
	}

	private static _deepEquals<T>(a: T, b: T): boolean {
		if (typeof a !== 'object' || typeof b !== 'object') {
			return (a === b);
		}
		if (Array.isArray(a) || Array.isArray(b)) {
			return (Array.isArray(a) && Array.isArray(b) ? arrays.equals(a, b) : false);
		}
		for (let key in a) {
			if (!EditorConfiguration2._deepEquals(a[key], b[key])) {
				return false;
			}
		}
		return true;
	}

	public static checkEquals(a: ComputedEditorOptions, b: ComputedEditorOptions): ConfigurationChangedEvent | null {
		const result: boolean[] = [];
		let somethingChanged = false;
		for (const editorOption of editorOptionsRegistry) {
			const changed = !EditorConfiguration2._deepEquals(a._read(editorOption.id), b._read(editorOption.id));
			result[editorOption.id] = changed;
			if (changed) {
				somethingChanged = true;
			}
		}
		return (somethingChanged ? new ConfigurationChangedEvent(result) : null);
	}
}

/**
 * Compatibility with old options
 */
function migrateOptions(options: IEditorOptions): void {
	const wordWrap = options.wordWrap;
	if (<any>wordWrap === true) {
		options.wordWrap = 'on';
	} else if (<any>wordWrap === false) {
		options.wordWrap = 'off';
	}

	const lineNumbers = options.lineNumbers;
	if (<any>lineNumbers === true) {
		options.lineNumbers = 'on';
	} else if (<any>lineNumbers === false) {
		options.lineNumbers = 'off';
	}

	const autoClosingBrackets = options.autoClosingBrackets;
	if (<any>autoClosingBrackets === false) {
		options.autoClosingBrackets = 'never';
		options.autoClosingQuotes = 'never';
		options.autoSurround = 'never';
	}

	const cursorBlinking = options.cursorBlinking;
	if (<any>cursorBlinking === 'visible') {
		options.cursorBlinking = 'solid';
	}

	const renderWhitespace = options.renderWhitespace;
	if (<any>renderWhitespace === true) {
		options.renderWhitespace = 'boundary';
	} else if (<any>renderWhitespace === false) {
		options.renderWhitespace = 'none';
	}

	const renderLineHighlight = options.renderLineHighlight;
	if (<any>renderLineHighlight === true) {
		options.renderLineHighlight = 'line';
	} else if (<any>renderLineHighlight === false) {
		options.renderLineHighlight = 'none';
	}

	const acceptSuggestionOnEnter = options.acceptSuggestionOnEnter;
	if (<any>acceptSuggestionOnEnter === true) {
		options.acceptSuggestionOnEnter = 'on';
	} else if (<any>acceptSuggestionOnEnter === false) {
		options.acceptSuggestionOnEnter = 'off';
	}

	const tabCompletion = options.tabCompletion;
	if (<any>tabCompletion === false) {
		options.tabCompletion = 'off';
	} else if (<any>tabCompletion === true) {
		options.tabCompletion = 'onlySnippets';
	}

	const suggest = options.suggest;
	if (suggest && typeof (<any>suggest).filteredTypes === 'object' && (<any>suggest).filteredTypes) {
		const mapping: Record<string, string> = {};
		mapping['method'] = 'showMethods';
		mapping['function'] = 'showFunctions';
		mapping['constructor'] = 'showConstructors';
		mapping['field'] = 'showFields';
		mapping['variable'] = 'showVariables';
		mapping['class'] = 'showClasses';
		mapping['struct'] = 'showStructs';
		mapping['interface'] = 'showInterfaces';
		mapping['module'] = 'showModules';
		mapping['property'] = 'showProperties';
		mapping['event'] = 'showEvents';
		mapping['operator'] = 'showOperators';
		mapping['unit'] = 'showUnits';
		mapping['value'] = 'showValues';
		mapping['constant'] = 'showConstants';
		mapping['enum'] = 'showEnums';
		mapping['enumMember'] = 'showEnumMembers';
		mapping['keyword'] = 'showKeywords';
		mapping['text'] = 'showWords';
		mapping['color'] = 'showColors';
		mapping['file'] = 'showFiles';
		mapping['reference'] = 'showReferences';
		mapping['folder'] = 'showFolders';
		mapping['typeParameter'] = 'showTypeParameters';
		mapping['snippet'] = 'showSnippets';
		forEach(mapping, entry => {
			const value = (<any>suggest).filteredTypes[entry.key];
			if (value === false) {
				(<any>suggest)[entry.value] = value;
			}
		});
		// delete (<any>suggest).filteredTypes;
	}

	const hover = options.hover;
	if (<any>hover === true) {
		options.hover = {
			enabled: true
		};
	} else if (<any>hover === false) {
		options.hover = {
			enabled: false
		};
	}

	const parameterHints = options.parameterHints;
	if (<any>parameterHints === true) {
		options.parameterHints = {
			enabled: true
		};
	} else if (<any>parameterHints === false) {
		options.parameterHints = {
			enabled: false
		};
	}

	const autoIndent = options.autoIndent;
	if (<any>autoIndent === true) {
		options.autoIndent = 'full';
	} else if (<any>autoIndent === false) {
		options.autoIndent = 'advanced';
	}

	const matchBrackets = options.matchBrackets;
	if (<any>matchBrackets === true) {
		options.matchBrackets = 'always';
	} else if (<any>matchBrackets === false) {
		options.matchBrackets = 'never';
	}
}

function deepCloneAndMigrateOptions(_options: IEditorOptions): IEditorOptions {
	const options = objects.deepClone(_options);
	migrateOptions(options);
	return options;
}

export abstract class CommonEditorConfiguration extends Disposable implements IConfiguration {

	private _onDidChange = this._register(new Emitter<ConfigurationChangedEvent>());
	public readonly onDidChange: Event<ConfigurationChangedEvent> = this._onDidChange.event;

	private _onDidChangeFast = this._register(new Emitter<ConfigurationChangedEvent>());
	public readonly onDidChangeFast: Event<ConfigurationChangedEvent> = this._onDidChangeFast.event;

	public readonly isSimpleWidget: boolean;
	private _computeOptionsMemory: ComputeOptionsMemory;
	public options!: ComputedEditorOptions;

	private _isDominatedByLongLines: boolean;
	private _viewLineCount: number;
	private _lineNumbersDigitCount: number;

	private _rawOptions: IEditorOptions;
	private _readOptions: RawEditorOptions;
	protected _validatedOptions: ValidatedEditorOptions;

	constructor(isSimpleWidget: boolean, _options: IEditorOptions) {
		super();
		this.isSimpleWidget = isSimpleWidget;

		this._isDominatedByLongLines = false;
		this._computeOptionsMemory = new ComputeOptionsMemory();
		this._viewLineCount = 1;
		this._lineNumbersDigitCount = 1;

		this._rawOptions = deepCloneAndMigrateOptions(_options);
		this._readOptions = EditorConfiguration2.readOptions(this._rawOptions);
		this._validatedOptions = EditorConfiguration2.validateOptions(this._readOptions);

		this._register(EditorZoom.onDidChangeZoomLevel(_ => this._recomputeOptions()));
		this._register(TabFocus.onDidChangeTabFocus(_ => this._recomputeOptions()));
	}

	public observeReferenceElement(dimension?: IDimension): void {
	}

	public dispose(): void {
		super.dispose();
	}

	protected _recomputeOptions(): void {
		const oldOptions = this.options;
		const newOptions = this._computeInternalOptions();

		if (!oldOptions) {
			this.options = newOptions;
		} else {
			const changeEvent = EditorConfiguration2.checkEquals(oldOptions, newOptions);

			if (changeEvent === null) {
				// nothing changed!
				return;
			}

			this.options = newOptions;
			this._onDidChangeFast.fire(changeEvent);
			this._onDidChange.fire(changeEvent);
		}
	}

	public getRawOptions(): IEditorOptions {
		return this._rawOptions;
	}

	private _computeInternalOptions(): ComputedEditorOptions {
		const partialEnv = this._getEnvConfiguration();
		const bareFontInfo = BareFontInfo.createFromValidatedSettings(this._validatedOptions, partialEnv.zoomLevel, this.isSimpleWidget);
		const env: IEnvironmentalOptions = {
			memory: this._computeOptionsMemory,
			outerWidth: partialEnv.outerWidth,
			outerHeight: partialEnv.outerHeight,
			fontInfo: this.readConfiguration(bareFontInfo),
			extraEditorClassName: partialEnv.extraEditorClassName,
			isDominatedByLongLines: this._isDominatedByLongLines,
			viewLineCount: this._viewLineCount,
			lineNumbersDigitCount: this._lineNumbersDigitCount,
			emptySelectionClipboard: partialEnv.emptySelectionClipboard,
			pixelRatio: partialEnv.pixelRatio,
			tabFocusMode: TabFocus.getTabFocusMode(),
			accessibilitySupport: partialEnv.accessibilitySupport
		};
		return EditorConfiguration2.computeOptions(this._validatedOptions, env);
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
					if (!arrays.equals(baseValue, subsetValue)) {
						return false;
					}
					continue;
				}
				if (baseValue && typeof baseValue === 'object' && subsetValue && typeof subsetValue === 'object') {
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

	public updateOptions(_newOptions: IEditorOptions): void {
		if (typeof _newOptions === 'undefined') {
			return;
		}
		const newOptions = deepCloneAndMigrateOptions(_newOptions);
		if (CommonEditorConfiguration._subsetEquals(this._rawOptions, newOptions)) {
			return;
		}
		this._rawOptions = objects.mixin(this._rawOptions, newOptions || {});
		this._readOptions = EditorConfiguration2.readOptions(this._rawOptions);
		this._validatedOptions = EditorConfiguration2.validateOptions(this._readOptions);

		this._recomputeOptions();
	}

	public setIsDominatedByLongLines(isDominatedByLongLines: boolean): void {
		this._isDominatedByLongLines = isDominatedByLongLines;
		this._recomputeOptions();
	}

	public setMaxLineNumber(maxLineNumber: number): void {
		const lineNumbersDigitCount = CommonEditorConfiguration._digitCount(maxLineNumber);
		if (this._lineNumbersDigitCount === lineNumbersDigitCount) {
			return;
		}
		this._lineNumbersDigitCount = lineNumbersDigitCount;
		this._recomputeOptions();
	}

	public setViewLineCount(viewLineCount: number): void {
		if (this._viewLineCount === viewLineCount) {
			return;
		}
		this._viewLineCount = viewLineCount;
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

export const editorConfigurationBaseNode = Object.freeze<IConfigurationNode>({
	id: 'editor',
	order: 5,
	type: 'object',
	title: nls.localize('editorConfigurationTitle', "Editor"),
	scope: ConfigurationScope.LANGUAGE_OVERRIDABLE,
});

const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
const editorConfiguration: IConfigurationNode = {
	...editorConfigurationBaseNode,
	properties: {
		'editor.tabSize': {
			type: 'number',
			default: EDITOR_MODEL_DEFAULTS.tabSize,
			minimum: 1,
			markdownDescription: nls.localize('tabSize', "The number of spaces a tab is equal to. This setting is overridden based on the file contents when `#editor.detectIndentation#` is on.")
		},
		// 'editor.indentSize': {
		// 	'anyOf': [
		// 		{
		// 			type: 'string',
		// 			enum: ['tabSize']
		// 		},
		// 		{
		// 			type: 'number',
		// 			minimum: 1
		// 		}
		// 	],
		// 	default: 'tabSize',
		// 	markdownDescription: nls.localize('indentSize', "The number of spaces used for indentation or 'tabSize' to use the value from `#editor.tabSize#`. This setting is overridden based on the file contents when `#editor.detectIndentation#` is on.")
		// },
		'editor.insertSpaces': {
			type: 'boolean',
			default: EDITOR_MODEL_DEFAULTS.insertSpaces,
			markdownDescription: nls.localize('insertSpaces', "Insert spaces when pressing `Tab`. This setting is overridden based on the file contents when `#editor.detectIndentation#` is on.")
		},
		'editor.detectIndentation': {
			type: 'boolean',
			default: EDITOR_MODEL_DEFAULTS.detectIndentation,
			markdownDescription: nls.localize('detectIndentation', "Controls whether `#editor.tabSize#` and `#editor.insertSpaces#` will be automatically detected when a file is opened based on the file contents.")
		},
		'editor.trimAutoWhitespace': {
			type: 'boolean',
			default: EDITOR_MODEL_DEFAULTS.trimAutoWhitespace,
			description: nls.localize('trimAutoWhitespace', "Remove trailing auto inserted whitespace.")
		},
		'editor.largeFileOptimizations': {
			type: 'boolean',
			default: EDITOR_MODEL_DEFAULTS.largeFileOptimizations,
			description: nls.localize('largeFileOptimizations', "Special handling for large files to disable certain memory intensive features.")
		},
		'editor.wordBasedSuggestions': {
			type: 'boolean',
			default: true,
			description: nls.localize('wordBasedSuggestions', "Controls whether completions should be computed based on words in the document.")
		},
		'editor.wordBasedSuggestionsMode': {
			enum: ['currentDocument', 'matchingDocuments', 'allDocuments'],
			default: 'matchingDocuments',
			enumDescriptions: [
				nls.localize('wordBasedSuggestionsMode.currentDocument', 'Only suggest words from the active document.'),
				nls.localize('wordBasedSuggestionsMode.matchingDocuments', 'Suggest words from all open documents of the same language.'),
				nls.localize('wordBasedSuggestionsMode.allDocuments', 'Suggest words from all open documents.')
			],
			description: nls.localize('wordBasedSuggestionsMode', "Controls form what documents word based completions are computed.")
		},
		'editor.semanticHighlighting.enabled': {
			enum: [true, false, 'configuredByTheme'],
			enumDescriptions: [
				nls.localize('semanticHighlighting.true', 'Semantic highlighting enabled for all color themes.'),
				nls.localize('semanticHighlighting.false', 'Semantic highlighting disabled for all color themes.'),
				nls.localize('semanticHighlighting.configuredByTheme', 'Semantic highlighting is configured by the current color theme\'s `semanticHighlighting` setting.')
			],
			default: 'configuredByTheme',
			description: nls.localize('semanticHighlighting.enabled', "Controls whether the semanticHighlighting is shown for the languages that support it.")
		},
		'editor.stablePeek': {
			type: 'boolean',
			default: false,
			markdownDescription: nls.localize('stablePeek', "Keep peek editors open even when double clicking their content or when hitting `Escape`.")
		},
		'editor.maxTokenizationLineLength': {
			type: 'integer',
			default: 20_000,
			description: nls.localize('maxTokenizationLineLength', "Lines above this length will not be tokenized for performance reasons")
		},
		'diffEditor.maxComputationTime': {
			type: 'number',
			default: 5000,
			description: nls.localize('maxComputationTime', "Timeout in milliseconds after which diff computation is cancelled. Use 0 for no timeout.")
		},
		'diffEditor.renderSideBySide': {
			type: 'boolean',
			default: true,
			description: nls.localize('sideBySide', "Controls whether the diff editor shows the diff side by side or inline.")
		},
		'diffEditor.ignoreTrimWhitespace': {
			type: 'boolean',
			default: true,
			description: nls.localize('ignoreTrimWhitespace', "When enabled, the diff editor ignores changes in leading or trailing whitespace.")
		},
		'diffEditor.renderIndicators': {
			type: 'boolean',
			default: true,
			description: nls.localize('renderIndicators', "Controls whether the diff editor shows +/- indicators for added/removed changes.")
		},
		'diffEditor.codeLens': {
			type: 'boolean',
			default: false,
			description: nls.localize('codeLens', "Controls whether the editor shows CodeLens.")
		},
		'diffEditor.wordWrap': {
			type: 'string',
			enum: ['off', 'on', 'inherit'],
			default: 'inherit',
			markdownEnumDescriptions: [
				nls.localize('wordWrap.off', "Lines will never wrap."),
				nls.localize('wordWrap.on', "Lines will wrap at the viewport width."),
				nls.localize('wordWrap.inherit', "Lines will wrap according to the `#editor.wordWrap#` setting."),
			]
		}
	}
};

function isConfigurationPropertySchema(x: IConfigurationPropertySchema | { [path: string]: IConfigurationPropertySchema; }): x is IConfigurationPropertySchema {
	return (typeof x.type !== 'undefined' || typeof x.anyOf !== 'undefined');
}

// Add properties from the Editor Option Registry
for (const editorOption of editorOptionsRegistry) {
	const schema = editorOption.schema;
	if (typeof schema !== 'undefined') {
		if (isConfigurationPropertySchema(schema)) {
			// This is a single schema contribution
			editorConfiguration.properties![`editor.${editorOption.name}`] = schema;
		} else {
			for (let key in schema) {
				if (hasOwnProperty.call(schema, key)) {
					editorConfiguration.properties![key] = schema[key];
				}
			}
		}
	}
}

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
