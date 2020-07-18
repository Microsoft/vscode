/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mergeSort } from 'vs/base/common/arrays';
import { dispose, IDisposable, IReference } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { EndOfLineSequence, IIdentifiedSingleEditOperation, ITextModel } from 'vs/editor/common/model';
import { WorkspaceTextEdit } from 'vs/editor/common/modes';
import { ITextModelService, IResolvedTextEditorModel } from 'vs/editor/common/services/resolverService';
import { IProgress } from 'vs/platform/progress/common/progress';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { SingleModelEditStackElement, MultiModelEditStackElement } from 'vs/editor/common/model/editStack';
import { ResourceMap } from 'vs/base/common/map';
import { IModelService } from 'vs/editor/common/services/modelService';

type ValidationResult = { canApply: true } | { canApply: false, reason: URI };

class ModelEditTask implements IDisposable {

	readonly model: ITextModel;

	private _expectedModelVersionId: number | undefined;
	protected _edits: IIdentifiedSingleEditOperation[];
	protected _newEol: EndOfLineSequence | undefined;

	constructor(private readonly _modelReference: IReference<IResolvedTextEditorModel>) {
		this.model = this._modelReference.object.textEditorModel;
		this._edits = [];
	}

	dispose() {
		this._modelReference.dispose();
	}

	addEdit(resourceEdit: WorkspaceTextEdit): void {
		this._expectedModelVersionId = resourceEdit.modelVersionId;
		const { edit } = resourceEdit;

		if (typeof edit.eol === 'number') {
			// honor eol-change
			this._newEol = edit.eol;
		}
		if (!edit.range && !edit.text) {
			// lacks both a range and the text
			return;
		}
		if (Range.isEmpty(edit.range) && !edit.text) {
			// no-op edit (replace empty range with empty text)
			return;
		}

		// create edit operation
		let range: Range;
		if (!edit.range) {
			range = this.model.getFullModelRange();
		} else {
			range = Range.lift(edit.range);
		}
		this._edits.push(EditOperation.replaceMove(range, edit.text));
	}

	validate(): ValidationResult {
		if (typeof this._expectedModelVersionId === 'undefined' || this.model.getVersionId() === this._expectedModelVersionId) {
			return { canApply: true };
		}
		return { canApply: false, reason: this.model.uri };
	}

	getBeforeCursorState(): Selection[] | null {
		return null;
	}

	apply(): void {
		if (this._edits.length > 0) {
			this._edits = mergeSort(this._edits, (a, b) => Range.compareRangesUsingStarts(a.range, b.range));
			this.model.pushEditOperations(null, this._edits, () => null);
		}
		if (this._newEol !== undefined) {
			this.model.pushEOL(this._newEol);
		}
	}
}

class EditorEditTask extends ModelEditTask {

	private _editor: ICodeEditor;

	constructor(modelReference: IReference<IResolvedTextEditorModel>, editor: ICodeEditor) {
		super(modelReference);
		this._editor = editor;
	}

	getBeforeCursorState(): Selection[] | null {
		return this._editor.getSelections();
	}

	apply(): void {
		if (this._edits.length > 0) {
			this._edits = mergeSort(this._edits, (a, b) => Range.compareRangesUsingStarts(a.range, b.range));
			this._editor.executeEdits('', this._edits);
		}
		if (this._newEol !== undefined) {
			if (this._editor.hasModel()) {
				this._editor.getModel().pushEOL(this._newEol);
			}
		}
	}
}

export class BulkTextEdits {

	private readonly _edits = new ResourceMap<WorkspaceTextEdit[]>();

	constructor(
		private readonly _label: string,
		private readonly _editor: ICodeEditor | undefined,
		private readonly _progress: IProgress<void>,
		edits: WorkspaceTextEdit[],
		@IEditorWorkerService private readonly _editorWorker: IEditorWorkerService,
		@IModelService private readonly _modelService: IModelService,
		@ITextModelService private readonly _textModelResolverService: ITextModelService,
		@IUndoRedoService private readonly _undoRedoService: IUndoRedoService
	) {

		for (const edit of edits) {
			let array = this._edits.get(edit.resource);
			if (!array) {
				array = [];
				this._edits.set(edit.resource, array);
			}
			array.push(edit);
		}
	}

	private _validateBeforePrepare(): void {
		// First check if loaded models were not changed in the meantime
		for (const array of this._edits.values()) {
			for (let edit of array) {
				if (typeof edit.modelVersionId === 'number') {
					let model = this._modelService.getModel(edit.resource);
					if (model && model.getVersionId() !== edit.modelVersionId) {
						// model changed in the meantime
						throw new Error(`${model.uri.toString()} has changed in the meantime`);
					}
				}
			}
		}
	}

	private async _createEditsTasks(): Promise<ModelEditTask[]> {

		const tasks: ModelEditTask[] = [];
		const promises: Promise<any>[] = [];

		for (let [key, value] of this._edits) {
			const promise = this._textModelResolverService.createModelReference(key).then(async ref => {
				let task: ModelEditTask;
				let makeMinimal = false;
				if (this._editor?.getModel()?.uri.toString() === ref.object.textEditorModel.uri.toString()) {
					task = new EditorEditTask(ref, this._editor);
					makeMinimal = true;
				} else {
					task = new ModelEditTask(ref);
				}

				for (const edit of value) {
					if (makeMinimal) {
						const newEdits = await this._editorWorker.computeMoreMinimalEdits(edit.resource, [edit.edit]);
						if (!newEdits) {
							task.addEdit(edit);
						} else {
							for (let moreMinialEdit of newEdits) {
								task.addEdit({ ...edit, edit: moreMinialEdit });
							}
						}
					} else {
						task.addEdit(edit);
					}
				}

				tasks.push(task);
				this._progress.report(undefined);
			});
			promises.push(promise);
		}

		await Promise.all(promises);
		return tasks;
	}

	private _validateTasks(tasks: ModelEditTask[]): ValidationResult {
		for (const task of tasks) {
			const result = task.validate();
			if (!result.canApply) {
				return result;
			}
		}
		return { canApply: true };
	}

	async apply(): Promise<void> {

		this._validateBeforePrepare();
		const tasks = await this._createEditsTasks();

		try {

			const validation = this._validateTasks(tasks);
			if (!validation.canApply) {
				throw new Error(`${validation.reason.toString()} has changed in the meantime`);
			}
			if (tasks.length === 1) {
				// This edit touches a single model => keep things simple
				for (const task of tasks) {
					task.model.pushStackElement();
					task.apply();
					task.model.pushStackElement();
					this._progress.report(undefined);
				}
			} else {
				// prepare multi model undo element
				const multiModelEditStackElement = new MultiModelEditStackElement(
					this._label,
					tasks.map(t => new SingleModelEditStackElement(t.model, t.getBeforeCursorState()))
				);
				this._undoRedoService.pushElement(multiModelEditStackElement);
				for (const task of tasks) {
					task.apply();
					this._progress.report(undefined);
				}
				multiModelEditStackElement.close();
			}

		} finally {
			dispose(tasks);
		}
	}
}
