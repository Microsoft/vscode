/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MultiCommand, RedoCommand, SelectAllCommand, ServicesAccessor, UndoCommand } from 'vs/editor/browser/editorExtensions';
import { CopyAction, CutAction, PasteAction } from 'vs/editor/contrib/clipboard/clipboard';
import { localize } from 'vs/nls';
import { registerAction2 } from 'vs/platform/actions/common/actions';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorDescriptor, Extensions as EditorExtensions, IEditorRegistry } from 'vs/workbench/browser/editor';
import { Extensions as EditorInputExtensions, IEditorInputFactoryRegistry } from 'vs/workbench/common/editor';
import { Webview, WebviewOverlay } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewEditorInputFactory } from 'vs/workbench/contrib/webview/browser/webviewEditorInputFactory';
import { getActiveWebview, HideWebViewEditorFindCommand, ReloadWebviewAction, SelectAllWebviewEditorCommand, ShowWebViewEditorFindWidgetAction, WebViewEditorFindNextCommand, WebViewEditorFindPreviousCommand } from '../browser/webviewCommands';
import { WebviewEditor } from './webviewEditor';
import { WebviewInput } from './webviewEditorInput';
import { IWebviewWorkbenchService, WebviewEditorService } from './webviewWorkbenchService';

(Registry.as<IEditorRegistry>(EditorExtensions.Editors)).registerEditor(EditorDescriptor.create(
	WebviewEditor,
	WebviewEditor.ID,
	localize('webview.editor.label', "webview editor")),
	[new SyncDescriptor(WebviewInput)]);

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputFactory(
	WebviewEditorInputFactory.ID,
	WebviewEditorInputFactory);

registerSingleton(IWebviewWorkbenchService, WebviewEditorService, true);

registerAction2(ShowWebViewEditorFindWidgetAction);
registerAction2(HideWebViewEditorFindCommand);
registerAction2(WebViewEditorFindNextCommand);
registerAction2(WebViewEditorFindPreviousCommand);
registerAction2(SelectAllWebviewEditorCommand);
registerAction2(ReloadWebviewAction);


function getActiveElectronBasedWebview(accessor: ServicesAccessor): Webview | undefined {
	const webview = getActiveWebview(accessor);
	if (!webview) {
		return undefined;
	}

	// Make sure we are really focused on the webview
	if (!['WEBVIEW', 'IFRAME'].includes(document.activeElement?.tagName ?? '')) {
		return undefined;
	}

	if ('getInnerWebview' in (webview as WebviewOverlay)) {
		const innerWebview = (webview as WebviewOverlay).getInnerWebview();
		return innerWebview;
	}

	return webview;
}


const PRIORITY = 100;

function overrideCommandForWebview(command: MultiCommand | undefined, f: (webview: Webview) => void) {
	command?.addImplementation(PRIORITY, accessor => {
		const webview = getActiveElectronBasedWebview(accessor);
		if (webview) {
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
