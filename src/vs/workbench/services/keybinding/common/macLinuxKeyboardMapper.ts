/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { KeyCode, KeyCodeUtils, Keybinding, ResolvedKeybinding, SimpleKeybinding } from 'vs/base/common/keyCodes';
import { OperatingSystem } from 'vs/base/common/platform';
import { IMMUTABLE_CODE_TO_KEY_CODE, IMMUTABLE_KEY_CODE_TO_CODE, ScanCode, ScanCodeBinding, ScanCodeUtils } from 'vs/base/common/scanCode';
import { IKeyboardEvent } from 'vs/platform/keybinding/common/keybinding';
import { IKeyboardMapper } from 'vs/platform/keyboardLayout/common/keyboardMapper';
import { BaseResolvedKeybinding } from 'vs/platform/keybinding/common/baseResolvedKeybinding';
import { IMacLinuxKeyboardMapping, IMacLinuxKeyMapping } from 'vs/platform/keyboardLayout/common/keyboardLayout';

/**
 * A map from character to key codes.
 * e.g. Contains entries such as:
 *  - '/' => { keyCode: KeyCode.US_SLASH, shiftKey: false }
 *  - '?' => { keyCode: KeyCode.US_SLASH, shiftKey: true }
 */
const CHAR_CODE_TO_KEY_CODE: ({ keyCode: KeyCode; shiftKey: boolean } | null)[] = [];

export class NativeResolvedKeybinding extends BaseResolvedKeybinding<ScanCodeBinding> {

	private readonly _mapper: MacLinuxKeyboardMapper;

	constructor(mapper: MacLinuxKeyboardMapper, os: OperatingSystem, parts: ScanCodeBinding[]) {
		super(os, parts);
		this._mapper = mapper;
	}

	protected _getLabel(keybinding: ScanCodeBinding): string | null {
		return this._mapper.getUILabelForScanCodeBinding(keybinding);
	}

	protected _getAriaLabel(keybinding: ScanCodeBinding): string | null {
		return this._mapper.getAriaLabelForScanCodeBinding(keybinding);
	}

	protected _getElectronAccelerator(keybinding: ScanCodeBinding): string | null {
		return this._mapper.getElectronAcceleratorLabelForScanCodeBinding(keybinding);
	}

	protected _getUserSettingsLabel(keybinding: ScanCodeBinding): string | null {
		return this._mapper.getUserSettingsLabelForScanCodeBinding(keybinding);
	}

	protected _isWYSIWYG(binding: ScanCodeBinding | null): boolean {
		if (!binding) {
			return true;
		}
		if (IMMUTABLE_CODE_TO_KEY_CODE[binding.scanCode] !== KeyCode.DependsOnKbLayout) {
			return true;
		}
		let a = this._mapper.getAriaLabelForScanCodeBinding(binding);
		let b = this._mapper.getUserSettingsLabelForScanCodeBinding(binding);

		if (!a && !b) {
			return true;
		}
		if (!a || !b) {
			return false;
		}
		return (a.toLowerCase() === b.toLowerCase());
	}

	protected _getDispatchPart(keybinding: ScanCodeBinding): string | null {
		return this._mapper.getDispatchStrForScanCodeBinding(keybinding);
	}

	protected _getSingleModifierDispatchPart(keybinding: ScanCodeBinding): string | null {
		if ((keybinding.scanCode === ScanCode.ControlLeft || keybinding.scanCode === ScanCode.ControlRight) && !keybinding.shiftKey && !keybinding.altKey && !keybinding.metaKey) {
			return 'ctrl';
		}
		if ((keybinding.scanCode === ScanCode.AltLeft || keybinding.scanCode === ScanCode.AltRight) && !keybinding.ctrlKey && !keybinding.shiftKey && !keybinding.metaKey) {
			return 'alt';
		}
		if ((keybinding.scanCode === ScanCode.ShiftLeft || keybinding.scanCode === ScanCode.ShiftRight) && !keybinding.ctrlKey && !keybinding.altKey && !keybinding.metaKey) {
			return 'shift';
		}
		if ((keybinding.scanCode === ScanCode.MetaLeft || keybinding.scanCode === ScanCode.MetaRight) && !keybinding.ctrlKey && !keybinding.shiftKey && !keybinding.altKey) {
			return 'meta';
		}
		return null;
	}
}

interface IScanCodeMapping {
	scanCode: ScanCode;
	value: number;
	withShift: number;
	withAltGr: number;
	withShiftAltGr: number;
}

class ScanCodeCombo {
	public readonly ctrlKey: boolean;
	public readonly shiftKey: boolean;
	public readonly altKey: boolean;
	public readonly scanCode: ScanCode;

	constructor(ctrlKey: boolean, shiftKey: boolean, altKey: boolean, scanCode: ScanCode) {
		this.ctrlKey = ctrlKey;
		this.shiftKey = shiftKey;
		this.altKey = altKey;
		this.scanCode = scanCode;
	}

	public toString(): string {
		return `${this.ctrlKey ? 'Ctrl+' : ''}${this.shiftKey ? 'Shift+' : ''}${this.altKey ? 'Alt+' : ''}${ScanCodeUtils.toString(this.scanCode)}`;
	}

	public equals(other: ScanCodeCombo): boolean {
		return (
			this.ctrlKey === other.ctrlKey
			&& this.shiftKey === other.shiftKey
			&& this.altKey === other.altKey
			&& this.scanCode === other.scanCode
		);
	}

	private getProducedCharCode(mapping: IMacLinuxKeyMapping): string {
		if (!mapping) {
			return '';
		}
		if (this.ctrlKey && this.shiftKey && this.altKey) {
			return mapping.withShiftAltGr;
		}
		if (this.ctrlKey && this.altKey) {
			return mapping.withAltGr;
		}
		if (this.shiftKey) {
			return mapping.withShift;
		}
		return mapping.value;
	}

	public getProducedChar(mapping: IMacLinuxKeyMapping): string {
		const charCode = MacLinuxKeyboardMapper.getCharCode(this.getProducedCharCode(mapping));
		if (charCode === 0) {
			return ' --- ';
		}
		if (charCode >= CharCode.U_Combining_Grave_Accent && charCode <= CharCode.U_Combining_Latin_Small_Letter_X) {
			// combining
			return 'U+' + charCode.toString(16);
		}
		return '  ' + String.fromCharCode(charCode) + '  ';
	}
}

class KeyCodeCombo {
	public readonly ctrlKey: boolean;
	public readonly shiftKey: boolean;
	public readonly altKey: boolean;
	public readonly keyCode: KeyCode;

	constructor(ctrlKey: boolean, shiftKey: boolean, altKey: boolean, keyCode: KeyCode) {
		this.ctrlKey = ctrlKey;
		this.shiftKey = shiftKey;
		this.altKey = altKey;
		this.keyCode = keyCode;
	}

