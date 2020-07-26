/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/timelinePane';
import { localize } from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { IAction, ActionRunner, IActionViewItemProvider } from 'vs/base/common/actions';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { fromNow } from 'vs/base/common/date';
import { debounce } from 'vs/base/common/decorators';
import { Emitter, Event } from 'vs/base/common/event';
import { FuzzyScore, createMatches } from 'vs/base/common/filters';
import { Iterable } from 'vs/base/common/iterator';
import { DisposableStore, IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { basename } from 'vs/base/common/path';
import { escapeRegExpCharacters } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { IconLabel } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { IListVirtualDelegate, IIdentityProvider, IKeyboardNavigationLabelProvider } from 'vs/base/browser/ui/list/list';
import { ITreeNode, ITreeRenderer, ITreeContextMenuEvent, ITreeElement } from 'vs/base/browser/ui/tree/tree';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ContextKeyExpr, IContextKeyService, RawContextKey, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ITimelineService, TimelineChangeEvent, TimelineItem, TimelineOptions, TimelineProvidersChangeEvent, TimelineRequest, Timeline } from 'vs/workbench/contrib/timeline/common/timeline';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { SideBySideEditor, toResource } from 'vs/workbench/common/editor';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IThemeService, LIGHT, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IProgressService } from 'vs/platform/progress/common/progress';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { MenuEntryActionViewItem, createAndFillInContextMenuActions, SubmenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { MenuItemAction, IMenuService, MenuId, registerAction2, Action2, MenuRegistry, SubmenuItemAction } from 'vs/platform/actions/common/actions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';

const ItemHeight = 22;

type TreeElement = TimelineItem | LoadMoreCommand;

function isLoadMoreCommand(item: TreeElement | undefined): item is LoadMoreCommand {
	return item instanceof LoadMoreCommand;
}

function isTimelineItem(item: TreeElement | undefined): item is TimelineItem {
	return !item?.handle.startsWith('vscode-command:') ?? false;
}

function updateRelativeTime(item: TimelineItem, lastRelativeTime: string | undefined): string | undefined {
	item.relativeTime = isTimelineItem(item) ? fromNow(item.timestamp) : undefined;
	if (lastRelativeTime === undefined || item.relativeTime !== lastRelativeTime) {
		lastRelativeTime = item.relativeTime;
		item.hideRelativeTime = false;
	} else {
		item.hideRelativeTime = true;
	}

	return lastRelativeTime;
}

interface TimelineActionContext {
	uri: URI | undefined;
	item: TreeElement;
}

class TimelineAggregate {
	readonly items: TimelineItem[];
	readonly source: string;

	lastRenderedIndex: number;

	constructor(timeline: Timeline) {
		this.source = timeline.source;
		this.items = timeline.items;
		this._cursor = timeline.paging?.cursor;
		this.lastRenderedIndex = -1;
	}

	private _cursor?: string;
	get cursor(): string | undefined {
		return this._cursor;
	}

	get more(): boolean {
		return this._cursor !== undefined;
	}

	get newest(): TimelineItem | undefined {
		return this.items[0];
	}

	get oldest(): TimelineItem | undefined {
		return this.items[this.items.length - 1];
	}

	add(timeline: Timeline, options: TimelineOptions) {
		let updated = false;

		if (timeline.items.length !== 0 && this.items.length !== 0) {
			updated = true;

			const ids = new Set();
			const timestamps = new Set();

			for (const item of timeline.items) {
				if (item.id === undefined) {
					timestamps.add(item.timestamp);
				}
				else {
					ids.add(item.id);
				}
			}

			// Remove any duplicate items
			let i = this.items.length;
			let item;
			while (i--) {
				item = this.items[i];
				if ((item.id !== undefined && ids.has(item.id)) || timestamps.has(item.timestamp)) {
					this.items.splice(i, 1);
				}
			}

			if ((timeline.items[timeline.items.length - 1]?.timestamp ?? 0) >= (this.newest?.timestamp ?? 0)) {
				this.items.splice(0, 0, ...timeline.items);
			} else {
				this.items.push(...timeline.items);
			}
		} else if (timeline.items.length !== 0) {
			updated = true;

			this.items.push(...timeline.items);
		}

		// If we are not requesting more recent items than we have, then update the cursor
		if (options.cursor !== undefined || typeof options.limit !== 'object') {
			this._cursor = timeline.paging?.cursor;
		}

		if (updated) {
			this.items.sort(
				(a, b) =>
					(b.timestamp - a.timestamp) ||
					(a.source === undefined
						? b.source === undefined ? 0 : 1
						: b.source === undefined ? -1 : b.source.localeCompare(a.source, undefined, { numeric: true, sensitivity: 'base' }))
			);
		}

		return updated;
	}

	private _stale = false;
	get stale() {
		return this._stale;
	}

	private _requiresReset = false;
	get requiresReset(): boolean {
		return this._requiresReset;
	}

	invalidate(requiresReset: boolean) {
		this._stale = true;
		this._requiresReset = requiresReset;
	}
}

class LoadMoreCommand {
	readonly handle = 'vscode-command:loadMore';
	readonly timestamp = 0;
	readonly description = undefined;
	readonly detail = undefined;
	readonly contextValue = undefined;
	// Make things easier for duck typing
	readonly id = undefined;
	readonly icon = undefined;
	readonly iconDark = undefined;
	readonly source = undefined;
	readonly relativeTime = undefined;
	readonly hideRelativeTime = undefined;

	constructor(loading: boolean) {
		this._loading = loading;
	}
	private _loading: boolean = false;
	get loading(): boolean {
		return this._loading;
	}
	set loading(value: boolean) {
		this._loading = value;
	}

	get ariaLabel() {
		return this.label;
	}

	get label() {
		return this.loading ? localize('timeline.loadingMore', "Loading...") : localize('timeline.loadMore', "Load more");
	}

	get themeIcon(): { id: string; } | undefined {
		return undefined; //this.loading ? { id: 'sync~spin' } : undefined;
	}
}

export const TimelineFollowActiveEditorContext = new RawContextKey<boolean>('timelineFollowActiveEditor', true);

export class TimelinePane extends ViewPane {
	static readonly TITLE = localize('timeline', "Timeline");

	private $container!: HTMLElement;
	private $message!: HTMLDivElement;
	private $titleDescription!: HTMLSpanElement;
	private $tree!: HTMLDivElement;
	private tree!: WorkbenchObjectTree<TreeElement, FuzzyScore>;
	private treeRenderer: TimelineTreeRenderer | undefined;
	private commands: TimelinePaneCommands;
	private visibilityDisposables: DisposableStore | undefined;

	private followActiveEditorContext: IContextKey<boolean>;

	private excludedSources: Set<string>;
	private pendingRequests = new Map<string, TimelineRequest>();
	private timelinesBySource = new Map<string, TimelineAggregate>();

	private uri: URI | undefined;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService protected keybindingService: IKeybindingService,
		@IContextMenuService protected contextMenuService: IContextMenuService,
		@IContextKeyService protected contextKeyService: IContextKeyService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IEditorService protected editorService: IEditorService,
		@ICommandService protected commandService: ICommandService,
		@IProgressService private readonly progressService: IProgressService,
		@ITimelineService protected timelineService: ITimelineService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super({ ...options, titleMenuId: MenuId.TimelineTitle }, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		this.commands = this._register(this.instantiationService.createInstance(TimelinePaneCommands, this));

		this.followActiveEditorContext = TimelineFollowActiveEditorContext.bindTo(this.contextKeyService);

		this.excludedSources = new Set(configurationService.getValue('timeline.excludeSources'));
		configurationService.onDidChangeConfiguration(this.onConfigurationChanged, this);

		this._register(timelineService.onDidChangeProviders(this.onProvidersChanged, this));
		this._register(timelineService.onDidChangeTimeline(this.onTimelineChanged, this));
		this._register(timelineService.onDidChangeUri(uri => this.setUri(uri), this));
	}

	private _followActiveEditor: boolean = true;
	get followActiveEditor(): boolean {
		return this._followActiveEditor;
	}
	set followActiveEditor(value: boolean) {
		if (this._followActiveEditor === value) {
			return;
		}

		this._followActiveEditor = value;
		this.followActiveEditorContext.set(value);

		this.titleDescription = this.titleDescription;

		if (value) {
			this.onActiveEditorChanged();
		}
	}

	private _pageOnScroll: boolean | undefined;
	get pageOnScroll() {
		if (this._pageOnScroll === undefined) {
			this._pageOnScroll = this.configurationService.getValue<boolean | null | undefined>('timeline.pageOnScroll') ?? false;
		}

		return this._pageOnScroll;
	}

	get pageSize() {
		let pageSize = this.configurationService.getValue<number | null | undefined>('timeline.pageSize');
		if (pageSize === undefined || pageSize === null) {
			// If we are paging when scrolling, then add an extra item to the end to make sure the "Load more" item is out of view
			pageSize = Math.max(20, Math.floor((this.tree.renderHeight / ItemHeight) + (this.pageOnScroll ? 1 : -1)));
		}
		return pageSize;
	}

	reset() {
		this.loadTimeline(true);
	}

	setUri(uri: URI) {
		this.setUriCore(uri, true);
	}

	private setUriCore(uri: URI | undefined, disableFollowing: boolean) {
		if (disableFollowing) {
			this.followActiveEditor = false;
		}

		this.uri = uri;
		this.titleDescription = uri ? basename(uri.fsPath) : '';
		this.treeRenderer?.setUri(uri);
		this.loadTimeline(true);
	}

	private onConfigurationChanged(e: IConfigurationChangeEvent) {
		if (e.affectsConfiguration('timeline.pageOnScroll')) {
			this._pageOnScroll = undefined;
		}

		if (e.affectsConfiguration('timeline.excludeSources')) {
			this.excludedSources = new Set(this.configurationService.getValue('timeline.excludeSources'));

			const missing = this.timelineService.getSources()
				.filter(({ id }) => !this.excludedSources.has(id) && !this.timelinesBySource.has(id));
			if (missing.length !== 0) {
				this.loadTimeline(true, missing.map(({ id }) => id));
			} else {
				this.refresh();
			}
		}
	}

	private onActiveEditorChanged() {
		if (!this.followActiveEditor) {
			return;
		}

		let uri;

		const editor = this.editorService.activeEditor;
		if (editor) {
			uri = toResource(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		}

		if ((uri?.toString(true) === this.uri?.toString(true) && uri !== undefined) ||
			// Fallback to match on fsPath if we are dealing with files or git schemes
			(uri?.fsPath === this.uri?.fsPath && (uri?.scheme === 'file' || uri?.scheme === 'git') && (this.uri?.scheme === 'file' || this.uri?.scheme === 'git'))) {

			// If the uri hasn't changed, make sure we have valid caches
			for (const source of this.timelineService.getSources()) {
				if (this.excludedSources.has(source.id)) {
					continue;
				}

				const timeline = this.timelinesBySource.get(source.id);
				if (timeline !== undefined && !timeline.stale) {
					continue;
				}

				if (timeline !== undefined) {
					this.updateTimeline(timeline, timeline.requiresReset);
				} else {
					this.loadTimelineForSource(source.id, uri, true);
				}
			}

			return;
		}

		this.setUriCore(uri, false);
	}

	private onProvidersChanged(e: TimelineProvidersChangeEvent) {
		if (e.removed) {
			for (const source of e.removed) {
				this.timelinesBySource.delete(source);
			}

			this.refresh();
		}

		if (e.added) {
			this.loadTimeline(true, e.added);
		}
	}

	private onTimelineChanged(e: TimelineChangeEvent) {
		if (e?.uri === undefined || e.uri.toString(true) !== this.uri?.toString(true)) {
			const timeline = this.timelinesBySource.get(e.id);
			if (timeline === undefined) {
				return;
			}

			if (this.isBodyVisible()) {
				this.updateTimeline(timeline, e.reset);
			} else {
				timeline.invalidate(e.reset);
			}
		}
	}

	private _titleDescription: string | undefined;
	get titleDescription(): string | undefined {
		return this._titleDescription;
	}

	set titleDescription(description: string | undefined) {
		this._titleDescription = description;
		if (this.followActiveEditor || !description) {
			this.$titleDescription.textContent = description ?? '';
		} else {
			this.$titleDescription.textContent = `${description} (pinned)`;
		}
	}

	private _message: string | undefined;
	get message(): string | undefined {
		return this._message;
	}

	set message(message: string | undefined) {
		this._message = message;
		this.updateMessage();
	}

	private updateMessage(): void {
		if (this._message !== undefined) {
			this.showMessage(this._message);
		} else {
			this.hideMessage();
		}
	}

	private showMessage(message: string): void {
		DOM.removeClass(this.$message, 'hide');
		this.resetMessageElement();

		this.$message.textContent = message;
	}

	private hideMessage(): void {
		this.resetMessageElement();
		DOM.addClass(this.$message, 'hide');
	}

	private resetMessageElement(): void {
		DOM.clearNode(this.$message);
	}

	private _isEmpty = true;
	private _maxItemCount = 0;

	private _visibleItemCount = 0;
	private get hasVisibleItems() {
		return this._visibleItemCount > 0;
	}

	private clear(cancelPending: boolean) {
		this._visibleItemCount = 0;
		this._maxItemCount = this.pageSize;
		this.timelinesBySource.clear();

		if (cancelPending) {
			for (const { tokenSource } of this.pendingRequests.values()) {
				tokenSource.dispose(true);
			}

			this.pendingRequests.clear();

			if (!this.isBodyVisible()) {
				this.tree.setChildren(null, undefined);
				this._isEmpty = true;
			}
		}
	}

	private async loadTimeline(reset: boolean, sources?: string[]) {
		// If we have no source, we are reseting all sources, so cancel everything in flight and reset caches
		if (sources === undefined) {
			if (reset) {
				this.clear(true);
			}

			// TODO@eamodio: Are these the right the list of schemes to exclude? Is there a better way?
			if (this.uri?.scheme === Schemas.vscodeSettings || this.uri?.scheme === Schemas.webviewPanel || this.uri?.scheme === Schemas.walkThrough) {
				this.uri = undefined;

				this.clear(false);
				this.refresh();

				return;
			}

			if (this._isEmpty && this.uri !== undefined) {
				this.setLoadingUriMessage();
			}
		}

		if (this.uri === undefined) {
			this.clear(false);
			this.refresh();

			return;
		}

		if (!this.isBodyVisible()) {
			return;
		}

		let hasPendingRequests = false;

		for (const source of sources ?? this.timelineService.getSources().map(s => s.id)) {
			const requested = this.loadTimelineForSource(source, this.uri, reset);
			if (requested) {
				hasPendingRequests = true;
			}
		}

		if (!hasPendingRequests) {
			this.refresh();
		} else if (this._isEmpty) {
			this.setLoadingUriMessage();
		}
	}

	private loadTimelineForSource(source: string, uri: URI, reset: boolean, options?: TimelineOptions) {
		if (this.excludedSources.has(source)) {
			return false;
		}

		const timeline = this.timelinesBySource.get(source);

		// If we are paging, and there are no more items or we have enough cached items to cover the next page,
		// don't bother querying for more
		if (
			!reset &&
			options?.cursor !== undefined &&
			timeline !== undefined &&
			(!timeline?.more || timeline.items.length > timeline.lastRenderedIndex + this.pageSize)
		) {
			return false;
		}

		if (options === undefined) {
			options = { cursor: reset ? undefined : timeline?.cursor, limit: this.pageSize };
		}

		let request = this.pendingRequests.get(source);
		if (request !== undefined) {
			options.cursor = request.options.cursor;

			// TODO@eamodio deal with concurrent requests better
			if (typeof options.limit === 'number') {
				if (typeof request.options.limit === 'number') {
					options.limit += request.options.limit;
				} else {
					options.limit = request.options.limit;
				}
			}
		}
		request?.tokenSource.dispose(true);

		request = this.timelineService.getTimeline(
			source, uri, options, new CancellationTokenSource(), { cacheResults: true, resetCache: reset }
		);

		if (request === undefined) {
			return false;
		}

		this.pendingRequests.set(source, request);
		request.tokenSource.token.onCancellationRequested(() => this.pendingRequests.delete(source));

		this.handleRequest(request);

		return true;
	}

	private updateTimeline(timeline: TimelineAggregate, reset: boolean) {
		if (reset) {
			this.timelinesBySource.delete(timeline.source);
			// Override the limit, to re-query for all our existing cached (possibly visible) items to keep visual continuity
			const { oldest } = timeline;
			this.loadTimelineForSource(timeline.source, this.uri!, true, oldest !== undefined ? { limit: { timestamp: oldest.timestamp, id: oldest.id } } : undefined);
		} else {
			// Override the limit, to query for any newer items
			const { newest } = timeline;
			this.loadTimelineForSource(timeline.source, this.uri!, false, newest !== undefined ? { limit: { timestamp: newest.timestamp, id: newest.id } } : { limit: this.pageSize });
		}
	}

	private _pendingRefresh = false;

	private async handleRequest(request: TimelineRequest) {
		let response: Timeline | undefined;
		try {
			response = await this.progressService.withProgress({ location: this.id }, () => request.result);
		}
		finally {
			this.pendingRequests.delete(request.source);
		}

		if (
			response === undefined ||
			request.tokenSource.token.isCancellationRequested ||
			request.uri !== this.uri
		) {
			if (this.pendingRequests.size === 0 && this._pendingRefresh) {
				this.refresh();
			}

			return;
		}

		const source = request.source;

		let updated = false;
		const timeline = this.timelinesBySource.get(source);
		if (timeline === undefined) {
			this.timelinesBySource.set(source, new TimelineAggregate(response));
			updated = true;
		}
		else {
			updated = timeline.add(response, request.options);
		}

		if (updated) {
			this._pendingRefresh = true;

			// If we have visible items already and there are other pending requests, debounce for a bit to wait for other requests
			if (this.hasVisibleItems && this.pendingRequests.size !== 0) {
				this.refreshDebounced();
			} else {
				this.refresh();
			}
		} else if (this.pendingRequests.size === 0) {
			if (this._pendingRefresh) {
				this.refresh();
			} else {
				this.tree.rerender();
			}
		}
	}

	private *getItems(): Generator<ITreeElement<TreeElement>, any, any> {
		let more = false;

		if (this.uri === undefined || this.timelinesBySource.size === 0) {
			this._visibleItemCount = 0;

			return;
		}

		const maxCount = this._maxItemCount;
		let count = 0;

		if (this.timelinesBySource.size === 1) {
			const [source, timeline] = Iterable.first(this.timelinesBySource)!;

			timeline.lastRenderedIndex = -1;

			if (this.excludedSources.has(source)) {
				this._visibleItemCount = 0;

				return;
			}

			if (timeline.items.length !== 0) {
				// If we have any items, just say we have one for now -- the real count will be updated below
				this._visibleItemCount = 1;
			}

			more = timeline.more;

			let lastRelativeTime: string | undefined;
			for (const item of timeline.items) {
				item.relativeTime = undefined;
				item.hideRelativeTime = undefined;

				count++;
				if (count > maxCount) {
					more = true;
					break;
				}

				lastRelativeTime = updateRelativeTime(item, lastRelativeTime);
				yield { element: item };
			}

			timeline.lastRenderedIndex = count - 1;
		}
		else {
			const sources: { timeline: TimelineAggregate; iterator: IterableIterator<TimelineItem>; nextItem: IteratorResult<TimelineItem, TimelineItem> }[] = [];

			let hasAnyItems = false;
			let mostRecentEnd = 0;

			for (const [source, timeline] of this.timelinesBySource) {
				timeline.lastRenderedIndex = -1;

				if (this.excludedSources.has(source) || timeline.stale) {
					continue;
				}

				if (timeline.items.length !== 0) {
					hasAnyItems = true;
				}

				if (timeline.more) {
					more = true;

					const last = timeline.items[Math.min(maxCount, timeline.items.length - 1)];
					if (last.timestamp > mostRecentEnd) {
						mostRecentEnd = last.timestamp;
					}
				}

				const iterator = timeline.items[Symbol.iterator]();
				sources.push({ timeline: timeline, iterator: iterator, nextItem: iterator.next() });
			}

			this._visibleItemCount = hasAnyItems ? 1 : 0;

			function getNextMostRecentSource() {
				return sources
					.filter(source => !source.nextItem!.done)
					.reduce((previous, current) => (previous === undefined || current.nextItem!.value.timestamp >= previous.nextItem!.value.timestamp) ? current : previous, undefined!);
			}

			let lastRelativeTime: string | undefined;
			let nextSource;
			while (nextSource = getNextMostRecentSource()) {
				nextSource.timeline.lastRenderedIndex++;

				const item = nextSource.nextItem.value;
				item.relativeTime = undefined;
				item.hideRelativeTime = undefined;

				if (item.timestamp >= mostRecentEnd) {
					count++;
					if (count > maxCount) {
						more = true;
						break;
					}

					lastRelativeTime = updateRelativeTime(item, lastRelativeTime);
					yield { element: item };
				}

				nextSource.nextItem = nextSource.iterator.next();
			}
		}

		this._visibleItemCount = count;

		if (more) {
			yield {
				element: new LoadMoreCommand(this.pendingRequests.size !== 0)
			};
		} else if (this.pendingRequests.size !== 0) {
			yield {
				element: new LoadMoreCommand(true)
			};
		}
	}

	private refresh() {
		if (!this.isBodyVisible()) {
			return;
		}

		this.tree.setChildren(null, this.getItems() as any);
		this._isEmpty = !this.hasVisibleItems;

		if (this.uri === undefined) {
			this.titleDescription = undefined;
			this.message = localize('timeline.editorCannotProvideTimeline', "The active editor cannot provide timeline information.");
		} else if (this._isEmpty) {
			if (this.pendingRequests.size !== 0) {
				this.setLoadingUriMessage();
			} else {
				this.titleDescription = basename(this.uri.fsPath);
				this.message = localize('timeline.noTimelineInfo', "No timeline information was provided.");
			}
		} else {
			this.titleDescription = basename(this.uri.fsPath);
			this.message = undefined;
		}

		this._pendingRefresh = false;
	}

	@debounce(500)
	private refreshDebounced() {
		this.refresh();
	}

	focus(): void {
		super.focus();
		this.tree.domFocus();
	}

	setExpanded(expanded: boolean): boolean {
		const changed = super.setExpanded(expanded);

		if (changed && this.isBodyVisible()) {
			if (!this.followActiveEditor) {
				this.setUriCore(this.uri, true);
			} else {
				this.onActiveEditorChanged();
			}
		}

		return changed;
	}

	setVisible(visible: boolean): void {
		if (visible) {
			this.visibilityDisposables = new DisposableStore();

			this.editorService.onDidActiveEditorChange(this.onActiveEditorChanged, this, this.visibilityDisposables);
			// Refresh the view on focus to update the relative timestamps
			this.onDidFocus(() => this.refreshDebounced(), this, this.visibilityDisposables);

			super.setVisible(visible);

			this.onActiveEditorChanged();
		} else {
			this.visibilityDisposables?.dispose();

			super.setVisible(visible);
		}
	}

	protected layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
	}

	protected renderHeaderTitle(container: HTMLElement): void {
		super.renderHeaderTitle(container, this.title);

		DOM.addClass(container, 'timeline-view');
		this.$titleDescription = DOM.append(container, DOM.$('span.description', undefined, this.titleDescription ?? ''));
	}

	protected renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.$container = container;
		DOM.addClasses(container, 'tree-explorer-viewlet-tree-view', 'timeline-tree-view');

		this.$message = DOM.append(this.$container, DOM.$('.message'));
		DOM.addClass(this.$message, 'timeline-subtle');

		this.message = localize('timeline.editorCannotProvideTimeline', "The active editor cannot provide timeline information.");

		this.$tree = document.createElement('div');
		DOM.addClasses(this.$tree, 'customview-tree', 'file-icon-themable-tree', 'hide-arrows');
		// DOM.addClass(this.treeElement, 'show-file-icons');
		container.appendChild(this.$tree);

		this.treeRenderer = this.instantiationService.createInstance(TimelineTreeRenderer, this.commands);
		this.treeRenderer.onDidScrollToEnd(item => {
			if (this.pageOnScroll) {
				this.loadMore(item);
			}
		});

		this.tree = <WorkbenchObjectTree<TreeElement, FuzzyScore>>this.instantiationService.createInstance(WorkbenchObjectTree, 'TimelinePane',
			this.$tree, new TimelineListVirtualDelegate(), [this.treeRenderer], {
			identityProvider: new TimelineIdentityProvider(),
			accessibilityProvider: {
				getAriaLabel(element: TreeElement): string {
					if (isLoadMoreCommand(element)) {
						return element.ariaLabel;
					}
					return element.accessibilityInformation ? element.accessibilityInformation.label : localize('timeline.aria.item', "{0}: {1}", element.relativeTime ?? '', element.label);
				},
				getRole(element: TreeElement): string {
					if (isLoadMoreCommand(element)) {
						return 'treeitem';
					}
					return element.accessibilityInformation && element.accessibilityInformation.role ? element.accessibilityInformation.role : 'treeitem';
				},
				getWidgetAriaLabel(): string {
					return localize('timeline', "Timeline");
				}
			},
			keyboardNavigationLabelProvider: new TimelineKeyboardNavigationLabelProvider(),
			overrideStyles: {
				listBackground: this.getBackgroundColor(),
			}
		});

		this._register(this.tree.onContextMenu(e => this.onContextMenu(this.commands, e)));
		this._register(this.tree.onDidChangeSelection(e => this.ensureValidItems()));
		this._register(this.tree.onDidOpen(e => {
			if (!e.browserEvent || !this.ensureValidItems()) {
				return;
			}

			const item = e.element;
			if (item === null) {
				return;
			}

			if (isTimelineItem(item)) {
				if (item.command) {
					this.commandService.executeCommand(item.command.id, ...(item.command.arguments || []));
				}
			}
			else if (isLoadMoreCommand(item)) {
				this.loadMore(item);
			}
		}));
	}

	private loadMore(item: LoadMoreCommand) {
		if (item.loading) {
			return;
		}

		item.loading = true;
		this.tree.rerender(item);

		if (this.pendingRequests.size !== 0) {
			return;
		}

		this._maxItemCount = this._visibleItemCount + this.pageSize;
		this.loadTimeline(false);
	}

	ensureValidItems() {
		// If we don't have any non-excluded timelines, clear the tree and show the loading message
		if (!this.hasVisibleItems || !this.timelineService.getSources().some(({ id }) => !this.excludedSources.has(id) && this.timelinesBySource.has(id))) {
			this.tree.setChildren(null, undefined);
			this._isEmpty = true;

			this.setLoadingUriMessage();

			return false;
		}

		return true;
	}

	setLoadingUriMessage() {
		const file = this.uri && basename(this.uri.fsPath);
		this.titleDescription = file ?? '';
		this.message = file ? localize('timeline.loading', "Loading timeline for {0}...", file) : '';
	}

	private onContextMenu(commands: TimelinePaneCommands, treeEvent: ITreeContextMenuEvent<TreeElement | null>): void {
		const item = treeEvent.element;
		if (item === null) {
			return;
		}
		const event: UIEvent = treeEvent.browserEvent;

		event.preventDefault();
		event.stopPropagation();

		if (!this.ensureValidItems()) {
			return;
		}

		this.tree.setFocus([item]);
		const actions = commands.getItemContextActions(item);
		if (!actions.length) {
			return;
		}

		this.contextMenuService.showContextMenu({
			getAnchor: () => treeEvent.anchor,
			getActions: () => actions,
			getActionViewItem: (action) => {
				const keybinding = this.keybindingService.lookupKeybinding(action.id);
				if (keybinding) {
					return new ActionViewItem(action, action, { label: true, keybinding: keybinding.getLabel() });
				}
				return undefined;
			},
			onHide: (wasCancelled?: boolean) => {
				if (wasCancelled) {
					this.tree.domFocus();
				}
			},
			getActionsContext: (): TimelineActionContext => ({ uri: this.uri, item: item }),
			actionRunner: new TimelineActionRunner()
		});
	}
}

