/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/markers';

import { URI } from 'vs/base/common/uri';
import * as dom from 'vs/base/browser/dom';
import { IAction, Action, Separator } from 'vs/base/common/actions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import Constants from 'vs/workbench/contrib/markers/browser/constants';
import { Marker, ResourceMarkers, RelatedInformation, MarkerChangesEvent, MarkersModel, compareMarkersByUri, MarkerElement } from 'vs/workbench/contrib/markers/browser/markersModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { MarkersFilterActionViewItem, MarkersFilters, IMarkersFiltersChangeEvent } from 'vs/workbench/contrib/markers/browser/markersViewActions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import Messages from 'vs/workbench/contrib/markers/browser/messages';
import { RangeHighlightDecorations } from 'vs/workbench/browser/codeeditor';
import { IThemeService, registerThemingParticipant, IColorTheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { localize } from 'vs/nls';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Iterable } from 'vs/base/common/iterator';
import { ITreeElement, ITreeNode, ITreeContextMenuEvent, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { Relay, Event, Emitter } from 'vs/base/common/event';
import { WorkbenchObjectTree, IListService, IWorkbenchObjectTreeOptions } from 'vs/platform/list/browser/listService';
import { FilterOptions } from 'vs/workbench/contrib/markers/browser/markersFilterOptions';
import { IExpression } from 'vs/base/common/glob';
import { deepClone } from 'vs/base/common/objects';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { FilterData, Filter, VirtualDelegate, ResourceMarkersRenderer, MarkerRenderer, RelatedInformationRenderer, MarkersTreeAccessibilityProvider, MarkersViewModel, ResourceDragAndDrop } from 'vs/workbench/contrib/markers/browser/markersTreeViewer';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ActionBar, IActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { StandardKeyboardEvent, IKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { domEvent } from 'vs/base/browser/event';
import { ResourceLabels } from 'vs/workbench/browser/labels';
import { IMarker, IMarkerService, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { withUndefinedAsNull } from 'vs/base/common/types';
import { MementoObject, Memento } from 'vs/workbench/common/memento';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { KeyCode } from 'vs/base/common/keyCodes';
import { editorLightBulbForeground, editorLightBulbAutoFixForeground } from 'vs/platform/theme/common/colorRegistry';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPane';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { Codicon } from 'vs/base/common/codicons';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { groupBy } from 'vs/base/common/arrays';
import { ResourceMap } from 'vs/base/common/map';
import { EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { IMarkersView } from 'vs/workbench/contrib/markers/browser/markers';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';

function createResourceMarkersIterator(resourceMarkers: ResourceMarkers): Iterable<ITreeElement<MarkerElement>> {
	return Iterable.map(resourceMarkers.markers, m => {
		const relatedInformationIt = Iterable.from(m.relatedInformation);
		const children = Iterable.map(relatedInformationIt, r => ({ element: r }));

		return { element: m, children };
	});
}

export class MarkersView extends ViewPane implements IMarkersView {

	private lastSelectedRelativeTop: number = 0;
	private currentActiveResource: URI | null = null;

	private readonly rangeHighlightDecorations: RangeHighlightDecorations;
	private readonly markersModel: MarkersModel;
	private readonly filter: Filter;
	private readonly onVisibleDisposables = this._register(new DisposableStore());

	private tree: MarkersTree | undefined;
	private filterActionBar: ActionBar | undefined;
	private messageBoxContainer: HTMLElement | undefined;
	private ariaLabelElement: HTMLElement | undefined;
	readonly filters: MarkersFilters;

	private readonly panelState: MementoObject;

	private _onDidChangeFilterStats = this._register(new Emitter<{ total: number, filtered: number }>());
	readonly onDidChangeFilterStats: Event<{ total: number, filtered: number }> = this._onDidChangeFilterStats.event;
	private cachedFilterStats: { total: number; filtered: number; } | undefined = undefined;

	private currentResourceGotAddedToMarkersData: boolean = false;
	private readonly markersViewModel: MarkersViewModel;
	private readonly smallLayoutContextKey: IContextKey<boolean>;
	private get smallLayout(): boolean { return !!this.smallLayoutContextKey.get(); }
	private set smallLayout(smallLayout: boolean) { this.smallLayoutContextKey.set(smallLayout); }

	readonly onDidChangeVisibility = this.onDidChangeBodyVisibility;

	private readonly _onDidFocusFilter: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidFocusFilter: Event<void> = this._onDidFocusFilter.event;

	private readonly _onDidClearFilterText: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidClearFilterText: Event<void> = this._onDidClearFilterText.event;

	constructor(
		options: IViewPaneOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IMenuService private readonly menuService: IMenuService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IStorageService storageService: IStorageService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this.smallLayoutContextKey = Constants.MarkersViewSmallLayoutContextKey.bindTo(this.contextKeyService);
		this.panelState = new Memento(Constants.MARKERS_VIEW_STORAGE_ID, storageService).getMemento(StorageScope.WORKSPACE, StorageTarget.USER);

		this.markersModel = this._register(instantiationService.createInstance(MarkersModel));
		this.markersViewModel = this._register(instantiationService.createInstance(MarkersViewModel, this.panelState['multiline']));
		this._register(this.onDidChangeVisibility(visible => this.onDidChangeMarkersViewVisibility(visible)));

		this.setCurrentActiveEditor();

		this.filter = new Filter(FilterOptions.EMPTY(uriIdentityService));
		this.rangeHighlightDecorations = this._register(this.instantiationService.createInstance(RangeHighlightDecorations));

		this.filters = this._register(new MarkersFilters({
			filterText: this.panelState['filter'] || '',
			filterHistory: this.panelState['filterHistory'] || [],
			showErrors: this.panelState['showErrors'] !== false,
			showWarnings: this.panelState['showWarnings'] !== false,
			showInfos: this.panelState['showInfos'] !== false,
			excludedFiles: !!this.panelState['useFilesExclude'],
			activeFile: !!this.panelState['activeFile'],
			layout: new dom.Dimension(0, 0)
		}));
	}

	public override renderBody(parent: HTMLElement): void {
		super.renderBody(parent);

		parent.classList.add('markers-panel');

		const container = dom.append(parent, dom.$('.markers-panel-container'));

		this.createFilterActionBar(container);
		this.createArialLabelElement(container);
		this.createMessageBox(container);
		this.createTree(container);

		this.updateFilter();

		this.filterActionBar!.push(new Action(`workbench.actions.treeView.${this.id}.filter`));
		this.renderContent();
	}

	public getTitle(): string {
		return Messages.MARKERS_PANEL_TITLE_PROBLEMS;
	}

	public override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		const wasSmallLayout = this.smallLayout;
		this.smallLayout = width < 600 && height > 100;
		if (this.smallLayout !== wasSmallLayout) {
			if (this.filterActionBar) {
				this.filterActionBar.getContainer().classList.toggle('hide', !this.smallLayout);
			}
		}
		const contentHeight = this.smallLayout ? height - 44 : height;
		if (this.tree) {
			this.tree.layout(contentHeight, width);
		}
		if (this.messageBoxContainer) {
			this.messageBoxContainer.style.height = `${contentHeight}px`;
		}
		this.filters.layout = new dom.Dimension(this.smallLayout ? width : width - 200, height);
	}

	public override focus(): void {
		if (this.tree && this.tree.getHTMLElement() === document.activeElement) {
			return;
		}

		if (this.hasNoProblems() && this.messageBoxContainer) {
			this.messageBoxContainer.focus();
		} else if (this.tree) {
			this.tree.domFocus();
			this.setTreeSelection();
		}
	}

	public focusFilter(): void {
		this._onDidFocusFilter.fire();
	}

	public clearFilterText(): void {
		this._onDidClearFilterText.fire();
	}

	public showQuickFixes(marker: Marker): void {
		const viewModel = this.markersViewModel.getViewModel(marker);
		if (viewModel) {
			viewModel.quickFixAction.run();
		}
	}

	public openFileAtElement(element: any, preserveFocus: boolean, sideByside: boolean, pinned: boolean): boolean {
		const { resource, selection, event, data } = element instanceof Marker ? { resource: element.resource, selection: element.range, event: 'problems.selectDiagnostic', data: this.getTelemetryData(element.marker) } :
			element instanceof RelatedInformation ? { resource: element.raw.resource, selection: element.raw, event: 'problems.selectRelatedInformation', data: this.getTelemetryData(element.marker) } : { resource: null, selection: null, event: null, data: null };
		if (resource && selection && event) {
			/* __GDPR__
			"problems.selectDiagnostic" : {
				"source": { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
				"code" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" }
			}
			*/
			/* __GDPR__
				"problems.selectRelatedInformation" : {
					"source": { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
					"code" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryService.publicLog(event, data);
			this.editorService.openEditor({
				resource,
				options: {
					selection,
					preserveFocus,
					pinned,
					revealIfVisible: true
				},
			}, sideByside ? SIDE_GROUP : ACTIVE_GROUP).then(editor => {
				if (editor && preserveFocus) {
					this.rangeHighlightDecorations.highlightRange({ resource, range: selection }, <ICodeEditor>editor.getControl());
				} else {
					this.rangeHighlightDecorations.removeHighlightRange();
				}
			});
			return true;
		} else {
			this.rangeHighlightDecorations.removeHighlightRange();
		}
		return false;
	}

	private refreshPanel(markerOrChange?: Marker | MarkerChangesEvent): void {
		if (this.isVisible() && this.tree) {
			const hasSelection = this.tree.getSelection().length > 0;
			this.cachedFilterStats = undefined;

			if (markerOrChange) {
				if (markerOrChange instanceof Marker) {
					this.tree.rerender(markerOrChange);
				} else {
					if (markerOrChange.added.size || markerOrChange.removed.size) {
						// Reset complete tree
						this.resetTree();
					} else {
						// Update resource
						for (const updated of markerOrChange.updated) {
							this.tree.setChildren(updated, createResourceMarkersIterator(updated));
							this.tree.rerender(updated);
						}
					}
				}
			} else {
				// Reset complete tree
				this.resetTree();
			}

			const { total, filtered } = this.getFilterStats();
			this.tree.toggleVisibility(total === 0 || filtered === 0);
			this.renderMessage();
			this._onDidChangeFilterStats.fire(this.getFilterStats());

			if (hasSelection) {
				this.setTreeSelection();
			}
		}
	}

	private setTreeSelection(): void {
		if (this.tree && this.tree.isVisible() && this.tree.getSelection().length === 0) {
			const firstVisibleElement = this.tree.firstVisibleElement;
			const marker = firstVisibleElement ?
				firstVisibleElement instanceof ResourceMarkers ? firstVisibleElement.markers[0] :
					firstVisibleElement instanceof Marker ? firstVisibleElement : undefined
				: undefined;
			if (marker) {
				this.tree.setFocus([marker]);
				this.tree.setSelection([marker]);
			}
		}
	}

	private onDidChangeViewState(marker?: Marker): void {
		this.refreshPanel(marker);
	}

	private resetTree(): void {
		if (!this.tree) {
			return;
		}
		let resourceMarkers: ResourceMarkers[] = [];
		if (this.filters.activeFile) {
			if (this.currentActiveResource) {
				const activeResourceMarkers = this.markersModel.getResourceMarkers(this.currentActiveResource);
				if (activeResourceMarkers) {
					resourceMarkers = [activeResourceMarkers];
				}
			}
		} else {
			resourceMarkers = this.markersModel.resourceMarkers;
		}
		this.tree.setChildren(null, Iterable.map(resourceMarkers, m => ({ element: m, children: createResourceMarkersIterator(m) })));
	}

	private updateFilter() {
		this.cachedFilterStats = undefined;
		this.filter.options = new FilterOptions(this.filters.filterText, this.getFilesExcludeExpressions(), this.filters.showWarnings, this.filters.showErrors, this.filters.showInfos, this.uriIdentityService);
		if (this.tree) {
			this.tree.refilter();
		}
		this._onDidChangeFilterStats.fire(this.getFilterStats());

		const { total, filtered } = this.getFilterStats();
		if (this.tree) {
			this.tree.toggleVisibility(total === 0 || filtered === 0);
		}
		this.renderMessage();
	}

	private getFilesExcludeExpressions(): { root: URI, expression: IExpression }[] | IExpression {
		if (!this.filters.excludedFiles) {
			return [];
		}

		const workspaceFolders = this.workspaceContextService.getWorkspace().folders;
		return workspaceFolders.length
			? workspaceFolders.map(workspaceFolder => ({ root: workspaceFolder.uri, expression: this.getFilesExclude(workspaceFolder.uri) }))
			: this.getFilesExclude();
	}

	private getFilesExclude(resource?: URI): IExpression {
		return deepClone(this.configurationService.getValue('files.exclude', { resource })) || {};
	}

	private createFilterActionBar(parent: HTMLElement): void {
		this.filterActionBar = this._register(new ActionBar(parent, { actionViewItemProvider: action => this.getActionViewItem(action) }));
		this.filterActionBar.getContainer().classList.add('markers-panel-filter-container');
		this.filterActionBar.getContainer().classList.toggle('hide', !this.smallLayout);
	}

	private createMessageBox(parent: HTMLElement): void {
		this.messageBoxContainer = dom.append(parent, dom.$('.message-box-container'));
		this.messageBoxContainer.setAttribute('aria-labelledby', 'markers-panel-arialabel');
	}

	private createArialLabelElement(parent: HTMLElement): void {
		this.ariaLabelElement = dom.append(parent, dom.$(''));
		this.ariaLabelElement.setAttribute('id', 'markers-panel-arialabel');
	}

	private createTree(parent: HTMLElement): void {
		const onDidChangeRenderNodeCount = new Relay<ITreeNode<any, any>>();

		const treeLabels = this._register(this.instantiationService.createInstance(ResourceLabels, this));

		const virtualDelegate = new VirtualDelegate(this.markersViewModel);
		const renderers = [
			this.instantiationService.createInstance(ResourceMarkersRenderer, treeLabels, onDidChangeRenderNodeCount.event),
			this.instantiationService.createInstance(MarkerRenderer, this.markersViewModel),
			this.instantiationService.createInstance(RelatedInformationRenderer)
		];
		const accessibilityProvider = this.instantiationService.createInstance(MarkersTreeAccessibilityProvider);

		const identityProvider = {
			getId(element: MarkerElement) {
				return element.id;
			}
		};

		this.tree = this._register(this.instantiationService.createInstance(MarkersTree,
			'MarkersView',
			dom.append(parent, dom.$('.tree-container.show-file-icons')),
			virtualDelegate,
			renderers,
			{
				filter: this.filter,
				accessibilityProvider,
				identityProvider,
				dnd: new ResourceDragAndDrop(this.instantiationService),
				expandOnlyOnTwistieClick: (e: MarkerElement) => e instanceof Marker && e.relatedInformation.length > 0,
				overrideStyles: {
					listBackground: this.getBackgroundColor()
				},
				selectionNavigation: true
			},
		));

		onDidChangeRenderNodeCount.input = this.tree.onDidChangeRenderNodeCount;

		const markerFocusContextKey = Constants.MarkerFocusContextKey.bindTo(this.tree.contextKeyService);
		const relatedInformationFocusContextKey = Constants.RelatedInformationFocusContextKey.bindTo(this.tree.contextKeyService);
		this._register(this.tree.onDidChangeFocus(focus => {
			markerFocusContextKey.set(focus.elements.some(e => e instanceof Marker));
			relatedInformationFocusContextKey.set(focus.elements.some(e => e instanceof RelatedInformation));
		}));

		this._register(Event.debounce(this.tree.onDidOpen, (last, event) => event, 75, true)(options => {
			this.openFileAtElement(options.element, !!options.editorOptions.preserveFocus, options.sideBySide, !!options.editorOptions.pinned);
		}));
		this._register(this.tree.onDidChangeCollapseState(({ node }) => {
			const { element } = node;
			if (element instanceof RelatedInformation && !node.collapsed) {
				/* __GDPR__
				"problems.expandRelatedInformation" : {
					"source": { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" },
					"code" : { "classification": "PublicNonPersonalData", "purpose": "FeatureInsight" }
				}
				*/
				this.telemetryService.publicLog('problems.expandRelatedInformation', this.getTelemetryData(element.marker));
			}
		}));

		this._register(this.tree.onContextMenu(this.onContextMenu, this));

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (this.filters.excludedFiles && e.affectsConfiguration('files.exclude')) {
				this.updateFilter();
			}
		}));

		// move focus to input, whenever a key is pressed in the panel container
		this._register(domEvent(parent, 'keydown')(e => {
			if (this.keybindingService.mightProducePrintableCharacter(new StandardKeyboardEvent(e))) {
				this.focusFilter();
			}
		}));

		this._register(Event.any<any>(this.tree.onDidChangeSelection, this.tree.onDidChangeFocus)(() => {
			const elements = [...this.tree!.getSelection(), ...this.tree!.getFocus()];
			for (const element of elements) {
				if (element instanceof Marker) {
					const viewModel = this.markersViewModel.getViewModel(element);
					if (viewModel) {
						viewModel.showLightBulb();
					}
				}
			}
		}));

		this._register(this.tree.onDidChangeSelection(() => this.onSelected()));
	}

	collapseAll(): void {
		if (this.tree) {
			this.tree.collapseAll();
			this.tree.setSelection([]);
			this.tree.setFocus([]);
			this.tree.getHTMLElement().focus();
			this.tree.focusFirst();
		}
	}

	setMultiline(multiline: boolean): void {
		this.markersViewModel.multiline = multiline;
	}

	private onDidChangeMarkersViewVisibility(visible: boolean): void {
		this.onVisibleDisposables.clear();
		if (visible) {
			for (const disposable of this.reInitialize()) {
				this.onVisibleDisposables.add(disposable);
			}
			this.refreshPanel();
		}
	}

	private reInitialize(): IDisposable[] {
		const disposables = [];

		// Markers Model
		const readMarkers = (resource?: URI) => this.markerService.read({ resource, severities: MarkerSeverity.Error | MarkerSeverity.Warning | MarkerSeverity.Info });
		this.markersModel.setResourceMarkers(groupBy(readMarkers(), compareMarkersByUri).map(group => [group[0].resource, group]));
		disposables.push(Event.debounce<readonly URI[], ResourceMap<URI>>(this.markerService.onMarkerChanged, (resourcesMap, resources) => {
			resourcesMap = resourcesMap || new ResourceMap<URI>();
			resources.forEach(resource => resourcesMap!.set(resource, resource));
			return resourcesMap;
		}, 64)(resourcesMap => {
			this.markersModel.setResourceMarkers([...resourcesMap.values()].map(resource => [resource, readMarkers(resource)]));
		}));
		disposables.push(Event.any<MarkerChangesEvent | void>(this.markersModel.onDidChange, this.editorService.onDidActiveEditorChange)(changes => {
			if (changes) {
				this.onDidChangeModel(changes);
			} else {
				this.onActiveEditorChanged();
			}
		}));
		disposables.push(toDisposable(() => this.markersModel.reset()));

		// Markers View Model
		this.markersModel.resourceMarkers.forEach(resourceMarker => resourceMarker.markers.forEach(marker => this.markersViewModel.add(marker)));
		disposables.push(this.markersViewModel.onDidChange(marker => this.onDidChangeViewState(marker)));
		disposables.push(toDisposable(() => this.markersModel.resourceMarkers.forEach(resourceMarker => this.markersViewModel.remove(resourceMarker.resource))));

		// Markers Filters
		disposables.push(this.filters.onDidChange((event: IMarkersFiltersChangeEvent) => {
			this.reportFilteringUsed();
			if (event.activeFile) {
				this.refreshPanel();
			} else if (event.filterText || event.excludedFiles || event.showWarnings || event.showErrors || event.showInfos) {
				this.updateFilter();
			}
		}));
		disposables.push(toDisposable(() => { this.cachedFilterStats = undefined; }));

		disposables.push(toDisposable(() => this.rangeHighlightDecorations.removeHighlightRange()));

		return disposables;
	}

	private onDidChangeModel(change: MarkerChangesEvent): void {
		const resourceMarkers = [...change.added, ...change.removed, ...change.updated];
		const resources: URI[] = [];
		for (const { resource } of resourceMarkers) {
			this.markersViewModel.remove(resource);
			const resourceMarkers = this.markersModel.getResourceMarkers(resource);
			if (resourceMarkers) {
				for (const marker of resourceMarkers.markers) {
					this.markersViewModel.add(marker);
				}
			}
			resources.push(resource);
		}
		this.currentResourceGotAddedToMarkersData = this.currentResourceGotAddedToMarkersData || this.isCurrentResourceGotAddedToMarkersData(resources);
		this.refreshPanel(change);
		this.updateRangeHighlights();
		if (this.currentResourceGotAddedToMarkersData) {
			this.autoReveal();
			this.currentResourceGotAddedToMarkersData = false;
		}
	}

	private isCurrentResourceGotAddedToMarkersData(changedResources: URI[]) {
		const currentlyActiveResource = this.currentActiveResource;
		if (!currentlyActiveResource) {
			return false;
		}
		const resourceForCurrentActiveResource = this.getResourceForCurrentActiveResource();
		if (resourceForCurrentActiveResource) {
			return false;
		}
		return changedResources.some(r => r.toString() === currentlyActiveResource.toString());
	}

	private onActiveEditorChanged(): void {
		this.setCurrentActiveEditor();
		if (this.filters.activeFile) {
			this.refreshPanel();
		}
		this.autoReveal();
	}

	private setCurrentActiveEditor(): void {
		const activeEditor = this.editorService.activeEditor;
		this.currentActiveResource = activeEditor ? withUndefinedAsNull(EditorResourceAccessor.getOriginalUri(activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY })) : null;
	}

	private onSelected(): void {
		if (this.tree) {
			let selection = this.tree.getSelection();
			if (selection && selection.length > 0) {
				this.lastSelectedRelativeTop = this.tree!.getRelativeTop(selection[0]) || 0;
			}
		}
	}

	private hasNoProblems(): boolean {
		const { total, filtered } = this.getFilterStats();
		return total === 0 || filtered === 0;
	}

	private renderContent(): void {
		this.cachedFilterStats = undefined;
		this.resetTree();
		if (this.tree) {
			this.tree.toggleVisibility(this.hasNoProblems());
		}
		this.renderMessage();
	}

	private renderMessage(): void {
		if (!this.messageBoxContainer || !this.ariaLabelElement) {
			return;
		}
		dom.clearNode(this.messageBoxContainer);
		const { total, filtered } = this.getFilterStats();

		if (filtered === 0) {
			this.messageBoxContainer.style.display = 'block';
			this.messageBoxContainer.setAttribute('tabIndex', '0');
			if (this.filters.activeFile) {
				this.renderFilterMessageForActiveFile(this.messageBoxContainer);
			} else {
				if (total > 0) {
					this.renderFilteredByFilterMessage(this.messageBoxContainer);
				} else {
					this.renderNoProblemsMessage(this.messageBoxContainer);
				}
			}
		} else {
			this.messageBoxContainer.style.display = 'none';
			if (filtered === total) {
				this.setAriaLabel(localize('No problems filtered', "Showing {0} problems", total));
			} else {
				this.setAriaLabel(localize('problems filtered', "Showing {0} of {1} problems", filtered, total));
			}
			this.messageBoxContainer.removeAttribute('tabIndex');
		}
	}

	private renderFilterMessageForActiveFile(container: HTMLElement): void {
		if (this.currentActiveResource && this.markersModel.getResourceMarkers(this.currentActiveResource)) {
			this.renderFilteredByFilterMessage(container);
		} else {
			this.renderNoProblemsMessageForActiveFile(container);
		}
	}

	private renderFilteredByFilterMessage(container: HTMLElement) {
		const span1 = dom.append(container, dom.$('span'));
		span1.textContent = Messages.MARKERS_PANEL_NO_PROBLEMS_FILTERS;
		const link = dom.append(container, dom.$('a.messageAction'));
		link.textContent = localize('clearFilter', "Clear Filters");
		link.setAttribute('tabIndex', '0');
		const span2 = dom.append(container, dom.$('span'));
		span2.textContent = '.';
		dom.addStandardDisposableListener(link, dom.EventType.CLICK, () => this.clearFilters());
		dom.addStandardDisposableListener(link, dom.EventType.KEY_DOWN, (e: IKeyboardEvent) => {
			if (e.equals(KeyCode.Enter) || e.equals(KeyCode.Space)) {
				this.clearFilters();
				e.stopPropagation();
			}
		});
		this.setAriaLabel(Messages.MARKERS_PANEL_NO_PROBLEMS_FILTERS);
	}

	private renderNoProblemsMessageForActiveFile(container: HTMLElement) {
		const span = dom.append(container, dom.$('span'));
		span.textContent = Messages.MARKERS_PANEL_NO_PROBLEMS_ACTIVE_FILE_BUILT;
		this.setAriaLabel(Messages.MARKERS_PANEL_NO_PROBLEMS_ACTIVE_FILE_BUILT);
	}

	private renderNoProblemsMessage(container: HTMLElement) {
		const span = dom.append(container, dom.$('span'));
		span.textContent = Messages.MARKERS_PANEL_NO_PROBLEMS_BUILT;
		this.setAriaLabel(Messages.MARKERS_PANEL_NO_PROBLEMS_BUILT);
	}

	private setAriaLabel(label: string): void {
		if (this.tree) {
			this.tree.ariaLabel = label;
		}
		this.ariaLabelElement!.setAttribute('aria-label', label);
	}

	private clearFilters(): void {
		this.filters.filterText = '';
		this.filters.excludedFiles = false;
		this.filters.showErrors = true;
		this.filters.showWarnings = true;
		this.filters.showInfos = true;
	}

	private autoReveal(focus: boolean = false): void {
		// No need to auto reveal if active file filter is on
		if (this.filters.activeFile || !this.tree) {
			return;
		}
		let autoReveal = this.configurationService.getValue<boolean>('problems.autoReveal');
		if (typeof autoReveal === 'boolean' && autoReveal) {
			let currentActiveResource = this.getResourceForCurrentActiveResource();
			if (currentActiveResource) {
				if (this.tree.hasElement(currentActiveResource)) {
					if (!this.tree.isCollapsed(currentActiveResource) && this.hasSelectedMarkerFor(currentActiveResource)) {
						this.tree.reveal(this.tree.getSelection()[0], this.lastSelectedRelativeTop);
						if (focus) {
							this.tree.setFocus(this.tree.getSelection());
						}
					} else {
						this.tree.expand(currentActiveResource);
						this.tree.reveal(currentActiveResource, 0);

						if (focus) {
							this.tree.setFocus([currentActiveResource]);
							this.tree.setSelection([currentActiveResource]);
						}
					}
				}
			} else if (focus) {
				this.tree.setSelection([]);
				this.tree.focusFirst();
			}
		}
	}

	private getResourceForCurrentActiveResource(): ResourceMarkers | null {
		return this.currentActiveResource ? this.markersModel.getResourceMarkers(this.currentActiveResource) : null;
	}

	private hasSelectedMarkerFor(resource: ResourceMarkers): boolean {
		if (this.tree) {
			let selectedElement = this.tree.getSelection();
			if (selectedElement && selectedElement.length > 0) {
				if (selectedElement[0] instanceof Marker) {
					if (resource.has((<Marker>selectedElement[0]).marker.resource)) {
						return true;
					}
				}
			}
		}
		return false;
	}

	private updateRangeHighlights() {
		this.rangeHighlightDecorations.removeHighlightRange();
		if (this.tree && this.tree.getHTMLElement() === document.activeElement) {
			this.highlightCurrentSelectedMarkerRange();
		}
	}

	private highlightCurrentSelectedMarkerRange() {
		const selections = this.tree ? this.tree.getSelection() : [];

		if (selections.length !== 1) {
			return;
		}

		const selection = selections[0];

		if (!(selection instanceof Marker)) {
			return;
		}

		this.rangeHighlightDecorations.highlightRange(selection);
	}

	private onContextMenu(e: ITreeContextMenuEvent<MarkerElement | null>): void {
		const element = e.element;
		if (!element) {
			return;
		}

		e.browserEvent.preventDefault();
		e.browserEvent.stopPropagation();

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor!,
			getActions: () => this.getMenuActions(element),
			getActionViewItem: (action) => {
				const keybinding = this.keybindingService.lookupKeybinding(action.id);
				if (keybinding) {
					return new ActionViewItem(action, action, { label: true, keybinding: keybinding.getLabel() });
				}
				return undefined;
			},
			onHide: (wasCancelled?: boolean) => {
				if (wasCancelled) {
					this.tree!.domFocus();
				}
			}
		});
	}

	private getMenuActions(element: MarkerElement): IAction[] {
		const result: IAction[] = [];

		if (element instanceof Marker) {
			const viewModel = this.markersViewModel.getViewModel(element);
			if (viewModel) {
				const quickFixActions = viewModel.quickFixAction.quickFixes;
				if (quickFixActions.length) {
					result.push(...quickFixActions);
					result.push(new Separator());
				}
			}
		}

		const menu = this.menuService.createMenu(MenuId.ProblemsPanelContext, this.tree!.contextKeyService);
		createAndFillInContextMenuActions(menu, undefined, result);
		menu.dispose();
		return result;
	}

	public getFocusElement(): MarkerElement | undefined {
		return this.tree?.getFocus()[0] || undefined;
	}

	public override getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (action.id === `workbench.actions.treeView.${this.id}.filter`) {
			return this.instantiationService.createInstance(MarkersFilterActionViewItem, action, this);
		}
		return super.getActionViewItem(action);
	}

	getFilterStats(): { total: number; filtered: number; } {
		if (!this.cachedFilterStats) {
			this.cachedFilterStats = this.computeFilterStats();
		}

		return this.cachedFilterStats;
	}

	private computeFilterStats(): { total: number; filtered: number; } {
		let filtered = 0;
		if (this.tree) {
			const root = this.tree.getNode();

			for (const resourceMarkerNode of root.children) {
				for (const markerNode of resourceMarkerNode.children) {
					if (resourceMarkerNode.visible && markerNode.visible) {
						filtered++;
					}
				}
			}
		}

		return { total: this.markersModel.total, filtered };
	}

	private getTelemetryData({ source, code }: IMarker): any {
		return { source, code };
	}

	private reportFilteringUsed(): void {
		const data = {
			errors: this.filters.showErrors,
			warnings: this.filters.showWarnings,
			infos: this.filters.showInfos,
			activeFile: this.filters.activeFile,
			excludedFiles: this.filters.excludedFiles,
		};
		/* __GDPR__
			"problems.filter" : {
				"errors" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"warnings": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"infos": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"activeFile": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"excludedFiles": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
			}
		*/
		this.telemetryService.publicLog('problems.filter', data);
	}

	override saveState(): void {
		this.panelState['filter'] = this.filters.filterText;
		this.panelState['filterHistory'] = this.filters.filterHistory;
		this.panelState['showErrors'] = this.filters.showErrors;
		this.panelState['showWarnings'] = this.filters.showWarnings;
		this.panelState['showInfos'] = this.filters.showInfos;
		this.panelState['useFilesExclude'] = this.filters.excludedFiles;
		this.panelState['activeFile'] = this.filters.activeFile;
		this.panelState['multiline'] = this.markersViewModel.multiline;

		super.saveState();
	}

	override dispose() {
		super.dispose();
	}

}

