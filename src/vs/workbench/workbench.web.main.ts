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


//#region --- workbench (web main)

import 'vs/workbench/browser/web.main';

//#endregion


//#region --- workbench services
import 'vs/workbench/services/integrity/browser/integrityService';
import 'vs/workbench/services/textMate/browser/textMateService';
import 'vs/workbench/services/search/common/searchService';
import 'vs/workbench/services/output/common/outputChannelModelService';
import 'vs/workbench/services/textfile/browser/browserTextFileService';
import 'vs/workbench/services/keybinding/browser/keymapService';
import 'vs/workbench/services/extensions/browser/extensionService';
import 'vs/workbench/services/extensionManagement/common/extensionManagementServerService';
import 'vs/workbench/services/telemetry/browser/telemetryService';
import 'vs/workbench/services/configurationResolver/browser/configurationResolverService';
import 'vs/workbench/services/credentials/browser/credentialsService';
import 'vs/workbench/services/url/browser/urlService';
import 'vs/workbench/services/update/browser/updateService';
import 'vs/workbench/contrib/tags/browser/workspaceTagsService';
import 'vs/workbench/services/workspaces/browser/workspacesService';
import 'vs/workbench/services/workspaces/browser/workspaceEditingService';
import 'vs/workbench/services/dialogs/browser/dialogService';
import 'vs/workbench/services/dialogs/browser/fileDialogService';
import 'vs/workbench/services/host/browser/browserHostService';
import 'vs/workbench/services/request/browser/requestService';
import 'vs/workbench/services/lifecycle/browser/lifecycleService';
import 'vs/workbench/services/clipboard/browser/clipboardService';
import 'vs/workbench/services/extensionResourceLoader/browser/extensionResourceLoaderService';
import 'vs/workbench/services/path/browser/pathService';

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ContextMenuService } from 'vs/platform/contextview/browser/contextMenuService';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { BackupFileService } from 'vs/workbench/services/backup/common/backupFileService';
import { IExtensionManagementService, IExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionTipsService';
import { ExtensionManagementService } from 'vs/workbench/services/extensionManagement/common/extensionManagementService';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { TunnelService } from 'vs/workbench/services/remote/common/tunnelService';
import { ILoggerService } from 'vs/platform/log/common/log';
import { FileLoggerService } from 'vs/platform/log/common/fileLogService';
import { IUserDataSyncStoreService, IUserDataSyncService, IUserDataSyncLogService, IUserDataAutoSyncService, IUserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSync';
import { StorageKeysSyncRegistryService, IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { AuthenticationService, IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { UserDataSyncLogService } from 'vs/platform/userDataSync/common/userDataSyncLog';
import { UserDataSyncStoreService } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { UserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSyncBackupStoreService';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { IAuthenticationTokenService, AuthenticationTokenService } from 'vs/platform/authentication/common/authentication';
import { UserDataAutoSyncService } from 'vs/workbench/contrib/userDataSync/browser/userDataAutoSyncService';
import { AccessibilityService } from 'vs/platform/accessibility/common/accessibilityService';
import { ITitleService } from 'vs/workbench/services/title/common/titleService';
import { TitlebarPart } from 'vs/workbench/browser/parts/titlebar/titlebarPart';

registerSingleton(IExtensionManagementService, ExtensionManagementService);
registerSingleton(IBackupFileService, BackupFileService);
registerSingleton(IAccessibilityService, AccessibilityService, true);
registerSingleton(IContextMenuService, ContextMenuService);
registerSingleton(ITunnelService, TunnelService, true);
registerSingleton(ILoggerService, FileLoggerService);
registerSingleton(IAuthenticationService, AuthenticationService);
registerSingleton(IUserDataSyncLogService, UserDataSyncLogService);
registerSingleton(IUserDataSyncStoreService, UserDataSyncStoreService);
registerSingleton(IUserDataSyncBackupStoreService, UserDataSyncBackupStoreService);
registerSingleton(IStorageKeysSyncRegistryService, StorageKeysSyncRegistryService);
registerSingleton(IAuthenticationTokenService, AuthenticationTokenService);
registerSingleton(IUserDataAutoSyncService, UserDataAutoSyncService);
registerSingleton(IUserDataSyncService, UserDataSyncService);
registerSingleton(ITitleService, TitlebarPart);
registerSingleton(IExtensionTipsService, ExtensionTipsService);

//#endregion


//#region --- workbench contributions

// Explorer
import 'vs/workbench/contrib/files/browser/files.web.contribution';

// Backup
import 'vs/workbench/contrib/backup/browser/backup.web.contribution';

// Preferences
import 'vs/workbench/contrib/preferences/browser/keyboardLayoutPicker';

// Debug
import 'vs/workbench/contrib/debug/browser/extensionHostDebugService';

// Webview
import 'vs/workbench/contrib/webview/browser/webviewService';
import 'vs/workbench/contrib/webview/browser/webviewWorkbenchService';

// Terminal
import 'vs/workbench/contrib/terminal/browser/terminal.web.contribution';
import 'vs/workbench/contrib/terminal/browser/terminalInstanceService';

// Tasks
import 'vs/workbench/contrib/tasks/browser/taskService';

// Telemetry Opt Out
import 'vs/workbench/contrib/welcome/telemetryOptOut/browser/telemetryOptOut.contribution';

// Issues
import 'vs/workbench/contrib/issue/browser/issue.contribution';

//#endregion
