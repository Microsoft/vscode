/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction } from 'vs/editor/browser/editorExtensions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';

class InspectKeyMap extends EditorAction {

	constructor() {
		super({
			id: 'workbench.action.inspectKeyMappings',
			label: localize('workbench.action.inspectKeyMap', "Developer: Inspect Key Mappings"),
			alias: 'Developer: Inspect Key Mappings',
			precondition: undefined
		});
	}

	run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const keybindingService = accessor.get(IKeybindingService);
		const editorService = accessor.get(IEditorService);

		editorService.openEditor({ contents: keybindingService._dumpDebugInfo(), options: { pinned: true } });
	}
}

registerEditorAction(InspectKeyMap);

class InspectKeyMapJSON extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.inspectKeyMappingsJSON',
			title: { value: localize('workbench.action.inspectKeyMapJSON', "Inspect Key Mappings (JSON)"), original: 'Inspect Key Mappings (JSON)' },
			category: CATEGORIES.Developer,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const keybindingService = accessor.get(IKeybindingService);

		await editorService.openEditor({ contents: keybindingService._dumpDebugInfoJSON(), options: { pinned: true } });
	}
}

registerAction2(InspectKeyMapJSON);
