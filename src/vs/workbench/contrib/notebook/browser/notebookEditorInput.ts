/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { EditorInput, IEditorInput, GroupIdentifier, ISaveOptions, IMoveResult, IRevertOptions } from 'vs/workbench/common/editor';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { URI } from 'vs/base/common/uri';
import { isEqual, basename, joinPath } from 'vs/base/common/resources';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IFilesConfigurationService, AutoSaveMode } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { INotebookEditorModelResolverService } from 'vs/workbench/contrib/notebook/common/notebookEditorModelResolverService';
import { IReference } from 'vs/base/common/lifecycle';
import { INotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';

interface NotebookEditorInputOptions {
	startDirty?: boolean;
}

export class NotebookEditorInput extends EditorInput {
	static create(instantiationService: IInstantiationService, resource: URI, name: string, viewType: string | undefined, options: NotebookEditorInputOptions = {}) {
		return instantiationService.createInstance(NotebookEditorInput, resource, name, viewType, options);
	}

	static readonly ID: string = 'workbench.input.notebook';

	private _textModel: IReference<INotebookEditorModel> | null = null;
	private _defaultDirtyState: boolean = false;

	constructor(
		public readonly resource: URI,
		public readonly name: string,
		public readonly viewType: string | undefined,
		public readonly options: NotebookEditorInputOptions,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookEditorModelResolverService private readonly _notebookModelResolverService: INotebookEditorModelResolverService,
		@IFilesConfigurationService private readonly _filesConfigurationService: IFilesConfigurationService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
		this._defaultDirtyState = !!options.startDirty;
	}

	getTypeId(): string {
		return NotebookEditorInput.ID;
	}

	getName(): string {
		return this.name;
	}

	isDirty() {
		if (!this._textModel) {
			return !!this._defaultDirtyState;
		}
		return this._textModel.object.isDirty();
	}

	isUntitled(): boolean {
		return this._textModel?.object.isUntitled() || false;
	}

	isReadonly() {
		return false;
	}

	isSaving(): boolean {
		if (this.isUntitled()) {
			return false; // untitled is never saving automatically
		}

		if (!this.isDirty()) {
			return false; // the editor needs to be dirty for being saved
		}

		if (this._filesConfigurationService.getAutoSaveMode() === AutoSaveMode.AFTER_SHORT_DELAY) {
			return true; // a short auto save is configured, treat this as being saved
		}

		return false;
	}

	async save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		if (this._textModel) {

			if (this.isUntitled()) {
				return this.saveAs(group, options);
			} else {
				await this._textModel.object.save();
			}

			return this;
		}

		return undefined;
	}

	async saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		if (!this._textModel || !this.viewType) {
			return undefined;
		}

		const provider = this._notebookService.getContributedNotebookProvider(this.viewType!);

		if (!provider) {
			return undefined;
		}

		const dialogPath = this.isUntitled() ? await this.suggestName(this.name) : this._textModel.object.resource;

		const target = await this._fileDialogService.pickFileToSave(dialogPath, options?.availableFileSystems);
		if (!target) {
			return undefined; // save cancelled
		}

		if (!provider.matches(target)) {
			const patterns = provider.selectors.map(pattern => {
				if (typeof pattern === 'string') {
					return pattern;
				}

				if (glob.isRelativePattern(pattern)) {
					return `${pattern} (base ${pattern.base})`;
				}

				return `${pattern.include} (exclude: ${pattern.exclude})`;
			}).join(', ');
			throw new Error(`File name ${target} is not supported by ${provider.providerDisplayName}.

Please make sure the file name matches following patterns:
${patterns}
`);
		}

		if (!await this._textModel.object.saveAs(target)) {
			return undefined;
		}

		return this._move(group, target)?.editor;
	}

	async suggestName(suggestedFilename: string) {
		return joinPath(await this._fileDialogService.defaultFilePath(), suggestedFilename);
	}

	// called when users rename a notebook document
	rename(group: GroupIdentifier, target: URI): IMoveResult | undefined {
		if (this._textModel) {
			const contributedNotebookProviders = this._notebookService.getContributedNotebookProviders(target);

			if (contributedNotebookProviders.find(provider => provider.id === this._textModel!.object.viewType)) {
				return this._move(group, target);
			}
		}
		return undefined;
	}

	private _move(group: GroupIdentifier, newResource: URI): { editor: IEditorInput } | undefined {
		const editorInput = NotebookEditorInput.create(this._instantiationService, newResource, basename(newResource), this.viewType);
		return { editor: editorInput };
	}

	async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		if (this._textModel && this._textModel.object.isDirty()) {
			await this._textModel.object.revert(options);
		}

		return;
	}

	async resolve(): Promise<INotebookEditorModel | null> {
		if (!await this._notebookService.canResolve(this.viewType!)) {
			return null;
		}

		if (!this._textModel) {
			this._textModel = await this._notebookModelResolverService.resolve(this.resource, this.viewType!);

			this._register(this._textModel.object.onDidChangeDirty(() => {
				this._onDidChangeDirty.fire();
			}));

			if (this._textModel.object.isDirty()) {
				this._onDidChangeDirty.fire();
			}
		}

		return this._textModel.object;
	}

	matches(otherInput: unknown): boolean {
		if (this === otherInput) {
			return true;
		}
		if (otherInput instanceof NotebookEditorInput) {
			return this.viewType === otherInput.viewType
				&& isEqual(this.resource, otherInput.resource);
		}
		return false;
	}

	dispose() {
		if (this._textModel) {
			this._textModel.dispose();
			this._textModel = null;
		}
		super.dispose();
	}
}
