/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { NativeParsedArgs } from 'vs/platform/environment/common/argv';

/**
 * Returns the user data path to use with some rules:
 * - respect portable mode
 * - respect --user-data-dir CLI argument
 * - respect VSCODE_APPDATA environment variable
 */
export function getUserDataPath(args: NativeParsedArgs): string;
