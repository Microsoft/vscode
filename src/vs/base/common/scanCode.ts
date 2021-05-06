/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode } from 'vs/base/common/keyCodes';

/**
 * keyboardEvent.code
 */
export const enum ScanCode {
	DependsOnKbLayout = -1,
	None,

	Hyper,
	Super,
	Fn,
	FnLock,
	Suspend,
	Resume,
	Turbo,
	Sleep,
	WakeUp,
	KeyA,
	KeyB,
	KeyC,
	KeyD,
	KeyE,
	KeyF,
	KeyG,
	KeyH,
	KeyI,
	KeyJ,
	KeyK,
	KeyL,
	KeyM,
	KeyN,
	KeyO,
	KeyP,
	KeyQ,
	KeyR,
	KeyS,
	KeyT,
	KeyU,
	KeyV,
	KeyW,
	KeyX,
	KeyY,
	KeyZ,
	Digit1,
	Digit2,
	Digit3,
	Digit4,
	Digit5,
	Digit6,
	Digit7,
	Digit8,
	Digit9,
	Digit0,
	Enter,
	Escape,
	Backspace,
	Tab,
	Space,
	Minus,
	Equal,
	BracketLeft,
	BracketRight,
	Backslash,
	IntlHash,
	Semicolon,
	Quote,
	Backquote,
	Comma,
	Period,
	Slash,
	CapsLock,
	F1,
	F2,
	F3,
	F4,
	F5,
	F6,
	F7,
	F8,
	F9,
	F10,
	F11,
	F12,
	PrintScreen,
	ScrollLock,
	Pause,
	Insert,
	Home,
	PageUp,
	Delete,
	End,
	PageDown,
	ArrowRight,
	ArrowLeft,
	ArrowDown,
	ArrowUp,
	NumLock,
	NumpadDivide,
	NumpadMultiply,
	NumpadSubtract,
	NumpadAdd,
	NumpadEnter,
	Numpad1,
	Numpad2,
	Numpad3,
	Numpad4,
	Numpad5,
	Numpad6,
	Numpad7,
	Numpad8,
	Numpad9,
	Numpad0,
	NumpadDecimal,
	IntlBackslash,
	ContextMenu,
	Power,
	NumpadEqual,
	F13,
	F14,
	F15,
	F16,
	F17,
	F18,
	F19,
	F20,
	F21,
	F22,
	F23,
	F24,
	Open,
	Help,
	Select,
	Again,
	Undo,
	Cut,
	Copy,
	Paste,
	Find,
	AudioVolumeMute,
	AudioVolumeUp,
	AudioVolumeDown,
	NumpadComma,
	IntlRo,
	KanaMode,
	IntlYen,
	Convert,
	NonConvert,
	Lang1,
	Lang2,
	Lang3,
	Lang4,
	Lang5,
	Abort,
	Props,
	NumpadParenLeft,
	NumpadParenRight,
	NumpadBackspace,
	NumpadMemoryStore,
	NumpadMemoryRecall,
	NumpadMemoryClear,
	NumpadMemoryAdd,
	NumpadMemorySubtract,
	NumpadClear,
	NumpadClearEntry,
	ControlLeft,
	ShiftLeft,
	AltLeft,
	MetaLeft,
	ControlRight,
	ShiftRight,
	AltRight,
	MetaRight,
	BrightnessUp,
	BrightnessDown,
	MediaPlay,
	MediaRecord,
	MediaFastForward,
	MediaRewind,
	MediaTrackNext,
	MediaTrackPrevious,
	MediaStop,
	Eject,
	MediaPlayPause,
	MediaSelect,
	LaunchMail,
	LaunchApp2,
	LaunchApp1,
	SelectTask,
	LaunchScreenSaver,
	BrowserSearch,
	BrowserHome,
	BrowserBack,
	BrowserForward,
	BrowserStop,
	BrowserRefresh,
	BrowserFavorites,
	ZoomToggle,
	MailReply,
	MailForward,
	MailSend,

	MAX_VALUE
}

