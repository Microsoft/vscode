/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { KeyChord, KeyCode, KeyMod, SimpleKeybinding, createKeybinding, createSimpleKeybinding } from 'vs/base/common/keyCodes';
import { UserSettingsLabelProvider } from 'vs/base/common/keybindingLabels';
import { OperatingSystem } from 'vs/base/common/platform';
import { ScanCode, ScanCodeBinding, ScanCodeUtils } from 'vs/base/common/scanCode';
import { USLayoutResolvedKeybinding } from 'vs/platform/keybinding/common/usLayoutResolvedKeybinding';
import { MacLinuxKeyboardMapper } from 'vs/workbench/services/keybinding/common/macLinuxKeyboardMapper';
import { IResolvedKeybinding, assertMapping, assertResolveKeybinding, assertResolveKeyboardEvent, assertResolveUserBinding, readRawMapping } from 'vs/workbench/services/keybinding/test/electron-browser/keyboardMapperTestUtils';
import { IMacLinuxKeyboardMapping } from 'vs/platform/keyboardLayout/common/keyboardLayout';

const WRITE_FILE_IF_DIFFERENT = false;

async function createKeyboardMapper(isUSStandard: boolean, file: string, OS: OperatingSystem): Promise<MacLinuxKeyboardMapper> {
	const rawMappings = await readRawMapping<IMacLinuxKeyboardMapping>(file);
	return new MacLinuxKeyboardMapper(isUSStandard, rawMappings, OS);
}

