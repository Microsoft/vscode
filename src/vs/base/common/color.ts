/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';

function roundFloat(number: number, decimalPoints: number): number {
	const decimal = Math.pow(10, decimalPoints);
	return Math.round(number * decimal) / decimal;
}

export class RGBA {
	_rgbaBrand: void;

	/**
	 * Red: integer in [0-255]
	 */
	readonly r: number;

	/**
	 * Green: integer in [0-255]
	 */
	readonly g: number;

	/**
	 * Blue: integer in [0-255]
	 */
	readonly b: number;

	/**
	 * Alpha: float in [0-1]
	 */
	readonly a: number;

	constructor(r: number, g: number, b: number, a: number = 1) {
		this.r = Math.min(255, Math.max(0, r)) | 0;
		this.g = Math.min(255, Math.max(0, g)) | 0;
		this.b = Math.min(255, Math.max(0, b)) | 0;
		this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
	}

	static equals(a: RGBA, b: RGBA): boolean {
		return a.r === b.r && a.g === b.g && a.b === b.b && a.a === b.a;
	}
}

export class HSLA {

	_hslaBrand: void;

	/**
	 * Hue: integer in [0, 360]
	 */
	readonly h: number;

	/**
	 * Saturation: float in [0, 1]
	 */
	readonly s: number;

	/**
	 * Luminosity: float in [0, 1]
	 */
	readonly l: number;

	/**
	 * Alpha: float in [0, 1]
	 */
	readonly a: number;

	constructor(h: number, s: number, l: number, a: number) {
		this.h = Math.max(Math.min(360, h), 0) | 0;
		this.s = roundFloat(Math.max(Math.min(1, s), 0), 3);
		this.l = roundFloat(Math.max(Math.min(1, l), 0), 3);
		this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
	}

	static equals(a: HSLA, b: HSLA): boolean {
		return a.h === b.h && a.s === b.s && a.l === b.l && a.a === b.a;
	}

	/**
	 * Converts an RGB color value to HSL. Conversion formula
	 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
	 * Assumes r, g, and b are contained in the set [0, 255] and
	 * returns h in the set [0, 360], s, and l in the set [0, 1].
	 */
	static fromRGBA(rgba: RGBA): HSLA {
		const r = rgba.r / 255;
		const g = rgba.g / 255;
		const b = rgba.b / 255;
		const a = rgba.a;

		const max = Math.max(r, g, b);
		const min = Math.min(r, g, b);
		let h = 0;
		let s = 0;
		const l = (min + max) / 2;
		const chroma = max - min;

		if (chroma > 0) {
			s = Math.min((l <= 0.5 ? chroma / (2 * l) : chroma / (2 - (2 * l))), 1);

			switch (max) {
				case r: h = (g - b) / chroma + (g < b ? 6 : 0); break;
				case g: h = (b - r) / chroma + 2; break;
				case b: h = (r - g) / chroma + 4; break;
			}

			h *= 60;
			h = Math.round(h);
		}
		return new HSLA(h, s, l, a);
	}

	private static _hue2rgb(p: number, q: number, t: number): number {
		if (t < 0) {
			t += 1;
		}
		if (t > 1) {
			t -= 1;
		}
		if (t < 1 / 6) {
			return p + (q - p) * 6 * t;
		}
		if (t < 1 / 2) {
			return q;
		}
		if (t < 2 / 3) {
			return p + (q - p) * (2 / 3 - t) * 6;
		}
		return p;
	}

	/**
	 * Converts an HSL color value to RGB. Conversion formula
	 * adapted from http://en.wikipedia.org/wiki/HSL_color_space.
	 * Assumes h in the set [0, 360] s, and l are contained in the set [0, 1] and
	 * returns r, g, and b in the set [0, 255].
	 */
	static toRGBA(hsla: HSLA): RGBA {
		const h = hsla.h / 360;
		const { s, l, a } = hsla;
		let r: number, g: number, b: number;

		if (s === 0) {
			r = g = b = l; // achromatic
		} else {
			const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
			const p = 2 * l - q;
			r = HSLA._hue2rgb(p, q, h + 1 / 3);
			g = HSLA._hue2rgb(p, q, h);
			b = HSLA._hue2rgb(p, q, h - 1 / 3);
		}

		return new RGBA(Math.round(r * 255), Math.round(g * 255), Math.round(b * 255), a);
	}
}