	public toString(): string {
		return `${this.ctrlKey ? 'Ctrl+' : ''}${this.shiftKey ? 'Shift+' : ''}${this.altKey ? 'Alt+' : ''}${KeyCodeUtils.toString(this.keyCode)}`;
	}
}

class ScanCodeKeyCodeMapper {

	/**
	 * ScanCode combination => KeyCode combination.
	 * Only covers relevant modifiers ctrl, shift, alt (since meta does not influence the mappings).
	 */
	private readonly _scanCodeToKeyCode: number[][] = [];
	/**
	 * inverse of `_scanCodeToKeyCode`.
	 * KeyCode combination => ScanCode combination.
	 * Only covers relevant modifiers ctrl, shift, alt (since meta does not influence the mappings).
	 */
	private readonly _keyCodeToScanCode: number[][] = [];

	constructor() {
		this._scanCodeToKeyCode = [];
		this._keyCodeToScanCode = [];
	}

	public registrationComplete(): void {
		// IntlHash and IntlBackslash are rare keys, so ensure they don't end up being the preferred...
		this._moveToEnd(ScanCode.IntlHash);
		this._moveToEnd(ScanCode.IntlBackslash);
	}

	private _moveToEnd(scanCode: ScanCode): void {
		for (let mod = 0; mod < 8; mod++) {
			const encodedKeyCodeCombos = this._scanCodeToKeyCode[(scanCode << 3) + mod];
			if (!encodedKeyCodeCombos) {
				continue;
			}
			for (let i = 0, len = encodedKeyCodeCombos.length; i < len; i++) {
				const encodedScanCodeCombos = this._keyCodeToScanCode[encodedKeyCodeCombos[i]];
				if (encodedScanCodeCombos.length === 1) {
					continue;
				}
				for (let j = 0, len = encodedScanCodeCombos.length; j < len; j++) {
					const entry = encodedScanCodeCombos[j];
					const entryScanCode = (entry >>> 3);
					if (entryScanCode === scanCode) {
						// Move this entry to the end
						for (let k = j + 1; k < len; k++) {
							encodedScanCodeCombos[k - 1] = encodedScanCodeCombos[k];
						}
						encodedScanCodeCombos[len - 1] = entry;
					}
				}
			}
		}
	}

	public registerIfUnknown(scanCodeCombo: ScanCodeCombo, keyCodeCombo: KeyCodeCombo): void {
		if (keyCodeCombo.keyCode === KeyCode.Unknown) {
			return;
		}
		const scanCodeComboEncoded = this._encodeScanCodeCombo(scanCodeCombo);
		const keyCodeComboEncoded = this._encodeKeyCodeCombo(keyCodeCombo);

		const keyCodeIsDigit = (keyCodeCombo.keyCode >= KeyCode.KEY_0 && keyCodeCombo.keyCode <= KeyCode.KEY_9);
		const keyCodeIsLetter = (keyCodeCombo.keyCode >= KeyCode.KEY_A && keyCodeCombo.keyCode <= KeyCode.KEY_Z);

		const existingKeyCodeCombos = this._scanCodeToKeyCode[scanCodeComboEncoded];

		// Allow a scan code to map to multiple key codes if it is a digit or a letter key code
		if (keyCodeIsDigit || keyCodeIsLetter) {
			// Only check that we don't insert the same entry twice
			if (existingKeyCodeCombos) {
				for (let i = 0, len = existingKeyCodeCombos.length; i < len; i++) {
					if (existingKeyCodeCombos[i] === keyCodeComboEncoded) {
						// avoid duplicates
						return;
					}
				}
			}
		} else {
			// Don't allow multiples
			if (existingKeyCodeCombos && existingKeyCodeCombos.length !== 0) {
				return;
			}
		}

		this._scanCodeToKeyCode[scanCodeComboEncoded] = this._scanCodeToKeyCode[scanCodeComboEncoded] || [];
		this._scanCodeToKeyCode[scanCodeComboEncoded].unshift(keyCodeComboEncoded);

		this._keyCodeToScanCode[keyCodeComboEncoded] = this._keyCodeToScanCode[keyCodeComboEncoded] || [];
		this._keyCodeToScanCode[keyCodeComboEncoded].unshift(scanCodeComboEncoded);
	}

	public lookupKeyCodeCombo(keyCodeCombo: KeyCodeCombo): ScanCodeCombo[] {
		const keyCodeComboEncoded = this._encodeKeyCodeCombo(keyCodeCombo);
		const scanCodeCombosEncoded = this._keyCodeToScanCode[keyCodeComboEncoded];
		if (!scanCodeCombosEncoded || scanCodeCombosEncoded.length === 0) {
			return [];
		}

		let result: ScanCodeCombo[] = [];
		for (let i = 0, len = scanCodeCombosEncoded.length; i < len; i++) {
			const scanCodeComboEncoded = scanCodeCombosEncoded[i];

			const ctrlKey = (scanCodeComboEncoded & 0b001) ? true : false;
			const shiftKey = (scanCodeComboEncoded & 0b010) ? true : false;
			const altKey = (scanCodeComboEncoded & 0b100) ? true : false;
			const scanCode: ScanCode = (scanCodeComboEncoded >>> 3);

			result[i] = new ScanCodeCombo(ctrlKey, shiftKey, altKey, scanCode);
		}
		return result;
	}

	public lookupScanCodeCombo(scanCodeCombo: ScanCodeCombo): KeyCodeCombo[] {
		const scanCodeComboEncoded = this._encodeScanCodeCombo(scanCodeCombo);
		const keyCodeCombosEncoded = this._scanCodeToKeyCode[scanCodeComboEncoded];
		if (!keyCodeCombosEncoded || keyCodeCombosEncoded.length === 0) {
			return [];
		}

		let result: KeyCodeCombo[] = [];
		for (let i = 0, len = keyCodeCombosEncoded.length; i < len; i++) {
			const keyCodeComboEncoded = keyCodeCombosEncoded[i];

			const ctrlKey = (keyCodeComboEncoded & 0b001) ? true : false;
			const shiftKey = (keyCodeComboEncoded & 0b010) ? true : false;
			const altKey = (keyCodeComboEncoded & 0b100) ? true : false;
			const keyCode: KeyCode = (keyCodeComboEncoded >>> 3);

			result[i] = new KeyCodeCombo(ctrlKey, shiftKey, altKey, keyCode);
		}
		return result;
	}

