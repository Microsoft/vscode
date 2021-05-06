/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { isFalsyOrWhitespace } from 'vs/base/common/strings';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { userAgent, isMacintosh, isLinux, isWindows, isWeb } from 'vs/base/common/platform';

let _userAgent = userAgent || '';
const STATIC_VALUES = new Map<string, boolean>();
STATIC_VALUES.set('false', false);
STATIC_VALUES.set('true', true);
STATIC_VALUES.set('isMac', isMacintosh);
STATIC_VALUES.set('isLinux', isLinux);
STATIC_VALUES.set('isWindows', isWindows);
STATIC_VALUES.set('isWeb', isWeb);
STATIC_VALUES.set('isMacNative', isMacintosh && !isWeb);
STATIC_VALUES.set('isEdge', _userAgent.indexOf('Edg/') >= 0);
STATIC_VALUES.set('isFirefox', _userAgent.indexOf('Firefox') >= 0);
STATIC_VALUES.set('isChrome', _userAgent.indexOf('Chrome') >= 0);
STATIC_VALUES.set('isSafari', _userAgent.indexOf('Safari') >= 0);
STATIC_VALUES.set('isIPad', _userAgent.indexOf('iPad') >= 0);

const hasOwnProperty = Object.prototype.hasOwnProperty;

export const enum ContextKeyExprType {
	False = 0,
	True = 1,
	Defined = 2,
	Not = 3,
	Equals = 4,
	NotEquals = 5,
	And = 6,
	Regex = 7,
	NotRegex = 8,
	Or = 9,
	In = 10,
	NotIn = 11,
	Greater = 12,
	GreaterEquals = 13,
	Smaller = 14,
	SmallerEquals = 15,
}

export interface IContextKeyExprMapper {
	mapDefined(key: string): ContextKeyExpression;
	mapNot(key: string): ContextKeyExpression;
	mapEquals(key: string, value: any): ContextKeyExpression;
	mapNotEquals(key: string, value: any): ContextKeyExpression;
	mapGreater(key: string, value: any): ContextKeyExpression;
	mapGreaterEquals(key: string, value: any): ContextKeyExpression;
	mapSmaller(key: string, value: any): ContextKeyExpression;
	mapSmallerEquals(key: string, value: any): ContextKeyExpression;
	mapRegex(key: string, regexp: RegExp | null): ContextKeyRegexExpr;
	mapIn(key: string, valueKey: string): ContextKeyInExpr;
}

export interface IContextKeyExpression {
	cmp(other: ContextKeyExpression): number;
	equals(other: ContextKeyExpression): boolean;
	evaluate(context: IContext): boolean;
	serialize(): string;
	keys(): string[];
	map(mapFnc: IContextKeyExprMapper): ContextKeyExpression;
	negate(): ContextKeyExpression;

}

export type ContextKeyExpression = (
	ContextKeyFalseExpr | ContextKeyTrueExpr | ContextKeyDefinedExpr | ContextKeyNotExpr
	| ContextKeyEqualsExpr | ContextKeyNotEqualsExpr | ContextKeyRegexExpr
	| ContextKeyNotRegexExpr | ContextKeyAndExpr | ContextKeyOrExpr | ContextKeyInExpr
	| ContextKeyNotInExpr | ContextKeyGreaterExpr | ContextKeyGreaterEqualsExpr
	| ContextKeySmallerExpr | ContextKeySmallerEqualsExpr
);

export abstract class ContextKeyExpr {

	public static false(): ContextKeyExpression {
		return ContextKeyFalseExpr.INSTANCE;
	}

	public static true(): ContextKeyExpression {
		return ContextKeyTrueExpr.INSTANCE;
	}

	public static has(key: string): ContextKeyExpression {
		return ContextKeyDefinedExpr.create(key);
	}

	public static equals(key: string, value: any): ContextKeyExpression {
		return ContextKeyEqualsExpr.create(key, value);
	}

	public static notEquals(key: string, value: any): ContextKeyExpression {
		return ContextKeyNotEqualsExpr.create(key, value);
	}

	public static regex(key: string, value: RegExp): ContextKeyExpression {
		return ContextKeyRegexExpr.create(key, value);
	}

	public static in(key: string, value: string): ContextKeyExpression {
		return ContextKeyInExpr.create(key, value);
	}

