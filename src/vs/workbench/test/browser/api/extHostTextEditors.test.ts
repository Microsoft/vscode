/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import { MainContext, MainThreadTextEditorsShape, IWorkspaceEditDto } from 'vs/workbench/api/common/extHost.protocol';
import { URI } from 'vs/base/common/uri';
import { mock } from 'vs/base/test/common/mock';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { SingleProxyRPCProtocol, TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { ExtHostEditors } from 'vs/workbench/api/common/extHostTextEditors';
import { WorkspaceTextEdit } from 'vs/editor/common/modes';
import { NullLogService } from 'vs/platform/log/common/log';

suite('ExtHostTextEditors.applyWorkspaceEdit', () => {

	const resource = URI.parse('foo:bar');
	let editors: ExtHostEditors;
	let workspaceResourceEdits: IWorkspaceEditDto;

	setup(() => {
		workspaceResourceEdits = null!;

		let rpcProtocol = new TestRPCProtocol();
		rpcProtocol.set(MainContext.MainThreadTextEditors, new class extends mock<MainThreadTextEditorsShape>() {
			$tryApplyWorkspaceEdit(_workspaceResourceEdits: IWorkspaceEditDto): Promise<boolean> {
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
		editors = new ExtHostEditors(rpcProtocol, documentsAndEditors);
	});

	test('uses version id if document available', async () => {
		let edit = new extHostTypes.WorkspaceEdit();
		edit.replace(resource, new extHostTypes.Range(0, 0, 0, 0), 'hello');
		await editors.applyWorkspaceEdit(edit);
		assert.equal(workspaceResourceEdits.edits.length, 1);
		assert.equal((<WorkspaceTextEdit>workspaceResourceEdits.edits[0]).modelVersionId, 1337);
	});

	test('does not use version id if document is not available', async () => {
		let edit = new extHostTypes.WorkspaceEdit();
		edit.replace(URI.parse('foo:bar2'), new extHostTypes.Range(0, 0, 0, 0), 'hello');
		await editors.applyWorkspaceEdit(edit);
		assert.equal(workspaceResourceEdits.edits.length, 1);
		assert.ok(typeof (<WorkspaceTextEdit>workspaceResourceEdits.edits[0]).modelVersionId === 'undefined');
	});

});
