/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A very VM friendly rgba datastructure.
 * Please don't touch unless you take a look at the IR.
 */
export class RGBA8 {
	_rgba8Brand: void;

	static readonly Empty = new RGBA8(0, 0, 0, 0);

	/**
	 * Red: integer in [0-255]
	 */
	public readonly r: number;
	/**
	 * Green: integer in [0-255]
	 */
	public readonly g: number;
	/**
	 * Blue: integer in [0-255]
	 */
	public readonly b: number;
	/**
	 * Alpha: integer in [0-255]
	 */
	public readonly a: number;

	constructor(r: number, g: number, b: number, a: number) {
		this.r = RGBA8._clamp(r);
		this.g = RGBA8._clamp(g);
		this.b = RGBA8._clamp(b);
		this.a = RGBA8._clamp(a);
	}

	public equals(other: RGBA8): boolean {
		return (
			this.r === other.r
			&& this.g === other.g
			&& this.b === other.b
			&& this.a === other.a
		);
	}

	private static _clamp(c: number): number {
		if (c < 0) {
			return 0;
		}
		if (c > 255) {
			return 255;
		}
		return c | 0;
	}
}
