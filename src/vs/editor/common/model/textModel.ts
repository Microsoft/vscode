/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import * as strings from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { EDITOR_MODEL_DEFAULTS } from 'vs/editor/common/config/editorOptions';
import { LineTokens } from 'vs/editor/common/core/lineTokens';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import * as model from 'vs/editor/common/model';
import { EditStack } from 'vs/editor/common/model/editStack';
import { guessIndentation } from 'vs/editor/common/model/indentationGuesser';
import { IntervalNode, IntervalTree, getNodeIsInOverviewRuler, recomputeMaxEnd } from 'vs/editor/common/model/intervalTree';
import { PieceTreeTextBufferBuilder } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBufferBuilder';
import { IModelContentChangedEvent, IModelDecorationsChangedEvent, IModelLanguageChangedEvent, IModelLanguageConfigurationChangedEvent, IModelOptionsChangedEvent, IModelTokensChangedEvent, InternalModelContentChangeEvent, ModelRawChange, ModelRawContentChangedEvent, ModelRawEOLChanged, ModelRawFlush, ModelRawLineChanged, ModelRawLinesDeleted, ModelRawLinesInserted } from 'vs/editor/common/model/textModelEvents';
import { SearchData, SearchParams, TextModelSearch } from 'vs/editor/common/model/textModelSearch';
import { TextModelTokenization } from 'vs/editor/common/model/textModelTokens';
import { getWordAtText } from 'vs/editor/common/model/wordHelper';
import { LanguageId, LanguageIdentifier, FormattingOptions } from 'vs/editor/common/modes';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { NULL_LANGUAGE_IDENTIFIER } from 'vs/editor/common/modes/nullMode';
import { ignoreBracketsInToken } from 'vs/editor/common/modes/supports';
import { BracketsUtils, RichEditBracket, RichEditBrackets } from 'vs/editor/common/modes/supports/richEditBrackets';
import { ThemeColor } from 'vs/platform/theme/common/themeService';
import { VSBufferReadableStream, VSBuffer } from 'vs/base/common/buffer';
import { TokensStore, MultilineTokens, countEOL, MultilineTokens2, TokensStore2 } from 'vs/editor/common/model/tokensStore';
import { Color } from 'vs/base/common/color';
import { EditorTheme } from 'vs/editor/common/view/viewContext';
import { IUndoRedoService, ResourceEditStackSnapshot } from 'vs/platform/undoRedo/common/undoRedo';
import { TextChange } from 'vs/editor/common/model/textChange';
import { Constants } from 'vs/base/common/uint';
import { PieceTreeTextBuffer } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeTextBuffer';
import { listenStream } from 'vs/base/common/stream';

function createTextBufferBuilder() {
	return new PieceTreeTextBufferBuilder();
}

export function createTextBufferFactory(text: string): model.ITextBufferFactory {
	const builder = createTextBufferBuilder();
	builder.acceptChunk(text);
	return builder.finish();
}

interface ITextStream {
	on(event: 'data', callback: (data: string) => void): void;
	on(event: 'error', callback: (err: Error) => void): void;
	on(event: 'end', callback: () => void): void;
	on(event: string, callback: any): void;
}

export function createTextBufferFactoryFromStream(stream: ITextStream): Promise<model.ITextBufferFactory>;
export function createTextBufferFactoryFromStream(stream: VSBufferReadableStream): Promise<model.ITextBufferFactory>;
export function createTextBufferFactoryFromStream(stream: ITextStream | VSBufferReadableStream): Promise<model.ITextBufferFactory> {
	return new Promise<model.ITextBufferFactory>((resolve, reject) => {
		const builder = createTextBufferBuilder();

		let done = false;

		listenStream<string | VSBuffer>(stream, {
			onData: chunk => {
				builder.acceptChunk((typeof chunk === 'string') ? chunk : chunk.toString());
			},
			onError: error => {
				if (!done) {
					done = true;
					reject(error);
				}
			},
			onEnd: () => {
				if (!done) {
					done = true;
					resolve(builder.finish());
				}
			}
		});
	});
}

export function createTextBufferFactoryFromSnapshot(snapshot: model.ITextSnapshot): model.ITextBufferFactory {
	let builder = createTextBufferBuilder();

	let chunk: string | null;
	while (typeof (chunk = snapshot.read()) === 'string') {
		builder.acceptChunk(chunk);
	}

	return builder.finish();
}

export function createTextBuffer(value: string | model.ITextBufferFactory, defaultEOL: model.DefaultEndOfLine): { textBuffer: model.ITextBuffer; disposable: IDisposable; } {
	const factory = (typeof value === 'string' ? createTextBufferFactory(value) : value);
	return factory.create(defaultEOL);
}

let MODEL_ID = 0;

const LIMIT_FIND_COUNT = 999;
export const LONG_LINE_BOUNDARY = 10000;

class TextModelSnapshot implements model.ITextSnapshot {

	private readonly _source: model.ITextSnapshot;
	private _eos: boolean;

	constructor(source: model.ITextSnapshot) {
		this._source = source;
		this._eos = false;
	}

	public read(): string | null {
		if (this._eos) {
			return null;
		}

		let result: string[] = [], resultCnt = 0, resultLength = 0;

		do {
			let tmp = this._source.read();

			if (tmp === null) {
				// end-of-stream
				this._eos = true;
				if (resultCnt === 0) {
					return null;
				} else {
					return result.join('');
				}
			}

			if (tmp.length > 0) {
				result[resultCnt++] = tmp;
				resultLength += tmp.length;
			}

			if (resultLength >= 64 * 1024) {
				return result.join('');
			}
		} while (true);
	}
}

const invalidFunc = () => { throw new Error(`Invalid change accessor`); };

const enum StringOffsetValidationType {
	/**
	 * Even allowed in surrogate pairs
	 */
	Relaxed = 0,
	/**
	 * Not allowed in surrogate pairs
	 */
	SurrogatePairs = 1,
}

type ContinueBracketSearchPredicate = null | (() => boolean);

class BracketSearchCanceled {
	public static INSTANCE = new BracketSearchCanceled();
	_searchCanceledBrand = undefined;
	private constructor() { }
}

function stripBracketSearchCanceled<T>(result: T | null | BracketSearchCanceled): T | null {
	if (result instanceof BracketSearchCanceled) {
		return null;
	}
	return result;
}

export class TextModel extends Disposable implements model.ITextModel {

	private static readonly MODEL_SYNC_LIMIT = 50 * 1024 * 1024; // 50 MB
	private static readonly LARGE_FILE_SIZE_THRESHOLD = 20 * 1024 * 1024; // 20 MB;
	private static readonly LARGE_FILE_LINE_COUNT_THRESHOLD = 300 * 1000; // 300K lines

	public static DEFAULT_CREATION_OPTIONS: model.ITextModelCreationOptions = {
		isForSimpleWidget: false,
		tabSize: EDITOR_MODEL_DEFAULTS.tabSize,
		indentSize: EDITOR_MODEL_DEFAULTS.indentSize,
		insertSpaces: EDITOR_MODEL_DEFAULTS.insertSpaces,
		detectIndentation: false,
		defaultEOL: model.DefaultEndOfLine.LF,
		trimAutoWhitespace: EDITOR_MODEL_DEFAULTS.trimAutoWhitespace,
		largeFileOptimizations: EDITOR_MODEL_DEFAULTS.largeFileOptimizations,
	};

	public static resolveOptions(textBuffer: model.ITextBuffer, options: model.ITextModelCreationOptions): model.TextModelResolvedOptions {
		if (options.detectIndentation) {
			const guessedIndentation = guessIndentation(textBuffer, options.tabSize, options.insertSpaces);
			return new model.TextModelResolvedOptions({
				tabSize: guessedIndentation.tabSize,
				indentSize: guessedIndentation.tabSize, // TODO@Alex: guess indentSize independent of tabSize
				insertSpaces: guessedIndentation.insertSpaces,
				trimAutoWhitespace: options.trimAutoWhitespace,
				defaultEOL: options.defaultEOL
			});
		}

		return new model.TextModelResolvedOptions({
			tabSize: options.tabSize,
			indentSize: options.indentSize,
			insertSpaces: options.insertSpaces,
			trimAutoWhitespace: options.trimAutoWhitespace,
			defaultEOL: options.defaultEOL
		});

	}

	//#region Events
	private readonly _onWillDispose: Emitter<void> = this._register(new Emitter<void>());
	public readonly onWillDispose: Event<void> = this._onWillDispose.event;

	private readonly _onDidChangeDecorations: DidChangeDecorationsEmitter = this._register(new DidChangeDecorationsEmitter());
	public readonly onDidChangeDecorations: Event<IModelDecorationsChangedEvent> = this._onDidChangeDecorations.event;

	private readonly _onDidChangeLanguage: Emitter<IModelLanguageChangedEvent> = this._register(new Emitter<IModelLanguageChangedEvent>());
	public readonly onDidChangeLanguage: Event<IModelLanguageChangedEvent> = this._onDidChangeLanguage.event;

	private readonly _onDidChangeLanguageConfiguration: Emitter<IModelLanguageConfigurationChangedEvent> = this._register(new Emitter<IModelLanguageConfigurationChangedEvent>());
	public readonly onDidChangeLanguageConfiguration: Event<IModelLanguageConfigurationChangedEvent> = this._onDidChangeLanguageConfiguration.event;

	private readonly _onDidChangeTokens: Emitter<IModelTokensChangedEvent> = this._register(new Emitter<IModelTokensChangedEvent>());
	public readonly onDidChangeTokens: Event<IModelTokensChangedEvent> = this._onDidChangeTokens.event;

	private readonly _onDidChangeOptions: Emitter<IModelOptionsChangedEvent> = this._register(new Emitter<IModelOptionsChangedEvent>());
	public readonly onDidChangeOptions: Event<IModelOptionsChangedEvent> = this._onDidChangeOptions.event;

	private readonly _onDidChangeAttached: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChangeAttached: Event<void> = this._onDidChangeAttached.event;

	private readonly _eventEmitter: DidChangeContentEmitter = this._register(new DidChangeContentEmitter());
	public onDidChangeRawContentFast(listener: (e: ModelRawContentChangedEvent) => void): IDisposable {
		return this._eventEmitter.fastEvent((e: InternalModelContentChangeEvent) => listener(e.rawContentChangedEvent));
	}
	public onDidChangeRawContent(listener: (e: ModelRawContentChangedEvent) => void): IDisposable {
		return this._eventEmitter.slowEvent((e: InternalModelContentChangeEvent) => listener(e.rawContentChangedEvent));
	}
	public onDidChangeContentFast(listener: (e: IModelContentChangedEvent) => void): IDisposable {
		return this._eventEmitter.fastEvent((e: InternalModelContentChangeEvent) => listener(e.contentChangedEvent));
	}
	public onDidChangeContent(listener: (e: IModelContentChangedEvent) => void): IDisposable {
		return this._eventEmitter.slowEvent((e: InternalModelContentChangeEvent) => listener(e.contentChangedEvent));
	}
	//#endregion

	public readonly id: string;
	public readonly isForSimpleWidget: boolean;
	private readonly _associatedResource: URI;
	private readonly _undoRedoService: IUndoRedoService;
	private _attachedEditorCount: number;
	private _buffer: model.ITextBuffer;
	private _bufferDisposable: IDisposable;
	private _options: model.TextModelResolvedOptions;

	private _isDisposed: boolean;
	private _isDisposing: boolean;
	private _versionId: number;
	/**
	 * Unlike, versionId, this can go down (via undo) or go to previous values (via redo)
	 */
	private _alternativeVersionId: number;
	private _initialUndoRedoSnapshot: ResourceEditStackSnapshot | null;
	private readonly _isTooLargeForSyncing: boolean;
	private readonly _isTooLargeForTokenization: boolean;

	//#region Editing
	private readonly _commandManager: EditStack;
	private _isUndoing: boolean;
	private _isRedoing: boolean;
	private _trimAutoWhitespaceLines: number[] | null;
	//#endregion

	//#region Decorations
	/**
	 * Used to workaround broken clients that might attempt using a decoration id generated by a different model.
	 * It is not globally unique in order to limit it to one character.
	 */
	private readonly _instanceId: string;
	private _lastDecorationId: number;
	private _decorations: { [decorationId: string]: IntervalNode; };
	private _decorationsTree: DecorationsTrees;
	//#endregion

	//#region Tokenization
	private _languageIdentifier: LanguageIdentifier;
	private readonly _languageRegistryListener: IDisposable;
	private readonly _tokens: TokensStore;
	private readonly _tokens2: TokensStore2;
	private readonly _tokenization: TextModelTokenization;
	//#endregion

	constructor(
		source: string | model.ITextBufferFactory,
		creationOptions: model.ITextModelCreationOptions,
		languageIdentifier: LanguageIdentifier | null,
		associatedResource: URI | null = null,
		undoRedoService: IUndoRedoService
	) {
		super();

		// Generate a new unique model id
		MODEL_ID++;
		this.id = '$model' + MODEL_ID;
		this.isForSimpleWidget = creationOptions.isForSimpleWidget;
		if (typeof associatedResource === 'undefined' || associatedResource === null) {
			this._associatedResource = URI.parse('inmemory://model/' + MODEL_ID);
		} else {
			this._associatedResource = associatedResource;
		}
		this._undoRedoService = undoRedoService;
		this._attachedEditorCount = 0;

		const { textBuffer, disposable } = createTextBuffer(source, creationOptions.defaultEOL);
		this._buffer = textBuffer;
		this._bufferDisposable = disposable;

		this._options = TextModel.resolveOptions(this._buffer, creationOptions);

		const bufferLineCount = this._buffer.getLineCount();
		const bufferTextLength = this._buffer.getValueLengthInRange(new Range(1, 1, bufferLineCount, this._buffer.getLineLength(bufferLineCount) + 1), model.EndOfLinePreference.TextDefined);

		// !!! Make a decision in the ctor and permanently respect this decision !!!
		// If a model is too large at construction time, it will never get tokenized,
		// under no circumstances.
		if (creationOptions.largeFileOptimizations) {
			this._isTooLargeForTokenization = (
				(bufferTextLength > TextModel.LARGE_FILE_SIZE_THRESHOLD)
				|| (bufferLineCount > TextModel.LARGE_FILE_LINE_COUNT_THRESHOLD)
			);
		} else {
			this._isTooLargeForTokenization = false;
		}

		this._isTooLargeForSyncing = (bufferTextLength > TextModel.MODEL_SYNC_LIMIT);

		this._versionId = 1;
		this._alternativeVersionId = 1;
		this._initialUndoRedoSnapshot = null;

		this._isDisposed = false;
		this._isDisposing = false;

		this._languageIdentifier = languageIdentifier || NULL_LANGUAGE_IDENTIFIER;

		this._languageRegistryListener = LanguageConfigurationRegistry.onDidChange((e) => {
			if (e.languageIdentifier.id === this._languageIdentifier.id) {
				this._onDidChangeLanguageConfiguration.fire({});
			}
		});

		this._instanceId = strings.singleLetterHash(MODEL_ID);
		this._lastDecorationId = 0;
		this._decorations = Object.create(null);
		this._decorationsTree = new DecorationsTrees();

		this._commandManager = new EditStack(this, undoRedoService);
		this._isUndoing = false;
		this._isRedoing = false;
		this._trimAutoWhitespaceLines = null;

		this._tokens = new TokensStore();
		this._tokens2 = new TokensStore2();
		this._tokenization = new TextModelTokenization(this);
	}

