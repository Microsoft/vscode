/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import * as network from 'vs/base/common/network';
import * as paths from 'vs/base/common/path';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { ResourceLabels, IResourceLabel } from 'vs/workbench/browser/labels';
import { HighlightedLabel } from 'vs/base/browser/ui/highlightedlabel/highlightedLabel';
import { IMarker, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { ResourceMarkers, Marker, RelatedInformation, MarkerElement } from 'vs/workbench/contrib/markers/browser/markersModel';
import Messages from 'vs/workbench/contrib/markers/browser/messages';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { attachBadgeStyler } from 'vs/platform/theme/common/styler';
import { IThemeService, registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IDisposable, dispose, Disposable, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { QuickFixAction, QuickFixActionViewItem } from 'vs/workbench/contrib/markers/browser/markersViewActions';
import { ILabelService } from 'vs/platform/label/common/label';
import { dirname, basename, isEqual } from 'vs/base/common/resources';
import { IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ITreeFilter, TreeVisibility, TreeFilterResult, ITreeRenderer, ITreeNode, ITreeDragAndDrop, ITreeDragOverReaction } from 'vs/base/browser/ui/tree/tree';
import { FilterOptions } from 'vs/workbench/contrib/markers/browser/markersFilterOptions';
import { IMatch } from 'vs/base/common/filters';
import { Event, Emitter } from 'vs/base/common/event';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { Action, IAction } from 'vs/base/common/actions';
import { localize } from 'vs/nls';
import { IDragAndDropData } from 'vs/base/browser/dnd';
import { ElementsDragAndDropData } from 'vs/base/browser/ui/list/listView';
import { fillResourceDataTransfers } from 'vs/workbench/browser/dnd';
import { CancelablePromise, createCancelablePromise, Delayer } from 'vs/base/common/async';
import { IModelService } from 'vs/editor/common/services/modelService';
import { Range } from 'vs/editor/common/core/range';
import { getCodeActions, CodeActionSet } from 'vs/editor/contrib/codeAction/codeAction';
import { CodeActionKind } from 'vs/editor/contrib/codeAction/types';
import { ITextModel } from 'vs/editor/common/model';
import { IEditorService, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { applyCodeAction } from 'vs/editor/contrib/codeAction/codeActionCommands';
import { SeverityIcon } from 'vs/platform/severityIcon/common/severityIcon';
import { CodeActionTriggerType } from 'vs/editor/common/modes';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { textLinkForeground } from 'vs/platform/theme/common/colorRegistry';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { OS, OperatingSystem } from 'vs/base/common/platform';
import { IFileService } from 'vs/platform/files/common/files';
import { domEvent } from 'vs/base/browser/event';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Progress } from 'vs/platform/progress/common/progress';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

interface IResourceMarkersTemplateData {
	resourceLabel: IResourceLabel;
	count: CountBadge;
	styler: IDisposable;
}

interface IMarkerTemplateData {
	markerWidget: MarkerWidget;
}

interface IRelatedInformationTemplateData {
	resourceLabel: HighlightedLabel;
	lnCol: HTMLElement;
	description: HighlightedLabel;
}

export class MarkersTreeAccessibilityProvider implements IListAccessibilityProvider<MarkerElement> {

	constructor(@ILabelService private readonly labelService: ILabelService) { }

	getWidgetAriaLabel(): string {
		return localize('problemsView', "Problems View");
	}

	public getAriaLabel(element: MarkerElement): string | null {
		if (element instanceof ResourceMarkers) {
			const path = this.labelService.getUriLabel(element.resource, { relative: true }) || element.resource.fsPath;
			return Messages.MARKERS_TREE_ARIA_LABEL_RESOURCE(element.markers.length, element.name, paths.dirname(path));
		}
		if (element instanceof Marker) {
			return Messages.MARKERS_TREE_ARIA_LABEL_MARKER(element);
		}
		if (element instanceof RelatedInformation) {
			return Messages.MARKERS_TREE_ARIA_LABEL_RELATED_INFORMATION(element.raw);
		}
		return null;
	}
}

const enum TemplateId {
	ResourceMarkers = 'rm',
	Marker = 'm',
	RelatedInformation = 'ri'
}

export class VirtualDelegate implements IListVirtualDelegate<MarkerElement> {

	static LINE_HEIGHT: number = 22;

	constructor(private readonly markersViewState: MarkersViewModel) { }

	getHeight(element: MarkerElement): number {
		if (element instanceof Marker) {
			const viewModel = this.markersViewState.getViewModel(element);
			const noOfLines = !viewModel || viewModel.multiline ? element.lines.length : 1;
			return noOfLines * VirtualDelegate.LINE_HEIGHT;
		}
		return VirtualDelegate.LINE_HEIGHT;
	}

	getTemplateId(element: MarkerElement): string {
		if (element instanceof ResourceMarkers) {
			return TemplateId.ResourceMarkers;
		} else if (element instanceof Marker) {
			return TemplateId.Marker;
		} else {
			return TemplateId.RelatedInformation;
		}
	}
}

const enum FilterDataType {
	ResourceMarkers,
	Marker,
	RelatedInformation
}

interface ResourceMarkersFilterData {
	type: FilterDataType.ResourceMarkers;
	uriMatches: IMatch[];
}

interface MarkerFilterData {
	type: FilterDataType.Marker;
	lineMatches: IMatch[][];
	sourceMatches: IMatch[];
	codeMatches: IMatch[];
}

interface RelatedInformationFilterData {
	type: FilterDataType.RelatedInformation;
	uriMatches: IMatch[];
	messageMatches: IMatch[];
}

export type FilterData = ResourceMarkersFilterData | MarkerFilterData | RelatedInformationFilterData;

export class ResourceMarkersRenderer implements ITreeRenderer<ResourceMarkers, ResourceMarkersFilterData, IResourceMarkersTemplateData> {

	private renderedNodes = new Map<ITreeNode<ResourceMarkers, ResourceMarkersFilterData>, IResourceMarkersTemplateData>();
	private readonly disposables = new DisposableStore();

	constructor(
		private labels: ResourceLabels,
		onDidChangeRenderNodeCount: Event<ITreeNode<ResourceMarkers, ResourceMarkersFilterData>>,
		@IThemeService private readonly themeService: IThemeService,
		@ILabelService private readonly labelService: ILabelService,
		@IFileService private readonly fileService: IFileService
	) {
		onDidChangeRenderNodeCount(this.onDidChangeRenderNodeCount, this, this.disposables);
	}

	templateId = TemplateId.ResourceMarkers;

	renderTemplate(container: HTMLElement): IResourceMarkersTemplateData {
		const data = <IResourceMarkersTemplateData>Object.create(null);

		const resourceLabelContainer = dom.append(container, dom.$('.resource-label-container'));
		data.resourceLabel = this.labels.create(resourceLabelContainer, { supportHighlights: true });

		const badgeWrapper = dom.append(container, dom.$('.count-badge-wrapper'));
		data.count = new CountBadge(badgeWrapper);
		data.styler = attachBadgeStyler(data.count, this.themeService);

		return data;
	}

	renderElement(node: ITreeNode<ResourceMarkers, ResourceMarkersFilterData>, _: number, templateData: IResourceMarkersTemplateData): void {
		const resourceMarkers = node.element;
		const uriMatches = node.filterData && node.filterData.uriMatches || [];

		if (this.fileService.canHandleResource(resourceMarkers.resource) || resourceMarkers.resource.scheme === network.Schemas.untitled) {
			templateData.resourceLabel.setFile(resourceMarkers.resource, { matches: uriMatches });
		} else {
			templateData.resourceLabel.setResource({ name: resourceMarkers.name, description: this.labelService.getUriLabel(dirname(resourceMarkers.resource), { relative: true }), resource: resourceMarkers.resource }, { matches: uriMatches });
		}

		this.updateCount(node, templateData);
		this.renderedNodes.set(node, templateData);
	}

	disposeElement(node: ITreeNode<ResourceMarkers, ResourceMarkersFilterData>): void {
		this.renderedNodes.delete(node);
	}

	disposeTemplate(templateData: IResourceMarkersTemplateData): void {
		templateData.resourceLabel.dispose();
		templateData.styler.dispose();
	}

	private onDidChangeRenderNodeCount(node: ITreeNode<ResourceMarkers, ResourceMarkersFilterData>): void {
		const templateData = this.renderedNodes.get(node);

		if (!templateData) {
			return;
		}

		this.updateCount(node, templateData);
	}

	private updateCount(node: ITreeNode<ResourceMarkers, ResourceMarkersFilterData>, templateData: IResourceMarkersTemplateData): void {
		templateData.count.setCount(node.children.reduce((r, n) => r + (n.visible ? 1 : 0), 0));
	}

	dispose(): void {
		this.disposables.dispose();
	}
}

export class FileResourceMarkersRenderer extends ResourceMarkersRenderer {
}

export class MarkerRenderer implements ITreeRenderer<Marker, MarkerFilterData, IMarkerTemplateData> {

	constructor(
		private readonly markersViewState: MarkersViewModel,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IOpenerService protected openerService: IOpenerService,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) { }

	templateId = TemplateId.Marker;

	renderTemplate(container: HTMLElement): IMarkerTemplateData {
		const data: IMarkerTemplateData = Object.create(null);
		data.markerWidget = new MarkerWidget(container, this.markersViewState, this.openerService, this._configurationService, this.instantiationService);
		return data;
	}

	renderElement(node: ITreeNode<Marker, MarkerFilterData>, _: number, templateData: IMarkerTemplateData): void {
		templateData.markerWidget.render(node.element, node.filterData);
	}

	disposeTemplate(templateData: IMarkerTemplateData): void {
		templateData.markerWidget.dispose();
	}

}

const expandedIcon = registerIcon('markers-view-multi-line-expanded', Codicon.chevronUp, localize('expandedIcon', 'Icon indicating that multiple lines are shown in the markers view.'));
const collapsedIcon = registerIcon('markers-view-multi-line-collapsed', Codicon.chevronDown, localize('collapsedIcon', 'Icon indicating that multiple lines are collapsed in the markers view.'));

const toggleMultilineAction = 'problems.action.toggleMultiline';

class ToggleMultilineActionViewItem extends ActionViewItem {

	override render(container: HTMLElement): void {
		super.render(container);
		this.updateExpandedAttribute();
	}

	override updateClass(): void {
		super.updateClass();
		this.updateExpandedAttribute();
	}

	private updateExpandedAttribute(): void {
		if (this.element) {
			this.element.setAttribute('aria-expanded', `${this._action.class === ThemeIcon.asClassName(expandedIcon)}`);
		}
	}

}

type ModifierKey = 'meta' | 'ctrl' | 'alt';

class MarkerWidget extends Disposable {

	private readonly actionBar: ActionBar;
	private readonly icon: HTMLElement;
	private readonly multilineActionbar: ActionBar;
	private readonly messageAndDetailsContainer: HTMLElement;
	private readonly disposables = this._register(new DisposableStore());

	private _clickModifierKey: ModifierKey;
	private _codeLink?: HTMLElement;

	constructor(
		private parent: HTMLElement,
		private readonly markersViewModel: MarkersViewModel,
		private readonly _openerService: IOpenerService,
		private readonly _configurationService: IConfigurationService,
		_instantiationService: IInstantiationService
	) {
		super();
		this.actionBar = this._register(new ActionBar(dom.append(parent, dom.$('.actions')), {
			actionViewItemProvider: (action: IAction) => action.id === QuickFixAction.ID ? _instantiationService.createInstance(QuickFixActionViewItem, <QuickFixAction>action) : undefined
		}));
		this.icon = dom.append(parent, dom.$(''));
		this.multilineActionbar = this._register(new ActionBar(dom.append(parent, dom.$('.multiline-actions')), {
			actionViewItemProvider: (action) => {
				if (action.id === toggleMultilineAction) {
					return new ToggleMultilineActionViewItem(undefined, action, { icon: true });
				}
				return undefined;
			}
		}));
		this.messageAndDetailsContainer = dom.append(parent, dom.$('.marker-message-details-container'));

		this._clickModifierKey = this._getClickModifierKey();
	}

	render(element: Marker, filterData: MarkerFilterData | undefined): void {
		this.actionBar.clear();
		this.multilineActionbar.clear();
		this.disposables.clear();
		dom.clearNode(this.messageAndDetailsContainer);

		this.icon.className = `marker-icon codicon ${SeverityIcon.className(MarkerSeverity.toSeverity(element.marker.severity))}`;
		this.renderQuickfixActionbar(element);
		this.renderMultilineActionbar(element);

		this.renderMessageAndDetails(element, filterData);
		this.disposables.add(dom.addDisposableListener(this.parent, dom.EventType.MOUSE_OVER, () => this.markersViewModel.onMarkerMouseHover(element)));
		this.disposables.add(dom.addDisposableListener(this.parent, dom.EventType.MOUSE_LEAVE, () => this.markersViewModel.onMarkerMouseLeave(element)));

		this.disposables.add((this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.multiCursorModifier')) {
				this._clickModifierKey = this._getClickModifierKey();
				if (this._codeLink) {
					this._codeLink.setAttribute('title', this._getCodelinkTooltip());
				}
			}
		})));
	}

	private renderQuickfixActionbar(marker: Marker): void {
		const viewModel = this.markersViewModel.getViewModel(marker);
		if (viewModel) {
			const quickFixAction = viewModel.quickFixAction;
			this.actionBar.push([quickFixAction], { icon: true, label: false });
			this.icon.classList.toggle('quickFix', quickFixAction.enabled);
			quickFixAction.onDidChange(({ enabled }) => {
				if (!isUndefinedOrNull(enabled)) {
					this.icon.classList.toggle('quickFix', enabled);
				}
			}, this, this.disposables);
			quickFixAction.onShowQuickFixes(() => {
				const quickFixActionViewItem = <QuickFixActionViewItem>this.actionBar.viewItems[0];
				if (quickFixActionViewItem) {
					quickFixActionViewItem.showQuickFixes();
				}
			}, this, this.disposables);
		}
	}

	private renderMultilineActionbar(marker: Marker): void {
		const viewModel = this.markersViewModel.getViewModel(marker);
		const multiline = viewModel && viewModel.multiline;
		const action = new Action(toggleMultilineAction);
		action.enabled = !!viewModel && marker.lines.length > 1;
		action.tooltip = multiline ? localize('single line', "Show message in single line") : localize('multi line', "Show message in multiple lines");
		action.class = ThemeIcon.asClassName(multiline ? expandedIcon : collapsedIcon);
		action.run = () => { if (viewModel) { viewModel.multiline = !viewModel.multiline; } return Promise.resolve(); };
		this.multilineActionbar.push([action], { icon: true, label: false });
	}

	private renderMessageAndDetails(element: Marker, filterData: MarkerFilterData | undefined) {
		const { marker, lines } = element;
		const viewState = this.markersViewModel.getViewModel(element);
		const multiline = !viewState || viewState.multiline;
		const lineMatches = filterData && filterData.lineMatches || [];

		let lastLineElement: HTMLElement | undefined = undefined;
		this.messageAndDetailsContainer.title = element.marker.message;
		for (let index = 0; index < (multiline ? lines.length : 1); index++) {
			lastLineElement = dom.append(this.messageAndDetailsContainer, dom.$('.marker-message-line'));
			const messageElement = dom.append(lastLineElement, dom.$('.marker-message'));
			const highlightedLabel = new HighlightedLabel(messageElement, false);
			highlightedLabel.set(lines[index].length > 1000 ? `${lines[index].substring(0, 1000)}...` : lines[index], lineMatches[index]);
			if (lines[index] === '') {
				lastLineElement.style.height = `${VirtualDelegate.LINE_HEIGHT}px`;
			}
		}
		this.renderDetails(marker, filterData, lastLineElement || dom.append(this.messageAndDetailsContainer, dom.$('.marker-message-line')));
	}

	private renderDetails(marker: IMarker, filterData: MarkerFilterData | undefined, parent: HTMLElement): void {
		parent.classList.add('details-container');

		if (marker.source || marker.code) {
			const source = new HighlightedLabel(dom.append(parent, dom.$('.marker-source')), false);
			const sourceMatches = filterData && filterData.sourceMatches || [];
			source.set(marker.source, sourceMatches);

			if (marker.code) {
				if (typeof marker.code === 'string') {
					const code = new HighlightedLabel(dom.append(parent, dom.$('.marker-code')), false);
					const codeMatches = filterData && filterData.codeMatches || [];
					code.set(marker.code, codeMatches);
				} else {
					this._codeLink = dom.$('a.code-link');
					this._codeLink.setAttribute('title', this._getCodelinkTooltip());

					const codeUri = marker.code.target;
					const codeLink = codeUri.toString();

					dom.append(parent, this._codeLink);
					this._codeLink.setAttribute('href', codeLink);
					this._codeLink.tabIndex = 0;

					const onClick = Event.chain(domEvent(this._codeLink, 'click'))
						.filter(e => ((this._clickModifierKey === 'meta' && e.metaKey) || (this._clickModifierKey === 'ctrl' && e.ctrlKey) || (this._clickModifierKey === 'alt' && e.altKey)))
						.event;
					const onEnterPress = Event.chain(domEvent(this._codeLink, 'keydown'))
						.map(e => new StandardKeyboardEvent(e))
						.filter(e => e.keyCode === KeyCode.Enter)
						.event;
					const onOpen = Event.any<dom.EventLike>(onClick, onEnterPress);

					this._register(onOpen(e => {
						dom.EventHelper.stop(e, true);
						this._openerService.open(codeUri, { allowCommands: true });
					}));

					const code = new HighlightedLabel(dom.append(this._codeLink, dom.$('.marker-code')), false);
					const codeMatches = filterData && filterData.codeMatches || [];
					code.set(marker.code.value, codeMatches);
				}
			}
		}

		const lnCol = dom.append(parent, dom.$('span.marker-line'));
		lnCol.textContent = Messages.MARKERS_PANEL_AT_LINE_COL_NUMBER(marker.startLineNumber, marker.startColumn);
	}

	private _getClickModifierKey(): ModifierKey {
		const value = this._configurationService.getValue<'ctrlCmd' | 'alt'>('editor.multiCursorModifier');
		if (value === 'ctrlCmd') {
			return 'alt';
		} else {
			if (OS === OperatingSystem.Macintosh) {
				return 'meta';
			} else {
				return 'ctrl';
			}
		}
	}

	private _getCodelinkTooltip(): string {
		const tooltipLabel = localize('links.navigate.follow', 'Follow link');
		const tooltipKeybinding = this._clickModifierKey === 'ctrl'
			? localize('links.navigate.kb.meta', 'ctrl + click')
			:
			this._clickModifierKey === 'meta'
				? OS === OperatingSystem.Macintosh ? localize('links.navigate.kb.meta.mac', 'cmd + click') : localize('links.navigate.kb.meta', 'ctrl + click')
				: OS === OperatingSystem.Macintosh ? localize('links.navigate.kb.alt.mac', 'option + click') : localize('links.navigate.kb.alt', 'alt + click');

		return `${tooltipLabel} (${tooltipKeybinding})`;
	}
}

