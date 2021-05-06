/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { ActionBar, IActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { IIdentityProvider, IKeyboardNavigationLabelProvider, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { DefaultKeyboardNavigationDelegate, IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { ObjectTree } from 'vs/base/browser/ui/tree/objectTree';
import { ITreeContextMenuEvent, ITreeEvent, ITreeFilter, ITreeNode, ITreeRenderer, ITreeSorter, TreeFilterResult, TreeVisibility } from 'vs/base/browser/ui/tree/tree';
import { Action, IAction } from 'vs/base/common/actions';
import { disposableTimeout, RunOnceScheduler } from 'vs/base/common/async';
import { Color, RGBA } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { FuzzyScore } from 'vs/base/common/filters';
import { splitGlobAware } from 'vs/base/common/glob';
import { Iterable } from 'vs/base/common/iterator';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable, dispose, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/testing';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';
import { localize } from 'vs/nls';
import { createAndFillInActionBarActions, MenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenuService, MenuId, MenuItemAction } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { FileKind } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { UnmanagedProgress } from 'vs/platform/progress/common/progress';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { foreground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService, registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { TestResultState } from 'vs/workbench/api/common/extHostTypes';
import { IResourceLabel, IResourceLabelOptions, IResourceLabelProps, ResourceLabels } from 'vs/workbench/browser/labels';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { HierarchicalByLocationProjection } from 'vs/workbench/contrib/testing/browser/explorerProjections/hierarchalByLocation';
import { HierarchicalByNameProjection } from 'vs/workbench/contrib/testing/browser/explorerProjections/hierarchalByName';
import { IActionableTestTreeElement, ITestTreeProjection, TestExplorerTreeElement, TestItemTreeElement, TestTreeErrorMessage, TestTreeWorkspaceFolder } from 'vs/workbench/contrib/testing/browser/explorerProjections/index';
import { testingHiddenIcon, testingStatesToIcons } from 'vs/workbench/contrib/testing/browser/icons';
import { ITestExplorerFilterState, TestExplorerFilterState, TestingExplorerFilter } from 'vs/workbench/contrib/testing/browser/testingExplorerFilter';
import { ITestingPeekOpener } from 'vs/workbench/contrib/testing/browser/testingOutputPeek';
import { ITestingProgressUiService } from 'vs/workbench/contrib/testing/browser/testingProgressUiService';
import { getTestingConfiguration, TestingConfigKeys } from 'vs/workbench/contrib/testing/common/configuration';
import { TestExplorerStateFilter, TestExplorerViewMode, TestExplorerViewSorting, Testing, testStateNames } from 'vs/workbench/contrib/testing/common/constants';
import { TestIdPath, TestItemExpandState } from 'vs/workbench/contrib/testing/common/testCollection';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';
import { cmpPriority, isFailedState, isStateWithResult } from 'vs/workbench/contrib/testing/common/testingStates';
import { getPathForTestInResult, TestResultItemChangeReason } from 'vs/workbench/contrib/testing/common/testResult';
import { ITestResultService } from 'vs/workbench/contrib/testing/common/testResultService';
import { ITestService } from 'vs/workbench/contrib/testing/common/testService';
import { IWorkspaceTestCollectionService, TestSubscriptionListener } from 'vs/workbench/contrib/testing/common/workspaceTestCollectionService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { DebugAction, EditFocusedTest, HideOrShowTestAction, RunAction } from './testExplorerActions';

export class TestingExplorerView extends ViewPane {
	public viewModel!: TestingExplorerViewModel;
	private filterActionBar = this._register(new MutableDisposable());
	private readonly currentSubscription = new MutableDisposable<TestSubscriptionListener>();
	private container!: HTMLElement;
	private discoveryProgress = this._register(new MutableDisposable<UnmanagedProgress>());
	private readonly location = TestingContextKeys.explorerLocation.bindTo(this.contextKeyService);;

	constructor(
		options: IViewletViewOptions,
		@IWorkspaceTestCollectionService private readonly testCollection: IWorkspaceTestCollectionService,
		@ITestService testService: ITestService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ITestingProgressUiService private readonly testProgressService: ITestingProgressUiService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.location.set(viewDescriptorService.getViewLocationById(Testing.ExplorerViewId) ?? ViewContainerLocation.Sidebar);

		const relayout = this._register(new RunOnceScheduler(() => this.viewModel?.layout(), 1));
		this._register(this.onDidChangeViewWelcomeState(() => {
			if (!this.shouldShowWelcome()) {
				relayout.schedule();
			}
		}));
	}

	/**
	 * @override
	 */
	public override shouldShowWelcome() {
		return this.viewModel?.shouldShowWelcome ?? true;
	}

	/**
	 * @override
	 */
	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.container = dom.append(container, dom.$('.test-explorer'));

		if (this.location.get() === ViewContainerLocation.Sidebar) {
			this.filterActionBar.value = this.createFilterActionBar();
		}

		const messagesContainer = dom.append(this.container, dom.$('.test-explorer-messages'));
		this._register(this.testProgressService.onTextChange(text => {
			messagesContainer.innerText = text;
		}));

		const progress = new MutableDisposable<UnmanagedProgress>();
		this._register(this.testProgressService.onCountChange(evt => {
			if (!evt.isRunning && progress.value) {
				progress.clear();
			} else if (evt.isRunning) {
				if (!progress.value) {
					progress.value = this.instantiationService.createInstance(UnmanagedProgress, { location: this.getProgressLocation(), total: 100 });
				}
				progress.value.report({ increment: evt.runSoFar, total: evt.totalWillBeRun });
			}
		}));

		const listContainer = dom.append(this.container, dom.$('.test-explorer-tree'));
		this.viewModel = this.instantiationService.createInstance(TestingExplorerViewModel, listContainer, this.onDidChangeBodyVisibility, this.currentSubscription.value);
		this._register(this.viewModel.onChangeWelcomeVisibility(() => this._onDidChangeViewWelcomeState.fire()));
		this._register(this.viewModel);

		if (!this.viewModel.shouldShowWelcome) {
			this._onDidChangeViewWelcomeState.fire();
		}

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (!visible && this.currentSubscription) {
				this.currentSubscription.value = undefined;
				this.viewModel.replaceSubscription(undefined);
			} else if (visible && !this.currentSubscription.value) {
				this.currentSubscription.value = this.createSubscription();
				this.viewModel.replaceSubscription(this.currentSubscription.value);
			}
		}));
	}

	/**
	 * @override
	 */
	public override getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (action.id === Testing.FilterActionId) {
			return this.instantiationService.createInstance(TestingExplorerFilter, action);
		}

		return super.getActionViewItem(action);
	}

	/**
	 * @override
	 */
	public override saveState() {
		super.saveState();
	}

	private createFilterActionBar() {
		const bar = new ActionBar(this.container, {
			actionViewItemProvider: action => this.getActionViewItem(action),
			triggerKeys: { keyDown: false, keys: [] },
		});
		bar.push(new Action(Testing.FilterActionId));
		bar.getContainer().classList.add('testing-filter-action-bar');
		return bar;
	}

	private updateDiscoveryProgress(busy: number) {
		if (!busy && this.discoveryProgress) {
			this.discoveryProgress.clear();
		} else if (busy && !this.discoveryProgress.value) {
			this.discoveryProgress.value = this.instantiationService.createInstance(UnmanagedProgress, { location: this.getProgressLocation() });
		}
	}

	/**
	 * @override
	 */
	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.container.style.height = `${height}px`;
		this.viewModel.layout();
	}

	private createSubscription() {
		const handle = this.testCollection.subscribeToWorkspaceTests();
		handle.subscription.onBusyProvidersChange(() => this.updateDiscoveryProgress(handle.subscription.busyProviders));
		return handle;
	}
}

