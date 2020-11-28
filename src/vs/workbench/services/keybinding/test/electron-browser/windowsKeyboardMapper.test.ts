/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyChord, KeyCode, KeyMod, SimpleKeybinding, createKeybinding } from 'vs/base/common/keyCodes';
import { OperatingSystem } from 'vs/base/common/platform';
import { ScanCode, ScanCodeBinding } from 'vs/base/common/scanCode';
import { WindowsKeyboardMapper } from 'vs/workbench/services/keybinding/common/windowsKeyboardMapper';
import { IResolvedKeybinding, assertMapping, assertResolveKeybinding, assertResolveKeyboardEvent, assertResolveUserBinding, readRawMapping } from 'vs/workbench/services/keybinding/test/electron-browser/keyboardMapperTestUtils';
import { IWindowsKeyboardMapping } from 'vs/platform/keyboardLayout/common/keyboardLayout';

const WRITE_FILE_IF_DIFFERENT = false;

async function createKeyboardMapper(isUSStandard: boolean, file: string): Promise<WindowsKeyboardMapper> {
	const rawMappings = await readRawMapping<IWindowsKeyboardMapping>(file);
	return new WindowsKeyboardMapper(isUSStandard, rawMappings);
}

function _assertResolveKeybinding(mapper: WindowsKeyboardMapper, k: number, expected: IResolvedKeybinding[]): void {
	const keyBinding = createKeybinding(k, OperatingSystem.Windows);
	assertResolveKeybinding(mapper, keyBinding!, expected);
}

