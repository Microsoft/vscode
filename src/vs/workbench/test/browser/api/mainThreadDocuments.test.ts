/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { BoundModelReferenceCollection } from 'vs/workbench/api/browser/mainThreadDocuments';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { timeout } from 'vs/base/common/async';
import { URI } from 'vs/base/common/uri';
import { extUri } from 'vs/base/common/resources';

suite('BoundModelReferenceCollection', () => {

	let col = new BoundModelReferenceCollection(extUri, 15, 75);

	teardown(() => {
		col.dispose();
	});

	test('max age', async () => {

		let didDispose = false;

		col.add(
			URI.parse('test://farboo'),
			{
				object: <any>{ textEditorModel: createTextModel('farboo') },
				dispose() {
					didDispose = true;
				}
			});

		await timeout(30);
		assert.equal(didDispose, true);
	});

	test('max size', () => {

		let disposed: number[] = [];

		col.add(
			URI.parse('test://farboo'),
			{
				object: <any>{ textEditorModel: createTextModel('farboo') },
				dispose() {
					disposed.push(0);
				}
			});

		col.add(
			URI.parse('test://boofar'),
			{
				object: <any>{ textEditorModel: createTextModel('boofar') },
				dispose() {
					disposed.push(1);
				}
			});

		col.add(
			URI.parse('test://xxxxxxx'),
			{
				object: <any>{ textEditorModel: createTextModel(new Array(71).join('x')) },
				dispose() {
					disposed.push(2);
				}
			});

		assert.deepEqual(disposed, [0, 1]);
	});

	test('dispose uri', () => {

		let disposed: number[] = [];

		col.add(
			URI.parse('test:///farboo'),
			{
				object: <any>{ textEditorModel: createTextModel('farboo') },
				dispose() {
					disposed.push(0);
				}
			});

		col.add(
			URI.parse('test:///boofar'),
			{
				object: <any>{ textEditorModel: createTextModel('boofar') },
				dispose() {
					disposed.push(1);
				}
			});

		col.add(
			URI.parse('test:///boo/far1'),
			{
				object: <any>{ textEditorModel: createTextModel('boo/far1') },
				dispose() {
					disposed.push(2);
				}
			});

		col.add(
			URI.parse('test:///boo/far2'),
			{
				object: <any>{ textEditorModel: createTextModel('boo/far2') },
				dispose() {
					disposed.push(3);
				}
			});

		col.add(
			URI.parse('test:///boo1/far'),
			{
				object: <any>{ textEditorModel: createTextModel('boo1/far') },
				dispose() {
					disposed.push(4);
				}
			});

		col.remove(URI.parse('test:///unknown'));
		assert.equal(disposed.length, 0);

		col.remove(URI.parse('test:///farboo'));
		assert.deepEqual(disposed, [0]);

		disposed = [];

		col.remove(URI.parse('test:///boo'));
		assert.deepEqual(disposed, [2, 3]);
	});

});
