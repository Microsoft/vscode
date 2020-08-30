/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ScrollbarState } from 'vs/base/browser/ui/scrollbar/scrollbarState';

suite('ScrollbarState', () => {
	test('inflates slider size', () => {
		let actual = new ScrollbarState(0, 14, 0, 339, 42423, 32787);

		assert.equal(actual.getArrowSize(), 0);
		assert.equal(actual.getScrollPosition(), 32787);
		assert.equal(actual.getRectangleLargeSize(), 339);
		assert.equal(actual.getRectangleSmallSize(), 14);
		assert.equal(actual.isNeeded(), true);
		assert.equal(actual.getSliderSize(), 20);
		assert.equal(actual.getSliderPosition(), 249);


		assert.equal(actual.getDesiredScrollPositionFromOffset(259), 32849);
		actual.setScrollPosition(32849);
		assert.equal(actual.getArrowSize(), 0);
		assert.equal(actual.getScrollPosition(), 32849);
		assert.equal(actual.getRectangleLargeSize(), 339);
		assert.equal(actual.getRectangleSmallSize(), 14);
		assert.equal(actual.isNeeded(), true);
		assert.equal(actual.getSliderSize(), 20);
		assert.equal(actual.getSliderPosition(), 249);
	});

	test('inflates slider size with arrows', () => {
		let actual = new ScrollbarState(12, 14, 0, 339, 42423, 32787);

		assert.equal(actual.getArrowSize(), 12);
		assert.equal(actual.getScrollPosition(), 32787);
		assert.equal(actual.getRectangleLargeSize(), 339);
		assert.equal(actual.getRectangleSmallSize(), 14);
		assert.equal(actual.isNeeded(), true);
		assert.equal(actual.getSliderSize(), 20);
		assert.equal(actual.getSliderPosition(), 230);


		assert.equal(actual.getDesiredScrollPositionFromOffset(240 + 12), 32811);
		actual.setScrollPosition(32811);
		assert.equal(actual.getArrowSize(), 12);
		assert.equal(actual.getScrollPosition(), 32811);
		assert.equal(actual.getRectangleLargeSize(), 339);
		assert.equal(actual.getRectangleSmallSize(), 14);
		assert.equal(actual.isNeeded(), true);
		assert.equal(actual.getSliderSize(), 20);
		assert.equal(actual.getSliderPosition(), 230);
	});
});
