/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { TextFileEditor } from 'vs/workbench/contrib/files/browser/editors/textFileEditor';
import { FileEditorInput } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { EditorOptions } from 'vs/workbench/common/editor';
import { FileOperationError, FileOperationResult, IFileService, MIN_MAX_MEMORY_SIZE_MB, FALLBACK_MAX_MEMORY_SIZE_MB } from 'vs/platform/files/common/files';
import { createErrorWithActions } from 'vs/base/common/errors';
import { toAction } from 'vs/base/common/actions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { IExplorerService } from 'vs/workbench/contrib/files/browser/files';
import { IProductService } from 'vs/platform/product/common/productService';

/**
 * An implementation of editor for file system resources.
 */
export class NativeTextFileEditor extends TextFileEditor {

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IFileService fileService: IFileService,
		@IViewletService viewletService: IViewletService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IEditorService editorService: IEditorService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@ITextFileService textFileService: ITextFileService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IExplorerService explorerService: IExplorerService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IProductService private readonly productService: IProductService
	) {
		super(telemetryService, fileService, viewletService, instantiationService, contextService, storageService, textResourceConfigurationService, editorService, themeService, editorGroupService, textFileService, explorerService, uriIdentityService);
	}

	protected override handleSetInputError(error: Error, input: FileEditorInput, options: EditorOptions | undefined): void {

		// Allow to restart with higher memory limit if the file is too large
		if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_EXCEEDS_MEMORY_LIMIT) {
			const memoryLimit = Math.max(MIN_MAX_MEMORY_SIZE_MB, +this.textResourceConfigurationService.getValue<number>(undefined, 'files.maxMemoryForLargeFilesMB') || FALLBACK_MAX_MEMORY_SIZE_MB);

			throw createErrorWithActions(localize('fileTooLargeForHeapError', "To open a file of this size, you need to restart and allow {0} to use more memory", this.productService.nameShort), {
				actions: [
					toAction({
						id: 'workbench.window.action.relaunchWithIncreasedMemoryLimit', label: localize('relaunchWithIncreasedMemoryLimit', "Restart with {0} MB", memoryLimit), run: () => {
							return this.nativeHostService.relaunch({
								addArgs: [
									`--max-memory=${memoryLimit}`
								]
							});
						}
					}),
					toAction({
						id: 'workbench.window.action.configureMemoryLimit', label: localize('configureMemoryLimit', 'Configure Memory Limit'), run: () => {
							return this.preferencesService.openGlobalSettings(undefined, { query: 'files.maxMemoryForLargeFilesMB' });
						}
					}),
				]
			});
		}

		// Fallback to handling in super type
		super.handleSetInputError(error, input, options);
	}
}
