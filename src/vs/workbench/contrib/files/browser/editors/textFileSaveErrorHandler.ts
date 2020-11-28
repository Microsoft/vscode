/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { basename, isEqual } from 'vs/base/common/resources';
import { Action, IAction } from 'vs/base/common/actions';
import { URI } from 'vs/base/common/uri';
import { FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { ITextFileService, ISaveErrorHandler, ITextFileEditorModel, IResolvedTextFileEditorModel, IWriteTextFileOptions } from 'vs/workbench/services/textfile/common/textfiles';
import { ServicesAccessor, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable, dispose, Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ResourceMap } from 'vs/base/common/map';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { TextFileContentProvider } from 'vs/workbench/contrib/files/common/files';
import { FileEditorInput } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { SAVE_FILE_COMMAND_ID, REVERT_FILE_COMMAND_ID, SAVE_FILE_AS_COMMAND_ID, SAVE_FILE_AS_LABEL } from 'vs/workbench/contrib/files/browser/fileCommands';
import { INotificationService, INotificationHandle, INotificationActions, Severity } from 'vs/platform/notification/common/notification';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ExecuteCommandAction } from 'vs/platform/actions/common/actions';
import { IProductService } from 'vs/platform/product/common/productService';
import { Event } from 'vs/base/common/event';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { isWindows } from 'vs/base/common/platform';
import { Schemas } from 'vs/base/common/network';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { SaveReason } from 'vs/workbench/common/editor';

export const CONFLICT_RESOLUTION_CONTEXT = 'saveConflictResolutionContext';
export const CONFLICT_RESOLUTION_SCHEME = 'conflictResolution';

const LEARN_MORE_DIRTY_WRITE_IGNORE_KEY = 'learnMoreDirtyWriteError';

const conflictEditorHelp = nls.localize('userGuide', "Use the actions in the editor tool bar to either undo your changes or overwrite the content of the file with your changes.");

// A handler for text file save error happening with conflict resolution actions
export class TextFileSaveErrorHandler extends Disposable implements ISaveErrorHandler, IWorkbenchContribution {

	private readonly messages = new ResourceMap<INotificationHandle>();
	private readonly conflictResolutionContext = new RawContextKey<boolean>(CONFLICT_RESOLUTION_CONTEXT, false).bindTo(this.contextKeyService);
	private activeConflictResolutionResource: URI | undefined = undefined;