export class HSVA {

	_hsvaBrand: void;

	/**
	 * Hue: integer in [0, 360]
	 */
	readonly h: number;

	/**
	 * Saturation: float in [0, 1]
	 */
	readonly s: number;

	/**
	 * Value: float in [0, 1]
	 */
	readonly v: number;

	/**
	 * Alpha: float in [0, 1]
	 */
	readonly a: number;

	constructor(h: number, s: number, v: number, a: number) {
		this.h = Math.max(Math.min(360, h), 0) | 0;
		this.s = roundFloat(Math.max(Math.min(1, s), 0), 3);
		this.v = roundFloat(Math.max(Math.min(1, v), 0), 3);
		this.a = roundFloat(Math.max(Math.min(1, a), 0), 3);
	}

	static equals(a: HSVA, b: HSVA): boolean {
		return a.h === b.h && a.s === b.s && a.v === b.v && a.a === b.a;
	}

	// from http://www.rapidtables.com/convert/color/rgb-to-hsv.htm
	static fromRGBA(rgba: RGBA): HSVA {
		const r = rgba.r / 255;
		const g = rgba.g / 255;
		const b = rgba.b / 255;
		const cmax = Math.max(r, g, b);
		const cmin = Math.min(r, g, b);
		const delta = cmax - cmin;
		const s = cmax === 0 ? 0 : (delta / cmax);
		let m: number;

		if (delta === 0) {
			m = 0;
		} else if (cmax === r) {
			m = ((((g - b) / delta) % 6) + 6) % 6;
		} else if (cmax === g) {
			m = ((b - r) / delta) + 2;
		} else {
			m = ((r - g) / delta) + 4;
		}

		return new HSVA(Math.round(m * 60), s, cmax, rgba.a);
	}

	// from http://www.rapidtables.com/convert/color/hsv-to-rgb.htm
	static toRGBA(hsva: HSVA): RGBA {
		const { h, s, v, a } = hsva;
		const c = v * s;
		const x = c * (1 - Math.abs((h / 60) % 2 - 1));
		const m = v - c;
		let [r, g, b] = [0, 0, 0];

		if (h < 60) {
			r = c;
			g = x;
		} else if (h < 120) {
			r = x;
			g = c;
		} else if (h < 180) {
			g = c;
			b = x;
		} else if (h < 240) {
			g = x;
			b = c;
		} else if (h < 300) {
			r = x;
			b = c;
		} else if (h < 360) {
			r = c;
			b = x;
		}

		r = Math.round((r + m) * 255);
		g = Math.round((g + m) * 255);
		b = Math.round((b + m) * 255);

		return new RGBA(r, g, b, a);
	}
}

export class Color {

	static fromHex(hex: string): Color {
		return Color.Format.CSS.parseHex(hex) || Color.red;
	}

	readonly rgba: RGBA;
	private _hsla?: HSLA;
	get hsla(): HSLA {
		if (this._hsla) {
			return this._hsla;
		} else {
			return HSLA.fromRGBA(this.rgba);
		}
	}

	private _hsva?: HSVA;
	get hsva(): HSVA {
		if (this._hsva) {
			return this._hsva;
		}
		return HSVA.fromRGBA(this.rgba);
	}

	constructor(arg: RGBA | HSLA | HSVA) {
		if (!arg) {
			throw new Error('Color needs a value');
		} else if (arg instanceof RGBA) {
			this.rgba = arg;
		} else if (arg instanceof HSLA) {
			this._hsla = arg;
			this.rgba = HSLA.toRGBA(arg);
		} else if (arg instanceof HSVA) {
			this._hsva = arg;
			this.rgba = HSVA.toRGBA(arg);
		} else {
			throw new Error('Invalid color ctor argument');
		}
	}

	equals(other: Color | null): boolean {
		return !!other && RGBA.equals(this.rgba, other.rgba) && HSLA.equals(this.hsla, other.hsla) && HSVA.equals(this.hsva, other.hsva);
	}