suite('keyboardMapper - MAC de_ch', () => {

	let mapper: MacLinuxKeyboardMapper;

	suiteSetup(async () => {
		const _mapper = await createKeyboardMapper(false, 'mac_de_ch', OperatingSystem.Macintosh);
		mapper = _mapper;
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'mac_de_ch.txt');
	});

	function assertKeybindingTranslation(kb: number, expected: string | string[]): void {
		_assertKeybindingTranslation(mapper, OperatingSystem.Macintosh, kb, expected);
	}

	function _assertResolveKeybinding(k: number, expected: IResolvedKeybinding[]): void {
		assertResolveKeybinding(mapper, createKeybinding(k, OperatingSystem.Macintosh)!, expected);
	}

	test('kb => hw', () => {
		// unchanged
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.KEY_1, 'cmd+Digit1');
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.KEY_B, 'cmd+KeyB');
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_B, 'shift+cmd+KeyB');
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KEY_B, 'ctrl+shift+alt+cmd+KeyB');

		// flips Y and Z
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.KEY_Z, 'cmd+KeyY');
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.KEY_Y, 'cmd+KeyZ');

		// Ctrl+/
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.US_SLASH, 'shift+cmd+Digit7');
	});

	test('resolveKeybinding Cmd+A', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.KEY_A,
			[{
				label: '⌘A',
				ariaLabel: 'Command+A',
				electronAccelerator: 'Cmd+A',
				userSettingsLabel: 'cmd+a',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['meta+[KeyA]'],
			}]
		);
	});

	test('resolveKeybinding Cmd+B', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.KEY_B,
			[{
				label: '⌘B',
				ariaLabel: 'Command+B',
				electronAccelerator: 'Cmd+B',
				userSettingsLabel: 'cmd+b',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['meta+[KeyB]'],
			}]
		);
	});

	test('resolveKeybinding Cmd+Z', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.KEY_Z,
			[{
				label: '⌘Z',
				ariaLabel: 'Command+Z',
				electronAccelerator: 'Cmd+Z',
				userSettingsLabel: 'cmd+z',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['meta+[KeyY]'],
			}]
		);
	});

	test('resolveKeyboardEvent Cmd+[KeyY]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				metaKey: true,
				keyCode: -1,
				code: 'KeyY'
			},
			{
				label: '⌘Z',
				ariaLabel: 'Command+Z',
				electronAccelerator: 'Cmd+Z',
				userSettingsLabel: 'cmd+z',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['meta+[KeyY]'],
			}
		);
	});

	test('resolveKeybinding Cmd+]', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.US_CLOSE_SQUARE_BRACKET,
			[{
				label: '⌃⌥⌘6',
				ariaLabel: 'Control+Alt+Command+6',
				electronAccelerator: 'Ctrl+Alt+Cmd+6',
				userSettingsLabel: 'ctrl+alt+cmd+6',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+alt+meta+[Digit6]'],
			}]
		);
	});

	test('resolveKeyboardEvent Cmd+[BracketRight]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				metaKey: true,
				keyCode: -1,
				code: 'BracketRight'
			},
			{
				label: '⌘¨',
				ariaLabel: 'Command+¨',
				electronAccelerator: null,
				userSettingsLabel: 'cmd+[BracketRight]',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['meta+[BracketRight]'],
			}
		);
	});

	test('resolveKeybinding Shift+]', () => {
		_assertResolveKeybinding(
			KeyMod.Shift | KeyCode.US_CLOSE_SQUARE_BRACKET,
			[{
				label: '⌃⌥9',
				ariaLabel: 'Control+Alt+9',
				electronAccelerator: 'Ctrl+Alt+9',
				userSettingsLabel: 'ctrl+alt+9',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+alt+[Digit9]'],
			}]
		);
	});

	test('resolveKeybinding Cmd+/', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.US_SLASH,
			[{
				label: '⇧⌘7',
				ariaLabel: 'Shift+Command+7',
				electronAccelerator: 'Shift+Cmd+7',
				userSettingsLabel: 'shift+cmd+7',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['shift+meta+[Digit7]'],
			}]
		);
	});

	test('resolveKeybinding Cmd+Shift+/', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_SLASH,
			[{
				label: '⇧⌘\'',
				ariaLabel: 'Shift+Command+\'',
				electronAccelerator: null,
				userSettingsLabel: 'shift+cmd+[Minus]',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['shift+meta+[Minus]'],
			}]
		);
	});

	test('resolveKeybinding Cmd+K Cmd+\\', () => {
		_assertResolveKeybinding(
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_BACKSLASH),
			[{
				label: '⌘K ⌃⇧⌥⌘7',
				ariaLabel: 'Command+K Control+Shift+Alt+Command+7',
				electronAccelerator: null,
				userSettingsLabel: 'cmd+k ctrl+shift+alt+cmd+7',
				isWYSIWYG: true,
				isChord: true,
				dispatchParts: ['meta+[KeyK]', 'ctrl+shift+alt+meta+[Digit7]'],
			}]
		);
	});

	test('resolveKeybinding Cmd+K Cmd+=', () => {
		_assertResolveKeybinding(
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_EQUAL),
			[{
				label: '⌘K ⇧⌘0',
				ariaLabel: 'Command+K Shift+Command+0',
				electronAccelerator: null,
				userSettingsLabel: 'cmd+k shift+cmd+0',
				isWYSIWYG: true,
				isChord: true,
				dispatchParts: ['meta+[KeyK]', 'shift+meta+[Digit0]'],
			}]
		);
	});

	test('resolveKeybinding Cmd+DownArrow', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.DownArrow,
			[{
				label: '⌘↓',
				ariaLabel: 'Command+DownArrow',
				electronAccelerator: 'Cmd+Down',
				userSettingsLabel: 'cmd+down',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['meta+[ArrowDown]'],
			}]
		);
	});

	test('resolveKeybinding Cmd+NUMPAD_0', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.NUMPAD_0,
			[{
				label: '⌘NumPad0',
				ariaLabel: 'Command+NumPad0',
				electronAccelerator: null,
				userSettingsLabel: 'cmd+numpad0',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['meta+[Numpad0]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Home', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.Home,
			[{
				label: '⌘Home',
				ariaLabel: 'Command+Home',
				electronAccelerator: 'Cmd+Home',
				userSettingsLabel: 'cmd+home',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['meta+[Home]'],
			}]
		);
	});

	test('resolveKeyboardEvent Ctrl+[Home]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				metaKey: true,
				keyCode: -1,
				code: 'Home'
			},
			{
				label: '⌘Home',
				ariaLabel: 'Command+Home',
				electronAccelerator: 'Cmd+Home',
				userSettingsLabel: 'cmd+home',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['meta+[Home]'],
			}
		);
	});

	test('resolveUserBinding empty', () => {
		assertResolveUserBinding(mapper, [], []);
	});

	test('resolveUserBinding Cmd+[Comma] Cmd+/', () => {
		assertResolveUserBinding(
			mapper,
			[
				new ScanCodeBinding(false, false, false, true, ScanCode.Comma),
				new SimpleKeybinding(false, false, false, true, KeyCode.US_SLASH),
			],
			[{
				label: '⌘, ⇧⌘7',
				ariaLabel: 'Command+, Shift+Command+7',
				electronAccelerator: null,
				userSettingsLabel: 'cmd+[Comma] shift+cmd+7',
				isWYSIWYG: false,
				isChord: true,
				dispatchParts: ['meta+[Comma]', 'shift+meta+[Digit7]'],
			}]
		);
	});

	test('resolveKeyboardEvent Modifier only MetaLeft+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				metaKey: true,
				keyCode: -1,
				code: 'MetaLeft'
			},
			{
				label: '⌘',
				ariaLabel: 'Command',
				electronAccelerator: null,
				userSettingsLabel: 'cmd',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: [null],
			}
		);
	});

	test('resolveKeyboardEvent Modifier only MetaRight+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				metaKey: true,
				keyCode: -1,
				code: 'MetaRight'
			},
			{
				label: '⌘',
				ariaLabel: 'Command',
				electronAccelerator: null,
				userSettingsLabel: 'cmd',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: [null],
			}
		);
	});
});