	constructor(
		@INotificationService private readonly notificationService: INotificationService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IContextKeyService private contextKeyService: IContextKeyService,
		@IEditorService private readonly editorService: IEditorService,
		@ITextModelService textModelService: ITextModelService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		const provider = this._register(instantiationService.createInstance(TextFileContentProvider));
		this._register(textModelService.registerTextModelContentProvider(CONFLICT_RESOLUTION_SCHEME, provider));

		// Set as save error handler to service for text files
		this.textFileService.files.saveErrorHandler = this;

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.textFileService.files.onDidSave(e => this.onFileSavedOrReverted(e.model.resource)));
		this._register(this.textFileService.files.onDidRevert(m => this.onFileSavedOrReverted(m.resource)));
		this._register(this.editorService.onDidActiveEditorChange(() => this.onActiveEditorChanged()));
	}

	private onActiveEditorChanged(): void {
		let isActiveEditorSaveConflictResolution = false;
		let activeConflictResolutionResource: URI | undefined;

		const activeInput = this.editorService.activeEditor;
		if (activeInput instanceof DiffEditorInput && activeInput.originalInput instanceof ResourceEditorInput && activeInput.modifiedInput instanceof FileEditorInput) {
			const resource = activeInput.originalInput.resource;
			if (resource?.scheme === CONFLICT_RESOLUTION_SCHEME) {
				isActiveEditorSaveConflictResolution = true;
				activeConflictResolutionResource = activeInput.modifiedInput.resource;
			}
		}

		this.conflictResolutionContext.set(isActiveEditorSaveConflictResolution);
		this.activeConflictResolutionResource = activeConflictResolutionResource;
	}

	private onFileSavedOrReverted(resource: URI): void {
		const messageHandle = this.messages.get(resource);
		if (messageHandle) {
			messageHandle.close();
			this.messages.delete(resource);
		}
	}

	onSaveError(error: unknown, model: ITextFileEditorModel): void {
		const fileOperationError = error as FileOperationError;
		const resource = model.resource;

		let message: string;
		const primaryActions: IAction[] = [];
		const secondaryActions: IAction[] = [];

		// Dirty write prevention
		if (fileOperationError.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE) {

			// If the user tried to save from the opened conflict editor, show its message again
			if (this.activeConflictResolutionResource && isEqual(this.activeConflictResolutionResource, model.resource)) {
				if (this.storageService.getBoolean(LEARN_MORE_DIRTY_WRITE_IGNORE_KEY, StorageScope.GLOBAL)) {
					return; // return if this message is ignored
				}

				message = conflictEditorHelp;

				primaryActions.push(this.instantiationService.createInstance(ResolveConflictLearnMoreAction));
				secondaryActions.push(this.instantiationService.createInstance(DoNotShowResolveConflictLearnMoreAction));
			}

			// Otherwise show the message that will lead the user into the save conflict editor.
			else {
				message = nls.localize('staleSaveError', "Failed to save '{0}': The content of the file is newer. Please compare your version with the file contents or overwrite the content of the file with your changes.", basename(resource));

				primaryActions.push(this.instantiationService.createInstance(ResolveSaveConflictAction, model));
				primaryActions.push(this.instantiationService.createInstance(SaveIgnoreModifiedSinceAction, model));

				secondaryActions.push(this.instantiationService.createInstance(ConfigureSaveConflictAction));
			}
		}

		// Any other save error
		else {
			const isReadonly = fileOperationError.fileOperationResult === FileOperationResult.FILE_READ_ONLY;
			const triedToMakeWriteable = isReadonly && fileOperationError.options && (fileOperationError.options as IWriteTextFileOptions).overwriteReadonly;
			const isPermissionDenied = fileOperationError.fileOperationResult === FileOperationResult.FILE_PERMISSION_DENIED;
			const canHandlePermissionOrReadonlyErrors = resource.scheme === Schemas.file; // https://github.com/microsoft/vscode/issues/48659

			// Save Elevated
			if (canHandlePermissionOrReadonlyErrors && (isPermissionDenied || triedToMakeWriteable)) {
				primaryActions.push(this.instantiationService.createInstance(SaveElevatedAction, model, !!triedToMakeWriteable));
			}

			// Overwrite
			else if (canHandlePermissionOrReadonlyErrors && isReadonly) {
				primaryActions.push(this.instantiationService.createInstance(OverwriteReadonlyAction, model));
			}

			// Retry
			else {
				primaryActions.push(this.instantiationService.createInstance(ExecuteCommandAction, SAVE_FILE_COMMAND_ID, nls.localize('retry', "Retry")));
			}

			// Save As
			primaryActions.push(this.instantiationService.createInstance(ExecuteCommandAction, SAVE_FILE_AS_COMMAND_ID, SAVE_FILE_AS_LABEL));

			// Discard
			primaryActions.push(this.instantiationService.createInstance(ExecuteCommandAction, REVERT_FILE_COMMAND_ID, nls.localize('discard', "Discard")));

			// Message
			if (canHandlePermissionOrReadonlyErrors && isReadonly) {
				if (triedToMakeWriteable) {
					message = isWindows ? nls.localize('readonlySaveErrorAdmin', "Failed to save '{0}': File is read-only. Select 'Overwrite as Admin' to retry as administrator.", basename(resource)) : nls.localize('readonlySaveErrorSudo', "Failed to save '{0}': File is read-only. Select 'Overwrite as Sudo' to retry as superuser.", basename(resource));
				} else {
					message = nls.localize('readonlySaveError', "Failed to save '{0}': File is read-only. Select 'Overwrite' to attempt to make it writeable.", basename(resource));
				}
			} else if (canHandlePermissionOrReadonlyErrors && isPermissionDenied) {
				message = isWindows ? nls.localize('permissionDeniedSaveError', "Failed to save '{0}': Insufficient permissions. Select 'Retry as Admin' to retry as administrator.", basename(resource)) : nls.localize('permissionDeniedSaveErrorSudo', "Failed to save '{0}': Insufficient permissions. Select 'Retry as Sudo' to retry as superuser.", basename(resource));
			} else {
				message = nls.localize({ key: 'genericSaveError', comment: ['{0} is the resource that failed to save and {1} the error message'] }, "Failed to save '{0}': {1}", basename(resource), toErrorMessage(error, false));
			}
		}

		// Show message and keep function to hide in case the file gets saved/reverted
		const actions: INotificationActions = { primary: primaryActions, secondary: secondaryActions };
		const handle = this.notificationService.notify({ severity: Severity.Error, message, actions });
		Event.once(handle.onDidClose)(() => { dispose(primaryActions); dispose(secondaryActions); });
		this.messages.set(model.resource, handle);
	}

	dispose(): void {
		super.dispose();

		this.messages.clear();
	}
}

