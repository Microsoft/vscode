/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import * as markerService from 'vs/platform/markers/common/markerService';
import { IMarkerData, MarkerSeverity } from 'vs/platform/markers/common/markers';

function randomMarkerData(severity = MarkerSeverity.Error): IMarkerData {
	return {
		severity,
		message: Math.random().toString(16),
		startLineNumber: 1,
		startColumn: 1,
		endLineNumber: 1,
		endColumn: 1
	};
}

suite('Marker Service', () => {

	test('query', () => {

		let service = new markerService.MarkerService();

		service.changeAll('far', [{
			resource: URI.parse('file:///c/test/file.cs'),
			marker: randomMarkerData(MarkerSeverity.Error)
		}]);

		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
		assert.strictEqual(service.read({ resource: URI.parse('file:///c/test/file.cs') }).length, 1);
		assert.strictEqual(service.read({ owner: 'far', resource: URI.parse('file:///c/test/file.cs') }).length, 1);


		service.changeAll('boo', [{
			resource: URI.parse('file:///c/test/file.cs'),
			marker: randomMarkerData(MarkerSeverity.Warning)
		}]);

		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);

		assert.strictEqual(service.read({ severities: MarkerSeverity.Error }).length, 1);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Warning }).length, 1);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Hint }).length, 0);
		assert.strictEqual(service.read({ severities: MarkerSeverity.Error | MarkerSeverity.Warning }).length, 2);

	});


	test('changeOne override', () => {

		let service = new markerService.MarkerService();
		service.changeOne('far', URI.parse('file:///path/only.cs'), [randomMarkerData()]);
		assert.strictEqual(service.read().length, 1);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);

		service.changeOne('boo', URI.parse('file:///path/only.cs'), [randomMarkerData()]);
		assert.strictEqual(service.read().length, 2);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);

		service.changeOne('far', URI.parse('file:///path/only.cs'), [randomMarkerData(), randomMarkerData()]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 2);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);

	});

	test('changeOne/All clears', () => {

		let service = new markerService.MarkerService();
		service.changeOne('far', URI.parse('file:///path/only.cs'), [randomMarkerData()]);
		service.changeOne('boo', URI.parse('file:///path/only.cs'), [randomMarkerData()]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);
		assert.strictEqual(service.read().length, 2);

		service.changeOne('far', URI.parse('file:///path/only.cs'), []);
		assert.strictEqual(service.read({ owner: 'far' }).length, 0);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 1);
		assert.strictEqual(service.read().length, 1);

		service.changeAll('boo', []);
		assert.strictEqual(service.read({ owner: 'far' }).length, 0);
		assert.strictEqual(service.read({ owner: 'boo' }).length, 0);
		assert.strictEqual(service.read().length, 0);
	});

	test('changeAll sends event for cleared', () => {

		let service = new markerService.MarkerService();
		service.changeAll('far', [{
			resource: URI.parse('file:///d/path'),
			marker: randomMarkerData()
		}, {
			resource: URI.parse('file:///d/path'),
			marker: randomMarkerData()
		}]);

		assert.strictEqual(service.read({ owner: 'far' }).length, 2);

		service.onMarkerChanged(changedResources => {
			assert.strictEqual(changedResources.length, 1);
			changedResources.forEach(u => assert.strictEqual(u.toString(), 'file:///d/path'));
			assert.strictEqual(service.read({ owner: 'far' }).length, 0);
		});

		service.changeAll('far', []);
	});

	test('changeAll merges', () => {
		let service = new markerService.MarkerService();

		service.changeAll('far', [{
			resource: URI.parse('file:///c/test/file.cs'),
			marker: randomMarkerData()
		}, {
			resource: URI.parse('file:///c/test/file.cs'),
			marker: randomMarkerData()
		}]);

		assert.strictEqual(service.read({ owner: 'far' }).length, 2);
	});

	test('changeAll must not break integrety, issue #12635', () => {
		let service = new markerService.MarkerService();

		service.changeAll('far', [{
			resource: URI.parse('scheme:path1'),
			marker: randomMarkerData()
		}, {
			resource: URI.parse('scheme:path2'),
			marker: randomMarkerData()
		}]);

		service.changeAll('boo', [{
			resource: URI.parse('scheme:path1'),
			marker: randomMarkerData()
		}]);

		service.changeAll('far', [{
			resource: URI.parse('scheme:path1'),
			marker: randomMarkerData()
		}, {
			resource: URI.parse('scheme:path2'),
			marker: randomMarkerData()
		}]);

		assert.strictEqual(service.read({ owner: 'far' }).length, 2);
		assert.strictEqual(service.read({ resource: URI.parse('scheme:path1') }).length, 2);
	});

	test('invalid marker data', () => {

		let data = randomMarkerData();
		let service = new markerService.MarkerService();

		data.message = undefined!;
		service.changeOne('far', URI.parse('some:uri/path'), [data]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 0);

		data.message = null!;
		service.changeOne('far', URI.parse('some:uri/path'), [data]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 0);

		data.message = 'null';
		service.changeOne('far', URI.parse('some:uri/path'), [data]);
		assert.strictEqual(service.read({ owner: 'far' }).length, 1);
	});

	test('MapMap#remove returns bad values, https://github.com/microsoft/vscode/issues/13548', () => {
		let service = new markerService.MarkerService();

		service.changeOne('o', URI.parse('some:uri/1'), [randomMarkerData()]);
		service.changeOne('o', URI.parse('some:uri/2'), []);

	});

	test('Error code of zero in markers get removed, #31275', function () {
		let data = <IMarkerData>{
			code: '0',
			startLineNumber: 1,
			startColumn: 2,
			endLineNumber: 1,
			endColumn: 5,
			message: 'test',
			severity: 0 as MarkerSeverity,
			source: 'me'
		};
		let service = new markerService.MarkerService();

		service.changeOne('far', URI.parse('some:thing'), [data]);
		let marker = service.read({ resource: URI.parse('some:thing') });

		assert.strictEqual(marker.length, 1);
		assert.strictEqual(marker[0].code, '0');
	});
});
