/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { MainThreadDocumentContentProviders } from 'vs/workbench/api/browser/mainThreadDocumentContentProviders';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { mock } from 'vs/base/test/common/mock';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { TextEdit } from 'vs/editor/common/modes';

suite('MainThreadDocumentContentProviders', function () {

	test('events are processed properly', function () {

		let uri = URI.parse('test:uri');
		let model = createTextModel('1', undefined, undefined, uri);

		let providers = new MainThreadDocumentContentProviders(new TestRPCProtocol(), null!, null!,
			new class extends mock<IModelService>() {
				override getModel(_uri: URI) {
					assert.strictEqual(uri.toString(), _uri.toString());
					return model;
				}
			},
			new class extends mock<IEditorWorkerService>() {
				override computeMoreMinimalEdits(_uri: URI, data: TextEdit[] | undefined) {
					assert.strictEqual(model.getValue(), '1');
					return Promise.resolve(data);
				}
			},
		);

		return new Promise<void>((resolve, reject) => {
			let expectedEvents = 1;
			model.onDidChangeContent(e => {
				expectedEvents -= 1;
				try {
					assert.ok(expectedEvents >= 0);
				} catch (err) {
					reject(err);
				}
				if (model.getValue() === '1\n2\n3') {
					resolve();
				}
			});
			providers.$onVirtualDocumentChange(uri, '1\n2');
			providers.$onVirtualDocumentChange(uri, '1\n2\n3');
		});
	});
});
