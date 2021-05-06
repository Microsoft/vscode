/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable, DisposableStore, dispose } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import * as errors from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { EDITOR_MODEL_DEFAULTS } from 'vs/editor/common/config/editorOptions';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { DefaultEndOfLine, EndOfLinePreference, EndOfLineSequence, IIdentifiedSingleEditOperation, ITextBuffer, ITextBufferFactory, ITextModel, ITextModelCreationOptions } from 'vs/editor/common/model';
import { TextModel, createTextBuffer } from 'vs/editor/common/model/textModel';
import { IModelLanguageChangedEvent, IModelContentChangedEvent } from 'vs/editor/common/model/textModelEvents';
import { LanguageIdentifier, DocumentSemanticTokensProviderRegistry, DocumentSemanticTokensProvider, SemanticTokens, SemanticTokensEdits } from 'vs/editor/common/modes';
import { PLAINTEXT_LANGUAGE_IDENTIFIER } from 'vs/editor/common/modes/modesRegistry';
import { ILanguageSelection } from 'vs/editor/common/services/modeService';
import { IModelService, DocumentTokensProvider } from 'vs/editor/common/services/modelService';
import { ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { RunOnceScheduler } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ILogService } from 'vs/platform/log/common/log';
import { IUndoRedoService, ResourceEditStackSnapshot } from 'vs/platform/undoRedo/common/undoRedo';
import { StringSHA1 } from 'vs/base/common/hash';
import { EditStackElement, isEditStackElement } from 'vs/editor/common/model/editStack';
import { Schemas } from 'vs/base/common/network';
import { SemanticTokensProviderStyling, toMultilineTokens2 } from 'vs/editor/common/services/semanticTokensProviderStyling';
import { getDocumentSemanticTokens, isSemanticTokens, isSemanticTokensEdits } from 'vs/editor/common/services/getSemanticTokens';

export interface IEditorSemanticHighlightingOptions {
	enabled: true | false | 'configuredByTheme';
}

function MODEL_ID(resource: URI): string {
	return resource.toString();
}

function computeModelSha1(model: ITextModel): string {
	// compute the sha1
	const shaComputer = new StringSHA1();
	const snapshot = model.createSnapshot();
	let text: string | null;
	while ((text = snapshot.read())) {
		shaComputer.update(text);
	}
	return shaComputer.digest();
}


class ModelData implements IDisposable {
	public readonly model: TextModel;

	private _languageSelection: ILanguageSelection | null;
	private _languageSelectionListener: IDisposable | null;

	private readonly _modelEventListeners = new DisposableStore();

	constructor(
		model: TextModel,
		onWillDispose: (model: ITextModel) => void,
		onDidChangeLanguage: (model: ITextModel, e: IModelLanguageChangedEvent) => void
	) {
		this.model = model;

		this._languageSelection = null;
		this._languageSelectionListener = null;

		this._modelEventListeners.add(model.onWillDispose(() => onWillDispose(model)));
		this._modelEventListeners.add(model.onDidChangeLanguage((e) => onDidChangeLanguage(model, e)));
	}

	private _disposeLanguageSelection(): void {
		if (this._languageSelectionListener) {
			this._languageSelectionListener.dispose();
			this._languageSelectionListener = null;
		}
	}

	public dispose(): void {
		this._modelEventListeners.dispose();
		this._disposeLanguageSelection();
	}

	public setLanguage(languageSelection: ILanguageSelection): void {
		this._disposeLanguageSelection();
		this._languageSelection = languageSelection;
		this._languageSelectionListener = this._languageSelection.onDidChange(() => this.model.setMode(languageSelection.languageIdentifier));
		this.model.setMode(languageSelection.languageIdentifier);
	}
}

interface IRawEditorConfig {
	tabSize?: any;
	indentSize?: any;
	insertSpaces?: any;
	detectIndentation?: any;
	trimAutoWhitespace?: any;
	creationOptions?: any;
	largeFileOptimizations?: any;
}

interface IRawConfig {
	eol?: any;
	editor?: IRawEditorConfig;
}

const DEFAULT_EOL = (platform.isLinux || platform.isMacintosh) ? DefaultEndOfLine.LF : DefaultEndOfLine.CRLF;

export interface EditStackPastFutureElements {
	past: EditStackElement[];
	future: EditStackElement[];
}

class DisposedModelInfo {
	constructor(
		public readonly uri: URI,
		public readonly initialUndoRedoSnapshot: ResourceEditStackSnapshot | null,
		public readonly time: number,
		public readonly sharesUndoRedoStack: boolean,
		public readonly heapSize: number,
		public readonly sha1: string,
		public readonly versionId: number,
		public readonly alternativeVersionId: number,
	) { }
}

