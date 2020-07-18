/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const cp = require('child_process');
const path = require('path');
const fs = require('fs');
const yarn = process.platform === 'win32' ? 'yarn.cmd' : 'yarn';

/**
 * @param {string} location
 * @param {*} [opts]
 */
function yarnInstall(location, opts) {
	opts = opts || { env: process.env };
	opts.cwd = location;
	opts.stdio = 'inherit';

	const raw = process.env['npm_config_argv'] || '{}';
	const argv = JSON.parse(raw);
	const original = argv.original || [];
	const args = original.filter(arg => arg === '--ignore-optional' || arg === '--frozen-lockfile');

	console.log(`Installing dependencies in ${location}...`);
	console.log(`$ yarn ${args.join(' ')}`);
	const result = cp.spawnSync(yarn, args, opts);

	if (result.error || result.status !== 0) {
		process.exit(1);
	}
}

yarnInstall('extensions'); // node modules shared by all extensions

if (!(process.platform === 'win32' && (process.arch === 'arm64' || process.env['npm_config_arch'] === 'arm64'))) {
	yarnInstall('remote'); // node modules used by vscode server
	yarnInstall('remote/web'); // node modules used by vscode web
}

const allExtensionFolders = fs.readdirSync('extensions');
const extensions = allExtensionFolders.filter(e => {
	try {
		let packageJSON = JSON.parse(fs.readFileSync(path.join('extensions', e, 'package.json')).toString());
		return packageJSON && (packageJSON.dependencies || packageJSON.devDependencies);
	} catch (e) {
		return false;
	}
});

extensions.forEach(extension => yarnInstall(`extensions/${extension}`));

function yarnInstallBuildDependencies() {
	// make sure we install the deps of build/lib/watch for the system installed
	// node, since that is the driver of gulp
	const watchPath = path.join(path.dirname(__dirname), 'lib', 'watch');
	const yarnrcPath = path.join(watchPath, '.yarnrc');

	const disturl = 'https://nodejs.org/download/release';
	const target = process.versions.node;
	const runtime = 'node';

	const yarnrc = `disturl "${disturl}"
target "${target}"
runtime "${runtime}"`;

	fs.writeFileSync(yarnrcPath, yarnrc, 'utf8');
	yarnInstall(watchPath);
}

yarnInstall(`build`); // node modules required for build
yarnInstall('test/automation'); // node modules required for smoketest
yarnInstall('test/smoke'); // node modules required for smoketest
yarnInstall('test/integration/browser'); // node modules required for integration
yarnInstallBuildDependencies(); // node modules for watching, specific to host node version, not electron

cp.execSync('git config pull.rebase true');
