/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { matchesFuzzy } from 'vs/base/common/filters';
import { splitGlobAware } from 'vs/base/common/glob';
import { ITreeFilter, TreeVisibility, TreeFilterResult } from 'vs/base/browser/ui/tree/tree';
import { IReplElement } from 'vs/workbench/contrib/debug/common/debug';
import * as DOM from 'vs/base/browser/dom';
import { BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { Delayer } from 'vs/base/common/async';
import { IAction } from 'vs/base/common/actions';
import { HistoryInputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { toDisposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ContextScopedHistoryInputBox } from 'vs/platform/browser/contextScopedHistoryWidget';
import { attachInputBoxStyler, attachStylerCallback } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { badgeBackground, badgeForeground, contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { ReplEvaluationResult, ReplEvaluationInput } from 'vs/workbench/contrib/debug/common/replModel';
import { localize } from 'vs/nls';
import { Variable } from 'vs/workbench/contrib/debug/common/debugModel';


type ParsedQuery = {
	type: 'include' | 'exclude',
	query: string,
};

export class ReplFilter implements ITreeFilter<IReplElement> {

	static matchQuery = matchesFuzzy;

	private _parsedQueries: ParsedQuery[] = [];
	set filterQuery(query: string) {
		this._parsedQueries = [];
		query = query.trim();

		if (query && query !== '') {
			const filters = splitGlobAware(query, ',').map(s => s.trim()).filter(s => !!s.length);
			for (const f of filters) {
				if (f.startsWith('!')) {
					this._parsedQueries.push({ type: 'exclude', query: f.slice(1) });
				} else {
					this._parsedQueries.push({ type: 'include', query: f });
				}
			}
		}
	}

	filter(element: IReplElement, parentVisibility: TreeVisibility): TreeFilterResult<void> {
		if (element instanceof ReplEvaluationInput || element instanceof ReplEvaluationResult || element instanceof Variable) {
			// Only filter the output events, everything else is visible https://github.com/microsoft/vscode/issues/105863
			return TreeVisibility.Visible;
		}

		let includeQueryPresent = false;
		let includeQueryMatched = false;

		const text = element.toString(true);

		for (let { type, query } of this._parsedQueries) {
			if (type === 'exclude' && ReplFilter.matchQuery(query, text)) {
				// If exclude query matches, ignore all other queries and hide
				return false;
			} else if (type === 'include') {
				includeQueryPresent = true;
				if (ReplFilter.matchQuery(query, text)) {
					includeQueryMatched = true;
				}
			}
		}

		return includeQueryPresent ? includeQueryMatched : (typeof parentVisibility !== 'undefined' ? parentVisibility : TreeVisibility.Visible);
	}
}

export interface IFilterStatsProvider {
	getFilterStats(): { total: number, filtered: number };
}

export class ReplFilterState {

	constructor(private filterStatsProvider: IFilterStatsProvider) { }

	private readonly _onDidChange: Emitter<void> = new Emitter<void>();
	get onDidChange(): Event<void> {
		return this._onDidChange.event;
	}

	private readonly _onDidStatsChange: Emitter<void> = new Emitter<void>();
	get onDidStatsChange(): Event<void> {
		return this._onDidStatsChange.event;
	}

	private _filterText = '';
	private _stats = { total: 0, filtered: 0 };

	get filterText(): string {
		return this._filterText;
	}

	get filterStats(): { total: number, filtered: number } {
		return this._stats;
	}

	set filterText(filterText: string) {
		if (this._filterText !== filterText) {
			this._filterText = filterText;
			this._onDidChange.fire();
			this.updateFilterStats();
		}
	}

	updateFilterStats(): void {
		const { total, filtered } = this.filterStatsProvider.getFilterStats();
		if (this._stats.total !== total || this._stats.filtered !== filtered) {
			this._stats = { total, filtered };
			this._onDidStatsChange.fire();
		}
	}
}

export class ReplFilterActionViewItem extends BaseActionViewItem {

	private delayedFilterUpdate: Delayer<void>;
	private container!: HTMLElement;
	private filterBadge!: HTMLElement;
	private filterInputBox!: HistoryInputBox;

	constructor(
		action: IAction,
		private placeholder: string,
		private filters: ReplFilterState,
		private history: string[],
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IThemeService private readonly themeService: IThemeService,
		@IContextViewService private readonly contextViewService: IContextViewService) {
		super(null, action);
		this.delayedFilterUpdate = new Delayer<void>(400);
		this._register(toDisposable(() => this.delayedFilterUpdate.cancel()));
	}

	override render(container: HTMLElement): void {
		this.container = container;
		this.container.classList.add('repl-panel-filter-container');

		this.element = DOM.append(this.container, DOM.$(''));
		this.element.className = this.class;
		this.createInput(this.element);
		this.createBadge(this.element);
		this.updateClass();
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

	getHistory(): string[] {
		return this.filterInputBox.getHistory();
	}

	override get trapsArrowNavigation(): boolean {
		return true;
	}

	private clearFilterText(): void {
		this.filterInputBox.value = '';
	}

	private createInput(container: HTMLElement): void {
		this.filterInputBox = this._register(this.instantiationService.createInstance(ContextScopedHistoryInputBox, container, this.contextViewService, {
			placeholder: this.placeholder,
			history: this.history
		}));
		this._register(attachInputBoxStyler(this.filterInputBox, this.themeService));
		this.filterInputBox.value = this.filters.filterText;

		this._register(this.filterInputBox.onDidChange(() => this.delayedFilterUpdate.trigger(() => this.onDidInputChange(this.filterInputBox!))));
		this._register(this.filters.onDidChange(() => {
			this.filterInputBox.value = this.filters.filterText;
		}));
		this._register(DOM.addStandardDisposableListener(this.filterInputBox.inputElement, DOM.EventType.KEY_DOWN, (e: any) => this.onInputKeyDown(e)));
		this._register(DOM.addStandardDisposableListener(container, DOM.EventType.KEY_DOWN, this.handleKeyboardEvent));
		this._register(DOM.addStandardDisposableListener(container, DOM.EventType.KEY_UP, this.handleKeyboardEvent));
		this._register(DOM.addStandardDisposableListener(this.filterInputBox.inputElement, DOM.EventType.CLICK, (e) => {
			e.stopPropagation();
			e.preventDefault();
		}));
	}

	private onDidInputChange(inputbox: HistoryInputBox) {
		inputbox.addToHistory();
		this.filters.filterText = inputbox.value;
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

	private onInputKeyDown(event: StandardKeyboardEvent) {
		if (event.equals(KeyCode.Escape)) {
			this.clearFilterText();
			event.stopPropagation();
			event.preventDefault();
		}
	}

	private createBadge(container: HTMLElement): void {
		const controlsContainer = DOM.append(container, DOM.$('.repl-panel-filter-controls'));
		const filterBadge = this.filterBadge = DOM.append(controlsContainer, DOM.$('.repl-panel-filter-badge'));
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
		this._register(this.filters.onDidStatsChange(() => this.updateBadge()));
	}

	private updateBadge(): void {
		const { total, filtered } = this.filters.filterStats;
		const filterBadgeHidden = total === filtered || total === 0;

		this.filterBadge.classList.toggle('hidden', filterBadgeHidden);
		this.filterBadge.textContent = localize('showing filtered repl lines', "Showing {0} of {1}", filtered, total);
		this.filterInputBox.inputElement.style.paddingRight = filterBadgeHidden ? '4px' : '150px';
	}

	protected get class(): string {
		return 'panel-action-tree-filter';
	}
}
