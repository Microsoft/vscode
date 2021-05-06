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

import 'vs/workbench/browser/parts/dialogs/dialog.web.contribution';

//#endregion


//#region --- workbench (web main)

import 'vs/workbench/browser/web.main';

//#endregion


//#region --- workbench services

import 'vs/workbench/services/integrity/browser/integrityService';
import 'vs/workbench/services/textMate/browser/textMateService';
import 'vs/workbench/services/search/browser/searchService';
import 'vs/workbench/services/textfile/browser/browserTextFileService';
import 'vs/workbench/services/keybinding/browser/keyboardLayoutService';
import 'vs/workbench/services/extensions/browser/extensionService';
import 'vs/workbench/services/extensionManagement/common/extensionManagementServerService';
import 'vs/workbench/services/extensionManagement/browser/extensionUrlTrustService';
import 'vs/workbench/services/telemetry/browser/telemetryService';
import 'vs/workbench/services/credentials/browser/credentialsService';
import 'vs/workbench/services/url/browser/urlService';
import 'vs/workbench/services/update/browser/updateService';
import 'vs/workbench/services/workspaces/browser/workspacesService';
import 'vs/workbench/services/workspaces/browser/workspaceEditingService';
import 'vs/workbench/services/dialogs/browser/fileDialogService';
import 'vs/workbench/services/host/browser/browserHostService';
import 'vs/workbench/services/lifecycle/browser/lifecycleService';
import 'vs/workbench/services/clipboard/browser/clipboardService';
import 'vs/workbench/services/extensionResourceLoader/browser/extensionResourceLoaderService';
import 'vs/workbench/services/path/browser/pathService';
import 'vs/workbench/services/themes/browser/browserHostColorSchemeService';
import 'vs/workbench/services/encryption/browser/encryptionService';
import 'vs/workbench/services/workingCopy/browser/workingCopyBackupService';
import 'vs/workbench/services/remote/browser/tunnelServiceImpl';
import 'vs/workbench/services/userDataSync/browser/userDataAutoSyncEnablementService';
import 'vs/workbench/services/files/browser/elevatedFileService';

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ContextMenuService } from 'vs/platform/contextview/browser/contextMenuService';
import { IExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionTipsService';
import { IWorkbenchExtensionManagementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ExtensionManagementService } from 'vs/workbench/services/extensionManagement/common/extensionManagementService';
import { ILoggerService } from 'vs/platform/log/common/log';
import { FileLoggerService } from 'vs/platform/log/common/fileLog';
import { UserDataSyncMachinesService, IUserDataSyncMachinesService } from 'vs/platform/userDataSync/common/userDataSyncMachines';
import { IUserDataSyncStoreService, IUserDataSyncService, IUserDataSyncLogService, IUserDataAutoSyncService, IUserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncLogService } from 'vs/platform/userDataSync/common/userDataSyncLog';
import { UserDataSyncStoreService } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { UserDataSyncBackupStoreService } from 'vs/platform/userDataSync/common/userDataSyncBackupStoreService';
import { UserDataSyncService } from 'vs/platform/userDataSync/common/userDataSyncService';
import { IUserDataSyncAccountService, UserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { UserDataAutoSyncService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';
import { AccessibilityService } from 'vs/platform/accessibility/common/accessibilityService';
import { ICustomEndpointTelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullEndpointTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { ITitleService } from 'vs/workbench/services/title/common/titleService';
import { TitlebarPart } from 'vs/workbench/browser/parts/titlebar/titlebarPart';
import { ITimerService, TimerService } from 'vs/workbench/services/timer/browser/timerService';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { ConfigurationResolverService } from 'vs/workbench/services/configurationResolver/browser/configurationResolverService';

registerSingleton(IWorkbenchExtensionManagementService, ExtensionManagementService);
registerSingleton(IAccessibilityService, AccessibilityService, true);
registerSingleton(IContextMenuService, ContextMenuService);
registerSingleton(ILoggerService, FileLoggerService);
registerSingleton(IUserDataSyncLogService, UserDataSyncLogService);
registerSingleton(IUserDataSyncStoreService, UserDataSyncStoreService);
registerSingleton(IUserDataSyncMachinesService, UserDataSyncMachinesService);
registerSingleton(IUserDataSyncBackupStoreService, UserDataSyncBackupStoreService);
registerSingleton(IUserDataSyncAccountService, UserDataSyncAccountService);
registerSingleton(IUserDataSyncService, UserDataSyncService);
registerSingleton(IUserDataAutoSyncService, UserDataAutoSyncService);
registerSingleton(ITitleService, TitlebarPart);
registerSingleton(IExtensionTipsService, ExtensionTipsService);
registerSingleton(ITimerService, TimerService);
registerSingleton(IConfigurationResolverService, ConfigurationResolverService, true);
registerSingleton(ICustomEndpointTelemetryService, NullEndpointTelemetryService, true);

//#endregion


//#region --- workbench contributions

// Output
import 'vs/workbench/contrib/output/common/outputChannelModelService';

// Explorer
import 'vs/workbench/contrib/files/browser/files.web.contribution';

// Preferences
import 'vs/workbench/contrib/preferences/browser/keyboardLayoutPicker';

// Debug
import 'vs/workbench/contrib/debug/browser/extensionHostDebugService';

// Webview
import 'vs/workbench/contrib/webview/browser/webview.web.contribution';

// Extensions Management
import 'vs/workbench/contrib/extensions/browser/extensions.web.contribution';

// Terminal
import 'vs/workbench/contrib/terminal/browser/terminal.web.contribution';
import 'vs/workbench/contrib/externalTerminal/browser/externalTerminal.contribution';
import 'vs/workbench/contrib/terminal/browser/terminalInstanceService';

// Tasks
import 'vs/workbench/contrib/tasks/browser/taskService';

// Tags
import 'vs/workbench/contrib/tags/browser/workspaceTagsService';

// Telemetry Opt Out
import 'vs/workbench/contrib/welcome/telemetryOptOut/browser/telemetryOptOut.contribution';

// Issues
import 'vs/workbench/contrib/issue/browser/issue.web.contribution';

//#endregion
