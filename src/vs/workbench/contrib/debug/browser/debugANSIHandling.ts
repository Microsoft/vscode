/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { RGBA, Color } from 'vs/base/common/color';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ansiColorIdentifiers } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';

/**
 * @param text The content to stylize.
 * @returns An {@link HTMLSpanElement} that contains the potentially stylized text.
 */
export function handleANSIOutput(text: string, linkDetector: LinkDetector, themeService: IThemeService, workspaceFolder: IWorkspaceFolder | undefined): HTMLSpanElement {

	const root: HTMLSpanElement = document.createElement('span');
	const textLength: number = text.length;

	let styleNames: string[] = [];
	let customFgColor: RGBA | undefined;
	let customBgColor: RGBA | undefined;
	let customUnderlineColor: RGBA | undefined;
	let colorsInverted: boolean = false;
	let currentPos: number = 0;
	let buffer: string = '';

	while (currentPos < textLength) {

		let sequenceFound: boolean = false;

		// Potentially an ANSI escape sequence.
		// See http://ascii-table.com/ansi-escape-sequences.php & https://en.wikipedia.org/wiki/ANSI_escape_code
		if (text.charCodeAt(currentPos) === 27 && text.charAt(currentPos + 1) === '[') {

			const startPos: number = currentPos;
			currentPos += 2; // Ignore 'Esc[' as it's in every sequence.

			let ansiSequence: string = '';

			while (currentPos < textLength) {
				const char: string = text.charAt(currentPos);
				ansiSequence += char;

				currentPos++;

				// Look for a known sequence terminating character.
				if (char.match(/^[ABCDHIJKfhmpsu]$/)) {
					sequenceFound = true;
					break;
				}

			}

			if (sequenceFound) {

				// Flush buffer with previous styles.
				appendStylizedStringToContainer(root, buffer, styleNames, linkDetector, workspaceFolder, customFgColor, customBgColor, customUnderlineColor);

				buffer = '';

				/*
				 * Certain ranges that are matched here do not contain real graphics rendition sequences. For
				 * the sake of having a simpler expression, they have been included anyway.
				 */
				if (ansiSequence.match(/^(?:[34][0-8]|9[0-7]|10[0-7]|[0-9]|2[1-5,7-9]|[34]9|5[8,9]|1[0-9])(?:;[349][0-7]|10[0-7]|[013]|[245]|[34]9)?(?:;[012]?[0-9]?[0-9])*;?m$/)) {

					const styleCodes: number[] = ansiSequence.slice(0, -1) // Remove final 'm' character.
						.split(';')										   // Separate style codes.
						.filter(elem => elem !== '')			           // Filter empty elems as '34;m' -> ['34', ''].
						.map(elem => parseInt(elem, 10));		           // Convert to numbers.

					if (styleCodes[0] === 38 || styleCodes[0] === 48 || styleCodes[0] === 58) {
						// Advanced color code - can't be combined with formatting codes like simple colors can
						// Ignores invalid colors and additional info beyond what is necessary
						const colorType = (styleCodes[0] === 38) ? 'foreground' : ((styleCodes[0] === 48) ? 'background' : 'underline');

						if (styleCodes[1] === 5) {
							set8BitColor(styleCodes, colorType);
						} else if (styleCodes[1] === 2) {
							set24BitColor(styleCodes, colorType);
						}
					} else {
						setBasicFormatters(styleCodes);
					}

				} else {
					// Unsupported sequence so simply hide it.
				}

			} else {
				currentPos = startPos;
			}
		}

		if (sequenceFound === false) {
			buffer += text.charAt(currentPos);
			currentPos++;
		}
	}

	// Flush remaining text buffer if not empty.
	if (buffer) {
		appendStylizedStringToContainer(root, buffer, styleNames, linkDetector, workspaceFolder, customFgColor, customBgColor, customUnderlineColor);
	}

	return root;

	/**
	 * Change the foreground or background color by clearing the current color
	 * and adding the new one.
	 * @param colorType If `'foreground'`, will change the foreground color, if
	 * 	`'background'`, will change the background color, and if `'underline'`
	 * will set the underline color.
	 * @param color Color to change to. If `undefined` or not provided,
	 * will clear current color without adding a new one.
	 */
	function changeColor(colorType: 'foreground' | 'background' | 'underline', color?: RGBA | undefined): void {
		if (colorType === 'foreground') {
			customFgColor = color;
		} else if (colorType === 'background') {
			customBgColor = color;
		} else if (colorType === 'underline') {
			customUnderlineColor = color;
		}
		styleNames = styleNames.filter(style => style !== `code-${colorType}-colored`);
		if (color !== undefined) {
			styleNames.push(`code-${colorType}-colored`);
		}
	}

	/**
	 * Swap foreground and background colors.  Used for color inversion.  Caller should check
	 * [] flag to make sure it is appropriate to turn ON or OFF (if it is already inverted don't call
	 */
	function reverseForegroundAndBackgroundColors(): void {
		let oldFgColor: RGBA | undefined;
		oldFgColor = customFgColor;
		changeColor('foreground', customBgColor);
		changeColor('background', oldFgColor);
	}

	/**
	 * Calculate and set basic ANSI formatting. Supports ON/OFF of bold, italic, underline,
	 * double underline,  crossed-out/strikethrough, overline, dim, blink, rapid blink,
	 * reverse/invert video, hidden, superscript, subscript and alternate font codes,
	 * clearing/resetting of foreground, background and underline colors,
	 * setting normal foreground and background colors, and bright foreground and
	 * background colors. Not to be used for codes containing advanced colors.
	 * Will ignore invalid codes.
	 * @param styleCodes Array of ANSI basic styling numbers, which will be
	 * applied in order. New colors and backgrounds clear old ones; new formatting
	 * does not.
	 * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#SGR }
	 */
	function setBasicFormatters(styleCodes: number[]): void {
		for (let code of styleCodes) {
			switch (code) {
				case 0: {  // reset (everything)
					styleNames = [];
					customFgColor = undefined;
					customBgColor = undefined;
					break;
				}
				case 1: { // bold
					styleNames = styleNames.filter(style => style !== `code-bold`);
					styleNames.push('code-bold');
					break;
				}
				case 2: { // dim
					styleNames = styleNames.filter(style => style !== `code-dim`);
					styleNames.push('code-dim');
					break;
				}
				case 3: { // italic
					styleNames = styleNames.filter(style => style !== `code-italic`);
					styleNames.push('code-italic');
					break;
				}
				case 4: { // underline
					styleNames = styleNames.filter(style => (style !== `code-underline` && style !== `code-double-underline`));
					styleNames.push('code-underline');
					break;
				}
				case 5: { // blink
					styleNames = styleNames.filter(style => style !== `code-blink`);
					styleNames.push('code-blink');
					break;
				}
				case 6: { // rapid blink
					styleNames = styleNames.filter(style => style !== `code-rapid-blink`);
					styleNames.push('code-rapid-blink');
					break;
				}
				case 7: { // invert foreground and background
					if (!colorsInverted) {
						colorsInverted = true;
						reverseForegroundAndBackgroundColors();
					}
					break;
				}
				case 8: { // hidden
					styleNames = styleNames.filter(style => style !== `code-hidden`);
					styleNames.push('code-hidden');
					break;
				}
				case 9: { // strike-through/crossed-out
					styleNames = styleNames.filter(style => style !== `code-strike-through`);
					styleNames.push('code-strike-through');
					break;
				}
				case 10: { // normal default font
					styleNames = styleNames.filter(style => !style.startsWith('code-font'));
					break;
				}
				case 11: case 12: case 13: case 14: case 15: case 16: case 17: case 18: case 19: case 20: { // font codes (and 20 is 'blackletter' font code)
					styleNames = styleNames.filter(style => !style.startsWith('code-font'));
					styleNames.push(`code-font-${code - 10}`);
					break;
				}
				case 21: { // double underline
					styleNames = styleNames.filter(style => (style !== `code-underline` && style !== `code-double-underline`));
					styleNames.push('code-double-underline');
					break;
				}
				case 22: { // normal intensity (bold off and dim off)
					styleNames = styleNames.filter(style => (style !== `code-bold` && style !== `code-dim`));
					break;
				}
				case 23: { // Neither italic or blackletter (font 10)
					styleNames = styleNames.filter(style => (style !== `code-italic` && style !== `code-font-10`));
					break;
				}
				case 24: { // not underlined (Neither singly nor doubly underlined)
					styleNames = styleNames.filter(style => (style !== `code-underline` && style !== `code-double-underline`));
					break;
				}
				case 25: { // not blinking
					styleNames = styleNames.filter(style => (style !== `code-blink` && style !== `code-rapid-blink`));
					break;
				}
				case 27: { // not reversed/inverted
					if (colorsInverted) {
						colorsInverted = false;
						reverseForegroundAndBackgroundColors();
					}
					break;
				}
				case 28: { // not hidden (reveal)
					styleNames = styleNames.filter(style => style !== `code-hidden`);
					break;
				}
				case 29: { // not crossed-out
					styleNames = styleNames.filter(style => style !== `code-strike-through`);
					break;
				}
				case 53: { // overlined
					styleNames = styleNames.filter(style => style !== `code-overline`);
					styleNames.push('code-overline');
					break;
				}
				case 55: { // not overlined
					styleNames = styleNames.filter(style => style !== `code-overline`);
					break;
				}
				case 39: {  // default foreground color
					changeColor('foreground', undefined);
					break;
				}
				case 49: {  // default background color
					changeColor('background', undefined);
					break;
				}
				case 59: {  // default underline color
					changeColor('underline', undefined);
					break;
				}
				case 73: { // superscript
					styleNames = styleNames.filter(style => (style !== `code-superscript` && style !== `code-subscript`));
					styleNames.push('code-superscript');
					break;
				}
				case 74: { // subscript
					styleNames = styleNames.filter(style => (style !== `code-superscript` && style !== `code-subscript`));
					styleNames.push('code-subscript');
					break;
				}
				case 75: { // neither superscript or subscript
					styleNames = styleNames.filter(style => (style !== `code-superscript` && style !== `code-subscript`));
					break;
				}
				default: {
					setBasicColor(code);
					break;
				}
			}
		}
	}

	/**
	 * Calculate and set styling for complicated 24-bit ANSI color codes.
	 * @param styleCodes Full list of integer codes that make up the full ANSI
	 * sequence, including the two defining codes and the three RGB codes.
	 * @param colorType If `'foreground'`, will set foreground color, if
	 * `'background'`, will set background color, and if it is `'underline'`
	 * will set the underline color.
	 * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#24-bit }
	 */
	function set24BitColor(styleCodes: number[], colorType: 'foreground' | 'background' | 'underline'): void {
		if (styleCodes.length >= 5 &&
			styleCodes[2] >= 0 && styleCodes[2] <= 255 &&
			styleCodes[3] >= 0 && styleCodes[3] <= 255 &&
			styleCodes[4] >= 0 && styleCodes[4] <= 255) {
			const customColor = new RGBA(styleCodes[2], styleCodes[3], styleCodes[4]);
			changeColor(colorType, customColor);
		}
	}

	/**
	 * Calculate and set styling for advanced 8-bit ANSI color codes.
	 * @param styleCodes Full list of integer codes that make up the ANSI
	 * sequence, including the two defining codes and the one color code.
	 * @param colorType If `'foreground'`, will set foreground color, if
	 * `'background'`, will set background color and if it is `'underline'`
	 * will set the underline color.
	 * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit }
	 */
	function set8BitColor(styleCodes: number[], colorType: 'foreground' | 'background' | 'underline'): void {
		let colorNumber = styleCodes[2];
		const color = calcANSI8bitColor(colorNumber);

		if (color) {
			changeColor(colorType, color);
		} else if (colorNumber >= 0 && colorNumber <= 15) {
			if (colorType === 'underline') {
				// for underline colors we just decode the 0-15 color number to theme color, set and return
				const theme = themeService.getColorTheme();
				const colorName = ansiColorIdentifiers[colorNumber];
				const color = theme.getColor(colorName);
				if (color) {
					changeColor(colorType, color.rgba);
				}
				return;
			}
			// Need to map to one of the four basic color ranges (30-37, 90-97, 40-47, 100-107)
			colorNumber += 30;
			if (colorNumber >= 38) {
				// Bright colors
				colorNumber += 52;
			}
			if (colorType === 'background') {
				colorNumber += 10;
			}
			setBasicColor(colorNumber);
		}
	}

	/**
	 * Calculate and set styling for basic bright and dark ANSI color codes. Uses
	 * theme colors if available. Automatically distinguishes between foreground
	 * and background colors; does not support color-clearing codes 39 and 49.
	 * @param styleCode Integer color code on one of the following ranges:
	 * [30-37, 90-97, 40-47, 100-107]. If not on one of these ranges, will do
	 * nothing.
	 */
	function setBasicColor(styleCode: number): void {
		const theme = themeService.getColorTheme();
		let colorType: 'foreground' | 'background' | undefined;
		let colorIndex: number | undefined;

		if (styleCode >= 30 && styleCode <= 37) {
			colorIndex = styleCode - 30;
			colorType = 'foreground';
		} else if (styleCode >= 90 && styleCode <= 97) {
			colorIndex = (styleCode - 90) + 8; // High-intensity (bright)
			colorType = 'foreground';
		} else if (styleCode >= 40 && styleCode <= 47) {
			colorIndex = styleCode - 40;
			colorType = 'background';
		} else if (styleCode >= 100 && styleCode <= 107) {
			colorIndex = (styleCode - 100) + 8; // High-intensity (bright)
			colorType = 'background';
		}

		if (colorIndex !== undefined && colorType) {
			const colorName = ansiColorIdentifiers[colorIndex];
			const color = theme.getColor(colorName);
			if (color) {
				changeColor(colorType, color.rgba);
			}
		}
	}
}

