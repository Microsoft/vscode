/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toUint8 } from 'vs/base/common/uint';

/**
 * A fast character classifier that uses a compact array for ASCII values.
 */
export class CharacterClassifier<T extends number> {
	/**
	 * Maintain a compact (fully initialized ASCII map for quickly classifying ASCII characters - used more often in code).
	 */
	protected _asciiMap: Uint8Array;

	/**
	 * The entire map (sparse array).
	 */
	protected _map: Map<number, number>;

	protected _defaultValue: number;

	constructor(_defaultValue: T) {
		let defaultValue = toUint8(_defaultValue);

		this._defaultValue = defaultValue;
		this._asciiMap = CharacterClassifier._createAsciiMap(defaultValue);
		this._map = new Map<number, number>();
	}

	private static _createAsciiMap(defaultValue: number): Uint8Array {
		let asciiMap: Uint8Array = new Uint8Array(256);
		for (let i = 0; i < 256; i++) {
			asciiMap[i] = defaultValue;
		}
		return asciiMap;
	}

	public set(charCode: number, _value: T): void {
		let value = toUint8(_value);

		if (charCode >= 0 && charCode < 256) {
			this._asciiMap[charCode] = value;
		} else {
			this._map.set(charCode, value);
		}
	}

	public get(charCode: number): T {
		if (charCode >= 0 && charCode < 256) {
			return <T>this._asciiMap[charCode];
		} else {
			return <T>(this._map.get(charCode) || this._defaultValue);
		}
	}
}

const enum Boolean {
	False = 0,
	True = 1
}

export class CharacterSet {

	private readonly _actual: CharacterClassifier<Boolean>;

	constructor() {
		this._actual = new CharacterClassifier<Boolean>(Boolean.False);
	}

	public add(charCode: number): void {
		this._actual.set(charCode, Boolean.True);
	}

	public has(charCode: number): boolean {
		return (this._actual.get(charCode) === Boolean.True);
	}
}
