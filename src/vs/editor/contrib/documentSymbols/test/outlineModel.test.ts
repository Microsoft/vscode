/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { OutlineElement, OutlineGroup, OutlineModel } from '../outlineModel';
import { SymbolKind, DocumentSymbol, DocumentSymbolProviderRegistry } from 'vs/editor/common/modes';
import { Range } from 'vs/editor/common/core/range';
import { IMarker, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { URI } from 'vs/base/common/uri';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';

suite('OutlineModel', function () {

	test('OutlineModel#create, cached', async function () {

		let model = createTextModel('foo', undefined, undefined, URI.file('/fome/path.foo'));
		let count = 0;
		let reg = DocumentSymbolProviderRegistry.register({ pattern: '**/path.foo' }, {
			provideDocumentSymbols() {
				count += 1;
				return [];
			}
		});

		await OutlineModel.create(model, CancellationToken.None);
		assert.strictEqual(count, 1);

		// cached
		await OutlineModel.create(model, CancellationToken.None);
		assert.strictEqual(count, 1);

		// new version
		model.applyEdits([{ text: 'XXX', range: new Range(1, 1, 1, 1) }]);
		await OutlineModel.create(model, CancellationToken.None);
		assert.strictEqual(count, 2);

		reg.dispose();
	});

	test('OutlineModel#create, cached/cancel', async function () {

		let model = createTextModel('foo', undefined, undefined, URI.file('/fome/path.foo'));
		let isCancelled = false;

		let reg = DocumentSymbolProviderRegistry.register({ pattern: '**/path.foo' }, {
			provideDocumentSymbols(d, token) {
				return new Promise(resolve => {
					token.onCancellationRequested(_ => {
						isCancelled = true;
						resolve(null);
					});
				});
			}
		});

		assert.strictEqual(isCancelled, false);
		let s1 = new CancellationTokenSource();
		OutlineModel.create(model, s1.token);
		let s2 = new CancellationTokenSource();
		OutlineModel.create(model, s2.token);

		s1.cancel();
		assert.strictEqual(isCancelled, false);

		s2.cancel();
		assert.strictEqual(isCancelled, true);

		reg.dispose();
	});

	function fakeSymbolInformation(range: Range, name: string = 'foo'): DocumentSymbol {
		return {
			name,
			detail: 'fake',
			kind: SymbolKind.Boolean,
			tags: [],
			selectionRange: range,
			range: range
		};
	}

	function fakeMarker(range: Range): IMarker {
		return { ...range, owner: 'ffff', message: 'test', severity: MarkerSeverity.Error, resource: null! };
	}

	test('OutlineElement - updateMarker', function () {

		let e0 = new OutlineElement('foo1', null!, fakeSymbolInformation(new Range(1, 1, 1, 10)));
		let e1 = new OutlineElement('foo2', null!, fakeSymbolInformation(new Range(2, 1, 5, 1)));
		let e2 = new OutlineElement('foo3', null!, fakeSymbolInformation(new Range(6, 1, 10, 10)));

		let group = new OutlineGroup('group', null!, null!, 1);
		group.children.set(e0.id, e0);
		group.children.set(e1.id, e1);
		group.children.set(e2.id, e2);

		const data = [fakeMarker(new Range(6, 1, 6, 7)), fakeMarker(new Range(1, 1, 1, 4)), fakeMarker(new Range(10, 2, 14, 1))];
		data.sort(Range.compareRangesUsingStarts); // model does this

		group.updateMarker(data);
		assert.strictEqual(data.length, 0); // all 'stolen'
		assert.strictEqual(e0.marker!.count, 1);
		assert.strictEqual(e1.marker, undefined);
		assert.strictEqual(e2.marker!.count, 2);

		group.updateMarker([]);
		assert.strictEqual(e0.marker, undefined);
		assert.strictEqual(e1.marker, undefined);
		assert.strictEqual(e2.marker, undefined);
	});

	test('OutlineElement - updateMarker, 2', function () {

		let p = new OutlineElement('A', null!, fakeSymbolInformation(new Range(1, 1, 11, 1)));
		let c1 = new OutlineElement('A/B', null!, fakeSymbolInformation(new Range(2, 4, 5, 4)));
		let c2 = new OutlineElement('A/C', null!, fakeSymbolInformation(new Range(6, 4, 9, 4)));

		let group = new OutlineGroup('group', null!, null!, 1);
		group.children.set(p.id, p);
		p.children.set(c1.id, c1);
		p.children.set(c2.id, c2);

		let data = [
			fakeMarker(new Range(2, 4, 5, 4))
		];

		group.updateMarker(data);
		assert.strictEqual(p.marker!.count, 0);
		assert.strictEqual(c1.marker!.count, 1);
		assert.strictEqual(c2.marker, undefined);

		data = [
			fakeMarker(new Range(2, 4, 5, 4)),
			fakeMarker(new Range(2, 6, 2, 8)),
			fakeMarker(new Range(7, 6, 7, 8)),
		];
		group.updateMarker(data);
		assert.strictEqual(p.marker!.count, 0);
		assert.strictEqual(c1.marker!.count, 2);
		assert.strictEqual(c2.marker!.count, 1);

		data = [
			fakeMarker(new Range(1, 4, 1, 11)),
			fakeMarker(new Range(7, 6, 7, 8)),
		];
		group.updateMarker(data);
		assert.strictEqual(p.marker!.count, 1);
		assert.strictEqual(c1.marker, undefined);
		assert.strictEqual(c2.marker!.count, 1);
	});

	test('OutlineElement - updateMarker/multiple groups', function () {

		let model = new class extends OutlineModel {
			constructor() {
				super(null!);
			}
			readyForTesting() {
				this._groups = this.children as any;
			}
		};
		model.children.set('g1', new OutlineGroup('g1', model, null!, 1));
		model.children.get('g1')!.children.set('c1', new OutlineElement('c1', model.children.get('g1')!, fakeSymbolInformation(new Range(1, 1, 11, 1))));

		model.children.set('g2', new OutlineGroup('g2', model, null!, 1));
		model.children.get('g2')!.children.set('c2', new OutlineElement('c2', model.children.get('g2')!, fakeSymbolInformation(new Range(1, 1, 7, 1))));
		model.children.get('g2')!.children.get('c2')!.children.set('c2.1', new OutlineElement('c2.1', model.children.get('g2')!.children.get('c2')!, fakeSymbolInformation(new Range(1, 3, 2, 19))));
		model.children.get('g2')!.children.get('c2')!.children.set('c2.2', new OutlineElement('c2.2', model.children.get('g2')!.children.get('c2')!, fakeSymbolInformation(new Range(4, 1, 6, 10))));

		model.readyForTesting();

		const data = [
			fakeMarker(new Range(1, 1, 2, 8)),
			fakeMarker(new Range(6, 1, 6, 98)),
		];

		model.updateMarker(data);

		assert.strictEqual(model.children.get('g1')!.children.get('c1')!.marker!.count, 2);
		assert.strictEqual(model.children.get('g2')!.children.get('c2')!.children.get('c2.1')!.marker!.count, 1);
		assert.strictEqual(model.children.get('g2')!.children.get('c2')!.children.get('c2.2')!.marker!.count, 1);
	});

});
