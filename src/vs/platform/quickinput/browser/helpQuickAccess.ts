/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IQuickPick, IQuickPickItem, IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IQuickAccessProvider, IQuickAccessRegistry, Extensions } from 'vs/platform/quickinput/common/quickAccess';
import { Registry } from 'vs/platform/registry/common/platform';
import { localize } from 'vs/nls';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';

interface IHelpQuickAccessPickItem extends IQuickPickItem {
	prefix: string;
}

export class HelpQuickAccessProvider implements IQuickAccessProvider {

	static PREFIX = '?';

	private readonly registry = Registry.as<IQuickAccessRegistry>(Extensions.Quickaccess);

	constructor(@IQuickInputService private readonly quickInputService: IQuickInputService) { }

	provide(picker: IQuickPick<IHelpQuickAccessPickItem>): IDisposable {
		const disposables = new DisposableStore();

		// Open a picker with the selected value if picked
		disposables.add(picker.onDidAccept(() => {
			const [item] = picker.selectedItems;
			if (item) {
				this.quickInputService.quickAccess.show(item.prefix, { preserveValue: true });
			}
		}));

		// Also open a picker when we detect the user typed the exact
		// name of a provider (e.g. `?term` for terminals)
		disposables.add(picker.onDidChangeValue(value => {
			const providerDescriptor = this.registry.getQuickAccessProvider(value.substr(HelpQuickAccessProvider.PREFIX.length));
			if (providerDescriptor && providerDescriptor.prefix && providerDescriptor.prefix !== HelpQuickAccessProvider.PREFIX) {
				this.quickInputService.quickAccess.show(providerDescriptor.prefix, { preserveValue: true });
			}
		}));

		// Fill in all providers separated by editor/global scope
		const { editorProviders, globalProviders } = this.getQuickAccessProviders();
		picker.items = editorProviders.length === 0 || globalProviders.length === 0 ?

			// Without groups
			[
				...(editorProviders.length === 0 ? globalProviders : editorProviders)
			] :

			// With groups
			[
				{ label: localize('globalCommands', "global commands"), type: 'separator' },
				...globalProviders,
				{ label: localize('editorCommands', "editor commands"), type: 'separator' },
				...editorProviders
			];

		return disposables;
	}

	private getQuickAccessProviders(): { editorProviders: IHelpQuickAccessPickItem[], globalProviders: IHelpQuickAccessPickItem[] } {
		const globalProviders: IHelpQuickAccessPickItem[] = [];
		const editorProviders: IHelpQuickAccessPickItem[] = [];

		for (const provider of this.registry.getQuickAccessProviders().sort((providerA, providerB) => providerA.prefix.localeCompare(providerB.prefix))) {
			if (provider.prefix === HelpQuickAccessProvider.PREFIX) {
				continue; // exclude help which is already active
			}

			for (const helpEntry of provider.helpEntries) {
				const prefix = helpEntry.prefix || provider.prefix;
				const label = prefix || '\u2026' /* ... */;

				(helpEntry.needsEditor ? editorProviders : globalProviders).push({
					prefix,
					label,
					ariaLabel: localize('helpPickAriaLabel', "{0}, {1}", label, helpEntry.description),
					description: helpEntry.description
				});
			}
		}

		return { editorProviders, globalProviders };
	}
}

