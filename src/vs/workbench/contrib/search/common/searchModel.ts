/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import * as errors from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { getBaseLabel } from 'vs/base/common/labels';
import { Disposable, IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ResourceMap, TernarySearchTree } from 'vs/base/common/map';
import { lcut } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { Range } from 'vs/editor/common/core/range';
import { FindMatch, IModelDeltaDecoration, ITextModel, OverviewRulerLane, TrackedRangeStickiness, MinimapPosition } from 'vs/editor/common/model';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { IModelService } from 'vs/editor/common/services/modelService';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IProgress, IProgressStep } from 'vs/platform/progress/common/progress';
import { ReplacePattern } from 'vs/workbench/services/search/common/replace';
import { IFileMatch, IPatternInfo, ISearchComplete, ISearchProgressItem, ISearchConfigurationProperties, ISearchService, ITextQuery, ITextSearchPreviewOptions, ITextSearchMatch, ITextSearchStats, resultIsMatch, ISearchRange, OneLineRange, ITextSearchContext, ITextSearchResult, SearchSortOrder, SearchCompletionExitCode } from 'vs/workbench/services/search/common/search';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { overviewRulerFindMatchForeground, minimapFindMatch } from 'vs/platform/theme/common/colorRegistry';
import { themeColorFromId } from 'vs/platform/theme/common/themeService';
import { IReplaceService } from 'vs/workbench/contrib/search/common/replace';
import { editorMatchesToTextSearchResults, addContextToEditorMatches } from 'vs/workbench/services/search/common/searchHelpers';
import { withNullAsUndefined } from 'vs/base/common/types';
import { memoize } from 'vs/base/common/decorators';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { compareFileNames, compareFileExtensions, comparePaths } from 'vs/base/common/comparers';
import { IFileService, IFileStatWithMetadata } from 'vs/platform/files/common/files';
import { Schemas } from 'vs/base/common/network';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export class Match {

	private static readonly MAX_PREVIEW_CHARS = 250;

	private _id: string;
	private _range: Range;
	private _oneLinePreviewText: string;
	private _rangeInPreviewText: ISearchRange;

	// For replace
	private _fullPreviewRange: ISearchRange;

	constructor(private _parent: FileMatch, private _fullPreviewLines: string[], _fullPreviewRange: ISearchRange, _documentRange: ISearchRange) {
		this._oneLinePreviewText = _fullPreviewLines[_fullPreviewRange.startLineNumber];
		const adjustedEndCol = _fullPreviewRange.startLineNumber === _fullPreviewRange.endLineNumber ?
			_fullPreviewRange.endColumn :
			this._oneLinePreviewText.length;
		this._rangeInPreviewText = new OneLineRange(1, _fullPreviewRange.startColumn + 1, adjustedEndCol + 1);

		this._range = new Range(
			_documentRange.startLineNumber + 1,
			_documentRange.startColumn + 1,
			_documentRange.endLineNumber + 1,
			_documentRange.endColumn + 1);

		this._fullPreviewRange = _fullPreviewRange;

		this._id = this._parent.id() + '>' + this._range + this.getMatchString();
	}

	id(): string {
		return this._id;
	}

	parent(): FileMatch {
		return this._parent;
	}

	text(): string {
		return this._oneLinePreviewText;
	}

	range(): Range {
		return this._range;
	}

	@memoize
	preview(): { before: string; inside: string; after: string; } {
		let before = this._oneLinePreviewText.substring(0, this._rangeInPreviewText.startColumn - 1),
			inside = this.getMatchString(),
			after = this._oneLinePreviewText.substring(this._rangeInPreviewText.endColumn - 1);

		before = lcut(before, 26);
		before = before.trimLeft();

		let charsRemaining = Match.MAX_PREVIEW_CHARS - before.length;
		inside = inside.substr(0, charsRemaining);
		charsRemaining -= inside.length;
		after = after.substr(0, charsRemaining);

		return {
			before,
			inside,
			after,
		};
	}

	get replaceString(): string {
		const searchModel = this.parent().parent().searchModel;
		if (!searchModel.replacePattern) {
			throw new Error('searchModel.replacePattern must be set before accessing replaceString');
		}

		const fullMatchText = this.fullMatchText();
		let replaceString = searchModel.replacePattern.getReplaceString(fullMatchText, searchModel.preserveCase);

		// If match string is not matching then regex pattern has a lookahead expression
		if (replaceString === null) {
			const fullMatchTextWithSurroundingContent = this.fullMatchText(true);
			replaceString = searchModel.replacePattern.getReplaceString(fullMatchTextWithSurroundingContent, searchModel.preserveCase);

			// Search/find normalize line endings - check whether \r prevents regex from matching
			if (replaceString === null) {
				const fullMatchTextWithoutCR = fullMatchTextWithSurroundingContent.replace(/\r\n/g, '\n');
				replaceString = searchModel.replacePattern.getReplaceString(fullMatchTextWithoutCR, searchModel.preserveCase);
			}
		}

		// Match string is still not matching. Could be unsupported matches (multi-line).
		if (replaceString === null) {
			replaceString = searchModel.replacePattern.pattern;
		}

		return replaceString;
	}

	fullMatchText(includeSurrounding = false): string {
		let thisMatchPreviewLines: string[];
		if (includeSurrounding) {
			thisMatchPreviewLines = this._fullPreviewLines;
		} else {
			thisMatchPreviewLines = this._fullPreviewLines.slice(this._fullPreviewRange.startLineNumber, this._fullPreviewRange.endLineNumber + 1);
			thisMatchPreviewLines[thisMatchPreviewLines.length - 1] = thisMatchPreviewLines[thisMatchPreviewLines.length - 1].slice(0, this._fullPreviewRange.endColumn);
			thisMatchPreviewLines[0] = thisMatchPreviewLines[0].slice(this._fullPreviewRange.startColumn);
		}

		return thisMatchPreviewLines.join('\n');
	}

	rangeInPreview() {
		// convert to editor's base 1 positions.
		return {
			...this._fullPreviewRange,
			startColumn: this._fullPreviewRange.startColumn + 1,
			endColumn: this._fullPreviewRange.endColumn + 1
		};
	}

	fullPreviewLines(): string[] {
		return this._fullPreviewLines.slice(this._fullPreviewRange.startLineNumber, this._fullPreviewRange.endLineNumber + 1);
	}

	getMatchString(): string {
		return this._oneLinePreviewText.substring(this._rangeInPreviewText.startColumn - 1, this._rangeInPreviewText.endColumn - 1);
	}
}