export class RelatedInformationRenderer implements ITreeRenderer<RelatedInformation, RelatedInformationFilterData, IRelatedInformationTemplateData> {

	constructor(
		@ILabelService private readonly labelService: ILabelService
	) { }

	templateId = TemplateId.RelatedInformation;

	renderTemplate(container: HTMLElement): IRelatedInformationTemplateData {
		const data: IRelatedInformationTemplateData = Object.create(null);

		dom.append(container, dom.$('.actions'));
		dom.append(container, dom.$('.icon'));

		data.resourceLabel = new HighlightedLabel(dom.append(container, dom.$('.related-info-resource')), false);
		data.lnCol = dom.append(container, dom.$('span.marker-line'));

		const separator = dom.append(container, dom.$('span.related-info-resource-separator'));
		separator.textContent = ':';
		separator.style.paddingRight = '4px';

		data.description = new HighlightedLabel(dom.append(container, dom.$('.marker-description')), false);
		return data;
	}

	renderElement(node: ITreeNode<RelatedInformation, RelatedInformationFilterData>, _: number, templateData: IRelatedInformationTemplateData): void {
		const relatedInformation = node.element.raw;
		const uriMatches = node.filterData && node.filterData.uriMatches || [];
		const messageMatches = node.filterData && node.filterData.messageMatches || [];

		templateData.resourceLabel.set(basename(relatedInformation.resource), uriMatches);
		templateData.resourceLabel.element.title = this.labelService.getUriLabel(relatedInformation.resource, { relative: true });
		templateData.lnCol.textContent = Messages.MARKERS_PANEL_AT_LINE_COL_NUMBER(relatedInformation.startLineNumber, relatedInformation.startColumn);
		templateData.description.set(relatedInformation.message, messageMatches);
		templateData.description.element.title = relatedInformation.message;
	}

