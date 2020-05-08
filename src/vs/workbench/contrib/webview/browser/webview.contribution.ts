/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { registerAction2, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorDescriptor, Extensions as EditorExtensions, IEditorRegistry } from 'vs/workbench/browser/editor';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { Extensions as EditorInputExtensions, IEditorInputFactoryRegistry } from 'vs/workbench/common/editor';
import { webviewDeveloperCategory } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewEditorInputFactory } from 'vs/workbench/contrib/webview/browser/webviewEditorInputFactory';
import { HideWebViewEditorFindCommand, ReloadWebviewAction, ShowWebViewEditorFindWidgetAction, WebViewEditorFindNextCommand, WebViewEditorFindPreviousCommand, SelectAllWebviewEditorCommand } from '../browser/webviewCommands';
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


const webviewActiveContextKeyExpr = ContextKeyExpr.and(ContextKeyExpr.equals('activeEditor', WebviewEditor.ID), ContextKeyExpr.not('editorFocus') /* https://github.com/Microsoft/vscode/issues/58668 */)!;

registerAction2(class extends ShowWebViewEditorFindWidgetAction {
	constructor() { super(webviewActiveContextKeyExpr); }
});

registerAction2(class extends HideWebViewEditorFindCommand {
	constructor() { super(webviewActiveContextKeyExpr); }
});

registerAction2(class extends WebViewEditorFindNextCommand {
	constructor() { super(webviewActiveContextKeyExpr); }
});

registerAction2(class extends WebViewEditorFindPreviousCommand {
	constructor() { super(webviewActiveContextKeyExpr); }
});

registerAction2(class extends SelectAllWebviewEditorCommand {
	constructor() { super(webviewActiveContextKeyExpr); }
});


const actionRegistry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
actionRegistry.registerWorkbenchAction(
	SyncActionDescriptor.from(ReloadWebviewAction),
	'Reload Webviews',
	webviewDeveloperCategory);
