/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const enum Constants {
	START_CH_CODE = 32, // Space
	END_CH_CODE = 126, // Tilde (~)
	UNKNOWN_CODE = 65533, // UTF placeholder code
	CHAR_COUNT = END_CH_CODE - START_CH_CODE + 2,

	SAMPLED_CHAR_HEIGHT = 16,
	SAMPLED_CHAR_WIDTH = 10,

	BASE_CHAR_HEIGHT = 2,
	BASE_CHAR_WIDTH = 1,

	RGBA_CHANNELS_CNT = 4,
	RGBA_SAMPLED_ROW_WIDTH = RGBA_CHANNELS_CNT * CHAR_COUNT * SAMPLED_CHAR_WIDTH
}

export const allCharCodes: ReadonlyArray<number> = (() => {
	const v: number[] = [];
	for (let i = Constants.START_CH_CODE; i <= Constants.END_CH_CODE; i++) {
		v.push(i);
	}

	v.push(Constants.UNKNOWN_CODE);
	return v;
})();

export const getCharIndex = (chCode: number, fontScale: number) => {
	chCode -= Constants.START_CH_CODE;
	if (chCode < 0 || chCode > Constants.CHAR_COUNT) {
		if (fontScale <= 2) {
			// for smaller scales, we can get away with using any ASCII character...
			return (chCode + Constants.CHAR_COUNT) % Constants.CHAR_COUNT;
		}
		return Constants.CHAR_COUNT - 1; // unknown symbol
	}

	return chCode;
};
