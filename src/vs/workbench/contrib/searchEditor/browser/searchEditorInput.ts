/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/searchEditor';
import { Registry } from 'vs/platform/registry/common/platform';
import { Emitter, Event } from 'vs/base/common/event';
import { basename } from 'vs/base/common/path';
import { extname, isEqual, joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { Range } from 'vs/editor/common/core/range';
import { ITextModel, TrackedRangeStickiness } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { EditorInput, GroupIdentifier, IEditorInput, IMoveResult, IRevertOptions, ISaveOptions, IEditorInputFactoryRegistry, EditorExtensions, EditorResourceAccessor } from 'vs/workbench/common/editor';
import { Memento } from 'vs/workbench/common/memento';
import { SearchEditorFindMatchClass, SearchEditorScheme, SearchEditorWorkingCopyTypeId } from 'vs/workbench/contrib/searchEditor/browser/constants';
import { SearchEditorModel } from 'vs/workbench/contrib/searchEditor/browser/searchEditorModel';
import { defaultSearchConfig, extractSearchQueryFromModel, parseSavedSearchEditor, serializeSearchConfiguration } from 'vs/workbench/contrib/searchEditor/browser/searchEditorSerialization';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { ISearchConfigurationProperties } from 'vs/workbench/services/search/common/search';
import { ITextFileSaveOptions, ITextFileService, toBufferOrReadable } from 'vs/workbench/services/textfile/common/textfiles';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IWorkingCopy, IWorkingCopyBackup, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { CancellationToken } from 'vs/base/common/cancellation';

export type SearchConfiguration = {
	query: string,
	filesToInclude: string,
	filesToExclude: string,
	contextLines: number,
	matchWholeWord: boolean,
	isCaseSensitive: boolean,
	isRegexp: boolean,
	useExcludeSettingsAndIgnoreFiles: boolean,
	showIncludesExcludes: boolean,
	onlyOpenEditors: boolean,
};

export const SEARCH_EDITOR_EXT = '.code-search';

export class SearchEditorInput extends EditorInput {
	static readonly ID: string = 'workbench.editorinputs.searchEditorInput';

	override get typeId(): string {
		return SearchEditorInput.ID;
	}

	private memento: Memento;

	private dirty: boolean = false;
	private get model(): Promise<ITextModel> {
		return this.searchEditorModel.resolve();
	}

	private _cachedModel: ITextModel | undefined;

	private readonly _onDidChangeContent = this._register(new Emitter<void>());
	readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;

	private oldDecorationsIDs: string[] = [];

	private _config: Readonly<SearchConfiguration>;
	public get config(): Readonly<SearchConfiguration> { return this._config; }
	public set config(value: Readonly<SearchConfiguration>) {
		this._config = value;
		this.memento.getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE).searchConfig = value;
		this._onDidChangeLabel.fire();
	}

	private readonly fileEditorInputFactory = Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).getFileEditorInputFactory();

	get resource() {
		return this.backingUri || this.modelUri;
	}

	constructor(
		public readonly modelUri: URI,
		public readonly backingUri: URI | undefined,
		private searchEditorModel: SearchEditorModel,
		@IModelService private readonly modelService: IModelService,
		@ITextFileService protected readonly textFileService: ITextFileService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IPathService private readonly pathService: IPathService,
		@IStorageService storageService: IStorageService,
	) {
		super();

		this._config = searchEditorModel.config;
		searchEditorModel.onModelResolved
			.then(model => {
				this._register(model.onDidChangeContent(() => this._onDidChangeContent.fire()));
				this._register(model);
				this._cachedModel = model;
			});

		if (this.modelUri.scheme !== SearchEditorScheme) {
			throw Error('SearchEditorInput must be invoked with a SearchEditorScheme uri');
		}

		this.memento = new Memento(SearchEditorInput.ID, storageService);
		storageService.onWillSaveState(() => this.memento.saveMemento());

		const input = this;
		const workingCopyAdapter = new class implements IWorkingCopy {
			readonly typeId = SearchEditorWorkingCopyTypeId;
			readonly resource = input.modelUri;
			get name() { return input.getName(); }
			readonly capabilities = input.isUntitled() ? WorkingCopyCapabilities.Untitled : WorkingCopyCapabilities.None;
			readonly onDidChangeDirty = input.onDidChangeDirty;
			readonly onDidChangeContent = input.onDidChangeContent;
			isDirty(): boolean { return input.isDirty(); }
			backup(token: CancellationToken): Promise<IWorkingCopyBackup> { return input.backup(token); }
			save(options?: ISaveOptions): Promise<boolean> { return input.save(0, options).then(editor => !!editor); }
			revert(options?: IRevertOptions): Promise<void> { return input.revert(0, options); }
		};

		this._register(this.workingCopyService.registerWorkingCopy(workingCopyAdapter));
	}

	override async save(group: GroupIdentifier, options?: ITextFileSaveOptions): Promise<IEditorInput | undefined> {
		if ((await this.model).isDisposed()) { return; }

		if (this.backingUri) {
			await this.textFileService.write(this.backingUri, await this.serializeForDisk(), options);
			this.setDirty(false);
			return this;
		} else {
			return this.saveAs(group, options);
		}
	}

	private async serializeForDisk() {
		return serializeSearchConfiguration(this.config) + '\n' + (await this.model).getValue();
	}

	async getModels() {
		return { config: this.config, body: await this.model };
	}

	override async saveAs(group: GroupIdentifier, options?: ITextFileSaveOptions): Promise<IEditorInput | undefined> {
		const path = await this.fileDialogService.pickFileToSave(await this.suggestFileName(), options?.availableFileSystems);
		if (path) {
			this.telemetryService.publicLog2('searchEditor/saveSearchResults');
			const toWrite = await this.serializeForDisk();
			if (await this.textFileService.create([{ resource: path, value: toWrite, options: { overwrite: true } }])) {
				this.setDirty(false);
				if (!isEqual(path, this.modelUri)) {
					const input = this.instantiationService.invokeFunction(getOrMakeSearchEditorInput, { config: this.config, backingUri: path });
					input.setMatchRanges(this.getMatchRanges());
					return input;
				}
				return this;
			}
		}
		return undefined;
	}

	override getName(maxLength = 12): string {
		const trimToMax = (label: string) => (label.length < maxLength ? label : `${label.slice(0, maxLength - 3)}...`);

		if (this.backingUri) {
			const originalURI = EditorResourceAccessor.getOriginalUri(this);
			return localize('searchTitle.withQuery', "Search: {0}", basename((originalURI ?? this.backingUri).path, SEARCH_EDITOR_EXT));
		}

		const query = this.config.query?.trim();
		if (query) {
			return localize('searchTitle.withQuery', "Search: {0}", trimToMax(query));
		}
		return localize('searchTitle', "Search");
	}

	setDirty(dirty: boolean) {
		this.dirty = dirty;
		this._onDidChangeDirty.fire();
	}

	override isDirty() {
		return this.dirty;
	}

	override isReadonly() {
		return false;
	}

	override isUntitled() {
		return !this.backingUri;
	}

	override rename(group: GroupIdentifier, target: URI): IMoveResult | undefined {
		if (this._cachedModel && extname(target) === SEARCH_EDITOR_EXT) {
			return {
				editor: this.instantiationService.invokeFunction(getOrMakeSearchEditorInput, { config: this.config, text: this._cachedModel.getValue(), backingUri: target })
			};
		}
		// Ignore move if editor was renamed to a different file extension
		return undefined;
	}

	override dispose() {
		this.modelService.destroyModel(this.modelUri);
		super.dispose();
	}

	override matches(other: unknown) {
		if (this === other) { return true; }

		if (other instanceof SearchEditorInput) {
			return !!(other.modelUri.fragment && other.modelUri.fragment === this.modelUri.fragment);
		} else if (this.fileEditorInputFactory.isFileEditorInput(other)) {
			return isEqual(other.resource, this.backingUri);
		}
		return false;
	}

	getMatchRanges(): Range[] {
		return (this._cachedModel?.getAllDecorations() ?? [])
			.filter(decoration => decoration.options.className === SearchEditorFindMatchClass)
			.filter(({ range }) => !(range.startColumn === 1 && range.endColumn === 1))
			.map(({ range }) => range);
	}

	async setMatchRanges(ranges: Range[]) {
		this.oldDecorationsIDs = (await this.searchEditorModel.onModelResolved).deltaDecorations(this.oldDecorationsIDs, ranges.map(range =>
			({ range, options: { className: SearchEditorFindMatchClass, stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges } })));
	}

	override async revert(group: GroupIdentifier, options?: IRevertOptions) {
		if (options?.soft) {
			this.setDirty(false);
			return;
		}

		if (this.backingUri) {
			const { config, text } = await this.instantiationService.invokeFunction(parseSavedSearchEditor, this.backingUri);
			(await this.model).setValue(text);
			this.config = config;
		} else {
			(await this.model).setValue('');
		}
		super.revert(group, options);
		this.setDirty(false);
	}

	override canSplit() {
		return false;
	}

	private async backup(token: CancellationToken): Promise<IWorkingCopyBackup> {
		const model = await this.model;
		if (token.isCancellationRequested) {
			return {};
		}

		return { content: toBufferOrReadable(model.createSnapshot(true /* preserve BOM */)) };
	}

	private async suggestFileName(): Promise<URI> {
		const query = extractSearchQueryFromModel(await this.model).query;

		const searchFileName = (query.replace(/[^\w \-_]+/g, '_') || 'Search') + SEARCH_EDITOR_EXT;

		return joinPath(await this.fileDialogService.defaultFilePath(this.pathService.defaultUriScheme), searchFileName);
	}
}

