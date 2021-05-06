/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MultiCommand, RedoCommand, SelectAllCommand, UndoCommand } from 'vs/editor/browser/editorExtensions';
import { CopyAction, CutAction, PasteAction } from 'vs/editor/contrib/clipboard/clipboard';
import * as nls from 'vs/nls';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { IWebviewService, Webview } from 'vs/workbench/contrib/webview/browser/webview';


const PRIORITY = 100;

function overrideCommandForWebview(command: MultiCommand | undefined, f: (webview: Webview) => void) {
	command?.addImplementation(PRIORITY, 'webview', accessor => {
		const webviewService = accessor.get(IWebviewService);
		const webview = webviewService.activeWebview;
		if (webview?.isFocused) {
			f(webview);
			return true;
		}
		return false;
	});
}

overrideCommandForWebview(UndoCommand, webview => webview.undo());
overrideCommandForWebview(RedoCommand, webview => webview.redo());
overrideCommandForWebview(SelectAllCommand, webview => webview.selectAll());
overrideCommandForWebview(CopyAction, webview => webview.copy());
overrideCommandForWebview(PasteAction, webview => webview.paste());
overrideCommandForWebview(CutAction, webview => webview.cut());

if (CutAction) {
	MenuRegistry.appendMenuItem(MenuId.WebviewContext, {
		command: {
			id: CutAction.id,
			title: nls.localize('cut', "Cut"),
		},
		order: 1,
	});
}

if (CopyAction) {
	MenuRegistry.appendMenuItem(MenuId.WebviewContext, {
		command: {
			id: CopyAction.id,
			title: nls.localize('copy', "Copy"),
		},
		order: 2,
	});
}

if (PasteAction) {
	MenuRegistry.appendMenuItem(MenuId.WebviewContext, {
		command: {
			id: PasteAction.id,
			title: nls.localize('paste', "Paste"),
		},
		order: 3,
	});
}
