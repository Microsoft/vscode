/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDiffEditorModel } from 'vs/editor/common/editorCommon';
import { BaseTextEditorModel } from 'vs/workbench/common/editor/textEditorModel';
import { DiffEditorModel } from 'vs/workbench/common/editor/diffEditorModel';

/**
 * The base text editor model for the diff editor. It is made up of two text editor models, the original version
 * and the modified version.
 */
export class TextDiffEditorModel extends DiffEditorModel {

	protected override readonly _originalModel: BaseTextEditorModel | undefined;
	override get originalModel(): BaseTextEditorModel | undefined { return this._originalModel; }

	protected override readonly _modifiedModel: BaseTextEditorModel | undefined;
	override get modifiedModel(): BaseTextEditorModel | undefined { return this._modifiedModel; }

	private _textDiffEditorModel: IDiffEditorModel | undefined = undefined;
	get textDiffEditorModel(): IDiffEditorModel | undefined { return this._textDiffEditorModel; }

	constructor(originalModel: BaseTextEditorModel, modifiedModel: BaseTextEditorModel) {
		super(originalModel, modifiedModel);

		this._originalModel = originalModel;
		this._modifiedModel = modifiedModel;

		this.updateTextDiffEditorModel();
	}

	override async resolve(): Promise<void> {
		await super.resolve();

		this.updateTextDiffEditorModel();
	}

	private updateTextDiffEditorModel(): void {
		if (this.originalModel?.isResolved() && this.modifiedModel?.isResolved()) {

			// Create new
			if (!this._textDiffEditorModel) {
				this._textDiffEditorModel = {
					original: this.originalModel.textEditorModel,
					modified: this.modifiedModel.textEditorModel
				};
			}

			// Update existing
			else {
				this._textDiffEditorModel.original = this.originalModel.textEditorModel;
				this._textDiffEditorModel.modified = this.modifiedModel.textEditorModel;
			}
		}
	}

	override isResolved(): boolean {
		return !!this._textDiffEditorModel;
	}

	isReadonly(): boolean {
		return !!this.modifiedModel && this.modifiedModel.isReadonly();
	}

	override dispose(): void {

		// Free the diff editor model but do not propagate the dispose() call to the two models
		// inside. We never created the two models (original and modified) so we can not dispose
		// them without sideeffects. Rather rely on the models getting disposed when their related
		// inputs get disposed from the diffEditorInput.
		this._textDiffEditorModel = undefined;

		super.dispose();
	}
}
