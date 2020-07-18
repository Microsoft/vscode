/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//#region --- editor/workbench core

import 'vs/editor/editor.all';

import 'vs/workbench/api/browser/extensionHost.contribution';
import 'vs/workbench/browser/workbench.contribution';

//#endregion


//#region --- workbench actions

import 'vs/workbench/browser/actions/textInputActions';
import 'vs/workbench/browser/actions/developerActions';
import 'vs/workbench/browser/actions/helpActions';
import 'vs/workbench/browser/actions/layoutActions';
import 'vs/workbench/browser/actions/listCommands';
import 'vs/workbench/browser/actions/navigationActions';
import 'vs/workbench/browser/actions/windowActions';
import 'vs/workbench/browser/actions/workspaceActions';
import 'vs/workbench/browser/actions/workspaceCommands';
import 'vs/workbench/browser/actions/quickAccessActions';

//#endregion


//#region --- API Extension Points

import 'vs/workbench/api/common/menusExtensionPoint';
import 'vs/workbench/api/common/configurationExtensionPoint';
import 'vs/workbench/api/browser/viewsExtensionPoint';

//#endregion


//#region --- workbench parts

import 'vs/workbench/browser/parts/editor/editorPart';
import 'vs/workbench/browser/parts/activitybar/activitybarPart';
import 'vs/workbench/browser/parts/panel/panelPart';
import 'vs/workbench/browser/parts/sidebar/sidebarPart';
import 'vs/workbench/browser/parts/statusbar/statusbarPart';
import 'vs/workbench/browser/parts/views/viewsService';

//#endregion


//#region --- workbench services

import 'vs/platform/undoRedo/common/undoRedoService';
import 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import 'vs/workbench/services/extensions/browser/extensionUrlHandler';
import 'vs/workbench/services/bulkEdit/browser/bulkEditService';
import 'vs/workbench/services/keybinding/common/keybindingEditing';
import 'vs/workbench/services/decorations/browser/decorationsService';
import 'vs/workbench/services/progress/browser/progressService';
import 'vs/workbench/services/editor/browser/codeEditorService';
import 'vs/workbench/services/preferences/browser/preferencesService';
import 'vs/workbench/services/configuration/common/jsonEditingService';
import 'vs/workbench/services/textmodelResolver/common/textModelResolverService';
import 'vs/workbench/services/editor/browser/editorService';
import 'vs/workbench/services/history/browser/history';
import 'vs/workbench/services/activity/browser/activityService';
import 'vs/workbench/services/keybinding/browser/keybindingService';
import 'vs/workbench/services/untitled/common/untitledTextEditorService';
import 'vs/workbench/services/textresourceProperties/common/textResourcePropertiesService';
import 'vs/workbench/services/mode/common/workbenchModeService';
import 'vs/workbench/services/commands/common/commandService';
import 'vs/workbench/services/themes/browser/workbenchThemeService';
import 'vs/workbench/services/label/common/labelService';
import 'vs/workbench/services/extensionManagement/common/webExtensionsScannerService';
import 'vs/workbench/services/extensionManagement/common/extensionEnablementService';
import 'vs/workbench/services/extensionManagement/browser/builtinExtensionsScannerService';
import 'vs/workbench/services/notification/common/notificationService';
import 'vs/workbench/services/userDataSync/common/userDataSyncUtil';
import 'vs/workbench/services/remote/common/remoteExplorerService';
import 'vs/workbench/services/workingCopy/common/workingCopyService';
import 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import 'vs/workbench/services/views/browser/viewDescriptorService';
import 'vs/workbench/services/quickinput/browser/quickInputService';
import 'vs/workbench/services/userDataSync/browser/userDataSyncWorkbenchService';
import 'vs/workbench/services/authentication/browser/authenticationService';
import 'vs/workbench/services/hover/browser/hoverService';

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionGalleryService';
import { GlobalExtensionEnablementService } from 'vs/platform/extensionManagement/common/extensionEnablementService';
import { IExtensionGalleryService, IGlobalExtensionEnablementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ContextViewService } from 'vs/platform/contextview/browser/contextViewService';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IListService, ListService } from 'vs/platform/list/browser/listService';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { EditorWorkerServiceImpl } from 'vs/editor/common/services/editorWorkerServiceImpl';
import { MarkerDecorationsService } from 'vs/editor/common/services/markerDecorationsServiceImpl';
import { IMarkerDecorationsService } from 'vs/editor/common/services/markersDecorationService';
import { IMarkerService } from 'vs/platform/markers/common/markers';
import { MarkerService } from 'vs/platform/markers/common/markerService';
import { ContextKeyService } from 'vs/platform/contextkey/browser/contextKeyService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { TextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationServiceImpl';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { MenuService } from 'vs/platform/actions/common/menuService';
import { IDownloadService } from 'vs/platform/download/common/download';
import { DownloadService } from 'vs/platform/download/common/downloadService';
import { OpenerService } from 'vs/editor/browser/services/openerService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IUserDataSyncResourceEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { UserDataSyncResourceEnablementService } from 'vs/platform/userDataSync/common/userDataSyncResourceEnablementService';

