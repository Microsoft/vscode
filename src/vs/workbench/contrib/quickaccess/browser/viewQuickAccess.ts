/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IQuickPickSeparator, IQuickInputService, ItemActivation } from 'vs/platform/quickinput/common/quickInput';
import { IPickerQuickAccessItem, PickerQuickAccessProvider } from 'vs/platform/quickinput/browser/pickerQuickAccess';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IViewDescriptorService, IViewsService, ViewContainer } from 'vs/workbench/common/views';
import { IOutputService } from 'vs/workbench/contrib/output/common/output';
import { ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IPanelService, IPanelIdentifier } from 'vs/workbench/services/panel/common/panelService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ViewletDescriptor } from 'vs/workbench/browser/viewlet';
import { matchesFuzzy } from 'vs/base/common/filters';
import { fuzzyContains } from 'vs/base/common/strings';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

interface IViewQuickPickItem extends IPickerQuickAccessItem {
	containerLabel: string;
}

export class ViewQuickAccessProvider extends PickerQuickAccessProvider<IViewQuickPickItem> {

	static PREFIX = 'view ';

	constructor(
		@IViewletService private readonly viewletService: IViewletService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IViewsService private readonly viewsService: IViewsService,
		@IOutputService private readonly outputService: IOutputService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@IPanelService private readonly panelService: IPanelService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService
	) {
		super(ViewQuickAccessProvider.PREFIX, {
			noResultsPick: {
				label: localize('noViewResults', "No matching views"),
				containerLabel: ''
			}
		});
	}

	protected getPicks(filter: string): Array<IViewQuickPickItem | IQuickPickSeparator> {
		const filteredViewEntries = this.doGetViewPickItems().filter(entry => {
			if (!filter) {
				return true;
			}

			// Match fuzzy on label
			entry.highlights = { label: withNullAsUndefined(matchesFuzzy(filter, entry.label, true)) };

			// Return if we have a match on label or container
			return entry.highlights.label || fuzzyContains(entry.containerLabel, filter);
		});

		// Map entries to container labels
		const mapEntryToContainer = new Map<string, string>();
		for (const entry of filteredViewEntries) {
			if (!mapEntryToContainer.has(entry.label)) {
				mapEntryToContainer.set(entry.label, entry.containerLabel);
			}
		}

		// Add separators for containers
		const filteredViewEntriesWithSeparators: Array<IViewQuickPickItem | IQuickPickSeparator> = [];
		let lastContainer: string | undefined = undefined;
		for (const entry of filteredViewEntries) {
			if (lastContainer !== entry.containerLabel) {
				lastContainer = entry.containerLabel;

				// When the entry container has a parent container, set container
				// label as Parent / Child. For example, `Views / Explorer`.
				let separatorLabel: string;
				if (mapEntryToContainer.has(lastContainer)) {
					separatorLabel = `${mapEntryToContainer.get(lastContainer)} / ${lastContainer}`;
				} else {
					separatorLabel = lastContainer;
				}

				filteredViewEntriesWithSeparators.push({ type: 'separator', label: separatorLabel });

			}

			filteredViewEntriesWithSeparators.push(entry);
		}

		return filteredViewEntriesWithSeparators;
	}

	private doGetViewPickItems(): Array<IViewQuickPickItem> {
		const viewEntries: Array<IViewQuickPickItem> = [];

		const getViewEntriesForViewlet = (viewlet: ViewletDescriptor, viewContainer: ViewContainer): IViewQuickPickItem[] => {
			const viewContainerModel = this.viewDescriptorService.getViewContainerModel(viewContainer);
			const result: IViewQuickPickItem[] = [];
			for (const view of viewContainerModel.allViewDescriptors) {
				if (this.contextKeyService.contextMatchesRules(view.when)) {
					result.push({
						label: view.name,
						containerLabel: viewlet.name,
						accept: () => this.viewsService.openView(view.id, true)
					});
				}
			}

			return result;
		};

		// Viewlets
		const viewlets = this.viewletService.getViewlets();
		for (const viewlet of viewlets) {
			if (this.includeViewContainer(viewlet)) {
				viewEntries.push({
					label: viewlet.name,
					containerLabel: localize('views', "Side Bar"),
					accept: () => this.viewletService.openViewlet(viewlet.id, true)
				});
			}
		}

		// Panels
		const panels = this.panelService.getPanels();
		for (const panel of panels) {
			if (this.includeViewContainer(panel)) {
				viewEntries.push({
					label: panel.name,
					containerLabel: localize('panels', "Panel"),
					accept: () => this.panelService.openPanel(panel.id, true)
				});
			}
		}

		// Viewlet Views
		for (const viewlet of viewlets) {
			const viewContainer = this.viewDescriptorService.getViewContainerById(viewlet.id);
			if (viewContainer) {
				viewEntries.push(...getViewEntriesForViewlet(viewlet, viewContainer));
			}
		}

		// Terminals
		this.terminalService.terminalTabs.forEach((tab, tabIndex) => {
			tab.terminalInstances.forEach((terminal, terminalIndex) => {
				const label = localize('terminalTitle', "{0}: {1}", `${tabIndex + 1}.${terminalIndex + 1}`, terminal.title);
				viewEntries.push({
					label,
					containerLabel: localize('terminals', "Terminal"),
					accept: async () => {
						await this.terminalService.showPanel(true);

						this.terminalService.setActiveInstance(terminal);
					}
				});
			});
		});

		// Output Channels
		const channels = this.outputService.getChannelDescriptors();
		for (const channel of channels) {
			const label = channel.log ? localize('logChannel', "Log ({0})", channel.label) : channel.label;
			viewEntries.push({
				label,
				containerLabel: localize('channels', "Output"),
				accept: () => this.outputService.showChannel(channel.id)
			});
		}

		return viewEntries;
	}

	private includeViewContainer(container: ViewletDescriptor | IPanelIdentifier): boolean {
		const viewContainer = this.viewDescriptorService.getViewContainerById(container.id);
		if (viewContainer?.hideIfEmpty) {
			return this.viewDescriptorService.getViewContainerModel(viewContainer).activeViewDescriptors.length > 0;
		}

		return true;
	}
}


//#region Actions

const viewCategory = { value: localize('view', "View"), original: 'View' };

export class OpenViewPickerAction extends Action2 {

	static readonly ID = 'workbench.action.openView';

	constructor() {
		super({
			id: OpenViewPickerAction.ID,
			title: { value: localize('openView', "Open View"), original: 'Open View' },
			category: viewCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		accessor.get(IQuickInputService).quickAccess.show(ViewQuickAccessProvider.PREFIX);
	}
}

export class QuickAccessViewPickerAction extends Action2 {

	static readonly ID = 'workbench.action.quickOpenView';
	static readonly KEYBINDING = {
		primary: KeyMod.CtrlCmd | KeyCode.KEY_Q,
		mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_Q },
		linux: { primary: 0 }
	};

	constructor() {
		super({
			id: QuickAccessViewPickerAction.ID,
			title: { value: localize('quickOpenView', "Quick Open View"), original: 'Quick Open View' },
			category: viewCategory,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: undefined,
				...QuickAccessViewPickerAction.KEYBINDING
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const keybindingService = accessor.get(IKeybindingService);
		const quickInputService = accessor.get(IQuickInputService);

		const keys = keybindingService.lookupKeybindings(QuickAccessViewPickerAction.ID);

		quickInputService.quickAccess.show(ViewQuickAccessProvider.PREFIX, { quickNavigateConfiguration: { keybindings: keys }, itemActivation: ItemActivation.FIRST });
	}
}

//#endregion
