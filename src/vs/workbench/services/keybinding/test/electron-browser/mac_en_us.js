/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

define({
	KeyA: {
		value: 'a',
		valueIsDeadKey: false,
		withShift: 'A',
		withShiftIsDeadKey: false,
		withAltGr: 'å',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Å',
		withShiftAltGrIsDeadKey: false
	},
	KeyB: {
		value: 'b',
		valueIsDeadKey: false,
		withShift: 'B',
		withShiftIsDeadKey: false,
		withAltGr: '∫',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'ı',
		withShiftAltGrIsDeadKey: false
	},
	KeyC: {
		value: 'c',
		valueIsDeadKey: false,
		withShift: 'C',
		withShiftIsDeadKey: false,
		withAltGr: 'ç',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Ç',
		withShiftAltGrIsDeadKey: false
	},
	KeyD: {
		value: 'd',
		valueIsDeadKey: false,
		withShift: 'D',
		withShiftIsDeadKey: false,
		withAltGr: '∂',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Î',
		withShiftAltGrIsDeadKey: false
	},
	KeyE: {
		value: 'e',
		valueIsDeadKey: false,
		withShift: 'E',
		withShiftIsDeadKey: false,
		withAltGr: '´',
		withAltGrIsDeadKey: true,
		withShiftAltGr: '´',
		withShiftAltGrIsDeadKey: false
	},
	KeyF: {
		value: 'f',
		valueIsDeadKey: false,
		withShift: 'F',
		withShiftIsDeadKey: false,
		withAltGr: 'ƒ',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Ï',
		withShiftAltGrIsDeadKey: false
	},
	KeyG: {
		value: 'g',
		valueIsDeadKey: false,
		withShift: 'G',
		withShiftIsDeadKey: false,
		withAltGr: '©',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '˝',
		withShiftAltGrIsDeadKey: false
	},
	KeyH: {
		value: 'h',
		valueIsDeadKey: false,
		withShift: 'H',
		withShiftIsDeadKey: false,
		withAltGr: '˙',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Ó',
		withShiftAltGrIsDeadKey: false
	},
	KeyI: {
		value: 'i',
		valueIsDeadKey: false,
		withShift: 'I',
		withShiftIsDeadKey: false,
		withAltGr: 'ˆ',
		withAltGrIsDeadKey: true,
		withShiftAltGr: 'ˆ',
		withShiftAltGrIsDeadKey: false
	},
	KeyJ: {
		value: 'j',
		valueIsDeadKey: false,
		withShift: 'J',
		withShiftIsDeadKey: false,
		withAltGr: '∆',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Ô',
		withShiftAltGrIsDeadKey: false
	},
	KeyK: {
		value: 'k',
		valueIsDeadKey: false,
		withShift: 'K',
		withShiftIsDeadKey: false,
		withAltGr: '˚',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	KeyL: {
		value: 'l',
		valueIsDeadKey: false,
		withShift: 'L',
		withShiftIsDeadKey: false,
		withAltGr: '¬',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Ò',
		withShiftAltGrIsDeadKey: false
	},
	KeyM: {
		value: 'm',
		valueIsDeadKey: false,
		withShift: 'M',
		withShiftIsDeadKey: false,
		withAltGr: 'µ',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Â',
		withShiftAltGrIsDeadKey: false
	},
	KeyN: {
		value: 'n',
		valueIsDeadKey: false,
		withShift: 'N',
		withShiftIsDeadKey: false,
		withAltGr: '˜',
		withAltGrIsDeadKey: true,
		withShiftAltGr: '˜',
		withShiftAltGrIsDeadKey: false
	},
	KeyO: {
		value: 'o',
		valueIsDeadKey: false,
		withShift: 'O',
		withShiftIsDeadKey: false,
		withAltGr: 'ø',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Ø',
		withShiftAltGrIsDeadKey: false
	},
	KeyP: {
		value: 'p',
		valueIsDeadKey: false,
		withShift: 'P',
		withShiftIsDeadKey: false,
		withAltGr: 'π',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '∏',
		withShiftAltGrIsDeadKey: false
	},
	KeyQ: {
		value: 'q',
		valueIsDeadKey: false,
		withShift: 'Q',
		withShiftIsDeadKey: false,
		withAltGr: 'œ',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Œ',
		withShiftAltGrIsDeadKey: false
	},
	KeyR: {
		value: 'r',
		valueIsDeadKey: false,
		withShift: 'R',
		withShiftIsDeadKey: false,
		withAltGr: '®',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '‰',
		withShiftAltGrIsDeadKey: false
	},
	KeyS: {
		value: 's',
		valueIsDeadKey: false,
		withShift: 'S',
		withShiftIsDeadKey: false,
		withAltGr: 'ß',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Í',
		withShiftAltGrIsDeadKey: false
	},
	KeyT: {
		value: 't',
		valueIsDeadKey: false,
		withShift: 'T',
		withShiftIsDeadKey: false,
		withAltGr: '†',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'ˇ',
		withShiftAltGrIsDeadKey: false
	},
	KeyU: {
		value: 'u',
		valueIsDeadKey: false,
		withShift: 'U',
		withShiftIsDeadKey: false,
		withAltGr: '¨',
		withAltGrIsDeadKey: true,
		withShiftAltGr: '¨',
		withShiftAltGrIsDeadKey: false
	},
	KeyV: {
		value: 'v',
		valueIsDeadKey: false,
		withShift: 'V',
		withShiftIsDeadKey: false,
		withAltGr: '√',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '◊',
		withShiftAltGrIsDeadKey: false
	},
	KeyW: {
		value: 'w',
		valueIsDeadKey: false,
		withShift: 'W',
		withShiftIsDeadKey: false,
		withAltGr: '∑',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '„',
		withShiftAltGrIsDeadKey: false
	},
	KeyX: {
		value: 'x',
		valueIsDeadKey: false,
		withShift: 'X',
		withShiftIsDeadKey: false,
		withAltGr: '≈',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '˛',
		withShiftAltGrIsDeadKey: false
	},
	KeyY: {
		value: 'y',
		valueIsDeadKey: false,
		withShift: 'Y',
		withShiftIsDeadKey: false,
		withAltGr: '¥',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Á',
		withShiftAltGrIsDeadKey: false
	},
	KeyZ: {
		value: 'z',
		valueIsDeadKey: false,
		withShift: 'Z',
		withShiftIsDeadKey: false,
		withAltGr: 'Ω',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '¸',
		withShiftAltGrIsDeadKey: false
	},
	Digit1: {
		value: '1',
		valueIsDeadKey: false,
		withShift: '!',
		withShiftIsDeadKey: false,
		withAltGr: '¡',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '⁄',
		withShiftAltGrIsDeadKey: false
	},
	Digit2: {
		value: '2',
		valueIsDeadKey: false,
		withShift: '@',
		withShiftIsDeadKey: false,
		withAltGr: '™',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '€',
		withShiftAltGrIsDeadKey: false
	},
	Digit3: {
		value: '3',
		valueIsDeadKey: false,
		withShift: '#',
		withShiftIsDeadKey: false,
		withAltGr: '£',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '‹',
		withShiftAltGrIsDeadKey: false
	},
	Digit4: {
		value: '4',
		valueIsDeadKey: false,
		withShift: '$',
		withShiftIsDeadKey: false,
		withAltGr: '¢',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '›',
		withShiftAltGrIsDeadKey: false
	},
	Digit5: {
		value: '5',
		valueIsDeadKey: false,
		withShift: '%',
		withShiftIsDeadKey: false,
		withAltGr: '∞',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'ﬁ',
		withShiftAltGrIsDeadKey: false
	},
	Digit6: {
		value: '6',
		valueIsDeadKey: false,
		withShift: '^',
		withShiftIsDeadKey: false,
		withAltGr: '§',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'ﬂ',
		withShiftAltGrIsDeadKey: false
	},
	Digit7: {
		value: '7',
		valueIsDeadKey: false,
		withShift: '&',
		withShiftIsDeadKey: false,
		withAltGr: '¶',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '‡',
		withShiftAltGrIsDeadKey: false
	},
	Digit8: {
		value: '8',
		valueIsDeadKey: false,
		withShift: '*',
		withShiftIsDeadKey: false,
		withAltGr: '•',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '°',
		withShiftAltGrIsDeadKey: false
	},
	Digit9: {
		value: '9',
		valueIsDeadKey: false,
		withShift: '(',
		withShiftIsDeadKey: false,
		withAltGr: 'ª',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '·',
		withShiftAltGrIsDeadKey: false
	},
	Digit0: {
		value: '0',
		valueIsDeadKey: false,
		withShift: ')',
		withShiftIsDeadKey: false,
		withAltGr: 'º',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '‚',
		withShiftAltGrIsDeadKey: false
	},
	Enter: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	Escape: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	Backspace: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	Tab: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	Space: {
		value: ' ',
		valueIsDeadKey: false,
		withShift: ' ',
		withShiftIsDeadKey: false,
		withAltGr: ' ',
		withAltGrIsDeadKey: false,
		withShiftAltGr: ' ',
		withShiftAltGrIsDeadKey: false
	},
	Minus: {
		value: '-',
		valueIsDeadKey: false,
		withShift: '_',
		withShiftIsDeadKey: false,
		withAltGr: '–',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '—',
		withShiftAltGrIsDeadKey: false
	},
	Equal: {
		value: '=',
		valueIsDeadKey: false,
		withShift: '+',
		withShiftIsDeadKey: false,
		withAltGr: '≠',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '±',
		withShiftAltGrIsDeadKey: false
	},
	BracketLeft: {
		value: '[',
		valueIsDeadKey: false,
		withShift: '{',
		withShiftIsDeadKey: false,
		withAltGr: '“',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '”',
		withShiftAltGrIsDeadKey: false
	},
	BracketRight: {
		value: ']',
		valueIsDeadKey: false,
		withShift: '}',
		withShiftIsDeadKey: false,
		withAltGr: '‘',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '’',
		withShiftAltGrIsDeadKey: false
	},
	Backslash: {
		value: '\\',
		valueIsDeadKey: false,
		withShift: '|',
		withShiftIsDeadKey: false,
		withAltGr: '«',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '»',
		withShiftAltGrIsDeadKey: false
	},
	Semicolon: {
		value: ';',
		valueIsDeadKey: false,
		withShift: ':',
		withShiftIsDeadKey: false,
		withAltGr: '…',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Ú',
		withShiftAltGrIsDeadKey: false
	},
	Quote: {
		value: '\'',
		valueIsDeadKey: false,
		withShift: '"',
		withShiftIsDeadKey: false,
		withAltGr: 'æ',
		withAltGrIsDeadKey: false,
		withShiftAltGr: 'Æ',
		withShiftAltGrIsDeadKey: false
	},
	Backquote: {
		value: '`',
		valueIsDeadKey: false,
		withShift: '~',
		withShiftIsDeadKey: false,
		withAltGr: '`',
		withAltGrIsDeadKey: true,
		withShiftAltGr: '`',
		withShiftAltGrIsDeadKey: false
	},
	Comma: {
		value: ',',
		valueIsDeadKey: false,
		withShift: '<',
		withShiftIsDeadKey: false,
		withAltGr: '≤',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '¯',
		withShiftAltGrIsDeadKey: false
	},
	Period: {
		value: '.',
		valueIsDeadKey: false,
		withShift: '>',
		withShiftIsDeadKey: false,
		withAltGr: '≥',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '˘',
		withShiftAltGrIsDeadKey: false
	},
	Slash: {
		value: '/',
		valueIsDeadKey: false,
		withShift: '?',
		withShiftIsDeadKey: false,
		withAltGr: '÷',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '¿',
		withShiftAltGrIsDeadKey: false
	},
	CapsLock: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F1: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F2: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F3: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F4: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F5: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F6: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F7: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F8: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F9: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F10: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F11: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F12: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	Insert: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	Home: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	PageUp: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	Delete: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	End: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	PageDown: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	ArrowRight: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	ArrowLeft: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	ArrowDown: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	ArrowUp: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	NumLock: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	NumpadDivide: {
		value: '/',
		valueIsDeadKey: false,
		withShift: '/',
		withShiftIsDeadKey: false,
		withAltGr: '/',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '/',
		withShiftAltGrIsDeadKey: false
	},
	NumpadMultiply: {
		value: '*',
		valueIsDeadKey: false,
		withShift: '*',
		withShiftIsDeadKey: false,
		withAltGr: '*',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '*',
		withShiftAltGrIsDeadKey: false
	},
	NumpadSubtract: {
		value: '-',
		valueIsDeadKey: false,
		withShift: '-',
		withShiftIsDeadKey: false,
		withAltGr: '-',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '-',
		withShiftAltGrIsDeadKey: false
	},
	NumpadAdd: {
		value: '+',
		valueIsDeadKey: false,
		withShift: '+',
		withShiftIsDeadKey: false,
		withAltGr: '+',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '+',
		withShiftAltGrIsDeadKey: false
	},
	NumpadEnter: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	Numpad1: {
		value: '1',
		valueIsDeadKey: false,
		withShift: '1',
		withShiftIsDeadKey: false,
		withAltGr: '1',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '1',
		withShiftAltGrIsDeadKey: false
	},
	Numpad2: {
		value: '2',
		valueIsDeadKey: false,
		withShift: '2',
		withShiftIsDeadKey: false,
		withAltGr: '2',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '2',
		withShiftAltGrIsDeadKey: false
	},
	Numpad3: {
		value: '3',
		valueIsDeadKey: false,
		withShift: '3',
		withShiftIsDeadKey: false,
		withAltGr: '3',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '3',
		withShiftAltGrIsDeadKey: false
	},
	Numpad4: {
		value: '4',
		valueIsDeadKey: false,
		withShift: '4',
		withShiftIsDeadKey: false,
		withAltGr: '4',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '4',
		withShiftAltGrIsDeadKey: false
	},
	Numpad5: {
		value: '5',
		valueIsDeadKey: false,
		withShift: '5',
		withShiftIsDeadKey: false,
		withAltGr: '5',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '5',
		withShiftAltGrIsDeadKey: false
	},
	Numpad6: {
		value: '6',
		valueIsDeadKey: false,
		withShift: '6',
		withShiftIsDeadKey: false,
		withAltGr: '6',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '6',
		withShiftAltGrIsDeadKey: false
	},
	Numpad7: {
		value: '7',
		valueIsDeadKey: false,
		withShift: '7',
		withShiftIsDeadKey: false,
		withAltGr: '7',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '7',
		withShiftAltGrIsDeadKey: false
	},
	Numpad8: {
		value: '8',
		valueIsDeadKey: false,
		withShift: '8',
		withShiftIsDeadKey: false,
		withAltGr: '8',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '8',
		withShiftAltGrIsDeadKey: false
	},
	Numpad9: {
		value: '9',
		valueIsDeadKey: false,
		withShift: '9',
		withShiftIsDeadKey: false,
		withAltGr: '9',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '9',
		withShiftAltGrIsDeadKey: false
	},
	Numpad0: {
		value: '0',
		valueIsDeadKey: false,
		withShift: '0',
		withShiftIsDeadKey: false,
		withAltGr: '0',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '0',
		withShiftAltGrIsDeadKey: false
	},
	NumpadDecimal: {
		value: '.',
		valueIsDeadKey: false,
		withShift: '.',
		withShiftIsDeadKey: false,
		withAltGr: '.',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '.',
		withShiftAltGrIsDeadKey: false
	},
	IntlBackslash: {
		value: '§',
		valueIsDeadKey: false,
		withShift: '±',
		withShiftIsDeadKey: false,
		withAltGr: '§',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '±',
		withShiftAltGrIsDeadKey: false
	},
	ContextMenu: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	NumpadEqual: {
		value: '=',
		valueIsDeadKey: false,
		withShift: '=',
		withShiftIsDeadKey: false,
		withAltGr: '=',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '=',
		withShiftAltGrIsDeadKey: false
	},
	F13: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F14: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F15: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F16: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F17: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F18: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F19: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	F20: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	AudioVolumeMute: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	AudioVolumeUp: {
		value: '',
		valueIsDeadKey: false,
		withShift: '=',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '=',
		withShiftAltGrIsDeadKey: false
	},
	AudioVolumeDown: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	NumpadComma: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	IntlRo: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	KanaMode: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	IntlYen: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	ControlLeft: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	ShiftLeft: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	AltLeft: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	MetaLeft: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	ControlRight: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	ShiftRight: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	AltRight: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	},
	MetaRight: {
		value: '',
		valueIsDeadKey: false,
		withShift: '',
		withShiftIsDeadKey: false,
		withAltGr: '',
		withAltGrIsDeadKey: false,
		withShiftAltGr: '',
		withShiftAltGrIsDeadKey: false
	}
});
