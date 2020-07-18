/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OS } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import * as nls from 'vs/nls';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EditorInput, SideBySideEditorInput, Verbosity } from 'vs/workbench/common/editor';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { KeybindingsEditorModel } from 'vs/workbench/services/preferences/common/keybindingsEditorModel';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { Settings2EditorModel } from 'vs/workbench/services/preferences/common/preferencesModels';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IFileService } from 'vs/platform/files/common/files';
import { ILabelService } from 'vs/platform/label/common/label';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { Schemas } from 'vs/base/common/network';

export class PreferencesEditorInput extends SideBySideEditorInput {
	static readonly ID: string = 'workbench.editorinputs.preferencesEditorInput';

	getTypeId(): string {
		return PreferencesEditorInput.ID;
	}

	getTitle(verbosity: Verbosity): string {
		return this.primary.getTitle(verbosity);
	}
}

export class DefaultPreferencesEditorInput extends ResourceEditorInput {
	static readonly ID = 'workbench.editorinputs.defaultpreferences';
	constructor(
		defaultSettingsResource: URI,
		@ITextModelService textModelResolverService: ITextModelService,
		@ITextFileService textFileService: ITextFileService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IFileService fileService: IFileService,
		@ILabelService labelService: ILabelService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService
	) {
		super(defaultSettingsResource, nls.localize('settingsEditorName', "Default Settings"), '', undefined, textModelResolverService, textFileService, editorService, editorGroupService, fileService, labelService, filesConfigurationService);
	}

	getTypeId(): string {
		return DefaultPreferencesEditorInput.ID;
	}

	matches(other: unknown): boolean {
		if (other instanceof DefaultPreferencesEditorInput) {
			return true;
		}
		if (!super.matches(other)) {
			return false;
		}
		return true;
	}
}

export interface IKeybindingsEditorSearchOptions {
	searchValue: string;
	recordKeybindings: boolean;
	sortByPrecedence: boolean;
}

export class KeybindingsEditorInput extends EditorInput {

	static readonly ID: string = 'workbench.input.keybindings';
	readonly keybindingsModel: KeybindingsEditorModel;

	searchOptions: IKeybindingsEditorSearchOptions | null = null;

	readonly resource = undefined;

	constructor(@IInstantiationService instantiationService: IInstantiationService) {
		super();

		this.keybindingsModel = instantiationService.createInstance(KeybindingsEditorModel, OS);
	}

	getTypeId(): string {
		return KeybindingsEditorInput.ID;
	}

	getName(): string {
		return nls.localize('keybindingsInputName', "Keyboard Shortcuts");
	}

	async resolve(): Promise<KeybindingsEditorModel> {
		return this.keybindingsModel;
	}

	matches(otherInput: unknown): boolean {
		return otherInput instanceof KeybindingsEditorInput;
	}

	dispose(): void {
		this.keybindingsModel.dispose();

		super.dispose();
	}
}

export class SettingsEditor2Input extends EditorInput {

	static readonly ID: string = 'workbench.input.settings2';
	private readonly _settingsModel: Settings2EditorModel;

	readonly resource: URI = URI.from({
		scheme: Schemas.vscodeSettings,
		path: `settingseditor`
	});

	constructor(
		@IPreferencesService _preferencesService: IPreferencesService,
	) {
		super();

		this._settingsModel = _preferencesService.createSettings2EditorModel();
	}

	matches(otherInput: unknown): boolean {
		return otherInput instanceof SettingsEditor2Input;
	}

	getTypeId(): string {
		return SettingsEditor2Input.ID;
	}

	getName(): string {
		return nls.localize('settingsEditor2InputName', "Settings");
	}

	async resolve(): Promise<Settings2EditorModel> {
		return this._settingsModel;
	}

	dispose(): void {
		this._settingsModel.dispose();

		super.dispose();
	}
}
