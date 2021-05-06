/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { CancellationTokenSource, CancellationToken } from 'vs/base/common/cancellation';

suite('CancellationToken', function () {

	test('None', () => {
		assert.strictEqual(CancellationToken.None.isCancellationRequested, false);
		assert.strictEqual(typeof CancellationToken.None.onCancellationRequested, 'function');
	});

	test('cancel before token', function () {

		const source = new CancellationTokenSource();
		assert.strictEqual(source.token.isCancellationRequested, false);
		source.cancel();

		assert.strictEqual(source.token.isCancellationRequested, true);

		return new Promise<void>(resolve => {
			source.token.onCancellationRequested(() => resolve());
		});
	});

	test('cancel happens only once', function () {

		let source = new CancellationTokenSource();
		assert.strictEqual(source.token.isCancellationRequested, false);

		let cancelCount = 0;
		function onCancel() {
			cancelCount += 1;
		}

		source.token.onCancellationRequested(onCancel);

		source.cancel();
		source.cancel();

		assert.strictEqual(cancelCount, 1);
	});

	test('cancel calls all listeners', function () {

		let count = 0;

		let source = new CancellationTokenSource();
		source.token.onCancellationRequested(function () {
			count += 1;
		});
		source.token.onCancellationRequested(function () {
			count += 1;
		});
		source.token.onCancellationRequested(function () {
			count += 1;
		});

		source.cancel();
		assert.strictEqual(count, 3);
	});

	test('token stays the same', function () {

		let source = new CancellationTokenSource();
		let token = source.token;
		assert.ok(token === source.token); // doesn't change on get

		source.cancel();
		assert.ok(token === source.token); // doesn't change after cancel

		source.cancel();
		assert.ok(token === source.token); // doesn't change after 2nd cancel

		source = new CancellationTokenSource();
		source.cancel();
		token = source.token;
		assert.ok(token === source.token); // doesn't change on get
	});

	test('dispose calls no listeners', function () {

		let count = 0;

		let source = new CancellationTokenSource();
		source.token.onCancellationRequested(function () {
			count += 1;
		});

		source.dispose();
		source.cancel();
		assert.strictEqual(count, 0);
	});

	test('dispose calls no listeners (unless told to cancel)', function () {

		let count = 0;

		let source = new CancellationTokenSource();
		source.token.onCancellationRequested(function () {
			count += 1;
		});

		source.dispose(true);
		// source.cancel();
		assert.strictEqual(count, 1);
	});

	test('parent cancels child', function () {

		let parent = new CancellationTokenSource();
		let child = new CancellationTokenSource(parent.token);

		let count = 0;
		child.token.onCancellationRequested(() => count += 1);

		parent.cancel();

		assert.strictEqual(count, 1);
		assert.strictEqual(child.token.isCancellationRequested, true);
		assert.strictEqual(parent.token.isCancellationRequested, true);
	});
});