export class TestingExplorerViewModel extends Disposable {
	public tree: ObjectTree<TestExplorerTreeElement, FuzzyScore>;
	private filter: TestsFilter;
	public projection = this._register(new MutableDisposable<ITestTreeProjection>());

	private readonly revealTimeout = new MutableDisposable();
	private readonly _viewMode = TestingContextKeys.viewMode.bindTo(this.contextKeyService);
	private readonly _viewSorting = TestingContextKeys.viewSorting.bindTo(this.contextKeyService);
	private readonly welcomeVisibilityEmitter = new Emitter<boolean>();

	/**
	 * Whether there's a reveal request which has not yet been delivered. This
	 * can happen if the user asks to reveal before the test tree is loaded.
	 * We check to see if the reveal request is present on each tree update,
	 * and do it then if so.
	 */
	private hasPendingReveal = false;

	/**
	 * Fires when the selected tests change.
	 */
	public readonly onDidChangeSelection: Event<ITreeEvent<TestExplorerTreeElement | null>>;
	/**
	 * Fires when the visibility of the placeholder state changes.
	 */
	public readonly onChangeWelcomeVisibility = this.welcomeVisibilityEmitter.event;

	/**
	 * Gets whether the welcome should be visible.
	 */
	public shouldShowWelcome = false;

