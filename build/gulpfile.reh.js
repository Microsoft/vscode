/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');

const path = require('path');
const es = require('event-stream');
const util = require('./lib/util');
const task = require('./lib/task');
const vfs = require('vinyl-fs');
const flatmap = require('gulp-flatmap');
const gunzip = require('gulp-gunzip');
const untar = require('gulp-untar');
const File = require('vinyl');
const fs = require('fs');
const remote = require('gulp-remote-retry-src');
const rename = require('gulp-rename');
const filter = require('gulp-filter');
const cp = require('child_process');

const REPO_ROOT = path.dirname(__dirname);

const BUILD_TARGETS = [
	{ platform: 'win32', arch: 'ia32', pkgTarget: 'node8-win-x86' },
	{ platform: 'win32', arch: 'x64', pkgTarget: 'node8-win-x64' },
	{ platform: 'darwin', arch: null, pkgTarget: 'node8-macos-x64' },
	{ platform: 'linux', arch: 'ia32', pkgTarget: 'node8-linux-x86' },
	{ platform: 'linux', arch: 'x64', pkgTarget: 'node8-linux-x64' },
	{ platform: 'linux', arch: 'armhf', pkgTarget: 'node8-linux-armv7' },
	{ platform: 'linux', arch: 'arm64', pkgTarget: 'node8-linux-arm64' },
	{ platform: 'linux', arch: 'alpine', pkgTarget: 'node8-linux-alpine' },
];

const noop = () => { return Promise.resolve(); };

gulp.task('vscode-reh-win32-ia32-min', noop);
gulp.task('vscode-reh-win32-x64-min', noop);
gulp.task('vscode-reh-darwin-min', noop);
gulp.task('vscode-reh-linux-x64-min', noop);
gulp.task('vscode-reh-linux-armhf-min', noop);
gulp.task('vscode-reh-linux-arm64-min', noop);
gulp.task('vscode-reh-linux-alpine-min', noop);

gulp.task('vscode-reh-web-win32-ia32-min', noop);
gulp.task('vscode-reh-web-win32-x64-min', noop);
gulp.task('vscode-reh-web-darwin-min', noop);
gulp.task('vscode-reh-web-linux-x64-min', noop);
gulp.task('vscode-reh-web-linux-alpine-min', noop);

function getNodeVersion() {
	const yarnrc = fs.readFileSync(path.join(REPO_ROOT, 'remote', '.yarnrc'), 'utf8');
	const target = /^target "(.*)"$/m.exec(yarnrc)[1];
	return target;
}

const nodeVersion = getNodeVersion();

BUILD_TARGETS.forEach(({ platform, arch }) => {
	if (platform === 'darwin') {
		arch = 'x64';
	}

	gulp.task(task.define(`node-${platform}-${arch}`, () => {
		const nodePath = path.join('.build', 'node', `v${nodeVersion}`, `${platform}-${arch}`);

		if (!fs.existsSync(nodePath)) {
			util.rimraf(nodePath);

			return nodejs(platform, arch)
				.pipe(vfs.dest(nodePath));
		}

		return Promise.resolve(null);
	}));
});

const defaultNodeTask = gulp.task(`node-${process.platform}-${process.arch}`);

if (defaultNodeTask) {
	gulp.task(task.define('node', defaultNodeTask));
}

function nodejs(platform, arch) {
	if (arch === 'ia32') {
		arch = 'x86';
	}

	if (platform === 'win32') {
		return remote(`/dist/v${nodeVersion}/win-${arch}/node.exe`, { base: 'https://nodejs.org' })
			.pipe(rename('node.exe'));
	}

	if (arch === 'alpine') {
		const contents = cp.execSync(`docker run --rm node:${nodeVersion}-alpine /bin/sh -c 'cat \`which node\`'`, { maxBuffer: 100 * 1024 * 1024, encoding: 'buffer' });
		return es.readArray([new File({ path: 'node', contents, stat: { mode: parseInt('755', 8) } })]);
	}

	if (platform === 'darwin') {
		arch = 'x64';
	}

	if (arch === 'armhf') {
		arch = 'armv7l';
	}

	return remote(`/dist/v${nodeVersion}/node-v${nodeVersion}-${platform}-${arch}.tar.gz`, { base: 'https://nodejs.org' })
		.pipe(flatmap(stream => stream.pipe(gunzip()).pipe(untar())))
		.pipe(filter('**/node'))
		.pipe(util.setExecutableBit('**'))
		.pipe(rename('node'));
}

function mixinServer(watch) {
	const packageJSONPath = path.join(path.dirname(__dirname), 'package.json');
	function exec(cmdLine) {
		console.log(cmdLine);
		cp.execSync(cmdLine, { stdio: 'inherit' });
	}
	function checkout() {
		const packageJSON = JSON.parse(fs.readFileSync(packageJSONPath).toString());
		exec('git fetch distro');
		exec(`git checkout ${packageJSON['distro']} -- src/vs/server resources/server`);
		exec('git reset HEAD src/vs/server resources/server');
	}
	checkout();
	if (watch) {
		console.log('Enter watch mode (observing package.json)');
		const watcher = fs.watch(packageJSONPath);
		watcher.addListener('change', () => {
			try {
				checkout();
			} catch (e) {
				console.log(e);
			}
		});
	}
	return Promise.resolve();
}

gulp.task(task.define('mixin-server', () => mixinServer(false)));
gulp.task(task.define('mixin-server-watch', () => mixinServer(true)));
