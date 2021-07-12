/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/searchEditor';
import * as DOM from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { alert } from 'vs/base/browser/ui/aria/aria';
import { Delayer } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { assertIsDefined } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICodeEditorViewState } from 'vs/editor/common/editorCommon';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { ReferencesController } from 'vs/editor/contrib/gotoSymbol/peek/referencesController';
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ILabelService } from 'vs/platform/label/common/label';
import { IEditorProgressService, LongRunningOperation } from 'vs/platform/progress/common/progress';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { inputBorder, registerColor, searchEditorFindMatch, searchEditorFindMatchBorder } from 'vs/platform/theme/common/colorRegistry';
import { attachInputBoxStyler } from 'vs/platform/theme/common/styler';
import { IThemeService, registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { BaseTextEditor } from 'vs/workbench/browser/parts/editor/textEditor';
import { EditorInputCapabilities, IEditorOpenContext } from 'vs/workbench/common/editor';
import { ExcludePatternInputWidget, IncludePatternInputWidget } from 'vs/workbench/contrib/search/browser/patternInputWidget';
import { SearchWidget } from 'vs/workbench/contrib/search/browser/searchWidget';
import { InputBoxFocusedKey } from 'vs/workbench/contrib/search/common/constants';
import { ITextQueryBuilderOptions, QueryBuilder } from 'vs/workbench/contrib/search/common/queryBuilder';
import { getOutOfWorkspaceEditorResources } from 'vs/workbench/contrib/search/common/search';
import { SearchModel, SearchResult } from 'vs/workbench/contrib/search/common/searchModel';
import { InSearchEditor, SearchEditorFindMatchClass, SearchEditorID } from 'vs/workbench/contrib/searchEditor/browser/constants';
import type { SearchConfiguration } from 'vs/workbench/contrib/searchEditor/browser/searchEditorInput';
import type { SearchEditorInput } from 'vs/workbench/contrib/searchEditor2/browser/searchEditorInput';
import { serializeSearchResultForEditor } from 'vs/workbench/contrib/searchEditor/browser/searchEditorSerialization';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IPatternInfo, ISearchComplete, ISearchConfigurationProperties, ITextQuery, SearchSortOrder, TextSearchCompleteMessageType } from 'vs/workbench/services/search/common/search';
import { searchDetailsIcon } from 'vs/workbench/contrib/search/browser/searchIcons';
import { IFileService } from 'vs/platform/files/common/files';
import { parseLinkedText } from 'vs/base/common/linkedText';
import { Link } from 'vs/platform/opener/browser/link';
import { MessageType } from 'vs/base/browser/ui/inputbox/inputBox';
import { Schemas } from 'vs/base/common/network';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { TextSearchCompleteMessage } from 'vs/workbench/services/search/common/searchExtTypes';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IEditorOptions } from 'vs/platform/editor/common/editor';

const RESULT_LINE_REGEX = /^(\s+)(\d+)(:| )(\s+)(.*)$/;
const FILE_LINE_REGEX = /^(\S.*):$/;

type SearchEditorViewState = ICodeEditorViewState & { focused: 'input' | 'editor' };

export class SearchEditor extends BaseTextEditor {
	static readonly ID: string = SearchEditorID;

	static readonly SEARCH_EDITOR_VIEW_STATE_PREFERENCE_KEY = 'searchEditorViewState';

	private queryEditorWidget!: SearchWidget;
	private searchResultEditor!: CodeEditorWidget;
	private queryEditorContainer!: HTMLElement;
	private dimension?: DOM.Dimension;
	private inputPatternIncludes!: IncludePatternInputWidget;
	private inputPatternExcludes!: ExcludePatternInputWidget;
	private includesExcludesContainer!: HTMLElement;
	private toggleQueryDetailsButton!: HTMLElement;
	private messageBox!: HTMLElement;

	private runSearchDelayer = new Delayer(0);
	private pauseSearching: boolean = false;
	private showingIncludesExcludes: boolean = false;
	private searchOperation: LongRunningOperation;
	private searchHistoryDelayer: Delayer<void>;
	private messageDisposables: DisposableStore;
	private container: HTMLElement;
	private searchModel: SearchModel;
	private ongoingOperations: number = 0;

