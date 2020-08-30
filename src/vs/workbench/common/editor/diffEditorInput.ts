/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorModel, EditorInput, SideBySideEditorInput, TEXT_DIFF_EDITOR_ID, BINARY_DIFF_EDITOR_ID } from 'vs/workbench/common/editor';
import { BaseTextEditorModel } from 'vs/workbench/common/editor/textEditorModel';
import { DiffEditorModel } from 'vs/workbench/common/editor/diffEditorModel';
import { TextDiffEditorModel } from 'vs/workbench/common/editor/textDiffEditorModel';
import { localize } from 'vs/nls';

/**
 * The base editor input for the diff editor. It is made up of two editor inputs, the original version
 * and the modified version.
 */
export class DiffEditorInput extends SideBySideEditorInput {

	static readonly ID = 'workbench.editors.diffEditorInput';

	private cachedModel: DiffEditorModel | undefined = undefined;

	constructor(
		protected name: string | undefined,
		description: string | undefined,
		public readonly originalInput: EditorInput,
		public readonly modifiedInput: EditorInput,
		private readonly forceOpenAsBinary?: boolean
	) {
		super(name, description, originalInput, modifiedInput);
	}

	getTypeId(): string {
		return DiffEditorInput.ID;
	}

	getName(): string {
		if (!this.name) {
			return localize('sideBySideLabels', "{0} ↔ {1}", this.originalInput.getName(), this.modifiedInput.getName());
		}

		return this.name;
	}

	async resolve(): Promise<EditorModel> {

		// Create Model - we never reuse our cached model if refresh is true because we cannot
		// decide for the inputs within if the cached model can be reused or not. There may be
		// inputs that need to be loaded again and thus we always recreate the model and dispose
		// the previous one - if any.
		const resolvedModel = await this.createModel();
		if (this.cachedModel) {
			this.cachedModel.dispose();
		}

		this.cachedModel = resolvedModel;

		return this.cachedModel;
	}

	getPreferredEditorId(candidates: string[]): string {
		return this.forceOpenAsBinary ? BINARY_DIFF_EDITOR_ID : TEXT_DIFF_EDITOR_ID;
	}

	private async createModel(): Promise<DiffEditorModel> {

		// Join resolve call over two inputs and build diff editor model
		const models = await Promise.all([
			this.originalInput.resolve(),
			this.modifiedInput.resolve()
		]);

		const originalEditorModel = models[0];
		const modifiedEditorModel = models[1];

		// If both are text models, return textdiffeditor model
		if (modifiedEditorModel instanceof BaseTextEditorModel && originalEditorModel instanceof BaseTextEditorModel) {
			return new TextDiffEditorModel(originalEditorModel, modifiedEditorModel);
		}

		// Otherwise return normal diff model
		return new DiffEditorModel(originalEditorModel, modifiedEditorModel);
	}

	matches(otherInput: unknown): boolean {
		if (!super.matches(otherInput)) {
			return false;
		}

		return otherInput instanceof DiffEditorInput && otherInput.forceOpenAsBinary === this.forceOpenAsBinary;
	}

	dispose(): void {

		// Free the diff editor model but do not propagate the dispose() call to the two inputs
		// We never created the two inputs (original and modified) so we can not dispose
		// them without sideeffects.
		if (this.cachedModel) {
			this.cachedModel.dispose();
			this.cachedModel = undefined;
		}

		super.dispose();
	}
}
