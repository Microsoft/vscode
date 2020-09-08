/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ICommandHandler, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { SyncActionDescriptor, MenuRegistry, MenuId, ICommandAction } from 'vs/platform/actions/common/actions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ILifecycleService, LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ContextKeyExpr, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';

export const Extensions = {
	WorkbenchActions: 'workbench.contributions.actions'
};

export interface IWorkbenchActionRegistry {

	/**
	 * Registers a workbench action to the platform. Workbench actions are not
	 * visible by default and can only be invoked through a keybinding if provided.
	 * @deprecated Register directly with KeybindingsRegistry and MenuRegistry or use registerAction2 instead.
	 */
	registerWorkbenchAction(descriptor: SyncActionDescriptor, alias: string, category?: string, when?: ContextKeyExpr): IDisposable;
}

Registry.add(Extensions.WorkbenchActions, new class implements IWorkbenchActionRegistry {

	registerWorkbenchAction(descriptor: SyncActionDescriptor, alias: string, category?: string, when?: ContextKeyExpression): IDisposable {
		return this.registerWorkbenchCommandFromAction(descriptor, alias, category, when);
	}

	private registerWorkbenchCommandFromAction(descriptor: SyncActionDescriptor, alias: string, category?: string, when?: ContextKeyExpression): IDisposable {
		const registrations = new DisposableStore();

		// command
		registrations.add(CommandsRegistry.registerCommand(descriptor.id, this.createCommandHandler(descriptor)));

		// keybinding
		const weight = (typeof descriptor.keybindingWeight === 'undefined' ? KeybindingWeight.WorkbenchContrib : descriptor.keybindingWeight);
		const keybindings = descriptor.keybindings;
		KeybindingsRegistry.registerKeybindingRule({
			id: descriptor.id,
			weight: weight,
			when:
				descriptor.keybindingContext && when
					? ContextKeyExpr.and(descriptor.keybindingContext, when)
					: descriptor.keybindingContext || when || null,
			primary: keybindings ? keybindings.primary : 0,
			secondary: keybindings?.secondary,
			win: keybindings?.win,
			mac: keybindings?.mac,
			linux: keybindings?.linux
		});

		// menu item
		// TODO@Rob slightly weird if-check required because of
		// https://github.com/Microsoft/vscode/blob/master/src/vs/workbench/contrib/search/electron-browser/search.contribution.ts#L266
		if (descriptor.label) {

			let idx = alias.indexOf(': ');
			let categoryOriginal = '';
			if (idx > 0) {
				categoryOriginal = alias.substr(0, idx);
				alias = alias.substr(idx + 2);
			}

			const command: ICommandAction = {
				id: descriptor.id,
				title: { value: descriptor.label, original: alias },
				category: category ? { value: category, original: categoryOriginal } : undefined
			};

			MenuRegistry.addCommand(command);

			registrations.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command, when }));
		}

		// TODO@alex,joh
		// support removal of keybinding rule
		// support removal of command-ui
		return registrations;
	}

	private createCommandHandler(descriptor: SyncActionDescriptor): ICommandHandler {
		return async (accessor, args) => {
			const notificationService = accessor.get(INotificationService);
			const instantiationService = accessor.get(IInstantiationService);
			const lifecycleService = accessor.get(ILifecycleService);

			try {
				await this.triggerAndDisposeAction(instantiationService, lifecycleService, descriptor, args);
			} catch (error) {
				notificationService.error(error);
			}
		};
	}

	private async triggerAndDisposeAction(instantiationService: IInstantiationService, lifecycleService: ILifecycleService, descriptor: SyncActionDescriptor, args: unknown): Promise<void> {

		// run action when workbench is created
		await lifecycleService.when(LifecyclePhase.Ready);

		const actionInstance = instantiationService.createInstance(descriptor.syncDescriptor);
		actionInstance.label = descriptor.label || actionInstance.label;

		// don't run the action when not enabled
		if (!actionInstance.enabled) {
			actionInstance.dispose();

			return;
		}

		// otherwise run and dispose
		try {
			const from = (args as any)?.from || 'keybinding';
			await actionInstance.run(args, { from });
		} finally {
			actionInstance.dispose();
		}
	}
});
