/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
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

class BulkEdit {

	constructor(
		private readonly _label: string | undefined,
		private readonly _editor: ICodeEditor | undefined,
		private readonly _progress: IProgress<IProgressStep>,
		private readonly _edits: ResourceEdit[],
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

		this._progress.report({ total: this._edits.length });
		const progress: IProgress<void> = { report: _ => this._progress.report({ increment: 1 }) };


		let index = 0;
		for (let range of ranges) {
			const group = this._edits.slice(index, index + range);
			if (group[0] instanceof ResourceFileEdit) {
				await this._performFileEdits(<ResourceFileEdit[]>group, progress);
			} else if (group[0] instanceof ResourceTextEdit) {
				await this._performTextEdits(<ResourceTextEdit[]>group, progress);
			} else if (group[0] instanceof ResourceNotebookCellEdit) {
				await this._performCellEdits(<ResourceNotebookCellEdit[]>group, progress);
			} else {
				console.log('UNKNOWN EDIT');
			}
			index = index + range;
		}
	}

	private async _performFileEdits(edits: ResourceFileEdit[], progress: IProgress<void>) {
		this._logService.debug('_performFileEdits', JSON.stringify(edits));
		const model = this._instaService.createInstance(BulkFileEdits, this._label || localize('workspaceEdit', "Workspace Edit"), progress, edits);
		await model.apply();
	}

	private async _performTextEdits(edits: ResourceTextEdit[], progress: IProgress<void>): Promise<void> {
		this._logService.debug('_performTextEdits', JSON.stringify(edits));
		const model = this._instaService.createInstance(BulkTextEdits, this._label || localize('workspaceEdit', "Workspace Edit"), this._editor, progress, edits);
		await model.apply();
	}

	private async _performCellEdits(edits: ResourceNotebookCellEdit[], progress: IProgress<void>): Promise<void> {
		this._logService.debug('_performCellEdits', JSON.stringify(edits));
		const model = this._instaService.createInstance(BulkCellEdits, progress, edits);
		await model.apply();
	}
}

export class BulkEditService implements IBulkEditService {

	declare readonly _serviceBrand: undefined;

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

		if (this._previewHandler && (options?.showPreview || edits.some(value => value.metadata?.needsConfirmation))) {
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

		const bulkEdit = this._instaService.createInstance(
			BulkEdit,
			options?.quotableLabel || options?.label,
			codeEditor, options?.progress ?? Progress.None,
			edits
		);

		try {
			await bulkEdit.perform();
			return { ariaSummary: bulkEdit.ariaMessage() };
		} catch (err) {
			// console.log('apply FAILED');
			// console.log(err);
			this._logService.error(err);
			throw err;
		}
	}
}

registerSingleton(IBulkEditService, BulkEditService, true);
