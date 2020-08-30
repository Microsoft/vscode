/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as sinon from 'sinon';
import * as assert from 'assert';
import { memoize, createMemoizer, throttle } from 'vs/base/common/decorators';

suite('Decorators', () => {
	test('memoize should memoize methods', () => {
		class Foo {
			count = 0;

			constructor(private _answer: number | null | undefined) { }

			@memoize
			answer() {
				this.count++;
				return this._answer;
			}
		}

		const foo = new Foo(42);
		assert.equal(foo.count, 0);
		assert.equal(foo.answer(), 42);
		assert.equal(foo.count, 1);
		assert.equal(foo.answer(), 42);
		assert.equal(foo.count, 1);

		const foo2 = new Foo(1337);
		assert.equal(foo2.count, 0);
		assert.equal(foo2.answer(), 1337);
		assert.equal(foo2.count, 1);
		assert.equal(foo2.answer(), 1337);
		assert.equal(foo2.count, 1);

		assert.equal(foo.answer(), 42);
		assert.equal(foo.count, 1);

		const foo3 = new Foo(null);
		assert.equal(foo3.count, 0);
		assert.equal(foo3.answer(), null);
		assert.equal(foo3.count, 1);
		assert.equal(foo3.answer(), null);
		assert.equal(foo3.count, 1);

		const foo4 = new Foo(undefined);
		assert.equal(foo4.count, 0);
		assert.equal(foo4.answer(), undefined);
		assert.equal(foo4.count, 1);
		assert.equal(foo4.answer(), undefined);
		assert.equal(foo4.count, 1);
	});

	test('memoize should memoize getters', () => {
		class Foo {
			count = 0;

			constructor(private _answer: number | null | undefined) { }

			@memoize
			get answer() {
				this.count++;
				return this._answer;
			}
		}

		const foo = new Foo(42);
		assert.equal(foo.count, 0);
		assert.equal(foo.answer, 42);
		assert.equal(foo.count, 1);
		assert.equal(foo.answer, 42);
		assert.equal(foo.count, 1);

		const foo2 = new Foo(1337);
		assert.equal(foo2.count, 0);
		assert.equal(foo2.answer, 1337);
		assert.equal(foo2.count, 1);
		assert.equal(foo2.answer, 1337);
		assert.equal(foo2.count, 1);

		assert.equal(foo.answer, 42);
		assert.equal(foo.count, 1);

		const foo3 = new Foo(null);
		assert.equal(foo3.count, 0);
		assert.equal(foo3.answer, null);
		assert.equal(foo3.count, 1);
		assert.equal(foo3.answer, null);
		assert.equal(foo3.count, 1);

		const foo4 = new Foo(undefined);
		assert.equal(foo4.count, 0);
		assert.equal(foo4.answer, undefined);
		assert.equal(foo4.count, 1);
		assert.equal(foo4.answer, undefined);
		assert.equal(foo4.count, 1);
	});

	test('memoized property should not be enumerable', () => {
		class Foo {
			@memoize
			get answer() {
				return 42;
			}
		}

		const foo = new Foo();
		assert.equal(foo.answer, 42);

		assert(!Object.keys(foo).some(k => /\$memoize\$/.test(k)));
	});

	test('memoized property should not be writable', () => {
		class Foo {
			@memoize
			get answer() {
				return 42;
			}
		}

		const foo = new Foo();
		assert.equal(foo.answer, 42);

		try {
			(foo as any)['$memoize$answer'] = 1337;
			assert(false);
		} catch (e) {
			assert.equal(foo.answer, 42);
		}
	});

	test('memoize clear', () => {
		const memoizer = createMemoizer();
		let counter = 0;
		class Foo {
			@memoizer
			get answer() {
				return ++counter;
			}
		}

		const foo = new Foo();
		assert.equal(foo.answer, 1);
		assert.equal(foo.answer, 1);
		memoizer.clear();
		assert.equal(foo.answer, 2);
		assert.equal(foo.answer, 2);
		memoizer.clear();
		assert.equal(foo.answer, 3);
		assert.equal(foo.answer, 3);
		assert.equal(foo.answer, 3);
	});

	test('throttle', () => {
		const spy = sinon.spy();
		const clock = sinon.useFakeTimers();
		try {
			class ThrottleTest {
				private _handle: Function;

				constructor(fn: Function) {
					this._handle = fn;
				}

				@throttle(
					100,
					(a: number, b: number) => a + b,
					() => 0
				)
				report(p: number): void {
					this._handle(p);
				}
			}

			const t = new ThrottleTest(spy);

			t.report(1);
			t.report(2);
			t.report(3);
			assert.deepEqual(spy.args, [[1]]);

			clock.tick(200);
			assert.deepEqual(spy.args, [[1], [5]]);
			spy.reset();

			t.report(4);
			t.report(5);
			clock.tick(50);
			t.report(6);

			assert.deepEqual(spy.args, [[4]]);
			clock.tick(60);
			assert.deepEqual(spy.args, [[4], [11]]);
		} finally {
			clock.restore();
		}
	});
});
