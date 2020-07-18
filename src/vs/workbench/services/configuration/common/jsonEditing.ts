/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { JSONPath } from 'vs/base/common/json';

export const IJSONEditingService = createDecorator<IJSONEditingService>('jsonEditingService');

export const enum JSONEditingErrorCode {

	/**
	 * Error when trying to write and save to the file while it is dirty in the editor.
	 */
	ERROR_FILE_DIRTY,

	/**
	 * Error when trying to write to a file that contains JSON errors.
	 */
	ERROR_INVALID_FILE
}

export class JSONEditingError extends Error {
	constructor(message: string, public code: JSONEditingErrorCode) {
		super(message);
	}
}

export interface IJSONValue {
	path: JSONPath;
	value: any;
}

export interface IJSONEditingService {

	readonly _serviceBrand: undefined;

	write(resource: URI, values: IJSONValue[], save: boolean): Promise<void>;
}