	private inputDisposables: DisposableStore;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IModelService private readonly modelService: IModelService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ILabelService private readonly labelService: ILabelService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@ICommandService private readonly commandService: ICommandService,
		@IContextKeyService readonly contextKeyService: IContextKeyService,
		@IOpenerService readonly openerService: IOpenerService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorProgressService readonly progressService: IEditorProgressService,
		@ITextResourceConfigurationService textResourceService: ITextResourceConfigurationService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IEditorService editorService: IEditorService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService
	) {
		super(SearchEditor.ID, telemetryService, instantiationService, storageService, textResourceService, themeService, editorService, editorGroupService);
		this.container = DOM.$('.search-editor');

		this.searchOperation = this._register(new LongRunningOperation(progressService));
		this._register(this.messageDisposables = new DisposableStore());
		this._register(this.inputDisposables = new DisposableStore());

		this.searchHistoryDelayer = new Delayer<void>(2000);

		this.searchModel = this._register(this.instantiationService.createInstance(SearchModel));
	}

	override createEditor(parent: HTMLElement) {
		DOM.append(parent, this.container);
		this.queryEditorContainer = DOM.append(this.container, DOM.$('.query-container'));
		const searchResultContainer = DOM.append(this.container, DOM.$('.search-results'));
		super.createEditor(searchResultContainer);
		this.registerEditorListeners();

		const scopedContextKeyService = assertIsDefined(this.scopedContextKeyService);
		InSearchEditor.bindTo(scopedContextKeyService).set(true);

		this.createQueryEditor(
			this.queryEditorContainer,
			this.instantiationService.createChild(new ServiceCollection([IContextKeyService, scopedContextKeyService])),
			InputBoxFocusedKey.bindTo(scopedContextKeyService)
		);
	}


	private createQueryEditor(container: HTMLElement, scopedInstantiationService: IInstantiationService, inputBoxFocusedContextKey: IContextKey<boolean>) {
		this.queryEditorWidget = this._register(scopedInstantiationService.createInstance(SearchWidget, container, { _hideReplaceToggle: true, showContextToggle: true }));
		this._register(this.queryEditorWidget.onReplaceToggled(() => this.reLayout()));
		this._register(this.queryEditorWidget.onDidHeightChange(() => this.reLayout()));
		this._register(this.queryEditorWidget.onSearchSubmit(({ delay }) => this.triggerSearch({ delay })));
		this._register(this.queryEditorWidget.searchInput.onDidOptionChange(() => this.triggerSearch({ resetCursor: false })));
		this._register(this.queryEditorWidget.onDidToggleContext(() => this.triggerSearch({ resetCursor: false })));

		// Includes/Excludes Dropdown
		this.includesExcludesContainer = DOM.append(container, DOM.$('.includes-excludes'));

		// Toggle query details button
		this.toggleQueryDetailsButton = DOM.append(this.includesExcludesContainer, DOM.$('.expand' + ThemeIcon.asCSSSelector(searchDetailsIcon), { tabindex: 0, role: 'button', title: localize('moreSearch', "Toggle Search Details") }));
		this._register(DOM.addDisposableListener(this.toggleQueryDetailsButton, DOM.EventType.CLICK, e => {
			DOM.EventHelper.stop(e);
			this.toggleIncludesExcludes();
		}));
		this._register(DOM.addDisposableListener(this.toggleQueryDetailsButton, DOM.EventType.KEY_UP, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				DOM.EventHelper.stop(e);
				this.toggleIncludesExcludes();
			}
		}));
		this._register(DOM.addDisposableListener(this.toggleQueryDetailsButton, DOM.EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyMod.Shift | KeyCode.Tab)) {
				if (this.queryEditorWidget.isReplaceActive()) {
					this.queryEditorWidget.focusReplaceAllAction();
				}
				else {
					this.queryEditorWidget.isReplaceShown() ? this.queryEditorWidget.replaceInput.focusOnPreserve() : this.queryEditorWidget.focusRegexAction();
				}
				DOM.EventHelper.stop(e);
			}
		}));

		// Includes
		const folderIncludesList = DOM.append(this.includesExcludesContainer, DOM.$('.file-types.includes'));
		const filesToIncludeTitle = localize('searchScope.includes', "files to include");
		DOM.append(folderIncludesList, DOM.$('h4', undefined, filesToIncludeTitle));
		this.inputPatternIncludes = this._register(scopedInstantiationService.createInstance(IncludePatternInputWidget, folderIncludesList, this.contextViewService, {
			ariaLabel: localize('label.includes', 'Search Include Patterns'),
		}));
		this.inputPatternIncludes.onSubmit(triggeredOnType => this.triggerSearch({ resetCursor: false, delay: triggeredOnType ? this.searchConfig.searchOnTypeDebouncePeriod : 0 }));
		this._register(this.inputPatternIncludes.onChangeSearchInEditorsBox(() => this.triggerSearch()));

		// Excludes
		const excludesList = DOM.append(this.includesExcludesContainer, DOM.$('.file-types.excludes'));
		const excludesTitle = localize('searchScope.excludes', "files to exclude");
		DOM.append(excludesList, DOM.$('h4', undefined, excludesTitle));
		this.inputPatternExcludes = this._register(scopedInstantiationService.createInstance(ExcludePatternInputWidget, excludesList, this.contextViewService, {
			ariaLabel: localize('label.excludes', 'Search Exclude Patterns'),
		}));
		this.inputPatternExcludes.onSubmit(triggeredOnType => this.triggerSearch({ resetCursor: false, delay: triggeredOnType ? this.searchConfig.searchOnTypeDebouncePeriod : 0 }));
		this._register(this.inputPatternExcludes.onChangeIgnoreBox(() => this.triggerSearch()));

		[this.queryEditorWidget.searchInput, this.inputPatternIncludes, this.inputPatternExcludes, this.queryEditorWidget.contextLinesInput].map(input =>
			this._register(attachInputBoxStyler(input, this.themeService, { inputBorder: searchEditorTextInputBorder })));

		// Messages
		this.messageBox = DOM.append(container, DOM.$('.messages'));

		[this.queryEditorWidget.searchInputFocusTracker, this.queryEditorWidget.replaceInputFocusTracker, this.inputPatternExcludes.inputFocusTracker, this.inputPatternIncludes.inputFocusTracker]
			.forEach(tracker => {
				this._register(tracker.onDidFocus(() => setTimeout(() => inputBoxFocusedContextKey.set(true), 0)));
				this._register(tracker.onDidBlur(() => inputBoxFocusedContextKey.set(false)));
			});
	}

	private toggleRunAgainMessage(show: boolean) {
		DOM.clearNode(this.messageBox);
		this.messageDisposables.clear();

		if (show) {
			const runAgainLink = DOM.append(this.messageBox, DOM.$('a.pointer.prominent.message', {}, localize('runSearch', "Run Search")));
			this.messageDisposables.add(DOM.addDisposableListener(runAgainLink, DOM.EventType.CLICK, async () => {
				await this.triggerSearch();
				this.searchResultEditor.focus();
			}));
		}
	}

	private registerEditorListeners() {
		this.searchResultEditor = super.getControl() as CodeEditorWidget;
		this.searchResultEditor.onMouseUp(e => {
			if (e.event.detail === 2) {
				const behaviour = this.searchConfig.searchEditor.doubleClickBehaviour;
				const position = e.target.position;
				if (position && behaviour !== 'selectWord') {
					const line = this.searchResultEditor.getModel()?.getLineContent(position.lineNumber) ?? '';
					if (line.match(RESULT_LINE_REGEX)) {
						this.searchResultEditor.setSelection(Range.fromPositions(position));
						this.commandService.executeCommand(behaviour === 'goToLocation' ? 'editor.action.goToDeclaration' : 'editor.action.openDeclarationToTheSide');
					} else if (line.match(FILE_LINE_REGEX)) {
						this.searchResultEditor.setSelection(Range.fromPositions(position));
						this.commandService.executeCommand('editor.action.peekDefinition');
					}
				}
			}
		});

		this._register(this.onDidBlur(() => this.saveViewState()));

		// this._register(this.searchResultEditor.onDidChangeModelContent(() => this.getInput()?.setDirty(true)));
	}

	override getControl() {
		return this.searchResultEditor;
	}

	override focus() {
		const viewState = this.loadViewState();
		if (viewState && viewState.focused === 'editor') {
			this.searchResultEditor.focus();
		} else {
			this.queryEditorWidget.focus();
		}
	}

	focusSearchInput() {
		this.queryEditorWidget.searchInput.focus();
	}

	focusNextInput() {
		if (this.queryEditorWidget.searchInputHasFocus()) {
			if (this.showingIncludesExcludes) {
				this.inputPatternIncludes.focus();
			} else {
				this.searchResultEditor.focus();
			}
		} else if (this.inputPatternIncludes.inputHasFocus()) {
			this.inputPatternExcludes.focus();
		} else if (this.inputPatternExcludes.inputHasFocus()) {
			this.searchResultEditor.focus();
		} else if (this.searchResultEditor.hasWidgetFocus()) {
			// pass
		}
	}

	focusPrevInput() {
		if (this.queryEditorWidget.searchInputHasFocus()) {
			this.searchResultEditor.focus(); // wrap
		} else if (this.inputPatternIncludes.inputHasFocus()) {
			this.queryEditorWidget.searchInput.focus();
		} else if (this.inputPatternExcludes.inputHasFocus()) {
			this.inputPatternIncludes.focus();
		} else if (this.searchResultEditor.hasWidgetFocus()) {
			// unreachable.
		}
	}

	setQuery(query: string) {
		this.queryEditorWidget.searchInput.setValue(query);
	}

	selectQuery() {
		this.queryEditorWidget.searchInput.select();
	}

	toggleWholeWords() {
		this.queryEditorWidget.searchInput.setWholeWords(!this.queryEditorWidget.searchInput.getWholeWords());
		this.triggerSearch({ resetCursor: false });
	}

	toggleRegex() {
		this.queryEditorWidget.searchInput.setRegex(!this.queryEditorWidget.searchInput.getRegex());
		this.triggerSearch({ resetCursor: false });
	}

	toggleCaseSensitive() {
		this.queryEditorWidget.searchInput.setCaseSensitive(!this.queryEditorWidget.searchInput.getCaseSensitive());
		this.triggerSearch({ resetCursor: false });
	}

	toggleContextLines() {
		this.queryEditorWidget.toggleContextLines();
	}

	modifyContextLines(increase: boolean) {
		this.queryEditorWidget.modifyContextLines(increase);
	}

	toggleQueryDetails() {
		this.toggleIncludesExcludes();
	}

	deleteResultBlock() {
		const linesToDelete = new Set<number>();

		const selections = this.searchResultEditor.getSelections();
		const model = this.searchResultEditor.getModel();
		if (!(selections && model)) { return; }

		const maxLine = model.getLineCount();
		const minLine = 1;

		const deleteUp = (start: number) => {
			for (let cursor = start; cursor >= minLine; cursor--) {
				const line = model.getLineContent(cursor);
				linesToDelete.add(cursor);
				if (line[0] !== undefined && line[0] !== ' ') {
					break;
				}
			}
		};

		const deleteDown = (start: number): number | undefined => {
			linesToDelete.add(start);
			for (let cursor = start + 1; cursor <= maxLine; cursor++) {
				const line = model.getLineContent(cursor);
				if (line[0] !== undefined && line[0] !== ' ') {
					return cursor;
				}
				linesToDelete.add(cursor);
			}
			return;
		};

		const endingCursorLines: Array<number | undefined> = [];
		for (const selection of selections) {
			const lineNumber = selection.startLineNumber;
			endingCursorLines.push(deleteDown(lineNumber));
			deleteUp(lineNumber);
			for (let inner = selection.startLineNumber; inner <= selection.endLineNumber; inner++) {
				linesToDelete.add(inner);
			}
		}

		if (endingCursorLines.length === 0) { endingCursorLines.push(1); }

		const isDefined = <T>(x: T | undefined): x is T => x !== undefined;

		model.pushEditOperations(this.searchResultEditor.getSelections(),
			[...linesToDelete].map(line => ({ range: new Range(line, 1, line + 1, 1), text: '' })),
			() => endingCursorLines.filter(isDefined).map(line => new Selection(line, 1, line, 1)));
	}

	cleanState() {
		// this.getInput()?.setDirty(false);
	}

	private get searchConfig(): ISearchConfigurationProperties {
		return this.configurationService.getValue<ISearchConfigurationProperties>('search');
	}

	private iterateThroughMatches(reverse: boolean) {
		const model = this.searchResultEditor.getModel();
		if (!model) { return; }

		const lastLine = model.getLineCount() ?? 1;
		const lastColumn = model.getLineLength(lastLine);

		const fallbackStart = reverse ? new Position(lastLine, lastColumn) : new Position(1, 1);

		const currentPosition = this.searchResultEditor.getSelection()?.getStartPosition() ?? fallbackStart;

		const matchRanges = this.getInput()?.getMatchRanges();
		if (!matchRanges) { return; }

		const matchRange = (reverse ? findPrevRange : findNextRange)(matchRanges, currentPosition);

		this.searchResultEditor.setSelection(matchRange);
		this.searchResultEditor.revealLineInCenterIfOutsideViewport(matchRange.startLineNumber);
		this.searchResultEditor.focus();

		const matchLineText = model.getLineContent(matchRange.startLineNumber);
		const matchText = model.getValueInRange(matchRange);
		let file = '';
		for (let line = matchRange.startLineNumber; line >= 1; line--) {
			const lineText = model.getValueInRange(new Range(line, 1, line, 2));
			if (lineText !== ' ') { file = model.getLineContent(line); break; }
		}
		alert(localize('searchResultItem', "Matched {0} at {1} in file {2}", matchText, matchLineText, file.slice(0, file.length - 1)));
	}

	focusNextResult() {
		this.iterateThroughMatches(false);
	}

	focusPreviousResult() {
		this.iterateThroughMatches(true);
	}

	focusAllResults() {
		this.searchResultEditor
			.setSelections((this.getInput()?.getMatchRanges() ?? []).map(
				range => new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn)));
		this.searchResultEditor.focus();
	}

	async triggerSearch(_options?: { resetCursor?: boolean; delay?: number; focusResults?: boolean }) {
		const options = { resetCursor: true, delay: 0, ..._options };

		if (!this.pauseSearching) {
			await this.runSearchDelayer.trigger(async () => {
				this.toggleRunAgainMessage(false);
				await this.doRunSearch();
				if (options.resetCursor) {
					this.searchResultEditor.setPosition(new Position(1, 1));
					this.searchResultEditor.setScrollPosition({ scrollTop: 0, scrollLeft: 0 });
				}
				if (options.focusResults) {
					this.searchResultEditor.focus();
				}
			}, options.delay);
		}
	}

	private readConfigFromWidget(): SearchConfiguration {
		return {
			isCaseSensitive: this.queryEditorWidget.searchInput.getCaseSensitive(),
			contextLines: this.queryEditorWidget.getContextLines(),
			filesToExclude: this.inputPatternExcludes.getValue(),
			filesToInclude: this.inputPatternIncludes.getValue(),
			query: this.queryEditorWidget.searchInput.getValue(),
			isRegexp: this.queryEditorWidget.searchInput.getRegex(),
			matchWholeWord: this.queryEditorWidget.searchInput.getWholeWords(),
			useExcludeSettingsAndIgnoreFiles: this.inputPatternExcludes.useExcludesAndIgnoreFiles(),
			onlyOpenEditors: this.inputPatternIncludes.onlySearchInOpenEditors(),
			showIncludesExcludes: this.showingIncludesExcludes
		};
	}

	private async doRunSearch() {
		this.searchModel.cancelSearch(true);

		const startInput = this.getInput();
		if (!startInput) { return; }

		this.searchHistoryDelayer.trigger(() => {
			this.queryEditorWidget.searchInput.onSearchSubmit();
			this.inputPatternExcludes.onSearchSubmit();
			this.inputPatternIncludes.onSearchSubmit();
		});

		const config = this.readConfigFromWidget();

		if (!config.query) { return; }

		const content: IPatternInfo = {
			pattern: config.query,
			isRegExp: config.isRegexp,
			isCaseSensitive: config.isCaseSensitive,
			isWordMatch: config.matchWholeWord,
		};

		const options: ITextQueryBuilderOptions = {
			_reason: 'searchEditor',
			extraFileResources: this.instantiationService.invokeFunction(getOutOfWorkspaceEditorResources),
			maxResults: 10000,
			disregardIgnoreFiles: !config.useExcludeSettingsAndIgnoreFiles || undefined,
			disregardExcludeSettings: !config.useExcludeSettingsAndIgnoreFiles || undefined,
			excludePattern: config.filesToExclude,
			includePattern: config.filesToInclude,
			onlyOpenEditors: config.onlyOpenEditors,
			previewOptions: {
				matchLines: 1,
				charsPerLine: 1000
			},
			afterContext: config.contextLines,
			beforeContext: config.contextLines,
			isSmartCase: this.searchConfig.smartCase,
			expandPatterns: true
		};

		const folderResources = this.contextService.getWorkspace().folders;
		let query: ITextQuery;
		try {
			const queryBuilder = this.instantiationService.createInstance(QueryBuilder);
			query = queryBuilder.text(content, folderResources.map(folder => folder.uri), options);
		}
		catch (err) {
			return;
		}

		this.searchOperation.start(500);
		this.ongoingOperations++;

		const model = assertIsDefined(await startInput.resolve());

		model.updateConfig(config);

		startInput.ongoingSearchOperation = this.searchModel.search(query).finally(() => {
			this.ongoingOperations--;
			if (this.ongoingOperations === 0) {
				this.searchOperation.stop();
			}
		});

		const searchOperation = await startInput.ongoingSearchOperation;
		this.onSearchComplete(searchOperation, config, startInput);
	}

	private async onSearchComplete(searchOperation: ISearchComplete, startConfig: SearchConfiguration, startInput: SearchEditorInput) {
		const input = this.getInput();
		if (!input ||
			input !== startInput ||
			JSON.stringify(startConfig) !== JSON.stringify(this.readConfigFromWidget())) {
			return;
		}

		input.ongoingSearchOperation = undefined;

		const sortOrder = this.searchConfig.sortOrder;
		if (sortOrder === SearchSortOrder.Modified) {
			await this.retrieveFileStats(this.searchModel.searchResult);
		}

		const controller = ReferencesController.get(this.searchResultEditor);
		controller.closeWidget(false);
		const labelFormatter = (uri: URI): string => this.labelService.getUriLabel(uri, { relative: true });
		const results = serializeSearchResultForEditor(this.searchModel.searchResult, startConfig.filesToInclude, startConfig.filesToExclude, startConfig.contextLines, labelFormatter, sortOrder, searchOperation?.limitHit);
		const model = assertIsDefined(await input.resolve());
		model.setResults(results);
		this.searchResultEditor.setValue(model.getEditorValue());

		let warningMessage = '';

		if (searchOperation && searchOperation.limitHit) {
			warningMessage += localize('searchMaxResultsWarning', "The result set only contains a subset of all matches. Be more specific in your search to narrow down the results.");
		}

		if (searchOperation && searchOperation.messages) {
			for (const message of searchOperation.messages) {
				if (message.type === TextSearchCompleteMessageType.Information) {
					this.addMessage(message);
				}
				else if (message.type === TextSearchCompleteMessageType.Warning) {
					warningMessage += (warningMessage ? ' - ' : '') + message.text;
				}
			}
		}

		if (warningMessage) {
			this.queryEditorWidget.searchInput.showMessage({
				content: warningMessage,
				type: MessageType.WARNING
			});
		}

		// input.setDirty(!input.hasCapability(EditorInputCapabilities.Untitled));
		input.setMatchRanges(results.matchRanges);
	}

	private addMessage(message: TextSearchCompleteMessage) {
		const linkedText = parseLinkedText(message.text);

		let messageBox: HTMLElement;
		if (this.messageBox.firstChild) {
			messageBox = this.messageBox.firstChild as HTMLElement;
		} else {
			messageBox = DOM.append(this.messageBox, DOM.$('.message'));
		}

		if (messageBox.innerText) {
			DOM.append(messageBox, document.createTextNode(' - '));
		}

		for (const node of linkedText.nodes) {
			if (typeof node === 'string') {
				DOM.append(messageBox, document.createTextNode(node));
			} else {
				const link = this.instantiationService.createInstance(Link, node, {
					opener: async href => {
						const parsed = URI.parse(href, true);
						if (parsed.scheme === Schemas.command && message.trusted) {
							const result = await this.commandService.executeCommand(parsed.path);
							if ((result as any)?.triggerSearch) {
								this.triggerSearch();
							}
						} else if (parsed.scheme === Schemas.https) {
							this.openerService.open(parsed);
						} else {
							if (parsed.scheme === Schemas.command && !message.trusted) {
								this.notificationService.error(localize('unable to open trust', "Unable to open command link from untrusted source: {0}", href));
							} else {
								this.notificationService.error(localize('unable to open', "Unable to open unknown link: {0}", href));
							}
						}
					}
				});
				DOM.append(messageBox, link.el);
				this.messageDisposables.add(link);
			}
		}
	}

	private async retrieveFileStats(searchResult: SearchResult): Promise<void> {
		const files = searchResult.matches().filter(f => !f.fileStat).map(f => f.resolveFileStat(this.fileService));
		await Promise.all(files);
	}

	override layout(dimension: DOM.Dimension) {
		this.dimension = dimension;
		this.reLayout();
	}

	getSelected() {
		const selection = this.searchResultEditor.getSelection();
		if (selection) {
			return this.searchResultEditor.getModel()?.getValueInRange(selection) ?? '';
		}
		return '';
	}

	private reLayout() {
		if (this.dimension) {
			this.queryEditorWidget.setWidth(this.dimension.width - 28 /* container margin */);
			this.searchResultEditor.layout({ height: this.dimension.height - DOM.getTotalHeight(this.queryEditorContainer), width: this.dimension.width });
			this.inputPatternExcludes.setWidth(this.dimension.width - 28 /* container margin */);
			this.inputPatternIncludes.setWidth(this.dimension.width - 28 /* container margin */);
		}
	}

	private getInput(): SearchEditorInput | undefined {
		return this._input as SearchEditorInput;
	}

	private priorConfig: Partial<Readonly<SearchConfiguration>> | undefined;
	setSearchConfig(config: Partial<Readonly<SearchConfiguration>>) {
		this.priorConfig = config;
		if (config.query !== undefined) { this.queryEditorWidget.setValue(config.query); }
		if (config.isCaseSensitive !== undefined) { this.queryEditorWidget.searchInput.setCaseSensitive(config.isCaseSensitive); }
		if (config.isRegexp !== undefined) { this.queryEditorWidget.searchInput.setRegex(config.isRegexp); }
		if (config.matchWholeWord !== undefined) { this.queryEditorWidget.searchInput.setWholeWords(config.matchWholeWord); }
		if (config.contextLines !== undefined) { this.queryEditorWidget.setContextLines(config.contextLines); }
		if (config.filesToExclude !== undefined) { this.inputPatternExcludes.setValue(config.filesToExclude); }
		if (config.filesToInclude !== undefined) { this.inputPatternIncludes.setValue(config.filesToInclude); }
		if (config.onlyOpenEditors !== undefined) { this.inputPatternIncludes.setOnlySearchInOpenEditors(config.onlyOpenEditors); }
		if (config.useExcludeSettingsAndIgnoreFiles !== undefined) { this.inputPatternExcludes.setUseExcludesAndIgnoreFiles(config.useExcludeSettingsAndIgnoreFiles); }
		if (config.showIncludesExcludes !== undefined) { this.toggleIncludesExcludes(config.showIncludesExcludes); }
	}

	override async setInput(newInput: SearchEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.saveViewState();
		this.inputDisposables.clear();

		await super.setInput(newInput, options, context, token);
		if (token.isCancellationRequested) {
			return;
		}

		const newModel = assertIsDefined(await newInput.resolve());
		if (token.isCancellationRequested) { return; }
		const newValue = newModel.getEditorValue();
		const newConfig = newModel.getConfig();

		this.searchResultEditor.setValue(newModel.getEditorValue());
		this.pauseSearching = true;

		this.toggleRunAgainMessage(!newInput.ongoingSearchOperation && newValue === '' && newConfig.query !== '');

		this.setSearchConfig(newConfig);

		// this.inputDisposables.add(newModel.onDidChangeContent(newConfig => {
		// 	if (newConfig !== this.priorConfig) {
		// 		this.pauseSearching = true;
		// 		this.setSearchConfig(newConfig);
		// 		this.pauseSearching = false;
		// 	}
		// }));

		this.restoreViewState();

		if (!options?.preserveFocus) {
			this.focus();
		}

		this.pauseSearching = false;

		if (newInput.ongoingSearchOperation) {
			const existingConfig = this.readConfigFromWidget();
			newInput.ongoingSearchOperation.then(complete => {
				this.onSearchComplete(complete, existingConfig, newInput);
			});
		}
	}

	private toggleIncludesExcludes(_shouldShow?: boolean): void {
		const cls = 'expanded';
		const shouldShow = _shouldShow ?? !this.includesExcludesContainer.classList.contains(cls);

		if (shouldShow) {
			this.toggleQueryDetailsButton.setAttribute('aria-expanded', 'true');
			this.includesExcludesContainer.classList.add(cls);
		} else {
			this.toggleQueryDetailsButton.setAttribute('aria-expanded', 'false');
			this.includesExcludesContainer.classList.remove(cls);
		}

		this.showingIncludesExcludes = this.includesExcludesContainer.classList.contains(cls);

		this.reLayout();
	}

	override saveState() {
		this.saveViewState();
		super.saveState();
	}

	private saveViewState() {
		const resource = this.getInput()?.resource;
		if (resource) { this.saveTextEditorViewState(resource); }
	}

	protected override retrieveTextEditorViewState(resource: URI): SearchEditorViewState | null {
		const control = this.getControl();
		const editorViewState = control.saveViewState();
		if (!editorViewState) { return null; }
		if (resource.toString() !== this.getInput()?.resource.toString()) { return null; }

		return { ...editorViewState, focused: this.searchResultEditor.hasWidgetFocus() ? 'editor' : 'input' };
	}

	private loadViewState() {
		const resource = assertIsDefined(this.getInput()?.resource);
		return this.loadTextEditorViewState(resource) as SearchEditorViewState;
	}

	private restoreViewState() {
		const viewState = this.loadViewState();
		if (viewState) { this.searchResultEditor.restoreViewState(viewState); }
	}

	override clearInput() {
		this.saveViewState();
		super.clearInput();
	}

	getAriaLabel() {
		return this.getInput()?.getName() ?? localize('searchEditor', "Search");
	}
}