suite('keyboardMapper - WINDOWS de_ch', () => {

	let mapper: WindowsKeyboardMapper;

	suiteSetup(async () => {
		mapper = await createKeyboardMapper(false, 'win_de_ch');
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'win_de_ch.txt');
	});

	test('resolveKeybinding Ctrl+A', () => {
		_assertResolveKeybinding(
			mapper,
			KeyMod.CtrlCmd | KeyCode.KEY_A,
			[{
				label: 'Ctrl+A',
				ariaLabel: 'Control+A',
				electronAccelerator: 'Ctrl+A',
				userSettingsLabel: 'ctrl+a',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+A'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Z', () => {
		_assertResolveKeybinding(
			mapper,
			KeyMod.CtrlCmd | KeyCode.KEY_Z,
			[{
				label: 'Ctrl+Z',
				ariaLabel: 'Control+Z',
				electronAccelerator: 'Ctrl+Z',
				userSettingsLabel: 'ctrl+z',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+Z'],
			}]
		);
	});

	test('resolveKeyboardEvent Ctrl+Z', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: KeyCode.KEY_Z,
				code: null!
			},
			{
				label: 'Ctrl+Z',
				ariaLabel: 'Control+Z',
				electronAccelerator: 'Ctrl+Z',
				userSettingsLabel: 'ctrl+z',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+Z'],
			}
		);
	});

	test('resolveKeybinding Ctrl+]', () => {
		_assertResolveKeybinding(
			mapper,
			KeyMod.CtrlCmd | KeyCode.US_CLOSE_SQUARE_BRACKET,
			[{
				label: 'Ctrl+^',
				ariaLabel: 'Control+^',
				electronAccelerator: 'Ctrl+]',
				userSettingsLabel: 'ctrl+oem_6',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+]'],
			}]
		);
	});

	test('resolveKeyboardEvent Ctrl+]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: KeyCode.US_CLOSE_SQUARE_BRACKET,
				code: null!
			},
			{
				label: 'Ctrl+^',
				ariaLabel: 'Control+^',
				electronAccelerator: 'Ctrl+]',
				userSettingsLabel: 'ctrl+oem_6',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+]'],
			}
		);
	});

	test('resolveKeybinding Shift+]', () => {
		_assertResolveKeybinding(
			mapper,
			KeyMod.Shift | KeyCode.US_CLOSE_SQUARE_BRACKET,
			[{
				label: 'Shift+^',
				ariaLabel: 'Shift+^',
				electronAccelerator: 'Shift+]',
				userSettingsLabel: 'shift+oem_6',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['shift+]'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+/', () => {
		_assertResolveKeybinding(
			mapper,
			KeyMod.CtrlCmd | KeyCode.US_SLASH,
			[{
				label: 'Ctrl+§',
				ariaLabel: 'Control+§',
				electronAccelerator: 'Ctrl+/',
				userSettingsLabel: 'ctrl+oem_2',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+/'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Shift+/', () => {
		_assertResolveKeybinding(
			mapper,
			KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_SLASH,
			[{
				label: 'Ctrl+Shift+§',
				ariaLabel: 'Control+Shift+§',
				electronAccelerator: 'Ctrl+Shift+/',
				userSettingsLabel: 'ctrl+shift+oem_2',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+shift+/'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+K Ctrl+\\', () => {
		_assertResolveKeybinding(
			mapper,
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_BACKSLASH),
			[{
				label: 'Ctrl+K Ctrl+ä',
				ariaLabel: 'Control+K Control+ä',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+k ctrl+oem_5',
				isWYSIWYG: false,
				isChord: true,
				dispatchParts: ['ctrl+K', 'ctrl+\\'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+K Ctrl+=', () => {
		_assertResolveKeybinding(
			mapper,
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_EQUAL),
			[]
		);
	});

	test('resolveKeybinding Ctrl+DownArrow', () => {
		_assertResolveKeybinding(
			mapper,
			KeyMod.CtrlCmd | KeyCode.DownArrow,
			[{
				label: 'Ctrl+DownArrow',
				ariaLabel: 'Control+DownArrow',
				electronAccelerator: 'Ctrl+Down',
				userSettingsLabel: 'ctrl+down',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+DownArrow'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+NUMPAD_0', () => {
		_assertResolveKeybinding(
			mapper,
			KeyMod.CtrlCmd | KeyCode.NUMPAD_0,
			[{
				label: 'Ctrl+NumPad0',
				ariaLabel: 'Control+NumPad0',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+numpad0',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+NumPad0'],
			}]
		);
	});

	test('resolveKeybinding Ctrl+Home', () => {
		_assertResolveKeybinding(
			mapper,
			KeyMod.CtrlCmd | KeyCode.Home,
			[{
				label: 'Ctrl+Home',
				ariaLabel: 'Control+Home',
				electronAccelerator: 'Ctrl+Home',
				userSettingsLabel: 'ctrl+home',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+Home'],
			}]
		);
	});

	test('resolveKeyboardEvent Ctrl+Home', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: KeyCode.Home,
				code: null!
			},
			{
				label: 'Ctrl+Home',
				ariaLabel: 'Control+Home',
				electronAccelerator: 'Ctrl+Home',
				userSettingsLabel: 'ctrl+home',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+Home'],
			}
		);
	});

	test('resolveUserBinding empty', () => {
		assertResolveUserBinding(mapper, [], []);
	});

	test('resolveUserBinding Ctrl+[Comma] Ctrl+/', () => {
		assertResolveUserBinding(
			mapper, [
			new ScanCodeBinding(true, false, false, false, ScanCode.Comma),
			new SimpleKeybinding(true, false, false, false, KeyCode.US_SLASH),
		],
			[{
				label: 'Ctrl+, Ctrl+§',
				ariaLabel: 'Control+, Control+§',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+oem_comma ctrl+oem_2',
				isWYSIWYG: false,
				isChord: true,
				dispatchParts: ['ctrl+,', 'ctrl+/'],
			}]
		);
	});

	test('resolveKeyboardEvent Modifier only Ctrl+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: KeyCode.Ctrl,
				code: null!
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

suite('keyboardMapper - WINDOWS en_us', () => {

	let mapper: WindowsKeyboardMapper;

	suiteSetup(async () => {
		mapper = await createKeyboardMapper(true, 'win_en_us');
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'win_en_us.txt');
	});

	test('resolveKeybinding Ctrl+K Ctrl+\\', () => {
		_assertResolveKeybinding(
			mapper,
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_BACKSLASH),
			[{
				label: 'Ctrl+K Ctrl+\\',
				ariaLabel: 'Control+K Control+\\',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+k ctrl+\\',
				isWYSIWYG: true,
				isChord: true,
				dispatchParts: ['ctrl+K', 'ctrl+\\'],
			}]
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
				dispatchParts: ['ctrl+,', 'ctrl+/'],
			}]
		);
	});

	test('resolveUserBinding Ctrl+[Comma]', () => {
		assertResolveUserBinding(
			mapper, [
			new ScanCodeBinding(true, false, false, false, ScanCode.Comma),
		],
			[{
				label: 'Ctrl+,',
				ariaLabel: 'Control+,',
				electronAccelerator: 'Ctrl+,',
				userSettingsLabel: 'ctrl+,',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+,'],
			}]
		);
	});

	test('resolveKeyboardEvent Modifier only Ctrl+', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: KeyCode.Ctrl,
				code: null!
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

suite('keyboardMapper - WINDOWS por_ptb', () => {

	let mapper: WindowsKeyboardMapper;

	suiteSetup(async () => {
		mapper = await createKeyboardMapper(false, 'win_por_ptb');
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'win_por_ptb.txt');
	});

	test('resolveKeyboardEvent Ctrl+[IntlRo]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: KeyCode.ABNT_C1,
				code: null!
			},
			{
				label: 'Ctrl+/',
				ariaLabel: 'Control+/',
				electronAccelerator: 'Ctrl+ABNT_C1',
				userSettingsLabel: 'ctrl+abnt_c1',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+ABNT_C1'],
			}
		);
	});

	test('resolveKeyboardEvent Ctrl+[NumpadComma]', () => {
		assertResolveKeyboardEvent(
			mapper,
			{
				_standardKeyboardEventBrand: true,
				ctrlKey: true,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				keyCode: KeyCode.ABNT_C2,
				code: null!
			},
			{
				label: 'Ctrl+.',
				ariaLabel: 'Control+.',
				electronAccelerator: 'Ctrl+ABNT_C2',
				userSettingsLabel: 'ctrl+abnt_c2',
				isWYSIWYG: false,
				isChord: false,
				dispatchParts: ['ctrl+ABNT_C2'],
			}
		);
	});
});

suite('keyboardMapper - WINDOWS ru', () => {

	let mapper: WindowsKeyboardMapper;

	suiteSetup(async () => {
		mapper = await createKeyboardMapper(false, 'win_ru');
	});

	test('mapping', () => {
		return assertMapping(WRITE_FILE_IF_DIFFERENT, mapper, 'win_ru.txt');
	});

	test('issue ##24361: resolveKeybinding Ctrl+K Ctrl+K', () => {
		_assertResolveKeybinding(
			mapper,
			KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_K),
			[{
				label: 'Ctrl+K Ctrl+K',
				ariaLabel: 'Control+K Control+K',
				electronAccelerator: null,
				userSettingsLabel: 'ctrl+k ctrl+k',
				isWYSIWYG: true,
				isChord: true,
				dispatchParts: ['ctrl+K', 'ctrl+K'],
			}]
		);
	});
});

suite('keyboardMapper - misc', () => {
	test('issue #23513: Toggle Sidebar Visibility and Go to Line display same key mapping in Arabic keyboard', () => {
		const mapper = new WindowsKeyboardMapper(false, {
			'KeyB': {
				'vkey': 'VK_B',
				'value': 'لا',
				'withShift': 'لآ',
				'withAltGr': '',
				'withShiftAltGr': ''
			},
			'KeyG': {
				'vkey': 'VK_G',
				'value': 'ل',
				'withShift': 'لأ',
				'withAltGr': '',
				'withShiftAltGr': ''
			}
		});

		_assertResolveKeybinding(
			mapper,
			KeyMod.CtrlCmd | KeyCode.KEY_B,
			[{
				label: 'Ctrl+B',
				ariaLabel: 'Control+B',
				electronAccelerator: 'Ctrl+B',
				userSettingsLabel: 'ctrl+b',
				isWYSIWYG: true,
				isChord: false,
				dispatchParts: ['ctrl+B'],
			}]
		);
	});
});
