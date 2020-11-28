/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBulkEditService, ResourceEdit, ResourceFileEdit, ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';
import { IExtHostContext, IWorkspaceEditDto, WorkspaceEditType, MainThreadBulkEditsShape, MainContext } from 'vs/workbench/api/common/extHost.protocol';
import { revive } from 'vs/base/common/marshalling';
import { ResourceNotebookCellEdit } from 'vs/workbench/contrib/bulkEdit/browser/bulkCellEdits';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';

function reviveWorkspaceEditDto2(data: IWorkspaceEditDto | undefined): ResourceEdit[] {
	if (!data?.edits) {
		return [];
	}

	const result: ResourceEdit[] = [];
	for (let edit of revive<IWorkspaceEditDto>(data).edits) {
		if (edit._type === WorkspaceEditType.File) {
			result.push(new ResourceFileEdit(edit.oldUri, edit.newUri, edit.options, edit.metadata));
		} else if (edit._type === WorkspaceEditType.Text) {
			result.push(new ResourceTextEdit(edit.resource, edit.edit, edit.modelVersionId, edit.metadata));
		} else if (edit._type === WorkspaceEditType.Cell) {
			result.push(new ResourceNotebookCellEdit(edit.resource, edit.edit, edit.notebookVersionId, edit.metadata));
		}
	}
	return result;
}

@extHostNamedCustomer(MainContext.MainThreadBulkEdits)
export class MainThreadBulkEdits implements MainThreadBulkEditsShape {

	constructor(
		_extHostContext: IExtHostContext,
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,
	) { }

	dispose(): void { }

	$tryApplyWorkspaceEdit(dto: IWorkspaceEditDto, undoRedoGroupId?: number): Promise<boolean> {
		const edits = reviveWorkspaceEditDto2(dto);
		return this._bulkEditService.apply(edits, { undoRedoGroupId }).then(() => true, _err => false);
	}
}
