/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import { MainContext, IWorkspaceEditDto, WorkspaceEditType, MainThreadBulkEditsShape } from 'vs/workbench/api/common/extHost.protocol';
import { URI } from 'vs/base/common/uri';
import { mock } from 'vs/base/test/common/mock';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { SingleProxyRPCProtocol, TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { NullLogService } from 'vs/platform/log/common/log';
import { assertType } from 'vs/base/common/types';
import { ExtHostBulkEdits } from 'vs/workbench/api/common/extHostBulkEdits';

suite('ExtHostBulkEdits.applyWorkspaceEdit', () => {

	const resource = URI.parse('foo:bar');
	let bulkEdits: ExtHostBulkEdits;
	let workspaceResourceEdits: IWorkspaceEditDto;

	setup(() => {
		workspaceResourceEdits = null!;

		let rpcProtocol = new TestRPCProtocol();
		rpcProtocol.set(MainContext.MainThreadBulkEdits, new class extends mock<MainThreadBulkEditsShape>() {
			override $tryApplyWorkspaceEdit(_workspaceResourceEdits: IWorkspaceEditDto): Promise<boolean> {
				workspaceResourceEdits = _workspaceResourceEdits;
				return Promise.resolve(true);
			}
		});
		const documentsAndEditors = new ExtHostDocumentsAndEditors(SingleProxyRPCProtocol(null), new NullLogService());
		documentsAndEditors.$acceptDocumentsAndEditorsDelta({
			addedDocuments: [{
				isDirty: false,
				modeId: 'foo',
				uri: resource,
				versionId: 1337,
				lines: ['foo'],
				EOL: '\n',
			}]
		});
		bulkEdits = new ExtHostBulkEdits(rpcProtocol, documentsAndEditors);
	});

	test('uses version id if document available', async () => {
		let edit = new extHostTypes.WorkspaceEdit();
		edit.replace(resource, new extHostTypes.Range(0, 0, 0, 0), 'hello');
		await bulkEdits.applyWorkspaceEdit(edit);
		assert.strictEqual(workspaceResourceEdits.edits.length, 1);
		const [first] = workspaceResourceEdits.edits;
		assertType(first._type === WorkspaceEditType.Text);
		assert.strictEqual(first.modelVersionId, 1337);
	});

	test('does not use version id if document is not available', async () => {
		let edit = new extHostTypes.WorkspaceEdit();
		edit.replace(URI.parse('foo:bar2'), new extHostTypes.Range(0, 0, 0, 0), 'hello');
		await bulkEdits.applyWorkspaceEdit(edit);
		assert.strictEqual(workspaceResourceEdits.edits.length, 1);
		const [first] = workspaceResourceEdits.edits;
		assertType(first._type === WorkspaceEditType.Text);
		assert.ok(typeof first.modelVersionId === 'undefined');
	});

});