export class FileMatch extends Disposable implements IFileMatch {

	private static readonly _CURRENT_FIND_MATCH = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		zIndex: 13,
		className: 'currentFindMatch',
		overviewRuler: {
			color: themeColorFromId(overviewRulerFindMatchForeground),
			position: OverviewRulerLane.Center
		},
		minimap: {
			color: themeColorFromId(minimapFindMatch),
			position: MinimapPosition.Inline
		}
	});

	private static readonly _FIND_MATCH = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'findMatch',
		overviewRuler: {
			color: themeColorFromId(overviewRulerFindMatchForeground),
			position: OverviewRulerLane.Center
		},
		minimap: {
			color: themeColorFromId(minimapFindMatch),
			position: MinimapPosition.Inline
		}
	});

	private static getDecorationOption(selected: boolean): ModelDecorationOptions {
		return (selected ? FileMatch._CURRENT_FIND_MATCH : FileMatch._FIND_MATCH);
	}

	private _onChange = this._register(new Emitter<{ didRemove?: boolean; forceUpdateModel?: boolean }>());
	readonly onChange: Event<{ didRemove?: boolean; forceUpdateModel?: boolean }> = this._onChange.event;

	private _onDispose = this._register(new Emitter<void>());
	readonly onDispose: Event<void> = this._onDispose.event;

	private _resource: URI;
	private _fileStat?: IFileStatWithMetadata;
	private _model: ITextModel | null = null;
	private _modelListener: IDisposable | null = null;
	private _matches: Map<string, Match>;
	private _removedMatches: Set<string>;
	private _selectedMatch: Match | null = null;

	private _updateScheduler: RunOnceScheduler;
	private _modelDecorations: string[] = [];

	private _context: Map<number, string> = new Map();
	public get context(): Map<number, string> {
		return new Map(this._context);
	}

	constructor(private _query: IPatternInfo, private _previewOptions: ITextSearchPreviewOptions | undefined, private _maxResults: number | undefined, private _parent: FolderMatch, private rawMatch: IFileMatch,
		@IModelService private readonly modelService: IModelService, @IReplaceService private readonly replaceService: IReplaceService
	) {
		super();
		this._resource = this.rawMatch.resource;
		this._matches = new Map<string, Match>();
		this._removedMatches = new Set<string>();
		this._updateScheduler = new RunOnceScheduler(this.updateMatchesForModel.bind(this), 250);

		this.createMatches();
	}

	private createMatches(): void {
		const model = this.modelService.getModel(this._resource);
		if (model) {
			this.bindModel(model);
			this.updateMatchesForModel();
		} else {
			this.rawMatch.results!
				.filter(resultIsMatch)
				.forEach(rawMatch => {
					textSearchResultToMatches(rawMatch, this)
						.forEach(m => this.add(m));
				});

			this.addContext(this.rawMatch.results);
		}
	}

	bindModel(model: ITextModel): void {
		this._model = model;
		this._modelListener = this._model.onDidChangeContent(() => {
			this._updateScheduler.schedule();
		});
		this._model.onWillDispose(() => this.onModelWillDispose());
		this.updateHighlights();
	}

	private onModelWillDispose(): void {
		// Update matches because model might have some dirty changes
		this.updateMatchesForModel();
		this.unbindModel();
	}

	private unbindModel(): void {
		if (this._model) {
			this._updateScheduler.cancel();
			this._model.deltaDecorations(this._modelDecorations, []);
			this._model = null;
			this._modelListener!.dispose();
		}
	}

	private updateMatchesForModel(): void {
		// this is called from a timeout and might fire
		// after the model has been disposed
		if (!this._model) {
			return;
		}
		this._matches = new Map<string, Match>();

		const wordSeparators = this._query.isWordMatch && this._query.wordSeparators ? this._query.wordSeparators : null;
		const matches = this._model
			.findMatches(this._query.pattern, this._model.getFullModelRange(), !!this._query.isRegExp, !!this._query.isCaseSensitive, wordSeparators, false, this._maxResults);

		this.updateMatches(matches, true);
	}

	private updatesMatchesForLineAfterReplace(lineNumber: number, modelChange: boolean): void {
		if (!this._model) {
			return;
		}

		const range = {
			startLineNumber: lineNumber,
			startColumn: this._model.getLineMinColumn(lineNumber),
			endLineNumber: lineNumber,
			endColumn: this._model.getLineMaxColumn(lineNumber)
		};
		const oldMatches = Array.from(this._matches.values()).filter(match => match.range().startLineNumber === lineNumber);
		oldMatches.forEach(match => this._matches.delete(match.id()));

		const wordSeparators = this._query.isWordMatch && this._query.wordSeparators ? this._query.wordSeparators : null;
		const matches = this._model.findMatches(this._query.pattern, range, !!this._query.isRegExp, !!this._query.isCaseSensitive, wordSeparators, false, this._maxResults);
		this.updateMatches(matches, modelChange);
	}

	private updateMatches(matches: FindMatch[], modelChange: boolean): void {
		if (!this._model) {
			return;
		}

		const textSearchResults = editorMatchesToTextSearchResults(matches, this._model, this._previewOptions);
		textSearchResults.forEach(textSearchResult => {
			textSearchResultToMatches(textSearchResult, this).forEach(match => {
				if (!this._removedMatches.has(match.id())) {
					this.add(match);
					if (this.isMatchSelected(match)) {
						this._selectedMatch = match;
					}
				}
			});
		});

		this.addContext(
			addContextToEditorMatches(textSearchResults, this._model, this.parent().parent().query!)
				.filter((result => !resultIsMatch(result)) as ((a: any) => a is ITextSearchContext))
				.map(context => ({ ...context, lineNumber: context.lineNumber + 1 })));

		this._onChange.fire({ forceUpdateModel: modelChange });
		this.updateHighlights();
	}

	updateHighlights(): void {
		if (!this._model) {
			return;
		}

		if (this.parent().showHighlights) {
			this._modelDecorations = this._model.deltaDecorations(this._modelDecorations, this.matches().map(match => <IModelDeltaDecoration>{
				range: match.range(),
				options: FileMatch.getDecorationOption(this.isMatchSelected(match))
			}));
		} else {
			this._modelDecorations = this._model.deltaDecorations(this._modelDecorations, []);
		}
	}

	id(): string {
		return this.resource.toString();
	}

	parent(): FolderMatch {
		return this._parent;
	}

	matches(): Match[] {
		return Array.from(this._matches.values());
	}

	remove(match: Match): void {
		this.removeMatch(match);
		this._removedMatches.add(match.id());
		this._onChange.fire({ didRemove: true });
	}

	private replaceQ = Promise.resolve();
	async replace(toReplace: Match): Promise<void> {
		return this.replaceQ = this.replaceQ.finally(async () => {
			await this.replaceService.replace(toReplace);
			this.updatesMatchesForLineAfterReplace(toReplace.range().startLineNumber, false);
		});
	}

	setSelectedMatch(match: Match | null): void {
		if (match) {
			if (!this._matches.has(match.id())) {
				return;
			}
			if (this.isMatchSelected(match)) {
				return;
			}
		}

		this._selectedMatch = match;
		this.updateHighlights();
	}

	getSelectedMatch(): Match | null {
		return this._selectedMatch;
	}

	isMatchSelected(match: Match): boolean {
		return !!this._selectedMatch && this._selectedMatch.id() === match.id();
	}

	count(): number {
		return this.matches().length;
	}

	get resource(): URI {
		return this._resource;
	}

	name(): string {
		return getBaseLabel(this.resource);
	}

	addContext(results: ITextSearchResult[] | undefined) {
		if (!results) { return; }

		results
			.filter((result => !resultIsMatch(result)) as ((a: any) => a is ITextSearchContext))
			.forEach(context => this._context.set(context.lineNumber, context.text));
	}

	add(match: Match, trigger?: boolean) {
		this._matches.set(match.id(), match);
		if (trigger) {
			this._onChange.fire({ forceUpdateModel: true });
		}
	}

	private removeMatch(match: Match) {
		this._matches.delete(match.id());
		if (this.isMatchSelected(match)) {
			this.setSelectedMatch(null);
		} else {
			this.updateHighlights();
		}
	}

	async resolveFileStat(fileService: IFileService): Promise<void> {
		this._fileStat = await fileService.resolve(this.resource, { resolveMetadata: true }).catch(() => undefined);
	}

	public get fileStat(): IFileStatWithMetadata | undefined {
		return this._fileStat;
	}

	public set fileStat(stat: IFileStatWithMetadata | undefined) {
		this._fileStat = stat;
	}

	override dispose(): void {
		this.setSelectedMatch(null);
		this.unbindModel();
		this._onDispose.fire();
		super.dispose();
	}
}

