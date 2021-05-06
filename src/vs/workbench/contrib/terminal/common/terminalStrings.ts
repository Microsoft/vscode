/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * Formats a message from the product to be written to the terminal.
 */
export function formatMessageForTerminal(message: string, excludeLeadingNewLine: boolean = false): string {
	// Wrap in bold and ensure it's on a new line
	return `${excludeLeadingNewLine ? '' : '\r\n'}\x1b[1m${message}\x1b[0m\n\r`;
}
