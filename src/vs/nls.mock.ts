/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ILocalizeInfo {
	key: string;
	comment: string[];
}

function _format(message: string, args: any[]): string {
	let result: string;
	if (args.length === 0) {
		result = message;
	} else {
		result = message.replace(/\{(\d+)\}/g, function (match, rest) {
			const index = rest[0];
			return typeof args[index] !== 'undefined' ? args[index] : match;
		});
	}
	return result;
}

export function localize(data: ILocalizeInfo | string, message: string, ...args: any[]): string {
	return _format(message, args);
}
