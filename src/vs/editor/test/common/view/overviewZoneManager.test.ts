/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ColorZone, OverviewRulerZone, OverviewZoneManager } from 'vs/editor/common/view/overviewZoneManager';

suite('Editor View - OverviewZoneManager', () => {

	test('pixel ratio 1, dom height 600', () => {
		const LINE_COUNT = 50;
		const LINE_HEIGHT = 20;
		let manager = new OverviewZoneManager((lineNumber) => LINE_HEIGHT * lineNumber);
		manager.setDOMWidth(30);
		manager.setDOMHeight(600);
		manager.setOuterHeight(LINE_COUNT * LINE_HEIGHT);
		manager.setLineHeight(LINE_HEIGHT);
		manager.setPixelRatio(1);

		manager.setZones([
			new OverviewRulerZone(1, 1, '1'),
			new OverviewRulerZone(10, 10, '2'),
			new OverviewRulerZone(30, 31, '3'),
			new OverviewRulerZone(50, 50, '4'),
		]);

		// one line = 12, but cap is at 6
		assert.deepEqual(manager.resolveColorZones(), [
			new ColorZone(12, 24, 1), //
			new ColorZone(120, 132, 2), // 120 -> 132
			new ColorZone(360, 384, 3), // 360 -> 372 [360 -> 384]
			new ColorZone(588, 600, 4), // 588 -> 600
		]);
	});

	test('pixel ratio 1, dom height 300', () => {
		const LINE_COUNT = 50;
		const LINE_HEIGHT = 20;
		let manager = new OverviewZoneManager((lineNumber) => LINE_HEIGHT * lineNumber);
		manager.setDOMWidth(30);
		manager.setDOMHeight(300);
		manager.setOuterHeight(LINE_COUNT * LINE_HEIGHT);
		manager.setLineHeight(LINE_HEIGHT);
		manager.setPixelRatio(1);

		manager.setZones([
			new OverviewRulerZone(1, 1, '1'),
			new OverviewRulerZone(10, 10, '2'),
			new OverviewRulerZone(30, 31, '3'),
			new OverviewRulerZone(50, 50, '4'),
		]);

		// one line = 6, cap is at 6
		assert.deepEqual(manager.resolveColorZones(), [
			new ColorZone(6, 12, 1), //
			new ColorZone(60, 66, 2), // 60 -> 66
			new ColorZone(180, 192, 3), // 180 -> 192
			new ColorZone(294, 300, 4), // 294 -> 300
		]);
	});

	test('pixel ratio 2, dom height 300', () => {
		const LINE_COUNT = 50;
		const LINE_HEIGHT = 20;
		let manager = new OverviewZoneManager((lineNumber) => LINE_HEIGHT * lineNumber);
		manager.setDOMWidth(30);
		manager.setDOMHeight(300);
		manager.setOuterHeight(LINE_COUNT * LINE_HEIGHT);
		manager.setLineHeight(LINE_HEIGHT);
		manager.setPixelRatio(2);

		manager.setZones([
			new OverviewRulerZone(1, 1, '1'),
			new OverviewRulerZone(10, 10, '2'),
			new OverviewRulerZone(30, 31, '3'),
			new OverviewRulerZone(50, 50, '4'),
		]);

		// one line = 6, cap is at 12
		assert.deepEqual(manager.resolveColorZones(), [
			new ColorZone(12, 24, 1), //
			new ColorZone(120, 132, 2), // 120 -> 132
			new ColorZone(360, 384, 3), // 360 -> 384
			new ColorZone(588, 600, 4), // 588 -> 600
		]);
	});
});
