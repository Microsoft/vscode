/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/base/common/platform';
import { EditorOptions, ValidatedEditorOptions, EditorOption } from 'vs/editor/common/config/editorOptions';
import { EditorZoom } from 'vs/editor/common/config/editorZoom';

/**
 * Determined from empirical observations.
 * @internal
 */
const GOLDEN_LINE_HEIGHT_RATIO = platform.isMacintosh ? 1.5 : 1.35;

/**
 * @internal
 */
const MINIMUM_LINE_HEIGHT = 8;

export class BareFontInfo {
	readonly _bareFontInfoBrand: void;

	/**
	 * @internal
	 */
	public static createFromValidatedSettings(options: ValidatedEditorOptions, zoomLevel: number, pixelRatio: number, ignoreEditorZoom: boolean): BareFontInfo {
		const fontFamily = options.get(EditorOption.fontFamily);
		const fontWeight = options.get(EditorOption.fontWeight);
		const fontSize = options.get(EditorOption.fontSize);
		const fontFeatureSettings = options.get(EditorOption.fontLigatures);
		const lineHeight = options.get(EditorOption.lineHeight);
		const letterSpacing = options.get(EditorOption.letterSpacing);
		return BareFontInfo._create(fontFamily, fontWeight, fontSize, fontFeatureSettings, lineHeight, letterSpacing, zoomLevel, pixelRatio, ignoreEditorZoom);
	}

	/**
	 * @internal
	 */
	public static createFromRawSettings(opts: { fontFamily?: string; fontWeight?: string; fontSize?: number; fontLigatures?: boolean | string; lineHeight?: number; letterSpacing?: number; }, zoomLevel: number, pixelRatio: number, ignoreEditorZoom: boolean = false): BareFontInfo {
		const fontFamily = EditorOptions.fontFamily.validate(opts.fontFamily);
		const fontWeight = EditorOptions.fontWeight.validate(opts.fontWeight);
		const fontSize = EditorOptions.fontSize.validate(opts.fontSize);
		const fontFeatureSettings = EditorOptions.fontLigatures2.validate(opts.fontLigatures);
		const lineHeight = EditorOptions.lineHeight.validate(opts.lineHeight);
		const letterSpacing = EditorOptions.letterSpacing.validate(opts.letterSpacing);
		return BareFontInfo._create(fontFamily, fontWeight, fontSize, fontFeatureSettings, lineHeight, letterSpacing, zoomLevel, pixelRatio, ignoreEditorZoom);
	}

	/**
	 * @internal
	 */
	private static _create(fontFamily: string, fontWeight: string, fontSize: number, fontFeatureSettings: string, lineHeight: number, letterSpacing: number, zoomLevel: number, pixelRatio: number, ignoreEditorZoom: boolean): BareFontInfo {
		if (lineHeight === 0) {
			lineHeight = Math.round(GOLDEN_LINE_HEIGHT_RATIO * fontSize);
		} else if (lineHeight < MINIMUM_LINE_HEIGHT) {
			lineHeight = MINIMUM_LINE_HEIGHT;
		}

		const editorZoomLevelMultiplier = 1 + (ignoreEditorZoom ? 0 : EditorZoom.getZoomLevel() * 0.1);
		fontSize *= editorZoomLevelMultiplier;
		lineHeight *= editorZoomLevelMultiplier;

		return new BareFontInfo({
			zoomLevel: zoomLevel,
			pixelRatio: pixelRatio,
			fontFamily: fontFamily,
			fontWeight: fontWeight,
			fontSize: fontSize,
			fontFeatureSettings: fontFeatureSettings,
			lineHeight: lineHeight,
			letterSpacing: letterSpacing
		});
	}

	readonly zoomLevel: number;
	readonly pixelRatio: number;
	readonly fontFamily: string;
	readonly fontWeight: string;
	readonly fontSize: number;
	readonly fontFeatureSettings: string;
	readonly lineHeight: number;
	readonly letterSpacing: number;

	/**
	 * @internal
	 */
	protected constructor(opts: {
		zoomLevel: number;
		pixelRatio: number;
		fontFamily: string;
		fontWeight: string;
		fontSize: number;
		fontFeatureSettings: string;
		lineHeight: number;
		letterSpacing: number;
	}) {
		this.zoomLevel = opts.zoomLevel;
		this.pixelRatio = opts.pixelRatio;
		this.fontFamily = String(opts.fontFamily);
		this.fontWeight = String(opts.fontWeight);
		this.fontSize = opts.fontSize;
		this.fontFeatureSettings = opts.fontFeatureSettings;
		this.lineHeight = opts.lineHeight | 0;
		this.letterSpacing = opts.letterSpacing;
	}