function schemaShouldMaintainUndoRedoElements(resource: URI) {
	return (
		resource.scheme === Schemas.file
		|| resource.scheme === Schemas.vscodeRemote
		|| resource.scheme === Schemas.userData
		|| resource.scheme === 'fake-fs' // for tests
	);
}

export class ModelServiceImpl extends Disposable implements IModelService {

	public static MAX_MEMORY_FOR_CLOSED_FILES_UNDO_STACK = 20 * 1024 * 1024;

	public _serviceBrand: undefined;

	private readonly _onModelAdded: Emitter<ITextModel> = this._register(new Emitter<ITextModel>());
	public readonly onModelAdded: Event<ITextModel> = this._onModelAdded.event;

	private readonly _onModelRemoved: Emitter<ITextModel> = this._register(new Emitter<ITextModel>());
	public readonly onModelRemoved: Event<ITextModel> = this._onModelRemoved.event;

	private readonly _onModelModeChanged: Emitter<{ model: ITextModel; oldModeId: string; }> = this._register(new Emitter<{ model: ITextModel; oldModeId: string; }>());
	public readonly onModelModeChanged: Event<{ model: ITextModel; oldModeId: string; }> = this._onModelModeChanged.event;

	private _modelCreationOptionsByLanguageAndResource: { [languageAndResource: string]: ITextModelCreationOptions; };