/**
 * @param root The {@link HTMLElement} to append the content to.
 * @param stringContent The text content to be appended.
 * @param cssClasses The list of CSS styles to apply to the text content.
 * @param linkDetector The {@link LinkDetector} responsible for generating links from {@param stringContent}.
 * @param customTextColor If provided, will apply custom color with inline style.
 * @param customBackgroundColor If provided, will apply custom backgroundColor with inline style.
 * @param customUnderlineColor If provided, will apply custom textDecorationColor with inline style.
 */
export function appendStylizedStringToContainer(
	root: HTMLElement,
	stringContent: string,
	cssClasses: string[],
	linkDetector: LinkDetector,
	workspaceFolder: IWorkspaceFolder | undefined,
	customTextColor?: RGBA,
	customBackgroundColor?: RGBA,
	customUnderlineColor?: RGBA
): void {
	if (!root || !stringContent) {
		return;
	}

	const container = linkDetector.linkify(stringContent, true, workspaceFolder);

	container.className = cssClasses.join(' ');
	if (customTextColor) {
		container.style.color =
			Color.Format.CSS.formatRGB(new Color(customTextColor));
	}
	if (customBackgroundColor) {
		container.style.backgroundColor =
			Color.Format.CSS.formatRGB(new Color(customBackgroundColor));
	}
	if (customUnderlineColor) {
		container.style.textDecorationColor =
			Color.Format.CSS.formatRGB(new Color(customUnderlineColor));
	}
	root.appendChild(container);
}

