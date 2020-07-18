/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { IDisposable, dispose, ReferenceCollection } from 'vs/base/common/lifecycle';

class Disposable implements IDisposable {
	isDisposed = false;
	dispose() { this.isDisposed = true; }
}

suite('Lifecycle', () => {

	test('dispose single disposable', () => {
		const disposable = new Disposable();

		assert(!disposable.isDisposed);

		dispose(disposable);

		assert(disposable.isDisposed);
	});

	test('dispose disposable array', () => {
		const disposable = new Disposable();
		const disposable2 = new Disposable();

		assert(!disposable.isDisposed);
		assert(!disposable2.isDisposed);

		dispose([disposable, disposable2]);

		assert(disposable.isDisposed);
		assert(disposable2.isDisposed);
	});

	test('dispose disposables', () => {
		const disposable = new Disposable();
		const disposable2 = new Disposable();

		assert(!disposable.isDisposed);
		assert(!disposable2.isDisposed);

		dispose(disposable);
		dispose(disposable2);

		assert(disposable.isDisposed);
		assert(disposable2.isDisposed);
	});

	test('Action bar has broken accessibility #100273', function () {
		let array = [{ dispose() { } }, { dispose() { } }];
		let array2 = dispose(array);

		assert.equal(array.length, 2);
		assert.equal(array2.length, 0);
		assert.ok(array !== array2);

		let set = new Set<IDisposable>([{ dispose() { } }, { dispose() { } }]);
		let setValues = set.values();
		let setValues2 = dispose(setValues);
		assert.ok(setValues === setValues2);

	});
});

suite('Reference Collection', () => {
	class Collection extends ReferenceCollection<number> {
		private _count = 0;
		get count() { return this._count; }
		protected createReferencedObject(key: string): number { this._count++; return key.length; }
		protected destroyReferencedObject(key: string, object: number): void { this._count--; }
	}

	test('simple', () => {
		const collection = new Collection();

		const ref1 = collection.acquire('test');
		assert(ref1);
		assert.equal(ref1.object, 4);
		assert.equal(collection.count, 1);
		ref1.dispose();
		assert.equal(collection.count, 0);

		const ref2 = collection.acquire('test');
		const ref3 = collection.acquire('test');
		assert.equal(ref2.object, ref3.object);
		assert.equal(collection.count, 1);

		const ref4 = collection.acquire('monkey');
		assert.equal(ref4.object, 6);
		assert.equal(collection.count, 2);

		ref2.dispose();
		assert.equal(collection.count, 2);

		ref3.dispose();
		assert.equal(collection.count, 1);

		ref4.dispose();
		assert.equal(collection.count, 0);
	});
});