	/**
	 * @internal
	 */
	public getId(): string {
		return this.zoomLevel + '-' + this.pixelRatio + '-' + this.fontFamily + '-' + this.fontWeight + '-' + this.fontSize + '-' + this.fontFeatureSettings + '-' + this.lineHeight + '-' + this.letterSpacing;
	}

	/**
	 * @internal
	 */
	public getMassagedFontFamily(): string {
		return this.fontFamily
			// Replace \, with \002c
			.replace(/\\,/g, '\\002c')
			// Replace , in quotes with \002c
			.replace(/".*?,.*?[^\\]"|'.*?,.*?[^\\]'/g, match => match.replace(/,/g, '\\002c'))
			// Replace ", not \", in single quotes with \0022
			.replace(/'.*?".*?[^\\]'/g, match => match.replace(/(?<!\\)"/g, '\\0022'))
			// Replace \" with \0022
			.replace(/\\"/g, '\\0022')
			// Replace ', not \', in double quotes with \0027
			.replace(/".*?'.*?[^\\]"/g, match => match.replace(/(?<!\\)'/g, '\\0027'))
			// Replace \' with \0027
			.replace(/\\'/g, '\\0027')
			// Replace double quotes with single quotes so that rich text can be coped properly.
			.replace(/"/g, '\'')
			.split(/ *, */)
			.filter(name => name !== '')
			// Replace \002c with \,
			.map(name => name.replace('\\002c', '\\,'))
			// add a space if the next character is one of a-f, A-F, 0-9
			.map(name => name.replace(/\\002[27](?=[a-fA-F0-9])/g, '$& '))
			.map(name =>
				/'/.test(name) ? name :
					/\\\w+/.test(name) ? `'${name}'` :
						// Quotes are required around font-family names when they are not valid CSS identifiers.
						/[^\w\xa0-\uffff-]/ ? `'${name}'` : name
			)
			.join(', ');
	}
}

// change this whenever `FontInfo` members are changed
export const SERIALIZED_FONT_INFO_VERSION = 1;

export class FontInfo extends BareFontInfo {
	readonly _editorStylingBrand: void;

	readonly version: number = SERIALIZED_FONT_INFO_VERSION;
	readonly isTrusted: boolean;
	readonly isMonospace: boolean;
	readonly typicalHalfwidthCharacterWidth: number;
	readonly typicalFullwidthCharacterWidth: number;
	readonly canUseHalfwidthRightwardsArrow: boolean;
	readonly spaceWidth: number;
	readonly middotWidth: number;
	readonly wsmiddotWidth: number;
	readonly maxDigitWidth: number;

	/**
	 * @internal
	 */
	constructor(opts: {
		zoomLevel: number;
		pixelRatio: number;
		fontFamily: string;
		fontWeight: string;
		fontSize: number;
		fontFeatureSettings: string;
		lineHeight: number;
		letterSpacing: number;
		isMonospace: boolean;
		typicalHalfwidthCharacterWidth: number;
		typicalFullwidthCharacterWidth: number;
		canUseHalfwidthRightwardsArrow: boolean;
		spaceWidth: number;
		middotWidth: number;
		wsmiddotWidth: number;
		maxDigitWidth: number;
	}, isTrusted: boolean) {
		super(opts);
		this.isTrusted = isTrusted;
		this.isMonospace = opts.isMonospace;
		this.typicalHalfwidthCharacterWidth = opts.typicalHalfwidthCharacterWidth;
		this.typicalFullwidthCharacterWidth = opts.typicalFullwidthCharacterWidth;
		this.canUseHalfwidthRightwardsArrow = opts.canUseHalfwidthRightwardsArrow;
		this.spaceWidth = opts.spaceWidth;
		this.middotWidth = opts.middotWidth;
		this.wsmiddotWidth = opts.wsmiddotWidth;
		this.maxDigitWidth = opts.maxDigitWidth;
	}

	/**
	 * @internal
	 */
	public equals(other: FontInfo): boolean {
		return (
			this.fontFamily === other.fontFamily
			&& this.fontWeight === other.fontWeight
			&& this.fontSize === other.fontSize
			&& this.fontFeatureSettings === other.fontFeatureSettings
			&& this.lineHeight === other.lineHeight
			&& this.letterSpacing === other.letterSpacing
			&& this.typicalHalfwidthCharacterWidth === other.typicalHalfwidthCharacterWidth
			&& this.typicalFullwidthCharacterWidth === other.typicalFullwidthCharacterWidth
			&& this.canUseHalfwidthRightwardsArrow === other.canUseHalfwidthRightwardsArrow
			&& this.spaceWidth === other.spaceWidth
			&& this.middotWidth === other.middotWidth
			&& this.wsmiddotWidth === other.wsmiddotWidth
			&& this.maxDigitWidth === other.maxDigitWidth
		);
	}
}
