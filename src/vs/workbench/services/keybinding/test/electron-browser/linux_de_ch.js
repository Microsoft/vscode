/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

define({
	Sleep: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	WakeUp: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	KeyA: {
		value: 'a',
		withShift: 'A',
		withAltGr: 'æ',
		withShiftAltGr: 'Æ'
	},
	KeyB: {
		value: 'b',
		withShift: 'B',
		withAltGr: '”',
		withShiftAltGr: '’'
	},
	KeyC: {
		value: 'c',
		withShift: 'C',
		withAltGr: '¢',
		withShiftAltGr: '©'
	},
	KeyD: {
		value: 'd',
		withShift: 'D',
		withAltGr: 'ð',
		withShiftAltGr: 'Ð'
	},
	KeyE: {
		value: 'e',
		withShift: 'E',
		withAltGr: '€',
		withShiftAltGr: 'E'
	},
	KeyF: {
		value: 'f',
		withShift: 'F',
		withAltGr: 'đ',
		withShiftAltGr: 'ª'
	},
	KeyG: {
		value: 'g',
		withShift: 'G',
		withAltGr: 'ŋ',
		withShiftAltGr: 'Ŋ'
	},
	KeyH: {
		value: 'h',
		withShift: 'H',
		withAltGr: 'ħ',
		withShiftAltGr: 'Ħ'
	},
	KeyI: {
		value: 'i',
		withShift: 'I',
		withAltGr: '→',
		withShiftAltGr: 'ı'
	},
	KeyJ: {
		value: 'j',
		withShift: 'J',
		withAltGr: '̉',
		withShiftAltGr: '̛'
	},
	KeyK: {
		value: 'k',
		withShift: 'K',
		withAltGr: 'ĸ',
		withShiftAltGr: '&'
	},
	KeyL: {
		value: 'l',
		withShift: 'L',
		withAltGr: 'ł',
		withShiftAltGr: 'Ł'
	},
	KeyM: {
		value: 'm',
		withShift: 'M',
		withAltGr: 'µ',
		withShiftAltGr: 'º'
	},
	KeyN: {
		value: 'n',
		withShift: 'N',
		withAltGr: 'n',
		withShiftAltGr: 'N'
	},
	KeyO: {
		value: 'o',
		withShift: 'O',
		withAltGr: 'œ',
		withShiftAltGr: 'Œ'
	},
	KeyP: {
		value: 'p',
		withShift: 'P',
		withAltGr: 'þ',
		withShiftAltGr: 'Þ'
	},
	KeyQ: {
		value: 'q',
		withShift: 'Q',
		withAltGr: '@',
		withShiftAltGr: 'Ω'
	},
	KeyR: {
		value: 'r',
		withShift: 'R',
		withAltGr: '¶',
		withShiftAltGr: '®'
	},
	KeyS: {
		value: 's',
		withShift: 'S',
		withAltGr: 'ß',
		withShiftAltGr: '§'
	},
	KeyT: {
		value: 't',
		withShift: 'T',
		withAltGr: 'ŧ',
		withShiftAltGr: 'Ŧ'
	},
	KeyU: {
		value: 'u',
		withShift: 'U',
		withAltGr: '↓',
		withShiftAltGr: '↑'
	},
	KeyV: {
		value: 'v',
		withShift: 'V',
		withAltGr: '“',
		withShiftAltGr: '‘'
	},
	KeyW: {
		value: 'w',
		withShift: 'W',
		withAltGr: 'ł',
		withShiftAltGr: 'Ł'
	},
	KeyX: {
		value: 'x',
		withShift: 'X',
		withAltGr: '»',
		withShiftAltGr: '>'
	},
	KeyY: {
		value: 'z',
		withShift: 'Z',
		withAltGr: '←',
		withShiftAltGr: '¥'
	},
	KeyZ: {
		value: 'y',
		withShift: 'Y',
		withAltGr: '«',
		withShiftAltGr: '<'
	},
	Digit1: {
		value: '1',
		withShift: '+',
		withAltGr: '|',
		withShiftAltGr: '¡'
	},
	Digit2: {
		value: '2',
		withShift: '"',
		withAltGr: '@',
		withShiftAltGr: '⅛'
	},
	Digit3: {
		value: '3',
		withShift: '*',
		withAltGr: '#',
		withShiftAltGr: '£'
	},
	Digit4: {
		value: '4',
		withShift: 'ç',
		withAltGr: '¼',
		withShiftAltGr: '$'
	},
	Digit5: {
		value: '5',
		withShift: '%',
		withAltGr: '½',
		withShiftAltGr: '⅜'
	},
	Digit6: {
		value: '6',
		withShift: '&',
		withAltGr: '¬',
		withShiftAltGr: '⅝'
	},
	Digit7: {
		value: '7',
		withShift: '/',
		withAltGr: '|',
		withShiftAltGr: '⅞'
	},
	Digit8: {
		value: '8',
		withShift: '(',
		withAltGr: '¢',
		withShiftAltGr: '™'
	},
	Digit9: {
		value: '9',
		withShift: ')',
		withAltGr: ']',
		withShiftAltGr: '±'
	},
	Digit0: {
		value: '0',
		withShift: '=',
		withAltGr: '}',
		withShiftAltGr: '°'
	},
	Enter: {
		value: '\r',
		withShift: '\r',
		withAltGr: '\r',
		withShiftAltGr: '\r'
	},
	Escape: {
		value: '\u001b',
		withShift: '\u001b',
		withAltGr: '\u001b',
		withShiftAltGr: '\u001b'
	},
	Backspace: {
		value: '\b',
		withShift: '\b',
		withAltGr: '\b',
		withShiftAltGr: '\b'
	},
	Tab: {
		value: '\t',
		withShift: '',
		withAltGr: '\t',
		withShiftAltGr: ''
	},
	Space: {
		value: ' ',
		withShift: ' ',
		withAltGr: ' ',
		withShiftAltGr: ' '
	},
	Minus: {
		value: '\'',
		withShift: '?',
		withAltGr: '́',
		withShiftAltGr: '¿'
	},
	Equal: {
		value: '̂',
		withShift: '̀',
		withAltGr: '̃',
		withShiftAltGr: '̨'
	},
	BracketLeft: {
		value: 'ü',
		withShift: 'è',
		withAltGr: '[',
		withShiftAltGr: '̊'
	},
	BracketRight: {
		value: '̈',
		withShift: '!',
		withAltGr: ']',
		withShiftAltGr: '̄'
	},
	Backslash: {
		value: '$',
		withShift: '£',
		withAltGr: '}',
		withShiftAltGr: '̆'
	},
	Semicolon: {
		value: 'ö',
		withShift: 'é',
		withAltGr: '́',
		withShiftAltGr: '̋'
	},
	Quote: {
		value: 'ä',
		withShift: 'à',
		withAltGr: '{',
		withShiftAltGr: '̌'
	},
	Backquote: {
		value: '§',
		withShift: '°',
		withAltGr: '¬',
		withShiftAltGr: '¬'
	},
	Comma: {
		value: ',',
		withShift: ';',
		withAltGr: '─',
		withShiftAltGr: '×'
	},
	Period: {
		value: '.',
		withShift: ':',
		withAltGr: '·',
		withShiftAltGr: '÷'
	},
	Slash: {
		value: '-',
		withShift: '_',
		withAltGr: '̣',
		withShiftAltGr: '̇'
	},
	CapsLock: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F1: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F2: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F3: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F4: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F5: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F6: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F7: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F8: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F9: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F10: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F11: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F12: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	PrintScreen: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	ScrollLock: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Pause: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Insert: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Home: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	PageUp: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Delete: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	End: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	PageDown: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	ArrowRight: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	ArrowLeft: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	ArrowDown: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	ArrowUp: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	NumLock: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	NumpadDivide: {
		value: '/',
		withShift: '/',
		withAltGr: '/',
		withShiftAltGr: '/'
	},
	NumpadMultiply: {
		value: '*',
		withShift: '*',
		withAltGr: '*',
		withShiftAltGr: '*'
	},
	NumpadSubtract: {
		value: '-',
		withShift: '-',
		withAltGr: '-',
		withShiftAltGr: '-'
	},
	NumpadAdd: {
		value: '+',
		withShift: '+',
		withAltGr: '+',
		withShiftAltGr: '+'
	},
	NumpadEnter: {
		value: '\r',
		withShift: '\r',
		withAltGr: '\r',
		withShiftAltGr: '\r'
	},
	Numpad1: { value: '', withShift: '1', withAltGr: '', withShiftAltGr: '1' },
	Numpad2: { value: '', withShift: '2', withAltGr: '', withShiftAltGr: '2' },
	Numpad3: { value: '', withShift: '3', withAltGr: '', withShiftAltGr: '3' },
	Numpad4: { value: '', withShift: '4', withAltGr: '', withShiftAltGr: '4' },
	Numpad5: { value: '', withShift: '5', withAltGr: '', withShiftAltGr: '5' },
	Numpad6: { value: '', withShift: '6', withAltGr: '', withShiftAltGr: '6' },
	Numpad7: { value: '', withShift: '7', withAltGr: '', withShiftAltGr: '7' },
	Numpad8: { value: '', withShift: '8', withAltGr: '', withShiftAltGr: '8' },
	Numpad9: { value: '', withShift: '9', withAltGr: '', withShiftAltGr: '9' },
	Numpad0: { value: '', withShift: '0', withAltGr: '', withShiftAltGr: '0' },
	NumpadDecimal: { value: '', withShift: '.', withAltGr: '', withShiftAltGr: '.' },
	IntlBackslash: {
		value: '<',
		withShift: '>',
		withAltGr: '\\',
		withShiftAltGr: '¦'
	},
	ContextMenu: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Power: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	NumpadEqual: {
		value: '=',
		withShift: '=',
		withAltGr: '=',
		withShiftAltGr: '='
	},
	F13: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F14: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F15: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F16: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F17: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F18: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F19: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F20: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F21: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F22: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F23: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	F24: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Open: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Help: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Select: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Again: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Undo: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Cut: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Copy: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Paste: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Find: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	AudioVolumeMute: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	AudioVolumeUp: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	AudioVolumeDown: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	NumpadComma: {
		value: '.',
		withShift: '.',
		withAltGr: '.',
		withShiftAltGr: '.'
	},
	IntlRo: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	KanaMode: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	IntlYen: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Convert: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	NonConvert: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Lang1: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Lang2: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Lang3: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Lang4: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Lang5: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	NumpadParenLeft: {
		value: '(',
		withShift: '(',
		withAltGr: '(',
		withShiftAltGr: '('
	},
	NumpadParenRight: {
		value: ')',
		withShift: ')',
		withAltGr: ')',
		withShiftAltGr: ')'
	},
	ControlLeft: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	ShiftLeft: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	AltLeft: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MetaLeft: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	ControlRight: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	ShiftRight: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	AltRight: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MetaRight: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	BrightnessUp: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	BrightnessDown: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MediaPlay: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MediaRecord: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MediaFastForward: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MediaRewind: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MediaTrackNext: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MediaTrackPrevious: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MediaStop: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	Eject: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MediaPlayPause: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MediaSelect: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	LaunchMail: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	LaunchApp2: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	LaunchApp1: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	SelectTask: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	LaunchScreenSaver: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	BrowserSearch: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	BrowserHome: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	BrowserBack: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	BrowserForward: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	BrowserStop: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	BrowserRefresh: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	BrowserFavorites: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MailReply: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MailForward: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' },
	MailSend: { value: '', withShift: '', withAltGr: '', withShiftAltGr: '' }
});