export interface IChangeEvent {
	elements: FileMatch[];
	added?: boolean;
	removed?: boolean;
}

export class FolderMatch extends Disposable {

	private _onChange = this._register(new Emitter<IChangeEvent>());
	readonly onChange: Event<IChangeEvent> = this._onChange.event;

	private _onDispose = this._register(new Emitter<void>());
	readonly onDispose: Event<void> = this._onDispose.event;

	private _fileMatches: ResourceMap<FileMatch>;
	private _unDisposedFileMatches: ResourceMap<FileMatch>;
	private _replacingAll: boolean = false;

	constructor(protected _resource: URI | null, private _id: string, private _index: number, private _query: ITextQuery, private _parent: SearchResult, private _searchModel: SearchModel,
		@IReplaceService private readonly replaceService: IReplaceService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this._fileMatches = new ResourceMap<FileMatch>();
		this._unDisposedFileMatches = new ResourceMap<FileMatch>();
	}

	get searchModel(): SearchModel {
		return this._searchModel;
	}

	get showHighlights(): boolean {
		return this._parent.showHighlights;
	}

	set replacingAll(b: boolean) {
		this._replacingAll = b;
	}

	id(): string {
		return this._id;
	}

	get resource(): URI | null {
		return this._resource;
	}

	index(): number {
		return this._index;
	}

