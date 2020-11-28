/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';

export interface IDisplayMainService {
	readonly _serviceBrand: undefined;
	readonly onDidDisplayChanged: Event<void>;
}