	/**
	 * http://www.w3.org/TR/WCAG20/#relativeluminancedef
	 * Returns the number in the set [0, 1]. O => Darkest Black. 1 => Lightest white.
	 */
	getRelativeLuminance(): number {
		const R = Color._relativeLuminanceForComponent(this.rgba.r);
		const G = Color._relativeLuminanceForComponent(this.rgba.g);
		const B = Color._relativeLuminanceForComponent(this.rgba.b);
		const luminance = 0.2126 * R + 0.7152 * G + 0.0722 * B;

		return roundFloat(luminance, 4);
	}

	private static _relativeLuminanceForComponent(color: number): number {
		const c = color / 255;
		return (c <= 0.03928) ? c / 12.92 : Math.pow(((c + 0.055) / 1.055), 2.4);
	}

	/**
	 * http://www.w3.org/TR/WCAG20/#contrast-ratiodef
	 * Returns the contrast ration number in the set [1, 21].
	 */
	getContrastRatio(another: Color): number {
		const lum1 = this.getRelativeLuminance();
		const lum2 = another.getRelativeLuminance();
		return lum1 > lum2 ? (lum1 + 0.05) / (lum2 + 0.05) : (lum2 + 0.05) / (lum1 + 0.05);
	}

	/**
	 *	http://24ways.org/2010/calculating-color-contrast
	 *  Return 'true' if darker color otherwise 'false'
	 */
	isDarker(): boolean {
		const yiq = (this.rgba.r * 299 + this.rgba.g * 587 + this.rgba.b * 114) / 1000;
		return yiq < 128;
	}

	/**
	 *	http://24ways.org/2010/calculating-color-contrast
	 *  Return 'true' if lighter color otherwise 'false'
	 */
	isLighter(): boolean {
		const yiq = (this.rgba.r * 299 + this.rgba.g * 587 + this.rgba.b * 114) / 1000;
		return yiq >= 128;
	}

	isLighterThan(another: Color): boolean {
		const lum1 = this.getRelativeLuminance();
		const lum2 = another.getRelativeLuminance();
		return lum1 > lum2;
	}

	isDarkerThan(another: Color): boolean {
		const lum1 = this.getRelativeLuminance();
		const lum2 = another.getRelativeLuminance();
		return lum1 < lum2;
	}

	lighten(factor: number): Color {
		return new Color(new HSLA(this.hsla.h, this.hsla.s, this.hsla.l + this.hsla.l * factor, this.hsla.a));
	}

	darken(factor: number): Color {
		return new Color(new HSLA(this.hsla.h, this.hsla.s, this.hsla.l - this.hsla.l * factor, this.hsla.a));
	}

	transparent(factor: number): Color {
		const { r, g, b, a } = this.rgba;
		return new Color(new RGBA(r, g, b, a * factor));
	}

	isTransparent(): boolean {
		return this.rgba.a === 0;
	}

	isOpaque(): boolean {
		return this.rgba.a === 1;
	}

	opposite(): Color {
		return new Color(new RGBA(255 - this.rgba.r, 255 - this.rgba.g, 255 - this.rgba.b, this.rgba.a));
	}

	blend(c: Color): Color {
		const rgba = c.rgba;

		// Convert to 0..1 opacity
		const thisA = this.rgba.a;
		const colorA = rgba.a;

		const a = thisA + colorA * (1 - thisA);
		if (a < 1e-6) {
			return Color.transparent;
		}

		const r = this.rgba.r * thisA / a + rgba.r * colorA * (1 - thisA) / a;
		const g = this.rgba.g * thisA / a + rgba.g * colorA * (1 - thisA) / a;
		const b = this.rgba.b * thisA / a + rgba.b * colorA * (1 - thisA) / a;

		return new Color(new RGBA(r, g, b, a));
	}

	makeOpaque(opaqueBackground: Color): Color {
		if (this.isOpaque() || opaqueBackground.rgba.a !== 1) {
			// only allow to blend onto a non-opaque color onto a opaque color
			return this;
		}

		const { r, g, b, a } = this.rgba;

		// https://stackoverflow.com/questions/12228548/finding-equivalent-color-with-opacity
		return new Color(new RGBA(
			opaqueBackground.rgba.r - a * (opaqueBackground.rgba.r - r),
			opaqueBackground.rgba.g - a * (opaqueBackground.rgba.g - g),
			opaqueBackground.rgba.b - a * (opaqueBackground.rgba.b - b),
			1
		));
	}