	name(): string {
		return getBaseLabel(withNullAsUndefined(this.resource)) || '';
	}

	parent(): SearchResult {
		return this._parent;
	}

	bindModel(model: ITextModel): void {
		const fileMatch = this._fileMatches.get(model.uri);
		if (fileMatch) {
			fileMatch.bindModel(model);
		}
	}

	add(raw: IFileMatch[], silent: boolean): void {
		const added: FileMatch[] = [];
		const updated: FileMatch[] = [];
		raw.forEach(rawFileMatch => {
			const existingFileMatch = this._fileMatches.get(rawFileMatch.resource);
			if (existingFileMatch) {
				rawFileMatch
					.results!
					.filter(resultIsMatch)
					.forEach(m => {
						textSearchResultToMatches(m, existingFileMatch)
							.forEach(m => existingFileMatch.add(m));
					});
				updated.push(existingFileMatch);

				existingFileMatch.addContext(rawFileMatch.results);
			} else {
				const fileMatch = this.instantiationService.createInstance(FileMatch, this._query.contentPattern, this._query.previewOptions, this._query.maxResults, this, rawFileMatch);
				this.doAdd(fileMatch);
				added.push(fileMatch);
				const disposable = fileMatch.onChange(({ didRemove }) => this.onFileChange(fileMatch, didRemove));
				fileMatch.onDispose(() => disposable.dispose());
			}
		});

		const elements = [...added, ...updated];
		if (!silent && elements.length) {
			this._onChange.fire({ elements, added: !!added.length });
		}
	}

	clear(): void {
		const changed: FileMatch[] = this.matches();
		this.disposeMatches();
		this._onChange.fire({ elements: changed, removed: true });
	}

	remove(matches: FileMatch | FileMatch[]): void {
		this.doRemove(matches);
	}

	replace(match: FileMatch): Promise<any> {
		return this.replaceService.replace([match]).then(() => {
			this.doRemove(match);
		});
	}

	replaceAll(): Promise<any> {
		const matches = this.matches();
		return this.replaceService.replace(matches).then(() => this.doRemove(matches));
	}

	matches(): FileMatch[] {
		return [...this._fileMatches.values()];
	}

	isEmpty(): boolean {
		return this.fileCount() === 0;
	}

	fileCount(): number {
		return this._fileMatches.size;
	}

	count(): number {
		return this.matches().reduce<number>((prev, match) => prev + match.count(), 0);
	}

	private onFileChange(fileMatch: FileMatch, removed = false): void {
		let added = false;
		if (!this._fileMatches.has(fileMatch.resource)) {
			this.doAdd(fileMatch);
			added = true;
		}
		if (fileMatch.count() === 0) {
			this.doRemove(fileMatch, false, false);
			added = false;
			removed = true;
		}
		if (!this._replacingAll) {
			this._onChange.fire({ elements: [fileMatch], added: added, removed: removed });
		}
	}

	private doAdd(fileMatch: FileMatch): void {
		this._fileMatches.set(fileMatch.resource, fileMatch);
		if (this._unDisposedFileMatches.has(fileMatch.resource)) {
			this._unDisposedFileMatches.delete(fileMatch.resource);
		}
	}

	private doRemove(fileMatches: FileMatch | FileMatch[], dispose: boolean = true, trigger: boolean = true): void {
		if (!Array.isArray(fileMatches)) {
			fileMatches = [fileMatches];
		}

		for (const match of fileMatches as FileMatch[]) {
			this._fileMatches.delete(match.resource);
			if (dispose) {
				match.dispose();
			} else {
				this._unDisposedFileMatches.set(match.resource, match);
			}
		}

		if (trigger) {
			this._onChange.fire({ elements: fileMatches, removed: true });
		}
	}

	private disposeMatches(): void {
		[...this._fileMatches.values()].forEach((fileMatch: FileMatch) => fileMatch.dispose());
		[...this._unDisposedFileMatches.values()].forEach((fileMatch: FileMatch) => fileMatch.dispose());
		this._fileMatches.clear();
		this._unDisposedFileMatches.clear();
	}

	override dispose(): void {
		this.disposeMatches();
		this._onDispose.fire();
		super.dispose();
	}
}

/**
 * BaseFolderMatch => optional resource ("other files" node)
 * FolderMatch => required resource (normal folder node)
 */