	public static not(key: string): ContextKeyExpression {
		return ContextKeyNotExpr.create(key);
	}

	public static and(...expr: Array<ContextKeyExpression | undefined | null>): ContextKeyExpression | undefined {
		return ContextKeyAndExpr.create(expr);
	}

	public static or(...expr: Array<ContextKeyExpression | undefined | null>): ContextKeyExpression | undefined {
		return ContextKeyOrExpr.create(expr);
	}

	public static greater(key: string, value: any): ContextKeyExpression {
		return ContextKeyGreaterExpr.create(key, value);
	}

	public static less(key: string, value: any): ContextKeyExpression {
		return ContextKeySmallerExpr.create(key, value);
	}

	public static deserialize(serialized: string | null | undefined, strict: boolean = false): ContextKeyExpression | undefined {
		if (!serialized) {
			return undefined;
		}

		return this._deserializeOrExpression(serialized, strict);
	}

	private static _deserializeOrExpression(serialized: string, strict: boolean): ContextKeyExpression | undefined {
		let pieces = serialized.split('||');
		return ContextKeyOrExpr.create(pieces.map(p => this._deserializeAndExpression(p, strict)));
	}

	private static _deserializeAndExpression(serialized: string, strict: boolean): ContextKeyExpression | undefined {
		let pieces = serialized.split('&&');
		return ContextKeyAndExpr.create(pieces.map(p => this._deserializeOne(p, strict)));
	}

	private static _deserializeOne(serializedOne: string, strict: boolean): ContextKeyExpression {
		serializedOne = serializedOne.trim();

		if (serializedOne.indexOf('!=') >= 0) {
			let pieces = serializedOne.split('!=');
			return ContextKeyNotEqualsExpr.create(pieces[0].trim(), this._deserializeValue(pieces[1], strict));
		}

		if (serializedOne.indexOf('==') >= 0) {
			let pieces = serializedOne.split('==');
			return ContextKeyEqualsExpr.create(pieces[0].trim(), this._deserializeValue(pieces[1], strict));
		}

		if (serializedOne.indexOf('=~') >= 0) {
			let pieces = serializedOne.split('=~');
			return ContextKeyRegexExpr.create(pieces[0].trim(), this._deserializeRegexValue(pieces[1], strict));
		}

		if (serializedOne.indexOf(' in ') >= 0) {
			let pieces = serializedOne.split(' in ');
			return ContextKeyInExpr.create(pieces[0].trim(), pieces[1].trim());
		}

		if (/^[^<=>]+>=[^<=>]+$/.test(serializedOne)) {
			const pieces = serializedOne.split('>=');
			return ContextKeyGreaterEqualsExpr.create(pieces[0].trim(), pieces[1].trim());
		}

		if (/^[^<=>]+>[^<=>]+$/.test(serializedOne)) {
			const pieces = serializedOne.split('>');
			return ContextKeyGreaterExpr.create(pieces[0].trim(), pieces[1].trim());
		}

		if (/^[^<=>]+<=[^<=>]+$/.test(serializedOne)) {
			const pieces = serializedOne.split('<=');
			return ContextKeySmallerEqualsExpr.create(pieces[0].trim(), pieces[1].trim());
		}

		if (/^[^<=>]+<[^<=>]+$/.test(serializedOne)) {
			const pieces = serializedOne.split('<');
			return ContextKeySmallerExpr.create(pieces[0].trim(), pieces[1].trim());
		}

		if (/^\!\s*/.test(serializedOne)) {
			return ContextKeyNotExpr.create(serializedOne.substr(1).trim());
		}

		return ContextKeyDefinedExpr.create(serializedOne);
	}