	public guessStableKeyCode(scanCode: ScanCode): KeyCode {
		if (scanCode >= ScanCode.Digit1 && scanCode <= ScanCode.Digit0) {
			// digits are ok
			switch (scanCode) {
				case ScanCode.Digit1: return KeyCode.KEY_1;
				case ScanCode.Digit2: return KeyCode.KEY_2;
				case ScanCode.Digit3: return KeyCode.KEY_3;
				case ScanCode.Digit4: return KeyCode.KEY_4;
				case ScanCode.Digit5: return KeyCode.KEY_5;
				case ScanCode.Digit6: return KeyCode.KEY_6;
				case ScanCode.Digit7: return KeyCode.KEY_7;
				case ScanCode.Digit8: return KeyCode.KEY_8;
				case ScanCode.Digit9: return KeyCode.KEY_9;
				case ScanCode.Digit0: return KeyCode.KEY_0;
			}
		}

		// Lookup the scanCode with and without shift and see if the keyCode is stable
		const keyCodeCombos1 = this.lookupScanCodeCombo(new ScanCodeCombo(false, false, false, scanCode));
		const keyCodeCombos2 = this.lookupScanCodeCombo(new ScanCodeCombo(false, true, false, scanCode));
		if (keyCodeCombos1.length === 1 && keyCodeCombos2.length === 1) {
			const shiftKey1 = keyCodeCombos1[0].shiftKey;
			const keyCode1 = keyCodeCombos1[0].keyCode;
			const shiftKey2 = keyCodeCombos2[0].shiftKey;
			const keyCode2 = keyCodeCombos2[0].keyCode;
			if (keyCode1 === keyCode2 && shiftKey1 !== shiftKey2) {
				// This looks like a stable mapping
				return keyCode1;
			}
		}

		return KeyCode.DependsOnKbLayout;
	}

	private _encodeScanCodeCombo(scanCodeCombo: ScanCodeCombo): number {
		return this._encode(scanCodeCombo.ctrlKey, scanCodeCombo.shiftKey, scanCodeCombo.altKey, scanCodeCombo.scanCode);
	}

	private _encodeKeyCodeCombo(keyCodeCombo: KeyCodeCombo): number {
		return this._encode(keyCodeCombo.ctrlKey, keyCodeCombo.shiftKey, keyCodeCombo.altKey, keyCodeCombo.keyCode);
	}

	private _encode(ctrlKey: boolean, shiftKey: boolean, altKey: boolean, principal: number): number {
		return (
			((ctrlKey ? 1 : 0) << 0)
			| ((shiftKey ? 1 : 0) << 1)
			| ((altKey ? 1 : 0) << 2)
			| principal << 3
		) >>> 0;
	}
}

export class MacLinuxKeyboardMapper implements IKeyboardMapper {

	/**
	 * Is this the standard US keyboard layout?
	 */
	private readonly _isUSStandard: boolean;
	/**
	 * OS (can be Linux or Macintosh)
	 */
	private readonly _OS: OperatingSystem;
	/**
	 * used only for debug purposes.
	 */
	private readonly _codeInfo: IMacLinuxKeyMapping[];
	/**
	 * Maps ScanCode combos <-> KeyCode combos.
	 */
	private readonly _scanCodeKeyCodeMapper: ScanCodeKeyCodeMapper;
	/**
	 * UI label for a ScanCode.
	 */
	private readonly _scanCodeToLabel: Array<string | null> = [];
	/**
	 * Dispatching string for a ScanCode.
	 */
	private readonly _scanCodeToDispatch: Array<string | null> = [];

