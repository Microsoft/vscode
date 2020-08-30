/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as instantiation from './instantiation';

export class SyncDescriptor<T> {

	readonly ctor: any;
	readonly staticArguments: any[];
	readonly supportsDelayedInstantiation: boolean;

	constructor(ctor: new (...args: any[]) => T, staticArguments: any[] = [], supportsDelayedInstantiation: boolean = false) {
		this.ctor = ctor;
		this.staticArguments = staticArguments;
		this.supportsDelayedInstantiation = supportsDelayedInstantiation;
	}
}

export interface CreateSyncFunc {

	<T>(ctor: instantiation.IConstructorSignature0<T>): SyncDescriptor0<T>;

	<A1, T>(ctor: instantiation.IConstructorSignature1<A1, T>): SyncDescriptor1<A1, T>;
	<A1, T>(ctor: instantiation.IConstructorSignature1<A1, T>, a1: A1): SyncDescriptor0<T>;

	<A1, A2, T>(ctor: instantiation.IConstructorSignature2<A1, A2, T>): SyncDescriptor2<A1, A2, T>;
	<A1, A2, T>(ctor: instantiation.IConstructorSignature2<A1, A2, T>, a1: A1): SyncDescriptor1<A2, T>;
	<A1, A2, T>(ctor: instantiation.IConstructorSignature2<A1, A2, T>, a1: A1, a2: A2): SyncDescriptor0<T>;

	<A1, A2, A3, T>(ctor: instantiation.IConstructorSignature3<A1, A2, A3, T>): SyncDescriptor3<A1, A2, A3, T>;
	<A1, A2, A3, T>(ctor: instantiation.IConstructorSignature3<A1, A2, A3, T>, a1: A1): SyncDescriptor2<A2, A3, T>;
	<A1, A2, A3, T>(ctor: instantiation.IConstructorSignature3<A1, A2, A3, T>, a1: A1, a2: A2): SyncDescriptor1<A3, T>;
	<A1, A2, A3, T>(ctor: instantiation.IConstructorSignature3<A1, A2, A3, T>, a1: A1, a2: A2, a3: A3): SyncDescriptor0<T>;