export class TimelineElementTemplate implements IDisposable {
	static readonly id = 'TimelineElementTemplate';

	readonly actionBar: ActionBar;
	readonly icon: HTMLElement;
	readonly iconLabel: IconLabel;
	readonly timestamp: HTMLSpanElement;

	constructor(
		readonly container: HTMLElement,
		actionViewItemProvider: IActionViewItemProvider
	) {
		DOM.addClass(container, 'custom-view-tree-node-item');
		this.icon = DOM.append(container, DOM.$('.custom-view-tree-node-item-icon'));

		this.iconLabel = new IconLabel(container, { supportHighlights: true, supportCodicons: true });

		const timestampContainer = DOM.append(this.iconLabel.element, DOM.$('.timeline-timestamp-container'));
		this.timestamp = DOM.append(timestampContainer, DOM.$('span.timeline-timestamp'));

		const actionsContainer = DOM.append(this.iconLabel.element, DOM.$('.actions'));
		this.actionBar = new ActionBar(actionsContainer, { actionViewItemProvider: actionViewItemProvider });
	}

	dispose() {
		this.iconLabel.dispose();
		this.actionBar.dispose();
	}

	reset() {
		this.icon.className = '';
		this.icon.style.backgroundImage = '';
		this.actionBar.clear();
	}
}