suite('keyboardMapper - MAC en_us', () => {

	let mapper: MacLinuxKeyboardMapper;

	suiteSetup(async () => {
		const _mapper = await createKeyboardMapper(true, 'mac_en_us', OperatingSystem.Macintosh);
		mapper = _mapper;
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'mac_en_us.txt');
	});

	test('resolveUserBinding Cmd+[Comma] Cmd+/', () => {
		assertResolveUserBinding(
			mapper,
			[
				new ScanCodeBinding(false, false, false, true, ScanCode.Comma),
				new SimpleKeybinding(false, false, false, true, KeyCode.US_SLASH),
			],
			[{
				label: '⌘, ⌘/',
				ariaLabel: 'Command+, Command+/',
				electronAccelerator: null,
				userSettingsLabel: 'cmd+, cmd+/',
				isWYSIWYG: true,
				isChord: true,
				dispatchParts: ['meta+[Comma]', 'meta+[Slash]'],
			}]
		);
	});

	test('resolveKeyboardEvent Modifier only MetaLeft+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				metaKey: true,
				keyCode: -1,
				code: 'MetaLeft'
			},
			{
				label: '⌘',
				ariaLabel: 'Command',
				electronAccelerator: null,
				userSettingsLabel: 'cmd',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: [null],
			}
		);
	});

	test('resolveKeyboardEvent Modifier only MetaRight+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				metaKey: true,
				keyCode: -1,
				code: 'MetaRight'
			},
			{
				label: '⌘',
				ariaLabel: 'Command',
				electronAccelerator: null,
				userSettingsLabel: 'cmd',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: [null],
			}
		);
	});
});

