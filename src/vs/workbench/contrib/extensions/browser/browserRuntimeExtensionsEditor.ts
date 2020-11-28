/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IExtensionService, IExtensionHostProfile } from 'vs/workbench/services/extensions/common/extensions';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ILabelService } from 'vs/platform/label/common/label';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { AbstractRuntimeExtensionsEditor, IRuntimeExtension } from 'vs/workbench/contrib/extensions/browser/abstractRuntimeExtensionsEditor';

export class RuntimeExtensionsEditor extends AbstractRuntimeExtensionsEditor {

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionService extensionService: IExtensionService,
		@INotificationService notificationService: INotificationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@ILabelService labelService: ILabelService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
	) {
		super(telemetryService, themeService, contextKeyService, extensionsWorkbenchService, extensionService, notificationService, contextMenuService, instantiationService, storageService, labelService, environmentService);
	}

	protected _getProfileInfo(): IExtensionHostProfile | null {
		return null;
	}

	protected _getUnresponsiveProfile(extensionId: ExtensionIdentifier): IExtensionHostProfile | undefined {
		return undefined;
	}

	protected _createSlowExtensionAction(element: IRuntimeExtension): Action | null {
		return null;
	}

	protected _createReportExtensionIssueAction(element: IRuntimeExtension): Action | null {
		return null;
	}

	protected _createSaveExtensionHostProfileAction(): Action | null {
		return null;
	}

	protected _createProfileAction(): Action | null {
		return null;
	}
}