export class TimelineIdentityProvider implements IIdentityProvider<TreeElement> {
	getId(item: TreeElement): { toString(): string } {
		return item.handle;
	}
}

class TimelineActionRunner extends ActionRunner {

	runAction(action: IAction, { uri, item }: TimelineActionContext): Promise<any> {
		if (!isTimelineItem(item)) {
			// TODO@eamodio do we need to do anything else?
			return action.run();
		}

		return action.run(...[
			{
				$mid: 11,
				handle: item.handle,
				source: item.source,
				uri: uri
			},
			uri,
			item.source,
		]);
	}
}

export class TimelineKeyboardNavigationLabelProvider implements IKeyboardNavigationLabelProvider<TreeElement> {
	getKeyboardNavigationLabel(element: TreeElement): { toString(): string } {
		return element.label;
	}
}

export class TimelineListVirtualDelegate implements IListVirtualDelegate<TreeElement> {
	getHeight(_element: TreeElement): number {
		return ItemHeight;
	}

	getTemplateId(element: TreeElement): string {
		return TimelineElementTemplate.id;
	}
}

class TimelineTreeRenderer implements ITreeRenderer<TreeElement, FuzzyScore, TimelineElementTemplate> {
	private readonly _onDidScrollToEnd = new Emitter<LoadMoreCommand>();
	readonly onDidScrollToEnd: Event<LoadMoreCommand> = this._onDidScrollToEnd.event;