registerSingleton(IUserDataSyncResourceEnablementService, UserDataSyncResourceEnablementService);
registerSingleton(IGlobalExtensionEnablementService, GlobalExtensionEnablementService);
registerSingleton(IExtensionGalleryService, ExtensionGalleryService, true);
registerSingleton(IContextViewService, ContextViewService, true);
registerSingleton(IListService, ListService, true);
registerSingleton(IEditorWorkerService, EditorWorkerServiceImpl);
registerSingleton(IMarkerDecorationsService, MarkerDecorationsService);
registerSingleton(IMarkerService, MarkerService, true);
registerSingleton(IContextKeyService, ContextKeyService);
registerSingleton(IModelService, ModelServiceImpl, true);
registerSingleton(ITextResourceConfigurationService, TextResourceConfigurationService);
registerSingleton(IMenuService, MenuService, true);
registerSingleton(IDownloadService, DownloadService, true);
registerSingleton(IOpenerService, OpenerService, true);

//#endregion


//#region --- workbench contributions

// Telemetry
import 'vs/workbench/contrib/telemetry/browser/telemetry.contribution';

// Preferences
import 'vs/workbench/contrib/preferences/browser/preferences.contribution';
import 'vs/workbench/contrib/preferences/browser/keybindingsEditorContribution';
import 'vs/workbench/contrib/preferences/browser/preferencesSearch';

// Performance
import 'vs/workbench/contrib/performance/browser/performance.contribution';

// Notebook
import 'vs/workbench/contrib/notebook/browser/notebook.contribution';

// Logs
import 'vs/workbench/contrib/logs/common/logs.contribution';

// Quickaccess
import 'vs/workbench/contrib/quickaccess/browser/quickAccess.contribution';

// Explorer
import 'vs/workbench/contrib/files/browser/explorerViewlet';
import 'vs/workbench/contrib/files/browser/fileActions.contribution';
import 'vs/workbench/contrib/files/browser/files.contribution';

// Backup
import 'vs/workbench/contrib/backup/common/backup.contribution';

// bulkEdit
import 'vs/workbench/contrib/bulkEdit/browser/bulkEdit.contribution';

// Search
import 'vs/workbench/contrib/search/browser/search.contribution';
import 'vs/workbench/contrib/search/browser/searchView';

// Search Editor
import 'vs/workbench/contrib/searchEditor/browser/searchEditor.contribution';

// Sash
import 'vs/workbench/contrib/sash/browser/sash.contribution';

// SCM
import 'vs/workbench/contrib/scm/browser/scm.contribution';

