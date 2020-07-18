/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ICodeEditor, isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IBulkEditOptions, IBulkEditResult, IBulkEditService, IBulkEditPreviewHandler } from 'vs/editor/browser/services/bulkEditService';
import { WorkspaceFileEdit, WorkspaceTextEdit, WorkspaceEdit } from 'vs/editor/common/modes';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { IProgress, IProgressStep, Progress } from 'vs/platform/progress/common/progress';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { BulkTextEdits } from 'vs/workbench/services/bulkEdit/browser/bulkTextEdits';
import { BulkFileEdits } from 'vs/workbench/services/bulkEdit/browser/bulkFileEdits';
import { ResourceMap } from 'vs/base/common/map';

type Edit = WorkspaceFileEdit | WorkspaceTextEdit;

class BulkEdit {

	private readonly _label: string | undefined;
	private readonly _edits: Edit[] = [];
	private readonly _editor: ICodeEditor | undefined;
	private readonly _progress: IProgress<IProgressStep>;

	constructor(
		label: string | undefined,
		editor: ICodeEditor | undefined,
		progress: IProgress<IProgressStep> | undefined,
		edits: Edit[],
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
	) {
		this._label = label;
		this._editor = editor;
		this._progress = progress || Progress.None;
		this._edits = edits;
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

		let seen = new ResourceMap<true>();
		let total = 0;

		const groups: Edit[][] = [];
		let group: Edit[] | undefined;
		for (const edit of this._edits) {
			if (!group
				|| (WorkspaceFileEdit.is(group[0]) && !WorkspaceFileEdit.is(edit))
				|| (WorkspaceTextEdit.is(group[0]) && !WorkspaceTextEdit.is(edit))
			) {
				group = [];
				groups.push(group);
			}
			group.push(edit);

			if (WorkspaceFileEdit.is(edit)) {
				total += 1;
			} else if (!seen.has(edit.resource)) {
				seen.set(edit.resource, true);
				total += 2;
			}
		}

		// define total work and progress callback
		// for child operations
		this._progress.report({ total });

		const progress: IProgress<void> = { report: _ => this._progress.report({ increment: 1 }) };

		// do it.
		for (const group of groups) {
			if (WorkspaceFileEdit.is(group[0])) {
				await this._performFileEdits(<WorkspaceFileEdit[]>group, progress);
			} else {
				await this._performTextEdits(<WorkspaceTextEdit[]>group, progress);
			}
		}
	}

	private async _performFileEdits(edits: WorkspaceFileEdit[], progress: IProgress<void>) {
		this._logService.debug('_performFileEdits', JSON.stringify(edits));
		const model = this._instaService.createInstance(BulkFileEdits, this._label || localize('workspaceEdit', "Workspace Edit"), progress, edits);
		await model.apply();
	}

	private async _performTextEdits(edits: WorkspaceTextEdit[], progress: IProgress<void>): Promise<void> {
		this._logService.debug('_performTextEdits', JSON.stringify(edits));
		const model = this._instaService.createInstance(BulkTextEdits, this._label || localize('workspaceEdit', "Workspace Edit"), this._editor, progress, edits);
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

	async apply(edit: WorkspaceEdit, options?: IBulkEditOptions): Promise<IBulkEditResult> {

		if (edit.edits.length === 0) {
			return { ariaSummary: localize('nothing', "Made no edits") };
		}

		if (this._previewHandler && (options?.showPreview || edit.edits.some(value => value.metadata?.needsConfirmation))) {
			edit = await this._previewHandler(edit, options);
		}

		const { edits } = edit;
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
		const bulkEdit = this._instaService.createInstance(BulkEdit, options?.quotableLabel || options?.label, codeEditor, options?.progress, edits);
		return bulkEdit.perform().then(() => {
			return { ariaSummary: bulkEdit.ariaMessage() };
		}).catch(err => {
			// console.log('apply FAILED');
			// console.log(err);
			this._logService.error(err);
			throw err;
		});
	}
}

registerSingleton(IBulkEditService, BulkEditService, true);
