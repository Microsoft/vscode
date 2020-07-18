/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';

// --- other interested parties
import { JSONValidationExtensionPoint } from 'vs/workbench/api/common/jsonValidationExtensionPoint';
import { ColorExtensionPoint } from 'vs/workbench/services/themes/common/colorExtensionPoint';
import { TokenClassificationExtensionPoints } from 'vs/workbench/services/themes/common/tokenClassificationExtensionPoint';
import { LanguageConfigurationFileHandler } from 'vs/workbench/contrib/codeEditor/browser/languageConfigurationExtensionPoint';

// --- mainThread participants
import './mainThreadCodeInsets';
import './mainThreadClipboard';
import './mainThreadCommands';
import './mainThreadConfiguration';
import './mainThreadConsole';
import './mainThreadDebugService';
import './mainThreadDecorations';
import './mainThreadDiagnostics';
import './mainThreadDialogs';
import './mainThreadDocumentContentProviders';
import './mainThreadDocuments';
import './mainThreadDocumentsAndEditors';
import './mainThreadEditor';
import './mainThreadEditors';
import './mainThreadErrors';
import './mainThreadExtensionService';
import './mainThreadFileSystem';
import './mainThreadFileSystemEventService';
import './mainThreadKeytar';
import './mainThreadLanguageFeatures';
import './mainThreadLanguages';
import './mainThreadLogService';
import './mainThreadMessageService';
import './mainThreadOutputService';
import './mainThreadProgress';
import './mainThreadQuickOpen';
import './mainThreadRemoteConnectionData';
import './mainThreadSaveParticipant';
import './mainThreadSCM';
import './mainThreadSearch';
import './mainThreadStatusBar';
import './mainThreadStorage';
import './mainThreadTelemetry';
import './mainThreadTerminalService';
import './mainThreadTheming';
import './mainThreadTreeViews';
import './mainThreadDownloadService';
import './mainThreadUrls';
import './mainThreadWindow';
import './mainThreadWebview';
import './mainThreadWorkspace';
import './mainThreadComments';
import './mainThreadNotebook';
import './mainThreadTask';
import './mainThreadLabelService';
import './mainThreadTunnelService';
import './mainThreadAuthentication';
import './mainThreadTimeline';
import 'vs/workbench/api/common/apiCommands';

export class ExtensionPoints implements IWorkbenchContribution {

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		// Classes that handle extension points...
		this.instantiationService.createInstance(JSONValidationExtensionPoint);
		this.instantiationService.createInstance(ColorExtensionPoint);
		this.instantiationService.createInstance(TokenClassificationExtensionPoints);
		this.instantiationService.createInstance(LanguageConfigurationFileHandler);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(ExtensionPoints, LifecyclePhase.Starting);