	<A1, A2, A3, A4, T>(ctor: instantiation.IConstructorSignature4<A1, A2, A3, A4, T>): SyncDescriptor4<A1, A2, A3, A4, T>;
	<A1, A2, A3, A4, T>(ctor: instantiation.IConstructorSignature4<A1, A2, A3, A4, T>, a1: A1): SyncDescriptor3<A2, A3, A4, T>;
	<A1, A2, A3, A4, T>(ctor: instantiation.IConstructorSignature4<A1, A2, A3, A4, T>, a1: A1, a2: A2): SyncDescriptor2<A3, A4, T>;
	<A1, A2, A3, A4, T>(ctor: instantiation.IConstructorSignature4<A1, A2, A3, A4, T>, a1: A1, a2: A2, a3: A3): SyncDescriptor1<A4, T>;
	<A1, A2, A3, A4, T>(ctor: instantiation.IConstructorSignature4<A1, A2, A3, A4, T>, a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor0<T>;

	<A1, A2, A3, A4, A5, T>(ctor: instantiation.IConstructorSignature5<A1, A2, A3, A4, A5, T>): SyncDescriptor5<A1, A2, A3, A4, A5, T>;
	<A1, A2, A3, A4, A5, T>(ctor: instantiation.IConstructorSignature5<A1, A2, A3, A4, A5, T>, a1: A1): SyncDescriptor4<A2, A3, A4, A5, T>;
	<A1, A2, A3, A4, A5, T>(ctor: instantiation.IConstructorSignature5<A1, A2, A3, A4, A5, T>, a1: A1, a2: A2): SyncDescriptor3<A3, A4, A5, T>;
	<A1, A2, A3, A4, A5, T>(ctor: instantiation.IConstructorSignature5<A1, A2, A3, A4, A5, T>, a1: A1, a2: A2, a3: A3): SyncDescriptor2<A4, A5, T>;
	<A1, A2, A3, A4, A5, T>(ctor: instantiation.IConstructorSignature5<A1, A2, A3, A4, A5, T>, a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor1<A5, T>;
	<A1, A2, A3, A4, A5, T>(ctor: instantiation.IConstructorSignature5<A1, A2, A3, A4, A5, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): SyncDescriptor0<T>;

	<A1, A2, A3, A4, A5, A6, T>(ctor: instantiation.IConstructorSignature6<A1, A2, A3, A4, A5, A6, T>): SyncDescriptor6<A1, A2, A3, A4, A5, A6, T>;
	<A1, A2, A3, A4, A5, A6, T>(ctor: instantiation.IConstructorSignature6<A1, A2, A3, A4, A5, A6, T>, a1: A1): SyncDescriptor5<A2, A3, A4, A5, A6, T>;
	<A1, A2, A3, A4, A5, A6, T>(ctor: instantiation.IConstructorSignature6<A1, A2, A3, A4, A5, A6, T>, a1: A1, a2: A2): SyncDescriptor4<A3, A4, A5, A6, T>;
	<A1, A2, A3, A4, A5, A6, T>(ctor: instantiation.IConstructorSignature6<A1, A2, A3, A4, A5, A6, T>, a1: A1, a2: A2, a3: A3): SyncDescriptor3<A4, A5, A6, T>;
	<A1, A2, A3, A4, A5, A6, T>(ctor: instantiation.IConstructorSignature6<A1, A2, A3, A4, A5, A6, T>, a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor2<A5, A6, T>;
	<A1, A2, A3, A4, A5, A6, T>(ctor: instantiation.IConstructorSignature6<A1, A2, A3, A4, A5, A6, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): SyncDescriptor1<A6, T>;
	<A1, A2, A3, A4, A5, A6, T>(ctor: instantiation.IConstructorSignature6<A1, A2, A3, A4, A5, A6, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6): SyncDescriptor0<T>;

	<A1, A2, A3, A4, A5, A6, A7, T>(ctor: instantiation.IConstructorSignature7<A1, A2, A3, A4, A5, A6, A7, T>): SyncDescriptor7<A1, A2, A3, A4, A5, A6, A7, T>;
	<A1, A2, A3, A4, A5, A6, A7, T>(ctor: instantiation.IConstructorSignature7<A1, A2, A3, A4, A5, A6, A7, T>, a1: A1): SyncDescriptor6<A2, A3, A4, A5, A6, A7, T>;
	<A1, A2, A3, A4, A5, A6, A7, T>(ctor: instantiation.IConstructorSignature7<A1, A2, A3, A4, A5, A6, A7, T>, a1: A1, a2: A2): SyncDescriptor5<A3, A4, A5, A6, A7, T>;
	<A1, A2, A3, A4, A5, A6, A7, T>(ctor: instantiation.IConstructorSignature7<A1, A2, A3, A4, A5, A6, A7, T>, a1: A1, a2: A2, a3: A3): SyncDescriptor4<A4, A5, A6, A7, T>;
	<A1, A2, A3, A4, A5, A6, A7, T>(ctor: instantiation.IConstructorSignature7<A1, A2, A3, A4, A5, A6, A7, T>, a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor3<A5, A6, A7, T>;
	<A1, A2, A3, A4, A5, A6, A7, T>(ctor: instantiation.IConstructorSignature7<A1, A2, A3, A4, A5, A6, A7, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): SyncDescriptor2<A6, A7, T>;
	<A1, A2, A3, A4, A5, A6, A7, T>(ctor: instantiation.IConstructorSignature7<A1, A2, A3, A4, A5, A6, A7, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6): SyncDescriptor1<A7, T>;
	<A1, A2, A3, A4, A5, A6, A7, T>(ctor: instantiation.IConstructorSignature7<A1, A2, A3, A4, A5, A6, A7, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7): SyncDescriptor0<T>;

	<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>): SyncDescriptor8<A1, A2, A3, A4, A5, A6, A7, A8, T>;
	<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1): SyncDescriptor7<A2, A3, A4, A5, A6, A7, A8, T>;
	<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1, a2: A2): SyncDescriptor6<A3, A4, A5, A6, A7, A8, T>;
	<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1, a2: A2, a3: A3): SyncDescriptor5<A4, A5, A6, A7, A8, T>;
	<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor4<A5, A6, A7, A8, T>;
	<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): SyncDescriptor3<A6, A7, A8, T>;
	<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6): SyncDescriptor2<A7, A8, T>;
	<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7): SyncDescriptor1<A8, T>;
	<A1, A2, A3, A4, A5, A6, A7, A8, T>(ctor: instantiation.IConstructorSignature8<A1, A2, A3, A4, A5, A6, A7, A8, T>, a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8): SyncDescriptor0<T>;
}
export const createSyncDescriptor: CreateSyncFunc = <T>(ctor: any, ...staticArguments: any[]): any => {
	return new SyncDescriptor<T>(ctor, staticArguments);
};

