/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IntervalTimer, timeout } from 'vs/base/common/async';
import { Disposable, IDisposable, dispose, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { SimpleWorkerClient, logOnceWebWorkerWarning, IWorkerClient } from 'vs/base/common/worker/simpleWorker';
import { DefaultWorkerFactory } from 'vs/base/worker/defaultWorkerFactory';
import { Position } from 'vs/editor/common/core/position';
import { IRange, Range } from 'vs/editor/common/core/range';
import { IChange } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import * as modes from 'vs/editor/common/modes';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { EditorSimpleWorker } from 'vs/editor/common/services/editorSimpleWorker';
import { IDiffComputationResult, IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { regExpFlags } from 'vs/base/common/strings';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { ILogService } from 'vs/platform/log/common/log';
import { StopWatch } from 'vs/base/common/stopwatch';
import { canceled } from 'vs/base/common/errors';

/**
 * Stop syncing a model to the worker if it was not needed for 1 min.
 */
const STOP_SYNC_MODEL_DELTA_TIME_MS = 60 * 1000;

/**
 * Stop the worker if it was not needed for 5 min.
 */
const STOP_WORKER_DELTA_TIME_MS = 5 * 60 * 1000;

function canSyncModel(modelService: IModelService, resource: URI): boolean {
	let model = modelService.getModel(resource);
	if (!model) {
		return false;
	}
	if (model.isTooLargeForSyncing()) {
		return false;
	}
	return true;
}

export class EditorWorkerServiceImpl extends Disposable implements IEditorWorkerService {

	declare readonly _serviceBrand: undefined;

	private readonly _modelService: IModelService;
	private readonly _workerManager: WorkerManager;
	private readonly _logService: ILogService;

	constructor(
		@IModelService modelService: IModelService,
		@ITextResourceConfigurationService configurationService: ITextResourceConfigurationService,
		@ILogService logService: ILogService
	) {
		super();
		this._modelService = modelService;
		this._workerManager = this._register(new WorkerManager(this._modelService));
		this._logService = logService;

		// register default link-provider and default completions-provider
		this._register(modes.LinkProviderRegistry.register('*', {
			provideLinks: (model, token) => {
				if (!canSyncModel(this._modelService, model.uri)) {
					return Promise.resolve({ links: [] }); // File too large
				}
				return this._workerManager.withWorker().then(client => client.computeLinks(model.uri)).then(links => {
					return links && { links };
				});
			}
		}));
		this._register(modes.CompletionProviderRegistry.register('*', new WordBasedCompletionItemProvider(this._workerManager, configurationService, this._modelService)));
	}

	public dispose(): void {
		super.dispose();
	}

	public canComputeDiff(original: URI, modified: URI): boolean {
		return (canSyncModel(this._modelService, original) && canSyncModel(this._modelService, modified));
	}

	public computeDiff(original: URI, modified: URI, ignoreTrimWhitespace: boolean, maxComputationTime: number): Promise<IDiffComputationResult | null> {
		return this._workerManager.withWorker().then(client => client.computeDiff(original, modified, ignoreTrimWhitespace, maxComputationTime));
	}

	public canComputeDirtyDiff(original: URI, modified: URI): boolean {
		return (canSyncModel(this._modelService, original) && canSyncModel(this._modelService, modified));
	}

	public computeDirtyDiff(original: URI, modified: URI, ignoreTrimWhitespace: boolean): Promise<IChange[] | null> {
		return this._workerManager.withWorker().then(client => client.computeDirtyDiff(original, modified, ignoreTrimWhitespace));
	}

	public computeMoreMinimalEdits(resource: URI, edits: modes.TextEdit[] | null | undefined): Promise<modes.TextEdit[] | undefined> {
		if (isNonEmptyArray(edits)) {
			if (!canSyncModel(this._modelService, resource)) {
				return Promise.resolve(edits); // File too large
			}
			const sw = StopWatch.create(true);
			const result = this._workerManager.withWorker().then(client => client.computeMoreMinimalEdits(resource, edits));
			result.finally(() => this._logService.trace('FORMAT#computeMoreMinimalEdits', resource.toString(true), sw.elapsed()));
			return Promise.race([result, timeout(1000).then(() => edits)]);

		} else {
			return Promise.resolve(undefined);
		}
	}

	public canNavigateValueSet(resource: URI): boolean {
		return (canSyncModel(this._modelService, resource));
	}

	public navigateValueSet(resource: URI, range: IRange, up: boolean): Promise<modes.IInplaceReplaceSupportResult | null> {
		return this._workerManager.withWorker().then(client => client.navigateValueSet(resource, range, up));
	}

	canComputeWordRanges(resource: URI): boolean {
		return canSyncModel(this._modelService, resource);
	}

	computeWordRanges(resource: URI, range: IRange): Promise<{ [word: string]: IRange[] } | null> {
		return this._workerManager.withWorker().then(client => client.computeWordRanges(resource, range));
	}
}

class WordBasedCompletionItemProvider implements modes.CompletionItemProvider {

	private readonly _workerManager: WorkerManager;
	private readonly _configurationService: ITextResourceConfigurationService;
	private readonly _modelService: IModelService;

	readonly _debugDisplayName = 'wordbasedCompletions';

	constructor(
		workerManager: WorkerManager,
		configurationService: ITextResourceConfigurationService,
		modelService: IModelService
	) {
		this._workerManager = workerManager;
		this._configurationService = configurationService;
		this._modelService = modelService;
	}

	async provideCompletionItems(model: ITextModel, position: Position): Promise<modes.CompletionList | undefined> {
		type WordBasedSuggestionsConfig = {
			wordBasedSuggestions?: boolean,
			wordBasedSuggestionsMode?: 'currentDocument' | 'matchingDocuments' | 'allDocuments'
		};
		const config = this._configurationService.getValue<WordBasedSuggestionsConfig>(model.uri, position, 'editor');
		if (!config.wordBasedSuggestions) {
			return undefined;
		}

		const models: URI[] = [];
		if (config.wordBasedSuggestionsMode === 'currentDocument') {
			// only current file and only if not too large
			if (canSyncModel(this._modelService, model.uri)) {
				models.push(model.uri);
			}
		} else {
			// either all files or files of same language
			for (const candidate of this._modelService.getModels()) {
				if (!canSyncModel(this._modelService, candidate.uri)) {
					continue;
				}
				if (candidate === model) {
					models.unshift(candidate.uri);

				} else if (config.wordBasedSuggestionsMode === 'allDocuments' || candidate.getLanguageIdentifier().id === model.getLanguageIdentifier().id) {
					models.push(candidate.uri);
				}
			}
		}

		if (models.length === 0) {
			return undefined; // File too large, no other files
		}

		const wordDefRegExp = LanguageConfigurationRegistry.getWordDefinition(model.getLanguageIdentifier().id);
		const word = model.getWordAtPosition(position);
		const replace = !word ? Range.fromPositions(position) : new Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
		const insert = replace.setEndPosition(position.lineNumber, position.column);

		const client = await this._workerManager.withWorker();
		const data = await client.textualSuggest(models, word?.word, wordDefRegExp);
		if (!data) {
			return undefined;
		}

		return {
			duration: data.duration,
			suggestions: data.words.map((word): modes.CompletionItem => {
				return {
					kind: modes.CompletionItemKind.Text,
					label: word,
					insertText: word,
					range: { insert, replace }
				};
			}),
		};
	}
}

class WorkerManager extends Disposable {

	private readonly _modelService: IModelService;
	private _editorWorkerClient: EditorWorkerClient | null;
	private _lastWorkerUsedTime: number;

	constructor(modelService: IModelService) {
		super();
		this._modelService = modelService;
		this._editorWorkerClient = null;
		this._lastWorkerUsedTime = (new Date()).getTime();

		let stopWorkerInterval = this._register(new IntervalTimer());
		stopWorkerInterval.cancelAndSet(() => this._checkStopIdleWorker(), Math.round(STOP_WORKER_DELTA_TIME_MS / 2));

		this._register(this._modelService.onModelRemoved(_ => this._checkStopEmptyWorker()));
	}

	public dispose(): void {
		if (this._editorWorkerClient) {
			this._editorWorkerClient.dispose();
			this._editorWorkerClient = null;
		}
		super.dispose();
	}

	/**
	 * Check if the model service has no more models and stop the worker if that is the case.
	 */
	private _checkStopEmptyWorker(): void {
		if (!this._editorWorkerClient) {
			return;
		}

		let models = this._modelService.getModels();
		if (models.length === 0) {
			// There are no more models => nothing possible for me to do
			this._editorWorkerClient.dispose();
			this._editorWorkerClient = null;
		}
	}

	/**
	 * Check if the worker has been idle for a while and then stop it.
	 */
	private _checkStopIdleWorker(): void {
		if (!this._editorWorkerClient) {
			return;
		}

		let timeSinceLastWorkerUsedTime = (new Date()).getTime() - this._lastWorkerUsedTime;
		if (timeSinceLastWorkerUsedTime > STOP_WORKER_DELTA_TIME_MS) {
			this._editorWorkerClient.dispose();
			this._editorWorkerClient = null;
		}
	}

	public withWorker(): Promise<EditorWorkerClient> {
		this._lastWorkerUsedTime = (new Date()).getTime();
		if (!this._editorWorkerClient) {
			this._editorWorkerClient = new EditorWorkerClient(this._modelService, false, 'editorWorkerService');
		}
		return Promise.resolve(this._editorWorkerClient);
	}
}

class EditorModelManager extends Disposable {

	private readonly _proxy: EditorSimpleWorker;
	private readonly _modelService: IModelService;
	private _syncedModels: { [modelUrl: string]: IDisposable; } = Object.create(null);
	private _syncedModelsLastUsedTime: { [modelUrl: string]: number; } = Object.create(null);

	constructor(proxy: EditorSimpleWorker, modelService: IModelService, keepIdleModels: boolean) {
		super();
		this._proxy = proxy;
		this._modelService = modelService;

		if (!keepIdleModels) {
			let timer = new IntervalTimer();
			timer.cancelAndSet(() => this._checkStopModelSync(), Math.round(STOP_SYNC_MODEL_DELTA_TIME_MS / 2));
			this._register(timer);
		}
	}

	public dispose(): void {
		for (let modelUrl in this._syncedModels) {
			dispose(this._syncedModels[modelUrl]);
		}
		this._syncedModels = Object.create(null);
		this._syncedModelsLastUsedTime = Object.create(null);
		super.dispose();
	}

	public ensureSyncedResources(resources: URI[]): void {
		for (const resource of resources) {
			let resourceStr = resource.toString();

			if (!this._syncedModels[resourceStr]) {
				this._beginModelSync(resource);
			}
			if (this._syncedModels[resourceStr]) {
				this._syncedModelsLastUsedTime[resourceStr] = (new Date()).getTime();
			}
		}
	}

	private _checkStopModelSync(): void {
		let currentTime = (new Date()).getTime();

		let toRemove: string[] = [];
		for (let modelUrl in this._syncedModelsLastUsedTime) {
			let elapsedTime = currentTime - this._syncedModelsLastUsedTime[modelUrl];
			if (elapsedTime > STOP_SYNC_MODEL_DELTA_TIME_MS) {
				toRemove.push(modelUrl);
			}
		}

		for (const e of toRemove) {
			this._stopModelSync(e);
		}
	}

	private _beginModelSync(resource: URI): void {
		let model = this._modelService.getModel(resource);
		if (!model) {
			return;
		}
		if (model.isTooLargeForSyncing()) {
			return;
		}

		let modelUrl = resource.toString();

		this._proxy.acceptNewModel({
			url: model.uri.toString(),
			lines: model.getLinesContent(),
			EOL: model.getEOL(),
			versionId: model.getVersionId()
		});

		const toDispose = new DisposableStore();
		toDispose.add(model.onDidChangeContent((e) => {
			this._proxy.acceptModelChanged(modelUrl.toString(), e);
		}));
		toDispose.add(model.onWillDispose(() => {
			this._stopModelSync(modelUrl);
		}));
		toDispose.add(toDisposable(() => {
			this._proxy.acceptRemovedModel(modelUrl);
		}));

		this._syncedModels[modelUrl] = toDispose;
	}

	private _stopModelSync(modelUrl: string): void {
		let toDispose = this._syncedModels[modelUrl];
		delete this._syncedModels[modelUrl];
		delete this._syncedModelsLastUsedTime[modelUrl];
		dispose(toDispose);
	}
}

class SynchronousWorkerClient<T extends IDisposable> implements IWorkerClient<T> {
	private readonly _instance: T;
	private readonly _proxyObj: Promise<T>;

	constructor(instance: T) {
		this._instance = instance;
		this._proxyObj = Promise.resolve(this._instance);
	}

	public dispose(): void {
		this._instance.dispose();
	}

	public getProxyObject(): Promise<T> {
		return this._proxyObj;
	}
}

export class EditorWorkerHost {

	private readonly _workerClient: EditorWorkerClient;

	constructor(workerClient: EditorWorkerClient) {
		this._workerClient = workerClient;
	}

	// foreign host request
	public fhr(method: string, args: any[]): Promise<any> {
		return this._workerClient.fhr(method, args);
	}
}

export class EditorWorkerClient extends Disposable {

	private readonly _modelService: IModelService;
	private readonly _keepIdleModels: boolean;
	private _worker: IWorkerClient<EditorSimpleWorker> | null;
	private readonly _workerFactory: DefaultWorkerFactory;
	private _modelManager: EditorModelManager | null;
	private _disposed = false;

	constructor(modelService: IModelService, keepIdleModels: boolean, label: string | undefined) {
		super();
		this._modelService = modelService;
		this._keepIdleModels = keepIdleModels;
		this._workerFactory = new DefaultWorkerFactory(label);
		this._worker = null;
		this._modelManager = null;
	}

	// foreign host request
	public fhr(method: string, args: any[]): Promise<any> {
		throw new Error(`Not implemented!`);
	}

	private _getOrCreateWorker(): IWorkerClient<EditorSimpleWorker> {
		if (!this._worker) {
			try {
				this._worker = this._register(new SimpleWorkerClient<EditorSimpleWorker, EditorWorkerHost>(
					this._workerFactory,
					'vs/editor/common/services/editorSimpleWorker',
					new EditorWorkerHost(this)
				));
			} catch (err) {
				logOnceWebWorkerWarning(err);
				this._worker = new SynchronousWorkerClient(new EditorSimpleWorker(new EditorWorkerHost(this), null));
			}
		}
		return this._worker;
	}

	protected _getProxy(): Promise<EditorSimpleWorker> {
		return this._getOrCreateWorker().getProxyObject().then(undefined, (err) => {
			logOnceWebWorkerWarning(err);
			this._worker = new SynchronousWorkerClient(new EditorSimpleWorker(new EditorWorkerHost(this), null));
			return this._getOrCreateWorker().getProxyObject();
		});
	}

	private _getOrCreateModelManager(proxy: EditorSimpleWorker): EditorModelManager {
		if (!this._modelManager) {
			this._modelManager = this._register(new EditorModelManager(proxy, this._modelService, this._keepIdleModels));
		}
		return this._modelManager;
	}

	protected _withSyncedResources(resources: URI[]): Promise<EditorSimpleWorker> {
		if (this._disposed) {
			return Promise.reject(canceled());
		}
		return this._getProxy().then((proxy) => {
			this._getOrCreateModelManager(proxy).ensureSyncedResources(resources);
			return proxy;
		});
	}

	public computeDiff(original: URI, modified: URI, ignoreTrimWhitespace: boolean, maxComputationTime: number): Promise<IDiffComputationResult | null> {
		return this._withSyncedResources([original, modified]).then(proxy => {
			return proxy.computeDiff(original.toString(), modified.toString(), ignoreTrimWhitespace, maxComputationTime);
		});
	}

	public computeDirtyDiff(original: URI, modified: URI, ignoreTrimWhitespace: boolean): Promise<IChange[] | null> {
		return this._withSyncedResources([original, modified]).then(proxy => {
			return proxy.computeDirtyDiff(original.toString(), modified.toString(), ignoreTrimWhitespace);
		});
	}

	public computeMoreMinimalEdits(resource: URI, edits: modes.TextEdit[]): Promise<modes.TextEdit[]> {
		return this._withSyncedResources([resource]).then(proxy => {
			return proxy.computeMoreMinimalEdits(resource.toString(), edits);
		});
	}

	public computeLinks(resource: URI): Promise<modes.ILink[] | null> {
		return this._withSyncedResources([resource]).then(proxy => {
			return proxy.computeLinks(resource.toString());
		});
	}

	public async textualSuggest(resources: URI[], leadingWord: string | undefined, wordDefRegExp: RegExp): Promise<{ words: string[], duration: number } | null> {
		const proxy = await this._withSyncedResources(resources);
		const wordDef = wordDefRegExp.source;
		const wordDefFlags = regExpFlags(wordDefRegExp);
		return proxy.textualSuggest(resources.map(r => r.toString()), leadingWord, wordDef, wordDefFlags);
	}

	computeWordRanges(resource: URI, range: IRange): Promise<{ [word: string]: IRange[] } | null> {
		return this._withSyncedResources([resource]).then(proxy => {
			let model = this._modelService.getModel(resource);
			if (!model) {
				return Promise.resolve(null);
			}
			let wordDefRegExp = LanguageConfigurationRegistry.getWordDefinition(model.getLanguageIdentifier().id);
			let wordDef = wordDefRegExp.source;
			let wordDefFlags = regExpFlags(wordDefRegExp);
			return proxy.computeWordRanges(resource.toString(), range, wordDef, wordDefFlags);
		});
	}

	public navigateValueSet(resource: URI, range: IRange, up: boolean): Promise<modes.IInplaceReplaceSupportResult | null> {
		return this._withSyncedResources([resource]).then(proxy => {
			let model = this._modelService.getModel(resource);
			if (!model) {
				return null;
			}
			let wordDefRegExp = LanguageConfigurationRegistry.getWordDefinition(model.getLanguageIdentifier().id);
			let wordDef = wordDefRegExp.source;
			let wordDefFlags = regExpFlags(wordDefRegExp);
			return proxy.navigateValueSet(resource.toString(), range, up, wordDef, wordDefFlags);
		});
	}

	dispose(): void {
		super.dispose();
		this._disposed = true;
	}
}
