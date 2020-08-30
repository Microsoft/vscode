/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ChordKeybinding, KeyChord, KeyCode, KeyMod, Keybinding, SimpleKeybinding, createKeybinding } from 'vs/base/common/keyCodes';
import { OperatingSystem } from 'vs/base/common/platform';

suite('keyCodes', () => {

	function testBinaryEncoding(expected: Keybinding | null, k: number, OS: OperatingSystem): void {
		assert.deepEqual(createKeybinding(k, OS), expected);
	}

	test('MAC binary encoding', () => {

		function test(expected: Keybinding | null, k: number): void {
			testBinaryEncoding(expected, k, OperatingSystem.Macintosh);
		}

		test(null, 0);
		test(new SimpleKeybinding(false, false, false, false, KeyCode.Enter).toChord(), KeyCode.Enter);
		test(new SimpleKeybinding(true, false, false, false, KeyCode.Enter).toChord(), KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, false, true, false, KeyCode.Enter).toChord(), KeyMod.Alt | KeyCode.Enter);
		test(new SimpleKeybinding(true, false, true, false, KeyCode.Enter).toChord(), KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, true, false, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyCode.Enter);
		test(new SimpleKeybinding(true, true, false, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, true, true, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.Alt | KeyCode.Enter);
		test(new SimpleKeybinding(true, true, true, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, false, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyCode.Enter);
		test(new SimpleKeybinding(true, false, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, false, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Enter);
		test(new SimpleKeybinding(true, false, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, true, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter);
		test(new SimpleKeybinding(true, true, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.WinCtrl | KeyCode.Enter);
		test(new SimpleKeybinding(false, true, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.Enter);
		test(new SimpleKeybinding(true, true, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);

		test(
			new ChordKeybinding([
				new SimpleKeybinding(false, false, false, false, KeyCode.Enter),
				new SimpleKeybinding(false, false, false, false, KeyCode.Tab)
			]),
			KeyChord(KeyCode.Enter, KeyCode.Tab)
		);
		test(
			new ChordKeybinding([
				new SimpleKeybinding(false, false, false, true, KeyCode.KEY_Y),
				new SimpleKeybinding(false, false, false, false, KeyCode.KEY_Z)
			]),
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_Y, KeyCode.KEY_Z)
		);
	});

	test('WINDOWS & LINUX binary encoding', () => {

		[OperatingSystem.Linux, OperatingSystem.Windows].forEach((OS) => {

			function test(expected: Keybinding | null, k: number): void {
				testBinaryEncoding(expected, k, OS);
			}

			test(null, 0);
			test(new SimpleKeybinding(false, false, false, false, KeyCode.Enter).toChord(), KeyCode.Enter);
			test(new SimpleKeybinding(false, false, false, true, KeyCode.Enter).toChord(), KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(false, false, true, false, KeyCode.Enter).toChord(), KeyMod.Alt | KeyCode.Enter);
			test(new SimpleKeybinding(false, false, true, true, KeyCode.Enter).toChord(), KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(false, true, false, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyCode.Enter);
			test(new SimpleKeybinding(false, true, false, true, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(false, true, true, false, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.Alt | KeyCode.Enter);
			test(new SimpleKeybinding(false, true, true, true, KeyCode.Enter).toChord(), KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(true, false, false, false, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyCode.Enter);
			test(new SimpleKeybinding(true, false, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(true, false, true, false, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Enter);
			test(new SimpleKeybinding(true, false, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(true, true, false, false, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter);
			test(new SimpleKeybinding(true, true, false, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.WinCtrl | KeyCode.Enter);
			test(new SimpleKeybinding(true, true, true, false, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.Enter);
			test(new SimpleKeybinding(true, true, true, true, KeyCode.Enter).toChord(), KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.Enter);

			test(
				new ChordKeybinding([
					new SimpleKeybinding(false, false, false, false, KeyCode.Enter),
					new SimpleKeybinding(false, false, false, false, KeyCode.Tab)
				]),
				KeyChord(KeyCode.Enter, KeyCode.Tab)
			);
			test(
				new ChordKeybinding([
					new SimpleKeybinding(true, false, false, false, KeyCode.KEY_Y),
					new SimpleKeybinding(false, false, false, false, KeyCode.KEY_Z)
				]),
				KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_Y, KeyCode.KEY_Z)
			);

		});
	});
});
