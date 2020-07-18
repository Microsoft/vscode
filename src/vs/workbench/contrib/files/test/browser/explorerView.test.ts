/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Emitter } from 'vs/base/common/event';
import { toResource } from 'vs/base/test/common/utils';
import { TestFileService } from 'vs/workbench/test/browser/workbenchTestServices';
import { ExplorerItem } from 'vs/workbench/contrib/files/common/explorerModel';
import { getContext } from 'vs/workbench/contrib/files/browser/views/explorerView';
import { listInvalidItemForeground } from 'vs/platform/theme/common/colorRegistry';
import { CompressedNavigationController } from 'vs/workbench/contrib/files/browser/views/explorerViewer';
import * as dom from 'vs/base/browser/dom';
import { Disposable } from 'vs/base/common/lifecycle';
import { provideDecorations } from 'vs/workbench/contrib/files/browser/views/explorerDecorationsProvider';
const $ = dom.$;

const fileService = new TestFileService();

function createStat(this: any, path: string, name: string, isFolder: boolean, hasChildren: boolean, size: number, mtime: number, isSymLink = false, isUnknown = false): ExplorerItem {
	return new ExplorerItem(toResource.call(this, path), fileService, undefined, isFolder, isSymLink, name, mtime, isUnknown);
}

suite('Files - ExplorerView', () => {

	test('getContext', async function () {
		const d = new Date().getTime();
		const s1 = createStat.call(this, '/', '/', true, false, 8096, d);
		const s2 = createStat.call(this, '/path', 'path', true, false, 8096, d);
		const s3 = createStat.call(this, '/path/to', 'to', true, false, 8096, d);
		const s4 = createStat.call(this, '/path/to/stat', 'stat', false, false, 8096, d);
		const noNavigationController = { getCompressedNavigationController: (stat: ExplorerItem) => undefined };

		assert.deepEqual(getContext([s1], [s2, s3, s4], true, noNavigationController), [s1]);
		assert.deepEqual(getContext([s1], [s1, s3, s4], true, noNavigationController), [s1, s3, s4]);
		assert.deepEqual(getContext([s1], [s3, s1, s4], false, noNavigationController), [s1]);
		assert.deepEqual(getContext([], [s3, s1, s4], false, noNavigationController), []);
		assert.deepEqual(getContext([], [s3, s1, s4], true, noNavigationController), [s3, s1, s4]);
	});

	test('decoration provider', async function () {
		const d = new Date().getTime();
		const s1 = createStat.call(this, '/path', 'path', true, false, 8096, d);
		s1.isError = true;
		const s2 = createStat.call(this, '/path/to', 'to', true, false, 8096, d, true);
		const s3 = createStat.call(this, '/path/to/stat', 'stat', false, false, 8096, d);
		assert.equal(provideDecorations(s3), undefined);
		assert.deepEqual(provideDecorations(s2), {
			tooltip: 'Symbolic Link',
			letter: '\u2937'
		});
		assert.deepEqual(provideDecorations(s1), {
			tooltip: 'Unable to resolve workspace folder',
			letter: '!',
			color: listInvalidItemForeground
		});

		const unknown = createStat.call(this, '/path/to/stat', 'stat', false, false, 8096, d, false, true);
		assert.deepEqual(provideDecorations(unknown), {
			tooltip: 'Unknown File Type',
			letter: '?'
		});
	});

	test('compressed navigation controller', async function () {
		const container = $('.file');
		const label = $('.label');
		const labelName1 = $('.label-name');
		const labelName2 = $('.label-name');
		const labelName3 = $('.label-name');
		const d = new Date().getTime();
		const s1 = createStat.call(this, '/path', 'path', true, false, 8096, d);
		const s2 = createStat.call(this, '/path/to', 'to', true, false, 8096, d);
		const s3 = createStat.call(this, '/path/to/stat', 'stat', false, false, 8096, d);

		dom.append(container, label);
		dom.append(label, labelName1);
		dom.append(label, labelName2);
		dom.append(label, labelName3);
		const emitter = new Emitter<void>();

		const navigationController = new CompressedNavigationController('id', [s1, s2, s3], {
			container,
			elementDisposable: Disposable.None,
			label: <any>{
				container: label,
				onDidRender: emitter.event
			}
		}, 1, false);

		assert.equal(navigationController.count, 3);
		assert.equal(navigationController.index, 2);
		assert.equal(navigationController.current, s3);
		navigationController.next();
		assert.equal(navigationController.current, s3);
		navigationController.previous();
		assert.equal(navigationController.current, s2);
		navigationController.previous();
		assert.equal(navigationController.current, s1);
		navigationController.previous();
		assert.equal(navigationController.current, s1);
		navigationController.last();
		assert.equal(navigationController.current, s3);
		navigationController.first();
		assert.equal(navigationController.current, s1);
		navigationController.setIndex(1);
		assert.equal(navigationController.current, s2);
		navigationController.setIndex(44);
		assert.equal(navigationController.current, s2);
	});
});