export class FolderMatchWithResource extends FolderMatch {
	constructor(_resource: URI, _id: string, _index: number, _query: ITextQuery, _parent: SearchResult, _searchModel: SearchModel,
		@IReplaceService replaceService: IReplaceService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super(_resource, _id, _index, _query, _parent, _searchModel, replaceService, instantiationService);
	}

	override get resource(): URI {
		return this._resource!;
	}
}

/**
 * Compares instances of the same match type. Different match types should not be siblings
 * and their sort order is undefined.
 */
export function searchMatchComparer(elementA: RenderableMatch, elementB: RenderableMatch, sortOrder: SearchSortOrder = SearchSortOrder.Default): number {
	if (elementA instanceof FolderMatch && elementB instanceof FolderMatch) {
		return elementA.index() - elementB.index();
	}

	if (elementA instanceof FileMatch && elementB instanceof FileMatch) {
		switch (sortOrder) {
			case SearchSortOrder.CountDescending:
				return elementB.count() - elementA.count();
			case SearchSortOrder.CountAscending:
				return elementA.count() - elementB.count();
			case SearchSortOrder.Type:
				return compareFileExtensions(elementA.name(), elementB.name());
			case SearchSortOrder.FileNames:
				return compareFileNames(elementA.name(), elementB.name());
			case SearchSortOrder.Modified:
				const fileStatA = elementA.fileStat;
				const fileStatB = elementB.fileStat;
				if (fileStatA && fileStatB) {
					return fileStatB.mtime - fileStatA.mtime;
				}
			// Fall through otherwise
			default:
				return comparePaths(elementA.resource.fsPath, elementB.resource.fsPath) || compareFileNames(elementA.name(), elementB.name());
		}
	}

	if (elementA instanceof Match && elementB instanceof Match) {
		return Range.compareRangesUsingStarts(elementA.range(), elementB.range());
	}

	return 0;
}

export class SearchResult extends Disposable {

	private _onChange = this._register(new Emitter<IChangeEvent>());
	readonly onChange: Event<IChangeEvent> = this._onChange.event;

	private _folderMatches: FolderMatchWithResource[] = [];
	private _otherFilesMatch: FolderMatch | null = null;
	private _folderMatchesMap: TernarySearchTree<URI, FolderMatchWithResource> = TernarySearchTree.forUris<FolderMatchWithResource>(key => this.uriIdentityService.extUri.ignorePathCasing(key));
	private _showHighlights: boolean = false;
	private _query: ITextQuery | null = null;

	private _rangeHighlightDecorations: RangeHighlightDecorations;
	private disposePastResults: () => void = () => { };

	private _isDirty = false;

	constructor(
		private _searchModel: SearchModel,
		@IReplaceService private readonly replaceService: IReplaceService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
	) {
		super();
		this._rangeHighlightDecorations = this.instantiationService.createInstance(RangeHighlightDecorations);

		this._register(this.modelService.onModelAdded(model => this.onModelAdded(model)));

		this._register(this.onChange(e => {
			if (e.removed) {
				this._isDirty = !this.isEmpty();
			}
		}));
	}

	get isDirty(): boolean {
		return this._isDirty;
	}

	get query(): ITextQuery | null {
		return this._query;
	}

	set query(query: ITextQuery | null) {
		// When updating the query we could change the roots, so keep a reference to them to clean up when we trigger `disposePastResults`
		const oldFolderMatches = this.folderMatches();
		new Promise<void>(resolve => this.disposePastResults = resolve)
			.then(() => oldFolderMatches.forEach(match => match.clear()))
			.then(() => oldFolderMatches.forEach(match => match.dispose()))
			.then(() => this._isDirty = false);

		this._rangeHighlightDecorations.removeHighlightRange();
		this._folderMatchesMap = TernarySearchTree.forUris<FolderMatchWithResource>(key => this.uriIdentityService.extUri.ignorePathCasing(key));

		if (!query) {
			return;
		}

		this._folderMatches = (query && query.folderQueries || [])
			.map(fq => fq.folder)
			.map((resource, index) => this.createFolderMatchWithResource(resource, resource.toString(), index, query));

		this._folderMatches.forEach(fm => this._folderMatchesMap.set(fm.resource, fm));
		this._otherFilesMatch = this.createOtherFilesFolderMatch('otherFiles', this._folderMatches.length + 1, query);

		this._query = query;
	}

	private onModelAdded(model: ITextModel): void {
		const folderMatch = this._folderMatchesMap.findSubstr(model.uri);
		if (folderMatch) {
			folderMatch.bindModel(model);
		}
	}

	private createFolderMatchWithResource(resource: URI, id: string, index: number, query: ITextQuery): FolderMatchWithResource {
		return <FolderMatchWithResource>this._createBaseFolderMatch(FolderMatchWithResource, resource, id, index, query);
	}

	private createOtherFilesFolderMatch(id: string, index: number, query: ITextQuery): FolderMatch {
		return this._createBaseFolderMatch(FolderMatch, null, id, index, query);
	}