	flatten(...backgrounds: Color[]): Color {
		const background = backgrounds.reduceRight((accumulator, color) => {
			return Color._flatten(color, accumulator);
		});
		return Color._flatten(this, background);
	}

	private static _flatten(foreground: Color, background: Color) {
		const backgroundAlpha = 1 - foreground.rgba.a;
		return new Color(new RGBA(
			backgroundAlpha * background.rgba.r + foreground.rgba.a * foreground.rgba.r,
			backgroundAlpha * background.rgba.g + foreground.rgba.a * foreground.rgba.g,
			backgroundAlpha * background.rgba.b + foreground.rgba.a * foreground.rgba.b
		));
	}

	toString(): string {
		return '' + Color.Format.CSS.format(this);
	}

	static getLighterColor(of: Color, relative: Color, factor?: number): Color {
		if (of.isLighterThan(relative)) {
			return of;
		}
		factor = factor ? factor : 0.5;
		const lum1 = of.getRelativeLuminance();
		const lum2 = relative.getRelativeLuminance();
		factor = factor * (lum2 - lum1) / lum2;
		return of.lighten(factor);
	}

	static getDarkerColor(of: Color, relative: Color, factor?: number): Color {
		if (of.isDarkerThan(relative)) {
			return of;
		}
		factor = factor ? factor : 0.5;
		const lum1 = of.getRelativeLuminance();
		const lum2 = relative.getRelativeLuminance();
		factor = factor * (lum1 - lum2) / lum1;
		return of.darken(factor);
	}

	static readonly white = new Color(new RGBA(255, 255, 255, 1));
	static readonly black = new Color(new RGBA(0, 0, 0, 1));
	static readonly red = new Color(new RGBA(255, 0, 0, 1));
	static readonly blue = new Color(new RGBA(0, 0, 255, 1));
	static readonly green = new Color(new RGBA(0, 255, 0, 1));
	static readonly cyan = new Color(new RGBA(0, 255, 255, 1));
	static readonly lightgrey = new Color(new RGBA(211, 211, 211, 1));
	static readonly transparent = new Color(new RGBA(0, 0, 0, 0));
}

export namespace Color {
	export namespace Format {
		export namespace CSS {

			export function formatRGB(color: Color): string {
				if (color.rgba.a === 1) {
					return `rgb(${color.rgba.r}, ${color.rgba.g}, ${color.rgba.b})`;
				}

				return Color.Format.CSS.formatRGBA(color);
			}

			export function formatRGBA(color: Color): string {
				return `rgba(${color.rgba.r}, ${color.rgba.g}, ${color.rgba.b}, ${+(color.rgba.a).toFixed(2)})`;
			}

			export function formatHSL(color: Color): string {
				if (color.hsla.a === 1) {
					return `hsl(${color.hsla.h}, ${(color.hsla.s * 100).toFixed(2)}%, ${(color.hsla.l * 100).toFixed(2)}%)`;
				}

				return Color.Format.CSS.formatHSLA(color);
			}

			export function formatHSLA(color: Color): string {
				return `hsla(${color.hsla.h}, ${(color.hsla.s * 100).toFixed(2)}%, ${(color.hsla.l * 100).toFixed(2)}%, ${color.hsla.a.toFixed(2)})`;
			}

			function _toTwoDigitHex(n: number): string {
				const r = n.toString(16);
				return r.length !== 2 ? '0' + r : r;
			}

			/**
			 * Formats the color as #RRGGBB
			 */
			export function formatHex(color: Color): string {
				return `#${_toTwoDigitHex(color.rgba.r)}${_toTwoDigitHex(color.rgba.g)}${_toTwoDigitHex(color.rgba.b)}`;
			}

