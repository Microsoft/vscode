/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditor, isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IBulkEditOptions, IBulkEditResult, IBulkEditService, IBulkEditPreviewHandler, ResourceEdit, ResourceFileEdit, ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { IProgress, IProgressStep, Progress } from 'vs/platform/progress/common/progress';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { BulkTextEdits } from 'vs/workbench/contrib/bulkEdit/browser/bulkTextEdits';
import { BulkFileEdits } from 'vs/workbench/contrib/bulkEdit/browser/bulkFileEdits';
import { BulkCellEdits, ResourceNotebookCellEdit } from 'vs/workbench/contrib/bulkEdit/browser/bulkCellEdits';
import { UndoRedoGroup, UndoRedoSource } from 'vs/platform/undoRedo/common/undoRedo';
import { LinkedList } from 'vs/base/common/linkedList';
import { CancellationToken } from 'vs/base/common/cancellation';

class BulkEdit {

	constructor(
		private readonly _label: string | undefined,
		private readonly _editor: ICodeEditor | undefined,
		private readonly _progress: IProgress<IProgressStep>,
		private readonly _token: CancellationToken,
		private readonly _edits: ResourceEdit[],
		private readonly _undoRedoGroup: UndoRedoGroup,
		private readonly _undoRedoSource: UndoRedoSource | undefined,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {

	}

	ariaMessage(): string {
		const editCount = this._edits.length;
		const resourceCount = this._edits.length;
		if (editCount === 0) {
			return localize('summary.0', "Made no edits");
		} else if (editCount > 1 && resourceCount > 1) {
			return localize('summary.nm', "Made {0} text edits in {1} files", editCount, resourceCount);
		} else {
			return localize('summary.n0', "Made {0} text edits in one file", editCount, resourceCount);
		}
	}

	async perform(): Promise<void> {

		if (this._edits.length === 0) {
			return;
		}

		const ranges: number[] = [1];
		for (let i = 1; i < this._edits.length; i++) {
			if (Object.getPrototypeOf(this._edits[i - 1]) === Object.getPrototypeOf(this._edits[i])) {
				ranges[ranges.length - 1]++;
			} else {
				ranges.push(1);
			}
		}

		// Show infinte progress when there is only 1 item since we do not know how long it takes
		const increment = this._edits.length > 1 ? 0 : undefined;
		this._progress.report({ increment, total: 100 });
		// Increment by percentage points since progress API expects that
		const progress: IProgress<void> = { report: _ => this._progress.report({ increment: 100 / this._edits.length }) };

		let index = 0;
		for (let range of ranges) {
			if (this._token.isCancellationRequested) {
				break;
			}
			const group = this._edits.slice(index, index + range);
			if (group[0] instanceof ResourceFileEdit) {
				await this._performFileEdits(<ResourceFileEdit[]>group, this._undoRedoGroup, this._undoRedoSource, progress);
			} else if (group[0] instanceof ResourceTextEdit) {
				await this._performTextEdits(<ResourceTextEdit[]>group, this._undoRedoGroup, this._undoRedoSource, progress);
			} else if (group[0] instanceof ResourceNotebookCellEdit) {
				await this._performCellEdits(<ResourceNotebookCellEdit[]>group, this._undoRedoGroup, this._undoRedoSource, progress);
			} else {
				console.log('UNKNOWN EDIT');
			}
			index = index + range;
		}
	}

	private async _performFileEdits(edits: ResourceFileEdit[], undoRedoGroup: UndoRedoGroup, undoRedoSource: UndoRedoSource | undefined, progress: IProgress<void>) {
		this._logService.debug('_performFileEdits', JSON.stringify(edits));
		const model = this._instaService.createInstance(BulkFileEdits, this._label || localize('workspaceEdit', "Workspace Edit"), undoRedoGroup, undoRedoSource, progress, this._token, edits);
		await model.apply();
	}

	private async _performTextEdits(edits: ResourceTextEdit[], undoRedoGroup: UndoRedoGroup, undoRedoSource: UndoRedoSource | undefined, progress: IProgress<void>): Promise<void> {
		this._logService.debug('_performTextEdits', JSON.stringify(edits));
		const model = this._instaService.createInstance(BulkTextEdits, this._label || localize('workspaceEdit', "Workspace Edit"), this._editor, undoRedoGroup, undoRedoSource, progress, this._token, edits);
		await model.apply();
	}

	private async _performCellEdits(edits: ResourceNotebookCellEdit[], undoRedoGroup: UndoRedoGroup, undoRedoSource: UndoRedoSource | undefined, progress: IProgress<void>): Promise<void> {
		this._logService.debug('_performCellEdits', JSON.stringify(edits));
		const model = this._instaService.createInstance(BulkCellEdits, undoRedoGroup, undoRedoSource, progress, this._token, edits);
		await model.apply();
	}
}

export class BulkEditService implements IBulkEditService {

	declare readonly _serviceBrand: undefined;

	private readonly _activeUndoRedoGroups = new LinkedList<UndoRedoGroup>();
	private _previewHandler?: IBulkEditPreviewHandler;

	constructor(
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IEditorService private readonly _editorService: IEditorService,
	) { }

	setPreviewHandler(handler: IBulkEditPreviewHandler): IDisposable {
		this._previewHandler = handler;
		return toDisposable(() => {
			if (this._previewHandler === handler) {
				this._previewHandler = undefined;
			}
		});
	}

	hasPreviewHandler(): boolean {
		return Boolean(this._previewHandler);
	}

	async apply(edits: ResourceEdit[], options?: IBulkEditOptions): Promise<IBulkEditResult> {

		if (edits.length === 0) {
			return { ariaSummary: localize('nothing', "Made no edits") };
		}

		if (this._previewHandler && !options?.suppressPreview && (options?.showPreview || edits.some(value => value.metadata?.needsConfirmation))) {
			edits = await this._previewHandler(edits, options);
		}

		let codeEditor = options?.editor;
		// try to find code editor
		if (!codeEditor) {
			let candidate = this._editorService.activeTextEditorControl;
			if (isCodeEditor(candidate)) {
				codeEditor = candidate;
			}
		}

		if (codeEditor && codeEditor.getOption(EditorOption.readOnly)) {
			// If the code editor is readonly still allow bulk edits to be applied #68549
			codeEditor = undefined;
		}

		// undo-redo-group: if a group id is passed then try to find it
		// in the list of active edits. otherwise (or when not found)
		// create a separate undo-redo-group
		let undoRedoGroup: UndoRedoGroup | undefined;
		let undoRedoGroupRemove = () => { };
		if (typeof options?.undoRedoGroupId === 'number') {
			for (let candidate of this._activeUndoRedoGroups) {
				if (candidate.id === options.undoRedoGroupId) {
					undoRedoGroup = candidate;
					break;
				}
			}
		}
		if (!undoRedoGroup) {
			undoRedoGroup = new UndoRedoGroup();
			undoRedoGroupRemove = this._activeUndoRedoGroups.push(undoRedoGroup);
		}

		const bulkEdit = this._instaService.createInstance(
			BulkEdit,
			options?.quotableLabel || options?.label,
			codeEditor,
			options?.progress ?? Progress.None,
			options?.token ?? CancellationToken.None,
			edits,
			undoRedoGroup,
			options?.undoRedoSource
		);

		try {
			await bulkEdit.perform();
			return { ariaSummary: bulkEdit.ariaMessage() };
		} catch (err) {
			// console.log('apply FAILED');
			// console.log(err);
			this._logService.error(err);
			throw err;
		} finally {
			undoRedoGroupRemove();
		}
	}
}

registerSingleton(IBulkEditService, BulkEditService, true);
