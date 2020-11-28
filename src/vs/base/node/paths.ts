/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { FileAccess } from 'vs/base/common/network';

const pathsPath = FileAccess.asFileUri('paths', require).fsPath;
const paths = require.__$__nodeRequire<{ getDefaultUserDataPath(): string }>(pathsPath);

export const getDefaultUserDataPath = paths.getDefaultUserDataPath;