const scanCodeIntToStr: string[] = [];
const scanCodeStrToInt: { [code: string]: number; } = Object.create(null);
const scanCodeLowerCaseStrToInt: { [code: string]: number; } = Object.create(null);

export const ScanCodeUtils = {
	lowerCaseToEnum: (scanCode: string) => scanCodeLowerCaseStrToInt[scanCode] || ScanCode.None,
	toEnum: (scanCode: string) => scanCodeStrToInt[scanCode] || ScanCode.None,
	toString: (scanCode: ScanCode) => scanCodeIntToStr[scanCode] || 'None'
};

/**
 * -1 if a ScanCode => KeyCode mapping depends on kb layout.
 */
export const IMMUTABLE_CODE_TO_KEY_CODE: KeyCode[] = [];

/**
 * -1 if a KeyCode => ScanCode mapping depends on kb layout.
 */
export const IMMUTABLE_KEY_CODE_TO_CODE: ScanCode[] = [];

export class ScanCodeBinding {
	public readonly ctrlKey: boolean;
	public readonly shiftKey: boolean;
	public readonly altKey: boolean;
	public readonly metaKey: boolean;
	public readonly scanCode: ScanCode;

	constructor(ctrlKey: boolean, shiftKey: boolean, altKey: boolean, metaKey: boolean, scanCode: ScanCode) {
		this.ctrlKey = ctrlKey;
		this.shiftKey = shiftKey;
		this.altKey = altKey;
		this.metaKey = metaKey;
		this.scanCode = scanCode;
	}

	public equals(other: ScanCodeBinding): boolean {
		return (
			this.ctrlKey === other.ctrlKey
			&& this.shiftKey === other.shiftKey
			&& this.altKey === other.altKey
			&& this.metaKey === other.metaKey
			&& this.scanCode === other.scanCode
		);
	}

	/**
	 * Does this keybinding refer to the key code of a modifier and it also has the modifier flag?
	 */
	public isDuplicateModifierCase(): boolean {
		return (
			(this.ctrlKey && (this.scanCode === ScanCode.ControlLeft || this.scanCode === ScanCode.ControlRight))
			|| (this.shiftKey && (this.scanCode === ScanCode.ShiftLeft || this.scanCode === ScanCode.ShiftRight))
			|| (this.altKey && (this.scanCode === ScanCode.AltLeft || this.scanCode === ScanCode.AltRight))
			|| (this.metaKey && (this.scanCode === ScanCode.MetaLeft || this.scanCode === ScanCode.MetaRight))
		);
	}
}

