/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Color } from 'vs/base/common/color';

export type styleFn = (colors: { [name: string]: Color | undefined }) => void;

export interface IThemable {
	style: styleFn;
}