	/**
	 * All the models known in the system.
	 */
	private readonly _models: { [modelId: string]: ModelData; };
	private readonly _disposedModels: Map<string, DisposedModelInfo>;
	private _disposedModelsHeapSize: number;
	private readonly _semanticStyling: SemanticStyling;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITextResourcePropertiesService private readonly _resourcePropertiesService: ITextResourcePropertiesService,
		@IThemeService private readonly _themeService: IThemeService,
		@ILogService private readonly _logService: ILogService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService,
	) {
		super();
		this._modelCreationOptionsByLanguageAndResource = Object.create(null);
		this._models = {};
		this._disposedModels = new Map<string, DisposedModelInfo>();
		this._disposedModelsHeapSize = 0;
		this._semanticStyling = this._register(new SemanticStyling(this._themeService, this._logService));

		this._register(this._configurationService.onDidChangeConfiguration(() => this._updateModelOptions()));
		this._updateModelOptions();

		this._register(new SemanticColoringFeature(this, this._themeService, this._configurationService, this._semanticStyling));
	}

	private static _readModelOptions(config: IRawConfig, isForSimpleWidget: boolean): ITextModelCreationOptions {
		let tabSize = EDITOR_MODEL_DEFAULTS.tabSize;
		if (config.editor && typeof config.editor.tabSize !== 'undefined') {
			const parsedTabSize = parseInt(config.editor.tabSize, 10);
			if (!isNaN(parsedTabSize)) {
				tabSize = parsedTabSize;
			}
			if (tabSize < 1) {
				tabSize = 1;
			}
		}

		let indentSize = tabSize;
		if (config.editor && typeof config.editor.indentSize !== 'undefined' && config.editor.indentSize !== 'tabSize') {
			const parsedIndentSize = parseInt(config.editor.indentSize, 10);
			if (!isNaN(parsedIndentSize)) {
				indentSize = parsedIndentSize;
			}
			if (indentSize < 1) {
				indentSize = 1;
			}
		}

		let insertSpaces = EDITOR_MODEL_DEFAULTS.insertSpaces;
		if (config.editor && typeof config.editor.insertSpaces !== 'undefined') {
			insertSpaces = (config.editor.insertSpaces === 'false' ? false : Boolean(config.editor.insertSpaces));
		}

		let newDefaultEOL = DEFAULT_EOL;
		const eol = config.eol;
		if (eol === '\r\n') {
			newDefaultEOL = DefaultEndOfLine.CRLF;
		} else if (eol === '\n') {
			newDefaultEOL = DefaultEndOfLine.LF;
		}

		let trimAutoWhitespace = EDITOR_MODEL_DEFAULTS.trimAutoWhitespace;
		if (config.editor && typeof config.editor.trimAutoWhitespace !== 'undefined') {
			trimAutoWhitespace = (config.editor.trimAutoWhitespace === 'false' ? false : Boolean(config.editor.trimAutoWhitespace));
		}

		let detectIndentation = EDITOR_MODEL_DEFAULTS.detectIndentation;
		if (config.editor && typeof config.editor.detectIndentation !== 'undefined') {
			detectIndentation = (config.editor.detectIndentation === 'false' ? false : Boolean(config.editor.detectIndentation));
		}

		let largeFileOptimizations = EDITOR_MODEL_DEFAULTS.largeFileOptimizations;
		if (config.editor && typeof config.editor.largeFileOptimizations !== 'undefined') {
			largeFileOptimizations = (config.editor.largeFileOptimizations === 'false' ? false : Boolean(config.editor.largeFileOptimizations));
		}

		return {
			isForSimpleWidget: isForSimpleWidget,
			tabSize: tabSize,
			indentSize: indentSize,
			insertSpaces: insertSpaces,
			detectIndentation: detectIndentation,
			defaultEOL: newDefaultEOL,
			trimAutoWhitespace: trimAutoWhitespace,
			largeFileOptimizations: largeFileOptimizations
		};
	}

	private _getEOL(resource: URI | undefined, language: string): string {
		if (resource) {
			return this._resourcePropertiesService.getEOL(resource, language);
		}
		const eol = this._configurationService.getValue<string>('files.eol', { overrideIdentifier: language });
		if (eol && eol !== 'auto') {
			return eol;
		}
		return platform.OS === platform.OperatingSystem.Linux || platform.OS === platform.OperatingSystem.Macintosh ? '\n' : '\r\n';
	}

	private _shouldRestoreUndoStack(): boolean {
		const result = this._configurationService.getValue<boolean>('files.restoreUndoStack');
		if (typeof result === 'boolean') {
			return result;
		}
		return true;
	}

	public getCreationOptions(language: string, resource: URI | undefined, isForSimpleWidget: boolean): ITextModelCreationOptions {
		let creationOptions = this._modelCreationOptionsByLanguageAndResource[language + resource];
		if (!creationOptions) {
			const editor = this._configurationService.getValue<IRawEditorConfig>('editor', { overrideIdentifier: language, resource });
			const eol = this._getEOL(resource, language);
			creationOptions = ModelServiceImpl._readModelOptions({ editor, eol }, isForSimpleWidget);
			this._modelCreationOptionsByLanguageAndResource[language + resource] = creationOptions;
		}
		return creationOptions;
	}

	private _updateModelOptions(): void {
		const oldOptionsByLanguageAndResource = this._modelCreationOptionsByLanguageAndResource;
		this._modelCreationOptionsByLanguageAndResource = Object.create(null);

		// Update options on all models
		const keys = Object.keys(this._models);
		for (let i = 0, len = keys.length; i < len; i++) {
			const modelId = keys[i];
			const modelData = this._models[modelId];
			const language = modelData.model.getLanguageIdentifier().language;
			const uri = modelData.model.uri;
			const oldOptions = oldOptionsByLanguageAndResource[language + uri];
			const newOptions = this.getCreationOptions(language, uri, modelData.model.isForSimpleWidget);
			ModelServiceImpl._setModelOptionsForModel(modelData.model, newOptions, oldOptions);
		}
	}

	private static _setModelOptionsForModel(model: ITextModel, newOptions: ITextModelCreationOptions, currentOptions: ITextModelCreationOptions): void {
		if (currentOptions && currentOptions.defaultEOL !== newOptions.defaultEOL && model.getLineCount() === 1) {
			model.setEOL(newOptions.defaultEOL === DefaultEndOfLine.LF ? EndOfLineSequence.LF : EndOfLineSequence.CRLF);
		}

		if (currentOptions
			&& (currentOptions.detectIndentation === newOptions.detectIndentation)
			&& (currentOptions.insertSpaces === newOptions.insertSpaces)
			&& (currentOptions.tabSize === newOptions.tabSize)
			&& (currentOptions.indentSize === newOptions.indentSize)
			&& (currentOptions.trimAutoWhitespace === newOptions.trimAutoWhitespace)
		) {
			// Same indent opts, no need to touch the model
			return;
		}

		if (newOptions.detectIndentation) {
			model.detectIndentation(newOptions.insertSpaces, newOptions.tabSize);
			model.updateOptions({
				trimAutoWhitespace: newOptions.trimAutoWhitespace
			});
		} else {
			model.updateOptions({
				insertSpaces: newOptions.insertSpaces,
				tabSize: newOptions.tabSize,
				indentSize: newOptions.indentSize,
				trimAutoWhitespace: newOptions.trimAutoWhitespace
			});
		}
	}

	// --- begin IModelService

	private _insertDisposedModel(disposedModelData: DisposedModelInfo): void {
		this._disposedModels.set(MODEL_ID(disposedModelData.uri), disposedModelData);
		this._disposedModelsHeapSize += disposedModelData.heapSize;
	}

	private _removeDisposedModel(resource: URI): DisposedModelInfo | undefined {
		const disposedModelData = this._disposedModels.get(MODEL_ID(resource));
		if (disposedModelData) {
			this._disposedModelsHeapSize -= disposedModelData.heapSize;
		}
		this._disposedModels.delete(MODEL_ID(resource));
		return disposedModelData;
	}

	private _ensureDisposedModelsHeapSize(maxModelsHeapSize: number): void {
		if (this._disposedModelsHeapSize > maxModelsHeapSize) {
			// we must remove some old undo stack elements to free up some memory
			const disposedModels: DisposedModelInfo[] = [];
			this._disposedModels.forEach(entry => {
				if (!entry.sharesUndoRedoStack) {
					disposedModels.push(entry);
				}
			});
			disposedModels.sort((a, b) => a.time - b.time);
			while (disposedModels.length > 0 && this._disposedModelsHeapSize > maxModelsHeapSize) {
				const disposedModel = disposedModels.shift()!;
				this._removeDisposedModel(disposedModel.uri);
				if (disposedModel.initialUndoRedoSnapshot !== null) {
					this._undoRedoService.restoreSnapshot(disposedModel.initialUndoRedoSnapshot);
				}
			}
		}
	}

	private _createModelData(value: string | ITextBufferFactory, languageIdentifier: LanguageIdentifier, resource: URI | undefined, isForSimpleWidget: boolean): ModelData {
		// create & save the model
		const options = this.getCreationOptions(languageIdentifier.language, resource, isForSimpleWidget);
		const model: TextModel = new TextModel(value, options, languageIdentifier, resource, this._undoRedoService);
		if (resource && this._disposedModels.has(MODEL_ID(resource))) {
			const disposedModelData = this._removeDisposedModel(resource)!;
			const elements = this._undoRedoService.getElements(resource);
			const sha1IsEqual = (computeModelSha1(model) === disposedModelData.sha1);
			if (sha1IsEqual || disposedModelData.sharesUndoRedoStack) {
				for (const element of elements.past) {
					if (isEditStackElement(element) && element.matchesResource(resource)) {
						element.setModel(model);
					}
				}
				for (const element of elements.future) {
					if (isEditStackElement(element) && element.matchesResource(resource)) {
						element.setModel(model);
					}
				}
				this._undoRedoService.setElementsValidFlag(resource, true, (element) => (isEditStackElement(element) && element.matchesResource(resource)));
				if (sha1IsEqual) {
					model._overwriteVersionId(disposedModelData.versionId);
					model._overwriteAlternativeVersionId(disposedModelData.alternativeVersionId);
					model._overwriteInitialUndoRedoSnapshot(disposedModelData.initialUndoRedoSnapshot);
				}
			} else {
				if (disposedModelData.initialUndoRedoSnapshot !== null) {
					this._undoRedoService.restoreSnapshot(disposedModelData.initialUndoRedoSnapshot);
				}
			}
		}
		const modelId = MODEL_ID(model.uri);

		if (this._models[modelId]) {
			// There already exists a model with this id => this is a programmer error
			throw new Error('ModelService: Cannot add model because it already exists!');
		}

		const modelData = new ModelData(
			model,
			(model) => this._onWillDispose(model),
			(model, e) => this._onDidChangeLanguage(model, e)
		);
		this._models[modelId] = modelData;

		return modelData;
	}

	public updateModel(model: ITextModel, value: string | ITextBufferFactory): void {
		const options = this.getCreationOptions(model.getLanguageIdentifier().language, model.uri, model.isForSimpleWidget);
		const { textBuffer, disposable } = createTextBuffer(value, options.defaultEOL);

		// Return early if the text is already set in that form
		if (model.equalsTextBuffer(textBuffer)) {
			disposable.dispose();
			return;
		}

		// Otherwise find a diff between the values and update model
		model.pushStackElement();
		model.pushEOL(textBuffer.getEOL() === '\r\n' ? EndOfLineSequence.CRLF : EndOfLineSequence.LF);
		model.pushEditOperations(
			[],
			ModelServiceImpl._computeEdits(model, textBuffer),
			() => []
		);
		model.pushStackElement();
		disposable.dispose();
	}

	private static _commonPrefix(a: ILineSequence, aLen: number, aDelta: number, b: ILineSequence, bLen: number, bDelta: number): number {
		const maxResult = Math.min(aLen, bLen);

		let result = 0;
		for (let i = 0; i < maxResult && a.getLineContent(aDelta + i) === b.getLineContent(bDelta + i); i++) {
			result++;
		}
		return result;
	}

	private static _commonSuffix(a: ILineSequence, aLen: number, aDelta: number, b: ILineSequence, bLen: number, bDelta: number): number {
		const maxResult = Math.min(aLen, bLen);

		let result = 0;
		for (let i = 0; i < maxResult && a.getLineContent(aDelta + aLen - i) === b.getLineContent(bDelta + bLen - i); i++) {
			result++;
		}
		return result;
	}

	/**
	 * Compute edits to bring `model` to the state of `textSource`.
	 */
	public static _computeEdits(model: ITextModel, textBuffer: ITextBuffer): IIdentifiedSingleEditOperation[] {
		const modelLineCount = model.getLineCount();
		const textBufferLineCount = textBuffer.getLineCount();
		const commonPrefix = this._commonPrefix(model, modelLineCount, 1, textBuffer, textBufferLineCount, 1);

		if (modelLineCount === textBufferLineCount && commonPrefix === modelLineCount) {
			// equality case
			return [];
		}

		const commonSuffix = this._commonSuffix(model, modelLineCount - commonPrefix, commonPrefix, textBuffer, textBufferLineCount - commonPrefix, commonPrefix);

		let oldRange: Range;
		let newRange: Range;
		if (commonSuffix > 0) {
			oldRange = new Range(commonPrefix + 1, 1, modelLineCount - commonSuffix + 1, 1);
			newRange = new Range(commonPrefix + 1, 1, textBufferLineCount - commonSuffix + 1, 1);
		} else if (commonPrefix > 0) {
			oldRange = new Range(commonPrefix, model.getLineMaxColumn(commonPrefix), modelLineCount, model.getLineMaxColumn(modelLineCount));
			newRange = new Range(commonPrefix, 1 + textBuffer.getLineLength(commonPrefix), textBufferLineCount, 1 + textBuffer.getLineLength(textBufferLineCount));
		} else {
			oldRange = new Range(1, 1, modelLineCount, model.getLineMaxColumn(modelLineCount));
			newRange = new Range(1, 1, textBufferLineCount, 1 + textBuffer.getLineLength(textBufferLineCount));
		}

		return [EditOperation.replaceMove(oldRange, textBuffer.getValueInRange(newRange, EndOfLinePreference.TextDefined))];
	}

	public createModel(value: string | ITextBufferFactory, languageSelection: ILanguageSelection | null, resource?: URI, isForSimpleWidget: boolean = false): ITextModel {
		let modelData: ModelData;

		if (languageSelection) {
			modelData = this._createModelData(value, languageSelection.languageIdentifier, resource, isForSimpleWidget);
			this.setMode(modelData.model, languageSelection);
		} else {
			modelData = this._createModelData(value, PLAINTEXT_LANGUAGE_IDENTIFIER, resource, isForSimpleWidget);
		}

		this._onModelAdded.fire(modelData.model);

		return modelData.model;
	}

	public setMode(model: ITextModel, languageSelection: ILanguageSelection): void {
		if (!languageSelection) {
			return;
		}
		const modelData = this._models[MODEL_ID(model.uri)];
		if (!modelData) {
			return;
		}
		modelData.setLanguage(languageSelection);
	}

	public destroyModel(resource: URI): void {
		// We need to support that not all models get disposed through this service (i.e. model.dispose() should work!)
		const modelData = this._models[MODEL_ID(resource)];
		if (!modelData) {
			return;
		}
		modelData.model.dispose();
	}

	public getModels(): ITextModel[] {
		const ret: ITextModel[] = [];

		const keys = Object.keys(this._models);
		for (let i = 0, len = keys.length; i < len; i++) {
			const modelId = keys[i];
			ret.push(this._models[modelId].model);
		}

		return ret;
	}

	public getModel(resource: URI): ITextModel | null {
		const modelId = MODEL_ID(resource);
		const modelData = this._models[modelId];
		if (!modelData) {
			return null;
		}
		return modelData.model;
	}

	public getSemanticTokensProviderStyling(provider: DocumentTokensProvider): SemanticTokensProviderStyling {
		return this._semanticStyling.get(provider);
	}

	// --- end IModelService

	private _onWillDispose(model: ITextModel): void {
		const modelId = MODEL_ID(model.uri);
		const modelData = this._models[modelId];

		const sharesUndoRedoStack = (this._undoRedoService.getUriComparisonKey(model.uri) !== model.uri.toString());
		let maintainUndoRedoStack = false;
		let heapSize = 0;
		if (sharesUndoRedoStack || (this._shouldRestoreUndoStack() && schemaShouldMaintainUndoRedoElements(model.uri))) {
			const elements = this._undoRedoService.getElements(model.uri);
			if (elements.past.length > 0 || elements.future.length > 0) {
				for (const element of elements.past) {
					if (isEditStackElement(element) && element.matchesResource(model.uri)) {
						maintainUndoRedoStack = true;
						heapSize += element.heapSize(model.uri);
						element.setModel(model.uri); // remove reference from text buffer instance
					}
				}
				for (const element of elements.future) {
					if (isEditStackElement(element) && element.matchesResource(model.uri)) {
						maintainUndoRedoStack = true;
						heapSize += element.heapSize(model.uri);
						element.setModel(model.uri); // remove reference from text buffer instance
					}
				}
			}
		}

		const maxMemory = ModelServiceImpl.MAX_MEMORY_FOR_CLOSED_FILES_UNDO_STACK;
		if (!maintainUndoRedoStack) {
			if (!sharesUndoRedoStack) {
				const initialUndoRedoSnapshot = modelData.model.getInitialUndoRedoSnapshot();
				if (initialUndoRedoSnapshot !== null) {
					this._undoRedoService.restoreSnapshot(initialUndoRedoSnapshot);
				}
			}
		} else if (!sharesUndoRedoStack && heapSize > maxMemory) {
			// the undo stack for this file would never fit in the configured memory, so don't bother with it.
			const initialUndoRedoSnapshot = modelData.model.getInitialUndoRedoSnapshot();
			if (initialUndoRedoSnapshot !== null) {
				this._undoRedoService.restoreSnapshot(initialUndoRedoSnapshot);
			}
		} else {
			this._ensureDisposedModelsHeapSize(maxMemory - heapSize);
			// We only invalidate the elements, but they remain in the undo-redo service.
			this._undoRedoService.setElementsValidFlag(model.uri, false, (element) => (isEditStackElement(element) && element.matchesResource(model.uri)));
			this._insertDisposedModel(new DisposedModelInfo(model.uri, modelData.model.getInitialUndoRedoSnapshot(), Date.now(), sharesUndoRedoStack, heapSize, computeModelSha1(model), model.getVersionId(), model.getAlternativeVersionId()));
		}

		delete this._models[modelId];
		modelData.dispose();

		// clean up cache
		delete this._modelCreationOptionsByLanguageAndResource[model.getLanguageIdentifier().language + model.uri];

		this._onModelRemoved.fire(model);
	}

	private _onDidChangeLanguage(model: ITextModel, e: IModelLanguageChangedEvent): void {
		const oldModeId = e.oldLanguage;
		const newModeId = model.getLanguageIdentifier().language;
		const oldOptions = this.getCreationOptions(oldModeId, model.uri, model.isForSimpleWidget);
		const newOptions = this.getCreationOptions(newModeId, model.uri, model.isForSimpleWidget);
		ModelServiceImpl._setModelOptionsForModel(model, newOptions, oldOptions);
		this._onModelModeChanged.fire({ model, oldModeId });
	}
}

