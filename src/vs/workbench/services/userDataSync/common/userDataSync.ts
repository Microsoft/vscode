/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IAuthenticationProvider, SyncStatus, SyncResource, Change, MergeState } from 'vs/platform/userDataSync/common/userDataSync';
import { Event } from 'vs/base/common/event';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

export interface IUserDataSyncAccount {
	readonly authenticationProviderId: string;
	readonly accountName: string;
	readonly accountId: string;
}

export interface IUserDataSyncPreview {
	readonly onDidChangeResources: Event<ReadonlyArray<IUserDataSyncResource>>;
	readonly resources: ReadonlyArray<IUserDataSyncResource>;

	accept(syncResource: SyncResource, resource: URI, content?: string | null): Promise<void>;
	merge(resource?: URI): Promise<void>;
	discard(resource?: URI): Promise<void>;
	pull(): Promise<void>;
	push(): Promise<void>;
	apply(): Promise<void>;
	cancel(): Promise<void>;
}

export interface IUserDataSyncResource {
	readonly syncResource: SyncResource;
	readonly local: URI;
	readonly remote: URI;
	readonly merged: URI;
	readonly accepted: URI;
	readonly localChange: Change;
	readonly remoteChange: Change;
	readonly mergeState: MergeState;
}

export const IUserDataSyncWorkbenchService = createDecorator<IUserDataSyncWorkbenchService>('IUserDataSyncWorkbenchService');
export interface IUserDataSyncWorkbenchService {
	_serviceBrand: any;

	readonly enabled: boolean;
	readonly authenticationProviders: IAuthenticationProvider[];

	readonly all: IUserDataSyncAccount[];
	readonly current: IUserDataSyncAccount | undefined;

	readonly accountStatus: AccountStatus;
	readonly onDidChangeAccountStatus: Event<AccountStatus>;

	readonly userDataSyncPreview: IUserDataSyncPreview;

	turnOn(): Promise<void>;
	turnoff(everyWhere: boolean): Promise<void>;
	signIn(): Promise<void>;

	resetSyncedData(): Promise<void>;
	showSyncActivity(): Promise<void>;
}

export function getSyncAreaLabel(source: SyncResource): string {
	switch (source) {
		case SyncResource.Settings: return localize('settings', "Settings");
		case SyncResource.Keybindings: return localize('keybindings', "Keyboard Shortcuts");
		case SyncResource.Snippets: return localize('snippets', "User Snippets");
		case SyncResource.Extensions: return localize('extensions', "Extensions");
		case SyncResource.GlobalState: return localize('ui state label', "UI State");
	}
}

export const enum AccountStatus {
	Uninitialized = 'uninitialized',
	Unavailable = 'unavailable',
	Available = 'available',
}

export const SYNC_TITLE = localize('sync category', "Settings Sync");

export const SYNC_VIEW_ICON = registerIcon('settings-sync-view-icon', Codicon.sync, localize('syncViewIcon', 'View icon of the settings sync view.'));

// Contexts
export const CONTEXT_SYNC_STATE = new RawContextKey<string>('syncStatus', SyncStatus.Uninitialized);
export const CONTEXT_SYNC_ENABLEMENT = new RawContextKey<boolean>('syncEnabled', false);
export const CONTEXT_ACCOUNT_STATE = new RawContextKey<string>('userDataSyncAccountStatus', AccountStatus.Uninitialized);
export const CONTEXT_ENABLE_ACTIVITY_VIEWS = new RawContextKey<boolean>(`enableSyncActivityViews`, false);
export const CONTEXT_ENABLE_SYNC_MERGES_VIEW = new RawContextKey<boolean>(`enableSyncMergesView`, false);

// Commands
export const CONFIGURE_SYNC_COMMAND_ID = 'workbench.userDataSync.actions.configure';
export const SHOW_SYNC_LOG_COMMAND_ID = 'workbench.userDataSync.actions.showLog';

// VIEWS
export const SYNC_VIEW_CONTAINER_ID = 'workbench.view.sync';
export const SYNC_MERGES_VIEW_ID = 'workbench.views.sync.merges';