	constructor(isUSStandard: boolean, rawMappings: IMacLinuxKeyboardMapping, OS: OperatingSystem) {
		this._isUSStandard = isUSStandard;
		this._OS = OS;
		this._codeInfo = [];
		this._scanCodeKeyCodeMapper = new ScanCodeKeyCodeMapper();
		this._scanCodeToLabel = [];
		this._scanCodeToDispatch = [];

		const _registerIfUnknown = (
			hwCtrlKey: 0 | 1, hwShiftKey: 0 | 1, hwAltKey: 0 | 1, scanCode: ScanCode,
			kbCtrlKey: 0 | 1, kbShiftKey: 0 | 1, kbAltKey: 0 | 1, keyCode: KeyCode,
		): void => {
			this._scanCodeKeyCodeMapper.registerIfUnknown(
				new ScanCodeCombo(hwCtrlKey ? true : false, hwShiftKey ? true : false, hwAltKey ? true : false, scanCode),
				new KeyCodeCombo(kbCtrlKey ? true : false, kbShiftKey ? true : false, kbAltKey ? true : false, keyCode)
			);
		};

		const _registerAllCombos = (_ctrlKey: 0 | 1, _shiftKey: 0 | 1, _altKey: 0 | 1, scanCode: ScanCode, keyCode: KeyCode): void => {
			for (let ctrlKey = _ctrlKey; ctrlKey <= 1; ctrlKey++) {
				for (let shiftKey = _shiftKey; shiftKey <= 1; shiftKey++) {
					for (let altKey = _altKey; altKey <= 1; altKey++) {
						_registerIfUnknown(
							ctrlKey, shiftKey, altKey, scanCode,
							ctrlKey, shiftKey, altKey, keyCode
						);
					}
				}
			}
		};

		// Initialize `_scanCodeToLabel`
		for (let scanCode = ScanCode.None; scanCode < ScanCode.MAX_VALUE; scanCode++) {
			this._scanCodeToLabel[scanCode] = null;
		}

		// Initialize `_scanCodeToDispatch`
		for (let scanCode = ScanCode.None; scanCode < ScanCode.MAX_VALUE; scanCode++) {
			this._scanCodeToDispatch[scanCode] = null;
		}

		// Handle immutable mappings
		for (let scanCode = ScanCode.None; scanCode < ScanCode.MAX_VALUE; scanCode++) {
			const keyCode = IMMUTABLE_CODE_TO_KEY_CODE[scanCode];
			if (keyCode !== KeyCode.DependsOnKbLayout) {
				_registerAllCombos(0, 0, 0, scanCode, keyCode);
				this._scanCodeToLabel[scanCode] = KeyCodeUtils.toString(keyCode);

				if (keyCode === KeyCode.Unknown || keyCode === KeyCode.Ctrl || keyCode === KeyCode.Meta || keyCode === KeyCode.Alt || keyCode === KeyCode.Shift) {
					this._scanCodeToDispatch[scanCode] = null; // cannot dispatch on this ScanCode
				} else {
					this._scanCodeToDispatch[scanCode] = `[${ScanCodeUtils.toString(scanCode)}]`;
				}
			}
		}

		// Try to identify keyboard layouts where characters A-Z are missing
		// and forcibly map them to their corresponding scan codes if that is the case
		const missingLatinLettersOverride: { [scanCode: string]: IMacLinuxKeyMapping; } = {};

		{
			let producesLatinLetter: boolean[] = [];
			for (let strScanCode in rawMappings) {
				if (rawMappings.hasOwnProperty(strScanCode)) {
					const scanCode = ScanCodeUtils.toEnum(strScanCode);
					if (scanCode === ScanCode.None) {
						continue;
					}
					if (IMMUTABLE_CODE_TO_KEY_CODE[scanCode] !== KeyCode.DependsOnKbLayout) {
						continue;
					}

					const rawMapping = rawMappings[strScanCode];
					const value = MacLinuxKeyboardMapper.getCharCode(rawMapping.value);

					if (value >= CharCode.a && value <= CharCode.z) {
						const upperCaseValue = CharCode.A + (value - CharCode.a);
						producesLatinLetter[upperCaseValue] = true;
					}
				}
			}

			const _registerLetterIfMissing = (charCode: CharCode, scanCode: ScanCode, value: string, withShift: string): void => {
				if (!producesLatinLetter[charCode]) {
					missingLatinLettersOverride[ScanCodeUtils.toString(scanCode)] = {
						value: value,
						withShift: withShift,
						withAltGr: '',
						withShiftAltGr: ''
					};
				}
			};

			// Ensure letters are mapped
			_registerLetterIfMissing(CharCode.A, ScanCode.KeyA, 'a', 'A');
			_registerLetterIfMissing(CharCode.B, ScanCode.KeyB, 'b', 'B');
			_registerLetterIfMissing(CharCode.C, ScanCode.KeyC, 'c', 'C');
			_registerLetterIfMissing(CharCode.D, ScanCode.KeyD, 'd', 'D');
			_registerLetterIfMissing(CharCode.E, ScanCode.KeyE, 'e', 'E');
			_registerLetterIfMissing(CharCode.F, ScanCode.KeyF, 'f', 'F');
			_registerLetterIfMissing(CharCode.G, ScanCode.KeyG, 'g', 'G');
			_registerLetterIfMissing(CharCode.H, ScanCode.KeyH, 'h', 'H');
			_registerLetterIfMissing(CharCode.I, ScanCode.KeyI, 'i', 'I');
			_registerLetterIfMissing(CharCode.J, ScanCode.KeyJ, 'j', 'J');
			_registerLetterIfMissing(CharCode.K, ScanCode.KeyK, 'k', 'K');
			_registerLetterIfMissing(CharCode.L, ScanCode.KeyL, 'l', 'L');
			_registerLetterIfMissing(CharCode.M, ScanCode.KeyM, 'm', 'M');
			_registerLetterIfMissing(CharCode.N, ScanCode.KeyN, 'n', 'N');
			_registerLetterIfMissing(CharCode.O, ScanCode.KeyO, 'o', 'O');
			_registerLetterIfMissing(CharCode.P, ScanCode.KeyP, 'p', 'P');
			_registerLetterIfMissing(CharCode.Q, ScanCode.KeyQ, 'q', 'Q');
			_registerLetterIfMissing(CharCode.R, ScanCode.KeyR, 'r', 'R');
			_registerLetterIfMissing(CharCode.S, ScanCode.KeyS, 's', 'S');
			_registerLetterIfMissing(CharCode.T, ScanCode.KeyT, 't', 'T');
			_registerLetterIfMissing(CharCode.U, ScanCode.KeyU, 'u', 'U');
			_registerLetterIfMissing(CharCode.V, ScanCode.KeyV, 'v', 'V');
			_registerLetterIfMissing(CharCode.W, ScanCode.KeyW, 'w', 'W');
			_registerLetterIfMissing(CharCode.X, ScanCode.KeyX, 'x', 'X');
			_registerLetterIfMissing(CharCode.Y, ScanCode.KeyY, 'y', 'Y');
			_registerLetterIfMissing(CharCode.Z, ScanCode.KeyZ, 'z', 'Z');
		}

		let mappings: IScanCodeMapping[] = [], mappingsLen = 0;
		for (let strScanCode in rawMappings) {
			if (rawMappings.hasOwnProperty(strScanCode)) {
				const scanCode = ScanCodeUtils.toEnum(strScanCode);
				if (scanCode === ScanCode.None) {
					continue;
				}
				if (IMMUTABLE_CODE_TO_KEY_CODE[scanCode] !== KeyCode.DependsOnKbLayout) {
					continue;
				}

				this._codeInfo[scanCode] = rawMappings[strScanCode];

				const rawMapping = missingLatinLettersOverride[strScanCode] || rawMappings[strScanCode];
				const value = MacLinuxKeyboardMapper.getCharCode(rawMapping.value);
				const withShift = MacLinuxKeyboardMapper.getCharCode(rawMapping.withShift);
				const withAltGr = MacLinuxKeyboardMapper.getCharCode(rawMapping.withAltGr);
				const withShiftAltGr = MacLinuxKeyboardMapper.getCharCode(rawMapping.withShiftAltGr);

				const mapping: IScanCodeMapping = {
					scanCode: scanCode,
					value: value,
					withShift: withShift,
					withAltGr: withAltGr,
					withShiftAltGr: withShiftAltGr,
				};
				mappings[mappingsLen++] = mapping;

				this._scanCodeToDispatch[scanCode] = `[${ScanCodeUtils.toString(scanCode)}]`;

				if (value >= CharCode.a && value <= CharCode.z) {
					const upperCaseValue = CharCode.A + (value - CharCode.a);
					this._scanCodeToLabel[scanCode] = String.fromCharCode(upperCaseValue);
				} else if (value >= CharCode.A && value <= CharCode.Z) {
					this._scanCodeToLabel[scanCode] = String.fromCharCode(value);
				} else if (value) {
					this._scanCodeToLabel[scanCode] = String.fromCharCode(value);
				} else {
					this._scanCodeToLabel[scanCode] = null;
				}
			}
		}

		// Handle all `withShiftAltGr` entries
		for (let i = mappings.length - 1; i >= 0; i--) {
			const mapping = mappings[i];
			const scanCode = mapping.scanCode;
			const withShiftAltGr = mapping.withShiftAltGr;
			if (withShiftAltGr === mapping.withAltGr || withShiftAltGr === mapping.withShift || withShiftAltGr === mapping.value) {
				// handled below
				continue;
			}
			const kb = MacLinuxKeyboardMapper._charCodeToKb(withShiftAltGr);
			if (!kb) {
				continue;
			}
			const kbShiftKey = kb.shiftKey;
			const keyCode = kb.keyCode;

			if (kbShiftKey) {
				// Ctrl+Shift+Alt+ScanCode => Shift+KeyCode
				_registerIfUnknown(1, 1, 1, scanCode, 0, 1, 0, keyCode); //       Ctrl+Alt+ScanCode =>          Shift+KeyCode
			} else {
				// Ctrl+Shift+Alt+ScanCode => KeyCode
				_registerIfUnknown(1, 1, 1, scanCode, 0, 0, 0, keyCode); //       Ctrl+Alt+ScanCode =>                KeyCode
			}
		}
		// Handle all `withAltGr` entries
		for (let i = mappings.length - 1; i >= 0; i--) {
			const mapping = mappings[i];
			const scanCode = mapping.scanCode;
			const withAltGr = mapping.withAltGr;
			if (withAltGr === mapping.withShift || withAltGr === mapping.value) {
				// handled below
				continue;
			}
			const kb = MacLinuxKeyboardMapper._charCodeToKb(withAltGr);
			if (!kb) {
				continue;
			}
			const kbShiftKey = kb.shiftKey;
			const keyCode = kb.keyCode;

			if (kbShiftKey) {
				// Ctrl+Alt+ScanCode => Shift+KeyCode
				_registerIfUnknown(1, 0, 1, scanCode, 0, 1, 0, keyCode); //       Ctrl+Alt+ScanCode =>          Shift+KeyCode
			} else {
				// Ctrl+Alt+ScanCode => KeyCode
				_registerIfUnknown(1, 0, 1, scanCode, 0, 0, 0, keyCode); //       Ctrl+Alt+ScanCode =>                KeyCode
			}
		}
		// Handle all `withShift` entries
		for (let i = mappings.length - 1; i >= 0; i--) {
			const mapping = mappings[i];
			const scanCode = mapping.scanCode;
			const withShift = mapping.withShift;
			if (withShift === mapping.value) {
				// handled below
				continue;
			}
			const kb = MacLinuxKeyboardMapper._charCodeToKb(withShift);
			if (!kb) {
				continue;
			}
			const kbShiftKey = kb.shiftKey;
			const keyCode = kb.keyCode;

			if (kbShiftKey) {
				// Shift+ScanCode => Shift+KeyCode
				_registerIfUnknown(0, 1, 0, scanCode, 0, 1, 0, keyCode); //          Shift+ScanCode =>          Shift+KeyCode
				_registerIfUnknown(0, 1, 1, scanCode, 0, 1, 1, keyCode); //      Shift+Alt+ScanCode =>      Shift+Alt+KeyCode
				_registerIfUnknown(1, 1, 0, scanCode, 1, 1, 0, keyCode); //     Ctrl+Shift+ScanCode =>     Ctrl+Shift+KeyCode
				_registerIfUnknown(1, 1, 1, scanCode, 1, 1, 1, keyCode); // Ctrl+Shift+Alt+ScanCode => Ctrl+Shift+Alt+KeyCode
			} else {
				// Shift+ScanCode => KeyCode
				_registerIfUnknown(0, 1, 0, scanCode, 0, 0, 0, keyCode); //          Shift+ScanCode =>                KeyCode
				_registerIfUnknown(0, 1, 0, scanCode, 0, 1, 0, keyCode); //          Shift+ScanCode =>          Shift+KeyCode
				_registerIfUnknown(0, 1, 1, scanCode, 0, 0, 1, keyCode); //      Shift+Alt+ScanCode =>            Alt+KeyCode
				_registerIfUnknown(0, 1, 1, scanCode, 0, 1, 1, keyCode); //      Shift+Alt+ScanCode =>      Shift+Alt+KeyCode
				_registerIfUnknown(1, 1, 0, scanCode, 1, 0, 0, keyCode); //     Ctrl+Shift+ScanCode =>           Ctrl+KeyCode
				_registerIfUnknown(1, 1, 0, scanCode, 1, 1, 0, keyCode); //     Ctrl+Shift+ScanCode =>     Ctrl+Shift+KeyCode
				_registerIfUnknown(1, 1, 1, scanCode, 1, 0, 1, keyCode); // Ctrl+Shift+Alt+ScanCode =>       Ctrl+Alt+KeyCode
				_registerIfUnknown(1, 1, 1, scanCode, 1, 1, 1, keyCode); // Ctrl+Shift+Alt+ScanCode => Ctrl+Shift+Alt+KeyCode
			}
		}
		// Handle all `value` entries
		for (let i = mappings.length - 1; i >= 0; i--) {
			const mapping = mappings[i];
			const scanCode = mapping.scanCode;
			const kb = MacLinuxKeyboardMapper._charCodeToKb(mapping.value);
			if (!kb) {
				continue;
			}
			const kbShiftKey = kb.shiftKey;
			const keyCode = kb.keyCode;

			if (kbShiftKey) {
				// ScanCode => Shift+KeyCode
				_registerIfUnknown(0, 0, 0, scanCode, 0, 1, 0, keyCode); //                ScanCode =>          Shift+KeyCode
				_registerIfUnknown(0, 0, 1, scanCode, 0, 1, 1, keyCode); //            Alt+ScanCode =>      Shift+Alt+KeyCode
				_registerIfUnknown(1, 0, 0, scanCode, 1, 1, 0, keyCode); //           Ctrl+ScanCode =>     Ctrl+Shift+KeyCode
				_registerIfUnknown(1, 0, 1, scanCode, 1, 1, 1, keyCode); //       Ctrl+Alt+ScanCode => Ctrl+Shift+Alt+KeyCode
			} else {
				// ScanCode => KeyCode
				_registerIfUnknown(0, 0, 0, scanCode, 0, 0, 0, keyCode); //                ScanCode =>                KeyCode
				_registerIfUnknown(0, 0, 1, scanCode, 0, 0, 1, keyCode); //            Alt+ScanCode =>            Alt+KeyCode
				_registerIfUnknown(0, 1, 0, scanCode, 0, 1, 0, keyCode); //          Shift+ScanCode =>          Shift+KeyCode
				_registerIfUnknown(0, 1, 1, scanCode, 0, 1, 1, keyCode); //      Shift+Alt+ScanCode =>      Shift+Alt+KeyCode
				_registerIfUnknown(1, 0, 0, scanCode, 1, 0, 0, keyCode); //           Ctrl+ScanCode =>           Ctrl+KeyCode
				_registerIfUnknown(1, 0, 1, scanCode, 1, 0, 1, keyCode); //       Ctrl+Alt+ScanCode =>       Ctrl+Alt+KeyCode
				_registerIfUnknown(1, 1, 0, scanCode, 1, 1, 0, keyCode); //     Ctrl+Shift+ScanCode =>     Ctrl+Shift+KeyCode
				_registerIfUnknown(1, 1, 1, scanCode, 1, 1, 1, keyCode); // Ctrl+Shift+Alt+ScanCode => Ctrl+Shift+Alt+KeyCode
			}
		}
		// Handle all left-over available digits
		_registerAllCombos(0, 0, 0, ScanCode.Digit1, KeyCode.KEY_1);
		_registerAllCombos(0, 0, 0, ScanCode.Digit2, KeyCode.KEY_2);
		_registerAllCombos(0, 0, 0, ScanCode.Digit3, KeyCode.KEY_3);
		_registerAllCombos(0, 0, 0, ScanCode.Digit4, KeyCode.KEY_4);
		_registerAllCombos(0, 0, 0, ScanCode.Digit5, KeyCode.KEY_5);
		_registerAllCombos(0, 0, 0, ScanCode.Digit6, KeyCode.KEY_6);
		_registerAllCombos(0, 0, 0, ScanCode.Digit7, KeyCode.KEY_7);
		_registerAllCombos(0, 0, 0, ScanCode.Digit8, KeyCode.KEY_8);
		_registerAllCombos(0, 0, 0, ScanCode.Digit9, KeyCode.KEY_9);
		_registerAllCombos(0, 0, 0, ScanCode.Digit0, KeyCode.KEY_0);

		this._scanCodeKeyCodeMapper.registrationComplete();
	}

