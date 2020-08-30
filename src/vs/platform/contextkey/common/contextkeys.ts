/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { isMacintosh, isLinux, isWindows, isWeb } from 'vs/base/common/platform';

export const IsMacContext = new RawContextKey<boolean>('isMac', isMacintosh);
export const IsLinuxContext = new RawContextKey<boolean>('isLinux', isLinux);
export const IsWindowsContext = new RawContextKey<boolean>('isWindows', isWindows);

export const IsWebContext = new RawContextKey<boolean>('isWeb', isWeb);
export const IsMacNativeContext = new RawContextKey<boolean>('isMacNative', isMacintosh && !isWeb);

export const IsDevelopmentContext = new RawContextKey<boolean>('isDevelopment', false);

export const InputFocusedContextKey = 'inputFocus';
export const InputFocusedContext = new RawContextKey<boolean>(InputFocusedContextKey, false);
