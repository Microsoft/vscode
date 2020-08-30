/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import { MainContext, MainThreadTextEditorsShape, IWorkspaceEditDto, WorkspaceEditType } from 'vs/workbench/api/common/extHost.protocol';
import { URI } from 'vs/base/common/uri';
import { mock } from 'vs/base/test/common/mock';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { SingleProxyRPCProtocol, TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { ExtHostEditors } from 'vs/workbench/api/common/extHostTextEditors';
import { NullLogService } from 'vs/platform/log/common/log';
import { assertType } from 'vs/base/common/types';

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
		editors = new ExtHostEditors(rpcProtocol, documentsAndEditors, null!);
	});

	test('uses version id if document available', async () => {
		let edit = new extHostTypes.WorkspaceEdit();
		edit.replace(resource, new extHostTypes.Range(0, 0, 0, 0), 'hello');
		await editors.applyWorkspaceEdit(edit);
		assert.equal(workspaceResourceEdits.edits.length, 1);
		const [first] = workspaceResourceEdits.edits;
		assertType(first._type === WorkspaceEditType.Text);
		assert.equal(first.modelVersionId, 1337);
	});

	test('does not use version id if document is not available', async () => {
		let edit = new extHostTypes.WorkspaceEdit();
		edit.replace(URI.parse('foo:bar2'), new extHostTypes.Range(0, 0, 0, 0), 'hello');
		await editors.applyWorkspaceEdit(edit);
		assert.equal(workspaceResourceEdits.edits.length, 1);
		const [first] = workspaceResourceEdits.edits;
		assertType(first._type === WorkspaceEditType.Text);
		assert.ok(typeof first.modelVersionId === 'undefined');
	});

});