// Debug
import 'vs/workbench/contrib/debug/browser/debug.contribution';
import 'vs/workbench/contrib/debug/browser/debugEditorContribution';
import 'vs/workbench/contrib/debug/browser/breakpointEditorContribution';
import 'vs/workbench/contrib/debug/browser/callStackEditorContribution';
import 'vs/workbench/contrib/debug/browser/repl';
import 'vs/workbench/contrib/debug/browser/debugViewlet';

// Markers
import 'vs/workbench/contrib/markers/browser/markers.contribution';

// Comments
import 'vs/workbench/contrib/comments/browser/comments.contribution';

// URL Support
import 'vs/workbench/contrib/url/browser/url.contribution';

// Webview
import 'vs/workbench/contrib/webview/browser/webview.contribution';
import 'vs/workbench/contrib/customEditor/browser/customEditor.contribution';

// Extensions Management
import 'vs/workbench/contrib/extensions/browser/extensions.contribution';
import 'vs/workbench/contrib/extensions/browser/extensionsViewlet';

// Output View
import 'vs/workbench/contrib/output/browser/output.contribution';
import 'vs/workbench/contrib/output/browser/outputView';

// Terminal
import 'vs/workbench/contrib/terminal/common/environmentVariable.contribution';
import 'vs/workbench/contrib/terminal/common/terminalExtensionPoints.contribution';
import 'vs/workbench/contrib/terminal/browser/terminal.contribution';
import 'vs/workbench/contrib/terminal/browser/terminalView';

// Relauncher
import 'vs/workbench/contrib/relauncher/browser/relauncher.contribution';

// Tasks
import 'vs/workbench/contrib/tasks/browser/task.contribution';

// Remote
import 'vs/workbench/contrib/remote/common/remote.contribution';
import 'vs/workbench/contrib/remote/browser/remote';

// Emmet
import 'vs/workbench/contrib/emmet/browser/emmet.contribution';

// CodeEditor Contributions
import 'vs/workbench/contrib/codeEditor/browser/codeEditor.contribution';

// Execution
import 'vs/workbench/contrib/externalTerminal/browser/externalTerminal.contribution';

// Snippets
import 'vs/workbench/contrib/snippets/browser/snippets.contribution';
import 'vs/workbench/contrib/snippets/browser/snippetsService';
import 'vs/workbench/contrib/snippets/browser/insertSnippet';
import 'vs/workbench/contrib/snippets/browser/configureSnippets';
import 'vs/workbench/contrib/snippets/browser/tabCompletion';

// Formatter Help
import 'vs/workbench/contrib/format/browser/format.contribution';

// Themes
import 'vs/workbench/contrib/themes/browser/themes.contribution';

// Update
import 'vs/workbench/contrib/update/browser/update.contribution';

// Watermark
import 'vs/workbench/contrib/watermark/browser/watermark';

// Surveys
import 'vs/workbench/contrib/surveys/browser/nps.contribution';
import 'vs/workbench/contrib/surveys/browser/languageSurveys.contribution';

// Welcome
import 'vs/workbench/contrib/welcome/overlay/browser/welcomeOverlay';
import 'vs/workbench/contrib/welcome/page/browser/welcomePage.contribution';
import 'vs/workbench/contrib/welcome/walkThrough/browser/walkThrough.contribution';

// Call Hierarchy
import 'vs/workbench/contrib/callHierarchy/browser/callHierarchy.contribution';

// Outline
import 'vs/workbench/contrib/outline/browser/outline.contribution';

// Experiments
import 'vs/workbench/contrib/experiments/browser/experiments.contribution';

// Send a Smile
import 'vs/workbench/contrib/feedback/browser/feedback.contribution';

// User Data Sync
import 'vs/workbench/contrib/userDataSync/browser/userDataSync.contribution';

// Code Actions
import 'vs/workbench/contrib/codeActions/common/codeActions.contribution';

// Welcome
import 'vs/workbench/contrib/welcome/common/viewsWelcome.contribution';

// Timeline
import 'vs/workbench/contrib/timeline/browser/timeline.contribution';

//#endregion
