/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from 'vs/base/common/platform';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import * as webviewCommands from 'vs/workbench/contrib/webview/electron-browser/webviewCommands';
import { NotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookEditor';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ElectronWebviewBasedWebview } from 'vs/workbench/contrib/webview/electron-browser/webviewElement';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { getActiveNotebookEditor } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';

function getActiveElectronBasedWebviewDelegate(accessor: ServicesAccessor): ElectronWebviewBasedWebview | undefined {

	const editorService = accessor.get(IEditorService);
	const editor = getActiveNotebookEditor(editorService);

	const webview = editor?.getInnerWebview();

	if (webview && webview instanceof ElectronWebviewBasedWebview) {
		return webview;
	}

	return;
}

function registerNotebookCommands(editorId: string): void {
	const contextKeyExpr = ContextKeyExpr.and(ContextKeyExpr.equals('activeEditor', editorId), ContextKeyExpr.not('editorFocus') /* https://github.com/Microsoft/vscode/issues/58668 */)!;

	// These commands are only needed on MacOS where we have to disable the menu bar commands
	if (isMacintosh) {
		registerAction2(class extends webviewCommands.CopyWebviewEditorCommand { constructor() { super(contextKeyExpr, getActiveElectronBasedWebviewDelegate); } });
		registerAction2(class extends webviewCommands.PasteWebviewEditorCommand { constructor() { super(contextKeyExpr, getActiveElectronBasedWebviewDelegate); } });
		registerAction2(class extends webviewCommands.CutWebviewEditorCommand { constructor() { super(contextKeyExpr, getActiveElectronBasedWebviewDelegate); } });
		registerAction2(class extends webviewCommands.UndoWebviewEditorCommand { constructor() { super(contextKeyExpr, getActiveElectronBasedWebviewDelegate); } });
		registerAction2(class extends webviewCommands.RedoWebviewEditorCommand { constructor() { super(contextKeyExpr, getActiveElectronBasedWebviewDelegate); } });
	}
}

registerNotebookCommands(NotebookEditor.ID);