	public get viewMode() {
		return this._viewMode.get() ?? TestExplorerViewMode.Tree;
	}

	public set viewMode(newMode: TestExplorerViewMode) {
		if (newMode === this._viewMode.get()) {
			return;
		}

		this._viewMode.set(newMode);
		this.updatePreferredProjection();
		this.storageService.store('testing.viewMode', newMode, StorageScope.WORKSPACE, StorageTarget.USER);
	}


	public get viewSorting() {
		return this._viewSorting.get() ?? TestExplorerViewSorting.ByLocation;
	}

	public set viewSorting(newSorting: TestExplorerViewSorting) {
		if (newSorting === this._viewSorting.get()) {
			return;
		}

		this._viewSorting.set(newSorting);
		this.tree.resort(null);
		this.storageService.store('testing.viewSorting', newSorting, StorageScope.WORKSPACE, StorageTarget.USER);
	}
	constructor(
		listContainer: HTMLElement,
		onDidChangeVisibility: Event<boolean>,
		private listener: TestSubscriptionListener | undefined,
		@IConfigurationService configurationService: IConfigurationService,
		@IMenuService private readonly menuService: IMenuService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@ITestService private readonly testService: ITestService,
		@ITestExplorerFilterState private readonly filterState: TestExplorerFilterState,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IEditorService editorService: IEditorService,
		@IStorageService private readonly storageService: IStorageService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@ITestResultService private readonly testResults: ITestResultService,
		@ITestingPeekOpener private readonly peekOpener: ITestingPeekOpener,
	) {
		super();

		this.hasPendingReveal = !!filterState.reveal.value;
		this._viewMode.set(this.storageService.get('testing.viewMode', StorageScope.WORKSPACE, TestExplorerViewMode.Tree) as TestExplorerViewMode);
		this._viewSorting.set(this.storageService.get('testing.viewSorting', StorageScope.WORKSPACE, TestExplorerViewSorting.ByLocation) as TestExplorerViewSorting);

		const labels = this._register(instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: onDidChangeVisibility }));

		this.reevaluateWelcomeState();
		this.filter = this.instantiationService.createInstance(TestsFilter);
		this.tree = instantiationService.createInstance(
			WorkbenchObjectTree,
			'Test Explorer List',
			listContainer,
			new ListDelegate(),
			[
				instantiationService.createInstance(TestItemRenderer, labels),
				instantiationService.createInstance(WorkspaceFolderRenderer, labels),
				instantiationService.createInstance(ErrorRenderer),
			],
			{
				simpleKeyboardNavigation: true,
				identityProvider: instantiationService.createInstance(IdentityProvider),
				hideTwistiesOfChildlessElements: false,
				sorter: instantiationService.createInstance(TreeSorter, this),
				keyboardNavigationLabelProvider: instantiationService.createInstance(TreeKeyboardNavigationLabelProvider),
				accessibilityProvider: instantiationService.createInstance(ListAccessibilityProvider),
				filter: this.filter,
			}) as WorkbenchObjectTree<TestExplorerTreeElement, FuzzyScore>;

		this._register(this.tree.onDidChangeCollapseState(evt => {
			if (evt.node.element instanceof TestItemTreeElement) {
				this.projection.value?.expandElement(evt.node.element, evt.deep ? Infinity : 0);
			}
		}));

		this._register(filterState.currentDocumentOnly.onDidChange(() => {
			if (!filterState.currentDocumentOnly.value) {
				this.filter.filterToUri(undefined);
			} else if (editorService.activeEditor?.resource && this.projection.value?.hasTestInDocument(editorService.activeEditor.resource)) {
				this.filter.filterToUri(editorService.activeEditor.resource);
			}

			this.tree.refilter();
		}));

		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));

		this._register(editorService.onDidActiveEditorChange(() => {
			if (filterState.currentDocumentOnly.value && editorService.activeEditor?.resource) {
				if (this.projection.value?.hasTestInDocument(editorService.activeEditor.resource)) {
					this.filter.filterToUri(editorService.activeEditor.resource);
					this.tree.refilter();
				}
			}
		}));

		this._register(Event.any(
			filterState.text.onDidChange,
			filterState.stateFilter.onDidChange,
			filterState.showExcludedTests.onDidChange,
			testService.excludeTests.onDidChange,
		)(this.tree.refilter, this.tree));

		this._register(this.tree);

		this._register(dom.addStandardDisposableListener(this.tree.getHTMLElement(), 'keydown', evt => {
			if (evt.equals(KeyCode.Enter)) {
				this.handleExecuteKeypress(evt);
			} else if (DefaultKeyboardNavigationDelegate.mightProducePrintableCharacter(evt)) {
				filterState.text.value = evt.browserEvent.key;
				filterState.focusInput();
			}
		}));

		this._register(filterState.reveal.onDidChange(this.revealByIdPath, this));

		this._register(onDidChangeVisibility(visible => {
			if (visible) {
				filterState.focusInput();
			}
		}));

		this.updatePreferredProjection();

		this.onDidChangeSelection = this.tree.onDidChangeSelection;
		this._register(this.tree.onDidChangeSelection(async evt => {
			const selected = evt.elements[0];
			if (selected && evt.browserEvent && selected instanceof TestItemTreeElement
				&& selected.children.size === 0 && selected.test.expand === TestItemExpandState.NotExpandable) {
				if (!(await this.tryPeekError(selected)) && selected?.test) {
					this.instantiationService.invokeFunction(accessor => new EditFocusedTest().run(accessor, selected.test!.item, true));
				}
			}
		}));

		let followRunningTests = getTestingConfiguration(configurationService, TestingConfigKeys.FollowRunningTest);
		this._register(configurationService.onDidChangeConfiguration(() => {
			followRunningTests = getTestingConfiguration(configurationService, TestingConfigKeys.FollowRunningTest);
		}));

		this._register(testResults.onTestChanged(evt => {
			if (!followRunningTests) {
				return;
			}

			if (evt.reason !== TestResultItemChangeReason.OwnStateChange) {
				return;
			}

			// follow running tests, or tests whose state changed. Tests that
			// complete very fast may not enter the running state at all.
			if (evt.item.ownComputedState !== TestResultState.Running && !(evt.previous === TestResultState.Queued && isStateWithResult(evt.item.ownComputedState))) {
				return;
			}

			this.revealByIdPath(getPathForTestInResult(evt.item, evt.result), false, false);
		}));

		this._register(testResults.onResultsChanged(() => {
			this.tree.resort(null);
		}));
	}

	/**
	 * Re-layout the tree.
	 */
	public layout(): void {
		this.tree.layout(); // The tree will measure its container
	}

	/**
	 * Replaces the test listener and recalculates the tree.
	 */
	public replaceSubscription(listener: TestSubscriptionListener | undefined) {
		this.listener = listener;
		this.updatePreferredProjection();
		this.reevaluateWelcomeState();
	}

	/**
	 * Tries to reveal by extension ID. Queues the request if the extension
	 * ID is not currently available.
	 */
	private revealByIdPath(idPath: TestIdPath | undefined, expand = true, focus = true) {
		if (!idPath) {
			this.hasPendingReveal = false;
			return;
		}

		if (!this.projection.value) {
			return;
		}

		// If the item itself is visible in the tree, show it. Otherwise, expand
		// its closest parent.
		let expandToLevel = 0;
		for (let i = idPath.length - 1; i >= expandToLevel; i--) {
			const element = this.projection.value.getElementByTestId(idPath[i]);
			// Skip all elements that aren't in the tree.
			if (!element || !this.tree.hasElement(element)) {
				continue;
			}

			// If this 'if' is true, we're at the closest-visible parent to the node
			// we want to expand. Expand that, and then start the loop again because
			// we might already have children for it.
			if (i < idPath.length - 1) {
				if (expand) {
					this.tree.expand(element);
					expandToLevel = i + 1; // avoid an infinite loop if the test does not exist
					i = idPath.length - 1; // restart the loop since new children may now be visible
					continue;
				}
			}

			// Otherwise, we've arrived!

			// If the node or any of its children are excluded, flip on the 'show
			// excluded tests' checkbox automatically.
			for (let n: TestItemTreeElement | TestTreeWorkspaceFolder = element; n instanceof TestItemTreeElement; n = n.parent) {
				if (n.test && this.testService.excludeTests.value.has(n.test.item.extId)) {
					this.filterState.showExcludedTests.value = true;
					break;
				}
			}

			this.filterState.reveal.value = undefined;
			this.hasPendingReveal = false;
			if (focus) {
				this.tree.domFocus();
			}

			this.revealTimeout.value = disposableTimeout(() => {
				// Don't scroll to the item if it's already visible
				if (this.tree.getRelativeTop(element) === null) {
					this.tree.reveal(element, 0.5);
				}

				this.tree.setFocus([element]);
				this.tree.setSelection([element]);
			}, 1);

			return;
		}

		// If here, we've expanded all parents we can. Waiting on data to come
		// in to possibly show the revealed test.
		this.hasPendingReveal = true;
	}

	/**
	 * Collapse all items in the tree.
	 */
	public async collapseAll() {
		this.tree.collapseAll();
	}

	/**
	 * Tries to peek the first test error, if the item is in a failed state.
	 */
	private async tryPeekError(item: TestItemTreeElement) {
		const lookup = item.test && this.testResults.getStateById(item.test.item.extId);
		return lookup && lookup[1].tasks.some(s => isFailedState(s.state))
			? this.peekOpener.tryPeekFirstError(lookup[0], lookup[1], { preserveFocus: true })
			: false;
	}

	private onContextMenu(evt: ITreeContextMenuEvent<TestExplorerTreeElement | null>) {
		const element = evt.element;
		if (!(element instanceof TestItemTreeElement)) {
			return;
		}

		const actions = getActionableElementActions(this.instantiationService, this.contextKeyService, this.menuService, element);
		this.contextMenuService.showContextMenu({
			getAnchor: () => evt.anchor,
			getActions: () => actions.value.secondary,
			getActionsContext: () => element.test.item.extId,
			onHide: () => actions.dispose(),
		});
	}

	private handleExecuteKeypress(evt: IKeyboardEvent) {
		const focused = this.tree.getFocus();
		const selected = this.tree.getSelection();
		let targeted: (TestExplorerTreeElement | null)[];
		if (focused.length === 1 && selected.includes(focused[0])) {
			evt.browserEvent?.preventDefault();
			targeted = selected;
		} else {
			targeted = focused;
		}

		const toRun = targeted
			.filter((e): e is TestItemTreeElement => e instanceof TestItemTreeElement)
			.filter(e => e.test.item.runnable);

		if (toRun.length) {
			this.testService.runTests({
				debug: false,
				tests: toRun.map(t => ({ src: t.test.src, testId: t.test.item.extId })),
			});
		}
	}

	private reevaluateWelcomeState() {
		const shouldShowWelcome = !!this.listener
			&& this.listener.subscription.busyProviders === 0
			&& this.listener.subscription.pendingRootProviders === 0
			&& this.listener.subscription.isEmpty;

		if (shouldShowWelcome !== this.shouldShowWelcome) {
			this.shouldShowWelcome = shouldShowWelcome;
			this.welcomeVisibilityEmitter.fire(shouldShowWelcome);
		}
	}

	private updatePreferredProjection() {
		this.projection.clear();
		if (!this.listener) {
			this.tree.setChildren(null, []);
			return;
		}

		if (this._viewMode.get() === TestExplorerViewMode.List) {
			this.projection.value = this.instantiationService.createInstance(HierarchicalByNameProjection, this.listener);
		} else {
			this.projection.value = this.instantiationService.createInstance(HierarchicalByLocationProjection, this.listener);
		}

		const scheduler = new RunOnceScheduler(() => this.applyProjectionChanges(), 200);
		this.projection.value.onUpdate(() => {
			if (!scheduler.isScheduled()) {
				scheduler.schedule();
			}
		});

		this.applyProjectionChanges();
	}

	private applyProjectionChanges() {
		this.reevaluateWelcomeState();
		this.projection.value?.applyTo(this.tree);

		if (this.hasPendingReveal) {
			this.revealByIdPath(this.filterState.reveal.value);
		}
	}

	/**
	 * Gets the selected tests from the tree.
	 */
	public getSelectedTests() {
		return this.tree.getSelection();
	}
}