	public override dispose(): void {
		this._isDisposing = true;
		this._onWillDispose.fire();
		this._languageRegistryListener.dispose();
		this._tokenization.dispose();
		this._isDisposed = true;
		super.dispose();
		this._bufferDisposable.dispose();
		this._isDisposing = false;
		// Manually release reference to previous text buffer to avoid large leaks
		// in case someone leaks a TextModel reference
		const emptyDisposedTextBuffer = new PieceTreeTextBuffer([], '', '\n', false, false, true, true);
		emptyDisposedTextBuffer.dispose();
		this._buffer = emptyDisposedTextBuffer;
	}

	private _assertNotDisposed(): void {
		if (this._isDisposed) {
			throw new Error('Model is disposed!');
		}
	}

	public equalsTextBuffer(other: model.ITextBuffer): boolean {
		this._assertNotDisposed();
		return this._buffer.equals(other);
	}

	public getTextBuffer(): model.ITextBuffer {
		this._assertNotDisposed();
		return this._buffer;
	}

	private _emitContentChangedEvent(rawChange: ModelRawContentChangedEvent, change: IModelContentChangedEvent): void {
		if (this._isDisposing) {
			// Do not confuse listeners by emitting any event after disposing
			return;
		}
		this._eventEmitter.fire(new InternalModelContentChangeEvent(rawChange, change));
	}

	public setValue(value: string): void {
		this._assertNotDisposed();
		if (value === null) {
			// There's nothing to do
			return;
		}

		const { textBuffer, disposable } = createTextBuffer(value, this._options.defaultEOL);
		this._setValueFromTextBuffer(textBuffer, disposable);
	}

	private _createContentChanged2(range: Range, rangeOffset: number, rangeLength: number, text: string, isUndoing: boolean, isRedoing: boolean, isFlush: boolean): IModelContentChangedEvent {
		return {
			changes: [{
				range: range,
				rangeOffset: rangeOffset,
				rangeLength: rangeLength,
				text: text,
			}],
			eol: this._buffer.getEOL(),
			versionId: this.getVersionId(),
			isUndoing: isUndoing,
			isRedoing: isRedoing,
			isFlush: isFlush
		};
	}

	private _setValueFromTextBuffer(textBuffer: model.ITextBuffer, textBufferDisposable: IDisposable): void {
		this._assertNotDisposed();
		const oldFullModelRange = this.getFullModelRange();
		const oldModelValueLength = this.getValueLengthInRange(oldFullModelRange);
		const endLineNumber = this.getLineCount();
		const endColumn = this.getLineMaxColumn(endLineNumber);

		this._buffer = textBuffer;
		this._bufferDisposable.dispose();
		this._bufferDisposable = textBufferDisposable;
		this._increaseVersionId();

		// Flush all tokens
		this._tokens.flush();
		this._tokens2.flush();

		// Destroy all my decorations
		this._decorations = Object.create(null);
		this._decorationsTree = new DecorationsTrees();

		// Destroy my edit history and settings
		this._commandManager.clear();
		this._trimAutoWhitespaceLines = null;

		this._emitContentChangedEvent(
			new ModelRawContentChangedEvent(
				[
					new ModelRawFlush()
				],
				this._versionId,
				false,
				false
			),
			this._createContentChanged2(new Range(1, 1, endLineNumber, endColumn), 0, oldModelValueLength, this.getValue(), false, false, true)
		);
	}

	public setEOL(eol: model.EndOfLineSequence): void {
		this._assertNotDisposed();
		const newEOL = (eol === model.EndOfLineSequence.CRLF ? '\r\n' : '\n');
		if (this._buffer.getEOL() === newEOL) {
			// Nothing to do
			return;
		}

		const oldFullModelRange = this.getFullModelRange();
		const oldModelValueLength = this.getValueLengthInRange(oldFullModelRange);
		const endLineNumber = this.getLineCount();
		const endColumn = this.getLineMaxColumn(endLineNumber);

		this._onBeforeEOLChange();
		this._buffer.setEOL(newEOL);
		this._increaseVersionId();
		this._onAfterEOLChange();

		this._emitContentChangedEvent(
			new ModelRawContentChangedEvent(
				[
					new ModelRawEOLChanged()
				],
				this._versionId,
				false,
				false
			),
			this._createContentChanged2(new Range(1, 1, endLineNumber, endColumn), 0, oldModelValueLength, this.getValue(), false, false, false)
		);
	}

	private _onBeforeEOLChange(): void {
		// Ensure all decorations get their `range` set.
		const versionId = this.getVersionId();
		const allDecorations = this._decorationsTree.search(0, false, false, versionId);
		this._ensureNodesHaveRanges(allDecorations);
	}

	private _onAfterEOLChange(): void {
		// Transform back `range` to offsets
		const versionId = this.getVersionId();
		const allDecorations = this._decorationsTree.collectNodesPostOrder();
		for (let i = 0, len = allDecorations.length; i < len; i++) {
			const node = allDecorations[i];

			const delta = node.cachedAbsoluteStart - node.start;

			const startOffset = this._buffer.getOffsetAt(node.range.startLineNumber, node.range.startColumn);
			const endOffset = this._buffer.getOffsetAt(node.range.endLineNumber, node.range.endColumn);

			node.cachedAbsoluteStart = startOffset;
			node.cachedAbsoluteEnd = endOffset;
			node.cachedVersionId = versionId;

			node.start = startOffset - delta;
			node.end = endOffset - delta;

			recomputeMaxEnd(node);
		}
	}

	public onBeforeAttached(): void {
		this._attachedEditorCount++;
		if (this._attachedEditorCount === 1) {
			this._onDidChangeAttached.fire(undefined);
		}
	}

	public onBeforeDetached(): void {
		this._attachedEditorCount--;
		if (this._attachedEditorCount === 0) {
			this._onDidChangeAttached.fire(undefined);
		}
	}

	public isAttachedToEditor(): boolean {
		return this._attachedEditorCount > 0;
	}

	public getAttachedEditorCount(): number {
		return this._attachedEditorCount;
	}

	public isTooLargeForSyncing(): boolean {
		return this._isTooLargeForSyncing;
	}

	public isTooLargeForTokenization(): boolean {
		return this._isTooLargeForTokenization;
	}

	public isDisposed(): boolean {
		return this._isDisposed;
	}

	public isDominatedByLongLines(): boolean {
		this._assertNotDisposed();
		if (this.isTooLargeForTokenization()) {
			// Cannot word wrap huge files anyways, so it doesn't really matter
			return false;
		}
		let smallLineCharCount = 0;
		let longLineCharCount = 0;

		const lineCount = this._buffer.getLineCount();
		for (let lineNumber = 1; lineNumber <= lineCount; lineNumber++) {
			const lineLength = this._buffer.getLineLength(lineNumber);
			if (lineLength >= LONG_LINE_BOUNDARY) {
				longLineCharCount += lineLength;
			} else {
				smallLineCharCount += lineLength;
			}
		}

		return (longLineCharCount > smallLineCharCount);
	}

	public get uri(): URI {
		return this._associatedResource;
	}

	//#region Options

	public getOptions(): model.TextModelResolvedOptions {
		this._assertNotDisposed();
		return this._options;
	}

	public getFormattingOptions(): FormattingOptions {
		return {
			tabSize: this._options.indentSize,
			insertSpaces: this._options.insertSpaces
		};
	}

	public updateOptions(_newOpts: model.ITextModelUpdateOptions): void {
		this._assertNotDisposed();
		let tabSize = (typeof _newOpts.tabSize !== 'undefined') ? _newOpts.tabSize : this._options.tabSize;
		let indentSize = (typeof _newOpts.indentSize !== 'undefined') ? _newOpts.indentSize : this._options.indentSize;
		let insertSpaces = (typeof _newOpts.insertSpaces !== 'undefined') ? _newOpts.insertSpaces : this._options.insertSpaces;
		let trimAutoWhitespace = (typeof _newOpts.trimAutoWhitespace !== 'undefined') ? _newOpts.trimAutoWhitespace : this._options.trimAutoWhitespace;

		let newOpts = new model.TextModelResolvedOptions({
			tabSize: tabSize,
			indentSize: indentSize,
			insertSpaces: insertSpaces,
			defaultEOL: this._options.defaultEOL,
			trimAutoWhitespace: trimAutoWhitespace
		});

		if (this._options.equals(newOpts)) {
			return;
		}

		let e = this._options.createChangeEvent(newOpts);
		this._options = newOpts;

		this._onDidChangeOptions.fire(e);
	}

	public detectIndentation(defaultInsertSpaces: boolean, defaultTabSize: number): void {
		this._assertNotDisposed();
		let guessedIndentation = guessIndentation(this._buffer, defaultTabSize, defaultInsertSpaces);
		this.updateOptions({
			insertSpaces: guessedIndentation.insertSpaces,
			tabSize: guessedIndentation.tabSize,
			indentSize: guessedIndentation.tabSize, // TODO@Alex: guess indentSize independent of tabSize
		});
	}

	private static _normalizeIndentationFromWhitespace(str: string, indentSize: number, insertSpaces: boolean): string {
		let spacesCnt = 0;
		for (let i = 0; i < str.length; i++) {
			if (str.charAt(i) === '\t') {
				spacesCnt += indentSize;
			} else {
				spacesCnt++;
			}
		}

		let result = '';
		if (!insertSpaces) {
			let tabsCnt = Math.floor(spacesCnt / indentSize);
			spacesCnt = spacesCnt % indentSize;
			for (let i = 0; i < tabsCnt; i++) {
				result += '\t';
			}
		}

		for (let i = 0; i < spacesCnt; i++) {
			result += ' ';
		}

		return result;
	}

	public static normalizeIndentation(str: string, indentSize: number, insertSpaces: boolean): string {
		let firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(str);
		if (firstNonWhitespaceIndex === -1) {
			firstNonWhitespaceIndex = str.length;
		}
		return TextModel._normalizeIndentationFromWhitespace(str.substring(0, firstNonWhitespaceIndex), indentSize, insertSpaces) + str.substring(firstNonWhitespaceIndex);
	}

	public normalizeIndentation(str: string): string {
		this._assertNotDisposed();
		return TextModel.normalizeIndentation(str, this._options.indentSize, this._options.insertSpaces);
	}

	//#endregion

	//#region Reading

	public getVersionId(): number {
		this._assertNotDisposed();
		return this._versionId;
	}

	public mightContainRTL(): boolean {
		return this._buffer.mightContainRTL();
	}

	public mightContainUnusualLineTerminators(): boolean {
		return this._buffer.mightContainUnusualLineTerminators();
	}

	public removeUnusualLineTerminators(selections: Selection[] | null = null): void {
		const matches = this.findMatches(strings.UNUSUAL_LINE_TERMINATORS.source, false, true, false, null, false, Constants.MAX_SAFE_SMALL_INTEGER);
		this._buffer.resetMightContainUnusualLineTerminators();
		this.pushEditOperations(selections, matches.map(m => ({ range: m.range, text: null })), () => null);
	}

	public mightContainNonBasicASCII(): boolean {
		return this._buffer.mightContainNonBasicASCII();
	}

	public getAlternativeVersionId(): number {
		this._assertNotDisposed();
		return this._alternativeVersionId;
	}

	public getInitialUndoRedoSnapshot(): ResourceEditStackSnapshot | null {
		this._assertNotDisposed();
		return this._initialUndoRedoSnapshot;
	}

	public getOffsetAt(rawPosition: IPosition): number {
		this._assertNotDisposed();
		let position = this._validatePosition(rawPosition.lineNumber, rawPosition.column, StringOffsetValidationType.Relaxed);
		return this._buffer.getOffsetAt(position.lineNumber, position.column);
	}

	public getPositionAt(rawOffset: number): Position {
		this._assertNotDisposed();
		let offset = (Math.min(this._buffer.getLength(), Math.max(0, rawOffset)));
		return this._buffer.getPositionAt(offset);
	}

	private _increaseVersionId(): void {
		this._versionId = this._versionId + 1;
		this._alternativeVersionId = this._versionId;
	}

	public _overwriteVersionId(versionId: number): void {
		this._versionId = versionId;
	}

	public _overwriteAlternativeVersionId(newAlternativeVersionId: number): void {
		this._alternativeVersionId = newAlternativeVersionId;
	}

	public _overwriteInitialUndoRedoSnapshot(newInitialUndoRedoSnapshot: ResourceEditStackSnapshot | null): void {
		this._initialUndoRedoSnapshot = newInitialUndoRedoSnapshot;
	}

	public getValue(eol?: model.EndOfLinePreference, preserveBOM: boolean = false): string {
		this._assertNotDisposed();
		const fullModelRange = this.getFullModelRange();
		const fullModelValue = this.getValueInRange(fullModelRange, eol);

		if (preserveBOM) {
			return this._buffer.getBOM() + fullModelValue;
		}

		return fullModelValue;
	}

	public createSnapshot(preserveBOM: boolean = false): model.ITextSnapshot {
		return new TextModelSnapshot(this._buffer.createSnapshot(preserveBOM));
	}

	public getValueLength(eol?: model.EndOfLinePreference, preserveBOM: boolean = false): number {
		this._assertNotDisposed();
		const fullModelRange = this.getFullModelRange();
		const fullModelValue = this.getValueLengthInRange(fullModelRange, eol);

		if (preserveBOM) {
			return this._buffer.getBOM().length + fullModelValue;
		}

		return fullModelValue;
	}

	public getValueInRange(rawRange: IRange, eol: model.EndOfLinePreference = model.EndOfLinePreference.TextDefined): string {
		this._assertNotDisposed();
		return this._buffer.getValueInRange(this.validateRange(rawRange), eol);
	}

	public getValueLengthInRange(rawRange: IRange, eol: model.EndOfLinePreference = model.EndOfLinePreference.TextDefined): number {
		this._assertNotDisposed();
		return this._buffer.getValueLengthInRange(this.validateRange(rawRange), eol);
	}

	public getCharacterCountInRange(rawRange: IRange, eol: model.EndOfLinePreference = model.EndOfLinePreference.TextDefined): number {
		this._assertNotDisposed();
		return this._buffer.getCharacterCountInRange(this.validateRange(rawRange), eol);
	}

	public getLineCount(): number {
		this._assertNotDisposed();
		return this._buffer.getLineCount();
	}

	public getLineContent(lineNumber: number): string {
		this._assertNotDisposed();
		if (lineNumber < 1 || lineNumber > this.getLineCount()) {
			throw new Error('Illegal value for lineNumber');
		}

		return this._buffer.getLineContent(lineNumber);
	}

	public getLineLength(lineNumber: number): number {
		this._assertNotDisposed();
		if (lineNumber < 1 || lineNumber > this.getLineCount()) {
			throw new Error('Illegal value for lineNumber');
		}

		return this._buffer.getLineLength(lineNumber);
	}

	public getLinesContent(): string[] {
		this._assertNotDisposed();
		return this._buffer.getLinesContent();
	}

	public getEOL(): string {
		this._assertNotDisposed();
		return this._buffer.getEOL();
	}

	public getEndOfLineSequence(): model.EndOfLineSequence {
		this._assertNotDisposed();
		return (
			this._buffer.getEOL() === '\n'
				? model.EndOfLineSequence.LF
				: model.EndOfLineSequence.CRLF
		);
	}

	public getLineMinColumn(lineNumber: number): number {
		this._assertNotDisposed();
		return 1;
	}

	public getLineMaxColumn(lineNumber: number): number {
		this._assertNotDisposed();
		if (lineNumber < 1 || lineNumber > this.getLineCount()) {
			throw new Error('Illegal value for lineNumber');
		}
		return this._buffer.getLineLength(lineNumber) + 1;
	}

	public getLineFirstNonWhitespaceColumn(lineNumber: number): number {
		this._assertNotDisposed();
		if (lineNumber < 1 || lineNumber > this.getLineCount()) {
			throw new Error('Illegal value for lineNumber');
		}
		return this._buffer.getLineFirstNonWhitespaceColumn(lineNumber);
	}

