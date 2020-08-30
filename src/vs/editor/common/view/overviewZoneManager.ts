/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const enum Constants {
	MINIMUM_HEIGHT = 4
}

export class ColorZone {
	_colorZoneBrand: void;

	public readonly from: number;
	public readonly to: number;
	public readonly colorId: number;

	constructor(from: number, to: number, colorId: number) {
		this.from = from | 0;
		this.to = to | 0;
		this.colorId = colorId | 0;
	}

	public static compare(a: ColorZone, b: ColorZone): number {
		if (a.colorId === b.colorId) {
			if (a.from === b.from) {
				return a.to - b.to;
			}
			return a.from - b.from;
		}
		return a.colorId - b.colorId;
	}
}

/**
 * A zone in the overview ruler
 */
export class OverviewRulerZone {
	_overviewRulerZoneBrand: void;

	public readonly startLineNumber: number;
	public readonly endLineNumber: number;
	public readonly color: string;

	private _colorZone: ColorZone | null;

	constructor(
		startLineNumber: number,
		endLineNumber: number,
		color: string
	) {
		this.startLineNumber = startLineNumber;
		this.endLineNumber = endLineNumber;
		this.color = color;
		this._colorZone = null;
	}

	public static compare(a: OverviewRulerZone, b: OverviewRulerZone): number {
		if (a.color === b.color) {
			if (a.startLineNumber === b.startLineNumber) {
				return a.endLineNumber - b.endLineNumber;
			}
			return a.startLineNumber - b.startLineNumber;
		}
		return a.color < b.color ? -1 : 1;
	}

	public setColorZone(colorZone: ColorZone): void {
		this._colorZone = colorZone;
	}

	public getColorZones(): ColorZone | null {
		return this._colorZone;
	}
}

export class OverviewZoneManager {

	private readonly _getVerticalOffsetForLine: (lineNumber: number) => number;
	private _zones: OverviewRulerZone[];
	private _colorZonesInvalid: boolean;
	private _lineHeight: number;
	private _domWidth: number;
	private _domHeight: number;
	private _outerHeight: number;
	private _pixelRatio: number;

	private _lastAssignedId: number;
	private readonly _color2Id: { [color: string]: number; };
	private readonly _id2Color: string[];

	constructor(getVerticalOffsetForLine: (lineNumber: number) => number) {
		this._getVerticalOffsetForLine = getVerticalOffsetForLine;
		this._zones = [];
		this._colorZonesInvalid = false;
		this._lineHeight = 0;
		this._domWidth = 0;
		this._domHeight = 0;
		this._outerHeight = 0;
		this._pixelRatio = 1;

		this._lastAssignedId = 0;
		this._color2Id = Object.create(null);
		this._id2Color = [];
	}

	public getId2Color(): string[] {
		return this._id2Color;
	}

	public setZones(newZones: OverviewRulerZone[]): void {
		this._zones = newZones;
		this._zones.sort(OverviewRulerZone.compare);
	}

	public setLineHeight(lineHeight: number): boolean {
		if (this._lineHeight === lineHeight) {
			return false;
		}
		this._lineHeight = lineHeight;
		this._colorZonesInvalid = true;
		return true;
	}

	public setPixelRatio(pixelRatio: number): void {
		this._pixelRatio = pixelRatio;
		this._colorZonesInvalid = true;
	}

	public getDOMWidth(): number {
		return this._domWidth;
	}

	public getCanvasWidth(): number {
		return this._domWidth * this._pixelRatio;
	}

	public setDOMWidth(width: number): boolean {
		if (this._domWidth === width) {
			return false;
		}
		this._domWidth = width;
		this._colorZonesInvalid = true;
		return true;
	}

	public getDOMHeight(): number {
		return this._domHeight;
	}

	public getCanvasHeight(): number {
		return this._domHeight * this._pixelRatio;
	}

	public setDOMHeight(height: number): boolean {
		if (this._domHeight === height) {
			return false;
		}
		this._domHeight = height;
		this._colorZonesInvalid = true;
		return true;
	}

	public getOuterHeight(): number {
		return this._outerHeight;
	}

	public setOuterHeight(outerHeight: number): boolean {
		if (this._outerHeight === outerHeight) {
			return false;
		}
		this._outerHeight = outerHeight;
		this._colorZonesInvalid = true;
		return true;
	}

	public resolveColorZones(): ColorZone[] {
		const colorZonesInvalid = this._colorZonesInvalid;
		const lineHeight = Math.floor(this._lineHeight); // @perf
		const totalHeight = Math.floor(this.getCanvasHeight()); // @perf
		const outerHeight = Math.floor(this._outerHeight); // @perf
		const heightRatio = totalHeight / outerHeight;
		const halfMinimumHeight = Math.floor(Constants.MINIMUM_HEIGHT * this._pixelRatio / 2);

		let allColorZones: ColorZone[] = [];
		for (let i = 0, len = this._zones.length; i < len; i++) {
			const zone = this._zones[i];

			if (!colorZonesInvalid) {
				const colorZone = zone.getColorZones();
				if (colorZone) {
					allColorZones.push(colorZone);
					continue;
				}
			}

			const y1 = Math.floor(heightRatio * (this._getVerticalOffsetForLine(zone.startLineNumber)));
			const y2 = Math.floor(heightRatio * (this._getVerticalOffsetForLine(zone.endLineNumber) + lineHeight));

			let ycenter = Math.floor((y1 + y2) / 2);
			let halfHeight = (y2 - ycenter);

			if (halfHeight < halfMinimumHeight) {
				halfHeight = halfMinimumHeight;
			}

			if (ycenter - halfHeight < 0) {
				ycenter = halfHeight;
			}
			if (ycenter + halfHeight > totalHeight) {
				ycenter = totalHeight - halfHeight;
			}

			const color = zone.color;
			let colorId = this._color2Id[color];
			if (!colorId) {
				colorId = (++this._lastAssignedId);
				this._color2Id[color] = colorId;
				this._id2Color[colorId] = color;
			}
			const colorZone = new ColorZone(ycenter - halfHeight, ycenter + halfHeight, colorId);

			zone.setColorZone(colorZone);
			allColorZones.push(colorZone);
		}

		this._colorZonesInvalid = false;

		allColorZones.sort(ColorZone.compare);
		return allColorZones;
	}
}