const enum FilterResult {
	Exclude,
	Inherit,
	Include,
}

class TestsFilter implements ITreeFilter<TestExplorerTreeElement> {
	private lastText?: string;
	private filters: [include: boolean, value: string][] | undefined;
	private _filterToUri: string | undefined;

	constructor(
		@ITestExplorerFilterState private readonly state: ITestExplorerFilterState,
		@ITestService private readonly testService: ITestService,
	) { }

	/**
	 * Parses and updates the tree filter. Supports lists of patterns that can be !negated.
	 */
	private setFilter(text: string) {
		this.lastText = text;
		text = text.trim();

		if (!text) {
			this.filters = undefined;
			return;
		}

		this.filters = [];
		for (const filter of splitGlobAware(text, ',').map(s => s.trim()).filter(s => !!s.length)) {
			if (filter.startsWith('!')) {
				this.filters.push([false, filter.slice(1).toLowerCase()]);
			} else {
				this.filters.push([true, filter.toLowerCase()]);
			}
		}
	}

	public filterToUri(uri: URI | undefined) {
		this._filterToUri = uri?.toString();
	}

	/**
	 * @inheritdoc
	 */
	public filter(element: TestItemTreeElement): TreeFilterResult<void> {
		if (element instanceof TestTreeErrorMessage) {
			return TreeVisibility.Visible;
		}

		if (this.state.text.value !== this.lastText) {
			this.setFilter(this.state.text.value);
		}

		if (
			element.test
			&& !this.state.showExcludedTests.value
			&& this.testService.excludeTests.value.has(element.test.item.extId)
		) {
			return TreeVisibility.Hidden;
		}

		switch (Math.min(this.testFilterText(element), this.testLocation(element), this.testState(element))) {
			case FilterResult.Exclude:
				return TreeVisibility.Hidden;
			case FilterResult.Include:
				return TreeVisibility.Visible;
			default:
				return TreeVisibility.Recurse;
		}
	}

