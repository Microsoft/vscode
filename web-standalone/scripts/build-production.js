#!/usr/bin/env node

const fs = require('fs-extra');
const path = require('path');
const rimraf = require('rimraf');

const {
	EXTENSIONS,
	WEB_EXTENSIONS,
	REMOTE
} = require('../build-config.json');

// clean
rimraf.sync(path.join(__dirname, '../public'));

// copy from assets
fs.copySync(path.join(__dirname, '../assets'), path.join(__dirname, '../public'));

// copy out
fs.copySync(path.join(__dirname, '../../out'), path.join(__dirname, '../public/out'));

// copy extensions
fs.mkdirsSync(path.join(__dirname, '../public/static-extension'));
for (const folder of EXTENSIONS) {
	fs.copySync(
		path.join(__dirname, '../../extensions', folder),
		path.join(__dirname, '../public/static-extension', folder)
	);
}

// copy web-extensions
fs.mkdirsSync(path.join(__dirname, '../public/web-extension'));
for (const folder of WEB_EXTENSIONS) {
	// ignore node_modules
	fs.mkdirsSync(path.join(__dirname, '../public/web-extension', folder));
	fs.copySync(path.join(__dirname, '../extensions', folder, 'out'), path.join(__dirname, '../public/web-extension', folder, 'out'));
	fs.copySync(path.join(__dirname, '../extensions', folder, 'package.json'), path.join(__dirname, '../public/web-extension', folder, 'package.json'));
}

// copy remote
fs.mkdirsSync(path.join(__dirname, '../public/remote'));
for (const folder of REMOTE) {
	fs.copySync(path.join(__dirname, '../../node_modules', folder), path.join(__dirname, '../public/remote', folder));
}