export interface SyncDescriptor0<T> {
	ctor: any;
	bind(): SyncDescriptor0<T>;
}
export interface SyncDescriptor1<A1, T> {
	ctor: any;
	bind(a1: A1): SyncDescriptor0<T>;
}
export interface SyncDescriptor2<A1, A2, T> {
	ctor: any;
	bind(a1: A1): SyncDescriptor1<A2, T>;
	bind(a1: A1, a2: A2): SyncDescriptor0<T>;
}
export interface SyncDescriptor3<A1, A2, A3, T> {
	ctor: any;
	bind(a1: A1): SyncDescriptor2<A2, A3, T>;
	bind(a1: A1, a2: A2): SyncDescriptor1<A3, T>;
	bind(a1: A1, a2: A2, a3: A3): SyncDescriptor0<T>;
}
export interface SyncDescriptor4<A1, A2, A3, A4, T> {
	ctor: any;
	bind(a1: A1): SyncDescriptor3<A2, A3, A4, T>;
	bind(a1: A1, a2: A2): SyncDescriptor2<A3, A4, T>;
	bind(a1: A1, a2: A2, a3: A3): SyncDescriptor1<A4, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor0<T>;
}
export interface SyncDescriptor5<A1, A2, A3, A4, A5, T> {
	ctor: any;
	bind(a1: A1): SyncDescriptor4<A2, A3, A4, A5, T>;
	bind(a1: A1, a2: A2): SyncDescriptor3<A3, A4, A5, T>;
	bind(a1: A1, a2: A2, a3: A3): SyncDescriptor2<A4, A5, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor1<A5, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): SyncDescriptor0<T>;
}
export interface SyncDescriptor6<A1, A2, A3, A4, A5, A6, T> {
	ctor: any;
	bind(a1: A1): SyncDescriptor5<A2, A3, A4, A5, A6, T>;
	bind(a1: A1, a2: A2): SyncDescriptor4<A3, A4, A5, A6, T>;
	bind(a1: A1, a2: A2, a3: A3): SyncDescriptor3<A4, A5, A6, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor2<A5, A6, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): SyncDescriptor1<A6, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6): SyncDescriptor0<T>;
}
export interface SyncDescriptor7<A1, A2, A3, A4, A5, A6, A7, T> {
	ctor: any;
	bind(a1: A1): SyncDescriptor6<A2, A3, A4, A5, A6, A7, T>;
	bind(a1: A1, a2: A2): SyncDescriptor5<A3, A4, A5, A6, A7, T>;
	bind(a1: A1, a2: A2, a3: A3): SyncDescriptor4<A4, A5, A6, A7, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor3<A5, A6, A7, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): SyncDescriptor2<A6, A7, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6): SyncDescriptor1<A7, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7): SyncDescriptor0<T>;
}
export interface SyncDescriptor8<A1, A2, A3, A4, A5, A6, A7, A8, T> {
	ctor: any;
	bind(a1: A1): SyncDescriptor7<A2, A3, A4, A5, A6, A7, A8, T>;
	bind(a1: A1, a2: A2): SyncDescriptor6<A3, A4, A5, A6, A7, A8, T>;
	bind(a1: A1, a2: A2, a3: A3): SyncDescriptor5<A4, A5, A6, A7, A8, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4): SyncDescriptor4<A5, A6, A7, A8, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5): SyncDescriptor3<A6, A7, A8, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6): SyncDescriptor2<A7, A8, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7): SyncDescriptor1<A8, T>;
	bind(a1: A1, a2: A2, a3: A3, a4: A4, a5: A5, a6: A6, a7: A7, a8: A8): SyncDescriptor0<T>;
}