	readonly templateId: string = TimelineElementTemplate.id;

	private actionViewItemProvider: IActionViewItemProvider;

	constructor(
		private readonly commands: TimelinePaneCommands,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IThemeService private themeService: IThemeService
	) {
		this.actionViewItemProvider = (action: IAction) => {
			if (action instanceof MenuItemAction) {
				return this.instantiationService.createInstance(MenuEntryActionViewItem, action);
			} else if (action instanceof SubmenuItemAction) {
				return this.instantiationService.createInstance(SubmenuEntryActionViewItem, action);
			}

			return undefined;
		};
	}

	private uri: URI | undefined;
	setUri(uri: URI | undefined) {
		this.uri = uri;
	}

	renderTemplate(container: HTMLElement): TimelineElementTemplate {
		return new TimelineElementTemplate(container, this.actionViewItemProvider);
	}

	renderElement(
		node: ITreeNode<TreeElement, FuzzyScore>,
		index: number,
		template: TimelineElementTemplate,
		height: number | undefined
	): void {
		template.reset();

		const { element: item } = node;

		const icon = this.themeService.getColorTheme().type === LIGHT ? item.icon : item.iconDark;
		const iconUrl = icon ? URI.revive(icon) : null;

		if (iconUrl) {
			template.icon.className = 'custom-view-tree-node-item-icon';
			template.icon.style.backgroundImage = DOM.asCSSUrl(iconUrl);
		} else {
			let iconClass: string | undefined;
			if (item.themeIcon /*&& !this.isFileKindThemeIcon(element.themeIcon)*/) {
				iconClass = ThemeIcon.asClassName(item.themeIcon);
			}
			template.icon.className = iconClass ? `custom-view-tree-node-item-icon ${iconClass}` : '';
		}

		template.iconLabel.setLabel(item.label, item.description, {
			title: item.detail,
			matches: createMatches(node.filterData)
		});

		template.timestamp.textContent = item.relativeTime ?? '';
		DOM.toggleClass(template.timestamp.parentElement!, 'timeline-timestamp--duplicate', isTimelineItem(item) && item.hideRelativeTime);

		template.actionBar.context = { uri: this.uri, item: item } as TimelineActionContext;
		template.actionBar.actionRunner = new TimelineActionRunner();
		template.actionBar.push(this.commands.getItemActions(item), { icon: true, label: false });

		// If we are rendering the load more item, we've scrolled to the end, so trigger an event
		if (isLoadMoreCommand(item)) {
			setTimeout(() => this._onDidScrollToEnd.fire(item), 0);
		}
	}

