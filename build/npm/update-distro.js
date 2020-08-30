/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const cp = require('child_process');
const path = require('path');
const fs = require('fs');

const rootPath = path.dirname(path.dirname(path.dirname(__dirname)));
const vscodePath = path.join(rootPath, 'vscode');
const distroPath = path.join(rootPath, 'vscode-distro');
const commit = cp.execSync('git rev-parse HEAD', { cwd: distroPath, encoding: 'utf8' }).trim();
const packageJsonPath = path.join(vscodePath, 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));

packageJson.distro = commit;
fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2));