	private static _deserializeValue(serializedValue: string, strict: boolean): any {
		serializedValue = serializedValue.trim();

		if (serializedValue === 'true') {
			return true;
		}

		if (serializedValue === 'false') {
			return false;
		}

		let m = /^'([^']*)'$/.exec(serializedValue);
		if (m) {
			return m[1].trim();
		}

		return serializedValue;
	}

	private static _deserializeRegexValue(serializedValue: string, strict: boolean): RegExp | null {

		if (isFalsyOrWhitespace(serializedValue)) {
			if (strict) {
				throw new Error('missing regexp-value for =~-expression');
			} else {
				console.warn('missing regexp-value for =~-expression');
			}
			return null;
		}

		let start = serializedValue.indexOf('/');
		let end = serializedValue.lastIndexOf('/');
		if (start === end || start < 0 /* || to < 0 */) {
			if (strict) {
				throw new Error(`bad regexp-value '${serializedValue}', missing /-enclosure`);
			} else {
				console.warn(`bad regexp-value '${serializedValue}', missing /-enclosure`);
			}
			return null;
		}

		let value = serializedValue.slice(start + 1, end);
		let caseIgnoreFlag = serializedValue[end + 1] === 'i' ? 'i' : '';
		try {
			return new RegExp(value, caseIgnoreFlag);
		} catch (e) {
			if (strict) {
				throw new Error(`bad regexp-value '${serializedValue}', parse error: ${e}`);
			} else {
				console.warn(`bad regexp-value '${serializedValue}', parse error: ${e}`);
			}
			return null;
		}
	}
}

function cmp(a: ContextKeyExpression, b: ContextKeyExpression): number {
	return a.cmp(b);
}

export class ContextKeyFalseExpr implements IContextKeyExpression {
	public static INSTANCE = new ContextKeyFalseExpr();

	public readonly type = ContextKeyExprType.False;

	protected constructor() {
	}

	public cmp(other: ContextKeyExpression): number {
		return this.type - other.type;
	}

	public equals(other: ContextKeyExpression): boolean {
		return (other.type === this.type);
	}

	public evaluate(context: IContext): boolean {
		return false;
	}

	public serialize(): string {
		return 'false';
	}

	public keys(): string[] {
		return [];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return this;
	}

	public negate(): ContextKeyExpression {
		return ContextKeyTrueExpr.INSTANCE;
	}
}

export class ContextKeyTrueExpr implements IContextKeyExpression {
	public static INSTANCE = new ContextKeyTrueExpr();

	public readonly type = ContextKeyExprType.True;

	protected constructor() {
	}

	public cmp(other: ContextKeyExpression): number {
		return this.type - other.type;
	}

	public equals(other: ContextKeyExpression): boolean {
		return (other.type === this.type);
	}

	public evaluate(context: IContext): boolean {
		return true;
	}

	public serialize(): string {
		return 'true';
	}

	public keys(): string[] {
		return [];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return this;
	}

	public negate(): ContextKeyExpression {
		return ContextKeyFalseExpr.INSTANCE;
	}
}

export class ContextKeyDefinedExpr implements IContextKeyExpression {
	public static create(key: string): ContextKeyExpression {
		const staticValue = STATIC_VALUES.get(key);
		if (typeof staticValue === 'boolean') {
			return staticValue ? ContextKeyTrueExpr.INSTANCE : ContextKeyFalseExpr.INSTANCE;
		}
		return new ContextKeyDefinedExpr(key);
	}

	public readonly type = ContextKeyExprType.Defined;

	protected constructor(readonly key: string) {
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return cmp1(this.key, other.key);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return (this.key === other.key);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		return (!!context.getValue(this.key));
	}

	public serialize(): string {
		return this.key;
	}

	public keys(): string[] {
		return [this.key];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return mapFnc.mapDefined(this.key);
	}

	public negate(): ContextKeyExpression {
		return ContextKeyNotExpr.create(this.key);
	}
}

export class ContextKeyEqualsExpr implements IContextKeyExpression {

	public static create(key: string, value: any): ContextKeyExpression {
		if (typeof value === 'boolean') {
			return (value ? ContextKeyDefinedExpr.create(key) : ContextKeyNotExpr.create(key));
		}
		const staticValue = STATIC_VALUES.get(key);
		if (typeof staticValue === 'boolean') {
			const trueValue = staticValue ? 'true' : 'false';
			return (value === trueValue ? ContextKeyTrueExpr.INSTANCE : ContextKeyFalseExpr.INSTANCE);
		}
		return new ContextKeyEqualsExpr(key, value);
	}

	public readonly type = ContextKeyExprType.Equals;

	private constructor(private readonly key: string, private readonly value: any) {
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return cmp2(this.key, this.value, other.key, other.value);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return (this.key === other.key && this.value === other.value);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		// Intentional ==
		// eslint-disable-next-line eqeqeq
		return (context.getValue(this.key) == this.value);
	}