	public dumpDebugInfo(): string {
		let result: string[] = [];

		let immutableSamples = [
			ScanCode.ArrowUp,
			ScanCode.Numpad0
		];

		let cnt = 0;
		result.push(`isUSStandard: ${this._isUSStandard}`);
		result.push(`----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------`);
		for (let scanCode = ScanCode.None; scanCode < ScanCode.MAX_VALUE; scanCode++) {
			if (IMMUTABLE_CODE_TO_KEY_CODE[scanCode] !== KeyCode.DependsOnKbLayout) {
				if (immutableSamples.indexOf(scanCode) === -1) {
					continue;
				}
			}

			if (cnt % 4 === 0) {
				result.push(`|       HW Code combination      |  Key  |    KeyCode combination    | Pri |          UI label         |         User settings          |    Electron accelerator   |       Dispatching string       | WYSIWYG |`);
				result.push(`----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------`);
			}
			cnt++;

			const mapping = this._codeInfo[scanCode];

			for (let mod = 0; mod < 8; mod++) {
				const hwCtrlKey = (mod & 0b001) ? true : false;
				const hwShiftKey = (mod & 0b010) ? true : false;
				const hwAltKey = (mod & 0b100) ? true : false;
				const scanCodeCombo = new ScanCodeCombo(hwCtrlKey, hwShiftKey, hwAltKey, scanCode);
				const resolvedKb = this.resolveKeyboardEvent({
					_standardKeyboardEventBrand: true,
					ctrlKey: scanCodeCombo.ctrlKey,
					shiftKey: scanCodeCombo.shiftKey,
					altKey: scanCodeCombo.altKey,
					metaKey: false,
					keyCode: KeyCode.DependsOnKbLayout,
					code: ScanCodeUtils.toString(scanCode)
				});

				const outScanCodeCombo = scanCodeCombo.toString();
				const outKey = scanCodeCombo.getProducedChar(mapping);
				const ariaLabel = resolvedKb.getAriaLabel();
				const outUILabel = (ariaLabel ? ariaLabel.replace(/Control\+/, 'Ctrl+') : null);
				const outUserSettings = resolvedKb.getUserSettingsLabel();
				const outElectronAccelerator = resolvedKb.getElectronAccelerator();
				const outDispatchStr = resolvedKb.getDispatchParts()[0];

				const isWYSIWYG = (resolvedKb ? resolvedKb.isWYSIWYG() : false);
				const outWYSIWYG = (isWYSIWYG ? '       ' : '   NO  ');

				const kbCombos = this._scanCodeKeyCodeMapper.lookupScanCodeCombo(scanCodeCombo);
				if (kbCombos.length === 0) {
					result.push(`| ${this._leftPad(outScanCodeCombo, 30)} | ${outKey} | ${this._leftPad('', 25)} | ${this._leftPad('', 3)} | ${this._leftPad(outUILabel, 25)} | ${this._leftPad(outUserSettings, 30)} | ${this._leftPad(outElectronAccelerator, 25)} | ${this._leftPad(outDispatchStr, 30)} | ${outWYSIWYG} |`);
				} else {
					for (let i = 0, len = kbCombos.length; i < len; i++) {
						const kbCombo = kbCombos[i];
						// find out the priority of this scan code for this key code
						let colPriority: string;

						const scanCodeCombos = this._scanCodeKeyCodeMapper.lookupKeyCodeCombo(kbCombo);
						if (scanCodeCombos.length === 1) {
							// no need for priority, this key code combo maps to precisely this scan code combo
							colPriority = '';
						} else {
							let priority = -1;
							for (let j = 0; j < scanCodeCombos.length; j++) {
								if (scanCodeCombos[j].equals(scanCodeCombo)) {
									priority = j + 1;
									break;
								}
							}
							colPriority = String(priority);
						}

						const outKeybinding = kbCombo.toString();
						if (i === 0) {
							result.push(`| ${this._leftPad(outScanCodeCombo, 30)} | ${outKey} | ${this._leftPad(outKeybinding, 25)} | ${this._leftPad(colPriority, 3)} | ${this._leftPad(outUILabel, 25)} | ${this._leftPad(outUserSettings, 30)} | ${this._leftPad(outElectronAccelerator, 25)} | ${this._leftPad(outDispatchStr, 30)} | ${outWYSIWYG} |`);
						} else {
							// secondary keybindings
							result.push(`| ${this._leftPad('', 30)} |       | ${this._leftPad(outKeybinding, 25)} | ${this._leftPad(colPriority, 3)} | ${this._leftPad('', 25)} | ${this._leftPad('', 30)} | ${this._leftPad('', 25)} | ${this._leftPad('', 30)} |         |`);
						}
					}
				}

			}
			result.push(`----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------`);
		}

		return result.join('\n');
	}

