/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISCMResource, ISCMRepository, ISCMResourceGroup, ISCMInput } from 'vs/workbench/contrib/scm/common/scm';
import { IMenu } from 'vs/platform/actions/common/actions';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IDisposable, Disposable, combinedDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IAction } from 'vs/base/common/actions';
import { createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { equals } from 'vs/base/common/arrays';

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