registerThemingParticipant((theme, collector) => {
	collector.addRule(`.monaco-editor .${SearchEditorFindMatchClass} { background-color: ${theme.getColor(searchEditorFindMatch)}; }`);

	const findMatchHighlightBorder = theme.getColor(searchEditorFindMatchBorder);
	if (findMatchHighlightBorder) {
		collector.addRule(`.monaco-editor .${SearchEditorFindMatchClass} { border: 1px ${theme.type === 'hc' ? 'dotted' : 'solid'} ${findMatchHighlightBorder}; box-sizing: border-box; }`);
	}
});

export const searchEditorTextInputBorder = registerColor('searchEditor.textInputBorder', { dark: inputBorder, light: inputBorder, hc: inputBorder }, localize('textInputBoxBorder', "Search editor text input box border."));

function findNextRange(matchRanges: Range[], currentPosition: Position) {
	for (const matchRange of matchRanges) {
		if (Position.isBefore(currentPosition, matchRange.getStartPosition())) {
			return matchRange;
		}
	}
	return matchRanges[0];
}

function findPrevRange(matchRanges: Range[], currentPosition: Position) {
	for (let i = matchRanges.length - 1; i >= 0; i--) {
		const matchRange = matchRanges[i];
		if (Position.isBefore(matchRange.getStartPosition(), currentPosition)) {
			{
				return matchRange;
			}
		}
	}
	return matchRanges[matchRanges.length - 1];
}