	disposeTemplate(templateData: IRelatedInformationTemplateData): void {
		// noop
	}
}

export class Filter implements ITreeFilter<MarkerElement, FilterData> {

	constructor(public options: FilterOptions) { }

	filter(element: MarkerElement, parentVisibility: TreeVisibility): TreeFilterResult<FilterData> {
		if (element instanceof ResourceMarkers) {
			return this.filterResourceMarkers(element);
		} else if (element instanceof Marker) {
			return this.filterMarker(element, parentVisibility);
		} else {
			return this.filterRelatedInformation(element, parentVisibility);
		}
	}

	private filterResourceMarkers(resourceMarkers: ResourceMarkers): TreeFilterResult<FilterData> {
		if (resourceMarkers.resource.scheme === network.Schemas.walkThrough || resourceMarkers.resource.scheme === network.Schemas.walkThroughSnippet) {
			return false;
		}

		// Filter resource by pattern first (globs)
		// Excludes pattern
		if (this.options.excludesMatcher.matches(resourceMarkers.resource)) {
			return false;
		}

		// Includes pattern
		if (this.options.includesMatcher.matches(resourceMarkers.resource)) {
			return true;
		}

		// Fiter by text. Do not apply negated filters on resources instead use exclude patterns
		if (this.options.textFilter.text && !this.options.textFilter.negate) {
			const uriMatches = FilterOptions._filter(this.options.textFilter.text, basename(resourceMarkers.resource));
			if (uriMatches) {
				return { visibility: true, data: { type: FilterDataType.ResourceMarkers, uriMatches: uriMatches || [] } };
			}
		}

		return TreeVisibility.Recurse;
	}

