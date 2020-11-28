/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChordKeybinding, KeyCode, Keybinding, ResolvedKeybinding, SimpleKeybinding } from 'vs/base/common/keyCodes';
import { OperatingSystem } from 'vs/base/common/platform';
import { IMMUTABLE_CODE_TO_KEY_CODE, ScanCode, ScanCodeBinding } from 'vs/base/common/scanCode';
import { IKeyboardEvent } from 'vs/platform/keybinding/common/keybinding';
import { USLayoutResolvedKeybinding } from 'vs/platform/keybinding/common/usLayoutResolvedKeybinding';
import { IKeyboardMapper } from 'vs/platform/keyboardLayout/common/keyboardMapper';
import { removeElementsAfterNulls } from 'vs/platform/keybinding/common/resolvedKeybindingItem';

/**
 * A keyboard mapper to be used when reading the keymap from the OS fails.
 */
export class MacLinuxFallbackKeyboardMapper implements IKeyboardMapper {

	/**
	 * OS (can be Linux or Macintosh)
	 */
	private readonly _OS: OperatingSystem;

	constructor(OS: OperatingSystem) {
		this._OS = OS;
	}

	public dumpDebugInfo(): string {
		return 'FallbackKeyboardMapper dispatching on keyCode';
	}

	public resolveKeybinding(keybinding: Keybinding): ResolvedKeybinding[] {
		return [new USLayoutResolvedKeybinding(keybinding, this._OS)];
	}

	public resolveKeyboardEvent(keyboardEvent: IKeyboardEvent): ResolvedKeybinding {
		let keybinding = new SimpleKeybinding(
			keyboardEvent.ctrlKey,
			keyboardEvent.shiftKey,
			keyboardEvent.altKey,
			keyboardEvent.metaKey,
			keyboardEvent.keyCode
		);
		return new USLayoutResolvedKeybinding(keybinding.toChord(), this._OS);
	}

	private _scanCodeToKeyCode(scanCode: ScanCode): KeyCode {
		const immutableKeyCode = IMMUTABLE_CODE_TO_KEY_CODE[scanCode];
		if (immutableKeyCode !== -1) {
			return immutableKeyCode;
		}

		switch (scanCode) {
			case ScanCode.KeyA: return KeyCode.KEY_A;
			case ScanCode.KeyB: return KeyCode.KEY_B;
			case ScanCode.KeyC: return KeyCode.KEY_C;
			case ScanCode.KeyD: return KeyCode.KEY_D;
			case ScanCode.KeyE: return KeyCode.KEY_E;
			case ScanCode.KeyF: return KeyCode.KEY_F;
			case ScanCode.KeyG: return KeyCode.KEY_G;
			case ScanCode.KeyH: return KeyCode.KEY_H;
			case ScanCode.KeyI: return KeyCode.KEY_I;
			case ScanCode.KeyJ: return KeyCode.KEY_J;
			case ScanCode.KeyK: return KeyCode.KEY_K;
			case ScanCode.KeyL: return KeyCode.KEY_L;
			case ScanCode.KeyM: return KeyCode.KEY_M;
			case ScanCode.KeyN: return KeyCode.KEY_N;
			case ScanCode.KeyO: return KeyCode.KEY_O;
			case ScanCode.KeyP: return KeyCode.KEY_P;
			case ScanCode.KeyQ: return KeyCode.KEY_Q;
			case ScanCode.KeyR: return KeyCode.KEY_R;
			case ScanCode.KeyS: return KeyCode.KEY_S;
			case ScanCode.KeyT: return KeyCode.KEY_T;
			case ScanCode.KeyU: return KeyCode.KEY_U;
			case ScanCode.KeyV: return KeyCode.KEY_V;
			case ScanCode.KeyW: return KeyCode.KEY_W;
			case ScanCode.KeyX: return KeyCode.KEY_X;
			case ScanCode.KeyY: return KeyCode.KEY_Y;
			case ScanCode.KeyZ: return KeyCode.KEY_Z;
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
			case ScanCode.Minus: return KeyCode.US_MINUS;
			case ScanCode.Equal: return KeyCode.US_EQUAL;
			case ScanCode.BracketLeft: return KeyCode.US_OPEN_SQUARE_BRACKET;
			case ScanCode.BracketRight: return KeyCode.US_CLOSE_SQUARE_BRACKET;
			case ScanCode.Backslash: return KeyCode.US_BACKSLASH;
			case ScanCode.IntlHash: return KeyCode.Unknown; // missing
			case ScanCode.Semicolon: return KeyCode.US_SEMICOLON;
			case ScanCode.Quote: return KeyCode.US_QUOTE;
			case ScanCode.Backquote: return KeyCode.US_BACKTICK;
			case ScanCode.Comma: return KeyCode.US_COMMA;
			case ScanCode.Period: return KeyCode.US_DOT;
			case ScanCode.Slash: return KeyCode.US_SLASH;
			case ScanCode.IntlBackslash: return KeyCode.OEM_102;
		}
		return KeyCode.Unknown;
	}

	private _resolveSimpleUserBinding(binding: SimpleKeybinding | ScanCodeBinding | null): SimpleKeybinding | null {
		if (!binding) {
			return null;
		}
		if (binding instanceof SimpleKeybinding) {
			return binding;
		}
		const keyCode = this._scanCodeToKeyCode(binding.scanCode);
		if (keyCode === KeyCode.Unknown) {
			return null;
		}
		return new SimpleKeybinding(binding.ctrlKey, binding.shiftKey, binding.altKey, binding.metaKey, keyCode);
	}

	public resolveUserBinding(input: (SimpleKeybinding | ScanCodeBinding)[]): ResolvedKeybinding[] {
		const parts: SimpleKeybinding[] = removeElementsAfterNulls(input.map(keybinding => this._resolveSimpleUserBinding(keybinding)));
		if (parts.length > 0) {
			return [new USLayoutResolvedKeybinding(new ChordKeybinding(parts), this._OS)];
		}
		return [];
	}
}
