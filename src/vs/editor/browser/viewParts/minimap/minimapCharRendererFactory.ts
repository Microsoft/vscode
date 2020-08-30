/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MinimapCharRenderer } from 'vs/editor/browser/viewParts/minimap/minimapCharRenderer';
import { allCharCodes } from 'vs/editor/browser/viewParts/minimap/minimapCharSheet';
import { prebakedMiniMaps } from 'vs/editor/browser/viewParts/minimap/minimapPreBaked';
import { Constants } from './minimapCharSheet';
import { toUint8 } from 'vs/base/common/uint';

/**
 * Creates character renderers. It takes a 'scale' that determines how large
 * characters should be drawn. Using this, it draws data into a canvas and
 * then downsamples the characters as necessary for the current display.
 * This makes rendering more efficient, rather than drawing a full (tiny)
 * font, or downsampling in real-time.
 */
export class MinimapCharRendererFactory {
	private static lastCreated?: MinimapCharRenderer;
	private static lastFontFamily?: string;

	/**
	 * Creates a new character renderer factory with the given scale.
	 */
	public static create(scale: number, fontFamily: string) {
		// renderers are immutable. By default we'll 'create' a new minimap
		// character renderer whenever we switch editors, no need to do extra work.
		if (this.lastCreated && scale === this.lastCreated.scale && fontFamily === this.lastFontFamily) {
			return this.lastCreated;
		}

		let factory: MinimapCharRenderer;
		if (prebakedMiniMaps[scale]) {
			factory = new MinimapCharRenderer(prebakedMiniMaps[scale](), scale);
		} else {
			factory = MinimapCharRendererFactory.createFromSampleData(
				MinimapCharRendererFactory.createSampleData(fontFamily).data,
				scale
			);
		}

		this.lastFontFamily = fontFamily;
		this.lastCreated = factory;
		return factory;
	}

	/**
	 * Creates the font sample data, writing to a canvas.
	 */
	public static createSampleData(fontFamily: string): ImageData {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;

		canvas.style.height = `${Constants.SAMPLED_CHAR_HEIGHT}px`;
		canvas.height = Constants.SAMPLED_CHAR_HEIGHT;
		canvas.width = Constants.CHAR_COUNT * Constants.SAMPLED_CHAR_WIDTH;
		canvas.style.width = Constants.CHAR_COUNT * Constants.SAMPLED_CHAR_WIDTH + 'px';

		ctx.fillStyle = '#ffffff';
		ctx.font = `bold ${Constants.SAMPLED_CHAR_HEIGHT}px ${fontFamily}`;
		ctx.textBaseline = 'middle';

		let x = 0;
		for (const code of allCharCodes) {
			ctx.fillText(String.fromCharCode(code), x, Constants.SAMPLED_CHAR_HEIGHT / 2);
			x += Constants.SAMPLED_CHAR_WIDTH;
		}

		return ctx.getImageData(0, 0, Constants.CHAR_COUNT * Constants.SAMPLED_CHAR_WIDTH, Constants.SAMPLED_CHAR_HEIGHT);
	}

	/**
	 * Creates a character renderer from the canvas sample data.
	 */
	public static createFromSampleData(source: Uint8ClampedArray, scale: number): MinimapCharRenderer {
		const expectedLength =
			Constants.SAMPLED_CHAR_HEIGHT * Constants.SAMPLED_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT * Constants.CHAR_COUNT;
		if (source.length !== expectedLength) {
			throw new Error('Unexpected source in MinimapCharRenderer');
		}

		let charData = MinimapCharRendererFactory._downsample(source, scale);
		return new MinimapCharRenderer(charData, scale);
	}

	private static _downsampleChar(
		source: Uint8ClampedArray,
		sourceOffset: number,
		dest: Uint8ClampedArray,
		destOffset: number,
		scale: number
	): number {
		const width = Constants.BASE_CHAR_WIDTH * scale;
		const height = Constants.BASE_CHAR_HEIGHT * scale;

		let targetIndex = destOffset;
		let brightest = 0;

		// This is essentially an ad-hoc rescaling algorithm. Standard approaches
		// like bicubic interpolation are awesome for scaling between image sizes,
		// but don't work so well when scaling to very small pixel values, we end
		// up with blurry, indistinct forms.
		//
		// The approach taken here is simply mapping each source pixel to the target
		// pixels, and taking the weighted values for all pixels in each, and then
		// averaging them out. Finally we apply an intensity boost in _downsample,
		// since when scaling to the smallest pixel sizes there's more black space
		// which causes characters to be much less distinct.
		for (let y = 0; y < height; y++) {
			// 1. For this destination pixel, get the source pixels we're sampling
			// from (x1, y1) to the next pixel (x2, y2)
			const sourceY1 = (y / height) * Constants.SAMPLED_CHAR_HEIGHT;
			const sourceY2 = ((y + 1) / height) * Constants.SAMPLED_CHAR_HEIGHT;

			for (let x = 0; x < width; x++) {
				const sourceX1 = (x / width) * Constants.SAMPLED_CHAR_WIDTH;
				const sourceX2 = ((x + 1) / width) * Constants.SAMPLED_CHAR_WIDTH;

				// 2. Sample all of them, summing them up and weighting them. Similar
				// to bilinear interpolation.
				let value = 0;
				let samples = 0;
				for (let sy = sourceY1; sy < sourceY2; sy++) {
					const sourceRow = sourceOffset + Math.floor(sy) * Constants.RGBA_SAMPLED_ROW_WIDTH;
					const yBalance = 1 - (sy - Math.floor(sy));
					for (let sx = sourceX1; sx < sourceX2; sx++) {
						const xBalance = 1 - (sx - Math.floor(sx));
						const sourceIndex = sourceRow + Math.floor(sx) * Constants.RGBA_CHANNELS_CNT;

						const weight = xBalance * yBalance;
						samples += weight;
						value += ((source[sourceIndex] * source[sourceIndex + 3]) / 255) * weight;
					}
				}

				const final = value / samples;
				brightest = Math.max(brightest, final);
				dest[targetIndex++] = toUint8(final);
			}
		}

		return brightest;
	}

	private static _downsample(data: Uint8ClampedArray, scale: number): Uint8ClampedArray {
		const pixelsPerCharacter = Constants.BASE_CHAR_HEIGHT * scale * Constants.BASE_CHAR_WIDTH * scale;
		const resultLen = pixelsPerCharacter * Constants.CHAR_COUNT;
		const result = new Uint8ClampedArray(resultLen);

		let resultOffset = 0;
		let sourceOffset = 0;
		let brightest = 0;
		for (let charIndex = 0; charIndex < Constants.CHAR_COUNT; charIndex++) {
			brightest = Math.max(brightest, this._downsampleChar(data, sourceOffset, result, resultOffset, scale));
			resultOffset += pixelsPerCharacter;
			sourceOffset += Constants.SAMPLED_CHAR_WIDTH * Constants.RGBA_CHANNELS_CNT;
		}

		if (brightest > 0) {
			const adjust = 255 / brightest;
			for (let i = 0; i < resultLen; i++) {
				result[i] *= adjust;
			}
		}

		return result;
	}
}
