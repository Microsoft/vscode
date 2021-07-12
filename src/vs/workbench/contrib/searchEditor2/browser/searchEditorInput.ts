/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { isEqual } from 'vs/base/common/resources';
import { withUndefinedAsNull } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { ILabelService } from 'vs/platform/label/common/label';
import { EditorInputCapabilities, GroupIdentifier, IEditorInput, IMoveResult, IRevertOptions, ISaveOptions } from 'vs/workbench/common/editor';
import { AbstractResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { ISearchEditorService } from 'vs/workbench/contrib/searchEditor2/browser/searchEditorService';
import { SearchEditorFileWorkingCopyModel } from 'vs/workbench/contrib/searchEditor2/browser/searchEditorWorkingCopy';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { ISearchComplete } from 'vs/workbench/services/search/common/search';
import { IFileWorkingCopy } from 'vs/workbench/services/workingCopy/common/fileWorkingCopy';
import { StoredFileWorkingCopy, StoredFileWorkingCopyState } from 'vs/workbench/services/workingCopy/common/storedFileWorkingCopy';

export class SearchEditorInput extends AbstractResourceEditorInput {

	static readonly TYPE_ID = 'searchEditorInput2';

	static readonly OVERRIDE_ID = 'searchEditor2';

	override get typeId(): string {
		return SearchEditorInput.TYPE_ID;
	}

	override get capabilities(): EditorInputCapabilities {
		let capabilities = EditorInputCapabilities.None;

		if (!this.fileService.canHandleResource(this.resource)) {
			capabilities |= EditorInputCapabilities.Untitled;
		}

		return capabilities;
	}

	public ongoingSearchOperation: Promise<ISearchComplete> | undefined;

	private workingCopy: IFileWorkingCopy<SearchEditorFileWorkingCopyModel> | undefined = undefined;
	private readonly workingCopyListeners = this._register(new DisposableStore());

	constructor(
		resource: URI,
		@ISearchEditorService private readonly searchEditorService: ISearchEditorService,
		@ILabelService labelService: ILabelService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IFileService fileService: IFileService
	) {
		super(resource, undefined, labelService, fileService);

		const workingCopy = searchEditorService.manager.get(resource);
		if (workingCopy) {
			this.workingCopy = workingCopy;
			this.registerWorkingCopyListeners(workingCopy);
		}

		this._register(this.searchEditorService.manager.onDidCreate(workingCopy => this.onDidCreateWorkingCopy(workingCopy)));
	}

	private onDidCreateWorkingCopy(workingCopy: IFileWorkingCopy<SearchEditorFileWorkingCopyModel>): void {
		if (isEqual(workingCopy.resource, this.resource)) {
			this.workingCopy = workingCopy;

			this.registerWorkingCopyListeners(workingCopy);
		}
	}

	private registerWorkingCopyListeners(workingCopy: IFileWorkingCopy<SearchEditorFileWorkingCopyModel>): void {

		// Clear any old
		this.workingCopyListeners.clear();

		// re-emit some events from the working copy
		this.workingCopyListeners.add(workingCopy.onDidChangeDirty(() => this._onDidChangeDirty.fire()));

		// file specific listeners
		if (workingCopy instanceof StoredFileWorkingCopy) {

			// orphaned tracking
			this.workingCopyListeners.add(workingCopy.onDidChangeOrphaned(() => this._onDidChangeLabel.fire()));

			// important: treat save errors as potential dirty change because
			// a file that is in save conflict or error will report dirty even
			// if auto save is turned on.
			this.workingCopyListeners.add(workingCopy.onDidSaveError(() => this._onDidChangeDirty.fire()));
		}

		// remove working copy association once it gets disposed
		this.workingCopyListeners.add(Event.once(workingCopy.onWillDispose)(() => {
			this.workingCopyListeners.clear();
			this.workingCopy = undefined;
		}));
	}

	override async resolve(): Promise<SearchEditorFileWorkingCopyModel | null> {
		// Resolve working copy
		if (this.hasCapability(EditorInputCapabilities.Untitled)) {
			this.workingCopy = await this.searchEditorService.manager.resolve({ untitledResource: this.resource });
		} else {
			this.workingCopy = await this.searchEditorService.manager.resolve(this.resource, { reload: { async: true } });
		}

		// It is possible that this input was disposed before the model
		// finished resolving. As such, we need to make sure to dispose
		// the model reference to not leak it.
		// TODO@custom should this use cancellation token rather?
		if (this.isDisposed()) {
			this.workingCopy.dispose();
		}

		return withUndefinedAsNull(this.workingCopy.model);
	}

	override async save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		if (this.hasCapability(EditorInputCapabilities.Untitled)) {
			return this.saveAs(group, options);
		}

		const saved = await this.workingCopy?.save(options);
		return saved ? this : undefined;
	}

	override async saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		const target = await this.searchEditorService.manager.saveAs(this.resource, undefined, options);
		if (target) {
			return new SearchEditorInput(target.resource, this.searchEditorService, this.labelService, this.filesConfigurationService, this.fileService);
		}

		return undefined;
	}

	override async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		return this.workingCopy?.revert(options);
	}

	override rename(group: GroupIdentifier, target: URI): IMoveResult {
		return {
			editor: { resource: target },
			options: { override: SearchEditorInput.OVERRIDE_ID }
		};
	}

	override isDirty(): boolean {
		return !!(this.workingCopy?.isDirty());
	}

	override isOrphaned(): boolean {
		if (this.workingCopy instanceof StoredFileWorkingCopy) {
			return this.workingCopy.hasState(StoredFileWorkingCopyState.ORPHAN);
		}

		return super.isOrphaned();
	}

	override matches(otherInput: unknown): boolean {
		if (otherInput instanceof SearchEditorInput) {
			return otherInput.resource.toString() === this.resource.toString();
		}

		return super.matches(otherInput);
	}

	override dispose(): void {
		this.workingCopy?.dispose();

		super.dispose();
	}
}