/**
 * Calculate the color from the color set defined in the ANSI 8-bit standard.
 * Standard and high intensity colors are not defined in the standard as specific
 * colors, so these and invalid colors return `undefined`.
 * @see {@link https://en.wikipedia.org/wiki/ANSI_escape_code#8-bit } for info.
 * @param colorNumber The number (ranging from 16 to 255) referring to the color
 * desired.
 */
export function calcANSI8bitColor(colorNumber: number): RGBA | undefined {
	if (colorNumber % 1 !== 0) {
		// Should be integer
		return;
	} if (colorNumber >= 16 && colorNumber <= 231) {
		// Converts to one of 216 RGB colors
		colorNumber -= 16;

		let blue: number = colorNumber % 6;
		colorNumber = (colorNumber - blue) / 6;
		let green: number = colorNumber % 6;
		colorNumber = (colorNumber - green) / 6;
		let red: number = colorNumber;

		// red, green, blue now range on [0, 5], need to map to [0,255]
		const convFactor: number = 255 / 5;
		blue = Math.round(blue * convFactor);
		green = Math.round(green * convFactor);
		red = Math.round(red * convFactor);

		return new RGBA(red, green, blue);
	} else if (colorNumber >= 232 && colorNumber <= 255) {
		// Converts to a grayscale value
		colorNumber -= 232;
		const colorLevel: number = Math.round(colorNumber / 23 * 255);
		return new RGBA(colorLevel, colorLevel, colorLevel);
	} else {
		return;
	}
}