	public getLineLastNonWhitespaceColumn(lineNumber: number): number {
		this._assertNotDisposed();
		if (lineNumber < 1 || lineNumber > this.getLineCount()) {
			throw new Error('Illegal value for lineNumber');
		}
		return this._buffer.getLineLastNonWhitespaceColumn(lineNumber);
	}

	/**
	 * Validates `range` is within buffer bounds, but allows it to sit in between surrogate pairs, etc.
	 * Will try to not allocate if possible.
	 */
	public _validateRangeRelaxedNoAllocations(range: IRange): Range {
		const linesCount = this._buffer.getLineCount();

		const initialStartLineNumber = range.startLineNumber;
		const initialStartColumn = range.startColumn;
		let startLineNumber = Math.floor((typeof initialStartLineNumber === 'number' && !isNaN(initialStartLineNumber)) ? initialStartLineNumber : 1);
		let startColumn = Math.floor((typeof initialStartColumn === 'number' && !isNaN(initialStartColumn)) ? initialStartColumn : 1);

		if (startLineNumber < 1) {
			startLineNumber = 1;
			startColumn = 1;
		} else if (startLineNumber > linesCount) {
			startLineNumber = linesCount;
			startColumn = this.getLineMaxColumn(startLineNumber);
		} else {
			if (startColumn <= 1) {
				startColumn = 1;
			} else {
				const maxColumn = this.getLineMaxColumn(startLineNumber);
				if (startColumn >= maxColumn) {
					startColumn = maxColumn;
				}
			}
		}

		const initialEndLineNumber = range.endLineNumber;
		const initialEndColumn = range.endColumn;
		let endLineNumber = Math.floor((typeof initialEndLineNumber === 'number' && !isNaN(initialEndLineNumber)) ? initialEndLineNumber : 1);
		let endColumn = Math.floor((typeof initialEndColumn === 'number' && !isNaN(initialEndColumn)) ? initialEndColumn : 1);

		if (endLineNumber < 1) {
			endLineNumber = 1;
			endColumn = 1;
		} else if (endLineNumber > linesCount) {
			endLineNumber = linesCount;
			endColumn = this.getLineMaxColumn(endLineNumber);
		} else {
			if (endColumn <= 1) {
				endColumn = 1;
			} else {
				const maxColumn = this.getLineMaxColumn(endLineNumber);
				if (endColumn >= maxColumn) {
					endColumn = maxColumn;
				}
			}
		}

		if (
			initialStartLineNumber === startLineNumber
			&& initialStartColumn === startColumn
			&& initialEndLineNumber === endLineNumber
			&& initialEndColumn === endColumn
			&& range instanceof Range
			&& !(range instanceof Selection)
		) {
			return range;
		}

		return new Range(startLineNumber, startColumn, endLineNumber, endColumn);
	}

	private _isValidPosition(lineNumber: number, column: number, validationType: StringOffsetValidationType): boolean {
		if (typeof lineNumber !== 'number' || typeof column !== 'number') {
			return false;
		}

		if (isNaN(lineNumber) || isNaN(column)) {
			return false;
		}

		if (lineNumber < 1 || column < 1) {
			return false;
		}

		if ((lineNumber | 0) !== lineNumber || (column | 0) !== column) {
			return false;
		}

		const lineCount = this._buffer.getLineCount();
		if (lineNumber > lineCount) {
			return false;
		}

		if (column === 1) {
			return true;
		}

		const maxColumn = this.getLineMaxColumn(lineNumber);
		if (column > maxColumn) {
			return false;
		}

		if (validationType === StringOffsetValidationType.SurrogatePairs) {
			// !!At this point, column > 1
			const charCodeBefore = this._buffer.getLineCharCode(lineNumber, column - 2);
			if (strings.isHighSurrogate(charCodeBefore)) {
				return false;
			}
		}

		return true;
	}

	private _validatePosition(_lineNumber: number, _column: number, validationType: StringOffsetValidationType): Position {
		const lineNumber = Math.floor((typeof _lineNumber === 'number' && !isNaN(_lineNumber)) ? _lineNumber : 1);
		const column = Math.floor((typeof _column === 'number' && !isNaN(_column)) ? _column : 1);
		const lineCount = this._buffer.getLineCount();

		if (lineNumber < 1) {
			return new Position(1, 1);
		}

		if (lineNumber > lineCount) {
			return new Position(lineCount, this.getLineMaxColumn(lineCount));
		}

		if (column <= 1) {
			return new Position(lineNumber, 1);
		}

		const maxColumn = this.getLineMaxColumn(lineNumber);
		if (column >= maxColumn) {
			return new Position(lineNumber, maxColumn);
		}

		if (validationType === StringOffsetValidationType.SurrogatePairs) {
			// If the position would end up in the middle of a high-low surrogate pair,
			// we move it to before the pair
			// !!At this point, column > 1
			const charCodeBefore = this._buffer.getLineCharCode(lineNumber, column - 2);
			if (strings.isHighSurrogate(charCodeBefore)) {
				return new Position(lineNumber, column - 1);
			}
		}

		return new Position(lineNumber, column);
	}

	public validatePosition(position: IPosition): Position {
		const validationType = StringOffsetValidationType.SurrogatePairs;
		this._assertNotDisposed();

		// Avoid object allocation and cover most likely case
		if (position instanceof Position) {
			if (this._isValidPosition(position.lineNumber, position.column, validationType)) {
				return position;
			}
		}

		return this._validatePosition(position.lineNumber, position.column, validationType);
	}

	private _isValidRange(range: Range, validationType: StringOffsetValidationType): boolean {
		const startLineNumber = range.startLineNumber;
		const startColumn = range.startColumn;
		const endLineNumber = range.endLineNumber;
		const endColumn = range.endColumn;

		if (!this._isValidPosition(startLineNumber, startColumn, StringOffsetValidationType.Relaxed)) {
			return false;
		}
		if (!this._isValidPosition(endLineNumber, endColumn, StringOffsetValidationType.Relaxed)) {
			return false;
		}

		if (validationType === StringOffsetValidationType.SurrogatePairs) {
			const charCodeBeforeStart = (startColumn > 1 ? this._buffer.getLineCharCode(startLineNumber, startColumn - 2) : 0);
			const charCodeBeforeEnd = (endColumn > 1 && endColumn <= this._buffer.getLineLength(endLineNumber) ? this._buffer.getLineCharCode(endLineNumber, endColumn - 2) : 0);

			const startInsideSurrogatePair = strings.isHighSurrogate(charCodeBeforeStart);
			const endInsideSurrogatePair = strings.isHighSurrogate(charCodeBeforeEnd);

			if (!startInsideSurrogatePair && !endInsideSurrogatePair) {
				return true;
			}
			return false;
		}

		return true;
	}

	public validateRange(_range: IRange): Range {
		const validationType = StringOffsetValidationType.SurrogatePairs;
		this._assertNotDisposed();

		// Avoid object allocation and cover most likely case
		if ((_range instanceof Range) && !(_range instanceof Selection)) {
			if (this._isValidRange(_range, validationType)) {
				return _range;
			}
		}

		const start = this._validatePosition(_range.startLineNumber, _range.startColumn, StringOffsetValidationType.Relaxed);
		const end = this._validatePosition(_range.endLineNumber, _range.endColumn, StringOffsetValidationType.Relaxed);

		const startLineNumber = start.lineNumber;
		const startColumn = start.column;
		const endLineNumber = end.lineNumber;
		const endColumn = end.column;

		if (validationType === StringOffsetValidationType.SurrogatePairs) {
			const charCodeBeforeStart = (startColumn > 1 ? this._buffer.getLineCharCode(startLineNumber, startColumn - 2) : 0);
			const charCodeBeforeEnd = (endColumn > 1 && endColumn <= this._buffer.getLineLength(endLineNumber) ? this._buffer.getLineCharCode(endLineNumber, endColumn - 2) : 0);

			const startInsideSurrogatePair = strings.isHighSurrogate(charCodeBeforeStart);
			const endInsideSurrogatePair = strings.isHighSurrogate(charCodeBeforeEnd);

			if (!startInsideSurrogatePair && !endInsideSurrogatePair) {
				return new Range(startLineNumber, startColumn, endLineNumber, endColumn);
			}

			if (startLineNumber === endLineNumber && startColumn === endColumn) {
				// do not expand a collapsed range, simply move it to a valid location
				return new Range(startLineNumber, startColumn - 1, endLineNumber, endColumn - 1);
			}

			if (startInsideSurrogatePair && endInsideSurrogatePair) {
				// expand range at both ends
				return new Range(startLineNumber, startColumn - 1, endLineNumber, endColumn + 1);
			}

			if (startInsideSurrogatePair) {
				// only expand range at the start
				return new Range(startLineNumber, startColumn - 1, endLineNumber, endColumn);
			}

			// only expand range at the end
			return new Range(startLineNumber, startColumn, endLineNumber, endColumn + 1);
		}

		return new Range(startLineNumber, startColumn, endLineNumber, endColumn);
	}

	public modifyPosition(rawPosition: IPosition, offset: number): Position {
		this._assertNotDisposed();
		let candidate = this.getOffsetAt(rawPosition) + offset;
		return this.getPositionAt(Math.min(this._buffer.getLength(), Math.max(0, candidate)));
	}

	public getFullModelRange(): Range {
		this._assertNotDisposed();
		const lineCount = this.getLineCount();
		return new Range(1, 1, lineCount, this.getLineMaxColumn(lineCount));
	}

	private findMatchesLineByLine(searchRange: Range, searchData: SearchData, captureMatches: boolean, limitResultCount: number): model.FindMatch[] {
		return this._buffer.findMatchesLineByLine(searchRange, searchData, captureMatches, limitResultCount);
	}

	public findMatches(searchString: string, rawSearchScope: any, isRegex: boolean, matchCase: boolean, wordSeparators: string | null, captureMatches: boolean, limitResultCount: number = LIMIT_FIND_COUNT): model.FindMatch[] {
		this._assertNotDisposed();

		let searchRanges: Range[] | null = null;

		if (rawSearchScope !== null) {
			if (!Array.isArray(rawSearchScope)) {
				rawSearchScope = [rawSearchScope];
			}

			if (rawSearchScope.every((searchScope: Range) => Range.isIRange(searchScope))) {
				searchRanges = rawSearchScope.map((searchScope: Range) => this.validateRange(searchScope));
			}
		}

		if (searchRanges === null) {
			searchRanges = [this.getFullModelRange()];
		}

		searchRanges = searchRanges.sort((d1, d2) => d1.startLineNumber - d2.startLineNumber || d1.startColumn - d2.startColumn);

		const uniqueSearchRanges: Range[] = [];
		uniqueSearchRanges.push(searchRanges.reduce((prev, curr) => {
			if (Range.areIntersecting(prev, curr)) {
				return prev.plusRange(curr);
			}

			uniqueSearchRanges.push(prev);
			return curr;
		}));

		let matchMapper: (value: Range, index: number, array: Range[]) => model.FindMatch[];
		if (!isRegex && searchString.indexOf('\n') < 0) {
			// not regex, not multi line
			const searchParams = new SearchParams(searchString, isRegex, matchCase, wordSeparators);
			const searchData = searchParams.parseSearchRequest();

			if (!searchData) {
				return [];
			}

			matchMapper = (searchRange: Range) => this.findMatchesLineByLine(searchRange, searchData, captureMatches, limitResultCount);
		} else {
			matchMapper = (searchRange: Range) => TextModelSearch.findMatches(this, new SearchParams(searchString, isRegex, matchCase, wordSeparators), searchRange, captureMatches, limitResultCount);
		}

		return uniqueSearchRanges.map(matchMapper).reduce((arr, matches: model.FindMatch[]) => arr.concat(matches), []);
	}

	public findNextMatch(searchString: string, rawSearchStart: IPosition, isRegex: boolean, matchCase: boolean, wordSeparators: string, captureMatches: boolean): model.FindMatch | null {
		this._assertNotDisposed();
		const searchStart = this.validatePosition(rawSearchStart);

		if (!isRegex && searchString.indexOf('\n') < 0) {
			const searchParams = new SearchParams(searchString, isRegex, matchCase, wordSeparators);
			const searchData = searchParams.parseSearchRequest();
			if (!searchData) {
				return null;
			}

			const lineCount = this.getLineCount();
			let searchRange = new Range(searchStart.lineNumber, searchStart.column, lineCount, this.getLineMaxColumn(lineCount));
			let ret = this.findMatchesLineByLine(searchRange, searchData, captureMatches, 1);
			TextModelSearch.findNextMatch(this, new SearchParams(searchString, isRegex, matchCase, wordSeparators), searchStart, captureMatches);
			if (ret.length > 0) {
				return ret[0];
			}

			searchRange = new Range(1, 1, searchStart.lineNumber, this.getLineMaxColumn(searchStart.lineNumber));
			ret = this.findMatchesLineByLine(searchRange, searchData, captureMatches, 1);

			if (ret.length > 0) {
				return ret[0];
			}

			return null;
		}

		return TextModelSearch.findNextMatch(this, new SearchParams(searchString, isRegex, matchCase, wordSeparators), searchStart, captureMatches);
	}

	public findPreviousMatch(searchString: string, rawSearchStart: IPosition, isRegex: boolean, matchCase: boolean, wordSeparators: string, captureMatches: boolean): model.FindMatch | null {
		this._assertNotDisposed();
		const searchStart = this.validatePosition(rawSearchStart);
		return TextModelSearch.findPreviousMatch(this, new SearchParams(searchString, isRegex, matchCase, wordSeparators), searchStart, captureMatches);
	}

	//#endregion

	//#region Editing

	public pushStackElement(): void {
		this._commandManager.pushStackElement();
	}

	public popStackElement(): void {
		this._commandManager.popStackElement();
	}

	public pushEOL(eol: model.EndOfLineSequence): void {
		const currentEOL = (this.getEOL() === '\n' ? model.EndOfLineSequence.LF : model.EndOfLineSequence.CRLF);
		if (currentEOL === eol) {
			return;
		}
		try {
			this._onDidChangeDecorations.beginDeferredEmit();
			this._eventEmitter.beginDeferredEmit();
			if (this._initialUndoRedoSnapshot === null) {
				this._initialUndoRedoSnapshot = this._undoRedoService.createSnapshot(this.uri);
			}
			this._commandManager.pushEOL(eol);
		} finally {
			this._eventEmitter.endDeferredEmit();
			this._onDidChangeDecorations.endDeferredEmit();
		}
	}

	private _validateEditOperation(rawOperation: model.IIdentifiedSingleEditOperation): model.ValidAnnotatedEditOperation {
		if (rawOperation instanceof model.ValidAnnotatedEditOperation) {
			return rawOperation;
		}
		return new model.ValidAnnotatedEditOperation(
			rawOperation.identifier || null,
			this.validateRange(rawOperation.range),
			rawOperation.text,
			rawOperation.forceMoveMarkers || false,
			rawOperation.isAutoWhitespaceEdit || false,
			rawOperation._isTracked || false
		);
	}

	private _validateEditOperations(rawOperations: model.IIdentifiedSingleEditOperation[]): model.ValidAnnotatedEditOperation[] {
		const result: model.ValidAnnotatedEditOperation[] = [];
		for (let i = 0, len = rawOperations.length; i < len; i++) {
			result[i] = this._validateEditOperation(rawOperations[i]);
		}
		return result;
	}

	public pushEditOperations(beforeCursorState: Selection[] | null, editOperations: model.IIdentifiedSingleEditOperation[], cursorStateComputer: model.ICursorStateComputer | null): Selection[] | null {
		try {
			this._onDidChangeDecorations.beginDeferredEmit();
			this._eventEmitter.beginDeferredEmit();
			return this._pushEditOperations(beforeCursorState, this._validateEditOperations(editOperations), cursorStateComputer);
		} finally {
			this._eventEmitter.endDeferredEmit();
			this._onDidChangeDecorations.endDeferredEmit();
		}
	}

