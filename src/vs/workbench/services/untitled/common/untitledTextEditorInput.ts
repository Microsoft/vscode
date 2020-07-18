/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEncodingSupport, EncodingMode, Verbosity, IModeSupport } from 'vs/workbench/common/editor';
import { AbstractTextResourceEditorInput } from 'vs/workbench/common/editor/textResourceEditorInput';
import { IUntitledTextEditorModel } from 'vs/workbench/services/untitled/common/untitledTextEditorModel';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { ILabelService } from 'vs/platform/label/common/label';
import { IResolvedTextEditorModel } from 'vs/editor/common/services/resolverService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IFileService } from 'vs/platform/files/common/files';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { extUri } from 'vs/base/common/resources';

/**
 * An editor input to be used for untitled text buffers.
 */
export class UntitledTextEditorInput extends AbstractTextResourceEditorInput implements IEncodingSupport, IModeSupport {

	static readonly ID: string = 'workbench.editors.untitledEditorInput';

	private modelResolve: Promise<IUntitledTextEditorModel & IResolvedTextEditorModel> | undefined = undefined;

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

	getTypeId(): string {
		return UntitledTextEditorInput.ID;
	}

	getName(): string {
		return this.model.name;
	}

	getDescription(verbosity: Verbosity = Verbosity.MEDIUM): string | undefined {

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

	getTitle(verbosity: Verbosity): string {

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

	isDirty(): boolean {
		return this.model.isDirty();
	}

	getEncoding(): string | undefined {
		return this.model.getEncoding();
	}

	setEncoding(encoding: string, mode: EncodingMode /* ignored, we only have Encode */): void {
		this.model.setEncoding(encoding);
	}

	setMode(mode: string): void {
		this.model.setMode(mode);
	}

	getMode(): string | undefined {
		return this.model.getMode();
	}

	resolve(): Promise<IUntitledTextEditorModel & IResolvedTextEditorModel> {

		// Join a model resolve if we have had one before
		if (this.modelResolve) {
			return this.modelResolve;
		}

		this.modelResolve = this.model.load();

		return this.modelResolve;
	}

	matches(otherInput: unknown): boolean {
		if (otherInput === this) {
			return true;
		}

		if (otherInput instanceof UntitledTextEditorInput) {
			return extUri.isEqual(otherInput.resource, this.resource);
		}

		return false;
	}

	dispose(): void {
		this.modelResolve = undefined;

		super.dispose();
	}
}
