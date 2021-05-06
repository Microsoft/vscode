/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as codesign from 'electron-osx-sign';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as plist from 'plist';
import * as util from '../lib/util';
import * as product from '../../product.json';

async function main(): Promise<void> {
	const buildDir = process.env['AGENT_BUILDDIRECTORY'];
	const tempDir = process.env['AGENT_TEMPDIRECTORY'];
	const arch = process.env['VSCODE_ARCH'];

	if (!buildDir) {
		throw new Error('$AGENT_BUILDDIRECTORY not set');
	}

	if (!tempDir) {
		throw new Error('$AGENT_TEMPDIRECTORY not set');
	}

	const baseDir = path.dirname(__dirname);
	const appRoot = path.join(buildDir, `VSCode-darwin-${arch}`);
	const appName = product.nameLong + '.app';
	const appFrameworkPath = path.join(appRoot, appName, 'Contents', 'Frameworks');
	const helperAppBaseName = product.nameShort;
	const gpuHelperAppName = helperAppBaseName + ' Helper (GPU).app';
	const rendererHelperAppName = helperAppBaseName + ' Helper (Renderer).app';
	const infoPlistPath = path.resolve(appRoot, appName, 'Contents', 'Info.plist');

	const defaultOpts: codesign.SignOptions = {
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

	const appOpts = {
		...defaultOpts,
		// TODO(deepak1556): Incorrectly declared type in electron-osx-sign
		ignore: (filePath: string) => {
			return filePath.includes(gpuHelperAppName) ||
				filePath.includes(rendererHelperAppName);
		}
	};

	const gpuHelperOpts: codesign.SignOptions = {
		...defaultOpts,
		app: path.join(appFrameworkPath, gpuHelperAppName),
		entitlements: path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-gpu-entitlements.plist'),
		'entitlements-inherit': path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-gpu-entitlements.plist'),
	};

	const rendererHelperOpts: codesign.SignOptions = {
		...defaultOpts,
		app: path.join(appFrameworkPath, rendererHelperAppName),
		entitlements: path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-renderer-entitlements.plist'),
		'entitlements-inherit': path.join(baseDir, 'azure-pipelines', 'darwin', 'helper-renderer-entitlements.plist'),
	};

	let infoPlistString = await fs.readFile(infoPlistPath, 'utf8');
	let infoPlistJson = plist.parse(infoPlistString);
	Object.assign(infoPlistJson, {
		NSAppleEventsUsageDescription: 'An application in Visual Studio Code wants to use AppleScript.',
		NSMicrophoneUsageDescription: 'An application in Visual Studio Code wants to use the Microphone.',
		NSCameraUsageDescription: 'An application in Visual Studio Code wants to use the Camera.'
	});
	await fs.writeFile(infoPlistPath, plist.build(infoPlistJson), 'utf8');

	await codesign.signAsync(gpuHelperOpts);
	await codesign.signAsync(rendererHelperOpts);
	await codesign.signAsync(appOpts as any);
}

if (require.main === module) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