	private _pushEditOperations(beforeCursorState: Selection[] | null, editOperations: model.ValidAnnotatedEditOperation[], cursorStateComputer: model.ICursorStateComputer | null): Selection[] | null {
		if (this._options.trimAutoWhitespace && this._trimAutoWhitespaceLines) {
			// Go through each saved line number and insert a trim whitespace edit
			// if it is safe to do so (no conflicts with other edits).

			let incomingEdits = editOperations.map((op) => {
				return {
					range: this.validateRange(op.range),
					text: op.text
				};
			});

			// Sometimes, auto-formatters change ranges automatically which can cause undesired auto whitespace trimming near the cursor
			// We'll use the following heuristic: if the edits occur near the cursor, then it's ok to trim auto whitespace
			let editsAreNearCursors = true;
			if (beforeCursorState) {
				for (let i = 0, len = beforeCursorState.length; i < len; i++) {
					let sel = beforeCursorState[i];
					let foundEditNearSel = false;
					for (let j = 0, lenJ = incomingEdits.length; j < lenJ; j++) {
						let editRange = incomingEdits[j].range;
						let selIsAbove = editRange.startLineNumber > sel.endLineNumber;
						let selIsBelow = sel.startLineNumber > editRange.endLineNumber;
						if (!selIsAbove && !selIsBelow) {
							foundEditNearSel = true;
							break;
						}
					}
					if (!foundEditNearSel) {
						editsAreNearCursors = false;
						break;
					}
				}
			}

			if (editsAreNearCursors) {
				for (let i = 0, len = this._trimAutoWhitespaceLines.length; i < len; i++) {
					let trimLineNumber = this._trimAutoWhitespaceLines[i];
					let maxLineColumn = this.getLineMaxColumn(trimLineNumber);

					let allowTrimLine = true;
					for (let j = 0, lenJ = incomingEdits.length; j < lenJ; j++) {
						let editRange = incomingEdits[j].range;
						let editText = incomingEdits[j].text;

						if (trimLineNumber < editRange.startLineNumber || trimLineNumber > editRange.endLineNumber) {
							// `trimLine` is completely outside this edit
							continue;
						}

						// At this point:
						//   editRange.startLineNumber <= trimLine <= editRange.endLineNumber

						if (
							trimLineNumber === editRange.startLineNumber && editRange.startColumn === maxLineColumn
							&& editRange.isEmpty() && editText && editText.length > 0 && editText.charAt(0) === '\n'
						) {
							// This edit inserts a new line (and maybe other text) after `trimLine`
							continue;
						}

						if (
							trimLineNumber === editRange.startLineNumber && editRange.startColumn === 1
							&& editRange.isEmpty() && editText && editText.length > 0 && editText.charAt(editText.length - 1) === '\n'
						) {
							// This edit inserts a new line (and maybe other text) before `trimLine`
							continue;
						}

						// Looks like we can't trim this line as it would interfere with an incoming edit
						allowTrimLine = false;
						break;
					}

					if (allowTrimLine) {
						const trimRange = new Range(trimLineNumber, 1, trimLineNumber, maxLineColumn);
						editOperations.push(new model.ValidAnnotatedEditOperation(null, trimRange, null, false, false, false));
					}

				}
			}

			this._trimAutoWhitespaceLines = null;
		}
		if (this._initialUndoRedoSnapshot === null) {
			this._initialUndoRedoSnapshot = this._undoRedoService.createSnapshot(this.uri);
		}
		return this._commandManager.pushEditOperation(beforeCursorState, editOperations, cursorStateComputer);
	}

	_applyUndo(changes: TextChange[], eol: model.EndOfLineSequence, resultingAlternativeVersionId: number, resultingSelection: Selection[] | null): void {
		const edits = changes.map<model.IIdentifiedSingleEditOperation>((change) => {
			const rangeStart = this.getPositionAt(change.newPosition);
			const rangeEnd = this.getPositionAt(change.newEnd);
			return {
				range: new Range(rangeStart.lineNumber, rangeStart.column, rangeEnd.lineNumber, rangeEnd.column),
				text: change.oldText
			};
		});
		this._applyUndoRedoEdits(edits, eol, true, false, resultingAlternativeVersionId, resultingSelection);
	}

	_applyRedo(changes: TextChange[], eol: model.EndOfLineSequence, resultingAlternativeVersionId: number, resultingSelection: Selection[] | null): void {
		const edits = changes.map<model.IIdentifiedSingleEditOperation>((change) => {
			const rangeStart = this.getPositionAt(change.oldPosition);
			const rangeEnd = this.getPositionAt(change.oldEnd);
			return {
				range: new Range(rangeStart.lineNumber, rangeStart.column, rangeEnd.lineNumber, rangeEnd.column),
				text: change.newText
			};
		});
		this._applyUndoRedoEdits(edits, eol, false, true, resultingAlternativeVersionId, resultingSelection);
	}

	private _applyUndoRedoEdits(edits: model.IIdentifiedSingleEditOperation[], eol: model.EndOfLineSequence, isUndoing: boolean, isRedoing: boolean, resultingAlternativeVersionId: number, resultingSelection: Selection[] | null): void {
		try {
			this._onDidChangeDecorations.beginDeferredEmit();
			this._eventEmitter.beginDeferredEmit();
			this._isUndoing = isUndoing;
			this._isRedoing = isRedoing;
			this.applyEdits(edits, false);
			this.setEOL(eol);
			this._overwriteAlternativeVersionId(resultingAlternativeVersionId);
		} finally {
			this._isUndoing = false;
			this._isRedoing = false;
			this._eventEmitter.endDeferredEmit(resultingSelection);
			this._onDidChangeDecorations.endDeferredEmit();
		}
	}

	public applyEdits(operations: model.IIdentifiedSingleEditOperation[]): void;
	public applyEdits(operations: model.IIdentifiedSingleEditOperation[], computeUndoEdits: false): void;
	public applyEdits(operations: model.IIdentifiedSingleEditOperation[], computeUndoEdits: true): model.IValidEditOperation[];
	public applyEdits(rawOperations: model.IIdentifiedSingleEditOperation[], computeUndoEdits: boolean = false): void | model.IValidEditOperation[] {
		try {
			this._onDidChangeDecorations.beginDeferredEmit();
			this._eventEmitter.beginDeferredEmit();
			const operations = this._validateEditOperations(rawOperations);
			return this._doApplyEdits(operations, computeUndoEdits);
		} finally {
			this._eventEmitter.endDeferredEmit();
			this._onDidChangeDecorations.endDeferredEmit();
		}
	}

	private _doApplyEdits(rawOperations: model.ValidAnnotatedEditOperation[], computeUndoEdits: boolean): void | model.IValidEditOperation[] {

		const oldLineCount = this._buffer.getLineCount();
		const result = this._buffer.applyEdits(rawOperations, this._options.trimAutoWhitespace, computeUndoEdits);
		const newLineCount = this._buffer.getLineCount();

		const contentChanges = result.changes;
		this._trimAutoWhitespaceLines = result.trimAutoWhitespaceLineNumbers;

		if (contentChanges.length !== 0) {
			let rawContentChanges: ModelRawChange[] = [];

			let lineCount = oldLineCount;
			for (let i = 0, len = contentChanges.length; i < len; i++) {
				const change = contentChanges[i];
				const [eolCount, firstLineLength, lastLineLength] = countEOL(change.text);
				this._tokens.acceptEdit(change.range, eolCount, firstLineLength);
				this._tokens2.acceptEdit(change.range, eolCount, firstLineLength, lastLineLength, change.text.length > 0 ? change.text.charCodeAt(0) : CharCode.Null);
				this._onDidChangeDecorations.fire();
				this._decorationsTree.acceptReplace(change.rangeOffset, change.rangeLength, change.text.length, change.forceMoveMarkers);

				const startLineNumber = change.range.startLineNumber;
				const endLineNumber = change.range.endLineNumber;

				const deletingLinesCnt = endLineNumber - startLineNumber;
				const insertingLinesCnt = eolCount;
				const editingLinesCnt = Math.min(deletingLinesCnt, insertingLinesCnt);

				const changeLineCountDelta = (insertingLinesCnt - deletingLinesCnt);

				for (let j = editingLinesCnt; j >= 0; j--) {
					const editLineNumber = startLineNumber + j;
					const currentEditLineNumber = newLineCount - lineCount - changeLineCountDelta + editLineNumber;
					rawContentChanges.push(new ModelRawLineChanged(editLineNumber, this.getLineContent(currentEditLineNumber)));
				}

				if (editingLinesCnt < deletingLinesCnt) {
					// Must delete some lines
					const spliceStartLineNumber = startLineNumber + editingLinesCnt;
					rawContentChanges.push(new ModelRawLinesDeleted(spliceStartLineNumber + 1, endLineNumber));
				}

				if (editingLinesCnt < insertingLinesCnt) {
					// Must insert some lines
					const spliceLineNumber = startLineNumber + editingLinesCnt;
					const cnt = insertingLinesCnt - editingLinesCnt;
					const fromLineNumber = newLineCount - lineCount - cnt + spliceLineNumber + 1;
					let newLines: string[] = [];
					for (let i = 0; i < cnt; i++) {
						let lineNumber = fromLineNumber + i;
						newLines[lineNumber - fromLineNumber] = this.getLineContent(lineNumber);
					}
					rawContentChanges.push(new ModelRawLinesInserted(spliceLineNumber + 1, startLineNumber + insertingLinesCnt, newLines));
				}

				lineCount += changeLineCountDelta;
			}

			this._increaseVersionId();

			this._emitContentChangedEvent(
				new ModelRawContentChangedEvent(
					rawContentChanges,
					this.getVersionId(),
					this._isUndoing,
					this._isRedoing
				),
				{
					changes: contentChanges,
					eol: this._buffer.getEOL(),
					versionId: this.getVersionId(),
					isUndoing: this._isUndoing,
					isRedoing: this._isRedoing,
					isFlush: false
				}
			);
		}

		return (result.reverseEdits === null ? undefined : result.reverseEdits);
	}

	public undo(): void | Promise<void> {
		return this._undoRedoService.undo(this.uri);
	}

	public canUndo(): boolean {
		return this._undoRedoService.canUndo(this.uri);
	}

	public redo(): void | Promise<void> {
		return this._undoRedoService.redo(this.uri);
	}

	public canRedo(): boolean {
		return this._undoRedoService.canRedo(this.uri);
	}

	//#endregion

	//#region Decorations

	public changeDecorations<T>(callback: (changeAccessor: model.IModelDecorationsChangeAccessor) => T, ownerId: number = 0): T | null {
		this._assertNotDisposed();

		try {
			this._onDidChangeDecorations.beginDeferredEmit();
			return this._changeDecorations(ownerId, callback);
		} finally {
			this._onDidChangeDecorations.endDeferredEmit();
		}
	}

	private _changeDecorations<T>(ownerId: number, callback: (changeAccessor: model.IModelDecorationsChangeAccessor) => T): T | null {
		let changeAccessor: model.IModelDecorationsChangeAccessor = {
			addDecoration: (range: IRange, options: model.IModelDecorationOptions): string => {
				return this._deltaDecorationsImpl(ownerId, [], [{ range: range, options: options }])[0];
			},
			changeDecoration: (id: string, newRange: IRange): void => {
				this._changeDecorationImpl(id, newRange);
			},
			changeDecorationOptions: (id: string, options: model.IModelDecorationOptions) => {
				this._changeDecorationOptionsImpl(id, _normalizeOptions(options));
			},
			removeDecoration: (id: string): void => {
				this._deltaDecorationsImpl(ownerId, [id], []);
			},
			deltaDecorations: (oldDecorations: string[], newDecorations: model.IModelDeltaDecoration[]): string[] => {
				if (oldDecorations.length === 0 && newDecorations.length === 0) {
					// nothing to do
					return [];
				}
				return this._deltaDecorationsImpl(ownerId, oldDecorations, newDecorations);
			}
		};
		let result: T | null = null;
		try {
			result = callback(changeAccessor);
		} catch (e) {
			onUnexpectedError(e);
		}
		// Invalidate change accessor
		changeAccessor.addDecoration = invalidFunc;
		changeAccessor.changeDecoration = invalidFunc;
		changeAccessor.changeDecorationOptions = invalidFunc;
		changeAccessor.removeDecoration = invalidFunc;
		changeAccessor.deltaDecorations = invalidFunc;
		return result;
	}

	public deltaDecorations(oldDecorations: string[], newDecorations: model.IModelDeltaDecoration[], ownerId: number = 0): string[] {
		this._assertNotDisposed();
		if (!oldDecorations) {
			oldDecorations = [];
		}
		if (oldDecorations.length === 0 && newDecorations.length === 0) {
			// nothing to do
			return [];
		}

		try {
			this._onDidChangeDecorations.beginDeferredEmit();
			return this._deltaDecorationsImpl(ownerId, oldDecorations, newDecorations);
		} finally {
			this._onDidChangeDecorations.endDeferredEmit();
		}
	}

	_getTrackedRange(id: string): Range | null {
		return this.getDecorationRange(id);
	}

	_setTrackedRange(id: string | null, newRange: null, newStickiness: model.TrackedRangeStickiness): null;
	_setTrackedRange(id: string | null, newRange: Range, newStickiness: model.TrackedRangeStickiness): string;
	_setTrackedRange(id: string | null, newRange: Range | null, newStickiness: model.TrackedRangeStickiness): string | null {
		const node = (id ? this._decorations[id] : null);

		if (!node) {
			if (!newRange) {
				// node doesn't exist, the request is to delete => nothing to do
				return null;
			}
			// node doesn't exist, the request is to set => add the tracked range
			return this._deltaDecorationsImpl(0, [], [{ range: newRange, options: TRACKED_RANGE_OPTIONS[newStickiness] }])[0];
		}

		if (!newRange) {
			// node exists, the request is to delete => delete node
			this._decorationsTree.delete(node);
			delete this._decorations[node.id];
			return null;
		}

		// node exists, the request is to set => change the tracked range and its options
		const range = this._validateRangeRelaxedNoAllocations(newRange);
		const startOffset = this._buffer.getOffsetAt(range.startLineNumber, range.startColumn);
		const endOffset = this._buffer.getOffsetAt(range.endLineNumber, range.endColumn);
		this._decorationsTree.delete(node);
		node.reset(this.getVersionId(), startOffset, endOffset, range);
		node.setOptions(TRACKED_RANGE_OPTIONS[newStickiness]);
		this._decorationsTree.insert(node);
		return node.id;
	}

	public removeAllDecorationsWithOwnerId(ownerId: number): void {
		if (this._isDisposed) {
			return;
		}
		const nodes = this._decorationsTree.collectNodesFromOwner(ownerId);
		for (let i = 0, len = nodes.length; i < len; i++) {
			const node = nodes[i];

			this._decorationsTree.delete(node);
			delete this._decorations[node.id];
		}
	}

	public getDecorationOptions(decorationId: string): model.IModelDecorationOptions | null {
		const node = this._decorations[decorationId];
		if (!node) {
			return null;
		}
		return node.options;
	}

	public getDecorationRange(decorationId: string): Range | null {
		const node = this._decorations[decorationId];
		if (!node) {
			return null;
		}
		const versionId = this.getVersionId();
		if (node.cachedVersionId !== versionId) {
			this._decorationsTree.resolveNode(node, versionId);
		}
		if (node.range === null) {
			node.range = this._getRangeAt(node.cachedAbsoluteStart, node.cachedAbsoluteEnd);
		}
		return node.range;
	}