	public serialize(): string {
		return `${this.key} == '${this.value}'`;
	}

	public keys(): string[] {
		return [this.key];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return mapFnc.mapEquals(this.key, this.value);
	}

	public negate(): ContextKeyExpression {
		return ContextKeyNotEqualsExpr.create(this.key, this.value);
	}
}

export class ContextKeyInExpr implements IContextKeyExpression {

	public static create(key: string, valueKey: string): ContextKeyInExpr {
		return new ContextKeyInExpr(key, valueKey);
	}

	public readonly type = ContextKeyExprType.In;

	private constructor(private readonly key: string, private readonly valueKey: string) {
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return cmp2(this.key, this.valueKey, other.key, other.valueKey);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return (this.key === other.key && this.valueKey === other.valueKey);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		const source = context.getValue(this.valueKey);

		const item = context.getValue(this.key);

		if (Array.isArray(source)) {
			return (source.indexOf(item) >= 0);
		}

		if (typeof item === 'string' && typeof source === 'object' && source !== null) {
			return hasOwnProperty.call(source, item);
		}
		return false;
	}

	public serialize(): string {
		return `${this.key} in '${this.valueKey}'`;
	}

	public keys(): string[] {
		return [this.key, this.valueKey];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyInExpr {
		return mapFnc.mapIn(this.key, this.valueKey);
	}

	public negate(): ContextKeyExpression {
		return ContextKeyNotInExpr.create(this);
	}
}

export class ContextKeyNotInExpr implements IContextKeyExpression {

	public static create(actual: ContextKeyInExpr): ContextKeyNotInExpr {
		return new ContextKeyNotInExpr(actual);
	}

	public readonly type = ContextKeyExprType.NotIn;

	private constructor(private readonly _actual: ContextKeyInExpr) {
		//
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return this._actual.cmp(other._actual);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return this._actual.equals(other._actual);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		return !this._actual.evaluate(context);
	}

	public serialize(): string {
		throw new Error('Method not implemented.');
	}

	public keys(): string[] {
		return this._actual.keys();
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return new ContextKeyNotInExpr(this._actual.map(mapFnc));
	}

	public negate(): ContextKeyExpression {
		return this._actual;
	}
}

export class ContextKeyNotEqualsExpr implements IContextKeyExpression {

	public static create(key: string, value: any): ContextKeyExpression {
		if (typeof value === 'boolean') {
			if (value) {
				return ContextKeyNotExpr.create(key);
			}
			return ContextKeyDefinedExpr.create(key);
		}
		const staticValue = STATIC_VALUES.get(key);
		if (typeof staticValue === 'boolean') {
			const falseValue = staticValue ? 'true' : 'false';
			return (value === falseValue ? ContextKeyFalseExpr.INSTANCE : ContextKeyTrueExpr.INSTANCE);
		}
		return new ContextKeyNotEqualsExpr(key, value);
	}

	public readonly type = ContextKeyExprType.NotEquals;

	private constructor(private readonly key: string, private readonly value: any) {
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return cmp2(this.key, this.value, other.key, other.value);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return (this.key === other.key && this.value === other.value);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		// Intentional !=
		// eslint-disable-next-line eqeqeq
		return (context.getValue(this.key) != this.value);
	}

	public serialize(): string {
		return `${this.key} != '${this.value}'`;
	}

	public keys(): string[] {
		return [this.key];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return mapFnc.mapNotEquals(this.key, this.value);
	}

	public negate(): ContextKeyExpression {
		return ContextKeyEqualsExpr.create(this.key, this.value);
	}
}

export class ContextKeyNotExpr implements IContextKeyExpression {

	public static create(key: string): ContextKeyExpression {
		const staticValue = STATIC_VALUES.get(key);
		if (typeof staticValue === 'boolean') {
			return (staticValue ? ContextKeyFalseExpr.INSTANCE : ContextKeyTrueExpr.INSTANCE);
		}
		return new ContextKeyNotExpr(key);
	}

	public readonly type = ContextKeyExprType.Not;

	private constructor(private readonly key: string) {
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return cmp1(this.key, other.key);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return (this.key === other.key);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		return (!context.getValue(this.key));
	}