export interface ILineSequence {
	getLineContent(lineNumber: number): string;
}

export const SEMANTIC_HIGHLIGHTING_SETTING_ID = 'editor.semanticHighlighting';

export function isSemanticColoringEnabled(model: ITextModel, themeService: IThemeService, configurationService: IConfigurationService): boolean {
	const setting = configurationService.getValue<IEditorSemanticHighlightingOptions>(SEMANTIC_HIGHLIGHTING_SETTING_ID, { overrideIdentifier: model.getLanguageIdentifier().language, resource: model.uri })?.enabled;
	if (typeof setting === 'boolean') {
		return setting;
	}
	return themeService.getColorTheme().semanticHighlighting;
}

class SemanticColoringFeature extends Disposable {

	private readonly _watchers: Record<string, ModelSemanticColoring>;
	private readonly _semanticStyling: SemanticStyling;

	constructor(modelService: IModelService, themeService: IThemeService, configurationService: IConfigurationService, semanticStyling: SemanticStyling) {
		super();
		this._watchers = Object.create(null);
		this._semanticStyling = semanticStyling;

		const register = (model: ITextModel) => {
			this._watchers[model.uri.toString()] = new ModelSemanticColoring(model, themeService, this._semanticStyling);
		};
		const deregister = (model: ITextModel, modelSemanticColoring: ModelSemanticColoring) => {
			modelSemanticColoring.dispose();
			delete this._watchers[model.uri.toString()];
		};
		const handleSettingOrThemeChange = () => {
			for (let model of modelService.getModels()) {
				const curr = this._watchers[model.uri.toString()];
				if (isSemanticColoringEnabled(model, themeService, configurationService)) {
					if (!curr) {
						register(model);
					}
				} else {
					if (curr) {
						deregister(model, curr);
					}
				}
			}
		};
		this._register(modelService.onModelAdded((model) => {
			if (isSemanticColoringEnabled(model, themeService, configurationService)) {
				register(model);
			}
		}));
		this._register(modelService.onModelRemoved((model) => {
			const curr = this._watchers[model.uri.toString()];
			if (curr) {
				deregister(model, curr);
			}
		}));
		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(SEMANTIC_HIGHLIGHTING_SETTING_ID)) {
				handleSettingOrThemeChange();
			}
		}));
		this._register(themeService.onDidColorThemeChange(handleSettingOrThemeChange));
	}
}

