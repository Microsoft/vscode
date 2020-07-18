/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { isFunction, assertIsDefined } from 'vs/base/common/types';
import { isValidBasename } from 'vs/base/common/extpath';
import { basename } from 'vs/base/common/resources';
import { Action } from 'vs/base/common/actions';
import { VIEWLET_ID, TEXT_FILE_EDITOR_ID, IExplorerService } from 'vs/workbench/contrib/files/common/files';
import { ITextFileService, TextFileOperationError, TextFileOperationResult } from 'vs/workbench/services/textfile/common/textfiles';
import { BaseTextEditor } from 'vs/workbench/browser/parts/editor/textEditor';
import { EditorOptions, TextEditorOptions, IEditorInput } from 'vs/workbench/common/editor';
import { BinaryEditorModel } from 'vs/workbench/common/editor/binaryEditorModel';
import { FileEditorInput } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { FileOperationError, FileOperationResult, FileChangesEvent, IFileService, FileOperationEvent, FileOperation } from 'vs/platform/files/common/files';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { createErrorWithActions } from 'vs/base/common/errorsWithActions';
import { EditorActivation, IEditorOptions } from 'vs/platform/editor/common/editor';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

/**
 * An implementation of editor for file system resources.
 */
export class TextFileEditor extends BaseTextEditor {

	static readonly ID = TEXT_FILE_EDITOR_ID;

	constructor(
		@ITelemetryService telemetryService: ITelemetryService,
		@IFileService private readonly fileService: IFileService,
		@IViewletService private readonly viewletService: IViewletService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IStorageService storageService: IStorageService,
		@ITextResourceConfigurationService textResourceConfigurationService: ITextResourceConfigurationService,
		@IEditorService editorService: IEditorService,
		@IThemeService themeService: IThemeService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super(TextFileEditor.ID, telemetryService, instantiationService, storageService, textResourceConfigurationService, themeService, editorService, editorGroupService);

		// Clear view state for deleted files
		this._register(this.fileService.onDidFilesChange(e => this.onDidFilesChange(e)));

		// Move view state for moved files
		this._register(this.fileService.onDidRunOperation(e => this.onDidRunOperation(e)));
	}

	private onDidFilesChange(e: FileChangesEvent): void {
		const deleted = e.getDeleted();
		if (deleted?.length) {
			this.clearTextEditorViewState(deleted.map(d => d.resource));
		}
	}

	private onDidRunOperation(e: FileOperationEvent): void {
		if (e.operation === FileOperation.MOVE && e.target) {
			this.moveTextEditorViewState(e.resource, e.target.resource, this.uriIdentityService.extUri);
		}
	}

	protected onWillCloseEditorInGroup(editor: IEditorInput): void {

		// React to editors closing to preserve or clear view state. This needs to happen
		// in the onWillCloseEditor because at that time the editor has not yet
		// been disposed and we can safely persist the view state still as needed.
		this.doSaveOrClearTextEditorViewState(editor);
	}

	getTitle(): string {
		return this.input ? this.input.getName() : nls.localize('textFileEditor', "Text File Editor");
	}

	get input(): FileEditorInput | undefined {
		return this._input as FileEditorInput;
	}

	async setInput(input: FileEditorInput, options: EditorOptions | undefined, token: CancellationToken): Promise<void> {

		// Update/clear view settings if input changes
		this.doSaveOrClearTextEditorViewState(this.input);

		// Set input and resolve
		await super.setInput(input, options, token);
		try {
			const resolvedModel = await input.resolve();

			// Check for cancellation
			if (token.isCancellationRequested) {
				return;
			}

			// There is a special case where the text editor has to handle binary file editor input: if a binary file
			// has been resolved and cached before, it maybe an actual instance of BinaryEditorModel. In this case our text
			// editor has to open this model using the binary editor. We return early in this case.
			if (resolvedModel instanceof BinaryEditorModel) {
				return this.openAsBinary(input, options);
			}

			const textFileModel = resolvedModel;

			// Editor
			const textEditor = assertIsDefined(this.getControl());
			textEditor.setModel(textFileModel.textEditorModel);

			// Always restore View State if any associated
			const editorViewState = this.loadTextEditorViewState(input.resource);
			if (editorViewState) {
				textEditor.restoreViewState(editorViewState);
			}

			// TextOptions (avoiding instanceof here for a reason, do not change!)
			if (options && isFunction((<TextEditorOptions>options).apply)) {
				(<TextEditorOptions>options).apply(textEditor, ScrollType.Immediate);
			}

			// Since the resolved model provides information about being readonly
			// or not, we apply it here to the editor even though the editor input
			// was already asked for being readonly or not. The rationale is that
			// a resolved model might have more specific information about being
			// readonly or not that the input did not have.
			textEditor.updateOptions({ readOnly: textFileModel.isReadonly() });
		} catch (error) {
			this.handleSetInputError(error, input, options);
		}
	}