	private testState(element: TestItemTreeElement): FilterResult {
		switch (this.state.stateFilter.value) {
			case TestExplorerStateFilter.All:
				return FilterResult.Include;
			case TestExplorerStateFilter.OnlyExecuted:
				return element.state !== TestResultState.Unset ? FilterResult.Include : FilterResult.Inherit;
			case TestExplorerStateFilter.OnlyFailed:
				return isFailedState(element.state) ? FilterResult.Include : FilterResult.Inherit;
		}
	}

	private testLocation(element: TestItemTreeElement): FilterResult {
		if (!this._filterToUri || !this.state.currentDocumentOnly.value) {
			return FilterResult.Include;
		}

		for (let e: IActionableTestTreeElement | null = element; e instanceof TestItemTreeElement; e = e!.parent) {
			return e.test.item.uri.toString() === this._filterToUri
				? FilterResult.Include
				: FilterResult.Exclude;
		}

		return FilterResult.Inherit;
	}

	private testFilterText(element: IActionableTestTreeElement) {
		if (!this.filters) {
			return FilterResult.Include;
		}

		for (let e: IActionableTestTreeElement | null = element; e; e = e.parent) {
			// start as included if the first glob is a negation
			let included = this.filters[0][0] === false ? FilterResult.Include : FilterResult.Inherit;
			const data = e.label.toLowerCase();

			for (const [include, filter] of this.filters) {
				if (data.includes(filter)) {
					included = include ? FilterResult.Include : FilterResult.Exclude;
				}
			}

			if (included !== FilterResult.Inherit) {
				return included;
			}
		}

		return FilterResult.Inherit;
	}
}