	private _leftPad(str: string | null, cnt: number): string {
		if (str === null) {
			str = 'null';
		}
		while (str.length < cnt) {
			str = ' ' + str;
		}
		return str;
	}

	public simpleKeybindingToScanCodeBinding(keybinding: SimpleKeybinding): ScanCodeBinding[] {
		// Avoid double Enter bindings (both ScanCode.NumpadEnter and ScanCode.Enter point to KeyCode.Enter)
		if (keybinding.keyCode === KeyCode.Enter) {
			return [new ScanCodeBinding(keybinding.ctrlKey, keybinding.shiftKey, keybinding.altKey, keybinding.metaKey, ScanCode.Enter)];
		}

		const scanCodeCombos = this._scanCodeKeyCodeMapper.lookupKeyCodeCombo(
			new KeyCodeCombo(keybinding.ctrlKey, keybinding.shiftKey, keybinding.altKey, keybinding.keyCode)
		);

		let result: ScanCodeBinding[] = [];
		for (let i = 0, len = scanCodeCombos.length; i < len; i++) {
			const scanCodeCombo = scanCodeCombos[i];
			result[i] = new ScanCodeBinding(scanCodeCombo.ctrlKey, scanCodeCombo.shiftKey, scanCodeCombo.altKey, keybinding.metaKey, scanCodeCombo.scanCode);
		}
		return result;
	}

	public getUILabelForScanCodeBinding(binding: ScanCodeBinding | null): string | null {
		if (!binding) {
			return null;
		}
		if (binding.isDuplicateModifierCase()) {
			return '';
		}
		if (this._OS === OperatingSystem.Macintosh) {
			switch (binding.scanCode) {
				case ScanCode.ArrowLeft:
					return '←';
				case ScanCode.ArrowUp:
					return '↑';
				case ScanCode.ArrowRight:
					return '→';
				case ScanCode.ArrowDown:
					return '↓';
			}
		}
		return this._scanCodeToLabel[binding.scanCode];
	}