	private filterMarker(marker: Marker, parentVisibility: TreeVisibility): TreeFilterResult<FilterData> {

		const matchesSeverity = this.options.showErrors && MarkerSeverity.Error === marker.marker.severity ||
			this.options.showWarnings && MarkerSeverity.Warning === marker.marker.severity ||
			this.options.showInfos && MarkerSeverity.Info === marker.marker.severity;

		if (!matchesSeverity) {
			return false;
		}

		if (!this.options.textFilter.text) {
			return true;
		}

		const lineMatches: IMatch[][] = [];
		for (const line of marker.lines) {
			const lineMatch = FilterOptions._messageFilter(this.options.textFilter.text, line);
			lineMatches.push(lineMatch || []);
		}

		const sourceMatches = marker.marker.source ? FilterOptions._filter(this.options.textFilter.text, marker.marker.source) : undefined;
		const codeMatches = marker.marker.code ? FilterOptions._filter(this.options.textFilter.text, typeof marker.marker.code === 'string' ? marker.marker.code : marker.marker.code.value) : undefined;
		const matched = sourceMatches || codeMatches || lineMatches.some(lineMatch => lineMatch.length > 0);

		// Matched and not negated
		if (matched && !this.options.textFilter.negate) {
			return { visibility: true, data: { type: FilterDataType.Marker, lineMatches, sourceMatches: sourceMatches || [], codeMatches: codeMatches || [] } };
		}

		// Matched and negated - exclude it only if parent visibility is not set
		if (matched && this.options.textFilter.negate && parentVisibility === TreeVisibility.Recurse) {
			return false;
		}

		// Not matched and negated - include it only if parent visibility is not set
		if (!matched && this.options.textFilter.negate && parentVisibility === TreeVisibility.Recurse) {
			return true;
		}

		return parentVisibility;
	}

