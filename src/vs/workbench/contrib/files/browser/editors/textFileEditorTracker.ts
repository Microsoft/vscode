/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { URI } from 'vs/base/common/uri';
import { ITextFileService, TextFileEditorModelState } from 'vs/workbench/services/textfile/common/textfiles';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Disposable } from 'vs/base/common/lifecycle';
import { distinct, coalesce } from 'vs/base/common/arrays';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { RunOnceWorker } from 'vs/base/common/async';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IFilesConfigurationService, AutoSaveMode } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { FILE_EDITOR_INPUT_ID } from 'vs/workbench/contrib/files/common/files';
import { Schemas } from 'vs/base/common/network';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';

export class TextFileEditorTracker extends Disposable implements IWorkbenchContribution {

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IHostService private readonly hostService: IHostService,
		@ICodeEditorService private readonly codeEditorService: ICodeEditorService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		// Ensure dirty text file and untitled models are always opened as editors
		this._register(this.textFileService.files.onDidChangeDirty(model => this.ensureDirtyFilesAreOpenedWorker.work(model.resource)));
		this._register(this.textFileService.files.onDidSaveError(model => this.ensureDirtyFilesAreOpenedWorker.work(model.resource)));
		this._register(this.textFileService.untitled.onDidChangeDirty(model => this.ensureDirtyFilesAreOpenedWorker.work(model.resource)));

		// Update visible text file editors when focus is gained
		this._register(this.hostService.onDidChangeFocus(hasFocus => hasFocus ? this.reloadVisibleTextFileEditors() : undefined));

		// Lifecycle
		this.lifecycleService.onDidShutdown(() => this.dispose());
	}

	//#region Text File: Ensure every dirty text and untitled file is opened in an editor

	private readonly ensureDirtyFilesAreOpenedWorker = this._register(new RunOnceWorker<URI>(units => this.ensureDirtyTextFilesAreOpened(units), 50));

	private ensureDirtyTextFilesAreOpened(resources: URI[]): void {
		this.doEnsureDirtyTextFilesAreOpened(distinct(resources.filter(resource => {
			if (!this.textFileService.isDirty(resource)) {
				return false; // resource must be dirty
			}

			const model = this.textFileService.files.get(resource);
			if (model?.hasState(TextFileEditorModelState.PENDING_SAVE)) {
				return false; // resource must not be pending to save
			}

			if (this.filesConfigurationService.getAutoSaveMode() === AutoSaveMode.AFTER_SHORT_DELAY && !model?.hasState(TextFileEditorModelState.ERROR)) {
				// leave models auto saved after short delay unless
				// the save resulted in an error
				return false;
			}

			if (this.editorService.isOpened({ resource, typeId: resource.scheme === Schemas.untitled ? UntitledTextEditorInput.ID : FILE_EDITOR_INPUT_ID })) {
				return false; // model must not be opened already as file
			}

			return true;
		}), resource => resource.toString()));
	}

	private doEnsureDirtyTextFilesAreOpened(resources: URI[]): void {
		if (!resources.length) {
			return;
		}

		this.editorService.openEditors(resources.map(resource => ({
			resource,
			options: { inactive: true, pinned: true, preserveFocus: true }
		})));
	}

	//#endregion

	//#region Window Focus Change: Update visible code editors when focus is gained that have a known text file model

	private reloadVisibleTextFileEditors(): void {
		// the window got focus and we use this as a hint that files might have been changed outside
		// of this window. since file events can be unreliable, we queue a load for models that
		// are visible in any editor. since this is a fast operation in the case nothing has changed,
		// we tolerate the additional work.
		distinct(
			coalesce(this.codeEditorService.listCodeEditors()
				.map(codeEditor => {
					const resource = codeEditor.getModel()?.uri;
					if (!resource) {
						return undefined;
					}

					const model = this.textFileService.files.get(resource);
					if (!model || model.isDirty() || !model.isResolved()) {
						return undefined;
					}

					return model;
				})),
			model => model.resource.toString()
		).forEach(model => this.textFileService.files.resolve(model.resource, { reload: { async: true } }));
	}

	//#endregion
}