	public serialize(): string {
		return `!${this.key}`;
	}

	public keys(): string[] {
		return [this.key];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return mapFnc.mapNot(this.key);
	}

	public negate(): ContextKeyExpression {
		return ContextKeyDefinedExpr.create(this.key);
	}
}

export class ContextKeyGreaterExpr implements IContextKeyExpression {

	public static create(key: string, value: any): ContextKeyExpression {
		return new ContextKeyGreaterExpr(key, value);
	}

	public readonly type = ContextKeyExprType.Greater;

	private constructor(
		private readonly key: string,
		private readonly value: any
	) { }

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return cmp2(this.key, this.value, other.key, other.value);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return (this.key === other.key && this.value === other.value);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		return (parseFloat(<any>context.getValue(this.key)) > parseFloat(this.value));
	}

	public serialize(): string {
		return `${this.key} > ${this.value}`;
	}

	public keys(): string[] {
		return [this.key];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return mapFnc.mapGreater(this.key, this.value);
	}

	public negate(): ContextKeyExpression {
		return ContextKeySmallerEqualsExpr.create(this.key, this.value);
	}
}

export class ContextKeyGreaterEqualsExpr implements IContextKeyExpression {

	public static create(key: string, value: any): ContextKeyExpression {
		return new ContextKeyGreaterEqualsExpr(key, value);
	}

	public readonly type = ContextKeyExprType.GreaterEquals;

	private constructor(
		private readonly key: string,
		private readonly value: any
	) { }

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return cmp2(this.key, this.value, other.key, other.value);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return (this.key === other.key && this.value === other.value);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		return (parseFloat(<any>context.getValue(this.key)) >= parseFloat(this.value));
	}

	public serialize(): string {
		return `${this.key} >= ${this.value}`;
	}

	public keys(): string[] {
		return [this.key];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return mapFnc.mapGreaterEquals(this.key, this.value);
	}

	public negate(): ContextKeyExpression {
		return ContextKeySmallerExpr.create(this.key, this.value);
	}
}

export class ContextKeySmallerExpr implements IContextKeyExpression {

	public static create(key: string, value: any): ContextKeyExpression {
		return new ContextKeySmallerExpr(key, value);
	}

	public readonly type = ContextKeyExprType.Smaller;

	private constructor(
		private readonly key: string,
		private readonly value: any
	) {
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return cmp2(this.key, this.value, other.key, other.value);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return (this.key === other.key && this.value === other.value);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		return (parseFloat(<any>context.getValue(this.key)) < parseFloat(this.value));
	}

	public serialize(): string {
		return `${this.key} < ${this.value}`;
	}

	public keys(): string[] {
		return [this.key];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return mapFnc.mapSmaller(this.key, this.value);
	}

	public negate(): ContextKeyExpression {
		return ContextKeyGreaterEqualsExpr.create(this.key, this.value);
	}
}

export class ContextKeySmallerEqualsExpr implements IContextKeyExpression {

	public static create(key: string, value: any): ContextKeyExpression {
		return new ContextKeySmallerEqualsExpr(key, value);
	}

	public readonly type = ContextKeyExprType.SmallerEquals;

	private constructor(
		private readonly key: string,
		private readonly value: any
	) {
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return cmp2(this.key, this.value, other.key, other.value);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return (this.key === other.key && this.value === other.value);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		return (parseFloat(<any>context.getValue(this.key)) <= parseFloat(this.value));
	}

	public serialize(): string {
		return `${this.key} <= ${this.value}`;
	}

	public keys(): string[] {
		return [this.key];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return mapFnc.mapSmallerEquals(this.key, this.value);
	}

	public negate(): ContextKeyExpression {
		return ContextKeyGreaterExpr.create(this.key, this.value);
	}
}

export class ContextKeyRegexExpr implements IContextKeyExpression {

	public static create(key: string, regexp: RegExp | null): ContextKeyRegexExpr {
		return new ContextKeyRegexExpr(key, regexp);
	}

	public readonly type = ContextKeyExprType.Regex;

