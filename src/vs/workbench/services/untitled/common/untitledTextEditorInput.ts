/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Verbosity } from 'vs/workbench/common/editor';
import { AbstractTextResourceEditorInput } from 'vs/workbench/common/editor/textResourceEditorInput';
import { IUntitledTextEditorModel } from 'vs/workbench/services/untitled/common/untitledTextEditorModel';
import { EncodingMode, IEncodingSupport, IModeSupport, ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { ILabelService } from 'vs/platform/label/common/label';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IFileService } from 'vs/platform/files/common/files';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { isEqual } from 'vs/base/common/resources';

/**
 * An editor input to be used for untitled text buffers.
 */
export class UntitledTextEditorInput extends AbstractTextResourceEditorInput implements IEncodingSupport, IModeSupport {

	static readonly ID: string = 'workbench.editors.untitledEditorInput';

	override get typeId(): string {
		return UntitledTextEditorInput.ID;
	}

	private modelResolve: Promise<void> | undefined = undefined;

	constructor(
		public readonly model: IUntitledTextEditorModel,
		@ITextFileService textFileService: ITextFileService,
		@ILabelService labelService: ILabelService,
		@IEditorService editorService: IEditorService,
		@IEditorGroupsService editorGroupService: IEditorGroupsService,
		@IFileService fileService: IFileService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService
	) {
		super(model.resource, undefined, editorService, editorGroupService, textFileService, labelService, fileService, filesConfigurationService);

		this.registerModelListeners(model);
	}

	private registerModelListeners(model: IUntitledTextEditorModel): void {

		// re-emit some events from the model
		this._register(model.onDidChangeDirty(() => this._onDidChangeDirty.fire()));
		this._register(model.onDidChangeName(() => this._onDidChangeLabel.fire()));

		// a reverted untitled text editor model renders this input disposed
		this._register(model.onDidRevert(() => this.dispose()));
	}

	override getName(): string {
		return this.model.name;
	}

	override getDescription(verbosity: Verbosity = Verbosity.MEDIUM): string | undefined {

		// Without associated path: only use if name and description differ
		if (!this.model.hasAssociatedFilePath) {
			const descriptionCandidate = this.resource.path;
			if (descriptionCandidate !== this.getName()) {
				return descriptionCandidate;
			}

			return undefined;
		}

		// With associated path: delegate to parent
		return super.getDescription(verbosity);
	}

	override getTitle(verbosity: Verbosity): string {

		// Without associated path: check if name and description differ to decide
		// if description should appear besides the name to distinguish better
		if (!this.model.hasAssociatedFilePath) {
			const name = this.getName();
			const description = this.getDescription();
			if (description && description !== name) {
				return `${name} • ${description}`;
			}

			return name;
		}

		// With associated path: delegate to parent
		return super.getTitle(verbosity);
	}

	override isDirty(): boolean {
		return this.model.isDirty();
	}

	getEncoding(): string | undefined {
		return this.model.getEncoding();
	}

	setEncoding(encoding: string, mode: EncodingMode /* ignored, we only have Encode */): Promise<void> {
		return this.model.setEncoding(encoding);
	}

	setMode(mode: string): void {
		this.model.setMode(mode);
	}

	getMode(): string | undefined {
		return this.model.getMode();
	}

	override async resolve(): Promise<IUntitledTextEditorModel> {
		if (!this.modelResolve) {
			this.modelResolve = this.model.resolve();
		}

		await this.modelResolve;

		return this.model;
	}

	override matches(otherInput: unknown): boolean {
		if (otherInput === this) {
			return true;
		}

		if (otherInput instanceof UntitledTextEditorInput) {
			return isEqual(otherInput.resource, this.resource);
		}

		return false;
	}

	override dispose(): void {
		this.modelResolve = undefined;

		super.dispose();
	}
}