class TreeSorter implements ITreeSorter<TestExplorerTreeElement> {
	constructor(private readonly viewModel: TestingExplorerViewModel) { }

	public compare(a: TestExplorerTreeElement, b: TestExplorerTreeElement): number {
		if (a instanceof TestTreeErrorMessage || b instanceof TestTreeErrorMessage) {
			return (a instanceof TestTreeErrorMessage ? -1 : 0) + (b instanceof TestTreeErrorMessage ? 1 : 0);
		}

		let delta = cmpPriority(a.state, b.state);
		if (delta !== 0) {
			return delta;
		}

		if (this.viewModel.viewSorting === TestExplorerViewSorting.ByLocation) {
			if (a instanceof TestItemTreeElement && b instanceof TestItemTreeElement
				&& a.test.item.uri.toString() === b.test.item.uri.toString() && a.test.item.range && b.test.item.range) {
				const delta = a.test.item.range.startLineNumber - b.test.item.range.startLineNumber;
				if (delta !== 0) {
					return delta;
				}
			}
		}

		return a.label.localeCompare(b.label);
	}
}

const getLabelForTestTreeElement = (element: IActionableTestTreeElement) => {
	let label = localize({
		key: 'testing.treeElementLabel',
		comment: ['label then the unit tests state, for example "Addition Tests (Running)"'],
	}, '{0} ({1})', element.label, testStateNames[element.state]);

	if (element instanceof TestItemTreeElement && element.retired) {
		label = localize({
			key: 'testing.treeElementLabelOutdated',
			comment: ['{0} is the original label in testing.treeElementLabel'],
		}, '{0}, outdated result', label, testStateNames[element.state]);
	}

	return label;
};

class ListAccessibilityProvider implements IListAccessibilityProvider<TestExplorerTreeElement> {
	getWidgetAriaLabel(): string {
		return localize('testExplorer', "Test Explorer");
	}