suite('keyboardMapper - LINUX de_ch', () => {

	let mapper: MacLinuxKeyboardMapper;

	suiteSetup(async () => {
		const _mapper = await createKeyboardMapper(false, 'linux_de_ch', OperatingSystem.Linux);
		mapper = _mapper;
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'linux_de_ch.txt');
	});

	function assertKeybindingTranslation(kb: number, expected: string | string[]): void {
		_assertKeybindingTranslation(mapper, OperatingSystem.Linux, kb, expected);
	}

	function _assertResolveKeybinding(k: number, expected: IResolvedKeybinding[]): void {
		assertResolveKeybinding(mapper, createKeybinding(k, OperatingSystem.Linux)!, expected);
	}

	test('kb => hw', () => {
		// unchanged
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.KEY_1, 'ctrl+Digit1');
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.KEY_B, 'ctrl+KeyB');
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_B, 'ctrl+shift+KeyB');
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyMod.WinCtrl | KeyCode.KEY_B, 'ctrl+shift+alt+meta+KeyB');

		// flips Y and Z
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.KEY_Z, 'ctrl+KeyY');
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.KEY_Y, 'ctrl+KeyZ');

		// Ctrl+/
		assertKeybindingTranslation(KeyMod.CtrlCmd | KeyCode.US_SLASH, 'ctrl+shift+Digit7');
	});

	test('resolveKeybinding Ctrl+A', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.KEY_A,
			[{
				label: 'Ctrl+A',
				ariaLabel: 'Control+A',
				electronAccelerator: 'Ctrl+A',
				userSettingsLabel: 'ctrl+a',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[KeyA]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Z', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.KEY_Z,
			[{
				label: 'Ctrl+Z',
				ariaLabel: 'Control+Z',
				electronAccelerator: 'Ctrl+Z',
				userSettingsLabel: 'ctrl+z',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[KeyY]'],
			}]
		);
	});

	test('resolveKeyboardEvent Ctrl+[KeyY]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'KeyY'
			},
			{
				label: 'Ctrl+Z',
				ariaLabel: 'Control+Z',
				electronAccelerator: 'Ctrl+Z',
				userSettingsLabel: 'ctrl+z',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[KeyY]'],
			}
		);
	});

	test('resolveKeybinding Ctrl+]', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.US_CLOSE_SQUARE_BRACKET,
			[]
		);
	});

	test('resolveKeyboardEvent Ctrl+[BracketRight]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'BracketRight'
			},
			{
				label: 'Ctrl+¨',
				ariaLabel: 'Control+¨',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+[BracketRight]',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+[BracketRight]'],
			}
		);
	});

	test('resolveKeybinding Shift+]', () => {
		_assertResolveKeybinding(
			KeyMod.Shift | KeyCode.US_CLOSE_SQUARE_BRACKET,
			[{
				label: 'Ctrl+Alt+0',
				ariaLabel: 'Control+Alt+0',
				electronAccelerator: 'Ctrl+Alt+0',
				userSettingsLabel: 'ctrl+alt+0',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+alt+[Digit0]'],
			}, {
				label: 'Ctrl+Alt+$',
				ariaLabel: 'Control+Alt+$',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+alt+[Backslash]',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+alt+[Backslash]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+/', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.US_SLASH,
			[{
				label: 'Ctrl+Shift+7',
				ariaLabel: 'Control+Shift+7',
				electronAccelerator: 'Ctrl+Shift+7',
				userSettingsLabel: 'ctrl+shift+7',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+shift+[Digit7]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Shift+/', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_SLASH,
			[{
				label: 'Ctrl+Shift+\'',
				ariaLabel: 'Control+Shift+\'',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+shift+[Minus]',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+shift+[Minus]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+K Ctrl+\\', () => {
		_assertResolveKeybinding(
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_BACKSLASH),
			[]
		);
	});

	test('resolveKeybinding Ctrl+K Ctrl+=', () => {
		_assertResolveKeybinding(
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_EQUAL),
			[{
				label: 'Ctrl+K Ctrl+Shift+0',
				ariaLabel: 'Control+K Control+Shift+0',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+k ctrl+shift+0',
				isWYSIWYG: true,
				isChord: true,
				dispatchParts: ['ctrl+[KeyK]', 'ctrl+shift+[Digit0]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+DownArrow', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.DownArrow,
			[{
				label: 'Ctrl+DownArrow',
				ariaLabel: 'Control+DownArrow',
				electronAccelerator: 'Ctrl+Down',
				userSettingsLabel: 'ctrl+down',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[ArrowDown]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+NUMPAD_0', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.NUMPAD_0,
			[{
				label: 'Ctrl+NumPad0',
				ariaLabel: 'Control+NumPad0',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+numpad0',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Numpad0]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Home', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.Home,
			[{
				label: 'Ctrl+Home',
				ariaLabel: 'Control+Home',
				electronAccelerator: 'Ctrl+Home',
				userSettingsLabel: 'ctrl+home',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Home]'],
			}]
		);
	});

	test('resolveKeyboardEvent Ctrl+[Home]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'Home'
			},
			{
				label: 'Ctrl+Home',
				ariaLabel: 'Control+Home',
				electronAccelerator: 'Ctrl+Home',
				userSettingsLabel: 'ctrl+home',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Home]'],
			}
		);
	});

	test('resolveKeyboardEvent Ctrl+[KeyX]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'KeyX'
			},
			{
				label: 'Ctrl+X',
				ariaLabel: 'Control+X',
				electronAccelerator: 'Ctrl+X',
				userSettingsLabel: 'ctrl+x',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[KeyX]'],
			}
		);
	});

	test('resolveUserBinding Ctrl+[Comma] Ctrl+/', () => {
		assertResolveUserBinding(
			mapper, [
			new ScanCodeBinding(true, false, false, false, ScanCode.Comma),
			new SimpleKeybinding(true, false, false, false, KeyCode.US_SLASH),
		],
			[{
				label: 'Ctrl+, Ctrl+Shift+7',
				ariaLabel: 'Control+, Control+Shift+7',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+[Comma] ctrl+shift+7',
				isWYSIWYG: false,
				isChord: true,
				dispatchParts: ['ctrl+[Comma]', 'ctrl+shift+[Digit7]'],
			}]
		);
	});

	test('resolveKeyboardEvent Modifier only ControlLeft+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'ControlLeft'
			},
			{
				label: 'Ctrl',
				ariaLabel: 'Control',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: [null],
			}
		);
	});

	test('resolveKeyboardEvent Modifier only ControlRight+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'ControlRight'
			},
			{
				label: 'Ctrl',
				ariaLabel: 'Control',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: [null],
			}
		);
	});
});

