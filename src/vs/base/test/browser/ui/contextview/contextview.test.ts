/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { layout, LayoutAnchorPosition } from 'vs/base/browser/ui/contextview/contextview';

suite('Contextview', function () {

	test('layout', () => {
		assert.equal(layout(200, 20, { offset: 0, size: 0, position: LayoutAnchorPosition.Before }), 0);
		assert.equal(layout(200, 20, { offset: 50, size: 0, position: LayoutAnchorPosition.Before }), 50);
		assert.equal(layout(200, 20, { offset: 200, size: 0, position: LayoutAnchorPosition.Before }), 180);

		assert.equal(layout(200, 20, { offset: 0, size: 0, position: LayoutAnchorPosition.After }), 0);
		assert.equal(layout(200, 20, { offset: 50, size: 0, position: LayoutAnchorPosition.After }), 30);
		assert.equal(layout(200, 20, { offset: 200, size: 0, position: LayoutAnchorPosition.After }), 180);

		assert.equal(layout(200, 20, { offset: 0, size: 50, position: LayoutAnchorPosition.Before }), 50);
		assert.equal(layout(200, 20, { offset: 50, size: 50, position: LayoutAnchorPosition.Before }), 100);
		assert.equal(layout(200, 20, { offset: 150, size: 50, position: LayoutAnchorPosition.Before }), 130);

		assert.equal(layout(200, 20, { offset: 0, size: 50, position: LayoutAnchorPosition.After }), 50);
		assert.equal(layout(200, 20, { offset: 50, size: 50, position: LayoutAnchorPosition.After }), 30);
		assert.equal(layout(200, 20, { offset: 150, size: 50, position: LayoutAnchorPosition.After }), 130);
	});
});