	getAriaLabel(element: TestExplorerTreeElement): string {
		return element instanceof TestTreeErrorMessage
			? element.description
			: getLabelForTestTreeElement(element);
	}
}

class TreeKeyboardNavigationLabelProvider implements IKeyboardNavigationLabelProvider<TestExplorerTreeElement> {
	getKeyboardNavigationLabel(element: TestExplorerTreeElement) {
		return element instanceof TestTreeErrorMessage ? element.message : element.label;
	}
}

class ListDelegate implements IListVirtualDelegate<TestExplorerTreeElement> {
	getHeight(_element: TestExplorerTreeElement) {
		return 22;
	}

	getTemplateId(element: TestExplorerTreeElement) {
		if (element instanceof TestTreeWorkspaceFolder) {
			return WorkspaceFolderRenderer.ID;
		}

		if (element instanceof TestTreeErrorMessage) {
			return ErrorRenderer.ID;
		}

		return TestItemRenderer.ID;
	}
}

class IdentityProvider implements IIdentityProvider<TestExplorerTreeElement> {
	public getId(element: TestExplorerTreeElement) {
		return element.treeId;
	}
}

interface IErrorTemplateData {
	label: HTMLElement;
}

class ErrorRenderer implements ITreeRenderer<TestTreeErrorMessage, FuzzyScore, IErrorTemplateData> {
	static readonly ID = 'error';

	private readonly renderer: MarkdownRenderer;

	constructor(@IInstantiationService instantionService: IInstantiationService) {
		this.renderer = instantionService.createInstance(MarkdownRenderer, {});
	}

