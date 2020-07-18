/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { SettingsEditor2Input, KeybindingsEditorInput, PreferencesEditorInput } from 'vs/workbench/services/preferences/common/preferencesEditorInput';
import { isEqual } from 'vs/base/common/resources';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { VIEWLET_ID } from 'vs/workbench/contrib/extensions/common/extensions';
import { IEditorInput } from 'vs/workbench/common/editor';
import { IViewsService } from 'vs/workbench/common/views';

export class UserDataSyncTrigger extends Disposable {

	private readonly _onDidTriggerSync: Emitter<string> = this._register(new Emitter<string>());
	readonly onDidTriggerSync: Event<string> = this._onDidTriggerSync.event;

	constructor(
		@IEditorService editorService: IEditorService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IViewsService viewsService: IViewsService,
	) {
		super();
		this._register(
			Event.filter(
				Event.any<string | undefined>(
					Event.map(editorService.onDidActiveEditorChange, () => this.getUserDataEditorInputSource(editorService.activeEditor)),
					Event.map(Event.filter(viewsService.onDidChangeViewContainerVisibility, e => e.id === VIEWLET_ID && e.visible), e => e.id)
				), source => source !== undefined)(source => this._onDidTriggerSync.fire(source!)));
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

