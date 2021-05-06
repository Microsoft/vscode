/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { BaseActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { DropdownMenuActionViewItem } from 'vs/base/browser/ui/dropdown/dropdownActionViewItem';
import { HistoryInputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { Action, IAction, IActionRunner, Separator } from 'vs/base/common/actions';
import { Delayer } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { KeyCode } from 'vs/base/common/keyCodes';
import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { ContextScopedHistoryInputBox } from 'vs/platform/browser/contextScopedHistoryWidget';
import { ContextKeyEqualsExpr, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { attachInputBoxStyler } from 'vs/platform/theme/common/styler';
import { IThemeService, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ViewContainerLocation } from 'vs/workbench/common/views';
import { testingFilterIcon } from 'vs/workbench/contrib/testing/browser/icons';
import { TestExplorerStateFilter, Testing } from 'vs/workbench/contrib/testing/common/constants';
import { MutableObservableValue } from 'vs/workbench/contrib/testing/common/observableValue';
import { StoredValue } from 'vs/workbench/contrib/testing/common/storedValue';
import { TestIdPath } from 'vs/workbench/contrib/testing/common/testCollection';
import { TestingContextKeys } from 'vs/workbench/contrib/testing/common/testingContextKeys';
import { ITestService } from 'vs/workbench/contrib/testing/common/testService';

export interface ITestExplorerFilterState {
	_serviceBrand: undefined;
	readonly text: MutableObservableValue<string>;
	/**
	 * Reveal request: the path to the test to reveal. The last element of the
	 * array is the test the user wanted to reveal, and the previous
	 * items are its parents.
	*/
	readonly reveal: MutableObservableValue<TestIdPath | undefined>;
	readonly stateFilter: MutableObservableValue<TestExplorerStateFilter>;
	readonly currentDocumentOnly: MutableObservableValue<boolean>;
	/** Whether excluded test should be shown in the view */
	readonly showExcludedTests: MutableObservableValue<boolean>;

	readonly onDidRequestInputFocus: Event<void>;
	focusInput(): void;
}

export const ITestExplorerFilterState = createDecorator<ITestExplorerFilterState>('testingFilterState');

export class TestExplorerFilterState implements ITestExplorerFilterState {
	declare _serviceBrand: undefined;
	private readonly focusEmitter = new Emitter<void>();
	public readonly text = new MutableObservableValue('');
	public readonly stateFilter = MutableObservableValue.stored(new StoredValue<TestExplorerStateFilter>({
		key: 'testStateFilter',
		scope: StorageScope.WORKSPACE,
		target: StorageTarget.USER
	}, this.storage), TestExplorerStateFilter.All);
	public readonly currentDocumentOnly = MutableObservableValue.stored(new StoredValue<boolean>({
		key: 'testsByCurrentDocumentOnly',
		scope: StorageScope.WORKSPACE,
		target: StorageTarget.USER
	}, this.storage), false);

	public readonly showExcludedTests = new MutableObservableValue(false);
	public readonly reveal = new MutableObservableValue<TestIdPath | undefined>(undefined);

	public readonly onDidRequestInputFocus = this.focusEmitter.event;

	constructor(@IStorageService private readonly storage: IStorageService) { }

	public focusInput() {
		this.focusEmitter.fire();
	}
}

export class TestingExplorerFilter extends BaseActionViewItem {
	private input!: HistoryInputBox;
	private readonly history: StoredValue<string[]> = this.instantiationService.createInstance(StoredValue, {
		key: 'testing.filterHistory',
		scope: StorageScope.WORKSPACE,
		target: StorageTarget.USER
	});

	private readonly filtersAction = new Action('markersFiltersAction', localize('testing.filters.menu', "More Filters..."), 'testing-filter-button ' + ThemeIcon.asClassName(testingFilterIcon));

	constructor(
		action: IAction,
		@ITestExplorerFilterState private readonly state: ITestExplorerFilterState,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IThemeService private readonly themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super(null, action);
		this.updateFilterActiveState();
		this._register(state.currentDocumentOnly.onDidChange(this.updateFilterActiveState, this));
		this._register(state.stateFilter.onDidChange(this.updateFilterActiveState, this));
	}

	/**
	 * @override
	 */
	public override render(container: HTMLElement) {
		container.classList.add('testing-filter-action-item');

		const updateDelayer = this._register(new Delayer<void>(400));
		const wrapper = dom.$('.testing-filter-wrapper');
		container.appendChild(wrapper);

		const input = this.input = this._register(this.instantiationService.createInstance(ContextScopedHistoryInputBox, wrapper, this.contextViewService, {
			placeholder: localize('testExplorerFilter', "Filter (e.g. text, !exclude)"),
			history: this.history.get([]),
		}));
		input.value = this.state.text.value;
		this._register(attachInputBoxStyler(input, this.themeService));

		this._register(this.state.text.onDidChange(newValue => {
			input.value = newValue;
		}));

		this._register(this.state.onDidRequestInputFocus(() => {
			input.focus();
		}));

		this._register(input.onDidChange(() => updateDelayer.trigger(() => {
			input.addToHistory();
			this.state.text.value = input.value;
		})));

		this._register(dom.addStandardDisposableListener(input.inputElement, dom.EventType.KEY_DOWN, e => {
			if (e.equals(KeyCode.Escape)) {
				input.value = '';
				e.stopPropagation();
				e.preventDefault();
			}
		}));

		const actionbar = this._register(new ActionBar(container, {
			actionViewItemProvider: action => {
				if (action.id === this.filtersAction.id) {
					return this.instantiationService.createInstance(FiltersDropdownMenuActionViewItem, action, this.state, this.actionRunner);
				}
				return undefined;
			}
		}));
		actionbar.push(this.filtersAction, { icon: true, label: false });
	}


	/**
	 * Focuses the filter input.
	 */
	public override focus(): void {
		this.input.focus();
	}

	/**
	 * Persists changes to the input history.
	 */
	public saveState() {
		const history = this.input.getHistory();
		if (history.length) {
			this.history.store(history);
		} else {
			this.history.delete();
		}
	}

	/**
	 * @override
	 */
	public override dispose() {
		this.saveState();
		super.dispose();
	}

	/**
	 * Updates the 'checked' state of the filter submenu.
	 */
	private updateFilterActiveState() {
		this.filtersAction.checked = this.state.currentDocumentOnly.value
			|| this.state.stateFilter.value !== TestExplorerStateFilter.All;
	}
}


class FiltersDropdownMenuActionViewItem extends DropdownMenuActionViewItem {

	constructor(
		action: IAction,
		private readonly filters: ITestExplorerFilterState,
		actionRunner: IActionRunner,
		@IContextMenuService contextMenuService: IContextMenuService,
		@ITestService private readonly testService: ITestService,
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
			...[
				{ v: TestExplorerStateFilter.OnlyFailed, label: localize('testing.filters.showOnlyFailed', "Show Only Failed Tests") },
				{ v: TestExplorerStateFilter.OnlyExecuted, label: localize('testing.filters.showOnlyExecuted', "Show Only Executed Tests") },
				{ v: TestExplorerStateFilter.All, label: localize('testing.filters.showAll', "Show All Tests") },
			].map(({ v, label }) => ({
				checked: this.filters.stateFilter.value === v,
				class: undefined,
				enabled: true,
				id: v,
				label,
				run: async () => {
					this.filters.stateFilter.value = this.filters.stateFilter.value === v ? TestExplorerStateFilter.All : v;
				},
				tooltip: '',
				dispose: () => null
			})),
			new Separator(),
			{
				checked: this.filters.showExcludedTests.value,
				class: undefined,
				enabled: true,
				id: 'showExcluded',
				label: localize('testing.filters.showExcludedTests', "Show Hidden Tests"),
				run: async () => this.filters.showExcludedTests.value = !this.filters.showExcludedTests.value,
				tooltip: '',
				dispose: () => null
			},
			{
				checked: false,
				class: undefined,
				enabled: this.testService.excludeTests.value.size > 0,
				id: 'removeExcluded',
				label: localize('testing.filters.removeTestExclusions', "Unhide All Tests"),
				run: async () => this.testService.clearExcludedTests(),
				tooltip: '',
				dispose: () => null
			},
			new Separator(),
			{
				checked: this.filters.currentDocumentOnly.value,
				class: undefined,
				enabled: true,
				id: 'currentDocument',
				label: localize('testing.filters.currentFile', "Show in Active File Only"),
				run: async () => this.filters.currentDocumentOnly.value = !this.filters.currentDocumentOnly.value,
				tooltip: '',
				dispose: () => null
			},
		];
	}

	override updateChecked(): void {
		this.element!.classList.toggle('checked', this._action.checked);
	}
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: Testing.FilterActionId,
			title: localize('filter', "Filter"),
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.and(ContextKeyEqualsExpr.create('view', Testing.ExplorerViewId), TestingContextKeys.explorerLocation.isEqualTo(ViewContainerLocation.Panel)),
				group: 'navigation',
				order: 1,
			},
		});
	}
	async run(): Promise<void> { }
});