	public getLineDecorations(lineNumber: number, ownerId: number = 0, filterOutValidation: boolean = false): model.IModelDecoration[] {
		if (lineNumber < 1 || lineNumber > this.getLineCount()) {
			return [];
		}

		return this.getLinesDecorations(lineNumber, lineNumber, ownerId, filterOutValidation);
	}

	public getLinesDecorations(_startLineNumber: number, _endLineNumber: number, ownerId: number = 0, filterOutValidation: boolean = false): model.IModelDecoration[] {
		let lineCount = this.getLineCount();
		let startLineNumber = Math.min(lineCount, Math.max(1, _startLineNumber));
		let endLineNumber = Math.min(lineCount, Math.max(1, _endLineNumber));
		let endColumn = this.getLineMaxColumn(endLineNumber);
		return this._getDecorationsInRange(new Range(startLineNumber, 1, endLineNumber, endColumn), ownerId, filterOutValidation);
	}

	public getDecorationsInRange(range: IRange, ownerId: number = 0, filterOutValidation: boolean = false): model.IModelDecoration[] {
		let validatedRange = this.validateRange(range);
		return this._getDecorationsInRange(validatedRange, ownerId, filterOutValidation);
	}

	public getOverviewRulerDecorations(ownerId: number = 0, filterOutValidation: boolean = false): model.IModelDecoration[] {
		const versionId = this.getVersionId();
		const result = this._decorationsTree.search(ownerId, filterOutValidation, true, versionId);
		return this._ensureNodesHaveRanges(result);
	}

	public getAllDecorations(ownerId: number = 0, filterOutValidation: boolean = false): model.IModelDecoration[] {
		const versionId = this.getVersionId();
		const result = this._decorationsTree.search(ownerId, filterOutValidation, false, versionId);
		return this._ensureNodesHaveRanges(result);
	}

	private _getDecorationsInRange(filterRange: Range, filterOwnerId: number, filterOutValidation: boolean): IntervalNode[] {
		const startOffset = this._buffer.getOffsetAt(filterRange.startLineNumber, filterRange.startColumn);
		const endOffset = this._buffer.getOffsetAt(filterRange.endLineNumber, filterRange.endColumn);

		const versionId = this.getVersionId();
		const result = this._decorationsTree.intervalSearch(startOffset, endOffset, filterOwnerId, filterOutValidation, versionId);

		return this._ensureNodesHaveRanges(result);
	}

	private _ensureNodesHaveRanges(nodes: IntervalNode[]): IntervalNode[] {
		for (let i = 0, len = nodes.length; i < len; i++) {
			const node = nodes[i];
			if (node.range === null) {
				node.range = this._getRangeAt(node.cachedAbsoluteStart, node.cachedAbsoluteEnd);
			}
		}
		return nodes;
	}

	private _getRangeAt(start: number, end: number): Range {
		return this._buffer.getRangeAt(start, end - start);
	}

	private _changeDecorationImpl(decorationId: string, _range: IRange): void {
		const node = this._decorations[decorationId];
		if (!node) {
			return;
		}
		const range = this._validateRangeRelaxedNoAllocations(_range);
		const startOffset = this._buffer.getOffsetAt(range.startLineNumber, range.startColumn);
		const endOffset = this._buffer.getOffsetAt(range.endLineNumber, range.endColumn);

		this._decorationsTree.delete(node);
		node.reset(this.getVersionId(), startOffset, endOffset, range);
		this._decorationsTree.insert(node);
		this._onDidChangeDecorations.checkAffectedAndFire(node.options);
	}

	private _changeDecorationOptionsImpl(decorationId: string, options: ModelDecorationOptions): void {
		const node = this._decorations[decorationId];
		if (!node) {
			return;
		}

		const nodeWasInOverviewRuler = (node.options.overviewRuler && node.options.overviewRuler.color ? true : false);
		const nodeIsInOverviewRuler = (options.overviewRuler && options.overviewRuler.color ? true : false);

		this._onDidChangeDecorations.checkAffectedAndFire(node.options);
		this._onDidChangeDecorations.checkAffectedAndFire(options);

		if (nodeWasInOverviewRuler !== nodeIsInOverviewRuler) {
			// Delete + Insert due to an overview ruler status change
			this._decorationsTree.delete(node);
			node.setOptions(options);
			this._decorationsTree.insert(node);
		} else {
			node.setOptions(options);
		}
	}

	private _deltaDecorationsImpl(ownerId: number, oldDecorationsIds: string[], newDecorations: model.IModelDeltaDecoration[]): string[] {
		const versionId = this.getVersionId();

		const oldDecorationsLen = oldDecorationsIds.length;
		let oldDecorationIndex = 0;

		const newDecorationsLen = newDecorations.length;
		let newDecorationIndex = 0;

		let result = new Array<string>(newDecorationsLen);
		while (oldDecorationIndex < oldDecorationsLen || newDecorationIndex < newDecorationsLen) {

			let node: IntervalNode | null = null;

			if (oldDecorationIndex < oldDecorationsLen) {
				// (1) get ourselves an old node
				do {
					node = this._decorations[oldDecorationsIds[oldDecorationIndex++]];
				} while (!node && oldDecorationIndex < oldDecorationsLen);

				// (2) remove the node from the tree (if it exists)
				if (node) {
					this._decorationsTree.delete(node);
					this._onDidChangeDecorations.checkAffectedAndFire(node.options);
				}
			}

			if (newDecorationIndex < newDecorationsLen) {
				// (3) create a new node if necessary
				if (!node) {
					const internalDecorationId = (++this._lastDecorationId);
					const decorationId = `${this._instanceId};${internalDecorationId}`;
					node = new IntervalNode(decorationId, 0, 0);
					this._decorations[decorationId] = node;
				}

				// (4) initialize node
				const newDecoration = newDecorations[newDecorationIndex];
				const range = this._validateRangeRelaxedNoAllocations(newDecoration.range);
				const options = _normalizeOptions(newDecoration.options);
				const startOffset = this._buffer.getOffsetAt(range.startLineNumber, range.startColumn);
				const endOffset = this._buffer.getOffsetAt(range.endLineNumber, range.endColumn);

				node.ownerId = ownerId;
				node.reset(versionId, startOffset, endOffset, range);
				node.setOptions(options);
				this._onDidChangeDecorations.checkAffectedAndFire(options);

				this._decorationsTree.insert(node);

				result[newDecorationIndex] = node.id;

				newDecorationIndex++;
			} else {
				if (node) {
					delete this._decorations[node.id];
				}
			}
		}

		return result;
	}

	//#endregion

	//#region Tokenization

	public setLineTokens(lineNumber: number, tokens: Uint32Array | ArrayBuffer | null): void {
		if (lineNumber < 1 || lineNumber > this.getLineCount()) {
			throw new Error('Illegal value for lineNumber');
		}

		this._tokens.setTokens(this._languageIdentifier.id, lineNumber - 1, this._buffer.getLineLength(lineNumber), tokens, false);
	}

	public setTokens(tokens: MultilineTokens[]): void {
		if (tokens.length === 0) {
			return;
		}

		let ranges: { fromLineNumber: number; toLineNumber: number; }[] = [];

		for (let i = 0, len = tokens.length; i < len; i++) {
			const element = tokens[i];
			let minChangedLineNumber = 0;
			let maxChangedLineNumber = 0;
			let hasChange = false;
			for (let j = 0, lenJ = element.tokens.length; j < lenJ; j++) {
				const lineNumber = element.startLineNumber + j;
				if (hasChange) {
					this._tokens.setTokens(this._languageIdentifier.id, lineNumber - 1, this._buffer.getLineLength(lineNumber), element.tokens[j], false);
					maxChangedLineNumber = lineNumber;
				} else {
					const lineHasChange = this._tokens.setTokens(this._languageIdentifier.id, lineNumber - 1, this._buffer.getLineLength(lineNumber), element.tokens[j], true);
					if (lineHasChange) {
						hasChange = true;
						minChangedLineNumber = lineNumber;
						maxChangedLineNumber = lineNumber;
					}
				}
			}
			if (hasChange) {
				ranges.push({ fromLineNumber: minChangedLineNumber, toLineNumber: maxChangedLineNumber });
			}
		}

		if (ranges.length > 0) {
			this._emitModelTokensChangedEvent({
				tokenizationSupportChanged: false,
				semanticTokensApplied: false,
				ranges: ranges
			});
		}
	}

	public setSemanticTokens(tokens: MultilineTokens2[] | null, isComplete: boolean): void {
		this._tokens2.set(tokens, isComplete);

		this._emitModelTokensChangedEvent({
			tokenizationSupportChanged: false,
			semanticTokensApplied: tokens !== null,
			ranges: [{ fromLineNumber: 1, toLineNumber: this.getLineCount() }]
		});
	}

	public hasCompleteSemanticTokens(): boolean {
		return this._tokens2.isComplete();
	}

	public hasSomeSemanticTokens(): boolean {
		return !this._tokens2.isEmpty();
	}

	public setPartialSemanticTokens(range: Range, tokens: MultilineTokens2[]): void {
		if (this.hasCompleteSemanticTokens()) {
			return;
		}
		const changedRange = this._tokens2.setPartial(range, tokens);

		this._emitModelTokensChangedEvent({
			tokenizationSupportChanged: false,
			semanticTokensApplied: true,
			ranges: [{ fromLineNumber: changedRange.startLineNumber, toLineNumber: changedRange.endLineNumber }]
		});
	}

	public tokenizeViewport(startLineNumber: number, endLineNumber: number): void {
		startLineNumber = Math.max(1, startLineNumber);
		endLineNumber = Math.min(this._buffer.getLineCount(), endLineNumber);
		this._tokenization.tokenizeViewport(startLineNumber, endLineNumber);
	}

	public clearTokens(): void {
		this._tokens.flush();
		this._emitModelTokensChangedEvent({
			tokenizationSupportChanged: true,
			semanticTokensApplied: false,
			ranges: [{
				fromLineNumber: 1,
				toLineNumber: this._buffer.getLineCount()
			}]
		});
	}

	public clearSemanticTokens(): void {
		this._tokens2.flush();

		this._emitModelTokensChangedEvent({
			tokenizationSupportChanged: false,
			semanticTokensApplied: false,
			ranges: [{ fromLineNumber: 1, toLineNumber: this.getLineCount() }]
		});
	}

	private _emitModelTokensChangedEvent(e: IModelTokensChangedEvent): void {
		if (!this._isDisposing) {
			this._onDidChangeTokens.fire(e);
		}
	}

	public resetTokenization(): void {
		this._tokenization.reset();
	}

	public forceTokenization(lineNumber: number): void {
		if (lineNumber < 1 || lineNumber > this.getLineCount()) {
			throw new Error('Illegal value for lineNumber');
		}

		this._tokenization.forceTokenization(lineNumber);
	}

	public isCheapToTokenize(lineNumber: number): boolean {
		return this._tokenization.isCheapToTokenize(lineNumber);
	}

	public tokenizeIfCheap(lineNumber: number): void {
		if (this.isCheapToTokenize(lineNumber)) {
			this.forceTokenization(lineNumber);
		}
	}

	public getLineTokens(lineNumber: number): LineTokens {
		if (lineNumber < 1 || lineNumber > this.getLineCount()) {
			throw new Error('Illegal value for lineNumber');
		}

		return this._getLineTokens(lineNumber);
	}

	private _getLineTokens(lineNumber: number): LineTokens {
		const lineText = this.getLineContent(lineNumber);
		const syntacticTokens = this._tokens.getTokens(this._languageIdentifier.id, lineNumber - 1, lineText);
		return this._tokens2.addSemanticTokens(lineNumber, syntacticTokens);
	}

	public getLanguageIdentifier(): LanguageIdentifier {
		return this._languageIdentifier;
	}

	public getModeId(): string {
		return this._languageIdentifier.language;
	}

	public setMode(languageIdentifier: LanguageIdentifier): void {
		if (this._languageIdentifier.id === languageIdentifier.id) {
			// There's nothing to do
			return;
		}

		let e: IModelLanguageChangedEvent = {
			oldLanguage: this._languageIdentifier.language,
			newLanguage: languageIdentifier.language
		};

		this._languageIdentifier = languageIdentifier;

		this._onDidChangeLanguage.fire(e);
		this._onDidChangeLanguageConfiguration.fire({});
	}

	public getLanguageIdAtPosition(lineNumber: number, column: number): LanguageId {
		const position = this.validatePosition(new Position(lineNumber, column));
		const lineTokens = this.getLineTokens(position.lineNumber);
		return lineTokens.getLanguageId(lineTokens.findTokenIndexAtOffset(position.column - 1));
	}

	// Having tokens allows implementing additional helper methods

	public getWordAtPosition(_position: IPosition): model.IWordAtPosition | null {
		this._assertNotDisposed();
		const position = this.validatePosition(_position);
		const lineContent = this.getLineContent(position.lineNumber);
		const lineTokens = this._getLineTokens(position.lineNumber);
		const tokenIndex = lineTokens.findTokenIndexAtOffset(position.column - 1);

		// (1). First try checking right biased word
		const [rbStartOffset, rbEndOffset] = TextModel._findLanguageBoundaries(lineTokens, tokenIndex);
		const rightBiasedWord = getWordAtText(
			position.column,
			LanguageConfigurationRegistry.getWordDefinition(lineTokens.getLanguageId(tokenIndex)),
			lineContent.substring(rbStartOffset, rbEndOffset),
			rbStartOffset
		);
		// Make sure the result touches the original passed in position
		if (rightBiasedWord && rightBiasedWord.startColumn <= _position.column && _position.column <= rightBiasedWord.endColumn) {
			return rightBiasedWord;
		}

		// (2). Else, if we were at a language boundary, check the left biased word
		if (tokenIndex > 0 && rbStartOffset === position.column - 1) {
			// edge case, where `position` sits between two tokens belonging to two different languages
			const [lbStartOffset, lbEndOffset] = TextModel._findLanguageBoundaries(lineTokens, tokenIndex - 1);
			const leftBiasedWord = getWordAtText(
				position.column,
				LanguageConfigurationRegistry.getWordDefinition(lineTokens.getLanguageId(tokenIndex - 1)),
				lineContent.substring(lbStartOffset, lbEndOffset),
				lbStartOffset
			);
			// Make sure the result touches the original passed in position
			if (leftBiasedWord && leftBiasedWord.startColumn <= _position.column && _position.column <= leftBiasedWord.endColumn) {
				return leftBiasedWord;
			}
		}

		return null;
	}

	private static _findLanguageBoundaries(lineTokens: LineTokens, tokenIndex: number): [number, number] {
		const languageId = lineTokens.getLanguageId(tokenIndex);

		// go left until a different language is hit
		let startOffset = 0;
		for (let i = tokenIndex; i >= 0 && lineTokens.getLanguageId(i) === languageId; i--) {
			startOffset = lineTokens.getStartOffset(i);
		}

		// go right until a different language is hit
		let endOffset = lineTokens.getLineContent().length;
		for (let i = tokenIndex, tokenCount = lineTokens.getCount(); i < tokenCount && lineTokens.getLanguageId(i) === languageId; i++) {
			endOffset = lineTokens.getEndOffset(i);
		}

		return [startOffset, endOffset];
	}

	public getWordUntilPosition(position: IPosition): model.IWordAtPosition {
		const wordAtPosition = this.getWordAtPosition(position);
		if (!wordAtPosition) {
			return {
				word: '',
				startColumn: position.column,
				endColumn: position.column
			};
		}
		return {
			word: wordAtPosition.word.substr(0, position.column - wordAtPosition.startColumn),
			startColumn: wordAtPosition.startColumn,
			endColumn: position.column
		};
	}

