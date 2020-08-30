/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

import { registerEditorAction, EditorAction, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { MenuId } from 'vs/platform/actions/common/actions';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';

const EMMET_COMMANDS_PREFIX = '>Emmet: ';

class ShowEmmetCommandsAction extends EditorAction {

	constructor() {
		super({
			id: 'workbench.action.showEmmetCommands',
			label: nls.localize('showEmmetCommands', "Show Emmet Commands"),
			alias: 'Show Emmet Commands',
			precondition: EditorContextKeys.writable,
			menuOpts: {
				menuId: MenuId.MenubarEditMenu,
				group: '5_insert',
				title: nls.localize({ key: 'miShowEmmetCommands', comment: ['&& denotes a mnemonic'] }, "E&&mmet..."),
				order: 4
			}
		});
	}

	public async run(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		quickInputService.quickAccess.show(EMMET_COMMANDS_PREFIX);
	}
}

registerEditorAction(ShowEmmetCommandsAction);