class SemanticStyling extends Disposable {

	private _caches: WeakMap<DocumentTokensProvider, SemanticTokensProviderStyling>;

	constructor(
		private readonly _themeService: IThemeService,
		private readonly _logService: ILogService
	) {
		super();
		this._caches = new WeakMap<DocumentTokensProvider, SemanticTokensProviderStyling>();
		this._register(this._themeService.onDidColorThemeChange(() => {
			this._caches = new WeakMap<DocumentTokensProvider, SemanticTokensProviderStyling>();
		}));
	}

	public get(provider: DocumentTokensProvider): SemanticTokensProviderStyling {
		if (!this._caches.has(provider)) {
			this._caches.set(provider, new SemanticTokensProviderStyling(provider.getLegend(), this._themeService, this._logService));
		}
		return this._caches.get(provider)!;
	}
}

class SemanticTokensResponse {
	constructor(
		private readonly _provider: DocumentSemanticTokensProvider,
		public readonly resultId: string | undefined,
		public readonly data: Uint32Array
	) { }

	public dispose(): void {
		this._provider.releaseDocumentSemanticTokens(this.resultId);
	}
}

export class ModelSemanticColoring extends Disposable {

	public static FETCH_DOCUMENT_SEMANTIC_TOKENS_DELAY = 300;

