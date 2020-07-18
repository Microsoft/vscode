/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction, ServicesAccessor, registerEditorAction } from 'vs/editor/browser/editorExtensions';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { Action } from 'vs/base/common/actions';

class InspectKeyMap extends EditorAction {

	constructor() {
		super({
			id: 'workbench.action.inspectKeyMappings',
			label: nls.localize('workbench.action.inspectKeyMap', "Developer: Inspect Key Mappings"),
			alias: 'Developer: Inspect Key Mappings',
			precondition: undefined
		});
	}

	public run(accessor: ServicesAccessor, editor: ICodeEditor): void {
		const keybindingService = accessor.get(IKeybindingService);
		const editorService = accessor.get(IEditorService);

		editorService.openEditor({ contents: keybindingService._dumpDebugInfo(), options: { pinned: true } });
	}
}

registerEditorAction(InspectKeyMap);

class InspectKeyMapJSON extends Action {
	public static readonly ID = 'workbench.action.inspectKeyMappingsJSON';
	public static readonly LABEL = nls.localize('workbench.action.inspectKeyMapJSON', "Inspect Key Mappings (JSON)");

	constructor(
		id: string,
		label: string,
		@IKeybindingService private readonly _keybindingService: IKeybindingService,
		@IEditorService private readonly _editorService: IEditorService
	) {
		super(id, label);
	}

	public run(): Promise<any> {
		return this._editorService.openEditor({ contents: this._keybindingService._dumpDebugInfoJSON(), options: { pinned: true } });
	}
}

const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.from(InspectKeyMapJSON), 'Developer: Inspect Key Mappings (JSON)', nls.localize({ key: 'developer', comment: ['A developer on Code itself or someone diagnosing issues in Code'] }, "Developer"));
