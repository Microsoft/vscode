/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { IExtHostContext, IWorkspaceEditDto, MainThreadBulkEditsShape, MainContext } from 'vs/workbench/api/common/extHost.protocol'; import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { reviveWorkspaceEditDto2 } from 'vs/workbench/api/browser/mainThreadEditors';
import { ILogService } from 'vs/platform/log/common/log';

@extHostNamedCustomer(MainContext.MainThreadBulkEdits)
export class MainThreadBulkEdits implements MainThreadBulkEditsShape {

	constructor(
		_extHostContext: IExtHostContext,
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,
		@ILogService private readonly _logService: ILogService,
	) { }

	dispose(): void { }

	$tryApplyWorkspaceEdit(dto: IWorkspaceEditDto, undoRedoGroupId?: number): Promise<boolean> {
		const edits = reviveWorkspaceEditDto2(dto);
		return this._bulkEditService.apply(edits, { undoRedoGroupId }).then(() => true, err => {
			this._logService.warn('IGNORING workspace edit', err);
			return false;
		});
	}
}
