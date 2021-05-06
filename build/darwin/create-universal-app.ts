/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import { makeUniversalApp } from 'vscode-universal';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as plist from 'plist';
import * as product from '../../product.json';

async function main() {
	const buildDir = process.env['AGENT_BUILDDIRECTORY'];
	const arch = process.env['VSCODE_ARCH'];

	if (!buildDir) {
		throw new Error('$AGENT_BUILDDIRECTORY not set');
	}

	const appName = product.nameLong + '.app';
	const x64AppPath = path.join(buildDir, 'VSCode-darwin-x64', appName);
	const arm64AppPath = path.join(buildDir, 'VSCode-darwin-arm64', appName);
	const x64AsarPath = path.join(x64AppPath, 'Contents', 'Resources', 'app', 'node_modules.asar');
	const arm64AsarPath = path.join(arm64AppPath, 'Contents', 'Resources', 'app', 'node_modules.asar');
	const outAppPath = path.join(buildDir, `VSCode-darwin-${arch}`, appName);
	const productJsonPath = path.resolve(outAppPath, 'Contents', 'Resources', 'app', 'product.json');
	const infoPlistPath = path.resolve(outAppPath, 'Contents', 'Info.plist');

	await makeUniversalApp({
		x64AppPath,
		arm64AppPath,
		x64AsarPath,
		arm64AsarPath,
		filesToSkip: [
			'product.json',
			'Credits.rtf',
			'CodeResources',
			'fsevents.node',
			'Info.plist', // TODO@deepak1556: regressed with 11.4.2 internal builds
			'.npmrc'
		],
		outAppPath,
		force: true
	});

	let productJson = await fs.readJson(productJsonPath);
	Object.assign(productJson, {
		darwinUniversalAssetId: 'darwin-universal'
	});
	await fs.writeJson(productJsonPath, productJson);

	let infoPlistString = await fs.readFile(infoPlistPath, 'utf8');
	let infoPlistJson = plist.parse(infoPlistString);
	Object.assign(infoPlistJson, {
		LSRequiresNativeExecution: true
	});
	await fs.writeFile(infoPlistPath, plist.build(infoPlistJson), 'utf8');
}

if (require.main === module) {
	main().catch(err => {
		console.error(err);
		process.exit(1);
	});
}
