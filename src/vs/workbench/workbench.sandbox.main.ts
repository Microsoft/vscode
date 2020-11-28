/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/


// #######################################################################
// ###                                                                 ###
// ### !!! PLEASE ADD COMMON IMPORTS INTO WORKBENCH.COMMON.MAIN.TS !!! ###
// ###                                                                 ###
// #######################################################################

//#region --- workbench common

import 'vs/workbench/workbench.common.main';

//#endregion


//#region --- workbench parts

import 'vs/workbench/electron-sandbox/parts/dialogs/dialog.contribution';

//#endregion


//#region --- workbench services

import 'vs/workbench/services/dialogs/electron-sandbox/fileDialogService';
import 'vs/workbench/services/workspaces/electron-sandbox/workspacesService';
import 'vs/workbench/services/textMate/electron-sandbox/textMateService';
import 'vs/workbench/services/menubar/electron-sandbox/menubarService';
import 'vs/workbench/services/issue/electron-sandbox/issueService';
import 'vs/workbench/services/update/electron-sandbox/updateService';
import 'vs/workbench/services/url/electron-sandbox/urlService';
import 'vs/workbench/services/lifecycle/electron-sandbox/lifecycleService';
import 'vs/workbench/services/title/electron-sandbox/titleService';
import 'vs/workbench/services/host/electron-sandbox/nativeHostService';
import 'vs/workbench/services/request/electron-sandbox/requestService';
import 'vs/workbench/services/extensionResourceLoader/electron-sandbox/extensionResourceLoaderService';
import 'vs/workbench/services/clipboard/electron-sandbox/clipboardService';
import 'vs/workbench/services/contextmenu/electron-sandbox/contextmenuService';
import 'vs/workbench/services/workspaces/electron-sandbox/workspaceEditingService';
import 'vs/workbench/services/configurationResolver/electron-sandbox/configurationResolverService';
import 'vs/workbench/services/accessibility/electron-sandbox/accessibilityService';
import 'vs/workbench/services/path/electron-sandbox/pathService';
import 'vs/workbench/services/themes/electron-sandbox/nativeHostColorSchemeService';
import 'vs/workbench/services/extensionManagement/electron-sandbox/extensionManagementService';
import 'vs/workbench/services/extensionManagement/electron-sandbox/extensionUrlTrustService';
import 'vs/workbench/services/credentials/electron-sandbox/credentialsService';
import 'vs/workbench/services/encryption/electron-sandbox/encryptionService';

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ITimerService } from 'vs/workbench/services/timer/browser/timerService';
import { TimerService } from 'vs/workbench/services/timer/electron-sandbox/timerService';
import { IUserDataInitializationService, UserDataInitializationService } from 'vs/workbench/services/userData/browser/userDataInit';
import { IUserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';

registerSingleton(ITimerService, TimerService);
registerSingleton(IUserDataInitializationService, UserDataInitializationService);
registerSingleton(IUserDataAutoSyncEnablementService, UserDataAutoSyncEnablementService);

//#endregion


//#region --- workbench contributions

// Logs
import 'vs/workbench/contrib/logs/electron-sandbox/logs.contribution';

// Localizations
import 'vs/workbench/contrib/localizations/browser/localizations.contribution';

// Desktop
import 'vs/workbench/electron-sandbox/desktop.contribution';

// Explorer
import 'vs/workbench/contrib/files/electron-sandbox/files.contribution';
import 'vs/workbench/contrib/files/electron-sandbox/fileActions.contribution';

// Backup
import 'vs/workbench/contrib/backup/electron-sandbox/backup.contribution';

// CodeEditor Contributions
import 'vs/workbench/contrib/codeEditor/electron-sandbox/codeEditor.contribution';

// Debug
import 'vs/workbench/contrib/debug/electron-sandbox/extensionHostDebugService';

// Telemetry Opt Out
import 'vs/workbench/contrib/welcome/telemetryOptOut/electron-sandbox/telemetryOptOut.contribution';

// Issues
import 'vs/workbench/contrib/issue/electron-sandbox/issue.contribution';

// Remote
import 'vs/workbench/contrib/remote/electron-sandbox/remote.contribution';

// Configuration Exporter
import 'vs/workbench/contrib/configExporter/electron-sandbox/configurationExportHelper.contribution';

// Themes Support
import 'vs/workbench/contrib/themes/browser/themes.test.contribution';

//#endregion
