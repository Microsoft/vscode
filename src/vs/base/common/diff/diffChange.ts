/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Represents information about a specific difference between two sequences.
 */
export class DiffChange {

	/**
	 * The position of the first element in the original sequence which
	 * this change affects.
	 */
	public originalStart: number;

	/**
	 * The number of elements from the original sequence which were
	 * affected.
	 */
	public originalLength: number;

	/**
	 * The position of the first element in the modified sequence which
	 * this change affects.
	 */
	public modifiedStart: number;

	/**
	 * The number of elements from the modified sequence which were
	 * affected (added).
	 */
	public modifiedLength: number;

	/**
	 * Constructs a new DiffChange with the given sequence information
	 * and content.
	 */
	constructor(originalStart: number, originalLength: number, modifiedStart: number, modifiedLength: number) {
		//Debug.Assert(originalLength > 0 || modifiedLength > 0, "originalLength and modifiedLength cannot both be <= 0");
		this.originalStart = originalStart;
		this.originalLength = originalLength;
		this.modifiedStart = modifiedStart;
		this.modifiedLength = modifiedLength;
	}

	/**
	 * The end point (exclusive) of the change in the original sequence.
	 */
	public getOriginalEnd() {
		return this.originalStart + this.originalLength;
	}

	/**
	 * The end point (exclusive) of the change in the modified sequence.
	 */
	public getModifiedEnd() {
		return this.modifiedStart + this.modifiedLength;
	}
}