	private filterRelatedInformation(relatedInformation: RelatedInformation, parentVisibility: TreeVisibility): TreeFilterResult<FilterData> {
		if (!this.options.textFilter.text) {
			return true;
		}

		const uriMatches = FilterOptions._filter(this.options.textFilter.text, basename(relatedInformation.raw.resource));
		const messageMatches = FilterOptions._messageFilter(this.options.textFilter.text, paths.basename(relatedInformation.raw.message));
		const matched = uriMatches || messageMatches;

		// Matched and not negated
		if (matched && !this.options.textFilter.negate) {
			return { visibility: true, data: { type: FilterDataType.RelatedInformation, uriMatches: uriMatches || [], messageMatches: messageMatches || [] } };
		}

		// Matched and negated - exclude it only if parent visibility is not set
		if (matched && this.options.textFilter.negate && parentVisibility === TreeVisibility.Recurse) {
			return false;
		}

		// Not matched and negated - include it only if parent visibility is not set
		if (!matched && this.options.textFilter.negate && parentVisibility === TreeVisibility.Recurse) {
			return true;
		}

		return parentVisibility;
	}
}

export class MarkerViewModel extends Disposable {

	private readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private modelPromise: CancelablePromise<ITextModel> | null = null;
	private codeActionsPromise: CancelablePromise<CodeActionSet> | null = null;

