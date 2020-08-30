/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { DisposableStore, dispose, IDisposable, MultiDisposeError, ReferenceCollection, toDisposable } from 'vs/base/common/lifecycle';

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

	test('dispose array should dispose all if a child throws on dispose', () => {
		const disposedValues = new Set<number>();

		let thrownError: any;
		try {
			dispose([
				toDisposable(() => { disposedValues.add(1); }),
				toDisposable(() => { throw new Error('I am error'); }),
				toDisposable(() => { disposedValues.add(3); }),
			]);
		} catch (e) {
			thrownError = e;
		}

		assert.ok(disposedValues.has(1));
		assert.ok(disposedValues.has(3));
		assert.strictEqual(thrownError.message, 'I am error');
	});

	test('dispose array should rethrow composite error if multiple entries throw on dispose', () => {
		const disposedValues = new Set<number>();

		let thrownError: any;
		try {
			dispose([
				toDisposable(() => { disposedValues.add(1); }),
				toDisposable(() => { throw new Error('I am error 1'); }),
				toDisposable(() => { throw new Error('I am error 2'); }),
				toDisposable(() => { disposedValues.add(4); }),
			]);
		} catch (e) {
			thrownError = e;
		}

		assert.ok(disposedValues.has(1));
		assert.ok(disposedValues.has(4));
		assert.ok(thrownError instanceof MultiDisposeError);
		assert.strictEqual((thrownError as MultiDisposeError).errors.length, 2);
		assert.strictEqual((thrownError as MultiDisposeError).errors[0].message, 'I am error 1');
		assert.strictEqual((thrownError as MultiDisposeError).errors[1].message, 'I am error 2');
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

suite('DisposableStore', () => {
	test('dispose should call all child disposes even if a child throws on dispose', () => {
		const disposedValues = new Set<number>();

		const store = new DisposableStore();
		store.add(toDisposable(() => { disposedValues.add(1); }));
		store.add(toDisposable(() => { throw new Error('I am error'); }));
		store.add(toDisposable(() => { disposedValues.add(3); }));

		let thrownError: any;
		try {
			store.dispose();
		} catch (e) {
			thrownError = e;
		}

		assert.ok(disposedValues.has(1));
		assert.ok(disposedValues.has(3));
		assert.strictEqual(thrownError.message, 'I am error');
	});

	test('dispose should throw composite error if multiple children throw on dispose', () => {
		const disposedValues = new Set<number>();

		const store = new DisposableStore();
		store.add(toDisposable(() => { disposedValues.add(1); }));
		store.add(toDisposable(() => { throw new Error('I am error 1'); }));
		store.add(toDisposable(() => { throw new Error('I am error 2'); }));
		store.add(toDisposable(() => { disposedValues.add(4); }));

		let thrownError: any;
		try {
			store.dispose();
		} catch (e) {
			thrownError = e;
		}

		assert.ok(disposedValues.has(1));
		assert.ok(disposedValues.has(4));
		assert.ok(thrownError instanceof MultiDisposeError);
		assert.strictEqual((thrownError as MultiDisposeError).errors.length, 2);
		assert.strictEqual((thrownError as MultiDisposeError).errors[0].message, 'I am error 1');
		assert.strictEqual((thrownError as MultiDisposeError).errors[1].message, 'I am error 2');
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