	public getAriaLabelForScanCodeBinding(binding: ScanCodeBinding | null): string | null {
		if (!binding) {
			return null;
		}
		if (binding.isDuplicateModifierCase()) {
			return '';
		}
		return this._scanCodeToLabel[binding.scanCode];
	}

	public getDispatchStrForScanCodeBinding(keypress: ScanCodeBinding): string | null {
		const codeDispatch = this._scanCodeToDispatch[keypress.scanCode];
		if (!codeDispatch) {
			return null;
		}
		let result = '';

		if (keypress.ctrlKey) {
			result += 'ctrl+';
		}
		if (keypress.shiftKey) {
			result += 'shift+';
		}
		if (keypress.altKey) {
			result += 'alt+';
		}
		if (keypress.metaKey) {
			result += 'meta+';
		}
		result += codeDispatch;

		return result;
	}

	public getUserSettingsLabelForScanCodeBinding(binding: ScanCodeBinding | null): string | null {
		if (!binding) {
			return null;
		}
		if (binding.isDuplicateModifierCase()) {
			return '';
		}

		const immutableKeyCode = IMMUTABLE_CODE_TO_KEY_CODE[binding.scanCode];
		if (immutableKeyCode !== KeyCode.DependsOnKbLayout) {
			return KeyCodeUtils.toUserSettingsUS(immutableKeyCode).toLowerCase();
		}

		// Check if this scanCode always maps to the same keyCode and back
		let constantKeyCode: KeyCode = this._scanCodeKeyCodeMapper.guessStableKeyCode(binding.scanCode);
		if (constantKeyCode !== KeyCode.DependsOnKbLayout) {
			// Verify that this is a good key code that can be mapped back to the same scan code
			let reverseBindings = this.simpleKeybindingToScanCodeBinding(new SimpleKeybinding(binding.ctrlKey, binding.shiftKey, binding.altKey, binding.metaKey, constantKeyCode));
			for (let i = 0, len = reverseBindings.length; i < len; i++) {
				const reverseBinding = reverseBindings[i];
				if (reverseBinding.scanCode === binding.scanCode) {
					return KeyCodeUtils.toUserSettingsUS(constantKeyCode).toLowerCase();
				}
			}
		}

		return this._scanCodeToDispatch[binding.scanCode];
	}

	private _getElectronLabelForKeyCode(keyCode: KeyCode): string | null {
		if (keyCode >= KeyCode.NUMPAD_0 && keyCode <= KeyCode.NUMPAD_DIVIDE) {
			// Electron cannot handle numpad keys
			return null;
		}

		switch (keyCode) {
			case KeyCode.UpArrow:
				return 'Up';
			case KeyCode.DownArrow:
				return 'Down';
			case KeyCode.LeftArrow:
				return 'Left';
			case KeyCode.RightArrow:
				return 'Right';
		}

		// electron menus always do the correct rendering on Windows
		return KeyCodeUtils.toString(keyCode);
	}

	public getElectronAcceleratorLabelForScanCodeBinding(binding: ScanCodeBinding | null): string | null {
		if (!binding) {
			return null;
		}
		if (binding.isDuplicateModifierCase()) {
			return null;
		}

		const immutableKeyCode = IMMUTABLE_CODE_TO_KEY_CODE[binding.scanCode];
		if (immutableKeyCode !== KeyCode.DependsOnKbLayout) {
			return this._getElectronLabelForKeyCode(immutableKeyCode);
		}

		// Check if this scanCode always maps to the same keyCode and back
		const constantKeyCode: KeyCode = this._scanCodeKeyCodeMapper.guessStableKeyCode(binding.scanCode);

		if (!this._isUSStandard) {
			// Electron cannot handle these key codes on anything else than standard US
			const isOEMKey = (
				constantKeyCode === KeyCode.US_SEMICOLON
				|| constantKeyCode === KeyCode.US_EQUAL
				|| constantKeyCode === KeyCode.US_COMMA
				|| constantKeyCode === KeyCode.US_MINUS
				|| constantKeyCode === KeyCode.US_DOT
				|| constantKeyCode === KeyCode.US_SLASH
				|| constantKeyCode === KeyCode.US_BACKTICK
				|| constantKeyCode === KeyCode.US_OPEN_SQUARE_BRACKET
				|| constantKeyCode === KeyCode.US_BACKSLASH
				|| constantKeyCode === KeyCode.US_CLOSE_SQUARE_BRACKET
			);

			if (isOEMKey) {
				return null;
			}
		}

		// See https://github.com/microsoft/vscode/issues/108880
		if (this._OS === OperatingSystem.Macintosh && binding.ctrlKey && !binding.metaKey && !binding.altKey && constantKeyCode === KeyCode.US_MINUS) {
			// ctrl+- and ctrl+shift+- render very similarly in native macOS menus, leading to confusion
			return null;
		}

		if (constantKeyCode !== KeyCode.DependsOnKbLayout) {
			return this._getElectronLabelForKeyCode(constantKeyCode);
		}

		return null;
	}

	public resolveKeybinding(keybinding: Keybinding): NativeResolvedKeybinding[] {
		let chordParts: ScanCodeBinding[][] = [];
		for (let part of keybinding.parts) {
			chordParts.push(this.simpleKeybindingToScanCodeBinding(part));
		}
		return this._toResolvedKeybinding(chordParts);
	}

	private _toResolvedKeybinding(chordParts: ScanCodeBinding[][]): NativeResolvedKeybinding[] {
		if (chordParts.length === 0) {
			return [];
		}
		let result: NativeResolvedKeybinding[] = [];
		this._generateResolvedKeybindings(chordParts, 0, [], result);
		return result;
	}

	private _generateResolvedKeybindings(chordParts: ScanCodeBinding[][], currentIndex: number, previousParts: ScanCodeBinding[], result: NativeResolvedKeybinding[]) {
		const chordPart = chordParts[currentIndex];
		const isFinalIndex = currentIndex === chordParts.length - 1;
		for (let i = 0, len = chordPart.length; i < len; i++) {
			let chords = [...previousParts, chordPart[i]];
			if (isFinalIndex) {
				result.push(new NativeResolvedKeybinding(this, this._OS, chords));
			} else {
				this._generateResolvedKeybindings(chordParts, currentIndex + 1, chords, result);
			}
		}
	}