	private _createBaseFolderMatch(folderMatchClass: typeof FolderMatch | typeof FolderMatchWithResource, resource: URI | null, id: string, index: number, query: ITextQuery): FolderMatch {
		const folderMatch = this.instantiationService.createInstance(folderMatchClass, resource, id, index, query, this, this._searchModel);
		const disposable = folderMatch.onChange((event) => this._onChange.fire(event));
		folderMatch.onDispose(() => disposable.dispose());
		return folderMatch;
	}

	get searchModel(): SearchModel {
		return this._searchModel;
	}

	add(allRaw: IFileMatch[], silent: boolean = false): void {
		// Split up raw into a list per folder so we can do a batch add per folder.

		const { byFolder, other } = this.groupFilesByFolder(allRaw);
		byFolder.forEach(raw => {
			if (!raw.length) {
				return;
			}

			const folderMatch = this.getFolderMatch(raw[0].resource);
			if (folderMatch) {
				folderMatch.add(raw, silent);
			}
		});

		this._otherFilesMatch?.add(other, silent);
		this.disposePastResults();
	}

	clear(): void {
		this.folderMatches().forEach((folderMatch) => folderMatch.clear());
		this.disposeMatches();
		this._folderMatches = [];
		this._otherFilesMatch = null;
	}

	remove(matches: FileMatch | FolderMatch | (FileMatch | FolderMatch)[]): void {
		if (!Array.isArray(matches)) {
			matches = [matches];
		}

		matches.forEach(m => {
			if (m instanceof FolderMatch) {
				m.clear();
			}
		});

		const fileMatches: FileMatch[] = matches.filter(m => m instanceof FileMatch) as FileMatch[];

		const { byFolder, other } = this.groupFilesByFolder(fileMatches);
		byFolder.forEach(matches => {
			if (!matches.length) {
				return;
			}

			this.getFolderMatch(matches[0].resource).remove(<FileMatch[]>matches);
		});

		if (other.length) {
			this.getFolderMatch(other[0].resource).remove(<FileMatch[]>other);
		}
	}

	replace(match: FileMatch): Promise<any> {
		return this.getFolderMatch(match.resource).replace(match);
	}

	replaceAll(progress: IProgress<IProgressStep>): Promise<any> {
		this.replacingAll = true;

		const promise = this.replaceService.replace(this.matches(), progress);
		const onDone = Event.stopwatch(Event.fromPromise(promise));
		/* __GDPR__
			"replaceAll.started" : {
				"duration" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
			}
		*/
		onDone(duration => this.telemetryService.publicLog('replaceAll.started', { duration }));

		return promise.then(() => {
			this.replacingAll = false;
			this.clear();
		}, () => {
			this.replacingAll = false;
		});
	}

	folderMatches(): FolderMatch[] {
		return this._otherFilesMatch ?
			[
				...this._folderMatches,
				this._otherFilesMatch
			] :
			[
				...this._folderMatches
			];
	}

	matches(): FileMatch[] {
		const matches: FileMatch[][] = [];
		this.folderMatches().forEach(folderMatch => {
			matches.push(folderMatch.matches());
		});

		return (<FileMatch[]>[]).concat(...matches);
	}

	isEmpty(): boolean {
		return this.folderMatches().every((folderMatch) => folderMatch.isEmpty());
	}

	fileCount(): number {
		return this.folderMatches().reduce<number>((prev, match) => prev + match.fileCount(), 0);
	}

	count(): number {
		return this.matches().reduce<number>((prev, match) => prev + match.count(), 0);
	}

	get showHighlights(): boolean {
		return this._showHighlights;
	}

	toggleHighlights(value: boolean): void {
		if (this._showHighlights === value) {
			return;
		}
		this._showHighlights = value;
		let selectedMatch: Match | null = null;
		this.matches().forEach((fileMatch: FileMatch) => {
			fileMatch.updateHighlights();
			if (!selectedMatch) {
				selectedMatch = fileMatch.getSelectedMatch();
			}
		});
		if (this._showHighlights && selectedMatch) {
			// TS?
			this._rangeHighlightDecorations.highlightRange(
				(<Match>selectedMatch).parent().resource,
				(<Match>selectedMatch).range()
			);
		} else {
			this._rangeHighlightDecorations.removeHighlightRange();
		}
	}

	get rangeHighlightDecorations(): RangeHighlightDecorations {
		return this._rangeHighlightDecorations;
	}

	private getFolderMatch(resource: URI): FolderMatch {
		const folderMatch = this._folderMatchesMap.findSubstr(resource);
		return folderMatch ? folderMatch : this._otherFilesMatch!;
	}

	private set replacingAll(running: boolean) {
		this.folderMatches().forEach((folderMatch) => {
			folderMatch.replacingAll = running;
		});
	}

	private groupFilesByFolder(fileMatches: IFileMatch[]): { byFolder: ResourceMap<IFileMatch[]>, other: IFileMatch[] } {
		const rawPerFolder = new ResourceMap<IFileMatch[]>();
		const otherFileMatches: IFileMatch[] = [];
		this._folderMatches.forEach(fm => rawPerFolder.set(fm.resource, []));

		fileMatches.forEach(rawFileMatch => {
			const folderMatch = this.getFolderMatch(rawFileMatch.resource);
			if (!folderMatch) {
				// foldermatch was previously removed by user or disposed for some reason
				return;
			}

			const resource = folderMatch.resource;
			if (resource) {
				rawPerFolder.get(resource)!.push(rawFileMatch);
			} else {
				otherFileMatches.push(rawFileMatch);
			}
		});

		return {
			byFolder: rawPerFolder,
			other: otherFileMatches
		};
	}

