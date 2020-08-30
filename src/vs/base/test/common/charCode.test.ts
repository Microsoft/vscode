/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CharCode } from 'vs/base/common/charCode';

suite('CharCode', () => {
	test('has good values', () => {

		function assertValue(actual: CharCode, expected: string): void {
			assert.equal(actual, expected.charCodeAt(0), 'char code ok for <<' + expected + '>>');
		}

		assertValue(CharCode.Tab, '\t');
		assertValue(CharCode.LineFeed, '\n');
		assertValue(CharCode.CarriageReturn, '\r');
		assertValue(CharCode.Space, ' ');
		assertValue(CharCode.ExclamationMark, '!');
		assertValue(CharCode.DoubleQuote, '"');
		assertValue(CharCode.Hash, '#');
		assertValue(CharCode.DollarSign, '$');
		assertValue(CharCode.PercentSign, '%');
		assertValue(CharCode.Ampersand, '&');
		assertValue(CharCode.SingleQuote, '\'');
		assertValue(CharCode.OpenParen, '(');
		assertValue(CharCode.CloseParen, ')');
		assertValue(CharCode.Asterisk, '*');
		assertValue(CharCode.Plus, '+');
		assertValue(CharCode.Comma, ',');
		assertValue(CharCode.Dash, '-');
		assertValue(CharCode.Period, '.');
		assertValue(CharCode.Slash, '/');

		assertValue(CharCode.Digit0, '0');
		assertValue(CharCode.Digit1, '1');
		assertValue(CharCode.Digit2, '2');
		assertValue(CharCode.Digit3, '3');
		assertValue(CharCode.Digit4, '4');
		assertValue(CharCode.Digit5, '5');
		assertValue(CharCode.Digit6, '6');
		assertValue(CharCode.Digit7, '7');
		assertValue(CharCode.Digit8, '8');
		assertValue(CharCode.Digit9, '9');

		assertValue(CharCode.Colon, ':');
		assertValue(CharCode.Semicolon, ';');
		assertValue(CharCode.LessThan, '<');
		assertValue(CharCode.Equals, '=');
		assertValue(CharCode.GreaterThan, '>');
		assertValue(CharCode.QuestionMark, '?');
		assertValue(CharCode.AtSign, '@');

		assertValue(CharCode.A, 'A');
		assertValue(CharCode.B, 'B');
		assertValue(CharCode.C, 'C');
		assertValue(CharCode.D, 'D');
		assertValue(CharCode.E, 'E');
		assertValue(CharCode.F, 'F');
		assertValue(CharCode.G, 'G');
		assertValue(CharCode.H, 'H');
		assertValue(CharCode.I, 'I');
		assertValue(CharCode.J, 'J');
		assertValue(CharCode.K, 'K');
		assertValue(CharCode.L, 'L');
		assertValue(CharCode.M, 'M');
		assertValue(CharCode.N, 'N');
		assertValue(CharCode.O, 'O');
		assertValue(CharCode.P, 'P');
		assertValue(CharCode.Q, 'Q');
		assertValue(CharCode.R, 'R');
		assertValue(CharCode.S, 'S');
		assertValue(CharCode.T, 'T');
		assertValue(CharCode.U, 'U');
		assertValue(CharCode.V, 'V');
		assertValue(CharCode.W, 'W');
		assertValue(CharCode.X, 'X');
		assertValue(CharCode.Y, 'Y');
		assertValue(CharCode.Z, 'Z');

		assertValue(CharCode.OpenSquareBracket, '[');
		assertValue(CharCode.Backslash, '\\');
		assertValue(CharCode.CloseSquareBracket, ']');
		assertValue(CharCode.Caret, '^');
		assertValue(CharCode.Underline, '_');
		assertValue(CharCode.BackTick, '`');

		assertValue(CharCode.a, 'a');
		assertValue(CharCode.b, 'b');
		assertValue(CharCode.c, 'c');
		assertValue(CharCode.d, 'd');
		assertValue(CharCode.e, 'e');
		assertValue(CharCode.f, 'f');
		assertValue(CharCode.g, 'g');
		assertValue(CharCode.h, 'h');
		assertValue(CharCode.i, 'i');
		assertValue(CharCode.j, 'j');
		assertValue(CharCode.k, 'k');
		assertValue(CharCode.l, 'l');
		assertValue(CharCode.m, 'm');
		assertValue(CharCode.n, 'n');
		assertValue(CharCode.o, 'o');
		assertValue(CharCode.p, 'p');
		assertValue(CharCode.q, 'q');
		assertValue(CharCode.r, 'r');
		assertValue(CharCode.s, 's');
		assertValue(CharCode.t, 't');
		assertValue(CharCode.u, 'u');
		assertValue(CharCode.v, 'v');
		assertValue(CharCode.w, 'w');
		assertValue(CharCode.x, 'x');
		assertValue(CharCode.y, 'y');
		assertValue(CharCode.z, 'z');

		assertValue(CharCode.OpenCurlyBrace, '{');
		assertValue(CharCode.Pipe, '|');
		assertValue(CharCode.CloseCurlyBrace, '}');
		assertValue(CharCode.Tilde, '~');
	});
});