	private constructor(private readonly key: string, private readonly regexp: RegExp | null) {
		//
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		if (this.key < other.key) {
			return -1;
		}
		if (this.key > other.key) {
			return 1;
		}
		const thisSource = this.regexp ? this.regexp.source : '';
		const otherSource = other.regexp ? other.regexp.source : '';
		if (thisSource < otherSource) {
			return -1;
		}
		if (thisSource > otherSource) {
			return 1;
		}
		return 0;
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			const thisSource = this.regexp ? this.regexp.source : '';
			const otherSource = other.regexp ? other.regexp.source : '';
			return (this.key === other.key && thisSource === otherSource);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		let value = context.getValue<any>(this.key);
		return this.regexp ? this.regexp.test(value) : false;
	}

	public serialize(): string {
		const value = this.regexp
			? `/${this.regexp.source}/${this.regexp.ignoreCase ? 'i' : ''}`
			: '/invalid/';
		return `${this.key} =~ ${value}`;
	}

	public keys(): string[] {
		return [this.key];
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyRegexExpr {
		return mapFnc.mapRegex(this.key, this.regexp);
	}

	public negate(): ContextKeyExpression {
		return ContextKeyNotRegexExpr.create(this);
	}
}

export class ContextKeyNotRegexExpr implements IContextKeyExpression {

	public static create(actual: ContextKeyRegexExpr): ContextKeyExpression {
		return new ContextKeyNotRegexExpr(actual);
	}

	public readonly type = ContextKeyExprType.NotRegex;

	private constructor(private readonly _actual: ContextKeyRegexExpr) {
		//
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		return this._actual.cmp(other._actual);
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			return this._actual.equals(other._actual);
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		return !this._actual.evaluate(context);
	}

	public serialize(): string {
		throw new Error('Method not implemented.');
	}

	public keys(): string[] {
		return this._actual.keys();
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return new ContextKeyNotRegexExpr(this._actual.map(mapFnc));
	}

	public negate(): ContextKeyExpression {
		return this._actual;
	}
}

export class ContextKeyAndExpr implements IContextKeyExpression {

	public static create(_expr: ReadonlyArray<ContextKeyExpression | null | undefined>): ContextKeyExpression | undefined {
		return ContextKeyAndExpr._normalizeArr(_expr);
	}

	public readonly type = ContextKeyExprType.And;

	private constructor(public readonly expr: ContextKeyExpression[]) {
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		if (this.expr.length < other.expr.length) {
			return -1;
		}
		if (this.expr.length > other.expr.length) {
			return 1;
		}
		for (let i = 0, len = this.expr.length; i < len; i++) {
			const r = cmp(this.expr[i], other.expr[i]);
			if (r !== 0) {
				return r;
			}
		}
		return 0;
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			if (this.expr.length !== other.expr.length) {
				return false;
			}
			for (let i = 0, len = this.expr.length; i < len; i++) {
				if (!this.expr[i].equals(other.expr[i])) {
					return false;
				}
			}
			return true;
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		for (let i = 0, len = this.expr.length; i < len; i++) {
			if (!this.expr[i].evaluate(context)) {
				return false;
			}
		}
		return true;
	}

	private static _normalizeArr(arr: ReadonlyArray<ContextKeyExpression | null | undefined>): ContextKeyExpression | undefined {
		const expr: ContextKeyExpression[] = [];
		let hasTrue = false;

		for (const e of arr) {
			if (!e) {
				continue;
			}

			if (e.type === ContextKeyExprType.True) {
				// anything && true ==> anything
				hasTrue = true;
				continue;
			}

			if (e.type === ContextKeyExprType.False) {
				// anything && false ==> false
				return ContextKeyFalseExpr.INSTANCE;
			}

			if (e.type === ContextKeyExprType.And) {
				expr.push(...e.expr);
				continue;
			}

			expr.push(e);
		}

		if (expr.length === 0 && hasTrue) {
			return ContextKeyTrueExpr.INSTANCE;
		}

		if (expr.length === 0) {
			return undefined;
		}

		if (expr.length === 1) {
			return expr[0];
		}

		expr.sort(cmp);

		// We must distribute any OR expression because we don't support parens
		// OR extensions will be at the end (due to sorting rules)
		while (expr.length > 1) {
			const lastElement = expr[expr.length - 1];
			if (lastElement.type !== ContextKeyExprType.Or) {
				break;
			}
			// pop the last element
			expr.pop();

			// pop the second to last element
			const secondToLastElement = expr.pop()!;

			// distribute `lastElement` over `secondToLastElement`
			const resultElement = ContextKeyOrExpr.create(
				lastElement.expr.map(el => ContextKeyAndExpr.create([el, secondToLastElement]))
			);

			if (resultElement) {
				expr.push(resultElement);
				expr.sort(cmp);
			}
		}

		if (expr.length === 1) {
			return expr[0];
		}

		return new ContextKeyAndExpr(expr);
	}