	private disposeMatches(): void {
		this.folderMatches().forEach(folderMatch => folderMatch.dispose());
		this._folderMatches = [];
		this._folderMatchesMap = TernarySearchTree.forUris<FolderMatchWithResource>(key => this.uriIdentityService.extUri.ignorePathCasing(key));
		this._rangeHighlightDecorations.removeHighlightRange();
	}

	override dispose(): void {
		this.disposePastResults();
		this.disposeMatches();
		this._rangeHighlightDecorations.dispose();
		super.dispose();
	}
}

export class SearchModel extends Disposable {

	private _searchResult: SearchResult;
	private _searchQuery: ITextQuery | null = null;
	private _replaceActive: boolean = false;
	private _replaceString: string | null = null;
	private _replacePattern: ReplacePattern | null = null;
	private _preserveCase: boolean = false;
	private _startStreamDelay: Promise<void> = Promise.resolve();
	private _resultQueue: IFileMatch[] = [];

	private readonly _onReplaceTermChanged: Emitter<void> = this._register(new Emitter<void>());
	readonly onReplaceTermChanged: Event<void> = this._onReplaceTermChanged.event;

	private currentCancelTokenSource: CancellationTokenSource | null = null;
	private searchCancelledForNewSearch: boolean = false;

	constructor(
		@ISearchService private readonly searchService: ISearchService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this._searchResult = this.instantiationService.createInstance(SearchResult, this);
	}

	isReplaceActive(): boolean {
		return this._replaceActive;
	}

	set replaceActive(replaceActive: boolean) {
		this._replaceActive = replaceActive;
	}

	get replacePattern(): ReplacePattern | null {
		return this._replacePattern;
	}

	get replaceString(): string {
		return this._replaceString || '';
	}

	set preserveCase(value: boolean) {
		this._preserveCase = value;
	}

	get preserveCase(): boolean {
		return this._preserveCase;
	}

	set replaceString(replaceString: string) {
		this._replaceString = replaceString;
		if (this._searchQuery) {
			this._replacePattern = new ReplacePattern(replaceString, this._searchQuery.contentPattern);
		}
		this._onReplaceTermChanged.fire();
	}

	get searchResult(): SearchResult {
		return this._searchResult;
	}

	search(query: ITextQuery, onProgress?: (result: ISearchProgressItem) => void): Promise<ISearchComplete> {
		this.cancelSearch(true);

		this._searchQuery = query;
		if (!this.searchConfig.searchOnType) {
			this.searchResult.clear();
		}

		this._searchResult.query = this._searchQuery;

		const progressEmitter = new Emitter<void>();
		this._replacePattern = new ReplacePattern(this.replaceString, this._searchQuery.contentPattern);

		// In search on type case, delay the streaming of results just a bit, so that we don't flash the only "local results" fast path
		this._startStreamDelay = new Promise(resolve => setTimeout(resolve, this.searchConfig.searchOnType ? 150 : 0));

		const tokenSource = this.currentCancelTokenSource = new CancellationTokenSource();
		const currentRequest = this.searchService.textSearch(this._searchQuery, this.currentCancelTokenSource.token, p => {
			progressEmitter.fire();
			this.onSearchProgress(p);

			if (onProgress) {
				onProgress(p);
			}
		});

		const dispose = () => tokenSource.dispose();
		currentRequest.then(dispose, dispose);

		const onDone = Event.fromPromise(currentRequest);
		const onFirstRender = Event.any<any>(onDone, progressEmitter.event);
		const onFirstRenderStopwatch = Event.stopwatch(onFirstRender);
		/* __GDPR__
			"searchResultsFirstRender" : {
				"duration" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
			}
		*/
		onFirstRenderStopwatch(duration => this.telemetryService.publicLog('searchResultsFirstRender', { duration }));

		const start = Date.now();
		currentRequest.then(
			value => this.onSearchCompleted(value, Date.now() - start),
			e => this.onSearchError(e, Date.now() - start));

		return currentRequest.finally(() => {
			/* __GDPR__
				"searchResultsFinished" : {
					"duration" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true }
				}
			*/
			this.telemetryService.publicLog('searchResultsFinished', { duration: Date.now() - start });
		});
	}

