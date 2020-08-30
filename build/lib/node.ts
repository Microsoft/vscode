/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';
import * as fs from 'fs';

const root = path.dirname(path.dirname(__dirname));
const yarnrcPath = path.join(root, 'remote', '.yarnrc');
const yarnrc = fs.readFileSync(yarnrcPath, 'utf8');
const version = /^target\s+"([^"]+)"$/m.exec(yarnrc)![1];
const node = process.platform === 'win32' ? 'node.exe' : 'node';
const nodePath = path.join(root, '.build', 'node', `v${version}`, `${process.platform}-${process.arch}`, node);

console.log(nodePath);