	disposeTemplate(template: TimelineElementTemplate): void {
		template.iconLabel.dispose();
	}
}

class TimelinePaneCommands extends Disposable {
	private sourceDisposables: DisposableStore;

	constructor(
		private readonly pane: TimelinePane,
		@ITimelineService private readonly timelineService: ITimelineService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService
	) {
		super();

		this._register(this.sourceDisposables = new DisposableStore());

		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'timeline.refresh',
					title: { value: localize('refresh', "Refresh"), original: 'Refresh' },
					icon: { id: 'codicon/refresh' },
					category: { value: localize('timeline', "Timeline"), original: 'Timeline' },
					menu: {
						id: MenuId.TimelineTitle,
						group: 'navigation',
						order: 99,
					}
				});
			}
			run(accessor: ServicesAccessor, ...args: any[]) {
				pane.reset();
			}
		}));

		this._register(CommandsRegistry.registerCommand('timeline.toggleFollowActiveEditor',
			(accessor: ServicesAccessor, ...args: any[]) => pane.followActiveEditor = !pane.followActiveEditor
		));

		this._register(MenuRegistry.appendMenuItem(MenuId.TimelineTitle, ({
			command: {
				id: 'timeline.toggleFollowActiveEditor',
				title: { value: localize('timeline.toggleFollowActiveEditorCommand.follow', "Pin the Current Timeline"), original: 'Pin the Current Timeline' },
				icon: { id: 'codicon/pin' },
				category: { value: localize('timeline', "Timeline"), original: 'Timeline' },
			},
			group: 'navigation',
			order: 98,
			when: TimelineFollowActiveEditorContext
		})));

		this._register(MenuRegistry.appendMenuItem(MenuId.TimelineTitle, ({
			command: {
				id: 'timeline.toggleFollowActiveEditor',
				title: { value: localize('timeline.toggleFollowActiveEditorCommand.unfollow', "Unpin the Current Timeline"), original: 'Unpin the Current Timeline' },
				icon: { id: 'codicon/pinned' },
				category: { value: localize('timeline', "Timeline"), original: 'Timeline' },
			},
			group: 'navigation',
			order: 98,
			when: TimelineFollowActiveEditorContext.toNegated()
		})));

		this._register(timelineService.onDidChangeProviders(() => this.updateTimelineSourceFilters()));
		this.updateTimelineSourceFilters();
	}

	getItemActions(element: TreeElement): IAction[] {
		return this.getActions(MenuId.TimelineItemContext, { key: 'timelineItem', value: element.contextValue }).primary;
	}

	getItemContextActions(element: TreeElement): IAction[] {
		return this.getActions(MenuId.TimelineItemContext, { key: 'timelineItem', value: element.contextValue }).secondary;
	}

	private getActions(menuId: MenuId, context: { key: string, value?: string }): { primary: IAction[]; secondary: IAction[]; } {
		const scoped = this.contextKeyService.createScoped();
		scoped.createKey('view', this.pane.id);
		scoped.createKey(context.key, context.value);

		const menu = this.menuService.createMenu(menuId, scoped);
		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };
		createAndFillInContextMenuActions(menu, { shouldForwardArgs: true }, result, this.contextMenuService, g => /^inline/.test(g));

		menu.dispose();

		return result;
	}

	private updateTimelineSourceFilters() {
		this.sourceDisposables.clear();

		const excluded = new Set(this.configurationService.getValue<string[] | undefined>('timeline.excludeSources') ?? []);

		for (const source of this.timelineService.getSources()) {
			this.sourceDisposables.add(registerAction2(class extends Action2 {
				constructor() {
					super({
						id: `timeline.toggleExcludeSource:${source.id}`,
						title: { value: localize('timeline.filterSource', "Include: {0}", source.label), original: `Include: ${source.label}` },
						category: { value: localize('timeline', "Timeline"), original: 'Timeline' },
						menu: {
							id: MenuId.TimelineTitle,
							group: '2_sources',
						},
						toggled: ContextKeyExpr.regex(`config.timeline.excludeSources`, new RegExp(`\\b${escapeRegExpCharacters(source.id)}\\b`)).negate()
					});
				}
				run(accessor: ServicesAccessor, ...args: any[]) {
					if (excluded.has(source.id)) {
						excluded.delete(source.id);
					} else {
						excluded.add(source.id);
					}

					const configurationService = accessor.get(IConfigurationService);
					configurationService.updateValue('timeline.excludeSources', [...excluded.keys()]);
				}
			}));
		}
	}
}