	public findMatchingBracketUp(_bracket: string, _position: IPosition): Range | null {
		let bracket = _bracket.toLowerCase();
		let position = this.validatePosition(_position);

		let lineTokens = this._getLineTokens(position.lineNumber);
		let languageId = lineTokens.getLanguageId(lineTokens.findTokenIndexAtOffset(position.column - 1));
		let bracketsSupport = LanguageConfigurationRegistry.getBracketsSupport(languageId);

		if (!bracketsSupport) {
			return null;
		}

		let data = bracketsSupport.textIsBracket[bracket];

		if (!data) {
			return null;
		}

		return stripBracketSearchCanceled(this._findMatchingBracketUp(data, position, null));
	}

	public matchBracket(position: IPosition): [Range, Range] | null {
		return this._matchBracket(this.validatePosition(position));
	}

	private _establishBracketSearchOffsets(position: Position, lineTokens: LineTokens, modeBrackets: RichEditBrackets, tokenIndex: number) {
		const tokenCount = lineTokens.getCount();
		const currentLanguageId = lineTokens.getLanguageId(tokenIndex);

		// limit search to not go before `maxBracketLength`
		let searchStartOffset = Math.max(0, position.column - 1 - modeBrackets.maxBracketLength);
		for (let i = tokenIndex - 1; i >= 0; i--) {
			const tokenEndOffset = lineTokens.getEndOffset(i);
			if (tokenEndOffset <= searchStartOffset) {
				break;
			}
			if (ignoreBracketsInToken(lineTokens.getStandardTokenType(i)) || lineTokens.getLanguageId(i) !== currentLanguageId) {
				searchStartOffset = tokenEndOffset;
				break;
			}
		}

		// limit search to not go after `maxBracketLength`
		let searchEndOffset = Math.min(lineTokens.getLineContent().length, position.column - 1 + modeBrackets.maxBracketLength);
		for (let i = tokenIndex + 1; i < tokenCount; i++) {
			const tokenStartOffset = lineTokens.getStartOffset(i);
			if (tokenStartOffset >= searchEndOffset) {
				break;
			}
			if (ignoreBracketsInToken(lineTokens.getStandardTokenType(i)) || lineTokens.getLanguageId(i) !== currentLanguageId) {
				searchEndOffset = tokenStartOffset;
				break;
			}
		}

		return { searchStartOffset, searchEndOffset };
	}

