/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { SearchEditorStoredFileWorkingCopyModel, SearchEditorStoredFileWorkingCopyModelFactory, SearchEditorUntitledFileWorkingCopyModel, SearchEditorUntitledFileWorkingCopyModelFactory } from 'vs/workbench/contrib/searchEditor2/browser/searchEditorWorkingCopy';
import { IDialogService, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IFileService } from 'vs/platform/files/common/files';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { Disposable } from 'vs/base/common/lifecycle';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ILabelService } from 'vs/platform/label/common/label';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IElevatedFileService } from 'vs/workbench/services/files/common/elevatedFileService';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { IWorkingCopyEditorService } from 'vs/workbench/services/workingCopy/common/workingCopyEditorService';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { FileWorkingCopyManager, IFileWorkingCopyManager } from 'vs/workbench/services/workingCopy/common/fileWorkingCopyManager';

export const ISearchEditorService = createDecorator<ISearchEditorService>('searchEditorService');

export interface ISearchEditorService {

	readonly _serviceBrand: undefined;

	readonly manager: IFileWorkingCopyManager<SearchEditorStoredFileWorkingCopyModel, SearchEditorUntitledFileWorkingCopyModel>;
}

export class SearchEditorService extends Disposable implements ISearchEditorService {

	_serviceBrand: undefined;

	readonly manager: IFileWorkingCopyManager<SearchEditorStoredFileWorkingCopyModel, SearchEditorUntitledFileWorkingCopyModel>;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IFileService fileService: IFileService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILabelService labelService: ILabelService,
		@ILogService logService: ILogService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IWorkingCopyBackupService workingCopyBackupService: IWorkingCopyBackupService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IFileDialogService fileDialogService: IFileDialogService,
		@ITextFileService textFileService: ITextFileService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@INotificationService notificationService: INotificationService,
		@IWorkingCopyEditorService workingCopyEditorService: IWorkingCopyEditorService,
		@IEditorService editorService: IEditorService,
		@IElevatedFileService elevatedFileService: IElevatedFileService,
		@IPathService pathService: IPathService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IDialogService dialogService: IDialogService
	) {
		super();

		this.manager = this._register(new FileWorkingCopyManager(
			'searchWorkingCopy',
			new SearchEditorStoredFileWorkingCopyModelFactory(instantiationService),
			new SearchEditorUntitledFileWorkingCopyModelFactory(instantiationService),
			fileService, lifecycleService, labelService, logService,
			workingCopyFileService, workingCopyBackupService, uriIdentityService, fileDialogService,
			textFileService, filesConfigurationService, workingCopyService, notificationService,
			workingCopyEditorService, editorService, elevatedFileService, pathService,
			environmentService, dialogService,
		));
	}
}
