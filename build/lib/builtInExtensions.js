/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const mkdirp = require('mkdirp');
const rimraf = require('rimraf');
const es = require('event-stream');
const rename = require('gulp-rename');
const vfs = require('vinyl-fs');
const ext = require('./extensions');
const fancyLog = require('fancy-log');
const ansiColors = require('ansi-colors');

const root = path.dirname(path.dirname(__dirname));
const productjson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../product.json'), 'utf8'));
const builtInExtensions = productjson.builtInExtensions;
const webBuiltInExtensions = productjson.webBuiltInExtensions;
const controlFilePath = path.join(os.homedir(), '.vscode-oss-dev', 'extensions', 'control.json');
const ENABLE_LOGGING = !process.env['VSCODE_BUILD_BUILTIN_EXTENSIONS_SILENCE_PLEASE'];

function log() {
	if (ENABLE_LOGGING) {
		fancyLog.apply(this, arguments);
	}
}

function getExtensionPath(extension) {
	return path.join(root, '.build', 'builtInExtensions', extension.name);
}

function isUpToDate(extension) {
	const packagePath = path.join(getExtensionPath(extension), 'package.json');

	if (!fs.existsSync(packagePath)) {
		return false;
	}

	const packageContents = fs.readFileSync(packagePath, { encoding: 'utf8' });

	try {
		const diskVersion = JSON.parse(packageContents).version;
		return (diskVersion === extension.version);
	} catch (err) {
		return false;
	}
}

function syncMarketplaceExtension(extension) {
	if (isUpToDate(extension)) {
		log(ansiColors.blue('[marketplace]'), `${extension.name}@${extension.version}`, ansiColors.green('✔︎'));
		return es.readArray([]);
	}

	rimraf.sync(getExtensionPath(extension));

	return ext.fromMarketplace(extension.name, extension.version, extension.metadata)
		.pipe(rename(p => p.dirname = `${extension.name}/${p.dirname}`))
		.pipe(vfs.dest('.build/builtInExtensions'))
		.on('end', () => log(ansiColors.blue('[marketplace]'), extension.name, ansiColors.green('✔︎')));
}

function syncExtension(extension, controlState) {
	switch (controlState) {
		case 'disabled':
			log(ansiColors.blue('[disabled]'), ansiColors.gray(extension.name));
			return es.readArray([]);

		case 'marketplace':
			return syncMarketplaceExtension(extension);

		default:
			if (!fs.existsSync(controlState)) {
				log(ansiColors.red(`Error: Built-in extension '${extension.name}' is configured to run from '${controlState}' but that path does not exist.`));
				return es.readArray([]);

			} else if (!fs.existsSync(path.join(controlState, 'package.json'))) {
				log(ansiColors.red(`Error: Built-in extension '${extension.name}' is configured to run from '${controlState}' but there is no 'package.json' file in that directory.`));
				return es.readArray([]);
			}

			log(ansiColors.blue('[local]'), `${extension.name}: ${ansiColors.cyan(controlState)}`, ansiColors.green('✔︎'));
			return es.readArray([]);
	}
}

function readControlFile() {
	try {
		return JSON.parse(fs.readFileSync(controlFilePath, 'utf8'));
	} catch (err) {
		return {};
	}
}

function writeControlFile(control) {
	mkdirp.sync(path.dirname(controlFilePath));
	fs.writeFileSync(controlFilePath, JSON.stringify(control, null, 2));
}

exports.getBuiltInExtensions = function getBuiltInExtensions() {
	log('Syncronizing built-in extensions...');
	log(`You can manage built-in extensions with the ${ansiColors.cyan('--builtin')} flag`);

	const control = readControlFile();
	const streams = [];

	for (const extension of [...builtInExtensions, ...webBuiltInExtensions]) {
		let controlState = control[extension.name] || 'marketplace';
		control[extension.name] = controlState;

		streams.push(syncExtension(extension, controlState));
	}

	writeControlFile(control);

	return new Promise((resolve, reject) => {
		es.merge(streams)
			.on('error', reject)
			.on('end', resolve);
	});
};

if (require.main === module) {
	exports.getBuiltInExtensions().then(() => process.exit(0)).catch(err => {
		console.error(err);
		process.exit(1);
	});
}