	constructor(
		private readonly marker: Marker,
		@IModelService private modelService: IModelService,
		@IInstantiationService private instantiationService: IInstantiationService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super();
		this._register(toDisposable(() => {
			if (this.modelPromise) {
				this.modelPromise.cancel();
			}
			if (this.codeActionsPromise) {
				this.codeActionsPromise.cancel();
			}
		}));
	}

	private _multiline: boolean = true;
	get multiline(): boolean {
		return this._multiline;
	}

	set multiline(value: boolean) {
		if (this._multiline !== value) {
			this._multiline = value;
			this._onDidChange.fire();
		}
	}

	private _quickFixAction: QuickFixAction | null = null;
	get quickFixAction(): QuickFixAction {
		if (!this._quickFixAction) {
			this._quickFixAction = this._register(this.instantiationService.createInstance(QuickFixAction, this.marker));
		}
		return this._quickFixAction;
	}

	showLightBulb(): void {
		this.setQuickFixes(true);
	}

	showQuickfixes(): void {
		this.setQuickFixes(false).then(() => this.quickFixAction.run());
	}

	async getQuickFixes(waitForModel: boolean): Promise<IAction[]> {
		const codeActions = await this.getCodeActions(waitForModel);
		return codeActions ? this.toActions(codeActions) : [];
	}