	private _matchBracket(position: Position): [Range, Range] | null {
		const lineNumber = position.lineNumber;
		const lineTokens = this._getLineTokens(lineNumber);
		const lineText = this._buffer.getLineContent(lineNumber);

		const tokenIndex = lineTokens.findTokenIndexAtOffset(position.column - 1);
		if (tokenIndex < 0) {
			return null;
		}
		const currentModeBrackets = LanguageConfigurationRegistry.getBracketsSupport(lineTokens.getLanguageId(tokenIndex));

		// check that the token is not to be ignored
		if (currentModeBrackets && !ignoreBracketsInToken(lineTokens.getStandardTokenType(tokenIndex))) {

			let { searchStartOffset, searchEndOffset } = this._establishBracketSearchOffsets(position, lineTokens, currentModeBrackets, tokenIndex);

			// it might be the case that [currentTokenStart -> currentTokenEnd] contains multiple brackets
			// `bestResult` will contain the most right-side result
			let bestResult: [Range, Range] | null = null;
			while (true) {
				const foundBracket = BracketsUtils.findNextBracketInRange(currentModeBrackets.forwardRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
				if (!foundBracket) {
					// there are no more brackets in this text
					break;
				}

				// check that we didn't hit a bracket too far away from position
				if (foundBracket.startColumn <= position.column && position.column <= foundBracket.endColumn) {
					const foundBracketText = lineText.substring(foundBracket.startColumn - 1, foundBracket.endColumn - 1).toLowerCase();
					const r = this._matchFoundBracket(foundBracket, currentModeBrackets.textIsBracket[foundBracketText], currentModeBrackets.textIsOpenBracket[foundBracketText], null);
					if (r) {
						if (r instanceof BracketSearchCanceled) {
							return null;
						}
						bestResult = r;
					}
				}

				searchStartOffset = foundBracket.endColumn - 1;
			}

			if (bestResult) {
				return bestResult;
			}
		}

		// If position is in between two tokens, try also looking in the previous token
		if (tokenIndex > 0 && lineTokens.getStartOffset(tokenIndex) === position.column - 1) {
			const prevTokenIndex = tokenIndex - 1;
			const prevModeBrackets = LanguageConfigurationRegistry.getBracketsSupport(lineTokens.getLanguageId(prevTokenIndex));

			// check that previous token is not to be ignored
			if (prevModeBrackets && !ignoreBracketsInToken(lineTokens.getStandardTokenType(prevTokenIndex))) {

				let { searchStartOffset, searchEndOffset } = this._establishBracketSearchOffsets(position, lineTokens, prevModeBrackets, prevTokenIndex);

				const foundBracket = BracketsUtils.findPrevBracketInRange(prevModeBrackets.reversedRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);

				// check that we didn't hit a bracket too far away from position
				if (foundBracket && foundBracket.startColumn <= position.column && position.column <= foundBracket.endColumn) {
					const foundBracketText = lineText.substring(foundBracket.startColumn - 1, foundBracket.endColumn - 1).toLowerCase();
					const r = this._matchFoundBracket(foundBracket, prevModeBrackets.textIsBracket[foundBracketText], prevModeBrackets.textIsOpenBracket[foundBracketText], null);
					if (r) {
						if (r instanceof BracketSearchCanceled) {
							return null;
						}
						return r;
					}
				}
			}
		}

		return null;
	}

	private _matchFoundBracket(foundBracket: Range, data: RichEditBracket, isOpen: boolean, continueSearchPredicate: ContinueBracketSearchPredicate): [Range, Range] | null | BracketSearchCanceled {
		if (!data) {
			return null;
		}

		const matched = (
			isOpen
				? this._findMatchingBracketDown(data, foundBracket.getEndPosition(), continueSearchPredicate)
				: this._findMatchingBracketUp(data, foundBracket.getStartPosition(), continueSearchPredicate)
		);

		if (!matched) {
			return null;
		}

		if (matched instanceof BracketSearchCanceled) {
			return matched;
		}

		return [foundBracket, matched];
	}

	private _findMatchingBracketUp(bracket: RichEditBracket, position: Position, continueSearchPredicate: ContinueBracketSearchPredicate): Range | null | BracketSearchCanceled {
		// console.log('_findMatchingBracketUp: ', 'bracket: ', JSON.stringify(bracket), 'startPosition: ', String(position));

		const languageId = bracket.languageIdentifier.id;
		const reversedBracketRegex = bracket.reversedRegex;
		let count = -1;

		let totalCallCount = 0;
		const searchPrevMatchingBracketInRange = (lineNumber: number, lineText: string, searchStartOffset: number, searchEndOffset: number): Range | null | BracketSearchCanceled => {
			while (true) {
				if (continueSearchPredicate && (++totalCallCount) % 100 === 0 && !continueSearchPredicate()) {
					return BracketSearchCanceled.INSTANCE;
				}
				const r = BracketsUtils.findPrevBracketInRange(reversedBracketRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
				if (!r) {
					break;
				}

				const hitText = lineText.substring(r.startColumn - 1, r.endColumn - 1).toLowerCase();
				if (bracket.isOpen(hitText)) {
					count++;
				} else if (bracket.isClose(hitText)) {
					count--;
				}

				if (count === 0) {
					return r;
				}

				searchEndOffset = r.startColumn - 1;
			}

			return null;
		};

		for (let lineNumber = position.lineNumber; lineNumber >= 1; lineNumber--) {
			const lineTokens = this._getLineTokens(lineNumber);
			const tokenCount = lineTokens.getCount();
			const lineText = this._buffer.getLineContent(lineNumber);

			let tokenIndex = tokenCount - 1;
			let searchStartOffset = lineText.length;
			let searchEndOffset = lineText.length;
			if (lineNumber === position.lineNumber) {
				tokenIndex = lineTokens.findTokenIndexAtOffset(position.column - 1);
				searchStartOffset = position.column - 1;
				searchEndOffset = position.column - 1;
			}

			let prevSearchInToken = true;
			for (; tokenIndex >= 0; tokenIndex--) {
				const searchInToken = (lineTokens.getLanguageId(tokenIndex) === languageId && !ignoreBracketsInToken(lineTokens.getStandardTokenType(tokenIndex)));

				if (searchInToken) {
					// this token should be searched
					if (prevSearchInToken) {
						// the previous token should be searched, simply extend searchStartOffset
						searchStartOffset = lineTokens.getStartOffset(tokenIndex);
					} else {
						// the previous token should not be searched
						searchStartOffset = lineTokens.getStartOffset(tokenIndex);
						searchEndOffset = lineTokens.getEndOffset(tokenIndex);
					}
				} else {
					// this token should not be searched
					if (prevSearchInToken && searchStartOffset !== searchEndOffset) {
						const r = searchPrevMatchingBracketInRange(lineNumber, lineText, searchStartOffset, searchEndOffset);
						if (r) {
							return r;
						}
					}
				}

				prevSearchInToken = searchInToken;
			}

			if (prevSearchInToken && searchStartOffset !== searchEndOffset) {
				const r = searchPrevMatchingBracketInRange(lineNumber, lineText, searchStartOffset, searchEndOffset);
				if (r) {
					return r;
				}
			}
		}

		return null;
	}

	private _findMatchingBracketDown(bracket: RichEditBracket, position: Position, continueSearchPredicate: ContinueBracketSearchPredicate): Range | null | BracketSearchCanceled {
		// console.log('_findMatchingBracketDown: ', 'bracket: ', JSON.stringify(bracket), 'startPosition: ', String(position));

		const languageId = bracket.languageIdentifier.id;
		const bracketRegex = bracket.forwardRegex;
		let count = 1;

		let totalCallCount = 0;
		const searchNextMatchingBracketInRange = (lineNumber: number, lineText: string, searchStartOffset: number, searchEndOffset: number): Range | null | BracketSearchCanceled => {
			while (true) {
				if (continueSearchPredicate && (++totalCallCount) % 100 === 0 && !continueSearchPredicate()) {
					return BracketSearchCanceled.INSTANCE;
				}
				const r = BracketsUtils.findNextBracketInRange(bracketRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
				if (!r) {
					break;
				}

				const hitText = lineText.substring(r.startColumn - 1, r.endColumn - 1).toLowerCase();
				if (bracket.isOpen(hitText)) {
					count++;
				} else if (bracket.isClose(hitText)) {
					count--;
				}

				if (count === 0) {
					return r;
				}

				searchStartOffset = r.endColumn - 1;
			}

			return null;
		};

		const lineCount = this.getLineCount();
		for (let lineNumber = position.lineNumber; lineNumber <= lineCount; lineNumber++) {
			const lineTokens = this._getLineTokens(lineNumber);
			const tokenCount = lineTokens.getCount();
			const lineText = this._buffer.getLineContent(lineNumber);

			let tokenIndex = 0;
			let searchStartOffset = 0;
			let searchEndOffset = 0;
			if (lineNumber === position.lineNumber) {
				tokenIndex = lineTokens.findTokenIndexAtOffset(position.column - 1);
				searchStartOffset = position.column - 1;
				searchEndOffset = position.column - 1;
			}

			let prevSearchInToken = true;
			for (; tokenIndex < tokenCount; tokenIndex++) {
				const searchInToken = (lineTokens.getLanguageId(tokenIndex) === languageId && !ignoreBracketsInToken(lineTokens.getStandardTokenType(tokenIndex)));

				if (searchInToken) {
					// this token should be searched
					if (prevSearchInToken) {
						// the previous token should be searched, simply extend searchEndOffset
						searchEndOffset = lineTokens.getEndOffset(tokenIndex);
					} else {
						// the previous token should not be searched
						searchStartOffset = lineTokens.getStartOffset(tokenIndex);
						searchEndOffset = lineTokens.getEndOffset(tokenIndex);
					}
				} else {
					// this token should not be searched
					if (prevSearchInToken && searchStartOffset !== searchEndOffset) {
						const r = searchNextMatchingBracketInRange(lineNumber, lineText, searchStartOffset, searchEndOffset);
						if (r) {
							return r;
						}
					}
				}

				prevSearchInToken = searchInToken;
			}

			if (prevSearchInToken && searchStartOffset !== searchEndOffset) {
				const r = searchNextMatchingBracketInRange(lineNumber, lineText, searchStartOffset, searchEndOffset);
				if (r) {
					return r;
				}
			}
		}

		return null;
	}

	public findPrevBracket(_position: IPosition): model.IFoundBracket | null {
		const position = this.validatePosition(_position);

		let languageId: LanguageId = -1;
		let modeBrackets: RichEditBrackets | null = null;
		for (let lineNumber = position.lineNumber; lineNumber >= 1; lineNumber--) {
			const lineTokens = this._getLineTokens(lineNumber);
			const tokenCount = lineTokens.getCount();
			const lineText = this._buffer.getLineContent(lineNumber);

			let tokenIndex = tokenCount - 1;
			let searchStartOffset = lineText.length;
			let searchEndOffset = lineText.length;
			if (lineNumber === position.lineNumber) {
				tokenIndex = lineTokens.findTokenIndexAtOffset(position.column - 1);
				searchStartOffset = position.column - 1;
				searchEndOffset = position.column - 1;
				const tokenLanguageId = lineTokens.getLanguageId(tokenIndex);
				if (languageId !== tokenLanguageId) {
					languageId = tokenLanguageId;
					modeBrackets = LanguageConfigurationRegistry.getBracketsSupport(languageId);
				}
			}

			let prevSearchInToken = true;
			for (; tokenIndex >= 0; tokenIndex--) {
				const tokenLanguageId = lineTokens.getLanguageId(tokenIndex);

				if (languageId !== tokenLanguageId) {
					// language id change!
					if (modeBrackets && prevSearchInToken && searchStartOffset !== searchEndOffset) {
						const r = BracketsUtils.findPrevBracketInRange(modeBrackets.reversedRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
						if (r) {
							return this._toFoundBracket(modeBrackets, r);
						}
						prevSearchInToken = false;
					}
					languageId = tokenLanguageId;
					modeBrackets = LanguageConfigurationRegistry.getBracketsSupport(languageId);
				}

				const searchInToken = (!!modeBrackets && !ignoreBracketsInToken(lineTokens.getStandardTokenType(tokenIndex)));

				if (searchInToken) {
					// this token should be searched
					if (prevSearchInToken) {
						// the previous token should be searched, simply extend searchStartOffset
						searchStartOffset = lineTokens.getStartOffset(tokenIndex);
					} else {
						// the previous token should not be searched
						searchStartOffset = lineTokens.getStartOffset(tokenIndex);
						searchEndOffset = lineTokens.getEndOffset(tokenIndex);
					}
				} else {
					// this token should not be searched
					if (modeBrackets && prevSearchInToken && searchStartOffset !== searchEndOffset) {
						const r = BracketsUtils.findPrevBracketInRange(modeBrackets.reversedRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
						if (r) {
							return this._toFoundBracket(modeBrackets, r);
						}
					}
				}

				prevSearchInToken = searchInToken;
			}

			if (modeBrackets && prevSearchInToken && searchStartOffset !== searchEndOffset) {
				const r = BracketsUtils.findPrevBracketInRange(modeBrackets.reversedRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
				if (r) {
					return this._toFoundBracket(modeBrackets, r);
				}
			}
		}

		return null;
	}

	public findNextBracket(_position: IPosition): model.IFoundBracket | null {
		const position = this.validatePosition(_position);
		const lineCount = this.getLineCount();

		let languageId: LanguageId = -1;
		let modeBrackets: RichEditBrackets | null = null;
		for (let lineNumber = position.lineNumber; lineNumber <= lineCount; lineNumber++) {
			const lineTokens = this._getLineTokens(lineNumber);
			const tokenCount = lineTokens.getCount();
			const lineText = this._buffer.getLineContent(lineNumber);

			let tokenIndex = 0;
			let searchStartOffset = 0;
			let searchEndOffset = 0;
			if (lineNumber === position.lineNumber) {
				tokenIndex = lineTokens.findTokenIndexAtOffset(position.column - 1);
				searchStartOffset = position.column - 1;
				searchEndOffset = position.column - 1;
				const tokenLanguageId = lineTokens.getLanguageId(tokenIndex);
				if (languageId !== tokenLanguageId) {
					languageId = tokenLanguageId;
					modeBrackets = LanguageConfigurationRegistry.getBracketsSupport(languageId);
				}
			}

			let prevSearchInToken = true;
			for (; tokenIndex < tokenCount; tokenIndex++) {
				const tokenLanguageId = lineTokens.getLanguageId(tokenIndex);

				if (languageId !== tokenLanguageId) {
					// language id change!
					if (modeBrackets && prevSearchInToken && searchStartOffset !== searchEndOffset) {
						const r = BracketsUtils.findNextBracketInRange(modeBrackets.forwardRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
						if (r) {
							return this._toFoundBracket(modeBrackets, r);
						}
						prevSearchInToken = false;
					}
					languageId = tokenLanguageId;
					modeBrackets = LanguageConfigurationRegistry.getBracketsSupport(languageId);
				}

				const searchInToken = (!!modeBrackets && !ignoreBracketsInToken(lineTokens.getStandardTokenType(tokenIndex)));
				if (searchInToken) {
					// this token should be searched
					if (prevSearchInToken) {
						// the previous token should be searched, simply extend searchEndOffset
						searchEndOffset = lineTokens.getEndOffset(tokenIndex);
					} else {
						// the previous token should not be searched
						searchStartOffset = lineTokens.getStartOffset(tokenIndex);
						searchEndOffset = lineTokens.getEndOffset(tokenIndex);
					}
				} else {
					// this token should not be searched
					if (modeBrackets && prevSearchInToken && searchStartOffset !== searchEndOffset) {
						const r = BracketsUtils.findNextBracketInRange(modeBrackets.forwardRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
						if (r) {
							return this._toFoundBracket(modeBrackets, r);
						}
					}
				}

				prevSearchInToken = searchInToken;
			}

			if (modeBrackets && prevSearchInToken && searchStartOffset !== searchEndOffset) {
				const r = BracketsUtils.findNextBracketInRange(modeBrackets.forwardRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
				if (r) {
					return this._toFoundBracket(modeBrackets, r);
				}
			}
		}

		return null;
	}

	public findEnclosingBrackets(_position: IPosition, maxDuration?: number): [Range, Range] | null {
		let continueSearchPredicate: ContinueBracketSearchPredicate;
		if (typeof maxDuration === 'undefined') {
			continueSearchPredicate = null;
		} else {
			const startTime = Date.now();
			continueSearchPredicate = () => {
				return (Date.now() - startTime <= maxDuration);
			};
		}
		const position = this.validatePosition(_position);
		const lineCount = this.getLineCount();
		const savedCounts = new Map<number, number[]>();

		let counts: number[] = [];
		const resetCounts = (languageId: number, modeBrackets: RichEditBrackets | null) => {
			if (!savedCounts.has(languageId)) {
				let tmp = [];
				for (let i = 0, len = modeBrackets ? modeBrackets.brackets.length : 0; i < len; i++) {
					tmp[i] = 0;
				}
				savedCounts.set(languageId, tmp);
			}
			counts = savedCounts.get(languageId)!;
		};

		let totalCallCount = 0;
		const searchInRange = (modeBrackets: RichEditBrackets, lineNumber: number, lineText: string, searchStartOffset: number, searchEndOffset: number): [Range, Range] | null | BracketSearchCanceled => {
			while (true) {
				if (continueSearchPredicate && (++totalCallCount) % 100 === 0 && !continueSearchPredicate()) {
					return BracketSearchCanceled.INSTANCE;
				}
				const r = BracketsUtils.findNextBracketInRange(modeBrackets.forwardRegex, lineNumber, lineText, searchStartOffset, searchEndOffset);
				if (!r) {
					break;
				}

				const hitText = lineText.substring(r.startColumn - 1, r.endColumn - 1).toLowerCase();
				const bracket = modeBrackets.textIsBracket[hitText];
				if (bracket) {
					if (bracket.isOpen(hitText)) {
						counts[bracket.index]++;
					} else if (bracket.isClose(hitText)) {
						counts[bracket.index]--;
					}

					if (counts[bracket.index] === -1) {
						return this._matchFoundBracket(r, bracket, false, continueSearchPredicate);
					}
				}

				searchStartOffset = r.endColumn - 1;
			}
			return null;
		};

		let languageId: LanguageId = -1;
		let modeBrackets: RichEditBrackets | null = null;
		for (let lineNumber = position.lineNumber; lineNumber <= lineCount; lineNumber++) {
			const lineTokens = this._getLineTokens(lineNumber);
			const tokenCount = lineTokens.getCount();
			const lineText = this._buffer.getLineContent(lineNumber);

			let tokenIndex = 0;
			let searchStartOffset = 0;
			let searchEndOffset = 0;
			if (lineNumber === position.lineNumber) {
				tokenIndex = lineTokens.findTokenIndexAtOffset(position.column - 1);
				searchStartOffset = position.column - 1;
				searchEndOffset = position.column - 1;
				const tokenLanguageId = lineTokens.getLanguageId(tokenIndex);
				if (languageId !== tokenLanguageId) {
					languageId = tokenLanguageId;
					modeBrackets = LanguageConfigurationRegistry.getBracketsSupport(languageId);
					resetCounts(languageId, modeBrackets);
				}
			}

			let prevSearchInToken = true;
			for (; tokenIndex < tokenCount; tokenIndex++) {
				const tokenLanguageId = lineTokens.getLanguageId(tokenIndex);

				if (languageId !== tokenLanguageId) {
					// language id change!
					if (modeBrackets && prevSearchInToken && searchStartOffset !== searchEndOffset) {
						const r = searchInRange(modeBrackets, lineNumber, lineText, searchStartOffset, searchEndOffset);
						if (r) {
							return stripBracketSearchCanceled(r);
						}
						prevSearchInToken = false;
					}
					languageId = tokenLanguageId;
					modeBrackets = LanguageConfigurationRegistry.getBracketsSupport(languageId);
					resetCounts(languageId, modeBrackets);
				}

				const searchInToken = (!!modeBrackets && !ignoreBracketsInToken(lineTokens.getStandardTokenType(tokenIndex)));
				if (searchInToken) {
					// this token should be searched
					if (prevSearchInToken) {
						// the previous token should be searched, simply extend searchEndOffset
						searchEndOffset = lineTokens.getEndOffset(tokenIndex);
					} else {
						// the previous token should not be searched
						searchStartOffset = lineTokens.getStartOffset(tokenIndex);
						searchEndOffset = lineTokens.getEndOffset(tokenIndex);
					}
				} else {
					// this token should not be searched
					if (modeBrackets && prevSearchInToken && searchStartOffset !== searchEndOffset) {
						const r = searchInRange(modeBrackets, lineNumber, lineText, searchStartOffset, searchEndOffset);
						if (r) {
							return stripBracketSearchCanceled(r);
						}
					}
				}

				prevSearchInToken = searchInToken;
			}

			if (modeBrackets && prevSearchInToken && searchStartOffset !== searchEndOffset) {
				const r = searchInRange(modeBrackets, lineNumber, lineText, searchStartOffset, searchEndOffset);
				if (r) {
					return stripBracketSearchCanceled(r);
				}
			}
		}

		return null;
	}

	private _toFoundBracket(modeBrackets: RichEditBrackets, r: Range): model.IFoundBracket | null {
		if (!r) {
			return null;
		}

		let text = this.getValueInRange(r);
		text = text.toLowerCase();

		let data = modeBrackets.textIsBracket[text];
		if (!data) {
			return null;
		}

		return {
			range: r,
			open: data.open,
			close: data.close,
			isOpen: modeBrackets.textIsOpenBracket[text]
		};
	}

	/**
	 * Returns:
	 *  - -1 => the line consists of whitespace
	 *  - otherwise => the indent level is returned value
	 */
	public static computeIndentLevel(line: string, tabSize: number): number {
		let indent = 0;
		let i = 0;
		let len = line.length;

		while (i < len) {
			let chCode = line.charCodeAt(i);
			if (chCode === CharCode.Space) {
				indent++;
			} else if (chCode === CharCode.Tab) {
				indent = indent - indent % tabSize + tabSize;
			} else {
				break;
			}
			i++;
		}

		if (i === len) {
			return -1; // line only consists of whitespace
		}

		return indent;
	}

	private _computeIndentLevel(lineIndex: number): number {
		return TextModel.computeIndentLevel(this._buffer.getLineContent(lineIndex + 1), this._options.tabSize);
	}

	public getActiveIndentGuide(lineNumber: number, minLineNumber: number, maxLineNumber: number): model.IActiveIndentGuideInfo {
		this._assertNotDisposed();
		const lineCount = this.getLineCount();

		if (lineNumber < 1 || lineNumber > lineCount) {
			throw new Error('Illegal value for lineNumber');
		}

		const foldingRules = LanguageConfigurationRegistry.getFoldingRules(this._languageIdentifier.id);
		const offSide = Boolean(foldingRules && foldingRules.offSide);

		let up_aboveContentLineIndex = -2; /* -2 is a marker for not having computed it */
		let up_aboveContentLineIndent = -1;
		let up_belowContentLineIndex = -2; /* -2 is a marker for not having computed it */
		let up_belowContentLineIndent = -1;
		const up_resolveIndents = (lineNumber: number) => {
			if (up_aboveContentLineIndex !== -1 && (up_aboveContentLineIndex === -2 || up_aboveContentLineIndex > lineNumber - 1)) {
				up_aboveContentLineIndex = -1;
				up_aboveContentLineIndent = -1;

				// must find previous line with content
				for (let lineIndex = lineNumber - 2; lineIndex >= 0; lineIndex--) {
					let indent = this._computeIndentLevel(lineIndex);
					if (indent >= 0) {
						up_aboveContentLineIndex = lineIndex;
						up_aboveContentLineIndent = indent;
						break;
					}
				}
			}

			if (up_belowContentLineIndex === -2) {
				up_belowContentLineIndex = -1;
				up_belowContentLineIndent = -1;

				// must find next line with content
				for (let lineIndex = lineNumber; lineIndex < lineCount; lineIndex++) {
					let indent = this._computeIndentLevel(lineIndex);
					if (indent >= 0) {
						up_belowContentLineIndex = lineIndex;
						up_belowContentLineIndent = indent;
						break;
					}
				}
			}
		};

		let down_aboveContentLineIndex = -2; /* -2 is a marker for not having computed it */
		let down_aboveContentLineIndent = -1;
		let down_belowContentLineIndex = -2; /* -2 is a marker for not having computed it */
		let down_belowContentLineIndent = -1;
		const down_resolveIndents = (lineNumber: number) => {
			if (down_aboveContentLineIndex === -2) {
				down_aboveContentLineIndex = -1;
				down_aboveContentLineIndent = -1;

				// must find previous line with content
				for (let lineIndex = lineNumber - 2; lineIndex >= 0; lineIndex--) {
					let indent = this._computeIndentLevel(lineIndex);
					if (indent >= 0) {
						down_aboveContentLineIndex = lineIndex;
						down_aboveContentLineIndent = indent;
						break;
					}
				}
			}

			if (down_belowContentLineIndex !== -1 && (down_belowContentLineIndex === -2 || down_belowContentLineIndex < lineNumber - 1)) {
				down_belowContentLineIndex = -1;
				down_belowContentLineIndent = -1;

				// must find next line with content
				for (let lineIndex = lineNumber; lineIndex < lineCount; lineIndex++) {
					let indent = this._computeIndentLevel(lineIndex);
					if (indent >= 0) {
						down_belowContentLineIndex = lineIndex;
						down_belowContentLineIndent = indent;
						break;
					}
				}
			}
		};

		let startLineNumber = 0;
		let goUp = true;
		let endLineNumber = 0;
		let goDown = true;
		let indent = 0;

		let initialIndent = 0;

		for (let distance = 0; goUp || goDown; distance++) {
			const upLineNumber = lineNumber - distance;
			const downLineNumber = lineNumber + distance;

			if (distance > 1 && (upLineNumber < 1 || upLineNumber < minLineNumber)) {
				goUp = false;
			}
			if (distance > 1 && (downLineNumber > lineCount || downLineNumber > maxLineNumber)) {
				goDown = false;
			}
			if (distance > 50000) {
				// stop processing
				goUp = false;
				goDown = false;
			}

			let upLineIndentLevel: number = -1;
			if (goUp) {
				// compute indent level going up
				const currentIndent = this._computeIndentLevel(upLineNumber - 1);
				if (currentIndent >= 0) {
					// This line has content (besides whitespace)
					// Use the line's indent
					up_belowContentLineIndex = upLineNumber - 1;
					up_belowContentLineIndent = currentIndent;
					upLineIndentLevel = Math.ceil(currentIndent / this._options.indentSize);
				} else {
					up_resolveIndents(upLineNumber);
					upLineIndentLevel = this._getIndentLevelForWhitespaceLine(offSide, up_aboveContentLineIndent, up_belowContentLineIndent);
				}
			}

			let downLineIndentLevel = -1;
			if (goDown) {
				// compute indent level going down
				const currentIndent = this._computeIndentLevel(downLineNumber - 1);
				if (currentIndent >= 0) {
					// This line has content (besides whitespace)
					// Use the line's indent
					down_aboveContentLineIndex = downLineNumber - 1;
					down_aboveContentLineIndent = currentIndent;
					downLineIndentLevel = Math.ceil(currentIndent / this._options.indentSize);
				} else {
					down_resolveIndents(downLineNumber);
					downLineIndentLevel = this._getIndentLevelForWhitespaceLine(offSide, down_aboveContentLineIndent, down_belowContentLineIndent);
				}
			}

			if (distance === 0) {
				initialIndent = upLineIndentLevel;
				continue;
			}

			if (distance === 1) {
				if (downLineNumber <= lineCount && downLineIndentLevel >= 0 && initialIndent + 1 === downLineIndentLevel) {
					// This is the beginning of a scope, we have special handling here, since we want the
					// child scope indent to be active, not the parent scope
					goUp = false;
					startLineNumber = downLineNumber;
					endLineNumber = downLineNumber;
					indent = downLineIndentLevel;
					continue;
				}

				if (upLineNumber >= 1 && upLineIndentLevel >= 0 && upLineIndentLevel - 1 === initialIndent) {
					// This is the end of a scope, just like above
					goDown = false;
					startLineNumber = upLineNumber;
					endLineNumber = upLineNumber;
					indent = upLineIndentLevel;
					continue;
				}

				startLineNumber = lineNumber;
				endLineNumber = lineNumber;
				indent = initialIndent;
				if (indent === 0) {
					// No need to continue
					return { startLineNumber, endLineNumber, indent };
				}
			}

			if (goUp) {
				if (upLineIndentLevel >= indent) {
					startLineNumber = upLineNumber;
				} else {
					goUp = false;
				}
			}
			if (goDown) {
				if (downLineIndentLevel >= indent) {
					endLineNumber = downLineNumber;
				} else {
					goDown = false;
				}
			}
		}

		return { startLineNumber, endLineNumber, indent };
	}

	public getLinesIndentGuides(startLineNumber: number, endLineNumber: number): number[] {
		this._assertNotDisposed();
		const lineCount = this.getLineCount();

		if (startLineNumber < 1 || startLineNumber > lineCount) {
			throw new Error('Illegal value for startLineNumber');
		}
		if (endLineNumber < 1 || endLineNumber > lineCount) {
			throw new Error('Illegal value for endLineNumber');
		}

		const foldingRules = LanguageConfigurationRegistry.getFoldingRules(this._languageIdentifier.id);
		const offSide = Boolean(foldingRules && foldingRules.offSide);

		let result: number[] = new Array<number>(endLineNumber - startLineNumber + 1);

		let aboveContentLineIndex = -2; /* -2 is a marker for not having computed it */
		let aboveContentLineIndent = -1;

		let belowContentLineIndex = -2; /* -2 is a marker for not having computed it */
		let belowContentLineIndent = -1;

		for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
			let resultIndex = lineNumber - startLineNumber;

			const currentIndent = this._computeIndentLevel(lineNumber - 1);
			if (currentIndent >= 0) {
				// This line has content (besides whitespace)
				// Use the line's indent
				aboveContentLineIndex = lineNumber - 1;
				aboveContentLineIndent = currentIndent;
				result[resultIndex] = Math.ceil(currentIndent / this._options.indentSize);
				continue;
			}

			if (aboveContentLineIndex === -2) {
				aboveContentLineIndex = -1;
				aboveContentLineIndent = -1;

				// must find previous line with content
				for (let lineIndex = lineNumber - 2; lineIndex >= 0; lineIndex--) {
					let indent = this._computeIndentLevel(lineIndex);
					if (indent >= 0) {
						aboveContentLineIndex = lineIndex;
						aboveContentLineIndent = indent;
						break;
					}
				}
			}

			if (belowContentLineIndex !== -1 && (belowContentLineIndex === -2 || belowContentLineIndex < lineNumber - 1)) {
				belowContentLineIndex = -1;
				belowContentLineIndent = -1;

				// must find next line with content
				for (let lineIndex = lineNumber; lineIndex < lineCount; lineIndex++) {
					let indent = this._computeIndentLevel(lineIndex);
					if (indent >= 0) {
						belowContentLineIndex = lineIndex;
						belowContentLineIndent = indent;
						break;
					}
				}
			}

			result[resultIndex] = this._getIndentLevelForWhitespaceLine(offSide, aboveContentLineIndent, belowContentLineIndent);

		}
		return result;
	}

	private _getIndentLevelForWhitespaceLine(offSide: boolean, aboveContentLineIndent: number, belowContentLineIndent: number): number {
		if (aboveContentLineIndent === -1 || belowContentLineIndent === -1) {
			// At the top or bottom of the file
			return 0;

		} else if (aboveContentLineIndent < belowContentLineIndent) {
			// we are inside the region above
			return (1 + Math.floor(aboveContentLineIndent / this._options.indentSize));

		} else if (aboveContentLineIndent === belowContentLineIndent) {
			// we are in between two regions
			return Math.ceil(belowContentLineIndent / this._options.indentSize);

		} else {

			if (offSide) {
				// same level as region below
				return Math.ceil(belowContentLineIndent / this._options.indentSize);
			} else {
				// we are inside the region that ends below
				return (1 + Math.floor(belowContentLineIndent / this._options.indentSize));
			}

		}
	}

	//#endregion
}

//#region Decorations

class DecorationsTrees {

	/**
	 * This tree holds decorations that do not show up in the overview ruler.
	 */
	private readonly _decorationsTree0: IntervalTree;

	/**
	 * This tree holds decorations that show up in the overview ruler.
	 */
	private readonly _decorationsTree1: IntervalTree;

	constructor() {
		this._decorationsTree0 = new IntervalTree();
		this._decorationsTree1 = new IntervalTree();
	}

	public intervalSearch(start: number, end: number, filterOwnerId: number, filterOutValidation: boolean, cachedVersionId: number): IntervalNode[] {
		const r0 = this._decorationsTree0.intervalSearch(start, end, filterOwnerId, filterOutValidation, cachedVersionId);
		const r1 = this._decorationsTree1.intervalSearch(start, end, filterOwnerId, filterOutValidation, cachedVersionId);
		return r0.concat(r1);
	}

	public search(filterOwnerId: number, filterOutValidation: boolean, overviewRulerOnly: boolean, cachedVersionId: number): IntervalNode[] {
		if (overviewRulerOnly) {
			return this._decorationsTree1.search(filterOwnerId, filterOutValidation, cachedVersionId);
		} else {
			const r0 = this._decorationsTree0.search(filterOwnerId, filterOutValidation, cachedVersionId);
			const r1 = this._decorationsTree1.search(filterOwnerId, filterOutValidation, cachedVersionId);
			return r0.concat(r1);
		}
	}

	public collectNodesFromOwner(ownerId: number): IntervalNode[] {
		const r0 = this._decorationsTree0.collectNodesFromOwner(ownerId);
		const r1 = this._decorationsTree1.collectNodesFromOwner(ownerId);
		return r0.concat(r1);
	}

	public collectNodesPostOrder(): IntervalNode[] {
		const r0 = this._decorationsTree0.collectNodesPostOrder();
		const r1 = this._decorationsTree1.collectNodesPostOrder();
		return r0.concat(r1);
	}

	public insert(node: IntervalNode): void {
		if (getNodeIsInOverviewRuler(node)) {
			this._decorationsTree1.insert(node);
		} else {
			this._decorationsTree0.insert(node);
		}
	}

	public delete(node: IntervalNode): void {
		if (getNodeIsInOverviewRuler(node)) {
			this._decorationsTree1.delete(node);
		} else {
			this._decorationsTree0.delete(node);
		}
	}

	public resolveNode(node: IntervalNode, cachedVersionId: number): void {
		if (getNodeIsInOverviewRuler(node)) {
			this._decorationsTree1.resolveNode(node, cachedVersionId);
		} else {
			this._decorationsTree0.resolveNode(node, cachedVersionId);
		}
	}

	public acceptReplace(offset: number, length: number, textLength: number, forceMoveMarkers: boolean): void {
		this._decorationsTree0.acceptReplace(offset, length, textLength, forceMoveMarkers);
		this._decorationsTree1.acceptReplace(offset, length, textLength, forceMoveMarkers);
	}
}

function cleanClassName(className: string): string {
	return className.replace(/[^a-z0-9\-_]/gi, ' ');
}

class DecorationOptions implements model.IDecorationOptions {
	readonly color: string | ThemeColor;
	readonly darkColor: string | ThemeColor;

	constructor(options: model.IDecorationOptions) {
		this.color = options.color || '';
		this.darkColor = options.darkColor || '';

	}
}

export class ModelDecorationOverviewRulerOptions extends DecorationOptions {
	readonly position: model.OverviewRulerLane;
	private _resolvedColor: string | null;

	constructor(options: model.IModelDecorationOverviewRulerOptions) {
		super(options);
		this._resolvedColor = null;
		this.position = (typeof options.position === 'number' ? options.position : model.OverviewRulerLane.Center);
	}

	public getColor(theme: EditorTheme): string {
		if (!this._resolvedColor) {
			if (theme.type !== 'light' && this.darkColor) {
				this._resolvedColor = this._resolveColor(this.darkColor, theme);
			} else {
				this._resolvedColor = this._resolveColor(this.color, theme);
			}
		}
		return this._resolvedColor;
	}

	public invalidateCachedColor(): void {
		this._resolvedColor = null;
	}

	private _resolveColor(color: string | ThemeColor, theme: EditorTheme): string {
		if (typeof color === 'string') {
			return color;
		}
		let c = color ? theme.getColor(color.id) : null;
		if (!c) {
			return '';
		}
		return c.toString();
	}
}

export class ModelDecorationMinimapOptions extends DecorationOptions {
	readonly position: model.MinimapPosition;
	private _resolvedColor: Color | undefined;


	constructor(options: model.IModelDecorationMinimapOptions) {
		super(options);
		this.position = options.position;
	}

	public getColor(theme: EditorTheme): Color | undefined {
		if (!this._resolvedColor) {
			if (theme.type !== 'light' && this.darkColor) {
				this._resolvedColor = this._resolveColor(this.darkColor, theme);
			} else {
				this._resolvedColor = this._resolveColor(this.color, theme);
			}
		}

		return this._resolvedColor;
	}

	public invalidateCachedColor(): void {
		this._resolvedColor = undefined;
	}

	private _resolveColor(color: string | ThemeColor, theme: EditorTheme): Color | undefined {
		if (typeof color === 'string') {
			return Color.fromHex(color);
		}
		return theme.getColor(color.id);
	}
}

export class ModelDecorationOptions implements model.IModelDecorationOptions {

	public static EMPTY: ModelDecorationOptions;

	public static register(options: model.IModelDecorationOptions): ModelDecorationOptions {
		return new ModelDecorationOptions(options);
	}

	public static createDynamic(options: model.IModelDecorationOptions): ModelDecorationOptions {
		return new ModelDecorationOptions(options);
	}

	readonly stickiness: model.TrackedRangeStickiness;
	readonly zIndex: number;
	readonly className: string | null;
	readonly hoverMessage: IMarkdownString | IMarkdownString[] | null;
	readonly glyphMarginHoverMessage: IMarkdownString | IMarkdownString[] | null;
	readonly isWholeLine: boolean;
	readonly showIfCollapsed: boolean;
	readonly collapseOnReplaceEdit: boolean;
	readonly overviewRuler: ModelDecorationOverviewRulerOptions | null;
	readonly minimap: ModelDecorationMinimapOptions | null;
	readonly glyphMarginClassName: string | null;
	readonly linesDecorationsClassName: string | null;
	readonly firstLineDecorationClassName: string | null;
	readonly marginClassName: string | null;
	readonly inlineClassName: string | null;
	readonly inlineClassNameAffectsLetterSpacing: boolean;
	readonly beforeContentClassName: string | null;
	readonly afterContentClassName: string | null;

	private constructor(options: model.IModelDecorationOptions) {
		this.stickiness = options.stickiness || model.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges;
		this.zIndex = options.zIndex || 0;
		this.className = options.className ? cleanClassName(options.className) : null;
		this.hoverMessage = options.hoverMessage || null;
		this.glyphMarginHoverMessage = options.glyphMarginHoverMessage || null;
		this.isWholeLine = options.isWholeLine || false;
		this.showIfCollapsed = options.showIfCollapsed || false;
		this.collapseOnReplaceEdit = options.collapseOnReplaceEdit || false;
		this.overviewRuler = options.overviewRuler ? new ModelDecorationOverviewRulerOptions(options.overviewRuler) : null;
		this.minimap = options.minimap ? new ModelDecorationMinimapOptions(options.minimap) : null;
		this.glyphMarginClassName = options.glyphMarginClassName ? cleanClassName(options.glyphMarginClassName) : null;
		this.linesDecorationsClassName = options.linesDecorationsClassName ? cleanClassName(options.linesDecorationsClassName) : null;
		this.firstLineDecorationClassName = options.firstLineDecorationClassName ? cleanClassName(options.firstLineDecorationClassName) : null;
		this.marginClassName = options.marginClassName ? cleanClassName(options.marginClassName) : null;
		this.inlineClassName = options.inlineClassName ? cleanClassName(options.inlineClassName) : null;
		this.inlineClassNameAffectsLetterSpacing = options.inlineClassNameAffectsLetterSpacing || false;
		this.beforeContentClassName = options.beforeContentClassName ? cleanClassName(options.beforeContentClassName) : null;
		this.afterContentClassName = options.afterContentClassName ? cleanClassName(options.afterContentClassName) : null;
	}
}
ModelDecorationOptions.EMPTY = ModelDecorationOptions.register({});

/**
 * The order carefully matches the values of the enum.
 */
const TRACKED_RANGE_OPTIONS = [
	ModelDecorationOptions.register({ stickiness: model.TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges }),
	ModelDecorationOptions.register({ stickiness: model.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }),
	ModelDecorationOptions.register({ stickiness: model.TrackedRangeStickiness.GrowsOnlyWhenTypingBefore }),
	ModelDecorationOptions.register({ stickiness: model.TrackedRangeStickiness.GrowsOnlyWhenTypingAfter }),
];

function _normalizeOptions(options: model.IModelDecorationOptions): ModelDecorationOptions {
	if (options instanceof ModelDecorationOptions) {
		return options;
	}
	return ModelDecorationOptions.createDynamic(options);
}

export class DidChangeDecorationsEmitter extends Disposable {

	private readonly _actual: Emitter<IModelDecorationsChangedEvent> = this._register(new Emitter<IModelDecorationsChangedEvent>());
	public readonly event: Event<IModelDecorationsChangedEvent> = this._actual.event;

	private _deferredCnt: number;
	private _shouldFire: boolean;
	private _affectsMinimap: boolean;
	private _affectsOverviewRuler: boolean;

	constructor() {
		super();
		this._deferredCnt = 0;
		this._shouldFire = false;
		this._affectsMinimap = false;
		this._affectsOverviewRuler = false;
	}

	public beginDeferredEmit(): void {
		this._deferredCnt++;
	}

	public endDeferredEmit(): void {
		this._deferredCnt--;
		if (this._deferredCnt === 0) {
			if (this._shouldFire) {
				const event: IModelDecorationsChangedEvent = {
					affectsMinimap: this._affectsMinimap,
					affectsOverviewRuler: this._affectsOverviewRuler,
				};
				this._shouldFire = false;
				this._affectsMinimap = false;
				this._affectsOverviewRuler = false;
				this._actual.fire(event);
			}
		}
	}

	public checkAffectedAndFire(options: ModelDecorationOptions): void {
		if (!this._affectsMinimap) {
			this._affectsMinimap = options.minimap && options.minimap.position ? true : false;
		}
		if (!this._affectsOverviewRuler) {
			this._affectsOverviewRuler = options.overviewRuler && options.overviewRuler.color ? true : false;
		}
		this._shouldFire = true;
	}

	public fire(): void {
		this._affectsMinimap = true;
		this._affectsOverviewRuler = true;
		this._shouldFire = true;
	}
}

//#endregion

export class DidChangeContentEmitter extends Disposable {

	/**
	 * Both `fastEvent` and `slowEvent` work the same way and contain the same events, but first we invoke `fastEvent` and then `slowEvent`.
	 */
	private readonly _fastEmitter: Emitter<InternalModelContentChangeEvent> = this._register(new Emitter<InternalModelContentChangeEvent>());
	public readonly fastEvent: Event<InternalModelContentChangeEvent> = this._fastEmitter.event;
	private readonly _slowEmitter: Emitter<InternalModelContentChangeEvent> = this._register(new Emitter<InternalModelContentChangeEvent>());
	public readonly slowEvent: Event<InternalModelContentChangeEvent> = this._slowEmitter.event;

	private _deferredCnt: number;
	private _deferredEvent: InternalModelContentChangeEvent | null;

	constructor() {
		super();
		this._deferredCnt = 0;
		this._deferredEvent = null;
	}

	public beginDeferredEmit(): void {
		this._deferredCnt++;
	}

	public endDeferredEmit(resultingSelection: Selection[] | null = null): void {
		this._deferredCnt--;
		if (this._deferredCnt === 0) {
			if (this._deferredEvent !== null) {
				this._deferredEvent.rawContentChangedEvent.resultingSelection = resultingSelection;
				const e = this._deferredEvent;
				this._deferredEvent = null;
				this._fastEmitter.fire(e);
				this._slowEmitter.fire(e);
			}
		}
	}

	public fire(e: InternalModelContentChangeEvent): void {
		if (this._deferredCnt > 0) {
			if (this._deferredEvent) {
				this._deferredEvent = this._deferredEvent.merge(e);
			} else {
				this._deferredEvent = e;
			}
			return;
		}
		this._fastEmitter.fire(e);
		this._slowEmitter.fire(e);
	}
}
