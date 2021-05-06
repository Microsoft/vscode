/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { generateUuid } from 'vs/base/common/uuid';
import { appendStylizedStringToContainer, handleANSIOutput, calcANSI8bitColor } from 'vs/workbench/contrib/debug/browser/debugANSIHandling';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { Color, RGBA } from 'vs/base/common/color';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService, TestColorTheme } from 'vs/platform/theme/test/common/testThemeService';
import { ansiColorMap } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { DebugModel } from 'vs/workbench/contrib/debug/common/debugModel';
import { DebugSession } from 'vs/workbench/contrib/debug/browser/debugSession';
import { createMockDebugModel } from 'vs/workbench/contrib/debug/test/browser/mockDebug';
import { createMockSession } from 'vs/workbench/contrib/debug/test/browser/callStack.test';

suite('Debug - ANSI Handling', () => {

	let model: DebugModel;
	let session: DebugSession;
	let linkDetector: LinkDetector;
	let themeService: IThemeService;

	/**
	 * Instantiate services for use by the functions being tested.
	 */
	setup(() => {
		model = createMockDebugModel();
		session = createMockSession(model);

		const instantiationService: TestInstantiationService = <TestInstantiationService>workbenchInstantiationService();
		linkDetector = instantiationService.createInstance(LinkDetector);

		const colors: { [id: string]: string; } = {};
		for (let color in ansiColorMap) {
			colors[color] = <any>ansiColorMap[color].defaults.dark;
		}
		const testTheme = new TestColorTheme(colors);
		themeService = new TestThemeService(testTheme);
	});

	test('appendStylizedStringToContainer', () => {
		const root: HTMLSpanElement = document.createElement('span');
		let child: Node;

		assert.strictEqual(0, root.children.length);

		appendStylizedStringToContainer(root, 'content1', ['class1', 'class2'], linkDetector, session.root);
		appendStylizedStringToContainer(root, 'content2', ['class2', 'class3'], linkDetector, session.root);

		assert.strictEqual(2, root.children.length);

		child = root.firstChild!;
		if (child instanceof HTMLSpanElement) {
			assert.strictEqual('content1', child.textContent);
			assert(child.classList.contains('class1'));
			assert(child.classList.contains('class2'));
		} else {
			assert.fail('Unexpected assertion error');
		}

		child = root.lastChild!;
		if (child instanceof HTMLSpanElement) {
			assert.strictEqual('content2', child.textContent);
			assert(child.classList.contains('class2'));
			assert(child.classList.contains('class3'));
		} else {
			assert.fail('Unexpected assertion error');
		}
	});

	/**
	 * Apply an ANSI sequence to {@link #getSequenceOutput}.
	 *
	 * @param sequence The ANSI sequence to stylize.
	 * @returns An {@link HTMLSpanElement} that contains the stylized text.
	 */
	function getSequenceOutput(sequence: string): HTMLSpanElement {
		const root: HTMLSpanElement = handleANSIOutput(sequence, linkDetector, themeService, session.root);
		assert.strictEqual(1, root.children.length);
		const child: Node = root.lastChild!;
		if (child instanceof HTMLSpanElement) {
			return child;
		} else {
			assert.fail('Unexpected assertion error');
		}
	}

	/**
	 * Assert that a given ANSI sequence maintains added content following the ANSI code, and that
	 * the provided {@param assertion} passes.
	 *
	 * @param sequence The ANSI sequence to verify. The provided sequence should contain ANSI codes
	 * only, and should not include actual text content as it is provided by this function.
	 * @param assertion The function used to verify the output.
	 */
	function assertSingleSequenceElement(sequence: string, assertion: (child: HTMLSpanElement) => void): void {
		const child: HTMLSpanElement = getSequenceOutput(sequence + 'content');
		assert.strictEqual('content', child.textContent);
		assertion(child);
	}

	/**
	 * Assert that a given DOM element has the custom inline CSS style matching
	 * the color value provided.
	 * @param element The HTML span element to look at.
	 * @param colorType If `foreground`, will check the element's css `color`;
	 * if `background`, will check the element's css `backgroundColor`.
	 * if `underline`, will check the elements css `textDecorationColor`.
	 * @param color RGBA object to compare color to. If `undefined` or not provided,
	 * will assert that no value is set.
	 * @param message Optional custom message to pass to assertion.
	 * @param colorShouldMatch Optional flag (defaults TO true) which allows caller to indicate that the color SHOULD NOT MATCH
	 * (for testing changes to theme colors where we need color to have changed but we don't know exact color it should have
	 * changed to (but we do know the color it should NO LONGER BE))
	 */
	function assertInlineColor(element: HTMLSpanElement, colorType: 'background' | 'foreground' | 'underline', color?: RGBA | undefined, message?: string, colorShouldMatch: boolean = true): void {
		if (color !== undefined) {
			const cssColor = Color.Format.CSS.formatRGB(
				new Color(color)
			);
			if (colorType === 'background') {
				const styleBefore = element.style.backgroundColor;
				element.style.backgroundColor = cssColor;
				assert((styleBefore === element.style.backgroundColor) === colorShouldMatch, message || `Incorrect ${colorType} color style found (found color: ${styleBefore}, expected ${cssColor}).`);
			} else if (colorType === 'foreground') {
				const styleBefore = element.style.color;
				element.style.color = cssColor;
				assert((styleBefore === element.style.color) === colorShouldMatch, message || `Incorrect ${colorType} color style found (found color: ${styleBefore}, expected ${cssColor}).`);
			} else {
				const styleBefore = element.style.textDecorationColor;
				element.style.textDecorationColor = cssColor;
				assert((styleBefore === element.style.textDecorationColor) === colorShouldMatch, message || `Incorrect ${colorType} color style found (found color: ${styleBefore}, expected ${cssColor}).`);
			}
		} else {
			if (colorType === 'background') {
				assert(!element.style.backgroundColor, message || `Defined ${colorType} color style found when it should not have been defined`);
			} else if (colorType === 'foreground') {
				assert(!element.style.color, message || `Defined ${colorType} color style found when it should not have been defined`);
			} else {
				assert(!element.style.textDecorationColor, message || `Defined ${colorType} color style found when it should not have been defined`);
			}
		}

	}

	test('Expected single sequence operation', () => {

		// Bold code
		assertSingleSequenceElement('\x1b[1m', (child) => {
			assert(child.classList.contains('code-bold'), 'Bold formatting not detected after bold ANSI code.');
		});

		// Italic code
		assertSingleSequenceElement('\x1b[3m', (child) => {
			assert(child.classList.contains('code-italic'), 'Italic formatting not detected after italic ANSI code.');
		});

		// Underline code
		assertSingleSequenceElement('\x1b[4m', (child) => {
			assert(child.classList.contains('code-underline'), 'Underline formatting not detected after underline ANSI code.');
		});

		for (let i = 30; i <= 37; i++) {
			const customClassName: string = 'code-foreground-colored';

			// Foreground colour class
			assertSingleSequenceElement('\x1b[' + i + 'm', (child) => {
				assert(child.classList.contains(customClassName), `Custom foreground class not found on element after foreground ANSI code #${i}.`);
			});

			// Cancellation code removes colour class
			assertSingleSequenceElement('\x1b[' + i + ';39m', (child) => {
				assert(child.classList.contains(customClassName) === false, 'Custom foreground class still found after foreground cancellation code.');
				assertInlineColor(child, 'foreground', undefined, 'Custom color style still found after foreground cancellation code.');
			});
		}

		for (let i = 40; i <= 47; i++) {
			const customClassName: string = 'code-background-colored';

			// Foreground colour class
			assertSingleSequenceElement('\x1b[' + i + 'm', (child) => {
				assert(child.classList.contains(customClassName), `Custom background class not found on element after background ANSI code #${i}.`);
			});

			// Cancellation code removes colour class
			assertSingleSequenceElement('\x1b[' + i + ';49m', (child) => {
				assert(child.classList.contains(customClassName) === false, 'Custom background class still found after background cancellation code.');
				assertInlineColor(child, 'foreground', undefined, 'Custom color style still found after background cancellation code.');
			});
		}

		// check all basic colors for underlines (full range is checked elsewhere, here we check cancelation)
		for (let i = 0; i <= 255; i++) {
			const customClassName: string = 'code-underline-colored';

			// Underline colour class
			assertSingleSequenceElement('\x1b[58;5;' + i + 'm', (child) => {
				assert(child.classList.contains(customClassName), `Custom underline color class not found on element after underline color ANSI code 58;5;${i}m.`);
			});

			// Cancellation underline color code removes colour class
			assertSingleSequenceElement('\x1b[58;5;' + i + 'm\x1b[59m', (child) => {
				assert(child.classList.contains(customClassName) === false, 'Custom underline color class still found after underline color cancellation code 59m.');
				assertInlineColor(child, 'underline', undefined, 'Custom underline color style still found after underline color cancellation code 59m.');
			});
		}

		// Different codes do not cancel each other
		assertSingleSequenceElement('\x1b[1;3;4;30;41m', (child) => {
			assert.strictEqual(5, child.classList.length, 'Incorrect number of classes found for different ANSI codes.');

			assert(child.classList.contains('code-bold'));
			assert(child.classList.contains('code-italic'), 'Different ANSI codes should not cancel each other.');
			assert(child.classList.contains('code-underline'), 'Different ANSI codes should not cancel each other.');
			assert(child.classList.contains('code-foreground-colored'), 'Different ANSI codes should not cancel each other.');
			assert(child.classList.contains('code-background-colored'), 'Different ANSI codes should not cancel each other.');
		});

		// Different codes do not ACCUMULATE more than one copy of each class
		assertSingleSequenceElement('\x1b[1;1;2;2;3;3;4;4;5;5;6;6;8;8;9;9;21;21;53;53;73;73;74;74m', (child) => {
			assert(child.classList.contains('code-bold'));
			assert(child.classList.contains('code-italic'), 'italic missing Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-underline') === false, 'underline PRESENT and double underline should have removed it- Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-dim'), 'dim missing Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-blink'), 'blink missing Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-rapid-blink'), 'rapid blink mkssing Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-double-underline'), 'double underline missing Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-hidden'), 'hidden missing Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-strike-through'), 'strike-through missing Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-overline'), 'overline missing Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-superscript') === false, 'superscript PRESENT and subscript should have removed it- Doubles of each Different ANSI codes should not cancel each other or accumulate.');
			assert(child.classList.contains('code-subscript'), 'subscript missing Doubles of each Different ANSI codes should not cancel each other or accumulate.');

			assert.strictEqual(10, child.classList.length, 'Incorrect number of classes found for each style code sent twice ANSI codes.');
		});



		// More Different codes do not cancel each other
		assertSingleSequenceElement('\x1b[1;2;5;6;21;8;9m', (child) => {
			assert.strictEqual(7, child.classList.length, 'Incorrect number of classes found for different ANSI codes.');

			assert(child.classList.contains('code-bold'));
			assert(child.classList.contains('code-dim'), 'Different ANSI codes should not cancel each other.');
			assert(child.classList.contains('code-blink'), 'Different ANSI codes should not cancel each other.');
			assert(child.classList.contains('code-rapid-blink'), 'Different ANSI codes should not cancel each other.');
			assert(child.classList.contains('code-double-underline'), 'Different ANSI codes should not cancel each other.');
			assert(child.classList.contains('code-hidden'), 'Different ANSI codes should not cancel each other.');
			assert(child.classList.contains('code-strike-through'), 'Different ANSI codes should not cancel each other.');
		});



		// New foreground codes don't remove old background codes and vice versa
		assertSingleSequenceElement('\x1b[40;31;42;33m', (child) => {
			assert.strictEqual(2, child.classList.length);

			assert(child.classList.contains('code-background-colored'), 'New foreground ANSI code should not cancel existing background formatting.');
			assert(child.classList.contains('code-foreground-colored'), 'New background ANSI code should not cancel existing foreground formatting.');
		});

		// Duplicate codes do not change output
		assertSingleSequenceElement('\x1b[1;1;4;1;4;4;1;4m', (child) => {
			assert(child.classList.contains('code-bold'), 'Duplicate formatting codes should have no effect.');
			assert(child.classList.contains('code-underline'), 'Duplicate formatting codes should have no effect.');
		});

		// Extra terminating semicolon does not change output
		assertSingleSequenceElement('\x1b[1;4;m', (child) => {
			assert(child.classList.contains('code-bold'), 'Extra semicolon after ANSI codes should have no effect.');
			assert(child.classList.contains('code-underline'), 'Extra semicolon after ANSI codes should have no effect.');
		});

		// Cancellation code removes multiple codes
		assertSingleSequenceElement('\x1b[1;4;30;41;32;43;34;45;36;47;0m', (child) => {
			assert.strictEqual(0, child.classList.length, 'Cancellation ANSI code should clear ALL formatting.');
			assertInlineColor(child, 'background', undefined, 'Cancellation ANSI code should clear ALL formatting.');
			assertInlineColor(child, 'foreground', undefined, 'Cancellation ANSI code should clear ALL formatting.');
		});

	});

	test('Expected single 8-bit color sequence operation', () => {
		// Basic and bright color codes specified with 8-bit color code format
		for (let i = 0; i <= 15; i++) {
			// As these are controlled by theme, difficult to check actual color value
			// Foreground codes should add standard classes
			assertSingleSequenceElement('\x1b[38;5;' + i + 'm', (child) => {
				assert(child.classList.contains('code-foreground-colored'), `Custom color class not found after foreground 8-bit color code 38;5;${i}`);
			});

			// Background codes should add standard classes
			assertSingleSequenceElement('\x1b[48;5;' + i + 'm', (child) => {
				assert(child.classList.contains('code-background-colored'), `Custom color class not found after background 8-bit color code 48;5;${i}`);
			});
		}

		// 8-bit advanced colors
		for (let i = 16; i <= 255; i++) {
			// Foreground codes should add custom class and inline style
			assertSingleSequenceElement('\x1b[38;5;' + i + 'm', (child) => {
				assert(child.classList.contains('code-foreground-colored'), `Custom color class not found after foreground 8-bit color code 38;5;${i}`);
				assertInlineColor(child, 'foreground', (calcANSI8bitColor(i) as RGBA), `Incorrect or no color styling found after foreground 8-bit color code 38;5;${i}`);
			});

			// Background codes should add custom class and inline style
			assertSingleSequenceElement('\x1b[48;5;' + i + 'm', (child) => {
				assert(child.classList.contains('code-background-colored'), `Custom color class not found after background 8-bit color code 48;5;${i}`);
				assertInlineColor(child, 'background', (calcANSI8bitColor(i) as RGBA), `Incorrect or no color styling found after background 8-bit color code 48;5;${i}`);
			});

			// Color underline codes should add custom class and inline style
			assertSingleSequenceElement('\x1b[58;5;' + i + 'm', (child) => {
				assert(child.classList.contains('code-underline-colored'), `Custom color class not found after underline 8-bit color code 58;5;${i}`);
				assertInlineColor(child, 'underline', (calcANSI8bitColor(i) as RGBA), `Incorrect or no color styling found after underline 8-bit color code 58;5;${i}`);
			});
		}

		// Bad (nonexistent) color should not render
		assertSingleSequenceElement('\x1b[48;5;300m', (child) => {
			assert.strictEqual(0, child.classList.length, 'Bad ANSI color codes should have no effect.');
		});

		// Should ignore any codes after the ones needed to determine color
		assertSingleSequenceElement('\x1b[48;5;100;42;77;99;4;24m', (child) => {
			assert(child.classList.contains('code-background-colored'));
			assert.strictEqual(1, child.classList.length);
			assertInlineColor(child, 'background', (calcANSI8bitColor(100) as RGBA));
		});
	});

	test('Expected single 24-bit color sequence operation', () => {
		// 24-bit advanced colors
		for (let r = 0; r <= 255; r += 64) {
			for (let g = 0; g <= 255; g += 64) {
				for (let b = 0; b <= 255; b += 64) {
					let color = new RGBA(r, g, b);
					// Foreground codes should add class and inline style
					assertSingleSequenceElement(`\x1b[38;2;${r};${g};${b}m`, (child) => {
						assert(child.classList.contains('code-foreground-colored'), 'DOM should have "code-foreground-colored" class for advanced ANSI colors.');
						assertInlineColor(child, 'foreground', color);
					});

					// Background codes should add class and inline style
					assertSingleSequenceElement(`\x1b[48;2;${r};${g};${b}m`, (child) => {
						assert(child.classList.contains('code-background-colored'), 'DOM should have "code-foreground-colored" class for advanced ANSI colors.');
						assertInlineColor(child, 'background', color);
					});

					// Underline color codes should add class and inline style
					assertSingleSequenceElement(`\x1b[58;2;${r};${g};${b}m`, (child) => {
						assert(child.classList.contains('code-underline-colored'), 'DOM should have "code-underline-colored" class for advanced ANSI colors.');
						assertInlineColor(child, 'underline', color);
					});
				}
			}
		}

		// Invalid color should not render
		assertSingleSequenceElement('\x1b[38;2;4;4m', (child) => {
			assert.strictEqual(0, child.classList.length, `Invalid color code "38;2;4;4" should not add a class (classes found: ${child.classList}).`);
			assert(!child.style.color, `Invalid color code "38;2;4;4" should not add a custom color CSS (found color: ${child.style.color}).`);
		});

		// Bad (nonexistent) color should not render
		assertSingleSequenceElement('\x1b[48;2;150;300;5m', (child) => {
			assert.strictEqual(0, child.classList.length, `Nonexistent color code "48;2;150;300;5" should not add a class (classes found: ${child.classList}).`);
		});

		// Should ignore any codes after the ones needed to determine color
		assertSingleSequenceElement('\x1b[48;2;100;42;77;99;200;75m', (child) => {
			assert(child.classList.contains('code-background-colored'), `Color code with extra (valid) items "48;2;100;42;77;99;200;75" should still treat initial part as valid code and add class "code-background-custom".`);
			assert.strictEqual(1, child.classList.length, `Color code with extra items "48;2;100;42;77;99;200;75" should add one and only one class. (classes found: ${child.classList}).`);
			assertInlineColor(child, 'background', new RGBA(100, 42, 77), `Color code "48;2;100;42;77;99;200;75" should  style background-color as rgb(100,42,77).`);
		});
	});


	/**
	 * Assert that a given ANSI sequence produces the expected number of {@link HTMLSpanElement} children. For
	 * each child, run the provided assertion.
	 *
	 * @param sequence The ANSI sequence to verify.
	 * @param assertions A set of assertions to run on the resulting children.
	 */
	function assertMultipleSequenceElements(sequence: string, assertions: Array<(child: HTMLSpanElement) => void>, elementsExpected?: number): void {
		if (elementsExpected === undefined) {
			elementsExpected = assertions.length;
		}
		const root: HTMLSpanElement = handleANSIOutput(sequence, linkDetector, themeService, session.root);
		assert.strictEqual(elementsExpected, root.children.length);
		for (let i = 0; i < elementsExpected; i++) {
			const child: Node = root.children[i];
			if (child instanceof HTMLSpanElement) {
				assertions[i](child);
			} else {
				assert.fail('Unexpected assertion error');
			}
		}
	}

	test('Expected multiple sequence operation', () => {

		// Multiple codes affect the same text
		assertSingleSequenceElement('\x1b[1m\x1b[3m\x1b[4m\x1b[32m', (child) => {
			assert(child.classList.contains('code-bold'), 'Bold class not found after multiple different ANSI codes.');
			assert(child.classList.contains('code-italic'), 'Italic class not found after multiple different ANSI codes.');
			assert(child.classList.contains('code-underline'), 'Underline class not found after multiple different ANSI codes.');
			assert(child.classList.contains('code-foreground-colored'), 'Foreground color class not found after multiple different ANSI codes.');
		});

		// Consecutive codes do not affect previous ones
		assertMultipleSequenceElements('\x1b[1mbold\x1b[32mgreen\x1b[4munderline\x1b[3mitalic\x1b[0mnothing', [
			(bold) => {
				assert.strictEqual(1, bold.classList.length);
				assert(bold.classList.contains('code-bold'), 'Bold class not found after bold ANSI code.');
			},
			(green) => {
				assert.strictEqual(2, green.classList.length);
				assert(green.classList.contains('code-bold'), 'Bold class not found after both bold and color ANSI codes.');
				assert(green.classList.contains('code-foreground-colored'), 'Color class not found after color ANSI code.');
			},
			(underline) => {
				assert.strictEqual(3, underline.classList.length);
				assert(underline.classList.contains('code-bold'), 'Bold class not found after bold, color, and underline ANSI codes.');
				assert(underline.classList.contains('code-foreground-colored'), 'Color class not found after color and underline ANSI codes.');
				assert(underline.classList.contains('code-underline'), 'Underline class not found after underline ANSI code.');
			},
			(italic) => {
				assert.strictEqual(4, italic.classList.length);
				assert(italic.classList.contains('code-bold'), 'Bold class not found after bold, color, underline, and italic ANSI codes.');
				assert(italic.classList.contains('code-foreground-colored'), 'Color class not found after color, underline, and italic ANSI codes.');
				assert(italic.classList.contains('code-underline'), 'Underline class not found after underline and italic ANSI codes.');
				assert(italic.classList.contains('code-italic'), 'Italic class not found after italic ANSI code.');
			},
			(nothing) => {
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after reset ANSI code.');
			},
		], 5);

		// Consecutive codes with ENDING/OFF codes do not LEAVE affect previous ones
		assertMultipleSequenceElements('\x1b[1mbold\x1b[22m\x1b[32mgreen\x1b[4munderline\x1b[24m\x1b[3mitalic\x1b[23mjustgreen\x1b[0mnothing', [
			(bold) => {
				assert.strictEqual(1, bold.classList.length);
				assert(bold.classList.contains('code-bold'), 'Bold class not found after bold ANSI code.');
			},
			(green) => {
				assert.strictEqual(1, green.classList.length);
				assert(green.classList.contains('code-bold') === false, 'Bold class found after both bold WAS TURNED OFF with 22m');
				assert(green.classList.contains('code-foreground-colored'), 'Color class not found after color ANSI code.');
			},
			(underline) => {
				assert.strictEqual(2, underline.classList.length);
				assert(underline.classList.contains('code-foreground-colored'), 'Color class not found after color and underline ANSI codes.');
				assert(underline.classList.contains('code-underline'), 'Underline class not found after underline ANSI code.');
			},
			(italic) => {
				assert.strictEqual(2, italic.classList.length);
				assert(italic.classList.contains('code-foreground-colored'), 'Color class not found after color, underline, and italic ANSI codes.');
				assert(italic.classList.contains('code-underline') === false, 'Underline class found after underline WAS TURNED OFF with 24m');
				assert(italic.classList.contains('code-italic'), 'Italic class not found after italic ANSI code.');
			},
			(justgreen) => {
				assert.strictEqual(1, justgreen.classList.length);
				assert(justgreen.classList.contains('code-italic') === false, 'Italic class found after italic WAS TURNED OFF with 23m');
				assert(justgreen.classList.contains('code-foreground-colored'), 'Color class not found after color ANSI code.');
			},
			(nothing) => {
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after reset ANSI code.');
			},
		], 6);

		// more Consecutive codes with ENDING/OFF codes do not LEAVE affect previous ones
		assertMultipleSequenceElements('\x1b[2mdim\x1b[22m\x1b[32mgreen\x1b[5mslowblink\x1b[25m\x1b[6mrapidblink\x1b[25mjustgreen\x1b[0mnothing', [
			(dim) => {
				assert.strictEqual(1, dim.classList.length);
				assert(dim.classList.contains('code-dim'), 'Dim class not found after dim ANSI code 2m.');
			},
			(green) => {
				assert.strictEqual(1, green.classList.length);
				assert(green.classList.contains('code-dim') === false, 'Dim class found after dim WAS TURNED OFF with 22m');
				assert(green.classList.contains('code-foreground-colored'), 'Color class not found after color ANSI code.');
			},
			(slowblink) => {
				assert.strictEqual(2, slowblink.classList.length);
				assert(slowblink.classList.contains('code-foreground-colored'), 'Color class not found after color and blink ANSI codes.');
				assert(slowblink.classList.contains('code-blink'), 'Blink class not found after underline ANSI code 5m.');
			},
			(rapidblink) => {
				assert.strictEqual(2, rapidblink.classList.length);
				assert(rapidblink.classList.contains('code-foreground-colored'), 'Color class not found after color, blink, and rapid blink ANSI codes.');
				assert(rapidblink.classList.contains('code-blink') === false, 'blink class found after underline WAS TURNED OFF with 25m');
				assert(rapidblink.classList.contains('code-rapid-blink'), 'Rapid blink class not found after rapid blink ANSI code 6m.');
			},
			(justgreen) => {
				assert.strictEqual(1, justgreen.classList.length);
				assert(justgreen.classList.contains('code-rapid-blink') === false, 'Rapid blink class found after rapid blink WAS TURNED OFF with 25m');
				assert(justgreen.classList.contains('code-foreground-colored'), 'Color class not found after color ANSI code.');
			},
			(nothing) => {
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after reset ANSI code.');
			},
		], 6);

		// more Consecutive codes with ENDING/OFF codes do not LEAVE affect previous ones
		assertMultipleSequenceElements('\x1b[8mhidden\x1b[28m\x1b[32mgreen\x1b[9mcrossedout\x1b[29m\x1b[21mdoubleunderline\x1b[24mjustgreen\x1b[0mnothing', [
			(hidden) => {
				assert.strictEqual(1, hidden.classList.length);
				assert(hidden.classList.contains('code-hidden'), 'Hidden class not found after dim ANSI code 8m.');
			},
			(green) => {
				assert.strictEqual(1, green.classList.length);
				assert(green.classList.contains('code-hidden') === false, 'Hidden class found after Hidden WAS TURNED OFF with 28m');
				assert(green.classList.contains('code-foreground-colored'), 'Color class not found after color ANSI code.');
			},
			(crossedout) => {
				assert.strictEqual(2, crossedout.classList.length);
				assert(crossedout.classList.contains('code-foreground-colored'), 'Color class not found after color and hidden ANSI codes.');
				assert(crossedout.classList.contains('code-strike-through'), 'strike-through class not found after crossout/strikethrough ANSI code 9m.');
			},
			(doubleunderline) => {
				assert.strictEqual(2, doubleunderline.classList.length);
				assert(doubleunderline.classList.contains('code-foreground-colored'), 'Color class not found after color, hidden, and crossedout ANSI codes.');
				assert(doubleunderline.classList.contains('code-strike-through') === false, 'strike-through class found after strike-through WAS TURNED OFF with 29m');
				assert(doubleunderline.classList.contains('code-double-underline'), 'Double underline class not found after double underline ANSI code 21m.');
			},
			(justgreen) => {
				assert.strictEqual(1, justgreen.classList.length);
				assert(justgreen.classList.contains('code-double-underline') === false, 'Double underline class found after double underline WAS TURNED OFF with 24m');
				assert(justgreen.classList.contains('code-foreground-colored'), 'Color class not found after color ANSI code.');
			},
			(nothing) => {
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after reset ANSI code.');
			},
		], 6);

		// underline, double underline are mutually exclusive, test underline->double underline->off and double underline->underline->off
		assertMultipleSequenceElements('\x1b[4munderline\x1b[21mdouble underline\x1b[24munderlineOff\x1b[21mdouble underline\x1b[4munderline\x1b[24munderlineOff', [
			(underline) => {
				assert.strictEqual(1, underline.classList.length);
				assert(underline.classList.contains('code-underline'), 'Underline class not found after underline ANSI code 4m.');
			},
			(doubleunderline) => {
				assert(doubleunderline.classList.contains('code-underline') === false, 'Underline class found after double underline code 21m');
				assert(doubleunderline.classList.contains('code-double-underline'), 'Double underline class not found after double underline code 21m');
				assert.strictEqual(1, doubleunderline.classList.length, 'should have found only double underline');
			},
			(nothing) => {
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after underline off code 4m.');
			},
			(doubleunderline) => {
				assert(doubleunderline.classList.contains('code-double-underline'), 'Double underline class not found after double underline code 21m');
				assert.strictEqual(1, doubleunderline.classList.length, 'should have found only double underline');
			},
			(underline) => {
				assert(underline.classList.contains('code-double-underline') === false, 'Double underline class found after underline code 4m');
				assert(underline.classList.contains('code-underline'), 'Underline class not found after underline ANSI code 4m.');
				assert.strictEqual(1, underline.classList.length, 'should have found only underline');
			},
			(nothing) => {
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after underline off code 4m.');
			},
		], 6);

		// underline and strike-through and overline can exist at the same time and
		// in any combination
		assertMultipleSequenceElements('\x1b[4munderline\x1b[9mand strikethough\x1b[53mand overline\x1b[24munderlineOff\x1b[55moverlineOff\x1b[29mstriklethoughOff', [
			(underline) => {
				assert.strictEqual(1, underline.classList.length, 'should have found only underline');
				assert(underline.classList.contains('code-underline'), 'Underline class not found after underline ANSI code 4m.');
			},
			(strikethrough) => {
				assert(strikethrough.classList.contains('code-underline'), 'Underline class NOT found after strikethrough code 9m');
				assert(strikethrough.classList.contains('code-strike-through'), 'Strike through class not found after strikethrough code 9m');
				assert.strictEqual(2, strikethrough.classList.length, 'should have found underline and strikethrough');
			},
			(overline) => {
				assert(overline.classList.contains('code-underline'), 'Underline class NOT found after overline code 53m');
				assert(overline.classList.contains('code-strike-through'), 'Strike through class not found after overline code 53m');
				assert(overline.classList.contains('code-overline'), 'Overline class not found after overline code 53m');
				assert.strictEqual(3, overline.classList.length, 'should have found underline,strikethrough and overline');
			},
			(underlineoff) => {
				assert(underlineoff.classList.contains('code-underline') === false, 'Underline class found after underline off code 24m');
				assert(underlineoff.classList.contains('code-strike-through'), 'Strike through class not found after underline off code 24m');
				assert(underlineoff.classList.contains('code-overline'), 'Overline class not found after underline off code 24m');
				assert.strictEqual(2, underlineoff.classList.length, 'should have found strikethrough and overline');
			},
			(overlineoff) => {
				assert(overlineoff.classList.contains('code-underline') === false, 'Underline class found after overline off code 55m');
				assert(overlineoff.classList.contains('code-overline') === false, 'Overline class found after overline off code 55m');
				assert(overlineoff.classList.contains('code-strike-through'), 'Strike through class not found after overline off code 55m');
				assert.strictEqual(1, overlineoff.classList.length, 'should have found only strikethrough');
			},
			(nothing) => {
				assert(nothing.classList.contains('code-strike-through') === false, 'Strike through class found after strikethrough off code 29m');
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after strikethough OFF code 29m');
			},
		], 6);

		// double underline and strike-through and overline can exist at the same time and
		// in any combination
		assertMultipleSequenceElements('\x1b[21mdoubleunderline\x1b[9mand strikethough\x1b[53mand overline\x1b[29mstriklethoughOff\x1b[55moverlineOff\x1b[24munderlineOff', [
			(doubleunderline) => {
				assert.strictEqual(1, doubleunderline.classList.length, 'should have found only doubleunderline');
				assert(doubleunderline.classList.contains('code-double-underline'), 'Double underline class not found after double underline ANSI code 21m.');
			},
			(strikethrough) => {
				assert(strikethrough.classList.contains('code-double-underline'), 'Double nderline class NOT found after strikethrough code 9m');
				assert(strikethrough.classList.contains('code-strike-through'), 'Strike through class not found after strikethrough code 9m');
				assert.strictEqual(2, strikethrough.classList.length, 'should have found doubleunderline and strikethrough');
			},
			(overline) => {
				assert(overline.classList.contains('code-double-underline'), 'Double underline class NOT found after overline code 53m');
				assert(overline.classList.contains('code-strike-through'), 'Strike through class not found after overline code 53m');
				assert(overline.classList.contains('code-overline'), 'Overline class not found after overline code 53m');
				assert.strictEqual(3, overline.classList.length, 'should have found doubleunderline,overline and strikethrough');
			},
			(strikethrougheoff) => {
				assert(strikethrougheoff.classList.contains('code-double-underline'), 'Double underline class NOT found after strikethrough off code 29m');
				assert(strikethrougheoff.classList.contains('code-overline'), 'Overline class NOT found after strikethrough off code 29m');
				assert(strikethrougheoff.classList.contains('code-strike-through') === false, 'Strike through class found after strikethrough off code 29m');
				assert.strictEqual(2, strikethrougheoff.classList.length, 'should have found doubleunderline and overline');
			},
			(overlineoff) => {
				assert(overlineoff.classList.contains('code-double-underline'), 'Double underline class NOT found after overline off code 55m');
				assert(overlineoff.classList.contains('code-strike-through') === false, 'Strike through class found after overline off code 55m');
				assert(overlineoff.classList.contains('code-overline') === false, 'Overline class found after overline off code 55m');
				assert.strictEqual(1, overlineoff.classList.length, 'Should have found only double underline');
			},
			(nothing) => {
				assert(nothing.classList.contains('code-double-underline') === false, 'Double underline class found after underline off code 24m');
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after underline OFF code 24m');
			},
		], 6);

		// superscript and subscript are mutually exclusive, test superscript->subscript->off and subscript->superscript->off
		assertMultipleSequenceElements('\x1b[73msuperscript\x1b[74msubscript\x1b[75mneither\x1b[74msubscript\x1b[73msuperscript\x1b[75mneither', [
			(superscript) => {
				assert.strictEqual(1, superscript.classList.length, 'should only be superscript class');
				assert(superscript.classList.contains('code-superscript'), 'Superscript class not found after superscript ANSI code 73m.');
			},
			(subscript) => {
				assert(subscript.classList.contains('code-superscript') === false, 'Superscript class found after subscript code 74m');
				assert(subscript.classList.contains('code-subscript'), 'Subscript class not found after subscript code 74m');
				assert.strictEqual(1, subscript.classList.length, 'should have found only subscript class');
			},
			(nothing) => {
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after superscript/subscript off code 75m.');
			},
			(subscript) => {
				assert(subscript.classList.contains('code-subscript'), 'Subscript class not found after subscript code 74m');
				assert.strictEqual(1, subscript.classList.length, 'should have found only subscript class');
			},
			(superscript) => {
				assert(superscript.classList.contains('code-subscript') === false, 'Subscript class found after superscript code 73m');
				assert(superscript.classList.contains('code-superscript'), 'Superscript class not found after superscript ANSI code 73m.');
				assert.strictEqual(1, superscript.classList.length, 'should have found only superscript class');
			},
			(nothing) => {
				assert.strictEqual(0, nothing.classList.length, 'One or more style classes still found after superscipt/subscript off code 75m.');
			},
		], 6);

		// Consecutive font codes switch to new font class and remove previous and then final switch to default font removes class
		assertMultipleSequenceElements('\x1b[11mFont1\x1b[12mFont2\x1b[13mFont3\x1b[14mFont4\x1b[15mFont5\x1b[10mdefaultFont', [
			(font1) => {
				assert.strictEqual(1, font1.classList.length);
				assert(font1.classList.contains('code-font-1'), 'font 1 class NOT found after switch to font 1 with ANSI code 11m');
			},
			(font2) => {
				assert.strictEqual(1, font2.classList.length);
				assert(font2.classList.contains('code-font-1') === false, 'font 1 class found after switch to font 2 with ANSI code 12m');
				assert(font2.classList.contains('code-font-2'), 'font 2 class NOT found after switch to font 2 with ANSI code 12m');
			},
			(font3) => {
				assert.strictEqual(1, font3.classList.length);
				assert(font3.classList.contains('code-font-2') === false, 'font 2 class found after switch to font 3 with ANSI code 13m');
				assert(font3.classList.contains('code-font-3'), 'font 3 class NOT found after switch to font 3 with ANSI code 13m');
			},
			(font4) => {
				assert.strictEqual(1, font4.classList.length);
				assert(font4.classList.contains('code-font-3') === false, 'font 3 class found after switch to font 4 with ANSI code 14m');
				assert(font4.classList.contains('code-font-4'), 'font 4 class NOT found after switch to font 4 with ANSI code 14m');
			},
			(font5) => {
				assert.strictEqual(1, font5.classList.length);
				assert(font5.classList.contains('code-font-4') === false, 'font 4 class found after switch to font 5 with ANSI code 15m');
				assert(font5.classList.contains('code-font-5'), 'font 5 class NOT found after switch to font 5 with ANSI code 15m');
			},
			(defaultfont) => {
				assert.strictEqual(0, defaultfont.classList.length, 'One or more font style classes still found after reset to default font with ANSI code 10m.');
			},
		], 6);

		// More Consecutive font codes switch to new font class and remove previous and then final switch to default font removes class
		assertMultipleSequenceElements('\x1b[16mFont6\x1b[17mFont7\x1b[18mFont8\x1b[19mFont9\x1b[20mFont10\x1b[10mdefaultFont', [
			(font6) => {
				assert.strictEqual(1, font6.classList.length);
				assert(font6.classList.contains('code-font-6'), 'font 6 class NOT found after switch to font 6 with ANSI code 16m');
			},
			(font7) => {
				assert.strictEqual(1, font7.classList.length);
				assert(font7.classList.contains('code-font-6') === false, 'font 6 class found after switch to font 7 with ANSI code 17m');
				assert(font7.classList.contains('code-font-7'), 'font 7 class NOT found after switch to font 7 with ANSI code 17m');
			},
			(font8) => {
				assert.strictEqual(1, font8.classList.length);
				assert(font8.classList.contains('code-font-7') === false, 'font 7 class found after switch to font 8 with ANSI code 18m');
				assert(font8.classList.contains('code-font-8'), 'font 8 class NOT found after switch to font 8 with ANSI code 18m');
			},
			(font9) => {
				assert.strictEqual(1, font9.classList.length);
				assert(font9.classList.contains('code-font-8') === false, 'font 8 class found after switch to font 9 with ANSI code 19m');
				assert(font9.classList.contains('code-font-9'), 'font 9 class NOT found after switch to font 9 with ANSI code 19m');
			},
			(font10) => {
				assert.strictEqual(1, font10.classList.length);
				assert(font10.classList.contains('code-font-9') === false, 'font 9 class found after switch to font 10 with ANSI code 20m');
				assert(font10.classList.contains('code-font-10'), `font 10 class NOT found after switch to font 10 with ANSI code 20m (${font10.classList})`);
			},
			(defaultfont) => {
				assert.strictEqual(0, defaultfont.classList.length, 'One or more font style classes (2nd series) still found after reset to default font with ANSI code 10m.');
			},
		], 6);

		// Blackletter font codes can be turned off with other font codes or 23m
		assertMultipleSequenceElements('\x1b[3mitalic\x1b[20mfont10blacklatter\x1b[23mitalicAndBlackletterOff\x1b[20mFont10Again\x1b[11mFont1\x1b[10mdefaultFont', [
			(italic) => {
				assert.strictEqual(1, italic.classList.length);
				assert(italic.classList.contains('code-italic'), 'italic class NOT found after italic code ANSI code 3m');
			},
			(font10) => {
				assert.strictEqual(2, font10.classList.length);
				assert(font10.classList.contains('code-italic'), 'no itatic class found after switch to font 10 (blackletter) with ANSI code 20m');
				assert(font10.classList.contains('code-font-10'), 'font 10 class NOT found after switch to font 10 with ANSI code 20m');
			},
			(italicAndBlackletterOff) => {
				assert.strictEqual(0, italicAndBlackletterOff.classList.length, 'italic or blackletter (font10) class found after both switched off with ANSI code 23m');
			},
			(font10) => {
				assert.strictEqual(1, font10.classList.length);
				assert(font10.classList.contains('code-font-10'), 'font 10 class NOT found after switch to font 10 with ANSI code 20m');
			},
			(font1) => {
				assert.strictEqual(1, font1.classList.length);
				assert(font1.classList.contains('code-font-10') === false, 'font 10 class found after switch to font 1 with ANSI code 11m');
				assert(font1.classList.contains('code-font-1'), 'font 1 class NOT found after switch to font 1 with ANSI code 11m');
			},
			(defaultfont) => {
				assert.strictEqual(0, defaultfont.classList.length, 'One or more font style classes (2nd series) still found after reset to default font with ANSI code 10m.');
			},
		], 6);

		// italic can be turned on/off with affecting font codes 1-9  (italic off will clear 'blackletter'(font 23) as per spec)
		assertMultipleSequenceElements('\x1b[3mitalic\x1b[12mfont2\x1b[23mitalicOff\x1b[3mitalicFont2\x1b[10mjustitalic\x1b[23mnothing', [
			(italic) => {
				assert.strictEqual(1, italic.classList.length);
				assert(italic.classList.contains('code-italic'), 'italic class NOT found after italic code ANSI code 3m');
			},
			(font10) => {
				assert.strictEqual(2, font10.classList.length);
				assert(font10.classList.contains('code-italic'), 'no itatic class found after switch to font 2 with ANSI code 12m');
				assert(font10.classList.contains('code-font-2'), 'font 2 class NOT found after switch to font 2 with ANSI code 12m');
			},
			(italicOff) => {
				assert.strictEqual(1, italicOff.classList.length, 'italic class found after both switched off with ANSI code 23m');
				assert(italicOff.classList.contains('code-italic') === false, 'itatic class found after switching it OFF with ANSI code 23m');
				assert(italicOff.classList.contains('code-font-2'), 'font 2 class NOT found after switching italic off with ANSI code 23m');
			},
			(italicFont2) => {
				assert.strictEqual(2, italicFont2.classList.length);
				assert(italicFont2.classList.contains('code-italic'), 'no itatic class found after italic ANSI code 3m');
				assert(italicFont2.classList.contains('code-font-2'), 'font 2 class NOT found after italic ANSI code 3m');
			},
			(justitalic) => {
				assert.strictEqual(1, justitalic.classList.length);
				assert(justitalic.classList.contains('code-font-2') === false, 'font 2 class found after switch to default font with ANSI code 10m');
				assert(justitalic.classList.contains('code-italic'), 'italic class NOT found after switch to default font with ANSI code 10m');
			},
			(nothing) => {
				assert.strictEqual(0, nothing.classList.length, 'One or more classes still found after final italic removal with ANSI code 23m.');
			},
		], 6);

		// Reverse video reverses Foreground/Background colors WITH both SET and can called in sequence
		assertMultipleSequenceElements('\x1b[38;2;10;20;30mfg10,20,30\x1b[48;2;167;168;169mbg167,168,169\x1b[7m8ReverseVideo\x1b[7mDuplicateReverseVideo\x1b[27mReverseOff\x1b[27mDupReverseOff', [
			(fg10_20_30) => {
				assert.strictEqual(1, fg10_20_30.classList.length, 'Foreground ANSI color code should add one class.');
				assert(fg10_20_30.classList.contains('code-foreground-colored'), 'Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(fg10_20_30, 'foreground', new RGBA(10, 20, 30), '24-bit RGBA ANSI color code (10,20,30) should add matching color inline style.');
			},
			(bg167_168_169) => {
				assert.strictEqual(2, bg167_168_169.classList.length, 'background ANSI color codes should only add a single class.');
				assert(bg167_168_169.classList.contains('code-background-colored'), 'Background ANSI color codes should add custom background color class.');
				assertInlineColor(bg167_168_169, 'background', new RGBA(167, 168, 169), '24-bit RGBA ANSI background color code (167,168,169) should add matching color inline style.');
				assert(bg167_168_169.classList.contains('code-foreground-colored'), 'Still Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(bg167_168_169, 'foreground', new RGBA(10, 20, 30), 'Still 24-bit RGBA ANSI color code (10,20,30) should add matching color inline style.');
			},
			(reverseVideo) => {
				assert.strictEqual(2, reverseVideo.classList.length, 'background ANSI color codes should only add a single class.');
				assert(reverseVideo.classList.contains('code-background-colored'), 'Background ANSI color codes should add custom background color class.');
				assertInlineColor(reverseVideo, 'foreground', new RGBA(167, 168, 169), 'Reversed 24-bit RGBA ANSI foreground color code (167,168,169) should add matching former background color inline style.');
				assert(reverseVideo.classList.contains('code-foreground-colored'), 'Still Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(reverseVideo, 'background', new RGBA(10, 20, 30), 'Reversed 24-bit RGBA ANSI background color code (10,20,30) should add matching former foreground color inline style.');
			},
			(dupReverseVideo) => {
				assert.strictEqual(2, dupReverseVideo.classList.length, 'After second Reverse Video - background ANSI color codes should only add a single class.');
				assert(dupReverseVideo.classList.contains('code-background-colored'), 'After second Reverse Video - Background ANSI color codes should add custom background color class.');
				assertInlineColor(dupReverseVideo, 'foreground', new RGBA(167, 168, 169), 'After second Reverse Video - Reversed 24-bit RGBA ANSI foreground color code (167,168,169) should add matching former background color inline style.');
				assert(dupReverseVideo.classList.contains('code-foreground-colored'), 'After second Reverse Video - Still Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(dupReverseVideo, 'background', new RGBA(10, 20, 30), 'After second Reverse Video - Reversed 24-bit RGBA ANSI background color code (10,20,30) should add matching former foreground color inline style.');
			},
			(reversedBack) => {
				assert.strictEqual(2, reversedBack.classList.length, 'Reversed Back - background ANSI color codes should only add a single class.');
				assert(reversedBack.classList.contains('code-background-colored'), 'Reversed Back - Background ANSI color codes should add custom background color class.');
				assertInlineColor(reversedBack, 'background', new RGBA(167, 168, 169), 'Reversed Back - 24-bit RGBA ANSI background color code (167,168,169) should add matching color inline style.');
				assert(reversedBack.classList.contains('code-foreground-colored'), 'Reversed Back -  Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(reversedBack, 'foreground', new RGBA(10, 20, 30), 'Reversed Back -  24-bit RGBA ANSI color code (10,20,30) should add matching color inline style.');
			},
			(dupReversedBack) => {
				assert.strictEqual(2, dupReversedBack.classList.length, '2nd Reversed Back - background ANSI color codes should only add a single class.');
				assert(dupReversedBack.classList.contains('code-background-colored'), '2nd Reversed Back - Background ANSI color codes should add custom background color class.');
				assertInlineColor(dupReversedBack, 'background', new RGBA(167, 168, 169), '2nd Reversed Back - 24-bit RGBA ANSI background color code (167,168,169) should add matching color inline style.');
				assert(dupReversedBack.classList.contains('code-foreground-colored'), '2nd Reversed Back -  Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(dupReversedBack, 'foreground', new RGBA(10, 20, 30), '2nd Reversed Back -  24-bit RGBA ANSI color code (10,20,30) should add matching color inline style.');
			},
		], 6);

		// Reverse video reverses Foreground/Background colors WITH ONLY foreground color SET
		assertMultipleSequenceElements('\x1b[38;2;10;20;30mfg10,20,30\x1b[7m8ReverseVideo\x1b[27mReverseOff', [
			(fg10_20_30) => {
				assert.strictEqual(1, fg10_20_30.classList.length, 'Foreground ANSI color code should add one class.');
				assert(fg10_20_30.classList.contains('code-foreground-colored'), 'Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(fg10_20_30, 'foreground', new RGBA(10, 20, 30), '24-bit RGBA ANSI color code (10,20,30) should add matching color inline style.');
			},
			(reverseVideo) => {
				assert.strictEqual(1, reverseVideo.classList.length, 'Background ANSI color codes should only add a single class.');
				assert(reverseVideo.classList.contains('code-background-colored'), 'Background ANSI color codes should add custom background color class.');
				assert(reverseVideo.classList.contains('code-foreground-colored') === false, 'After Reverse with NO background the Foreground ANSI color codes should NOT BE SET.');
				assertInlineColor(reverseVideo, 'background', new RGBA(10, 20, 30), 'Reversed 24-bit RGBA ANSI background color code (10,20,30) should add matching former foreground color inline style.');
			},
			(reversedBack) => {
				assert.strictEqual(1, reversedBack.classList.length, 'Reversed Back - background ANSI color codes should only add a single class.');
				assert(reversedBack.classList.contains('code-background-colored') === false, 'AFTER Reversed Back - Background ANSI color should NOT BE SET.');
				assert(reversedBack.classList.contains('code-foreground-colored'), 'Reversed Back -  Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(reversedBack, 'foreground', new RGBA(10, 20, 30), 'Reversed Back -  24-bit RGBA ANSI color code (10,20,30) should add matching color inline style.');
			},
		], 3);

		// Reverse video reverses Foreground/Background colors WITH ONLY background color SET
		assertMultipleSequenceElements('\x1b[48;2;167;168;169mbg167,168,169\x1b[7m8ReverseVideo\x1b[27mReverseOff', [
			(bg167_168_169) => {
				assert.strictEqual(1, bg167_168_169.classList.length, 'Background ANSI color code should add one class.');
				assert(bg167_168_169.classList.contains('code-background-colored'), 'Background ANSI color codes should add custom foreground color class.');
				assertInlineColor(bg167_168_169, 'background', new RGBA(167, 168, 169), '24-bit RGBA ANSI color code (167, 168, 169) should add matching background color inline style.');
			},
			(reverseVideo) => {
				assert.strictEqual(1, reverseVideo.classList.length, 'After ReverseVideo Foreground ANSI color codes should only add a single class.');
				assert(reverseVideo.classList.contains('code-foreground-colored'), 'After ReverseVideo Foreground ANSI color codes should add custom background color class.');
				assert(reverseVideo.classList.contains('code-background-colored') === false, 'After Reverse with NO foreground color the background ANSI color codes should BE SET.');
				assertInlineColor(reverseVideo, 'foreground', new RGBA(167, 168, 169), 'Reversed 24-bit RGBA ANSI background color code (10,20,30) should add matching former background color inline style.');
			},
			(reversedBack) => {
				assert.strictEqual(1, reversedBack.classList.length, 'Reversed Back - background ANSI color codes should only add a single class.');
				assert(reversedBack.classList.contains('code-foreground-colored') === false, 'AFTER Reversed Back - Foreground ANSI color should NOT BE SET.');
				assert(reversedBack.classList.contains('code-background-colored'), 'Reversed Back -  Background ANSI color codes should add custom background color class.');
				assertInlineColor(reversedBack, 'background', new RGBA(167, 168, 169), 'Reversed Back -  24-bit RGBA ANSI color code (10,20,30) should add matching background color inline style.');
			},
		], 3);

		// Underline color Different types of color codes still cancel each other
		assertMultipleSequenceElements('\x1b[58;2;101;102;103m24bitUnderline101,102,103\x1b[58;5;3m8bitsimpleUnderline\x1b[58;2;104;105;106m24bitUnderline104,105,106\x1b[58;5;101m8bitadvanced\x1b[58;2;200;200;200munderline200,200,200\x1b[59mUnderlineColorResetToDefault', [
			(adv24Bit) => {
				assert.strictEqual(1, adv24Bit.classList.length, 'Underline ANSI color codes should only add a single class (1).');
				assert(adv24Bit.classList.contains('code-underline-colored'), 'Underline ANSI color codes should add custom underline color class.');
				assertInlineColor(adv24Bit, 'underline', new RGBA(101, 102, 103), '24-bit RGBA ANSI color code (101,102,103) should add matching color inline style.');
			},
			(adv8BitSimple) => {
				assert.strictEqual(1, adv8BitSimple.classList.length, 'Multiple underline ANSI color codes should only add a single class (2).');
				assert(adv8BitSimple.classList.contains('code-underline-colored'), 'Underline ANSI color codes should add custom underline color class.');
				// changed to simple theme color, don't know exactly what it should be, but it should NO LONGER BE 101,102,103
				assertInlineColor(adv8BitSimple, 'underline', new RGBA(101, 102, 103), 'Change to theme color SHOULD NOT STILL BE 24-bit RGBA ANSI color code (101,102,103) should add matching color inline style.', false);
			},
			(adv24BitAgain) => {
				assert.strictEqual(1, adv24BitAgain.classList.length, 'Multiple underline ANSI color codes should only add a single class (3).');
				assert(adv24BitAgain.classList.contains('code-underline-colored'), 'Underline ANSI color codes should add custom underline color class.');
				assertInlineColor(adv24BitAgain, 'underline', new RGBA(104, 105, 106), '24-bit RGBA ANSI color code (100,100,100) should add matching color inline style.');
			},
			(adv8BitAdvanced) => {
				assert.strictEqual(1, adv8BitAdvanced.classList.length, 'Multiple underline ANSI color codes should only add a single class (4).');
				assert(adv8BitAdvanced.classList.contains('code-underline-colored'), 'Underline ANSI color codes should add custom underline color class.');
				// changed to 8bit advanced color, don't know exactly what it should be, but it should NO LONGER BE 104,105,106
				assertInlineColor(adv8BitAdvanced, 'underline', new RGBA(104, 105, 106), 'Change to theme color SHOULD NOT BE 24-bit RGBA ANSI color code (104,105,106) should add matching color inline style.', false);
			},
			(adv24BitUnderlin200) => {
				assert.strictEqual(1, adv24BitUnderlin200.classList.length, 'Multiple underline ANSI color codes should only add a single class 4.');
				assert(adv24BitUnderlin200.classList.contains('code-underline-colored'), 'Underline ANSI color codes should add custom underline color class.');
				assertInlineColor(adv24BitUnderlin200, 'underline', new RGBA(200, 200, 200), 'after change underline color SHOULD BE 24-bit RGBA ANSI color code (200,200,200) should add matching color inline style.');
			},
			(underlineColorResetToDefault) => {
				assert.strictEqual(0, underlineColorResetToDefault.classList.length, 'After Underline Color reset to default NO underline color class should be set.');
				assertInlineColor(underlineColorResetToDefault, 'underline', undefined, 'after RESET TO DEFAULT underline color SHOULD NOT BE SET (no color inline style.)');
			},
		], 6);

		// Different types of color codes still cancel each other
		assertMultipleSequenceElements('\x1b[34msimple\x1b[38;2;101;102;103m24bit\x1b[38;5;3m8bitsimple\x1b[38;2;104;105;106m24bitAgain\x1b[38;5;101m8bitadvanced', [
			(simple) => {
				assert.strictEqual(1, simple.classList.length, 'Foreground ANSI color code should add one class.');
				assert(simple.classList.contains('code-foreground-colored'), 'Foreground ANSI color codes should add custom foreground color class.');
			},
			(adv24Bit) => {
				assert.strictEqual(1, adv24Bit.classList.length, 'Multiple foreground ANSI color codes should only add a single class.');
				assert(adv24Bit.classList.contains('code-foreground-colored'), 'Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(adv24Bit, 'foreground', new RGBA(101, 102, 103), '24-bit RGBA ANSI color code (101,102,103) should add matching color inline style.');
			},
			(adv8BitSimple) => {
				assert.strictEqual(1, adv8BitSimple.classList.length, 'Multiple foreground ANSI color codes should only add a single class.');
				assert(adv8BitSimple.classList.contains('code-foreground-colored'), 'Foreground ANSI color codes should add custom foreground color class.');
				//color is theme based, so we can't check what it should be but we know it should NOT BE 101,102,103 anymore
				assertInlineColor(adv8BitSimple, 'foreground', new RGBA(101, 102, 103), 'SHOULD NOT LONGER BE 24-bit RGBA ANSI color code (101,102,103) after simple color change.', false);
			},
			(adv24BitAgain) => {
				assert.strictEqual(1, adv24BitAgain.classList.length, 'Multiple foreground ANSI color codes should only add a single class.');
				assert(adv24BitAgain.classList.contains('code-foreground-colored'), 'Foreground ANSI color codes should add custom foreground color class.');
				assertInlineColor(adv24BitAgain, 'foreground', new RGBA(104, 105, 106), '24-bit RGBA ANSI color code (104,105,106) should add matching color inline style.');
			},
			(adv8BitAdvanced) => {
				assert.strictEqual(1, adv8BitAdvanced.classList.length, 'Multiple foreground ANSI color codes should only add a single class.');
				assert(adv8BitAdvanced.classList.contains('code-foreground-colored'), 'Foreground ANSI color codes should add custom foreground color class.');
				// color should NO LONGER BE 104,105,106
				assertInlineColor(adv8BitAdvanced, 'foreground', new RGBA(104, 105, 106), 'SHOULD NOT LONGER BE 24-bit RGBA ANSI color code (104,105,106) after advanced color change.', false);
			}
		], 5);

	});

	/**
	 * Assert that the provided ANSI sequence exactly matches the text content of the resulting
	 * {@link HTMLSpanElement}.
	 *
	 * @param sequence The ANSI sequence to verify.
	 */
	function assertSequencestrictEqualToContent(sequence: string): void {
		const child: HTMLSpanElement = getSequenceOutput(sequence);
		assert(child.textContent === sequence);
	}

	test('Invalid codes treated as regular text', () => {

		// Individual components of ANSI code start are printed
		assertSequencestrictEqualToContent('\x1b');
		assertSequencestrictEqualToContent('[');

		// Unsupported sequence prints both characters
		assertSequencestrictEqualToContent('\x1b[');

		// Random strings are displayed properly
		for (let i = 0; i < 50; i++) {
			const uuid: string = generateUuid();
			assertSequencestrictEqualToContent(uuid);
		}

	});

	/**
	 * Assert that a given ANSI sequence maintains added content following the ANSI code, and that
	 * the expression itself is thrown away.
	 *
	 * @param sequence The ANSI sequence to verify. The provided sequence should contain ANSI codes
	 * only, and should not include actual text content as it is provided by this function.
	 */
	function assertEmptyOutput(sequence: string) {
		const child: HTMLSpanElement = getSequenceOutput(sequence + 'content');
		assert.strictEqual('content', child.textContent);
		assert.strictEqual(0, child.classList.length);
	}

	test('Empty sequence output', () => {

		const sequences: string[] = [
			// No colour codes
			'',
			'\x1b[;m',
			'\x1b[1;;m',
			'\x1b[m',
			'\x1b[99m'
		];

		sequences.forEach(sequence => {
			assertEmptyOutput(sequence);
		});

		// Check other possible ANSI terminators
		const terminators: string[] = 'ABCDHIJKfhmpsu'.split('');

		terminators.forEach(terminator => {
			assertEmptyOutput('\x1b[content' + terminator);
		});

	});

	test('calcANSI8bitColor', () => {
		// Invalid values
		// Negative (below range), simple range, decimals
		for (let i = -10; i <= 15; i += 0.5) {
			assert(calcANSI8bitColor(i) === undefined, 'Values less than 16 passed to calcANSI8bitColor should return undefined.');
		}
		// In-range range decimals
		for (let i = 16.5; i < 254; i += 1) {
			assert(calcANSI8bitColor(i) === undefined, 'Floats passed to calcANSI8bitColor should return undefined.');
		}
		// Above range
		for (let i = 256; i < 300; i += 0.5) {
			assert(calcANSI8bitColor(i) === undefined, 'Values grather than 255 passed to calcANSI8bitColor should return undefined.');
		}

		// All valid colors
		for (let red = 0; red <= 5; red++) {
			for (let green = 0; green <= 5; green++) {
				for (let blue = 0; blue <= 5; blue++) {
					let colorOut: any = calcANSI8bitColor(16 + red * 36 + green * 6 + blue);
					assert(colorOut.r === Math.round(red * (255 / 5)), 'Incorrect red value encountered for color');
					assert(colorOut.g === Math.round(green * (255 / 5)), 'Incorrect green value encountered for color');
					assert(colorOut.b === Math.round(blue * (255 / 5)), 'Incorrect balue value encountered for color');
				}
			}
		}

		// All grays
		for (let i = 232; i <= 255; i++) {
			let grayOut: any = calcANSI8bitColor(i);
			assert(grayOut.r === grayOut.g);
			assert(grayOut.r === grayOut.b);
			assert(grayOut.r === Math.round((i - 232) / 23 * 255));
		}
	});

});