suite('keyboardMapper - LINUX en_us', () => {

	let mapper: MacLinuxKeyboardMapper;

	suiteSetup(async () => {
		const _mapper = await createKeyboardMapper(true, 'linux_en_us', OperatingSystem.Linux);
		mapper = _mapper;
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'linux_en_us.txt');
	});

	function _assertResolveKeybinding(k: number, expected: IResolvedKeybinding[]): void {
		assertResolveKeybinding(mapper, createKeybinding(k, OperatingSystem.Linux)!, expected);
	}

	test('resolveKeybinding Ctrl+A', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.KEY_A,
			[{
				label: 'Ctrl+A',
				ariaLabel: 'Control+A',
				electronAccelerator: 'Ctrl+A',
				userSettingsLabel: 'ctrl+a',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[KeyA]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Z', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.KEY_Z,
			[{
				label: 'Ctrl+Z',
				ariaLabel: 'Control+Z',
				electronAccelerator: 'Ctrl+Z',
				userSettingsLabel: 'ctrl+z',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[KeyZ]'],
			}]
		);
	});

	test('resolveKeyboardEvent Ctrl+[KeyZ]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'KeyZ'
			},
			{
				label: 'Ctrl+Z',
				ariaLabel: 'Control+Z',
				electronAccelerator: 'Ctrl+Z',
				userSettingsLabel: 'ctrl+z',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[KeyZ]'],
			}
		);
	});

	test('resolveKeybinding Ctrl+]', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.US_CLOSE_SQUARE_BRACKET,
			[{
				label: 'Ctrl+]',
				ariaLabel: 'Control+]',
				electronAccelerator: 'Ctrl+]',
				userSettingsLabel: 'ctrl+]',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[BracketRight]'],
			}]
		);
	});

	test('resolveKeyboardEvent Ctrl+[BracketRight]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'BracketRight'
			},
			{
				label: 'Ctrl+]',
				ariaLabel: 'Control+]',
				electronAccelerator: 'Ctrl+]',
				userSettingsLabel: 'ctrl+]',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[BracketRight]'],
			}
		);
	});

	test('resolveKeybinding Shift+]', () => {
		_assertResolveKeybinding(
			KeyMod.Shift | KeyCode.US_CLOSE_SQUARE_BRACKET,
			[{
				label: 'Shift+]',
				ariaLabel: 'Shift+]',
				electronAccelerator: 'Shift+]',
				userSettingsLabel: 'shift+]',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['shift+[BracketRight]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+/', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.US_SLASH,
			[{
				label: 'Ctrl+/',
				ariaLabel: 'Control+/',
				electronAccelerator: 'Ctrl+/',
				userSettingsLabel: 'ctrl+/',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Slash]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Shift+/', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_SLASH,
			[{
				label: 'Ctrl+Shift+/',
				ariaLabel: 'Control+Shift+/',
				electronAccelerator: 'Ctrl+Shift+/',
				userSettingsLabel: 'ctrl+shift+/',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+shift+[Slash]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+K Ctrl+\\', () => {
		_assertResolveKeybinding(
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_BACKSLASH),
			[{
				label: 'Ctrl+K Ctrl+\\',
				ariaLabel: 'Control+K Control+\\',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+k ctrl+\\',
				isWYSIWYG: true,
				isChord: true,
				dispatchParts: ['ctrl+[KeyK]', 'ctrl+[Backslash]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+K Ctrl+=', () => {
		_assertResolveKeybinding(
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_EQUAL),
			[{
				label: 'Ctrl+K Ctrl+=',
				ariaLabel: 'Control+K Control+=',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+k ctrl+=',
				isWYSIWYG: true,
				isChord: true,
				dispatchParts: ['ctrl+[KeyK]', 'ctrl+[Equal]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+DownArrow', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.DownArrow,
			[{
				label: 'Ctrl+DownArrow',
				ariaLabel: 'Control+DownArrow',
				electronAccelerator: 'Ctrl+Down',
				userSettingsLabel: 'ctrl+down',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[ArrowDown]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+NUMPAD_0', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.NUMPAD_0,
			[{
				label: 'Ctrl+NumPad0',
				ariaLabel: 'Control+NumPad0',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+numpad0',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Numpad0]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Home', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.Home,
			[{
				label: 'Ctrl+Home',
				ariaLabel: 'Control+Home',
				electronAccelerator: 'Ctrl+Home',
				userSettingsLabel: 'ctrl+home',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Home]'],
			}]
		);
	});

	test('resolveKeyboardEvent Ctrl+[Home]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'Home'
			},
			{
				label: 'Ctrl+Home',
				ariaLabel: 'Control+Home',
				electronAccelerator: 'Ctrl+Home',
				userSettingsLabel: 'ctrl+home',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Home]'],
			}
		);
	});

	test('resolveKeybinding Ctrl+Shift+,', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_COMMA,
			[{
				label: 'Ctrl+Shift+,',
				ariaLabel: 'Control+Shift+,',
				electronAccelerator: 'Ctrl+Shift+,',
				userSettingsLabel: 'ctrl+shift+,',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+shift+[Comma]'],
			}, {
				label: 'Ctrl+<',
				ariaLabel: 'Control+<',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+[IntlBackslash]',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+[IntlBackslash]'],
			}]
		);
	});

	test('issue #23393: resolveKeybinding Ctrl+Enter', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.Enter,
			[{
				label: 'Ctrl+Enter',
				ariaLabel: 'Control+Enter',
				electronAccelerator: 'Ctrl+Enter',
				userSettingsLabel: 'ctrl+enter',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Enter]'],
			}]
		);
	});

	test('issue #23393: resolveKeyboardEvent Ctrl+[NumpadEnter]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'NumpadEnter'
			},
			{
				label: 'Ctrl+Enter',
				ariaLabel: 'Control+Enter',
				electronAccelerator: 'Ctrl+Enter',
				userSettingsLabel: 'ctrl+enter',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Enter]'],
			}
		);
	});

	test('resolveUserBinding Ctrl+[Comma] Ctrl+/', () => {
		assertResolveUserBinding(
			mapper, [
			new ScanCodeBinding(true, false, false, false, ScanCode.Comma),
			new SimpleKeybinding(true, false, false, false, KeyCode.US_SLASH),
		],
			[{
				label: 'Ctrl+, Ctrl+/',
				ariaLabel: 'Control+, Control+/',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+, ctrl+/',
				isWYSIWYG: true,
				isChord: true,
				dispatchParts: ['ctrl+[Comma]', 'ctrl+[Slash]'],
			}]
		);
	});

	test('resolveUserBinding Ctrl+[Comma]', () => {
		assertResolveUserBinding(
			mapper, [
			new ScanCodeBinding(true, false, false, false, ScanCode.Comma)
		],
			[{
				label: 'Ctrl+,',
				ariaLabel: 'Control+,',
				electronAccelerator: 'Ctrl+,',
				userSettingsLabel: 'ctrl+,',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Comma]'],
			}]
		);
	});

	test('resolveKeyboardEvent Modifier only ControlLeft+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'ControlLeft'
			},
			{
				label: 'Ctrl',
				ariaLabel: 'Control',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: [null],
			}
		);
	});

	test('resolveKeyboardEvent Modifier only ControlRight+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'ControlRight'
			},
			{
				label: 'Ctrl',
				ariaLabel: 'Control',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: [null],
			}
		);
	});
});

