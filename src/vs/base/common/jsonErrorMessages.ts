/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Extracted from json.ts to keep json nls free.
 */
import { localize } from 'vs/nls';
import { ParseErrorCode } from './json';

export function getParseErrorMessage(errorCode: ParseErrorCode): string {
	switch (errorCode) {
		case ParseErrorCode.InvalidSymbol: return localize('error.invalidSymbol', 'Invalid symbol');
		case ParseErrorCode.InvalidNumberFormat: return localize('error.invalidNumberFormat', 'Invalid number format');
		case ParseErrorCode.PropertyNameExpected: return localize('error.propertyNameExpected', 'Property name expected');
		case ParseErrorCode.ValueExpected: return localize('error.valueExpected', 'Value expected');
		case ParseErrorCode.ColonExpected: return localize('error.colonExpected', 'Colon expected');
		case ParseErrorCode.CommaExpected: return localize('error.commaExpected', 'Comma expected');
		case ParseErrorCode.CloseBraceExpected: return localize('error.closeBraceExpected', 'Closing brace expected');
		case ParseErrorCode.CloseBracketExpected: return localize('error.closeBracketExpected', 'Closing bracket expected');
		case ParseErrorCode.EndOfFileExpected: return localize('error.endOfFileExpected', 'End of file expected');
		default:
			return '';
	}
}