	private _isDisposed: boolean;
	private readonly _model: ITextModel;
	private readonly _semanticStyling: SemanticStyling;
	private readonly _fetchDocumentSemanticTokens: RunOnceScheduler;
	private _currentDocumentResponse: SemanticTokensResponse | null;
	private _currentDocumentRequestCancellationTokenSource: CancellationTokenSource | null;
	private _documentProvidersChangeListeners: IDisposable[];

	constructor(model: ITextModel, themeService: IThemeService, stylingProvider: SemanticStyling) {
		super();

		this._isDisposed = false;
		this._model = model;
		this._semanticStyling = stylingProvider;
		this._fetchDocumentSemanticTokens = this._register(new RunOnceScheduler(() => this._fetchDocumentSemanticTokensNow(), ModelSemanticColoring.FETCH_DOCUMENT_SEMANTIC_TOKENS_DELAY));
		this._currentDocumentResponse = null;
		this._currentDocumentRequestCancellationTokenSource = null;
		this._documentProvidersChangeListeners = [];

		this._register(this._model.onDidChangeContent(() => {
			if (!this._fetchDocumentSemanticTokens.isScheduled()) {
				this._fetchDocumentSemanticTokens.schedule();
			}
		}));
		this._register(this._model.onDidChangeLanguage(() => {
			// clear any outstanding state
			if (this._currentDocumentResponse) {
				this._currentDocumentResponse.dispose();
				this._currentDocumentResponse = null;
			}
			if (this._currentDocumentRequestCancellationTokenSource) {
				this._currentDocumentRequestCancellationTokenSource.cancel();
				this._currentDocumentRequestCancellationTokenSource = null;
			}
			this._setDocumentSemanticTokens(null, null, null, []);
			this._fetchDocumentSemanticTokens.schedule(0);
		}));
		const bindDocumentChangeListeners = () => {
			dispose(this._documentProvidersChangeListeners);
			this._documentProvidersChangeListeners = [];
			for (const provider of DocumentSemanticTokensProviderRegistry.all(model)) {
				if (typeof provider.onDidChange === 'function') {
					this._documentProvidersChangeListeners.push(provider.onDidChange(() => this._fetchDocumentSemanticTokens.schedule(0)));
				}
			}
		};
		bindDocumentChangeListeners();
		this._register(DocumentSemanticTokensProviderRegistry.onDidChange(() => {
			bindDocumentChangeListeners();
			this._fetchDocumentSemanticTokens.schedule();
		}));

		this._register(themeService.onDidColorThemeChange(_ => {
			// clear out existing tokens
			this._setDocumentSemanticTokens(null, null, null, []);
			this._fetchDocumentSemanticTokens.schedule();
		}));

		this._fetchDocumentSemanticTokens.schedule(0);
	}