class MarkersTree extends WorkbenchObjectTree<MarkerElement, FilterData> {

	constructor(
		user: string,
		readonly container: HTMLElement,
		delegate: IListVirtualDelegate<MarkerElement>,
		renderers: ITreeRenderer<MarkerElement, FilterData, any>[],
		options: IWorkbenchObjectTreeOptions<MarkerElement, FilterData>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		super(user, container, delegate, renderers, options, contextKeyService, listService, themeService, configurationService, keybindingService, accessibilityService);
	}

	override layout(height: number, width: number): void {
		this.container.style.height = `${height}px`;
		super.layout(height, width);
	}

	toggleVisibility(hide: boolean): void {
		this.container.classList.toggle('hidden', hide);
	}

	isVisible(): boolean {
		return !this.container.classList.contains('hidden');
	}

}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {

	// Lightbulb Icon
	const editorLightBulbForegroundColor = theme.getColor(editorLightBulbForeground);
	if (editorLightBulbForegroundColor) {
		collector.addRule(`
		.monaco-workbench .markers-panel-container ${Codicon.lightBulb.cssSelector} {
			color: ${editorLightBulbForegroundColor};
		}`);
	}

	// Lightbulb Auto Fix Icon
	const editorLightBulbAutoFixForegroundColor = theme.getColor(editorLightBulbAutoFixForeground);
	if (editorLightBulbAutoFixForegroundColor) {
		collector.addRule(`
		.monaco-workbench .markers-panel-container ${Codicon.lightbulbAutofix.cssSelector} {
			color: ${editorLightBulbAutoFixForegroundColor};
		}`);
	}

});