(function () {
	function d(intScanCode: ScanCode, strScanCode: string): void {
		scanCodeIntToStr[intScanCode] = strScanCode;
		scanCodeStrToInt[strScanCode] = intScanCode;
		scanCodeLowerCaseStrToInt[strScanCode.toLowerCase()] = intScanCode;
	}
	d(ScanCode.None, 'None');
	d(ScanCode.Hyper, 'Hyper');
	d(ScanCode.Super, 'Super');
	d(ScanCode.Fn, 'Fn');
	d(ScanCode.FnLock, 'FnLock');
	d(ScanCode.Suspend, 'Suspend');
	d(ScanCode.Resume, 'Resume');
	d(ScanCode.Turbo, 'Turbo');
	d(ScanCode.Sleep, 'Sleep');
	d(ScanCode.WakeUp, 'WakeUp');
	d(ScanCode.KeyA, 'KeyA');
	d(ScanCode.KeyB, 'KeyB');
	d(ScanCode.KeyC, 'KeyC');
	d(ScanCode.KeyD, 'KeyD');
	d(ScanCode.KeyE, 'KeyE');
	d(ScanCode.KeyF, 'KeyF');
	d(ScanCode.KeyG, 'KeyG');
	d(ScanCode.KeyH, 'KeyH');
	d(ScanCode.KeyI, 'KeyI');
	d(ScanCode.KeyJ, 'KeyJ');
	d(ScanCode.KeyK, 'KeyK');
	d(ScanCode.KeyL, 'KeyL');
	d(ScanCode.KeyM, 'KeyM');
	d(ScanCode.KeyN, 'KeyN');
	d(ScanCode.KeyO, 'KeyO');
	d(ScanCode.KeyP, 'KeyP');
	d(ScanCode.KeyQ, 'KeyQ');
	d(ScanCode.KeyR, 'KeyR');
	d(ScanCode.KeyS, 'KeyS');
	d(ScanCode.KeyT, 'KeyT');
	d(ScanCode.KeyU, 'KeyU');
	d(ScanCode.KeyV, 'KeyV');
	d(ScanCode.KeyW, 'KeyW');
	d(ScanCode.KeyX, 'KeyX');
	d(ScanCode.KeyY, 'KeyY');
	d(ScanCode.KeyZ, 'KeyZ');
	d(ScanCode.Digit1, 'Digit1');
	d(ScanCode.Digit2, 'Digit2');
	d(ScanCode.Digit3, 'Digit3');
	d(ScanCode.Digit4, 'Digit4');
	d(ScanCode.Digit5, 'Digit5');
	d(ScanCode.Digit6, 'Digit6');
	d(ScanCode.Digit7, 'Digit7');
	d(ScanCode.Digit8, 'Digit8');
	d(ScanCode.Digit9, 'Digit9');
	d(ScanCode.Digit0, 'Digit0');
	d(ScanCode.Enter, 'Enter');
	d(ScanCode.Escape, 'Escape');
	d(ScanCode.Backspace, 'Backspace');
	d(ScanCode.Tab, 'Tab');
	d(ScanCode.Space, 'Space');
	d(ScanCode.Minus, 'Minus');
	d(ScanCode.Equal, 'Equal');
	d(ScanCode.BracketLeft, 'BracketLeft');
	d(ScanCode.BracketRight, 'BracketRight');
	d(ScanCode.Backslash, 'Backslash');
	d(ScanCode.IntlHash, 'IntlHash');
	d(ScanCode.Semicolon, 'Semicolon');
	d(ScanCode.Quote, 'Quote');
	d(ScanCode.Backquote, 'Backquote');
	d(ScanCode.Comma, 'Comma');
	d(ScanCode.Period, 'Period');
	d(ScanCode.Slash, 'Slash');
	d(ScanCode.CapsLock, 'CapsLock');
	d(ScanCode.F1, 'F1');
	d(ScanCode.F2, 'F2');
	d(ScanCode.F3, 'F3');
	d(ScanCode.F4, 'F4');
	d(ScanCode.F5, 'F5');
	d(ScanCode.F6, 'F6');
	d(ScanCode.F7, 'F7');
	d(ScanCode.F8, 'F8');
	d(ScanCode.F9, 'F9');
	d(ScanCode.F10, 'F10');
	d(ScanCode.F11, 'F11');
	d(ScanCode.F12, 'F12');
	d(ScanCode.PrintScreen, 'PrintScreen');
	d(ScanCode.ScrollLock, 'ScrollLock');
	d(ScanCode.Pause, 'Pause');
	d(ScanCode.Insert, 'Insert');
	d(ScanCode.Home, 'Home');
	d(ScanCode.PageUp, 'PageUp');
	d(ScanCode.Delete, 'Delete');
	d(ScanCode.End, 'End');
	d(ScanCode.PageDown, 'PageDown');
	d(ScanCode.ArrowRight, 'ArrowRight');
	d(ScanCode.ArrowLeft, 'ArrowLeft');
	d(ScanCode.ArrowDown, 'ArrowDown');
	d(ScanCode.ArrowUp, 'ArrowUp');
	d(ScanCode.NumLock, 'NumLock');
	d(ScanCode.NumpadDivide, 'NumpadDivide');
	d(ScanCode.NumpadMultiply, 'NumpadMultiply');
	d(ScanCode.NumpadSubtract, 'NumpadSubtract');
	d(ScanCode.NumpadAdd, 'NumpadAdd');
	d(ScanCode.NumpadEnter, 'NumpadEnter');
	d(ScanCode.Numpad1, 'Numpad1');
	d(ScanCode.Numpad2, 'Numpad2');
	d(ScanCode.Numpad3, 'Numpad3');
	d(ScanCode.Numpad4, 'Numpad4');
	d(ScanCode.Numpad5, 'Numpad5');
	d(ScanCode.Numpad6, 'Numpad6');
	d(ScanCode.Numpad7, 'Numpad7');
	d(ScanCode.Numpad8, 'Numpad8');
	d(ScanCode.Numpad9, 'Numpad9');
	d(ScanCode.Numpad0, 'Numpad0');
	d(ScanCode.NumpadDecimal, 'NumpadDecimal');
	d(ScanCode.IntlBackslash, 'IntlBackslash');
	d(ScanCode.ContextMenu, 'ContextMenu');
	d(ScanCode.Power, 'Power');
	d(ScanCode.NumpadEqual, 'NumpadEqual');
	d(ScanCode.F13, 'F13');
	d(ScanCode.F14, 'F14');
	d(ScanCode.F15, 'F15');
	d(ScanCode.F16, 'F16');
	d(ScanCode.F17, 'F17');
	d(ScanCode.F18, 'F18');
	d(ScanCode.F19, 'F19');
	d(ScanCode.F20, 'F20');
	d(ScanCode.F21, 'F21');
	d(ScanCode.F22, 'F22');
	d(ScanCode.F23, 'F23');
	d(ScanCode.F24, 'F24');
	d(ScanCode.Open, 'Open');
	d(ScanCode.Help, 'Help');
	d(ScanCode.Select, 'Select');
	d(ScanCode.Again, 'Again');
	d(ScanCode.Undo, 'Undo');
	d(ScanCode.Cut, 'Cut');
	d(ScanCode.Copy, 'Copy');
	d(ScanCode.Paste, 'Paste');
	d(ScanCode.Find, 'Find');
	d(ScanCode.AudioVolumeMute, 'AudioVolumeMute');
	d(ScanCode.AudioVolumeUp, 'AudioVolumeUp');
	d(ScanCode.AudioVolumeDown, 'AudioVolumeDown');
	d(ScanCode.NumpadComma, 'NumpadComma');
	d(ScanCode.IntlRo, 'IntlRo');
	d(ScanCode.KanaMode, 'KanaMode');
	d(ScanCode.IntlYen, 'IntlYen');
	d(ScanCode.Convert, 'Convert');
	d(ScanCode.NonConvert, 'NonConvert');
	d(ScanCode.Lang1, 'Lang1');
	d(ScanCode.Lang2, 'Lang2');
	d(ScanCode.Lang3, 'Lang3');
	d(ScanCode.Lang4, 'Lang4');
	d(ScanCode.Lang5, 'Lang5');
	d(ScanCode.Abort, 'Abort');
	d(ScanCode.Props, 'Props');
	d(ScanCode.NumpadParenLeft, 'NumpadParenLeft');
	d(ScanCode.NumpadParenRight, 'NumpadParenRight');
	d(ScanCode.NumpadBackspace, 'NumpadBackspace');
	d(ScanCode.NumpadMemoryStore, 'NumpadMemoryStore');
	d(ScanCode.NumpadMemoryRecall, 'NumpadMemoryRecall');
	d(ScanCode.NumpadMemoryClear, 'NumpadMemoryClear');
	d(ScanCode.NumpadMemoryAdd, 'NumpadMemoryAdd');
	d(ScanCode.NumpadMemorySubtract, 'NumpadMemorySubtract');
	d(ScanCode.NumpadClear, 'NumpadClear');
	d(ScanCode.NumpadClearEntry, 'NumpadClearEntry');
	d(ScanCode.ControlLeft, 'ControlLeft');
	d(ScanCode.ShiftLeft, 'ShiftLeft');
	d(ScanCode.AltLeft, 'AltLeft');
	d(ScanCode.MetaLeft, 'MetaLeft');
	d(ScanCode.ControlRight, 'ControlRight');
	d(ScanCode.ShiftRight, 'ShiftRight');
	d(ScanCode.AltRight, 'AltRight');
	d(ScanCode.MetaRight, 'MetaRight');
	d(ScanCode.BrightnessUp, 'BrightnessUp');
	d(ScanCode.BrightnessDown, 'BrightnessDown');
	d(ScanCode.MediaPlay, 'MediaPlay');
	d(ScanCode.MediaRecord, 'MediaRecord');
	d(ScanCode.MediaFastForward, 'MediaFastForward');
	d(ScanCode.MediaRewind, 'MediaRewind');
	d(ScanCode.MediaTrackNext, 'MediaTrackNext');
	d(ScanCode.MediaTrackPrevious, 'MediaTrackPrevious');
	d(ScanCode.MediaStop, 'MediaStop');
	d(ScanCode.Eject, 'Eject');
	d(ScanCode.MediaPlayPause, 'MediaPlayPause');
	d(ScanCode.MediaSelect, 'MediaSelect');
	d(ScanCode.LaunchMail, 'LaunchMail');
	d(ScanCode.LaunchApp2, 'LaunchApp2');
	d(ScanCode.LaunchApp1, 'LaunchApp1');
	d(ScanCode.SelectTask, 'SelectTask');
	d(ScanCode.LaunchScreenSaver, 'LaunchScreenSaver');
	d(ScanCode.BrowserSearch, 'BrowserSearch');
	d(ScanCode.BrowserHome, 'BrowserHome');
	d(ScanCode.BrowserBack, 'BrowserBack');
	d(ScanCode.BrowserForward, 'BrowserForward');
	d(ScanCode.BrowserStop, 'BrowserStop');
	d(ScanCode.BrowserRefresh, 'BrowserRefresh');
	d(ScanCode.BrowserFavorites, 'BrowserFavorites');
	d(ScanCode.ZoomToggle, 'ZoomToggle');
	d(ScanCode.MailReply, 'MailReply');
	d(ScanCode.MailForward, 'MailForward');
	d(ScanCode.MailSend, 'MailSend');
})();

