/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

namespace snaps {

	const fs = require('fs');
	const path = require('path');
	const os = require('os');
	const cp = require('child_process');

	const mksnapshot = path.join(__dirname, `../../node_modules/.bin/${process.platform === 'win32' ? 'mksnapshot.cmd' : 'mksnapshot'}`);
	const product = require('../../product.json');
	const arch = (process.argv.join('').match(/--arch=(.*)/) || [])[1];

	//
	let loaderFilepath: string;
	let startupBlobFilepath: string;

	switch (process.platform) {
		case 'darwin':
			loaderFilepath = `VSCode-darwin/${product.nameLong}.app/Contents/Resources/app/out/vs/loader.js`;
			startupBlobFilepath = `VSCode-darwin/${product.nameLong}.app/Contents/Frameworks/Electron Framework.framework/Resources/snapshot_blob.bin`;
			break;

		case 'win32':
		case 'linux':
			loaderFilepath = `VSCode-${process.platform}-${arch}/resources/app/out/vs/loader.js`;
			startupBlobFilepath = `VSCode-${process.platform}-${arch}/snapshot_blob.bin`;
			break;

		default:
			throw new Error('Unknown platform');
	}

	loaderFilepath = path.join(__dirname, '../../../', loaderFilepath);
	startupBlobFilepath = path.join(__dirname, '../../../', startupBlobFilepath);

	snapshotLoader(loaderFilepath, startupBlobFilepath);

	function snapshotLoader(loaderFilepath: string, startupBlobFilepath: string): void {

		const inputFile = fs.readFileSync(loaderFilepath);
		const wrappedInputFile = `
		var Monaco_Loader_Init;
		(function() {
			var doNotInitLoader = true;
			${inputFile.toString()};
			Monaco_Loader_Init = function() {
				AMDLoader.init();
				CSSLoaderPlugin.init();
				NLSLoaderPlugin.init();

				return { define, require };
			}
		})();
		`;
		const wrappedInputFilepath = path.join(os.tmpdir(), 'wrapped-loader.js');
		console.log(wrappedInputFilepath);
		fs.writeFileSync(wrappedInputFilepath, wrappedInputFile);

		cp.execFileSync(mksnapshot, [wrappedInputFilepath, `--startup_blob`, startupBlobFilepath]);
	}
}
