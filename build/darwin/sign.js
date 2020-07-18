/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const codesign = require("electron-osx-sign");
const path = require("path");
const util = require("../lib/util");
const product = require("../../product.json");
async function main() {
    const buildDir = process.env['AGENT_BUILDDIRECTORY'];
    const tempDir = process.env['AGENT_TEMPDIRECTORY'];
    if (!buildDir) {
        throw new Error('$AGENT_BUILDDIRECTORY not set');
    }
    if (!tempDir) {
        throw new Error('$AGENT_TEMPDIRECTORY not set');
    }
    const baseDir = path.dirname(__dirname);
    const appRoot = path.join(buildDir, 'VSCode-darwin');
    const appName = product.nameLong + '.app';
    const appFrameworkPath = path.join(appRoot, appName, 'Contents', 'Frameworks');
    const helperAppBaseName = product.nameShort;
    const gpuHelperAppName = helperAppBaseName + ' Helper (GPU).app';
    const pluginHelperAppName = helperAppBaseName + ' Helper (Plugin).app';
    const rendererHelperAppName = helperAppBaseName + ' Helper (Renderer).app';
    const defaultOpts = {
        app: path.join(appRoot, appName),
        platform: 'darwin',
        entitlements: path.join(baseDir, 'azure-pipelines', 'darwin', 'app-entitlements.plist'),
        'entitlements-inherit': path.join(baseDir, 'azure-pipelines', 'darwin', 'app-entitlements.plist'),
        hardenedRuntime: true,
        'pre-auto-entitlements': false,
        'pre-embed-provisioning-profile': false,
        keychain: path.join(tempDir, 'buildagent.keychain'),
        version: util.getElectronVersion(),
        identity: '99FM488X57',
        'gatekeeper-assess': false
    };
    const appOpts = Object.assign(Object.assign({}, defaultOpts), { 
        // TODO(deepak1556): Incorrectly declared type in electron-osx-sign
        ignore: (filePath) => {
            return filePath.includes(gpuHelperAppName) ||
                filePath.includes(pluginHelperAppName) ||
                filePath.includes(rendererHelperAppName);
        } });
    const gpuHelperOpts = Object.assign(Object.assign({}, defaultOpts), { app: path.join(appFrameworkPath, gpuHelperAppName), entitlements: path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-gpu-entitlements.plist'), 'entitlements-inherit': path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-gpu-entitlements.plist') });
    const pluginHelperOpts = Object.assign(Object.assign({}, defaultOpts), { app: path.join(appFrameworkPath, pluginHelperAppName), entitlements: path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-plugin-entitlements.plist'), 'entitlements-inherit': path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-plugin-entitlements.plist') });
    const rendererHelperOpts = Object.assign(Object.assign({}, defaultOpts), { app: path.join(appFrameworkPath, rendererHelperAppName), entitlements: path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-renderer-entitlements.plist'), 'entitlements-inherit': path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-renderer-entitlements.plist') });
    await codesign.signAsync(gpuHelperOpts);
    await codesign.signAsync(pluginHelperOpts);
    await codesign.signAsync(rendererHelperOpts);
    await codesign.signAsync(appOpts);
}
if (require.main === module) {
    main().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
