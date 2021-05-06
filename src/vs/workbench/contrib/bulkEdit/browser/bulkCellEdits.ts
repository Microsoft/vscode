/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { groupBy } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { compare } from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { ResourceEdit } from 'vs/editor/browser/services/bulkEditService';
import { WorkspaceEditMetadata } from 'vs/editor/common/modes';
import { IProgress } from 'vs/platform/progress/common/progress';
import { UndoRedoGroup, UndoRedoSource } from 'vs/platform/undoRedo/common/undoRedo';
import { ICellEditOperation } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookEditorModelResolverService } from 'vs/workbench/contrib/notebook/common/notebookEditorModelResolverService';

export class ResourceNotebookCellEdit extends ResourceEdit {

	constructor(
		readonly resource: URI,
		readonly cellEdit: ICellEditOperation,
		readonly versionId?: number,
		metadata?: WorkspaceEditMetadata
	) {
		super(metadata);
	}
}

export class BulkCellEdits {

	constructor(
		private readonly _undoRedoGroup: UndoRedoGroup,
		undoRedoSource: UndoRedoSource | undefined,
		private readonly _progress: IProgress<void>,
		private readonly _token: CancellationToken,
		private readonly _edits: ResourceNotebookCellEdit[],
		@INotebookEditorModelResolverService private readonly _notebookModelService: INotebookEditorModelResolverService,
	) { }

	async apply(): Promise<void> {

		const editsByNotebook = groupBy(this._edits, (a, b) => compare(a.resource.toString(), b.resource.toString()));

		for (let group of editsByNotebook) {
			if (this._token.isCancellationRequested) {
				break;
			}
			const [first] = group;
			const ref = await this._notebookModelService.resolve(first.resource);

			// check state
			if (typeof first.versionId === 'number' && ref.object.notebook.versionId !== first.versionId) {
				ref.dispose();
				throw new Error(`Notebook '${first.resource}' has changed in the meantime`);
			}

			// apply edits
			const edits = group.map(entry => entry.cellEdit);
			ref.object.notebook.applyEdits(edits, true, undefined, () => undefined, this._undoRedoGroup);
			ref.dispose();

			this._progress.report(undefined);
		}
	}
}