	private async setQuickFixes(waitForModel: boolean): Promise<void> {
		const codeActions = await this.getCodeActions(waitForModel);
		this.quickFixAction.quickFixes = codeActions ? this.toActions(codeActions) : [];
		this.quickFixAction.autoFixable(!!codeActions && codeActions.hasAutoFix);
	}

	private getCodeActions(waitForModel: boolean): Promise<CodeActionSet | null> {
		if (this.codeActionsPromise !== null) {
			return this.codeActionsPromise;
		}
		return this.getModel(waitForModel)
			.then<CodeActionSet | null>(model => {
				if (model) {
					if (!this.codeActionsPromise) {
						this.codeActionsPromise = createCancelablePromise(cancellationToken => {
							return getCodeActions(model, new Range(this.marker.range.startLineNumber, this.marker.range.startColumn, this.marker.range.endLineNumber, this.marker.range.endColumn), {
								type: CodeActionTriggerType.Invoke, filter: { include: CodeActionKind.QuickFix }
							}, Progress.None, cancellationToken).then(actions => {
								return this._register(actions);
							});
						});
					}
					return this.codeActionsPromise;
				}
				return null;
			});
	}

	private toActions(codeActions: CodeActionSet): IAction[] {
		return codeActions.validActions.map(item => new Action(
			item.action.command ? item.action.command.id : item.action.title,
			item.action.title,
			undefined,
			true,
			() => {
				return this.openFileAtMarker(this.marker)
					.then(() => this.instantiationService.invokeFunction(applyCodeAction, item));
			}));
	}

	private openFileAtMarker(element: Marker): Promise<void> {
		const { resource, selection } = { resource: element.resource, selection: element.range };
		return this.editorService.openEditor({
			resource,
			options: {
				selection,
				preserveFocus: true,
				pinned: false,
				revealIfVisible: true
			},
		}, ACTIVE_GROUP).then(() => undefined);
	}

	private getModel(waitForModel: boolean): Promise<ITextModel | null> {
		const model = this.modelService.getModel(this.marker.resource);
		if (model) {
			return Promise.resolve(model);
		}
		if (waitForModel) {
			if (!this.modelPromise) {
				this.modelPromise = createCancelablePromise(cancellationToken => {
					return new Promise((c) => {
						this._register(this.modelService.onModelAdded(model => {
							if (isEqual(model.uri, this.marker.resource)) {
								c(model);
							}
						}));
					});
				});
			}
			return this.modelPromise;
		}
		return Promise.resolve(null);
	}

}

export class MarkersViewModel extends Disposable {

	private readonly _onDidChange: Emitter<Marker | undefined> = this._register(new Emitter<Marker | undefined>());
	readonly onDidChange: Event<Marker | undefined> = this._onDidChange.event;

	private readonly markersViewStates: Map<string, { viewModel: MarkerViewModel, disposables: IDisposable[] }> = new Map<string, { viewModel: MarkerViewModel, disposables: IDisposable[] }>();
	private readonly markersPerResource: Map<string, Marker[]> = new Map<string, Marker[]>();

	private bulkUpdate: boolean = false;

	private hoveredMarker: Marker | null = null;
	private hoverDelayer: Delayer<void> = new Delayer<void>(300);

	constructor(
		multiline: boolean = true,
		@IInstantiationService private instantiationService: IInstantiationService
	) {
		super();
		this._multiline = multiline;
	}