	public serialize(): string {
		return this.expr.map(e => e.serialize()).join(' && ');
	}

	public keys(): string[] {
		const result: string[] = [];
		for (let expr of this.expr) {
			result.push(...expr.keys());
		}
		return result;
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return new ContextKeyAndExpr(this.expr.map(expr => expr.map(mapFnc)));
	}

	public negate(): ContextKeyExpression {
		let result: ContextKeyExpression[] = [];
		for (let expr of this.expr) {
			result.push(expr.negate());
		}
		return ContextKeyOrExpr.create(result)!;
	}
}

export class ContextKeyOrExpr implements IContextKeyExpression {

	public static create(_expr: ReadonlyArray<ContextKeyExpression | null | undefined>): ContextKeyExpression | undefined {
		const expr = ContextKeyOrExpr._normalizeArr(_expr);
		if (expr.length === 0) {
			return undefined;
		}

		if (expr.length === 1) {
			return expr[0];
		}

		return new ContextKeyOrExpr(expr);
	}

	public readonly type = ContextKeyExprType.Or;

	private constructor(public readonly expr: ContextKeyExpression[]) {
	}

	public cmp(other: ContextKeyExpression): number {
		if (other.type !== this.type) {
			return this.type - other.type;
		}
		if (this.expr.length < other.expr.length) {
			return -1;
		}
		if (this.expr.length > other.expr.length) {
			return 1;
		}
		for (let i = 0, len = this.expr.length; i < len; i++) {
			const r = cmp(this.expr[i], other.expr[i]);
			if (r !== 0) {
				return r;
			}
		}
		return 0;
	}

	public equals(other: ContextKeyExpression): boolean {
		if (other.type === this.type) {
			if (this.expr.length !== other.expr.length) {
				return false;
			}
			for (let i = 0, len = this.expr.length; i < len; i++) {
				if (!this.expr[i].equals(other.expr[i])) {
					return false;
				}
			}
			return true;
		}
		return false;
	}

	public evaluate(context: IContext): boolean {
		for (let i = 0, len = this.expr.length; i < len; i++) {
			if (this.expr[i].evaluate(context)) {
				return true;
			}
		}
		return false;
	}

	private static _normalizeArr(arr: ReadonlyArray<ContextKeyExpression | null | undefined>): ContextKeyExpression[] {
		let expr: ContextKeyExpression[] = [];
		let hasFalse = false;

		if (arr) {
			for (let i = 0, len = arr.length; i < len; i++) {
				const e = arr[i];
				if (!e) {
					continue;
				}

				if (e.type === ContextKeyExprType.False) {
					// anything || false ==> anything
					hasFalse = true;
					continue;
				}

				if (e.type === ContextKeyExprType.True) {
					// anything || true ==> true
					return [ContextKeyTrueExpr.INSTANCE];
				}

				if (e.type === ContextKeyExprType.Or) {
					expr = expr.concat(e.expr);
					continue;
				}

				expr.push(e);
			}

			if (expr.length === 0 && hasFalse) {
				return [ContextKeyFalseExpr.INSTANCE];
			}

			expr.sort(cmp);
		}

		return expr;
	}

	public serialize(): string {
		return this.expr.map(e => e.serialize()).join(' || ');
	}

	public keys(): string[] {
		const result: string[] = [];
		for (let expr of this.expr) {
			result.push(...expr.keys());
		}
		return result;
	}

	public map(mapFnc: IContextKeyExprMapper): ContextKeyExpression {
		return new ContextKeyOrExpr(this.expr.map(expr => expr.map(mapFnc)));
	}

