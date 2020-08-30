/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISCMResource, ISCMRepository, ISCMResourceGroup, ISCMInput, ISCMService, ISCMViewService } from 'vs/workbench/contrib/scm/common/scm';
import { IMenu } from 'vs/platform/actions/common/actions';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IDisposable, Disposable, combinedDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { Action, IAction } from 'vs/base/common/actions';
import { createAndFillInActionBarActions, createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { equals } from 'vs/base/common/arrays';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ActionViewItem } from 'vs/base/browser/ui/actionbar/actionViewItems';
import { renderCodicons } from 'vs/base/common/codicons';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { Command } from 'vs/editor/common/modes';
import { escape } from 'vs/base/common/strings';
import { basename } from 'vs/base/common/resources';
import { Iterable } from 'vs/base/common/iterator';

export function isSCMRepository(element: any): element is ISCMRepository {
	return !!(element as ISCMRepository).provider && typeof (element as ISCMRepository).setSelected === 'function';
}

export function isSCMInput(element: any): element is ISCMInput {
	return !!(element as ISCMInput).validateInput && typeof (element as ISCMInput).value === 'string';
}

export function isSCMResourceGroup(element: any): element is ISCMResourceGroup {
	return !!(element as ISCMResourceGroup).provider && !!(element as ISCMResourceGroup).elements;
}

export function isSCMResource(element: any): element is ISCMResource {
	return !!(element as ISCMResource).sourceUri && isSCMResourceGroup((element as ISCMResource).resourceGroup);
}

const compareActions = (a: IAction, b: IAction) => a.id === b.id;

export function connectPrimaryMenu(menu: IMenu, callback: (primary: IAction[], secondary: IAction[]) => void, isPrimaryGroup?: (group: string) => boolean): IDisposable {
	let cachedDisposable: IDisposable = Disposable.None;
	let cachedPrimary: IAction[] = [];
	let cachedSecondary: IAction[] = [];

	const updateActions = () => {
		const primary: IAction[] = [];
		const secondary: IAction[] = [];

		const disposable = createAndFillInActionBarActions(menu, { shouldForwardArgs: true }, { primary, secondary }, isPrimaryGroup);

		if (equals(cachedPrimary, primary, compareActions) && equals(cachedSecondary, secondary, compareActions)) {
			disposable.dispose();
			return;
		}

		cachedDisposable = disposable;
		cachedPrimary = primary;
		cachedSecondary = secondary;

		callback(primary, secondary);
	};

	updateActions();

	return combinedDisposable(
		menu.onDidChange(updateActions),
		toDisposable(() => cachedDisposable.dispose())
	);
}

export function connectPrimaryMenuToInlineActionBar(menu: IMenu, actionBar: ActionBar): IDisposable {
	return connectPrimaryMenu(menu, (primary) => {
		actionBar.clear();
		actionBar.push(primary, { icon: true, label: false });
	}, g => /^inline/.test(g));
}

export function collectContextMenuActions(menu: IMenu, contextMenuService: IContextMenuService): [IAction[], IDisposable] {
	const primary: IAction[] = [];
	const actions: IAction[] = [];
	const disposable = createAndFillInContextMenuActions(menu, { shouldForwardArgs: true }, { primary, secondary: actions }, contextMenuService, g => /^inline/.test(g));
	return [actions, disposable];
}

export class StatusBarAction extends Action {

	constructor(
		private command: Command,
		private commandService: ICommandService
	) {
		super(`statusbaraction{${command.id}}`, command.title, '', true);
		this.tooltip = command.tooltip || '';
	}

	run(): Promise<void> {
		return this.commandService.executeCommand(this.command.id, ...(this.command.arguments || []));
	}
}

export class StatusBarActionViewItem extends ActionViewItem {

	constructor(action: StatusBarAction) {
		super(null, action, {});
	}

	updateLabel(): void {
		if (this.options.label && this.label) {
			this.label.innerHTML = renderCodicons(escape(this.getAction().label));
		}
	}
}

export function getRepositoryVisibilityActions(scmService: ISCMService, scmViewService: ISCMViewService): IAction[] {
	const visible = new Set<IAction>();
	const actions = scmService.repositories.map(repository => {
		const label = repository.provider.rootUri ? basename(repository.provider.rootUri) : repository.provider.label;
		const action = new Action('scm.repository.toggleVisibility', label, undefined, true, async () => {
			scmViewService.toggleVisibility(repository);
		});

		if (scmViewService.isVisible(repository)) {
			action.checked = true;
			visible.add(action);
		}

		return action;
	});

	if (visible.size === 1) {
		Iterable.first(visible.values())!.enabled = false;
	}

	return actions;
}
