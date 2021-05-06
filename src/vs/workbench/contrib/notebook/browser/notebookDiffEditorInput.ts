/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { EditorInput, IEditorInput, GroupIdentifier, ISaveOptions, IMoveResult, IRevertOptions, EditorModel } from 'vs/workbench/common/editor';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { URI } from 'vs/base/common/uri';
import { isEqual } from 'vs/base/common/resources';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { INotebookEditorModelResolverService } from 'vs/workbench/contrib/notebook/common/notebookEditorModelResolverService';
import { IReference } from 'vs/base/common/lifecycle';
import { INotebookDiffEditorModel, IResolvedNotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Schemas } from 'vs/base/common/network';

interface NotebookEditorInputOptions {
	startDirty?: boolean;
}

class NotebookDiffEditorModel extends EditorModel implements INotebookDiffEditorModel {
	constructor(
		readonly original: IResolvedNotebookEditorModel,
		readonly modified: IResolvedNotebookEditorModel,
	) {
		super();
	}

	async load(): Promise<NotebookDiffEditorModel> {
		await this.original.load();
		await this.modified.load();

		return this;
	}

	async resolveOriginalFromDisk() {
		await this.original.load({ forceReadFromFile: true });
	}

	async resolveModifiedFromDisk() {
		await this.modified.load({ forceReadFromFile: true });
	}

	override dispose(): void {
		super.dispose();
	}
}

export class NotebookDiffEditorInput extends EditorInput {
	static create(instantiationService: IInstantiationService, resource: URI, name: string, originalResource: URI, originalName: string, textDiffName: string, viewType: string | undefined, options: NotebookEditorInputOptions = {}) {
		return instantiationService.createInstance(NotebookDiffEditorInput, resource, name, originalResource, originalName, textDiffName, viewType, options);
	}

	static readonly ID: string = 'workbench.input.diffNotebookInput';

	private _modifiedTextModel: IReference<IResolvedNotebookEditorModel> | null = null;
	private _originalTextModel: IReference<IResolvedNotebookEditorModel> | null = null;
	private _defaultDirtyState: boolean = false;

	constructor(
		public readonly resource: URI,
		public readonly name: string,
		public readonly originalResource: URI,
		public readonly originalName: string,
		public readonly textDiffName: string,
		public readonly viewType: string | undefined,
		public readonly options: NotebookEditorInputOptions,
		@INotebookService private readonly _notebookService: INotebookService,
		@INotebookEditorModelResolverService private readonly _notebookModelResolverService: INotebookEditorModelResolverService,
		@IFileDialogService private readonly _fileDialogService: IFileDialogService
	) {
		super();
		this._defaultDirtyState = !!options.startDirty;
	}

	override get typeId(): string {
		return NotebookDiffEditorInput.ID;
	}

	override getName(): string {
		return this.textDiffName;
	}

	override isDirty() {
		if (!this._modifiedTextModel) {
			return this._defaultDirtyState;
		}
		return this._modifiedTextModel.object.isDirty();
	}

	override isUntitled(): boolean {
		return this._modifiedTextModel?.object.resource.scheme === Schemas.untitled;
	}

	override isReadonly() {
		return false;
	}

	override async save(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		if (this._modifiedTextModel) {

			if (this.isUntitled()) {
				return this.saveAs(group, options);
			} else {
				await this._modifiedTextModel.object.save();
			}

			return this;
		}

		return undefined;
	}

	override async saveAs(group: GroupIdentifier, options?: ISaveOptions): Promise<IEditorInput | undefined> {
		if (!this._modifiedTextModel || !this.viewType) {
			return undefined;
		}

		const provider = this._notebookService.getContributedNotebookProvider(this.viewType!);

		if (!provider) {
			return undefined;
		}

		const dialogPath = this._modifiedTextModel.object.resource;
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

		if (!await this._modifiedTextModel.object.saveAs(target)) {
			return undefined;
		}

		return this._move(group, target)?.editor;
	}

	// called when users rename a notebook document
	override rename(group: GroupIdentifier, target: URI): IMoveResult | undefined {
		if (this._modifiedTextModel) {
			const contributedNotebookProviders = this._notebookService.getContributedNotebookProviders(target);

			if (contributedNotebookProviders.find(provider => provider.id === this._modifiedTextModel!.object.viewType)) {
				return this._move(group, target);
			}
		}
		return undefined;
	}

	private _move(group: GroupIdentifier, newResource: URI): { editor: IEditorInput } | undefined {
		return undefined;
	}

	override async revert(group: GroupIdentifier, options?: IRevertOptions): Promise<void> {
		if (this._modifiedTextModel && this._modifiedTextModel.object.isDirty()) {
			await this._modifiedTextModel.object.revert(options);
		}

		return;
	}

	override async resolve(): Promise<INotebookDiffEditorModel | null> {
		if (!await this._notebookService.canResolve(this.viewType!)) {
			return null;
		}

		if (!this._modifiedTextModel) {
			this._modifiedTextModel = await this._notebookModelResolverService.resolve(this.resource, this.viewType!);
			this._register(this._modifiedTextModel.object.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
			if (this._modifiedTextModel.object.isDirty() !== this._defaultDirtyState) {
				this._onDidChangeDirty.fire();
			}

		}
		if (!this._originalTextModel) {
			this._originalTextModel = await this._notebookModelResolverService.resolve(this.originalResource, this.viewType!);
		}

		return new NotebookDiffEditorModel(this._originalTextModel.object, this._modifiedTextModel.object);
	}

	override matches(otherInput: unknown): boolean {
		if (this === otherInput) {
			return true;
		}
		if (otherInput instanceof NotebookDiffEditorInput) {
			return this.viewType === otherInput.viewType
				&& isEqual(this.resource, otherInput.resource);
		}
		return false;
	}

	override dispose() {
		this._modifiedTextModel?.dispose();
		this._modifiedTextModel = null;
		this._originalTextModel?.dispose();
		this._originalTextModel = null;
		super.dispose();
	}
}
