/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { isWindows, isMacintosh } from 'vs/base/common/platform';
import { Schemas } from 'vs/base/common/network';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { KeyMod, KeyCode, KeyChord } from 'vs/base/common/keyCodes';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { getMultiSelectedResources } from 'vs/workbench/contrib/files/browser/files';
import { IListService } from 'vs/platform/list/browser/listService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { revealResourcesInOS } from 'vs/workbench/contrib/files/electron-sandbox/fileCommands';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { ResourceContextKey } from 'vs/workbench/common/resources';
import { appendToCommandPalette, appendEditorTitleContextMenuItem } from 'vs/workbench/contrib/files/browser/fileActions.contribution';
import { IExplorerService } from 'vs/workbench/contrib/files/common/files';

const REVEAL_IN_OS_COMMAND_ID = 'revealFileInOS';
const REVEAL_IN_OS_LABEL = isWindows ? nls.localize('revealInWindows', "Reveal in File Explorer") : isMacintosh ? nls.localize('revealInMac', "Reveal in Finder") : nls.localize('openContainer', "Open Containing Folder");

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: REVEAL_IN_OS_COMMAND_ID,
	weight: KeybindingWeight.WorkbenchContrib,
	when: EditorContextKeys.focus.toNegated(),
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_R,
	win: {
		primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_R
	},
	handler: (accessor: ServicesAccessor, resource: URI | object) => {
		const resources = getMultiSelectedResources(resource, accessor.get(IListService), accessor.get(IEditorService), accessor.get(IExplorerService));
		revealResourcesInOS(resources, accessor.get(IElectronService), accessor.get(INotificationService), accessor.get(IWorkspaceContextService));
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib,
	when: undefined,
	primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_R),
	id: 'workbench.action.files.revealActiveFileInWindows',
	handler: (accessor: ServicesAccessor) => {
		const editorService = accessor.get(IEditorService);
		const activeInput = editorService.activeEditor;
		const resource = activeInput ? activeInput.resource : null;
		const resources = resource ? [resource] : [];
		revealResourcesInOS(resources, accessor.get(IElectronService), accessor.get(INotificationService), accessor.get(IWorkspaceContextService));
	}
});

appendEditorTitleContextMenuItem(REVEAL_IN_OS_COMMAND_ID, REVEAL_IN_OS_LABEL, ResourceContextKey.Scheme.isEqualTo(Schemas.file));

// Menu registration - open editors

const revealInOsCommand = {
	id: REVEAL_IN_OS_COMMAND_ID,
	title: isWindows ? nls.localize('revealInWindows', "Reveal in File Explorer") : isMacintosh ? nls.localize('revealInMac', "Reveal in Finder") : nls.localize('openContainer', "Open Containing Folder")
};
MenuRegistry.appendMenuItem(MenuId.OpenEditorsContext, {
	group: 'navigation',
	order: 20,
	command: revealInOsCommand,
	when: ResourceContextKey.IsFileSystemResource
});

// Menu registration - explorer

MenuRegistry.appendMenuItem(MenuId.ExplorerContext, {
	group: 'navigation',
	order: 20,
	command: revealInOsCommand,
	when: ResourceContextKey.Scheme.isEqualTo(Schemas.file)
});

// Command Palette

const category = { value: nls.localize('filesCategory', "File"), original: 'File' };
appendToCommandPalette(REVEAL_IN_OS_COMMAND_ID, { value: REVEAL_IN_OS_LABEL, original: isWindows ? 'Reveal in File Explorer' : isMacintosh ? 'Reveal in Finder' : 'Open Containing Folder' }, category, ResourceContextKey.Scheme.isEqualTo(Schemas.file));
