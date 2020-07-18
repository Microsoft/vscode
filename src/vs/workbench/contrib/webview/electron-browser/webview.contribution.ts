/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerAction2 } from 'vs/platform/actions/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWebviewService } from 'vs/workbench/contrib/webview/browser/webview';
import * as webviewCommands from 'vs/workbench/contrib/webview/electron-browser/webviewCommands';
import { ElectronWebviewService } from 'vs/workbench/contrib/webview/electron-browser/webviewService';

registerSingleton(IWebviewService, ElectronWebviewService, true);

registerAction2(webviewCommands.OpenWebviewDeveloperToolsAction);