suite('keyboardMapper', () => {

	test('issue #23706: Linux UK layout: Ctrl + Apostrophe also toggles terminal', () => {
		let mapper = new MacLinuxKeyboardMapper(false, {
			'Backquote': {
				'value': '`',
				'withShift': '¬',
				'withAltGr': '|',
				'withShiftAltGr': '|'
			}
		}, OperatingSystem.Linux);

		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: -1,
				code: 'Backquote'
			},
			{
				label: 'Ctrl+`',
				ariaLabel: 'Control+`',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+`',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[Backquote]'],
			}
		);
	});

	test('issue #24064: NumLock/NumPad keys stopped working in 1.11 on Linux', () => {
		let mapper = new MacLinuxKeyboardMapper(false, {}, OperatingSystem.Linux);

		function assertNumpadKeyboardEvent(keyCode: KeyCode, code: string, label: string, electronAccelerator: string | null, userSettingsLabel: string, dispatch: string): void {
			assertResolveKeyboardEvent(
				mapper,
				{
					_standardKeyboardEventBrand: true,
					ctrlKey: false,
					shiftKey: false,
					altKey: false,
					metaKey: false,
					keyCode: keyCode,
					code: code
				},
				{
					label: label,
					ariaLabel: label,
					electronAccelerator: electronAccelerator,
					userSettingsLabel: userSettingsLabel,
					isWYSIWYG: true,
					isChord: false,
					dispatchParts: [dispatch],
				}
			);
		}

		assertNumpadKeyboardEvent(KeyCode.End, 'Numpad1', 'End', 'End', 'end', '[End]');
		assertNumpadKeyboardEvent(KeyCode.DownArrow, 'Numpad2', 'DownArrow', 'Down', 'down', '[ArrowDown]');
		assertNumpadKeyboardEvent(KeyCode.PageDown, 'Numpad3', 'PageDown', 'PageDown', 'pagedown', '[PageDown]');
		assertNumpadKeyboardEvent(KeyCode.LeftArrow, 'Numpad4', 'LeftArrow', 'Left', 'left', '[ArrowLeft]');
		assertNumpadKeyboardEvent(KeyCode.Unknown, 'Numpad5', 'NumPad5', null!, 'numpad5', '[Numpad5]');
		assertNumpadKeyboardEvent(KeyCode.RightArrow, 'Numpad6', 'RightArrow', 'Right', 'right', '[ArrowRight]');
		assertNumpadKeyboardEvent(KeyCode.Home, 'Numpad7', 'Home', 'Home', 'home', '[Home]');
		assertNumpadKeyboardEvent(KeyCode.UpArrow, 'Numpad8', 'UpArrow', 'Up', 'up', '[ArrowUp]');
		assertNumpadKeyboardEvent(KeyCode.PageUp, 'Numpad9', 'PageUp', 'PageUp', 'pageup', '[PageUp]');
		assertNumpadKeyboardEvent(KeyCode.Insert, 'Numpad0', 'Insert', 'Insert', 'insert', '[Insert]');
		assertNumpadKeyboardEvent(KeyCode.Delete, 'NumpadDecimal', 'Delete', 'Delete', 'delete', '[Delete]');
	});

	test('issue #24107: Delete, Insert, Home, End, PgUp, PgDn, and arrow keys no longer work editor in 1.11', () => {
		let mapper = new MacLinuxKeyboardMapper(false, {}, OperatingSystem.Linux);

		function assertKeyboardEvent(keyCode: KeyCode, code: string, label: string, electronAccelerator: string, userSettingsLabel: string, dispatch: string): void {
			assertResolveKeyboardEvent(
				mapper,
				{
					_standardKeyboardEventBrand: true,
					ctrlKey: false,
					shiftKey: false,
					altKey: false,
					metaKey: false,
					keyCode: keyCode,
					code: code
				},
				{
					label: label,
					ariaLabel: label,
					electronAccelerator: electronAccelerator,
					userSettingsLabel: userSettingsLabel,
					isWYSIWYG: true,
					isChord: false,
					dispatchParts: [dispatch],
				}
			);
		}

		// https://github.com/microsoft/vscode/issues/24107#issuecomment-292318497
		assertKeyboardEvent(KeyCode.UpArrow, 'Lang3', 'UpArrow', 'Up', 'up', '[ArrowUp]');
		assertKeyboardEvent(KeyCode.DownArrow, 'NumpadEnter', 'DownArrow', 'Down', 'down', '[ArrowDown]');
		assertKeyboardEvent(KeyCode.LeftArrow, 'Convert', 'LeftArrow', 'Left', 'left', '[ArrowLeft]');
		assertKeyboardEvent(KeyCode.RightArrow, 'NonConvert', 'RightArrow', 'Right', 'right', '[ArrowRight]');
		assertKeyboardEvent(KeyCode.Delete, 'PrintScreen', 'Delete', 'Delete', 'delete', '[Delete]');
		assertKeyboardEvent(KeyCode.Insert, 'NumpadDivide', 'Insert', 'Insert', 'insert', '[Insert]');
		assertKeyboardEvent(KeyCode.End, 'Unknown', 'End', 'End', 'end', '[End]');
		assertKeyboardEvent(KeyCode.Home, 'IntlRo', 'Home', 'Home', 'home', '[Home]');
		assertKeyboardEvent(KeyCode.PageDown, 'ControlRight', 'PageDown', 'PageDown', 'pagedown', '[PageDown]');
		assertKeyboardEvent(KeyCode.PageUp, 'Lang4', 'PageUp', 'PageUp', 'pageup', '[PageUp]');

		// https://github.com/microsoft/vscode/issues/24107#issuecomment-292323924
		assertKeyboardEvent(KeyCode.PageDown, 'ControlRight', 'PageDown', 'PageDown', 'pagedown', '[PageDown]');
		assertKeyboardEvent(KeyCode.PageUp, 'Lang4', 'PageUp', 'PageUp', 'pageup', '[PageUp]');
		assertKeyboardEvent(KeyCode.End, '', 'End', 'End', 'end', '[End]');
		assertKeyboardEvent(KeyCode.Home, 'IntlRo', 'Home', 'Home', 'home', '[Home]');
		assertKeyboardEvent(KeyCode.Delete, 'PrintScreen', 'Delete', 'Delete', 'delete', '[Delete]');
		assertKeyboardEvent(KeyCode.Insert, 'NumpadDivide', 'Insert', 'Insert', 'insert', '[Insert]');
		assertKeyboardEvent(KeyCode.RightArrow, 'NonConvert', 'RightArrow', 'Right', 'right', '[ArrowRight]');
		assertKeyboardEvent(KeyCode.LeftArrow, 'Convert', 'LeftArrow', 'Left', 'left', '[ArrowLeft]');
		assertKeyboardEvent(KeyCode.DownArrow, 'NumpadEnter', 'DownArrow', 'Down', 'down', '[ArrowDown]');
		assertKeyboardEvent(KeyCode.UpArrow, 'Lang3', 'UpArrow', 'Up', 'up', '[ArrowUp]');
	});
});

suite('keyboardMapper - LINUX ru', () => {

	let mapper: MacLinuxKeyboardMapper;

	suiteSetup(async () => {
		const _mapper = await createKeyboardMapper(false, 'linux_ru', OperatingSystem.Linux);
		mapper = _mapper;
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'linux_ru.txt');
	});

	function _assertResolveKeybinding(k: number, expected: IResolvedKeybinding[]): void {
		assertResolveKeybinding(mapper, createKeybinding(k, OperatingSystem.Linux)!, expected);
	}

	test('resolveKeybinding Ctrl+S', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.KEY_S,
			[{
				label: 'Ctrl+S',
				ariaLabel: 'Control+S',
				electronAccelerator: 'Ctrl+S',
				userSettingsLabel: 'ctrl+s',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+[KeyS]'],
			}]
		);
	});
});

suite('keyboardMapper - LINUX en_uk', () => {

	let mapper: MacLinuxKeyboardMapper;

	suiteSetup(async () => {
		const _mapper = await createKeyboardMapper(false, 'linux_en_uk', OperatingSystem.Linux);
		mapper = _mapper;
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'linux_en_uk.txt');
	});

	test('issue #24522: resolveKeyboardEvent Ctrl+Alt+[Minus]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: true,
				metaKey: false,
				keyCode: -1,
				code: 'Minus'
			},
			{
				label: 'Ctrl+Alt+-',
				ariaLabel: 'Control+Alt+-',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+alt+[Minus]',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+alt+[Minus]'],
			}
		);
	});
});

suite('keyboardMapper - MAC zh_hant', () => {

	let mapper: MacLinuxKeyboardMapper;

	suiteSetup(async () => {
		const _mapper = await createKeyboardMapper(false, 'mac_zh_hant', OperatingSystem.Macintosh);
		mapper = _mapper;
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'mac_zh_hant.txt');
	});

	function _assertResolveKeybinding(k: number, expected: IResolvedKeybinding[]): void {
		assertResolveKeybinding(mapper, createKeybinding(k, OperatingSystem.Macintosh)!, expected);
	}

	test('issue #28237 resolveKeybinding Cmd+C', () => {
		_assertResolveKeybinding(
			KeyMod.CtrlCmd | KeyCode.KEY_C,
			[{
				label: '⌘C',
				ariaLabel: 'Command+C',
				electronAccelerator: 'Cmd+C',
				userSettingsLabel: 'cmd+c',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['meta+[KeyC]'],
			}]
		);
	});
});

function _assertKeybindingTranslation(mapper: MacLinuxKeyboardMapper, OS: OperatingSystem, kb: number, _expected: string | string[]): void {
	let expected: string[];
	if (typeof _expected === 'string') {
		expected = [_expected];
	} else if (Array.isArray(_expected)) {
		expected = _expected;
	} else {
		expected = [];
	}

	const runtimeKeybinding = createSimpleKeybinding(kb, OS);

	const keybindingLabel = new USLayoutResolvedKeybinding(runtimeKeybinding.toChord(), OS).getUserSettingsLabel();

	const actualHardwareKeypresses = mapper.simpleKeybindingToScanCodeBinding(runtimeKeybinding);
	if (actualHardwareKeypresses.length === 0) {
		assert.deepEqual([], expected, `simpleKeybindingToHardwareKeypress -- "${keybindingLabel}" -- actual: "[]" -- expected: "${expected}"`);
		return;
	}

	const actual = actualHardwareKeypresses
		.map(k => UserSettingsLabelProvider.toLabel(OS, [k], (keybinding) => ScanCodeUtils.toString(keybinding.scanCode)));
	assert.deepEqual(actual, expected, `simpleKeybindingToHardwareKeypress -- "${keybindingLabel}" -- actual: "${actual}" -- expected: "${expected}"`);
}