	public negate(): ContextKeyExpression {
		let result: ContextKeyExpression[] = [];
		for (let expr of this.expr) {
			result.push(expr.negate());
		}

		const terminals = (node: ContextKeyExpression) => {
			if (node.type === ContextKeyExprType.Or) {
				return node.expr;
			}
			return [node];
		};

		// We don't support parens, so here we distribute the AND over the OR terminals
		// We always take the first 2 AND pairs and distribute them
		while (result.length > 1) {
			const LEFT = result.shift()!;
			const RIGHT = result.shift()!;

			const all: ContextKeyExpression[] = [];
			for (const left of terminals(LEFT)) {
				for (const right of terminals(RIGHT)) {
					all.push(ContextKeyExpr.and(left, right)!);
				}
			}
			result.unshift(ContextKeyExpr.or(...all)!);
		}

		return result[0];
	}
}

export interface ContextKeyInfo {
	readonly key: string;
	readonly type?: string;
	readonly description?: string;
}

export class RawContextKey<T> extends ContextKeyDefinedExpr {

	private static _info: ContextKeyInfo[] = [];

	static all(): IterableIterator<ContextKeyInfo> {
		return RawContextKey._info.values();
	}

	private readonly _defaultValue: T | undefined;

	constructor(key: string, defaultValue: T | undefined, metaOrHide?: string | true | { type: string, description: string }) {
		super(key);
		this._defaultValue = defaultValue;

		// collect all context keys into a central place
		if (typeof metaOrHide === 'object') {
			RawContextKey._info.push({ ...metaOrHide, key });
		} else if (metaOrHide !== true) {
			RawContextKey._info.push({ key, description: metaOrHide, type: defaultValue !== null && defaultValue !== undefined ? typeof defaultValue : undefined });
		}
	}

	public bindTo(target: IContextKeyService): IContextKey<T> {
		return target.createKey(this.key, this._defaultValue);
	}

	public getValue(target: IContextKeyService): T | undefined {
		return target.getContextKeyValue<T>(this.key);
	}

	public toNegated(): ContextKeyExpression {
		return ContextKeyExpr.not(this.key);
	}

	public isEqualTo(value: any): ContextKeyExpression {
		return ContextKeyExpr.equals(this.key, value);
	}

	public notEqualsTo(value: any): ContextKeyExpression {
		return ContextKeyExpr.notEquals(this.key, value);
	}
}

export interface IContext {
	getValue<T>(key: string): T | undefined;
}

export interface IContextKey<T> {
	set(value: T): void;
	reset(): void;
	get(): T | undefined;
}

export interface IContextKeyServiceTarget {
	parentElement: IContextKeyServiceTarget | null;
	setAttribute(attr: string, value: string): void;
	removeAttribute(attr: string): void;
	hasAttribute(attr: string): boolean;
	getAttribute(attr: string): string | null;
}

export const IContextKeyService = createDecorator<IContextKeyService>('contextKeyService');

export interface IReadableSet<T> {
	has(value: T): boolean;
}

export interface IContextKeyChangeEvent {
	affectsSome(keys: IReadableSet<string>): boolean;
}

export interface IContextKeyService {
	readonly _serviceBrand: undefined;
	dispose(): void;

	onDidChangeContext: Event<IContextKeyChangeEvent>;
	bufferChangeEvents(callback: Function): void;

	createKey<T>(key: string, defaultValue: T | undefined): IContextKey<T>;
	contextMatchesRules(rules: ContextKeyExpression | undefined): boolean;
	getContextKeyValue<T>(key: string): T | undefined;

	createScoped(target: IContextKeyServiceTarget): IContextKeyService;
	createOverlay(overlay: Iterable<[string, any]>): IContextKeyService;
	getContext(target: IContextKeyServiceTarget | null): IContext;

	updateParent(parentContextKeyService: IContextKeyService): void;
}

export const SET_CONTEXT_COMMAND_ID = 'setContext';

function cmp1(key1: string, key2: string): number {
	if (key1 < key2) {
		return -1;
	}
	if (key1 > key2) {
		return 1;
	}
	return 0;
}

function cmp2(key1: string, value1: any, key2: string, value2: any): number {
	if (key1 < key2) {
		return -1;
	}
	if (key1 > key2) {
		return 1;
	}
	if (value1 < value2) {
		return -1;
	}
	if (value1 > value2) {
		return 1;
	}
	return 0;
}
