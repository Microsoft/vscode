/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { NOTEBOOK_DISPLAY_ORDER, sortMimeTypes, CellKind, diff, CellUri } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { TestCell, setupInstantiationService } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { URI } from 'vs/base/common/uri';
import { ITextModelService } from 'vs/editor/common/services/resolverService';

suite('NotebookCommon', () => {
	const instantiationService = setupInstantiationService();
	const textModelService = instantiationService.get(ITextModelService);

	test('sortMimeTypes default orders', function () {
		const defaultDisplayOrder = NOTEBOOK_DISPLAY_ORDER;

		assert.deepEqual(sortMimeTypes(
			[
				'application/json',
				'application/javascript',
				'text/html',
				'image/svg+xml',
				'text/markdown',
				'image/png',
				'image/jpeg',
				'text/plain'
			], [], [], defaultDisplayOrder),
			[
				'application/json',
				'application/javascript',
				'text/html',
				'image/svg+xml',
				'text/markdown',
				'image/png',
				'image/jpeg',
				'text/plain'
			]
		);

		assert.deepEqual(sortMimeTypes(
			[
				'application/json',
				'text/markdown',
				'application/javascript',
				'text/html',
				'text/plain',
				'image/png',
				'image/jpeg',
				'image/svg+xml'
			], [], [], defaultDisplayOrder),
			[
				'application/json',
				'application/javascript',
				'text/html',
				'image/svg+xml',
				'text/markdown',
				'image/png',
				'image/jpeg',
				'text/plain'
			]
		);

		assert.deepEqual(sortMimeTypes(
			[
				'text/markdown',
				'application/json',
				'text/plain',
				'image/jpeg',
				'application/javascript',
				'text/html',
				'image/png',
				'image/svg+xml'
			], [], [], defaultDisplayOrder),
			[
				'application/json',
				'application/javascript',
				'text/html',
				'image/svg+xml',
				'text/markdown',
				'image/png',
				'image/jpeg',
				'text/plain'
			]
		);
	});

	test('sortMimeTypes document orders', function () {
		const defaultDisplayOrder = NOTEBOOK_DISPLAY_ORDER;
		assert.deepEqual(sortMimeTypes(
			[
				'application/json',
				'application/javascript',
				'text/html',
				'image/svg+xml',
				'text/markdown',
				'image/png',
				'image/jpeg',
				'text/plain'
			], [],
			[
				'text/markdown',
				'text/html',
				'application/json'
			], defaultDisplayOrder),
			[
				'text/markdown',
				'text/html',
				'application/json',
				'application/javascript',
				'image/svg+xml',
				'image/png',
				'image/jpeg',
				'text/plain'
			]
		);

		assert.deepEqual(sortMimeTypes(
			[
				'text/markdown',
				'application/json',
				'text/plain',
				'application/javascript',
				'text/html',
				'image/svg+xml',
				'image/jpeg',
				'image/png'
			], [],
			[
				'text/html',
				'text/markdown',
				'application/json'
			], defaultDisplayOrder),
			[
				'text/html',
				'text/markdown',
				'application/json',
				'application/javascript',
				'image/svg+xml',
				'image/png',
				'image/jpeg',
				'text/plain'
			]
		);
	});

	test('sortMimeTypes user orders', function () {
		const defaultDisplayOrder = NOTEBOOK_DISPLAY_ORDER;
		assert.deepEqual(sortMimeTypes(
			[
				'application/json',
				'application/javascript',
				'text/html',
				'image/svg+xml',
				'text/markdown',
				'image/png',
				'image/jpeg',
				'text/plain'
			],
			[
				'image/png',
				'text/plain',
			],
			[
				'text/markdown',
				'text/html',
				'application/json'
			], defaultDisplayOrder),
			[
				'image/png',
				'text/plain',
				'text/markdown',
				'text/html',
				'application/json',
				'application/javascript',
				'image/svg+xml',
				'image/jpeg',
			]
		);

		assert.deepEqual(sortMimeTypes(
			[
				'text/markdown',
				'application/json',
				'text/plain',
				'application/javascript',
				'text/html',
				'image/svg+xml',
				'image/jpeg',
				'image/png'
			],
			[
				'application/json',
				'text/html',
			],
			[
				'text/html',
				'text/markdown',
				'application/json'
			], defaultDisplayOrder),
			[
				'application/json',
				'text/html',
				'text/markdown',
				'application/javascript',
				'image/svg+xml',
				'image/png',
				'image/jpeg',
				'text/plain'
			]
		);
	});

	test('sortMimeTypes glob', function () {
		const defaultDisplayOrder = NOTEBOOK_DISPLAY_ORDER;

		// unknown mime types come last
		assert.deepEqual(sortMimeTypes(
			[
				'application/json',
				'application/vnd-vega.json',
				'application/vnd-plot.json',
				'application/javascript',
				'text/html'
			], [],
			[
				'text/markdown',
				'text/html',
				'application/json'
			], defaultDisplayOrder),
			[
				'text/html',
				'application/json',
				'application/javascript',
				'application/vnd-vega.json',
				'application/vnd-plot.json'
			],
			'unknown mimetypes keep the ordering'
		);

		assert.deepEqual(sortMimeTypes(
			[
				'application/json',
				'application/javascript',
				'text/html',
				'application/vnd-plot.json',
				'application/vnd-vega.json'
			], [],
			[
				'application/vnd-vega*',
				'text/markdown',
				'text/html',
				'application/json'
			], defaultDisplayOrder),
			[
				'application/vnd-vega.json',
				'text/html',
				'application/json',
				'application/javascript',
				'application/vnd-plot.json'
			],
			'glob *'
		);
	});

	test('diff cells', function () {
		const cells: TestCell[] = [];

		for (let i = 0; i < 5; i++) {
			cells.push(
				new TestCell('notebook', i, [`var a = ${i};`], 'javascript', CellKind.Code, [], textModelService)
			);
		}

		assert.deepEqual(diff<TestCell>(cells, [], (cell) => {
			return cells.indexOf(cell) > -1;
		}), [
			{
				start: 0,
				deleteCount: 5,
				toInsert: []
			}
		]
		);

		assert.deepEqual(diff<TestCell>([], cells, (cell) => {
			return false;
		}), [
			{
				start: 0,
				deleteCount: 0,
				toInsert: cells
			}
		]
		);

		const cellA = new TestCell('notebook', 6, ['var a = 6;'], 'javascript', CellKind.Code, [], textModelService);
		const cellB = new TestCell('notebook', 7, ['var a = 7;'], 'javascript', CellKind.Code, [], textModelService);

		const modifiedCells = [
			cells[0],
			cells[1],
			cellA,
			cells[3],
			cellB,
			cells[4]
		];

		const splices = diff<TestCell>(cells, modifiedCells, (cell) => {
			return cells.indexOf(cell) > -1;
		});

		assert.deepEqual(splices,
			[
				{
					start: 2,
					deleteCount: 1,
					toInsert: [cellA]
				},
				{
					start: 4,
					deleteCount: 0,
					toInsert: [cellB]
				}
			]
		);
	});
});


suite('CellUri', function () {

	test('parse, generate (file-scheme)', function () {

		const nb = URI.parse('foo:///bar/følder/file.nb');
		const id = 17;

		const data = CellUri.generate(nb, id);
		const actual = CellUri.parse(data);
		assert.ok(Boolean(actual));
		assert.equal(actual?.handle, id);
		assert.equal(actual?.notebook.toString(), nb.toString());
	});

	test('parse, generate (foo-scheme)', function () {

		const nb = URI.parse('foo:///bar/følder/file.nb');
		const id = 17;

		const data = CellUri.generate(nb, id);
		const actual = CellUri.parse(data);
		assert.ok(Boolean(actual));
		assert.equal(actual?.handle, id);
		assert.equal(actual?.notebook.toString(), nb.toString());
	});
});
