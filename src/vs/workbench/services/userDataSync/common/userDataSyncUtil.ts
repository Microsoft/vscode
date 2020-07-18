/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IUserDataSyncUtilService, getDefaultIgnoredSettings } from 'vs/platform/userDataSync/common/userDataSync';
import { IStringDictionary } from 'vs/base/common/collections';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { FormattingOptions } from 'vs/base/common/jsonFormatter';
import { URI } from 'vs/base/common/uri';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ITextResourcePropertiesService, ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';

class UserDataSyncUtilService implements IUserDataSyncUtilService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IKeybindingService private readonly keybindingsService: IKeybindingService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ITextResourcePropertiesService private readonly textResourcePropertiesService: ITextResourcePropertiesService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
	) { }

	async resolveDefaultIgnoredSettings(): Promise<string[]> {
		return getDefaultIgnoredSettings();
	}

	async resolveUserBindings(userBindings: string[]): Promise<IStringDictionary<string>> {
		const keys: IStringDictionary<string> = {};
		for (const userbinding of userBindings) {
			keys[userbinding] = this.keybindingsService.resolveUserBinding(userbinding).map(part => part.getUserSettingsLabel()).join(' ');
		}
		return keys;
	}

	async resolveFormattingOptions(resource: URI): Promise<FormattingOptions> {
		try {
			const modelReference = await this.textModelService.createModelReference(resource);
			const { insertSpaces, tabSize } = modelReference.object.textEditorModel.getOptions();
			const eol = modelReference.object.textEditorModel.getEOL();
			modelReference.dispose();
			return { eol, insertSpaces, tabSize };
		} catch (e) {
		}
		return {
			eol: this.textResourcePropertiesService.getEOL(resource),
			insertSpaces: this.textResourceConfigurationService.getValue<boolean>(resource, 'editor.insertSpaces'),
			tabSize: this.textResourceConfigurationService.getValue(resource, 'editor.tabSize')
		};
	}

}

registerSingleton(IUserDataSyncUtilService, UserDataSyncUtilService);