			/**
			 * Formats the color as #RRGGBBAA
			 * If 'compact' is set, colors without transparancy will be printed as #RRGGBB
			 */
			export function formatHexA(color: Color, compact = false): string {
				if (compact && color.rgba.a === 1) {
					return Color.Format.CSS.formatHex(color);
				}

				return `#${_toTwoDigitHex(color.rgba.r)}${_toTwoDigitHex(color.rgba.g)}${_toTwoDigitHex(color.rgba.b)}${_toTwoDigitHex(Math.round(color.rgba.a * 255))}`;
			}

			/**
			 * The default format will use HEX if opaque and RGBA otherwise.
			 */
			export function format(color: Color): string | null {
				if (color.isOpaque()) {
					return Color.Format.CSS.formatHex(color);
				}

				return Color.Format.CSS.formatRGBA(color);
			}

			/**
			 * Converts an Hex color value to a Color.
			 * returns r, g, and b are contained in the set [0, 255]
			 * @param hex string (#RGB, #RGBA, #RRGGBB or #RRGGBBAA).
			 */
			export function parseHex(hex: string): Color | null {
				const length = hex.length;

				if (length === 0) {
					// Invalid color
					return null;
				}

				if (hex.charCodeAt(0) !== CharCode.Hash) {
					// Does not begin with a #
					return null;
				}

				if (length === 7) {
					// #RRGGBB format
					const r = 16 * _parseHexDigit(hex.charCodeAt(1)) + _parseHexDigit(hex.charCodeAt(2));
					const g = 16 * _parseHexDigit(hex.charCodeAt(3)) + _parseHexDigit(hex.charCodeAt(4));
					const b = 16 * _parseHexDigit(hex.charCodeAt(5)) + _parseHexDigit(hex.charCodeAt(6));
					return new Color(new RGBA(r, g, b, 1));
				}

				if (length === 9) {
					// #RRGGBBAA format
					const r = 16 * _parseHexDigit(hex.charCodeAt(1)) + _parseHexDigit(hex.charCodeAt(2));
					const g = 16 * _parseHexDigit(hex.charCodeAt(3)) + _parseHexDigit(hex.charCodeAt(4));
					const b = 16 * _parseHexDigit(hex.charCodeAt(5)) + _parseHexDigit(hex.charCodeAt(6));
					const a = 16 * _parseHexDigit(hex.charCodeAt(7)) + _parseHexDigit(hex.charCodeAt(8));
					return new Color(new RGBA(r, g, b, a / 255));
				}

				if (length === 4) {
					// #RGB format
					const r = _parseHexDigit(hex.charCodeAt(1));
					const g = _parseHexDigit(hex.charCodeAt(2));
					const b = _parseHexDigit(hex.charCodeAt(3));
					return new Color(new RGBA(16 * r + r, 16 * g + g, 16 * b + b));
				}

				if (length === 5) {
					// #RGBA format
					const r = _parseHexDigit(hex.charCodeAt(1));
					const g = _parseHexDigit(hex.charCodeAt(2));
					const b = _parseHexDigit(hex.charCodeAt(3));
					const a = _parseHexDigit(hex.charCodeAt(4));
					return new Color(new RGBA(16 * r + r, 16 * g + g, 16 * b + b, (16 * a + a) / 255));
				}

				// Invalid color
				return null;
			}

			function _parseHexDigit(charCode: CharCode): number {
				switch (charCode) {
					case CharCode.Digit0: return 0;
					case CharCode.Digit1: return 1;
					case CharCode.Digit2: return 2;
					case CharCode.Digit3: return 3;
					case CharCode.Digit4: return 4;
					case CharCode.Digit5: return 5;
					case CharCode.Digit6: return 6;
					case CharCode.Digit7: return 7;
					case CharCode.Digit8: return 8;
					case CharCode.Digit9: return 9;
					case CharCode.a: return 10;
					case CharCode.A: return 10;
					case CharCode.b: return 11;
					case CharCode.B: return 11;
					case CharCode.c: return 12;
					case CharCode.C: return 12;
					case CharCode.d: return 13;
					case CharCode.D: return 13;
					case CharCode.e: return 14;
					case CharCode.E: return 14;
					case CharCode.f: return 15;
					case CharCode.F: return 15;
				}
				return 0;
			}
		}
	}
}
