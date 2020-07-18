/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { isMacintosh, isLinux, isWindows } from 'vs/base/common/platform';

function createContext(ctx: any) {
	return {
		getValue: (key: string) => {
			return ctx[key];
		}
	};
}

suite('ContextKeyExpr', () => {
	test('ContextKeyExpr.equals', () => {
		let a = ContextKeyExpr.and(
			ContextKeyExpr.has('a1'),
			ContextKeyExpr.and(ContextKeyExpr.has('and.a')),
			ContextKeyExpr.has('a2'),
			ContextKeyExpr.regex('d3', /d.*/),
			ContextKeyExpr.regex('d4', /\*\*3*/),
			ContextKeyExpr.equals('b1', 'bb1'),
			ContextKeyExpr.equals('b2', 'bb2'),
			ContextKeyExpr.notEquals('c1', 'cc1'),
			ContextKeyExpr.notEquals('c2', 'cc2'),
			ContextKeyExpr.not('d1'),
			ContextKeyExpr.not('d2')
		)!;
		let b = ContextKeyExpr.and(
			ContextKeyExpr.equals('b2', 'bb2'),
			ContextKeyExpr.notEquals('c1', 'cc1'),
			ContextKeyExpr.not('d1'),
			ContextKeyExpr.regex('d4', /\*\*3*/),
			ContextKeyExpr.notEquals('c2', 'cc2'),
			ContextKeyExpr.has('a2'),
			ContextKeyExpr.equals('b1', 'bb1'),
			ContextKeyExpr.regex('d3', /d.*/),
			ContextKeyExpr.has('a1'),
			ContextKeyExpr.and(ContextKeyExpr.equals('and.a', true)),
			ContextKeyExpr.not('d2')
		)!;
		assert(a.equals(b), 'expressions should be equal');
	});

	test('normalize', () => {
		let key1IsTrue = ContextKeyExpr.equals('key1', true);
		let key1IsNotFalse = ContextKeyExpr.notEquals('key1', false);
		let key1IsFalse = ContextKeyExpr.equals('key1', false);
		let key1IsNotTrue = ContextKeyExpr.notEquals('key1', true);

		assert.ok(key1IsTrue.equals(ContextKeyExpr.has('key1')));
		assert.ok(key1IsNotFalse.equals(ContextKeyExpr.has('key1')));
		assert.ok(key1IsFalse.equals(ContextKeyExpr.not('key1')));
		assert.ok(key1IsNotTrue.equals(ContextKeyExpr.not('key1')));
	});

	test('evaluate', () => {
		let context = createContext({
			'a': true,
			'b': false,
			'c': '5',
			'd': 'd'
		});
		function testExpression(expr: string, expected: boolean): void {
			// console.log(expr + ' ' + expected);
			let rules = ContextKeyExpr.deserialize(expr);
			assert.equal(rules!.evaluate(context), expected, expr);
		}
		function testBatch(expr: string, value: any): void {
			/* eslint-disable eqeqeq */
			testExpression(expr, !!value);
			testExpression(expr + ' == true', !!value);
			testExpression(expr + ' != true', !value);
			testExpression(expr + ' == false', !value);
			testExpression(expr + ' != false', !!value);
			testExpression(expr + ' == 5', value == <any>'5');
			testExpression(expr + ' != 5', value != <any>'5');
			testExpression('!' + expr, !value);
			testExpression(expr + ' =~ /d.*/', /d.*/.test(value));
			testExpression(expr + ' =~ /D/i', /D/i.test(value));
			/* eslint-enable eqeqeq */
		}

		testBatch('a', true);
		testBatch('b', false);
		testBatch('c', '5');
		testBatch('d', 'd');
		testBatch('z', undefined);

		testExpression('true', true);
		testExpression('false', false);
		testExpression('a && !b', true && !false);
		testExpression('a && b', true && false);
		testExpression('a && !b && c == 5', true && !false && '5' === '5');
		testExpression('d =~ /e.*/', false);

		// precedence test: false && true || true === true because && is evaluated first
		testExpression('b && a || a', true);

		testExpression('a || b', true);
		testExpression('b || b', false);
		testExpression('b && a || a && b', false);
	});

	test('negate', () => {
		function testNegate(expr: string, expected: string): void {
			const actual = ContextKeyExpr.deserialize(expr)!.negate().serialize();
			assert.strictEqual(actual, expected);
		}
		testNegate('true', 'false');
		testNegate('false', 'true');
		testNegate('a', '!a');
		testNegate('a && b || c', '!a && !c || !b && !c');
		testNegate('a && b || c || d', '!a && !c && !d || !b && !c && !d');
		testNegate('!a && !b || !c && !d', 'a && c || a && d || b && c || b && d');
		testNegate('!a && !b || !c && !d || !e && !f', 'a && c && e || a && c && f || a && d && e || a && d && f || b && c && e || b && c && f || b && d && e || b && d && f');
	});

	test('false, true', () => {
		function testNormalize(expr: string, expected: string): void {
			const actual = ContextKeyExpr.deserialize(expr)!.serialize();
			assert.strictEqual(actual, expected);
		}
		testNormalize('true', 'true');
		testNormalize('!true', 'false');
		testNormalize('false', 'false');
		testNormalize('!false', 'true');
		testNormalize('a && true', 'a');
		testNormalize('a && false', 'false');
		testNormalize('a || true', 'true');
		testNormalize('a || false', 'a');
		testNormalize('isMac', isMacintosh ? 'true' : 'false');
		testNormalize('isLinux', isLinux ? 'true' : 'false');
		testNormalize('isWindows', isWindows ? 'true' : 'false');
	});

	test('issue #101015: distribute OR', () => {
		function t(expr1: string, expr2: string, expected: string | undefined): void {
			const e1 = ContextKeyExpr.deserialize(expr1);
			const e2 = ContextKeyExpr.deserialize(expr2);
			const actual = ContextKeyExpr.and(e1, e2)?.serialize();
			assert.strictEqual(actual, expected);
		}
		t('a', 'b', 'a && b');
		t('a || b', 'c', 'a && c || b && c');
		t('a || b', 'c || d', 'a && c || b && c || a && d || b && d');
		t('a || b', 'c && d', 'a && c && d || b && c && d');
		t('a || b', 'c && d || e', 'a && e || b && e || a && c && d || b && c && d');
	});
});