	public resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): NativeResolvedKeybinding {
		let code = ScanCodeUtils.toEnum(keyboardEvent.code);

		// Treat NumpadEnter as Enter
		if (code === ScanCode.NumpadEnter) {
			code = ScanCode.Enter;
		}

		const keyCode = keyboardEvent.keyCode;

		if (
			(keyCode === KeyCode.LeftArrow)
			|| (keyCode === KeyCode.UpArrow)
			|| (keyCode === KeyCode.RightArrow)
			|| (keyCode === KeyCode.DownArrow)
			|| (keyCode === KeyCode.Delete)
			|| (keyCode === KeyCode.Insert)
			|| (keyCode === KeyCode.Home)
			|| (keyCode === KeyCode.End)
			|| (keyCode === KeyCode.PageDown)
			|| (keyCode === KeyCode.PageUp)
		) {
			// "Dispatch" on keyCode for these key codes to workaround issues with remote desktoping software
			// where the scan codes appear to be incorrect (see https://github.com/microsoft/vscode/issues/24107)
			const immutableScanCode = IMMUTABLE_KEY_CODE_TO_CODE[keyCode];
			if (immutableScanCode !== ScanCode.DependsOnKbLayout) {
				code = immutableScanCode;
			}

		} else {

			if (
				(code === ScanCode.Numpad1)
				|| (code === ScanCode.Numpad2)
				|| (code === ScanCode.Numpad3)
				|| (code === ScanCode.Numpad4)
				|| (code === ScanCode.Numpad5)
				|| (code === ScanCode.Numpad6)
				|| (code === ScanCode.Numpad7)
				|| (code === ScanCode.Numpad8)
				|| (code === ScanCode.Numpad9)
				|| (code === ScanCode.Numpad0)
				|| (code === ScanCode.NumpadDecimal)
			) {
				// "Dispatch" on keyCode for all numpad keys in order for NumLock to work correctly
				if (keyCode >= 0) {
					const immutableScanCode = IMMUTABLE_KEY_CODE_TO_CODE[keyCode];
					if (immutableScanCode !== ScanCode.DependsOnKbLayout) {
						code = immutableScanCode;
					}
				}
			}
		}

		const keypress = new ScanCodeBinding(keyboardEvent.ctrlKey, keyboardEvent.shiftKey, keyboardEvent.altKey, keyboardEvent.metaKey, code);
		return new NativeResolvedKeybinding(this, this._OS, [keypress]);
	}

	private _resolveSimpleUserBinding(binding: SimpleKeybinding | ScanCodeBinding | null): ScanCodeBinding[] {
		if (!binding) {
			return [];
		}
		if (binding instanceof ScanCodeBinding) {
			return [binding];
		}
		return this.simpleKeybindingToScanCodeBinding(binding);
	}

	public resolveUserBinding(input: (SimpleKeybinding | ScanCodeBinding)[]): ResolvedKeybinding[] {
		const parts: ScanCodeBinding[][] = input.map(keybinding => this._resolveSimpleUserBinding(keybinding));
		return this._toResolvedKeybinding(parts);
	}

	private static _charCodeToKb(charCode: number): { keyCode: KeyCode; shiftKey: boolean } | null {
		if (charCode < CHAR_CODE_TO_KEY_CODE.length) {
			return CHAR_CODE_TO_KEY_CODE[charCode];
		}
		return null;
	}

	/**
	 * Attempt to map a combining character to a regular one that renders the same way.
	 *
	 * To the brave person following me: Good Luck!
	 * https://www.compart.com/en/unicode/bidiclass/NSM
	 */
	public static getCharCode(char: string): number {
		if (char.length === 0) {
			return 0;
		}
		const charCode = char.charCodeAt(0);
		switch (charCode) {
			case CharCode.U_Combining_Grave_Accent: return CharCode.U_GRAVE_ACCENT;
			case CharCode.U_Combining_Acute_Accent: return CharCode.U_ACUTE_ACCENT;
			case CharCode.U_Combining_Circumflex_Accent: return CharCode.U_CIRCUMFLEX;
			case CharCode.U_Combining_Tilde: return CharCode.U_SMALL_TILDE;
			case CharCode.U_Combining_Macron: return CharCode.U_MACRON;
			case CharCode.U_Combining_Overline: return CharCode.U_OVERLINE;
			case CharCode.U_Combining_Breve: return CharCode.U_BREVE;
			case CharCode.U_Combining_Dot_Above: return CharCode.U_DOT_ABOVE;
			case CharCode.U_Combining_Diaeresis: return CharCode.U_DIAERESIS;
			case CharCode.U_Combining_Ring_Above: return CharCode.U_RING_ABOVE;
			case CharCode.U_Combining_Double_Acute_Accent: return CharCode.U_DOUBLE_ACUTE_ACCENT;
		}
		return charCode;
	}
}

(function () {
	function define(charCode: number, keyCode: KeyCode, shiftKey: boolean): void {
		for (let i = CHAR_CODE_TO_KEY_CODE.length; i < charCode; i++) {
			CHAR_CODE_TO_KEY_CODE[i] = null;
		}
		CHAR_CODE_TO_KEY_CODE[charCode] = { keyCode: keyCode, shiftKey: shiftKey };
	}

	for (let chCode = CharCode.A; chCode <= CharCode.Z; chCode++) {
		define(chCode, KeyCode.KEY_A + (chCode - CharCode.A), true);
	}

	for (let chCode = CharCode.a; chCode <= CharCode.z; chCode++) {
		define(chCode, KeyCode.KEY_A + (chCode - CharCode.a), false);
	}

	define(CharCode.Semicolon, KeyCode.US_SEMICOLON, false);
	define(CharCode.Colon, KeyCode.US_SEMICOLON, true);

	define(CharCode.Equals, KeyCode.US_EQUAL, false);
	define(CharCode.Plus, KeyCode.US_EQUAL, true);

	define(CharCode.Comma, KeyCode.US_COMMA, false);
	define(CharCode.LessThan, KeyCode.US_COMMA, true);

	define(CharCode.Dash, KeyCode.US_MINUS, false);
	define(CharCode.Underline, KeyCode.US_MINUS, true);

	define(CharCode.Period, KeyCode.US_DOT, false);
	define(CharCode.GreaterThan, KeyCode.US_DOT, true);

	define(CharCode.Slash, KeyCode.US_SLASH, false);
	define(CharCode.QuestionMark, KeyCode.US_SLASH, true);

	define(CharCode.BackTick, KeyCode.US_BACKTICK, false);
	define(CharCode.Tilde, KeyCode.US_BACKTICK, true);

	define(CharCode.OpenSquareBracket, KeyCode.US_OPEN_SQUARE_BRACKET, false);
	define(CharCode.OpenCurlyBrace, KeyCode.US_OPEN_SQUARE_BRACKET, true);

	define(CharCode.Backslash, KeyCode.US_BACKSLASH, false);
	define(CharCode.Pipe, KeyCode.US_BACKSLASH, true);

	define(CharCode.CloseSquareBracket, KeyCode.US_CLOSE_SQUARE_BRACKET, false);
	define(CharCode.CloseCurlyBrace, KeyCode.US_CLOSE_SQUARE_BRACKET, true);

	define(CharCode.SingleQuote, KeyCode.US_QUOTE, false);
	define(CharCode.DoubleQuote, KeyCode.US_QUOTE, true);
})();