	private onSearchCompleted(completed: ISearchComplete | null, duration: number): ISearchComplete | null {
		if (!this._searchQuery) {
			throw new Error('onSearchCompleted must be called after a search is started');
		}

		this._searchResult.add(this._resultQueue);
		this._resultQueue = [];

		const options: IPatternInfo = Object.assign({}, this._searchQuery.contentPattern);
		delete (options as any).pattern;

		const stats = completed && completed.stats as ITextSearchStats;

		const fileSchemeOnly = this._searchQuery.folderQueries.every(fq => fq.folder.scheme === Schemas.file);
		const otherSchemeOnly = this._searchQuery.folderQueries.every(fq => fq.folder.scheme !== Schemas.file);
		const scheme = fileSchemeOnly ? Schemas.file :
			otherSchemeOnly ? 'other' :
				'mixed';

		/* __GDPR__
			"searchResultsShown" : {
				"count" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"fileCount": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"options": { "${inline}": [ "${IPatternInfo}" ] },
				"duration": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"type" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
				"scheme" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth" },
				"searchOnTypeEnabled" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		this.telemetryService.publicLog('searchResultsShown', {
			count: this._searchResult.count(),
			fileCount: this._searchResult.fileCount(),
			options,
			duration,
			type: stats && stats.type,
			scheme,
			searchOnTypeEnabled: this.searchConfig.searchOnType
		});
		return completed;
	}

	private onSearchError(e: any, duration: number): void {
		if (errors.isPromiseCanceledError(e)) {
			this.onSearchCompleted(
				this.searchCancelledForNewSearch
					? { exit: SearchCompletionExitCode.NewSearchStarted, results: [], messages: [] }
					: null,
				duration);
			this.searchCancelledForNewSearch = false;
		}
	}

	private async onSearchProgress(p: ISearchProgressItem) {
		if ((<IFileMatch>p).resource) {
			this._resultQueue.push(<IFileMatch>p);
			await this._startStreamDelay;
			if (this._resultQueue.length) {
				this._searchResult.add(this._resultQueue, true);
				this._resultQueue = [];
			}
		}
	}

	private get searchConfig() {
		return this.configurationService.getValue<ISearchConfigurationProperties>('search');
	}

	cancelSearch(cancelledForNewSearch = false): boolean {
		if (this.currentCancelTokenSource) {
			this.searchCancelledForNewSearch = cancelledForNewSearch;
			this.currentCancelTokenSource.cancel();
			return true;
		}
		return false;
	}

	override dispose(): void {
		this.cancelSearch();
		this.searchResult.dispose();
		super.dispose();
	}
}

export type FileMatchOrMatch = FileMatch | Match;

export type RenderableMatch = FolderMatch | FolderMatchWithResource | FileMatch | Match;

export class SearchWorkbenchService implements ISearchWorkbenchService {

	declare readonly _serviceBrand: undefined;
	private _searchModel: SearchModel | null = null;

	constructor(@IInstantiationService private readonly instantiationService: IInstantiationService) {
	}

	get searchModel(): SearchModel {
		if (!this._searchModel) {
			this._searchModel = this.instantiationService.createInstance(SearchModel);
		}
		return this._searchModel;
	}
}

export const ISearchWorkbenchService = createDecorator<ISearchWorkbenchService>('searchWorkbenchService');

export interface ISearchWorkbenchService {
	readonly _serviceBrand: undefined;

	readonly searchModel: SearchModel;
}

/**
 * Can add a range highlight decoration to a model.
 * It will automatically remove it when the model has its decorations changed.
 */
export class RangeHighlightDecorations implements IDisposable {

	private _decorationId: string | null = null;
	private _model: ITextModel | null = null;
	private readonly _modelDisposables = new DisposableStore();

	constructor(
		@IModelService private readonly _modelService: IModelService
	) {
	}

	removeHighlightRange() {
		if (this._model && this._decorationId) {
			this._model.deltaDecorations([this._decorationId], []);
		}
		this._decorationId = null;
	}

	highlightRange(resource: URI | ITextModel, range: Range, ownerId: number = 0): void {
		let model: ITextModel | null;
		if (URI.isUri(resource)) {
			model = this._modelService.getModel(resource);
		} else {
			model = resource;
		}

		if (model) {
			this.doHighlightRange(model, range);
		}
	}

	private doHighlightRange(model: ITextModel, range: Range) {
		this.removeHighlightRange();
		this._decorationId = model.deltaDecorations([], [{ range: range, options: RangeHighlightDecorations._RANGE_HIGHLIGHT_DECORATION }])[0];
		this.setModel(model);
	}

	private setModel(model: ITextModel) {
		if (this._model !== model) {
			this.clearModelListeners();
			this._model = model;
			this._modelDisposables.add(this._model.onDidChangeDecorations((e) => {
				this.clearModelListeners();
				this.removeHighlightRange();
				this._model = null;
			}));
			this._modelDisposables.add(this._model.onWillDispose(() => {
				this.clearModelListeners();
				this.removeHighlightRange();
				this._model = null;
			}));
		}
	}

	private clearModelListeners() {
		this._modelDisposables.clear();
	}

	dispose() {
		if (this._model) {
			this.removeHighlightRange();
			this._modelDisposables.dispose();
			this._model = null;
		}
	}

	private static readonly _RANGE_HIGHLIGHT_DECORATION = ModelDecorationOptions.register({
		stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
		className: 'rangeHighlight',
		isWholeLine: true
	});
}

function textSearchResultToMatches(rawMatch: ITextSearchMatch, fileMatch: FileMatch): Match[] {
	const previewLines = rawMatch.preview.text.split('\n');
	if (Array.isArray(rawMatch.ranges)) {
		return rawMatch.ranges.map((r, i) => {
			const previewRange: ISearchRange = (<ISearchRange[]>rawMatch.preview.matches)[i];
			return new Match(fileMatch, previewLines, previewRange, r);
		});
	} else {
		const previewRange = <ISearchRange>rawMatch.preview.matches;
		const match = new Match(fileMatch, previewLines, previewRange, rawMatch.ranges);
		return [match];
	}
}
