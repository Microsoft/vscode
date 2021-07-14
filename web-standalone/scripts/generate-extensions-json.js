#!/usr/bin/env node

const util = require('util');
const fs = require('fs');
const path = require('path');
const {
	EXTENSIONS,
	WEB_EXTENSIONS
} = require('../build-config.json');

const SCHEME = 'http';
const AUTHORITY = 'localhost:9090';
const WEB_EXTENSIONS_ROOT = path.join(__dirname, '../extensions');
const EXTENSIONS_ROOT = path.join(__dirname, '../../extensions');

async function generateExtensionsJson() {
	const webExtensions = await Promise.all(
		WEB_EXTENSIONS.map(async extensionFolder => {
			const packageJSON = JSON.parse(
				(await util.promisify(fs.readFile)(path.join(WEB_EXTENSIONS_ROOT, extensionFolder, 'package.json'))).toString()
			);
			packageJSON.extensionKind = ['web'];
			return {
				packageJSON,
				extensionLocation: {
					scheme: SCHEME,
					authority: AUTHORITY,
					path: `/web-extension/${extensionFolder}`
				}
			};
		})
	);

	const staticExtensions = await Promise.all(
		EXTENSIONS.map(async extensionFolder => {
			const packageJSON = JSON.parse(
				(await util.promisify(fs.readFile)(path.join(EXTENSIONS_ROOT, extensionFolder, 'package.json'))).toString()
			);
			packageJSON.extensionKind = ['web']; // enable for Web
			return {
				packageJSON,
				extensionLocation: {
					scheme: SCHEME,
					authority: AUTHORITY,
					path: `/static-extension/${extensionFolder}`
				}
			};
		})
	);
	const result = JSON.stringify([...webExtensions, ...staticExtensions]);
	fs.writeFileSync(path.join(__dirname, '../assets/extensions.json'), result);
}

generateExtensionsJson();