	public override dispose(): void {
		if (this._currentDocumentResponse) {
			this._currentDocumentResponse.dispose();
			this._currentDocumentResponse = null;
		}
		if (this._currentDocumentRequestCancellationTokenSource) {
			this._currentDocumentRequestCancellationTokenSource.cancel();
			this._currentDocumentRequestCancellationTokenSource = null;
		}
		this._setDocumentSemanticTokens(null, null, null, []);
		this._isDisposed = true;

		super.dispose();
	}

	private _fetchDocumentSemanticTokensNow(): void {
		if (this._currentDocumentRequestCancellationTokenSource) {
			// there is already a request running, let it finish...
			return;
		}

		const cancellationTokenSource = new CancellationTokenSource();
		const lastResultId = this._currentDocumentResponse ? this._currentDocumentResponse.resultId || null : null;
		const r = getDocumentSemanticTokens(this._model, lastResultId, cancellationTokenSource.token);
		if (!r) {
			// there is no provider
			if (this._currentDocumentResponse) {
				// there are semantic tokens set
				this._model.setSemanticTokens(null, false);
			}
			return;
		}

		const { provider, request } = r;
		this._currentDocumentRequestCancellationTokenSource = cancellationTokenSource;

		const pendingChanges: IModelContentChangedEvent[] = [];
		const contentChangeListener = this._model.onDidChangeContent((e) => {
			pendingChanges.push(e);
		});

		const styling = this._semanticStyling.get(provider);

		request.then((res) => {
			this._currentDocumentRequestCancellationTokenSource = null;
			contentChangeListener.dispose();
			this._setDocumentSemanticTokens(provider, res || null, styling, pendingChanges);
		}, (err) => {
			const isExpectedError = err && (errors.isPromiseCanceledError(err) || (typeof err.message === 'string' && err.message.indexOf('busy') !== -1));
			if (!isExpectedError) {
				errors.onUnexpectedError(err);
			}

			// Semantic tokens eats up all errors and considers errors to mean that the result is temporarily not available
			// The API does not have a special error kind to express this...
			this._currentDocumentRequestCancellationTokenSource = null;
			contentChangeListener.dispose();

			if (pendingChanges.length > 0) {
				// More changes occurred while the request was running
				if (!this._fetchDocumentSemanticTokens.isScheduled()) {
					this._fetchDocumentSemanticTokens.schedule();
				}
			}
		});
	}