	protected handleSetInputError(error: Error, input: FileEditorInput, options: EditorOptions | undefined): void {

		// In case we tried to open a file inside the text editor and the response
		// indicates that this is not a text file, reopen the file through the binary
		// editor.
		if ((<TextFileOperationError>error).textFileOperationResult === TextFileOperationResult.FILE_IS_BINARY) {
			return this.openAsBinary(input, options);
		}

		// Similar, handle case where we were asked to open a folder in the text editor.
		if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_IS_DIRECTORY) {
			this.openAsFolder(input);

			throw new Error(nls.localize('openFolderError', "File is a directory"));
		}

		// Offer to create a file from the error if we have a file not found and the name is valid
		if ((<FileOperationError>error).fileOperationResult === FileOperationResult.FILE_NOT_FOUND && isValidBasename(basename(input.resource))) {
			throw createErrorWithActions(toErrorMessage(error), {
				actions: [
					new Action('workbench.files.action.createMissingFile', nls.localize('createFile', "Create File"), undefined, true, async () => {
						await this.textFileService.create(input.resource);

						return this.editorService.openEditor({
							resource: input.resource,
							options: {
								pinned: true // new file gets pinned by default
							}
						});
					})
				]
			});
		}

		// Otherwise make sure the error bubbles up
		throw error;
	}

	private openAsBinary(input: FileEditorInput, options: EditorOptions | undefined): void {
		input.setForceOpenAsBinary();

		// Make sure to not steal away the currently active group
		// because we are triggering another openEditor() call
		// and do not control the initial intent that resulted
		// in us now opening as binary.
		const preservingOptions: IEditorOptions = { activation: EditorActivation.PRESERVE };
		if (options) {
			options.overwrite(preservingOptions);
		} else {
			options = EditorOptions.create(preservingOptions);
		}

		this.editorService.openEditor(input, options, this.group);
	}

	private async openAsFolder(input: FileEditorInput): Promise<void> {
		if (!this.group) {
			return;
		}

		// Since we cannot open a folder, we have to restore the previous input if any and close the editor
		await this.group.closeEditor(this.input);

		// Best we can do is to reveal the folder in the explorer
		if (this.contextService.isInsideWorkspace(input.resource)) {
			await this.viewletService.openViewlet(VIEWLET_ID);

			this.explorerService.select(input.resource, true);
		}
	}

	clearInput(): void {

		// Update/clear editor view state in settings
		this.doSaveOrClearTextEditorViewState(this.input);

		// Clear Model
		const textEditor = this.getControl();
		if (textEditor) {
			textEditor.setModel(null);
		}

		// Pass to super
		super.clearInput();
	}

	protected saveState(): void {

		// Update/clear editor view State
		this.doSaveOrClearTextEditorViewState(this.input);

		super.saveState();
	}

	private doSaveOrClearTextEditorViewState(input: IEditorInput | undefined): void {
		if (!(input instanceof FileEditorInput)) {
			return; // ensure we have an input to handle view state for
		}

		// If the user configured to not restore view state, we clear the view
		// state unless the editor is still opened in the group.
		if (!this.shouldRestoreViewState && (!this.group || !this.group.isOpened(input))) {
			this.clearTextEditorViewState([input.resource], this.group);
		}

		// Otherwise we save the view state to restore it later
		else if (!input.isDisposed()) {
			this.saveTextEditorViewState(input.resource);
		}
	}
}