	add(marker: Marker): void {
		if (!this.markersViewStates.has(marker.id)) {
			const viewModel = this.instantiationService.createInstance(MarkerViewModel, marker);
			const disposables: IDisposable[] = [viewModel];
			viewModel.multiline = this.multiline;
			viewModel.onDidChange(() => {
				if (!this.bulkUpdate) {
					this._onDidChange.fire(marker);
				}
			}, this, disposables);
			this.markersViewStates.set(marker.id, { viewModel, disposables });

			const markers = this.markersPerResource.get(marker.resource.toString()) || [];
			markers.push(marker);
			this.markersPerResource.set(marker.resource.toString(), markers);
		}
	}

	remove(resource: URI): void {
		const markers = this.markersPerResource.get(resource.toString()) || [];
		for (const marker of markers) {
			const value = this.markersViewStates.get(marker.id);
			if (value) {
				dispose(value.disposables);
			}
			this.markersViewStates.delete(marker.id);
			if (this.hoveredMarker === marker) {
				this.hoveredMarker = null;
			}
		}
		this.markersPerResource.delete(resource.toString());
	}

	getViewModel(marker: Marker): MarkerViewModel | null {
		const value = this.markersViewStates.get(marker.id);
		return value ? value.viewModel : null;
	}

	onMarkerMouseHover(marker: Marker): void {
		this.hoveredMarker = marker;
		this.hoverDelayer.trigger(() => {
			if (this.hoveredMarker) {
				const model = this.getViewModel(this.hoveredMarker);
				if (model) {
					model.showLightBulb();
				}
			}
		});
	}

	onMarkerMouseLeave(marker: Marker): void {
		if (this.hoveredMarker === marker) {
			this.hoveredMarker = null;
		}
	}

	private _multiline: boolean = true;
	get multiline(): boolean {
		return this._multiline;
	}

	set multiline(value: boolean) {
		let changed = false;
		if (this._multiline !== value) {
			this._multiline = value;
			changed = true;
		}
		this.bulkUpdate = true;
		this.markersViewStates.forEach(({ viewModel }) => {
			if (viewModel.multiline !== value) {
				viewModel.multiline = value;
				changed = true;
			}
		});
		this.bulkUpdate = false;
		if (changed) {
			this._onDidChange.fire(undefined);
		}
	}

	override dispose(): void {
		this.markersViewStates.forEach(({ disposables }) => dispose(disposables));
		this.markersViewStates.clear();
		this.markersPerResource.clear();
		super.dispose();
	}

}

export class ResourceDragAndDrop implements ITreeDragAndDrop<MarkerElement> {
	constructor(
		private instantiationService: IInstantiationService
	) { }

	onDragOver(data: IDragAndDropData, targetElement: MarkerElement, targetIndex: number, originalEvent: DragEvent): boolean | ITreeDragOverReaction {
		return false;
	}

	getDragURI(element: MarkerElement): string | null {
		if (element instanceof ResourceMarkers) {
			return element.resource.toString();
		}
		return null;
	}

	getDragLabel?(elements: MarkerElement[]): string | undefined {
		if (elements.length > 1) {
			return String(elements.length);
		}
		const element = elements[0];
		return element instanceof ResourceMarkers ? basename(element.resource) : undefined;
	}

	onDragStart(data: IDragAndDropData, originalEvent: DragEvent): void {
		const elements = (data as ElementsDragAndDropData<MarkerElement>).elements;
		const resources: URI[] = elements
			.filter(e => e instanceof ResourceMarkers)
			.map(resourceMarker => (resourceMarker as ResourceMarkers).resource);

		if (resources.length) {
			// Apply some datatransfer types to allow for dragging the element outside of the application
			this.instantiationService.invokeFunction(fillResourceDataTransfers, resources, undefined, originalEvent);
		}
	}

	drop(data: IDragAndDropData, targetElement: MarkerElement, targetIndex: number, originalEvent: DragEvent): void {
	}
}

registerThemingParticipant((theme, collector) => {
	const linkFg = theme.getColor(textLinkForeground);
	if (linkFg) {
		collector.addRule(`.markers-panel .markers-panel-container .tree-container .monaco-tl-contents .details-container a.code-link .marker-code > span:hover { color: ${linkFg}; }`);
		collector.addRule(`.markers-panel .markers-panel-container .tree-container .monaco-list:focus .monaco-tl-contents .details-container a.code-link .marker-code > span:hover { color: inherit; }`);
	}
});