(function () {
	for (let i = 0; i <= ScanCode.MAX_VALUE; i++) {
		IMMUTABLE_CODE_TO_KEY_CODE[i] = KeyCode.DependsOnKbLayout;
	}

	for (let i = 0; i <= KeyCode.MAX_VALUE; i++) {
		IMMUTABLE_KEY_CODE_TO_CODE[i] = ScanCode.DependsOnKbLayout;
	}

	function define(code: ScanCode, keyCode: KeyCode): void {
		IMMUTABLE_CODE_TO_KEY_CODE[code] = keyCode;

		if (
			(keyCode !== KeyCode.Unknown)
			&& (keyCode !== KeyCode.Enter)
			&& (keyCode !== KeyCode.Ctrl)
			&& (keyCode !== KeyCode.Shift)
			&& (keyCode !== KeyCode.Alt)
			&& (keyCode !== KeyCode.Meta)
		) {
			IMMUTABLE_KEY_CODE_TO_CODE[keyCode] = code;
		}
	}

	// Manually added due to the exclusion above (due to duplication with NumpadEnter)
	IMMUTABLE_KEY_CODE_TO_CODE[KeyCode.Enter] = ScanCode.Enter;

	define(ScanCode.None, KeyCode.Unknown);
	define(ScanCode.Hyper, KeyCode.Unknown);
	define(ScanCode.Super, KeyCode.Unknown);
	define(ScanCode.Fn, KeyCode.Unknown);
	define(ScanCode.FnLock, KeyCode.Unknown);
	define(ScanCode.Suspend, KeyCode.Unknown);
	define(ScanCode.Resume, KeyCode.Unknown);
	define(ScanCode.Turbo, KeyCode.Unknown);
	define(ScanCode.Sleep, KeyCode.Unknown);
	define(ScanCode.WakeUp, KeyCode.Unknown);
	// define(ScanCode.KeyA, KeyCode.Unknown);
	// define(ScanCode.KeyB, KeyCode.Unknown);
	// define(ScanCode.KeyC, KeyCode.Unknown);
	// define(ScanCode.KeyD, KeyCode.Unknown);
	// define(ScanCode.KeyE, KeyCode.Unknown);
	// define(ScanCode.KeyF, KeyCode.Unknown);
	// define(ScanCode.KeyG, KeyCode.Unknown);
	// define(ScanCode.KeyH, KeyCode.Unknown);
	// define(ScanCode.KeyI, KeyCode.Unknown);
	// define(ScanCode.KeyJ, KeyCode.Unknown);
	// define(ScanCode.KeyK, KeyCode.Unknown);
	// define(ScanCode.KeyL, KeyCode.Unknown);
	// define(ScanCode.KeyM, KeyCode.Unknown);
	// define(ScanCode.KeyN, KeyCode.Unknown);
	// define(ScanCode.KeyO, KeyCode.Unknown);
	// define(ScanCode.KeyP, KeyCode.Unknown);
	// define(ScanCode.KeyQ, KeyCode.Unknown);
	// define(ScanCode.KeyR, KeyCode.Unknown);
	// define(ScanCode.KeyS, KeyCode.Unknown);
	// define(ScanCode.KeyT, KeyCode.Unknown);
	// define(ScanCode.KeyU, KeyCode.Unknown);
	// define(ScanCode.KeyV, KeyCode.Unknown);
	// define(ScanCode.KeyW, KeyCode.Unknown);
	// define(ScanCode.KeyX, KeyCode.Unknown);
	// define(ScanCode.KeyY, KeyCode.Unknown);
	// define(ScanCode.KeyZ, KeyCode.Unknown);
	// define(ScanCode.Digit1, KeyCode.Unknown);
	// define(ScanCode.Digit2, KeyCode.Unknown);
	// define(ScanCode.Digit3, KeyCode.Unknown);
	// define(ScanCode.Digit4, KeyCode.Unknown);
	// define(ScanCode.Digit5, KeyCode.Unknown);
	// define(ScanCode.Digit6, KeyCode.Unknown);
	// define(ScanCode.Digit7, KeyCode.Unknown);
	// define(ScanCode.Digit8, KeyCode.Unknown);
	// define(ScanCode.Digit9, KeyCode.Unknown);
	// define(ScanCode.Digit0, KeyCode.Unknown);
	define(ScanCode.Enter, KeyCode.Enter);
	define(ScanCode.Escape, KeyCode.Escape);
	define(ScanCode.Backspace, KeyCode.Backspace);
	define(ScanCode.Tab, KeyCode.Tab);
	define(ScanCode.Space, KeyCode.Space);
	// define(ScanCode.Minus, KeyCode.Unknown);
	// define(ScanCode.Equal, KeyCode.Unknown);
	// define(ScanCode.BracketLeft, KeyCode.Unknown);
	// define(ScanCode.BracketRight, KeyCode.Unknown);
	// define(ScanCode.Backslash, KeyCode.Unknown);
	// define(ScanCode.IntlHash, KeyCode.Unknown);
	// define(ScanCode.Semicolon, KeyCode.Unknown);
	// define(ScanCode.Quote, KeyCode.Unknown);
	// define(ScanCode.Backquote, KeyCode.Unknown);
	// define(ScanCode.Comma, KeyCode.Unknown);
	// define(ScanCode.Period, KeyCode.Unknown);
	// define(ScanCode.Slash, KeyCode.Unknown);
	define(ScanCode.CapsLock, KeyCode.CapsLock);
	define(ScanCode.F1, KeyCode.F1);
	define(ScanCode.F2, KeyCode.F2);
	define(ScanCode.F3, KeyCode.F3);
	define(ScanCode.F4, KeyCode.F4);
	define(ScanCode.F5, KeyCode.F5);
	define(ScanCode.F6, KeyCode.F6);
	define(ScanCode.F7, KeyCode.F7);
	define(ScanCode.F8, KeyCode.F8);
	define(ScanCode.F9, KeyCode.F9);
	define(ScanCode.F10, KeyCode.F10);
	define(ScanCode.F11, KeyCode.F11);
	define(ScanCode.F12, KeyCode.F12);
	define(ScanCode.PrintScreen, KeyCode.Unknown);
	define(ScanCode.ScrollLock, KeyCode.ScrollLock);
	define(ScanCode.Pause, KeyCode.PauseBreak);
	define(ScanCode.Insert, KeyCode.Insert);
	define(ScanCode.Home, KeyCode.Home);
	define(ScanCode.PageUp, KeyCode.PageUp);
	define(ScanCode.Delete, KeyCode.Delete);
	define(ScanCode.End, KeyCode.End);
	define(ScanCode.PageDown, KeyCode.PageDown);
	define(ScanCode.ArrowRight, KeyCode.RightArrow);
	define(ScanCode.ArrowLeft, KeyCode.LeftArrow);
	define(ScanCode.ArrowDown, KeyCode.DownArrow);
	define(ScanCode.ArrowUp, KeyCode.UpArrow);
	define(ScanCode.NumLock, KeyCode.NumLock);
	define(ScanCode.NumpadDivide, KeyCode.NUMPAD_DIVIDE);
	define(ScanCode.NumpadMultiply, KeyCode.NUMPAD_MULTIPLY);
	define(ScanCode.NumpadSubtract, KeyCode.NUMPAD_SUBTRACT);
	define(ScanCode.NumpadAdd, KeyCode.NUMPAD_ADD);
	define(ScanCode.NumpadEnter, KeyCode.Enter); // Duplicate
	define(ScanCode.Numpad1, KeyCode.NUMPAD_1);
	define(ScanCode.Numpad2, KeyCode.NUMPAD_2);
	define(ScanCode.Numpad3, KeyCode.NUMPAD_3);
	define(ScanCode.Numpad4, KeyCode.NUMPAD_4);
	define(ScanCode.Numpad5, KeyCode.NUMPAD_5);
	define(ScanCode.Numpad6, KeyCode.NUMPAD_6);
	define(ScanCode.Numpad7, KeyCode.NUMPAD_7);
	define(ScanCode.Numpad8, KeyCode.NUMPAD_8);
	define(ScanCode.Numpad9, KeyCode.NUMPAD_9);
	define(ScanCode.Numpad0, KeyCode.NUMPAD_0);
	define(ScanCode.NumpadDecimal, KeyCode.NUMPAD_DECIMAL);
	// define(ScanCode.IntlBackslash, KeyCode.Unknown);
	define(ScanCode.ContextMenu, KeyCode.ContextMenu);
	define(ScanCode.Power, KeyCode.Unknown);
	define(ScanCode.NumpadEqual, KeyCode.Unknown);
	define(ScanCode.F13, KeyCode.F13);
	define(ScanCode.F14, KeyCode.F14);
	define(ScanCode.F15, KeyCode.F15);
	define(ScanCode.F16, KeyCode.F16);
	define(ScanCode.F17, KeyCode.F17);
	define(ScanCode.F18, KeyCode.F18);
	define(ScanCode.F19, KeyCode.F19);
	define(ScanCode.F20, KeyCode.Unknown);
	define(ScanCode.F21, KeyCode.Unknown);
	define(ScanCode.F22, KeyCode.Unknown);
	define(ScanCode.F23, KeyCode.Unknown);
	define(ScanCode.F24, KeyCode.Unknown);
	define(ScanCode.Open, KeyCode.Unknown);
	define(ScanCode.Help, KeyCode.Unknown);
	define(ScanCode.Select, KeyCode.Unknown);
	define(ScanCode.Again, KeyCode.Unknown);
	define(ScanCode.Undo, KeyCode.Unknown);
	define(ScanCode.Cut, KeyCode.Unknown);
	define(ScanCode.Copy, KeyCode.Unknown);
	define(ScanCode.Paste, KeyCode.Unknown);
	define(ScanCode.Find, KeyCode.Unknown);
	define(ScanCode.AudioVolumeMute, KeyCode.Unknown);
	define(ScanCode.AudioVolumeUp, KeyCode.Unknown);
	define(ScanCode.AudioVolumeDown, KeyCode.Unknown);
	define(ScanCode.NumpadComma, KeyCode.NUMPAD_SEPARATOR);
	// define(ScanCode.IntlRo, KeyCode.Unknown);
	define(ScanCode.KanaMode, KeyCode.Unknown);
	// define(ScanCode.IntlYen, KeyCode.Unknown);
	define(ScanCode.Convert, KeyCode.Unknown);
	define(ScanCode.NonConvert, KeyCode.Unknown);
	define(ScanCode.Lang1, KeyCode.Unknown);
	define(ScanCode.Lang2, KeyCode.Unknown);
	define(ScanCode.Lang3, KeyCode.Unknown);
	define(ScanCode.Lang4, KeyCode.Unknown);
	define(ScanCode.Lang5, KeyCode.Unknown);
	define(ScanCode.Abort, KeyCode.Unknown);
	define(ScanCode.Props, KeyCode.Unknown);
	define(ScanCode.NumpadParenLeft, KeyCode.Unknown);
	define(ScanCode.NumpadParenRight, KeyCode.Unknown);
	define(ScanCode.NumpadBackspace, KeyCode.Unknown);
	define(ScanCode.NumpadMemoryStore, KeyCode.Unknown);
	define(ScanCode.NumpadMemoryRecall, KeyCode.Unknown);
	define(ScanCode.NumpadMemoryClear, KeyCode.Unknown);
	define(ScanCode.NumpadMemoryAdd, KeyCode.Unknown);
	define(ScanCode.NumpadMemorySubtract, KeyCode.Unknown);
	define(ScanCode.NumpadClear, KeyCode.Unknown);
	define(ScanCode.NumpadClearEntry, KeyCode.Unknown);
	define(ScanCode.ControlLeft, KeyCode.Ctrl); // Duplicate
	define(ScanCode.ShiftLeft, KeyCode.Shift); // Duplicate
	define(ScanCode.AltLeft, KeyCode.Alt); // Duplicate
	define(ScanCode.MetaLeft, KeyCode.Meta); // Duplicate
	define(ScanCode.ControlRight, KeyCode.Ctrl); // Duplicate
	define(ScanCode.ShiftRight, KeyCode.Shift); // Duplicate
	define(ScanCode.AltRight, KeyCode.Alt); // Duplicate
	define(ScanCode.MetaRight, KeyCode.Meta); // Duplicate
	define(ScanCode.BrightnessUp, KeyCode.Unknown);
	define(ScanCode.BrightnessDown, KeyCode.Unknown);
	define(ScanCode.MediaPlay, KeyCode.Unknown);
	define(ScanCode.MediaRecord, KeyCode.Unknown);
	define(ScanCode.MediaFastForward, KeyCode.Unknown);
	define(ScanCode.MediaRewind, KeyCode.Unknown);
	define(ScanCode.MediaTrackNext, KeyCode.Unknown);
	define(ScanCode.MediaTrackPrevious, KeyCode.Unknown);
	define(ScanCode.MediaStop, KeyCode.Unknown);
	define(ScanCode.Eject, KeyCode.Unknown);
	define(ScanCode.MediaPlayPause, KeyCode.Unknown);
	define(ScanCode.MediaSelect, KeyCode.Unknown);
	define(ScanCode.LaunchMail, KeyCode.Unknown);
	define(ScanCode.LaunchApp2, KeyCode.Unknown);
	define(ScanCode.LaunchApp1, KeyCode.Unknown);
	define(ScanCode.SelectTask, KeyCode.Unknown);
	define(ScanCode.LaunchScreenSaver, KeyCode.Unknown);
	define(ScanCode.BrowserSearch, KeyCode.Unknown);
	define(ScanCode.BrowserHome, KeyCode.Unknown);
	define(ScanCode.BrowserBack, KeyCode.Unknown);
	define(ScanCode.BrowserForward, KeyCode.Unknown);
	define(ScanCode.BrowserStop, KeyCode.Unknown);
	define(ScanCode.BrowserRefresh, KeyCode.Unknown);
	define(ScanCode.BrowserFavorites, KeyCode.Unknown);
	define(ScanCode.ZoomToggle, KeyCode.Unknown);
	define(ScanCode.MailReply, KeyCode.Unknown);
	define(ScanCode.MailForward, KeyCode.Unknown);
	define(ScanCode.MailSend, KeyCode.Unknown);
})();