	private static _copy(src: Uint32Array, srcOffset: number, dest: Uint32Array, destOffset: number, length: number): void {
		for (let i = 0; i < length; i++) {
			dest[destOffset + i] = src[srcOffset + i];
		}
	}

	private _setDocumentSemanticTokens(provider: DocumentSemanticTokensProvider | null, tokens: SemanticTokens | SemanticTokensEdits | null, styling: SemanticTokensProviderStyling | null, pendingChanges: IModelContentChangedEvent[]): void {
		const currentResponse = this._currentDocumentResponse;
		const rescheduleIfNeeded = () => {
			if (pendingChanges.length > 0 && !this._fetchDocumentSemanticTokens.isScheduled()) {
				this._fetchDocumentSemanticTokens.schedule();
			}
		};

		if (this._currentDocumentResponse) {
			this._currentDocumentResponse.dispose();
			this._currentDocumentResponse = null;
		}
		if (this._isDisposed) {
			// disposed!
			if (provider && tokens) {
				provider.releaseDocumentSemanticTokens(tokens.resultId);
			}
			return;
		}
		if (!provider || !styling) {
			this._model.setSemanticTokens(null, false);
			return;
		}
		if (!tokens) {
			this._model.setSemanticTokens(null, true);
			rescheduleIfNeeded();
			return;
		}

		if (isSemanticTokensEdits(tokens)) {
			if (!currentResponse) {
				// not possible!
				this._model.setSemanticTokens(null, true);
				return;
			}
			if (tokens.edits.length === 0) {
				// nothing to do!
				tokens = {
					resultId: tokens.resultId,
					data: currentResponse.data
				};
			} else {
				let deltaLength = 0;
				for (const edit of tokens.edits) {
					deltaLength += (edit.data ? edit.data.length : 0) - edit.deleteCount;
				}

				const srcData = currentResponse.data;
				const destData = new Uint32Array(srcData.length + deltaLength);

				let srcLastStart = srcData.length;
				let destLastStart = destData.length;
				for (let i = tokens.edits.length - 1; i >= 0; i--) {
					const edit = tokens.edits[i];

					const copyCount = srcLastStart - (edit.start + edit.deleteCount);
					if (copyCount > 0) {
						ModelSemanticColoring._copy(srcData, srcLastStart - copyCount, destData, destLastStart - copyCount, copyCount);
						destLastStart -= copyCount;
					}

					if (edit.data) {
						ModelSemanticColoring._copy(edit.data, 0, destData, destLastStart - edit.data.length, edit.data.length);
						destLastStart -= edit.data.length;
					}

					srcLastStart = edit.start;
				}

				if (srcLastStart > 0) {
					ModelSemanticColoring._copy(srcData, 0, destData, 0, srcLastStart);
				}

				tokens = {
					resultId: tokens.resultId,
					data: destData
				};
			}
		}

		if (isSemanticTokens(tokens)) {

			this._currentDocumentResponse = new SemanticTokensResponse(provider, tokens.resultId, tokens.data);

			const result = toMultilineTokens2(tokens, styling, this._model.getLanguageIdentifier());

			// Adjust incoming semantic tokens
			if (pendingChanges.length > 0) {
				// More changes occurred while the request was running
				// We need to:
				// 1. Adjust incoming semantic tokens
				// 2. Request them again
				for (const change of pendingChanges) {
					for (const area of result) {
						for (const singleChange of change.changes) {
							area.applyEdit(singleChange.range, singleChange.text);
						}
					}
				}
			}

			this._model.setSemanticTokens(result, true);
		} else {
			this._model.setSemanticTokens(null, true);
		}

		rescheduleIfNeeded();
	}
}
