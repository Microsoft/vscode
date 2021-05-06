/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { IMarker, MarkerSeverity, IRelatedInformation } from 'vs/platform/markers/common/markers';
import { MarkersModel, Marker, ResourceMarkers, RelatedInformation } from 'vs/workbench/contrib/markers/browser/markersModel';
import { groupBy } from 'vs/base/common/collections';

class TestMarkersModel extends MarkersModel {

	constructor(markers: IMarker[]) {
		super();

		const byResource = groupBy(markers, r => r.resource.toString());

		Object.keys(byResource).forEach(key => {
			const markers = byResource[key];
			const resource = markers[0].resource;

			this.setResourceMarkers([[resource, markers]]);
		});
	}
}

suite('MarkersModel Test', () => {

	test('marker ids are unique', function () {
		const marker1 = anErrorWithRange(3);
		const marker2 = anErrorWithRange(3);
		const marker3 = aWarningWithRange(3);
		const marker4 = aWarningWithRange(3);

		const testObject = new TestMarkersModel([marker1, marker2, marker3, marker4]);
		const actuals = testObject.resourceMarkers[0].markers;

		assert.notStrictEqual(actuals[0].id, actuals[1].id);
		assert.notStrictEqual(actuals[0].id, actuals[2].id);
		assert.notStrictEqual(actuals[0].id, actuals[3].id);
		assert.notStrictEqual(actuals[1].id, actuals[2].id);
		assert.notStrictEqual(actuals[1].id, actuals[3].id);
		assert.notStrictEqual(actuals[2].id, actuals[3].id);
	});

	test('sort palces resources with no errors at the end', function () {
		const marker1 = aMarker('a/res1', MarkerSeverity.Warning);
		const marker2 = aMarker('a/res2');
		const marker3 = aMarker('res4');
		const marker4 = aMarker('b/res3');
		const marker5 = aMarker('res4');
		const marker6 = aMarker('c/res2', MarkerSeverity.Info);
		const testObject = new TestMarkersModel([marker1, marker2, marker3, marker4, marker5, marker6]);

		const actuals = testObject.resourceMarkers;

		assert.strictEqual(5, actuals.length);
		assert.ok(compareResource(actuals[0], 'a/res2'));
		assert.ok(compareResource(actuals[1], 'b/res3'));
		assert.ok(compareResource(actuals[2], 'res4'));
		assert.ok(compareResource(actuals[3], 'a/res1'));
		assert.ok(compareResource(actuals[4], 'c/res2'));
	});

	test('sort resources by file path', function () {
		const marker1 = aMarker('a/res1');
		const marker2 = aMarker('a/res2');
		const marker3 = aMarker('res4');
		const marker4 = aMarker('b/res3');
		const marker5 = aMarker('res4');
		const marker6 = aMarker('c/res2');
		const testObject = new TestMarkersModel([marker1, marker2, marker3, marker4, marker5, marker6]);

		const actuals = testObject.resourceMarkers;

		assert.strictEqual(5, actuals.length);
		assert.ok(compareResource(actuals[0], 'a/res1'));
		assert.ok(compareResource(actuals[1], 'a/res2'));
		assert.ok(compareResource(actuals[2], 'b/res3'));
		assert.ok(compareResource(actuals[3], 'c/res2'));
		assert.ok(compareResource(actuals[4], 'res4'));
	});

	test('sort markers by severity, line and column', function () {
		const marker1 = aWarningWithRange(8, 1, 9, 3);
		const marker2 = aWarningWithRange(3);
		const marker3 = anErrorWithRange(8, 1, 9, 3);
		const marker4 = anIgnoreWithRange(5);
		const marker5 = anInfoWithRange(8, 1, 8, 4, 'ab');
		const marker6 = anErrorWithRange(3);
		const marker7 = anErrorWithRange(5);
		const marker8 = anInfoWithRange(5);
		const marker9 = anErrorWithRange(8, 1, 8, 4, 'ab');
		const marker10 = anErrorWithRange(10);
		const marker11 = anErrorWithRange(8, 1, 8, 4, 'ba');
		const marker12 = anIgnoreWithRange(3);
		const marker13 = aWarningWithRange(5);
		const marker14 = anErrorWithRange(4);
		const marker15 = anErrorWithRange(8, 2, 8, 4);
		const testObject = new TestMarkersModel([marker1, marker2, marker3, marker4, marker5, marker6, marker7, marker8, marker9, marker10, marker11, marker12, marker13, marker14, marker15]);

		const actuals = testObject.resourceMarkers[0].markers;

		assert.strictEqual(actuals[0].marker, marker6);
		assert.strictEqual(actuals[1].marker, marker14);
		assert.strictEqual(actuals[2].marker, marker7);
		assert.strictEqual(actuals[3].marker, marker9);
		assert.strictEqual(actuals[4].marker, marker11);
		assert.strictEqual(actuals[5].marker, marker3);
		assert.strictEqual(actuals[6].marker, marker15);
		assert.strictEqual(actuals[7].marker, marker10);
		assert.strictEqual(actuals[8].marker, marker2);
		assert.strictEqual(actuals[9].marker, marker13);
		assert.strictEqual(actuals[10].marker, marker1);
		assert.strictEqual(actuals[11].marker, marker8);
		assert.strictEqual(actuals[12].marker, marker5);
		assert.strictEqual(actuals[13].marker, marker12);
		assert.strictEqual(actuals[14].marker, marker4);
	});

	test('toString()', () => {
		let marker = aMarker('a/res1');
		marker.code = '1234';
		assert.strictEqual(JSON.stringify({ ...marker, resource: marker.resource.path }, null, '\t'), new Marker('1', marker).toString());

		marker = aMarker('a/res2', MarkerSeverity.Warning);
		assert.strictEqual(JSON.stringify({ ...marker, resource: marker.resource.path }, null, '\t'), new Marker('2', marker).toString());

		marker = aMarker('a/res2', MarkerSeverity.Info, 1, 2, 1, 8, 'Info', '');
		assert.strictEqual(JSON.stringify({ ...marker, resource: marker.resource.path }, null, '\t'), new Marker('3', marker).toString());

		marker = aMarker('a/res2', MarkerSeverity.Hint, 1, 2, 1, 8, 'Ignore message', 'Ignore');
		assert.strictEqual(JSON.stringify({ ...marker, resource: marker.resource.path }, null, '\t'), new Marker('4', marker).toString());

		marker = aMarker('a/res2', MarkerSeverity.Warning, 1, 2, 1, 8, 'Warning message', '', [{ startLineNumber: 2, startColumn: 5, endLineNumber: 2, endColumn: 10, message: 'some info', resource: URI.file('a/res3') }]);
		const testObject = new Marker('5', marker, null!);

		// hack
		(testObject as any).relatedInformation = marker.relatedInformation!.map(r => new RelatedInformation('6', marker, r));
		assert.strictEqual(JSON.stringify({ ...marker, resource: marker.resource.path, relatedInformation: marker.relatedInformation!.map(r => ({ ...r, resource: r.resource.path })) }, null, '\t'), testObject.toString());
	});

	test('Markers for same-document but different fragment', function () {
		const model = new TestMarkersModel([anErrorWithRange(1)]);

		assert.strictEqual(model.total, 1);

		const document = URI.parse('foo://test/path/file');
		const frag1 = URI.parse('foo://test/path/file#1');
		const frag2 = URI.parse('foo://test/path/file#two');

		model.setResourceMarkers([[document, [{ ...aMarker(), resource: frag1 }, { ...aMarker(), resource: frag2 }]]]);

		assert.strictEqual(model.total, 3);
		let a = model.getResourceMarkers(document);
		let b = model.getResourceMarkers(frag1);
		let c = model.getResourceMarkers(frag2);
		assert.ok(a === b);
		assert.ok(a === c);

		model.setResourceMarkers([[document, [{ ...aMarker(), resource: frag2 }]]]);
		assert.strictEqual(model.total, 2);
	});

	test('Problems are no sorted correctly #99135', function () {
		const model = new TestMarkersModel([]);
		assert.strictEqual(model.total, 0);

		const document = URI.parse('foo://test/path/file');
		const frag1 = URI.parse('foo://test/path/file#1');
		const frag2 = URI.parse('foo://test/path/file#2');

		model.setResourceMarkers([[frag1, [
			{ ...aMarker(), resource: frag1 },
			{ ...aMarker(undefined, MarkerSeverity.Warning), resource: frag1 },
		]]]);

		model.setResourceMarkers([[frag2, [
			{ ...aMarker(), resource: frag2 }
		]]]);

		assert.strictEqual(model.total, 3);
		const markers = model.getResourceMarkers(document)?.markers;
		assert.deepStrictEqual(markers?.map(m => m.marker.severity), [MarkerSeverity.Error, MarkerSeverity.Error, MarkerSeverity.Warning]);
		assert.deepStrictEqual(markers?.map(m => m.marker.resource.toString()), [frag1.toString(), frag2.toString(), frag1.toString()]);
	});

	function compareResource(a: ResourceMarkers, b: string): boolean {
		return a.resource.toString() === URI.file(b).toString();
	}

	function anErrorWithRange(startLineNumber: number = 10,
		startColumn: number = 5,
		endLineNumber: number = startLineNumber + 1,
		endColumn: number = startColumn + 5,
		message: string = 'some message',
	): IMarker {
		return aMarker('some resource', MarkerSeverity.Error, startLineNumber, startColumn, endLineNumber, endColumn, message);
	}

	function aWarningWithRange(startLineNumber: number = 10,
		startColumn: number = 5,
		endLineNumber: number = startLineNumber + 1,
		endColumn: number = startColumn + 5,
		message: string = 'some message',
	): IMarker {
		return aMarker('some resource', MarkerSeverity.Warning, startLineNumber, startColumn, endLineNumber, endColumn, message);
	}

	function anInfoWithRange(startLineNumber: number = 10,
		startColumn: number = 5,
		endLineNumber: number = startLineNumber + 1,
		endColumn: number = startColumn + 5,
		message: string = 'some message',
	): IMarker {
		return aMarker('some resource', MarkerSeverity.Info, startLineNumber, startColumn, endLineNumber, endColumn, message);
	}

	function anIgnoreWithRange(startLineNumber: number = 10,
		startColumn: number = 5,
		endLineNumber: number = startLineNumber + 1,
		endColumn: number = startColumn + 5,
		message: string = 'some message',
	): IMarker {
		return aMarker('some resource', MarkerSeverity.Hint, startLineNumber, startColumn, endLineNumber, endColumn, message);
	}

	function aMarker(resource: string = 'some resource',
		severity: MarkerSeverity = MarkerSeverity.Error,
		startLineNumber: number = 10,
		startColumn: number = 5,
		endLineNumber: number = startLineNumber + 1,
		endColumn: number = startColumn + 5,
		message: string = 'some message',
		source: string = 'tslint',
		relatedInformation?: IRelatedInformation[]
	): IMarker {
		return {
			owner: 'someOwner',
			resource: URI.file(resource),
			severity,
			message,
			startLineNumber,
			startColumn,
			endLineNumber,
			endColumn,
			source,
			relatedInformation
		};
	}
});
