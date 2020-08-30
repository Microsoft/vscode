/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { SettingsEditor2Input, KeybindingsEditorInput, PreferencesEditorInput } from 'vs/workbench/services/preferences/common/preferencesEditorInput';
import { isEqual } from 'vs/base/common/resources';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { VIEWLET_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import { IEditorInput } from 'vs/workbench/common/editor';
import { IViewsService } from 'vs/workbench/common/views';
import { IUserDataAutoSyncService } from 'vs/platform/userDataSync/common/userDataSync';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { isWeb } from 'vs/base/common/platform';
import { IHostService } from 'vs/workbench/services/host/browser/host';

export class UserDataSyncTrigger extends Disposable implements IWorkbenchContribution {

	constructor(
		@IEditorService editorService: IEditorService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IViewsService viewsService: IViewsService,
		@IUserDataAutoSyncService userDataAutoSyncService: IUserDataAutoSyncService,
		@IHostService hostService: IHostService,
	) {
		super();
		const event = Event.filter(
			Event.any<string | undefined>(
				Event.map(editorService.onDidActiveEditorChange, () => this.getUserDataEditorInputSource(editorService.activeEditor)),
				Event.map(Event.filter(viewsService.onDidChangeViewContainerVisibility, e => e.id === VIEWLET_ID && e.visible), e => e.id)
			), source => source !== undefined);
		if (isWeb) {
			this._register(Event.debounce<string, string[]>(
				Event.any<string>(
					Event.map(hostService.onDidChangeFocus, () => 'windowFocus'),
					Event.map(event, source => source!),
				), (last, source) => last ? [...last, source] : [source], 1000)
				(sources => userDataAutoSyncService.triggerSync(sources, true, false)));
		} else {
			this._register(event(source => userDataAutoSyncService.triggerSync([source!], true, false)));
		}
	}

	private getUserDataEditorInputSource(editorInput: IEditorInput | undefined): string | undefined {
		if (!editorInput) {
			return undefined;
		}
		if (editorInput instanceof SettingsEditor2Input) {
			return 'settingsEditor';
		}
		if (editorInput instanceof PreferencesEditorInput) {
			return 'settingsEditor';
		}
		if (editorInput instanceof KeybindingsEditorInput) {
			return 'keybindingsEditor';
		}
		const resource = editorInput.resource;
		if (isEqual(resource, this.workbenchEnvironmentService.settingsResource)) {
			return 'settingsEditor';
		}
		if (isEqual(resource, this.workbenchEnvironmentService.keybindingsResource)) {
			return 'keybindingsEditor';
		}
		return undefined;
	}
}