const inputs = new Map<string, SearchEditorInput>();
export const getOrMakeSearchEditorInput = (
	accessor: ServicesAccessor,
	existingData: ({ config: Partial<SearchConfiguration>, backingUri?: URI } &
		({ modelUri: URI, text?: never, } |
		{ text: string, modelUri?: never, } |
		{ backingUri: URI, text?: never, modelUri?: never }))
): SearchEditorInput => {

	const instantiationService = accessor.get(IInstantiationService);
	const storageService = accessor.get(IStorageService);
	const configurationService = accessor.get(IConfigurationService);

	const searchEditorSettings = configurationService.getValue<ISearchConfigurationProperties>('search').searchEditor;

	const reuseOldSettings = searchEditorSettings.reusePriorSearchConfiguration;
	const defaultNumberOfContextLines = searchEditorSettings.defaultNumberOfContextLines;

	const priorConfig: SearchConfiguration = reuseOldSettings ? new Memento(SearchEditorInput.ID, storageService).getMemento(StorageScope.WORKSPACE, StorageTarget.MACHINE).searchConfig : {};
	const defaultConfig = defaultSearchConfig();

	const config = { ...defaultConfig, ...priorConfig, ...existingData.config };

	if (defaultNumberOfContextLines !== null && defaultNumberOfContextLines !== undefined) {
		config.contextLines = existingData.config.contextLines ?? defaultNumberOfContextLines;
	}

	if (existingData.text) {
		config.contextLines = 0;
	}

	const modelUri = existingData.modelUri ?? URI.from({ scheme: SearchEditorScheme, fragment: `${Math.random()}` });

	const cacheKey = existingData.backingUri?.toString() ?? modelUri.toString();
	const existing = inputs.get(cacheKey);
	if (existing) {
		return existing;
	}

	const model = instantiationService.createInstance(SearchEditorModel, modelUri, config, existingData);
	const input = instantiationService.createInstance(SearchEditorInput, modelUri, existingData.backingUri, model);

	inputs.set(cacheKey, input);
	input.onWillDispose(() => inputs.delete(cacheKey));

	return input;
};