const pendingResolveSaveConflictMessages: INotificationHandle[] = [];
function clearPendingResolveSaveConflictMessages(): void {
	while (pendingResolveSaveConflictMessages.length > 0) {
		const item = pendingResolveSaveConflictMessages.pop();
		if (item) {
			item.close();
		}
	}
}

class ResolveConflictLearnMoreAction extends Action {

	constructor(
		@IOpenerService private readonly openerService: IOpenerService
	) {
		super('workbench.files.action.resolveConflictLearnMore', nls.localize('learnMore', "Learn More"));
	}

	async run(): Promise<void> {
		await this.openerService.open(URI.parse('https://go.microsoft.com/fwlink/?linkid=868264'));
	}
}

class DoNotShowResolveConflictLearnMoreAction extends Action {

	constructor(
		@IStorageService private readonly storageService: IStorageService
	) {
		super('workbench.files.action.resolveConflictLearnMoreDoNotShowAgain', nls.localize('dontShowAgain', "Don't Show Again"));
	}

	async run(notification: IDisposable): Promise<void> {
		this.storageService.store(LEARN_MORE_DIRTY_WRITE_IGNORE_KEY, true, StorageScope.GLOBAL, StorageTarget.USER);

		// Hide notification
		notification.dispose();
	}
}

class ResolveSaveConflictAction extends Action {

	constructor(
		private model: ITextFileEditorModel,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IProductService private readonly productService: IProductService
	) {
		super('workbench.files.action.resolveConflict', nls.localize('compareChanges', "Compare"));
	}

	async run(): Promise<void> {
		if (!this.model.isDisposed()) {
			const resource = this.model.resource;
			const name = basename(resource);
			const editorLabel = nls.localize('saveConflictDiffLabel', "{0} (in file) ↔ {1} (in {2}) - Resolve save conflict", name, name, this.productService.nameLong);

			await TextFileContentProvider.open(resource, CONFLICT_RESOLUTION_SCHEME, editorLabel, this.editorService, { pinned: true });

			// Show additional help how to resolve the save conflict
			const actions: INotificationActions = { primary: [this.instantiationService.createInstance(ResolveConflictLearnMoreAction)] };
			const handle = this.notificationService.notify({
				severity: Severity.Info,
				message: conflictEditorHelp,
				actions,
				neverShowAgain: { id: LEARN_MORE_DIRTY_WRITE_IGNORE_KEY, isSecondary: true }
			});
			Event.once(handle.onDidClose)(() => dispose(actions.primary!));
			pendingResolveSaveConflictMessages.push(handle);
		}
	}
}

