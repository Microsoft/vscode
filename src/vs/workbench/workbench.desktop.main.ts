/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// #######################################################################
// ###                                                                 ###
// ### !!! PLEASE ADD COMMON IMPORTS INTO WORKBENCH.COMMON.MAIN.TS !!! ###
// ###                                                                 ###
// #######################################################################


//#region --- workbench common & sandbox

import 'vs/workbench/workbench.sandbox.main';

//#endregion


//#region --- workbench actions

import 'vs/workbench/electron-browser/actions/developerActions';

//#endregion


//#region --- workbench (desktop main)

import 'vs/workbench/electron-browser/desktop.main';

//#endregion


//#region --- workbench services

import 'vs/workbench/services/integrity/node/integrityService';
import 'vs/workbench/services/textMate/electron-browser/textMateService';
import 'vs/workbench/services/search/node/searchService';
import 'vs/workbench/services/output/electron-browser/outputChannelModelService';
import 'vs/workbench/services/textfile/electron-browser/nativeTextFileService';
import 'vs/workbench/services/dialogs/electron-browser/dialogService';
import 'vs/workbench/services/keybinding/electron-browser/nativeKeymapService';
import 'vs/workbench/services/keybinding/electron-browser/keybinding.contribution';
import 'vs/workbench/services/extensions/electron-browser/extensionService';
import 'vs/workbench/services/extensionManagement/electron-browser/extensionManagementServerService';
import 'vs/workbench/services/extensionManagement/electron-browser/extensionTipsService';
import 'vs/workbench/services/remote/electron-browser/remoteAgentServiceImpl';
import 'vs/workbench/services/telemetry/electron-browser/telemetryService';
import 'vs/workbench/services/configurationResolver/electron-browser/configurationResolverService';
import 'vs/workbench/services/extensionManagement/node/extensionManagementService';
import 'vs/workbench/services/accessibility/electron-browser/accessibilityService';
import 'vs/workbench/services/backup/node/backupFileService';
import 'vs/workbench/services/workspaces/electron-browser/workspaceEditingService';
import 'vs/workbench/services/userDataSync/electron-browser/userDataSyncMachinesService';
import 'vs/workbench/services/userDataSync/electron-browser/userDataSyncService';
import 'vs/workbench/services/userDataSync/electron-browser/userDataSyncAccountService';
import 'vs/workbench/services/sharedProcess/electron-browser/sharedProcessService';
import 'vs/workbench/services/localizations/electron-browser/localizationsService';
import 'vs/workbench/services/path/electron-browser/pathService';

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ICredentialsService } from 'vs/platform/credentials/common/credentials';
import { KeytarCredentialsService } from 'vs/platform/credentials/node/credentialsService';
import { IUserDataAutoSyncService } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataAutoSyncService } from 'vs/workbench/contrib/userDataSync/electron-browser/userDataAutoSyncService';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { TunnelService } from 'vs/platform/remote/node/tunnelService';
import { ITimerService } from 'vs/workbench/services/timer/browser/timerService';
import { TimerService } from 'vs/workbench/services/timer/electron-browser/timerService';

registerSingleton(ICredentialsService, KeytarCredentialsService, true);
registerSingleton(IUserDataAutoSyncService, UserDataAutoSyncService);
registerSingleton(ITunnelService, TunnelService);
registerSingleton(ITimerService, TimerService);

//#endregion


//#region --- workbench contributions

// Logs
import 'vs/workbench/contrib/logs/electron-browser/logs.contribution';

// Tags
import 'vs/workbench/contrib/tags/electron-browser/workspaceTagsService';
import 'vs/workbench/contrib/tags/electron-browser/tags.contribution';

// Rapid Render Splash
import 'vs/workbench/contrib/splash/electron-browser/partsSplash.contribution';

// Debug
import 'vs/workbench/contrib/debug/node/debugHelperService';

// Webview
import 'vs/workbench/contrib/webview/electron-browser/webview.contribution';

// Notebook
import 'vs/workbench/contrib/notebook/electron-browser/notebook.contribution';

// Extensions Management
import 'vs/workbench/contrib/extensions/electron-browser/extensions.contribution';

// Terminal
import 'vs/workbench/contrib/terminal/electron-browser/terminal.contribution';

// Remote
import 'vs/workbench/contrib/remote/electron-browser/remote.contribution';

// CodeEditor Contributions
import 'vs/workbench/contrib/codeEditor/electron-browser/codeEditor.contribution';

// External Terminal
import 'vs/workbench/contrib/externalTerminal/node/externalTerminal.contribution';

// Performance
import 'vs/workbench/contrib/performance/electron-browser/performance.contribution';

// CLI
import 'vs/workbench/contrib/cli/node/cli.contribution';

// Themes Support
import 'vs/workbench/contrib/themes/test/electron-browser/themes.test.contribution';

// Issues
import 'vs/workbench/contrib/issue/electron-browser/issue.contribution';

// Tasks
import 'vs/workbench/contrib/tasks/electron-browser/taskService';

// User Data Sync
import 'vs/workbench/contrib/userDataSync/electron-browser/userDataSync.contribution';

// Configuration Exporter
import 'vs/workbench/contrib/configExporter/electron-browser/configurationExportHelper.contribution';

//#endregion
