/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Delayer } from 'vs/base/common/async';
import * as DOM from 'vs/base/browser/dom';
import { Action, IAction, IActionRunner, Separator } from 'vs/base/common/actions';
import { HistoryInputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { KeyCode } from 'vs/base/common/keyCodes';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { IContextViewService, IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import Messages from 'vs/workbench/contrib/markers/browser/messages';
import Constants from 'vs/workbench/contrib/markers/browser/constants';
import { IThemeService, registerThemingParticipant, ICssStyleCollector, IColorTheme, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { attachInputBoxStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { toDisposable, Disposable } from 'vs/base/common/lifecycle';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { badgeBackground, badgeForeground, contrastBorder, inputActiveOptionBorder, inputActiveOptionBackground, inputActiveOptionForeground } from 'vs/platform/theme/common/colorRegistry';
import { localize } from 'vs/nls';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ContextScopedHistoryInputBox } from 'vs/platform/browser/contextScopedHistoryWidget';
import { Marker } from 'vs/workbench/contrib/markers/browser/markersModel';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Event, Emitter } from 'vs/base/common/event';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { Codicon } from 'vs/base/common/codicons';
import { BaseActionViewItem, ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { DropdownMenuActionViewItem } from 'vs/base/browser/ui/dropdown/dropdownActionViewItem';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { IMarkersView } from 'vs/workbench/contrib/markers/browser/markers';

export interface IMarkersFiltersChangeEvent {
	filterText?: boolean;
	excludedFiles?: boolean;
	showWarnings?: boolean;
	showErrors?: boolean;
	showInfos?: boolean;
	activeFile?: boolean;
	layout?: boolean;
}

export interface IMarkersFiltersOptions {
	filterText: string;
	filterHistory: string[];
	showErrors: boolean;
	showWarnings: boolean;
	showInfos: boolean;
	excludedFiles: boolean;
	activeFile: boolean;
	layout: DOM.Dimension;
}

export class MarkersFilters extends Disposable {

	private readonly _onDidChange: Emitter<IMarkersFiltersChangeEvent> = this._register(new Emitter<IMarkersFiltersChangeEvent>());
	readonly onDidChange: Event<IMarkersFiltersChangeEvent> = this._onDidChange.event;

	constructor(options: IMarkersFiltersOptions) {
		super();
		this._filterText = options.filterText;
		this._showErrors = options.showErrors;
		this._showWarnings = options.showWarnings;
		this._showInfos = options.showInfos;
		this._excludedFiles = options.excludedFiles;
		this._activeFile = options.activeFile;
		this.filterHistory = options.filterHistory;
		this._layout = options.layout;
	}

	private _filterText: string;
	get filterText(): string {
		return this._filterText;
	}
	set filterText(filterText: string) {
		if (this._filterText !== filterText) {
			this._filterText = filterText;
			this._onDidChange.fire({ filterText: true });
		}
	}

	filterHistory: string[];

	private _excludedFiles: boolean;
	get excludedFiles(): boolean {
		return this._excludedFiles;
	}
	set excludedFiles(filesExclude: boolean) {
		if (this._excludedFiles !== filesExclude) {
			this._excludedFiles = filesExclude;
			this._onDidChange.fire(<IMarkersFiltersChangeEvent>{ excludedFiles: true });
		}
	}

	private _activeFile: boolean;
	get activeFile(): boolean {
		return this._activeFile;
	}
	set activeFile(activeFile: boolean) {
		if (this._activeFile !== activeFile) {
			this._activeFile = activeFile;
			this._onDidChange.fire(<IMarkersFiltersChangeEvent>{ activeFile: true });
		}
	}

	private _showWarnings: boolean = true;
	get showWarnings(): boolean {
		return this._showWarnings;
	}
	set showWarnings(showWarnings: boolean) {
		if (this._showWarnings !== showWarnings) {
			this._showWarnings = showWarnings;
			this._onDidChange.fire(<IMarkersFiltersChangeEvent>{ showWarnings: true });
		}
	}

	private _showErrors: boolean = true;
	get showErrors(): boolean {
		return this._showErrors;
	}
	set showErrors(showErrors: boolean) {
		if (this._showErrors !== showErrors) {
			this._showErrors = showErrors;
			this._onDidChange.fire(<IMarkersFiltersChangeEvent>{ showErrors: true });
		}
	}

	private _showInfos: boolean = true;
	get showInfos(): boolean {
		return this._showInfos;
	}
	set showInfos(showInfos: boolean) {
		if (this._showInfos !== showInfos) {
			this._showInfos = showInfos;
			this._onDidChange.fire(<IMarkersFiltersChangeEvent>{ showInfos: true });
		}
	}

	private _layout: DOM.Dimension = new DOM.Dimension(0, 0);
	get layout(): DOM.Dimension {
		return this._layout;
	}
	set layout(layout: DOM.Dimension) {
		if (this._layout.width !== layout.width || this._layout.height !== layout.height) {
			this._layout = layout;
			this._onDidChange.fire(<IMarkersFiltersChangeEvent>{ layout: true });
		}
	}
}

class FiltersDropdownMenuActionViewItem extends DropdownMenuActionViewItem {

	constructor(
		action: IAction, private filters: MarkersFilters, actionRunner: IActionRunner,
		@IContextMenuService contextMenuService: IContextMenuService
	) {
		super(action,
			{ getActions: () => this.getActions() },
			contextMenuService,
			{
				actionRunner,
				classNames: action.class,
				anchorAlignmentProvider: () => AnchorAlignment.RIGHT,
				menuAsChild: true
			}
		);
	}

	override render(container: HTMLElement): void {
		super.render(container);
		this.updateChecked();
	}

	private getActions(): IAction[] {
		return [
			{
				checked: this.filters.showErrors,
				class: undefined,
				enabled: true,
				id: 'showErrors',
				label: Messages.MARKERS_PANEL_FILTER_LABEL_SHOW_ERRORS,
				run: async () => this.filters.showErrors = !this.filters.showErrors,
				tooltip: '',
				dispose: () => null
			},
			{
				checked: this.filters.showWarnings,
				class: undefined,
				enabled: true,
				id: 'showWarnings',
				label: Messages.MARKERS_PANEL_FILTER_LABEL_SHOW_WARNINGS,
				run: async () => this.filters.showWarnings = !this.filters.showWarnings,
				tooltip: '',
				dispose: () => null
			},
			{
				checked: this.filters.showInfos,
				class: undefined,
				enabled: true,
				id: 'showInfos',
				label: Messages.MARKERS_PANEL_FILTER_LABEL_SHOW_INFOS,
				run: async () => this.filters.showInfos = !this.filters.showInfos,
				tooltip: '',
				dispose: () => null
			},
			new Separator(),
			{
				checked: this.filters.activeFile,
				class: undefined,
				enabled: true,
				id: 'activeFile',
				label: Messages.MARKERS_PANEL_FILTER_LABEL_ACTIVE_FILE,
				run: async () => this.filters.activeFile = !this.filters.activeFile,
				tooltip: '',
				dispose: () => null
			},
			{
				checked: this.filters.excludedFiles,
				class: undefined,
				enabled: true,
				id: 'useFilesExclude',
				label: Messages.MARKERS_PANEL_FILTER_LABEL_EXCLUDED_FILES,
				run: async () => this.filters.excludedFiles = !this.filters.excludedFiles,
				tooltip: '',
				dispose: () => null
			},
		];
	}

	override updateChecked(): void {
		this.element!.classList.toggle('checked', this._action.checked);
	}

}


const filterIcon = registerIcon('markers-view-filter', Codicon.filter, localize('filterIcon', 'Icon for the filter configuration in the markers view.'));

export class MarkersFilterActionViewItem extends BaseActionViewItem {

	private delayedFilterUpdate: Delayer<void>;
	private container: HTMLElement | null = null;
	private filterInputBox: HistoryInputBox | null = null;
	private filterBadge: HTMLElement | null = null;
	private focusContextKey: IContextKey<boolean>;
	private readonly filtersAction: IAction;
	private actionbar: ActionBar | null = null;

	constructor(
		action: IAction,
		private markersView: IMarkersView,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly themeService: IThemeService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		super(null, action);
		this.focusContextKey = Constants.MarkerViewFilterFocusContextKey.bindTo(contextKeyService);
		this.delayedFilterUpdate = new Delayer<void>(400);
		this._register(toDisposable(() => this.delayedFilterUpdate.cancel()));
		this._register(markersView.onDidFocusFilter(() => this.focus()));
		this._register(markersView.onDidClearFilterText(() => this.clearFilterText()));
		this.filtersAction = new Action('markersFiltersAction', Messages.MARKERS_PANEL_ACTION_TOOLTIP_MORE_FILTERS, 'markers-filters ' + ThemeIcon.asClassName(filterIcon));
		this.filtersAction.checked = this.hasFiltersChanged();
		this._register(markersView.filters.onDidChange(e => this.onDidFiltersChange(e)));
	}

	override render(container: HTMLElement): void {
		this.container = container;
		this.container.classList.add('markers-panel-action-filter-container');

		this.element = DOM.append(this.container, DOM.$(''));
		this.element.className = this.class;
		this.createInput(this.element);
		this.createControls(this.element);
		this.updateClass();

		this.adjustInputBox();
	}

	override focus(): void {
		if (this.filterInputBox) {
			this.filterInputBox.focus();
		}
	}

	override blur(): void {
		if (this.filterInputBox) {
			this.filterInputBox.blur();
		}
	}

	override setFocusable(): void {
		// noop input elements are focusable by default
	}

	override get trapsArrowNavigation(): boolean {
		return true;
	}

	private clearFilterText(): void {
		if (this.filterInputBox) {
			this.filterInputBox.value = '';
		}
	}

	private onDidFiltersChange(e: IMarkersFiltersChangeEvent): void {
		this.filtersAction.checked = this.hasFiltersChanged();
		if (e.layout) {
			this.updateClass();
		}
	}

	private hasFiltersChanged(): boolean {
		return !this.markersView.filters.showErrors || !this.markersView.filters.showWarnings || !this.markersView.filters.showInfos || this.markersView.filters.excludedFiles || this.markersView.filters.activeFile;
	}

	private createInput(container: HTMLElement): void {
		this.filterInputBox = this._register(this.instantiationService.createInstance(ContextScopedHistoryInputBox, container, this.contextViewService, {
			placeholder: Messages.MARKERS_PANEL_FILTER_PLACEHOLDER,
			ariaLabel: Messages.MARKERS_PANEL_FILTER_ARIA_LABEL,
			history: this.markersView.filters.filterHistory
		}));
		this._register(attachInputBoxStyler(this.filterInputBox, this.themeService));
		this.filterInputBox.value = this.markersView.filters.filterText;
		this._register(this.filterInputBox.onDidChange(filter => this.delayedFilterUpdate.trigger(() => this.onDidInputChange(this.filterInputBox!))));
		this._register(this.markersView.filters.onDidChange((event: IMarkersFiltersChangeEvent) => {
			if (event.filterText) {
				this.filterInputBox!.value = this.markersView.filters.filterText;
			}
		}));
		this._register(DOM.addStandardDisposableListener(this.filterInputBox.inputElement, DOM.EventType.KEY_DOWN, (e: any) => this.onInputKeyDown(e, this.filterInputBox!)));
		this._register(DOM.addStandardDisposableListener(container, DOM.EventType.KEY_DOWN, this.handleKeyboardEvent));
		this._register(DOM.addStandardDisposableListener(container, DOM.EventType.KEY_UP, this.handleKeyboardEvent));
		this._register(DOM.addStandardDisposableListener(this.filterInputBox.inputElement, DOM.EventType.CLICK, (e) => {
			e.stopPropagation();
			e.preventDefault();
		}));

		const focusTracker = this._register(DOM.trackFocus(this.filterInputBox.inputElement));
		this._register(focusTracker.onDidFocus(() => this.focusContextKey.set(true)));
		this._register(focusTracker.onDidBlur(() => this.focusContextKey.set(false)));
		this._register(toDisposable(() => this.focusContextKey.reset()));
	}

	private createControls(container: HTMLElement): void {
		const controlsContainer = DOM.append(container, DOM.$('.markers-panel-filter-controls'));
		this.createBadge(controlsContainer);
		this.createFilters(controlsContainer);
	}

	private createBadge(container: HTMLElement): void {
		const filterBadge = this.filterBadge = DOM.append(container, DOM.$('.markers-panel-filter-badge'));
		this._register(attachStylerCallback(this.themeService, { badgeBackground, badgeForeground, contrastBorder }, colors => {
			const background = colors.badgeBackground ? colors.badgeBackground.toString() : '';
			const foreground = colors.badgeForeground ? colors.badgeForeground.toString() : '';
			const border = colors.contrastBorder ? colors.contrastBorder.toString() : '';

			filterBadge.style.backgroundColor = background;

			filterBadge.style.borderWidth = border ? '1px' : '';
			filterBadge.style.borderStyle = border ? 'solid' : '';
			filterBadge.style.borderColor = border;
			filterBadge.style.color = foreground;
		}));
		this.updateBadge();
		this._register(this.markersView.onDidChangeFilterStats(() => this.updateBadge()));
	}

	private createFilters(container: HTMLElement): void {
		this.actionbar = this._register(new ActionBar(container, {
			actionViewItemProvider: action => {
				if (action.id === this.filtersAction.id) {
					return this.instantiationService.createInstance(FiltersDropdownMenuActionViewItem, action, this.markersView.filters, this.actionRunner);
				}
				return undefined;
			}
		}));
		this.actionbar.push(this.filtersAction, { icon: true, label: false });
	}

	private onDidInputChange(inputbox: HistoryInputBox) {
		inputbox.addToHistory();
		this.markersView.filters.filterText = inputbox.value;
		this.markersView.filters.filterHistory = inputbox.getHistory();
	}

	private updateBadge(): void {
		if (this.filterBadge) {
			const { total, filtered } = this.markersView.getFilterStats();
			this.filterBadge.classList.toggle('hidden', total === filtered || total === 0);
			this.filterBadge.textContent = localize('showing filtered problems', "Showing {0} of {1}", filtered, total);
			this.adjustInputBox();
		}
	}

	private adjustInputBox(): void {
		if (this.element && this.filterInputBox && this.filterBadge) {
			this.filterInputBox.inputElement.style.paddingRight = this.element.classList.contains('small') || this.filterBadge.classList.contains('hidden') ? '25px' : '150px';
		}
	}

	// Action toolbar is swallowing some keys for action items which should not be for an input box
	private handleKeyboardEvent(event: StandardKeyboardEvent) {
		if (event.equals(KeyCode.Space)
			|| event.equals(KeyCode.LeftArrow)
			|| event.equals(KeyCode.RightArrow)
			|| event.equals(KeyCode.Escape)
		) {
			event.stopPropagation();
		}
	}

	private onInputKeyDown(event: StandardKeyboardEvent, filterInputBox: HistoryInputBox) {
		let handled = false;
		if (event.equals(KeyCode.Escape)) {
			this.clearFilterText();
			handled = true;
		}
		if (event.equals(KeyCode.Tab)) {
			this.actionbar?.focus();
			handled = true;
		}
		if (handled) {
			event.stopPropagation();
			event.preventDefault();
		}
	}

	protected override updateClass(): void {
		if (this.element && this.container) {
			this.element.className = this.class;
			this.container.classList.toggle('grow', this.element.classList.contains('grow'));
			this.adjustInputBox();
		}
	}

	protected get class(): string {
		if (this.markersView.filters.layout.width > 600) {
			return 'markers-panel-action-filter grow';
		} else if (this.markersView.filters.layout.width < 400) {
			return 'markers-panel-action-filter small';
		} else {
			return 'markers-panel-action-filter';
		}
	}
}

export class QuickFixAction extends Action {

	public static readonly ID: string = 'workbench.actions.problems.quickfix';
	private static readonly CLASS: string = 'markers-panel-action-quickfix ' + Codicon.lightBulb.classNames;
	private static readonly AUTO_FIX_CLASS: string = QuickFixAction.CLASS + ' autofixable';

	private readonly _onShowQuickFixes = this._register(new Emitter<void>());
	readonly onShowQuickFixes: Event<void> = this._onShowQuickFixes.event;

	private _quickFixes: IAction[] = [];
	get quickFixes(): IAction[] {
		return this._quickFixes;
	}
	set quickFixes(quickFixes: IAction[]) {
		this._quickFixes = quickFixes;
		this.enabled = this._quickFixes.length > 0;
	}

	autoFixable(autofixable: boolean) {
		this.class = autofixable ? QuickFixAction.AUTO_FIX_CLASS : QuickFixAction.CLASS;
	}

	constructor(
		readonly marker: Marker,
	) {
		super(QuickFixAction.ID, Messages.MARKERS_PANEL_ACTION_TOOLTIP_QUICKFIX, QuickFixAction.CLASS, false);
	}

	override run(): Promise<void> {
		this._onShowQuickFixes.fire();
		return Promise.resolve();
	}
}

export class QuickFixActionViewItem extends ActionViewItem {

	constructor(action: QuickFixAction,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
	) {
		super(null, action, { icon: true, label: false });
	}

	public override onClick(event: DOM.EventLike): void {
		DOM.EventHelper.stop(event, true);
		this.showQuickFixes();
	}

	public showQuickFixes(): void {
		if (!this.element) {
			return;
		}
		if (!this.isEnabled()) {
			return;
		}
		const elementPosition = DOM.getDomNodePagePosition(this.element);
		const quickFixes = (<QuickFixAction>this.getAction()).quickFixes;
		if (quickFixes.length) {
			this.contextMenuService.showContextMenu({
				getAnchor: () => ({ x: elementPosition.left + 10, y: elementPosition.top + elementPosition.height + 4 }),
				getActions: () => quickFixes
			});
		}
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
	const inputActiveOptionBorderColor = theme.getColor(inputActiveOptionBorder);
	if (inputActiveOptionBorderColor) {
		collector.addRule(`.markers-panel-action-filter > .markers-panel-filter-controls > .monaco-action-bar .action-label.markers-filters.checked { border-color: ${inputActiveOptionBorderColor}; }`);
	}
	const inputActiveOptionForegroundColor = theme.getColor(inputActiveOptionForeground);
	if (inputActiveOptionForegroundColor) {
		collector.addRule(`.markers-panel-action-filter > .markers-panel-filter-controls > .monaco-action-bar .action-label.markers-filters.checked { color: ${inputActiveOptionForegroundColor}; }`);
	}
	const inputActiveOptionBackgroundColor = theme.getColor(inputActiveOptionBackground);
	if (inputActiveOptionBackgroundColor) {
		collector.addRule(`.markers-panel-action-filter > .markers-panel-filter-controls > .monaco-action-bar .action-label.markers-filters.checked { background-color: ${inputActiveOptionBackgroundColor}; }`);
	}
});