class SaveElevatedAction extends Action {

	constructor(
		private model: ITextFileEditorModel,
		private triedToMakeWriteable: boolean
	) {
		super('workbench.files.action.saveElevated', triedToMakeWriteable ? isWindows ? nls.localize('overwriteElevated', "Overwrite as Admin...") : nls.localize('overwriteElevatedSudo', "Overwrite as Sudo...") : isWindows ? nls.localize('saveElevated', "Retry as Admin...") : nls.localize('saveElevatedSudo', "Retry as Sudo..."));
	}

	async run(): Promise<void> {
		if (!this.model.isDisposed()) {
			this.model.save({
				writeElevated: true,
				overwriteReadonly: this.triedToMakeWriteable,
				reason: SaveReason.EXPLICIT
			});
		}
	}
}

class OverwriteReadonlyAction extends Action {

	constructor(
		private model: ITextFileEditorModel
	) {
		super('workbench.files.action.overwrite', nls.localize('overwrite', "Overwrite"));
	}

	async run(): Promise<void> {
		if (!this.model.isDisposed()) {
			this.model.save({ overwriteReadonly: true, reason: SaveReason.EXPLICIT });
		}
	}
}

class SaveIgnoreModifiedSinceAction extends Action {

	constructor(
		private model: ITextFileEditorModel
	) {
		super('workbench.files.action.saveIgnoreModifiedSince', nls.localize('overwrite', "Overwrite"));
	}

	async run(): Promise<void> {
		if (!this.model.isDisposed()) {
			this.model.save({ ignoreModifiedSince: true, reason: SaveReason.EXPLICIT });
		}
	}
}

class ConfigureSaveConflictAction extends Action {

	constructor(
		@IPreferencesService private readonly preferencesService: IPreferencesService
	) {
		super('workbench.files.action.configureSaveConflict', nls.localize('configure', "Configure"));
	}

	async run(): Promise<void> {
		this.preferencesService.openSettings(undefined, 'files.saveConflictResolution');
	}
}

export const acceptLocalChangesCommand = async (accessor: ServicesAccessor, resource: URI) => {
	const editorService = accessor.get(IEditorService);
	const resolverService = accessor.get(ITextModelService);

	const editorPane = editorService.activeEditorPane;
	if (!editorPane) {
		return;
	}

	const editor = editorPane.input;
	const group = editorPane.group;

	const reference = await resolverService.createModelReference(resource);
	const model = reference.object as IResolvedTextFileEditorModel;

	try {

		// hide any previously shown message about how to use these actions
		clearPendingResolveSaveConflictMessages();

		// Trigger save
		await model.save({ ignoreModifiedSince: true, reason: SaveReason.EXPLICIT });

		// Reopen file input
		await editorService.openEditor({ resource: model.resource }, group);

		// Clean up
		group.closeEditor(editor);
		editor.dispose();
	} finally {
		reference.dispose();
	}
};

export const revertLocalChangesCommand = async (accessor: ServicesAccessor, resource: URI) => {
	const editorService = accessor.get(IEditorService);
	const resolverService = accessor.get(ITextModelService);

	const editorPane = editorService.activeEditorPane;
	if (!editorPane) {
		return;
	}

	const editor = editorPane.input;
	const group = editorPane.group;

	const reference = await resolverService.createModelReference(resource);
	const model = reference.object as ITextFileEditorModel;

	try {

		// hide any previously shown message about how to use these actions
		clearPendingResolveSaveConflictMessages();

		// Revert on model
		await model.revert();

		// Reopen file input
		await editorService.openEditor({ resource: model.resource }, group);

		// Clean up
		group.closeEditor(editor);
		editor.dispose();
	} finally {
		reference.dispose();
	}
};