	get templateId(): string {
		return ErrorRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IErrorTemplateData {
		const label = dom.append(container, dom.$('.error'));
		return { label };
	}

	renderElement({ element }: ITreeNode<TestTreeErrorMessage, FuzzyScore>, _: number, data: IErrorTemplateData): void {
		if (typeof element.message === 'string') {
			data.label.innerText = element.message;
		} else {
			const result = this.renderer.render(element.message, { inline: true });
			data.label.appendChild(result.element);
		}

		data.label.title = element.description;
	}

	disposeTemplate(): void {
		// noop
	}
}

interface IActionableElementTemplateData {
	label: IResourceLabel;
	icon: HTMLElement;
	wrapper: HTMLElement;
	actionBar: ActionBar;
	elementDisposable: IDisposable[];
	templateDisposable: IDisposable[];
}

abstract class ActionableItemTemplateData<T extends IActionableTestTreeElement> extends Disposable
	implements ITreeRenderer<T, FuzzyScore, IActionableElementTemplateData> {
	constructor(
		protected readonly labels: ResourceLabels,
		private readonly menuService: IMenuService,
		private readonly contextKeyService: IContextKeyService,
		private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	/**
	 * @inheritdoc
	 */
	abstract get templateId(): string;

	/**
	 * @inheritdoc
	 */
	public renderTemplate(container: HTMLElement): IActionableElementTemplateData {
		const wrapper = dom.append(container, dom.$('.test-item'));

		const icon = dom.append(wrapper, dom.$('.computed-state'));
		const name = dom.append(wrapper, dom.$('.name'));
		const label = this.labels.create(name, { supportHighlights: true });

		dom.append(wrapper, dom.$(ThemeIcon.asCSSSelector(testingHiddenIcon)));
		const actionBar = new ActionBar(wrapper, {
			actionViewItemProvider: action =>
				action instanceof MenuItemAction
					? this.instantiationService.createInstance(MenuEntryActionViewItem, action)
					: undefined
		});

		return { wrapper, label, actionBar, icon, elementDisposable: [], templateDisposable: [label, actionBar] };
	}

	/**
	 * @inheritdoc
	 */
	public renderElement({ element }: ITreeNode<T, FuzzyScore>, _: number, data: IActionableElementTemplateData): void {
		this.fillActionBar(element, data);
	}

	/**
	 * @inheritdoc
	 */
	disposeTemplate(templateData: IActionableElementTemplateData): void {
		dispose(templateData.templateDisposable);
		templateData.templateDisposable = [];
	}

	/**
	 * @inheritdoc
	 */
	disposeElement(_element: ITreeNode<T, FuzzyScore>, _: number, templateData: IActionableElementTemplateData): void {
		dispose(templateData.elementDisposable);
		templateData.elementDisposable = [];
	}

	private fillActionBar(element: T, data: IActionableElementTemplateData) {
		const actions = getActionableElementActions(this.instantiationService, this.contextKeyService, this.menuService, element);
		data.elementDisposable.push(actions);
		data.actionBar.clear();
		data.actionBar.push(actions.value.primary, { icon: true, label: false });
	}
}

class TestItemRenderer extends ActionableItemTemplateData<TestItemTreeElement> {
	public static readonly ID = 'testItem';

	constructor(
		labels: ResourceLabels,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITestService private readonly testService: ITestService
	) {
		super(labels, menuService, contextKeyService, instantiationService);
	}

	/**
	 * @inheritdoc
	 */
	get templateId(): string {
		return TestItemRenderer.ID;
	}

	/**
	 * @inheritdoc
	 */
	public override renderElement(node: ITreeNode<TestItemTreeElement, FuzzyScore>, depth: number, data: IActionableElementTemplateData): void {
		super.renderElement(node, depth, data);

		const label: IResourceLabelProps = { name: node.element.label };
		const options: IResourceLabelOptions = {};
		data.label.setResource(label, options);

		const testHidden = this.testService.excludeTests.value.has(node.element.test.item.extId);
		data.wrapper.classList.toggle('test-is-hidden', testHidden);

		const icon = testingStatesToIcons.get(node.element.test.expand === TestItemExpandState.BusyExpanding ? TestResultState.Running : node.element.state);

		data.icon.className = 'computed-state ' + (icon ? ThemeIcon.asClassName(icon) : '');
		if (node.element.retired) {
			data.icon.className += ' retired';
		}

		label.resource = node.element.test.item.uri;
		options.title = getLabelForTestTreeElement(node.element);
		options.fileKind = FileKind.FILE;
		label.description = node.element.description || undefined;
		data.label.setResource(label, options);
	}
}

class WorkspaceFolderRenderer extends ActionableItemTemplateData<TestTreeWorkspaceFolder> {
	public static readonly ID = 'workspaceFolder';

	constructor(
		labels: ResourceLabels,
		@IMenuService menuService: IMenuService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(labels, menuService, contextKeyService, instantiationService);
	}

	/**
	 * @inheritdoc
	 */
	get templateId(): string {
		return WorkspaceFolderRenderer.ID;
	}

	/**
	 * @inheritdoc
	 */
	public override renderElement(node: ITreeNode<TestTreeWorkspaceFolder, FuzzyScore>, depth: number, data: IActionableElementTemplateData): void {
		super.renderElement(node, depth, data);

		const label: IResourceLabelProps = { name: node.element.label };
		const options: IResourceLabelOptions = {};
		data.label.setResource(label, options);

		const icon = testingStatesToIcons.get(node.element.state);
		data.icon.className = 'computed-state ' + (icon ? ThemeIcon.asClassName(icon) : '');
		options.fileKind = FileKind.ROOT_FOLDER;
		data.label.setResource(label, options);
	}
}

const getActionableElementActions = (
	instantionService: IInstantiationService,
	contextKeyService: IContextKeyService,
	menuService: IMenuService,
	element: IActionableTestTreeElement,
) => {
	const test = element instanceof TestItemTreeElement ? element.test : undefined;
	const contextOverlay = contextKeyService.createOverlay([
		['view', Testing.ExplorerViewId],
		[TestingContextKeys.testItemExtId.key, test?.item.extId]
	]);
	const menu = menuService.createMenu(MenuId.TestItem, contextOverlay);

	try {
		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const running = element.state === TestResultState.Running;
		if (!Iterable.isEmpty(element.runnable)) {
			const run = instantionService.createInstance(RunAction, element.runnable, running);
			primary.push(run);
			secondary.push(run);
		}

		if (!Iterable.isEmpty(element.debuggable)) {
			const debug = instantionService.createInstance(DebugAction, element.debuggable, running);
			primary.push(debug);
			secondary.push(debug);
		}

		if (test) {
			secondary.push(instantionService.createInstance(HideOrShowTestAction, test.item.extId));
		}

		const result = { primary, secondary };
		const actionsDisposable = createAndFillInActionBarActions(menu, {
			arg: test?.item,
			shouldForwardArgs: true,
		}, result, 'inline');

		return { value: result, dispose: () => actionsDisposable.dispose };
	} finally {
		menu.dispose();
	}
};


registerThemingParticipant((theme, collector) => {
	if (theme.type === 'dark') {
		const foregroundColor = theme.getColor(foreground);
		if (foregroundColor) {
			const fgWithOpacity = new Color(new RGBA(foregroundColor.rgba.r, foregroundColor.rgba.g, foregroundColor.rgba.b, 0.65));
			collector.addRule(`.test-explorer .test-explorer-messages { color: ${fgWithOpacity}; }`);
		}
	}
});
