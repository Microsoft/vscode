/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const path = require('path');
const es = require('event-stream');
const azure = require('gulp-azure-storage');
const vfs = require('vinyl-fs');
const util = require('../lib/util');
const root = path.dirname(path.dirname(__dirname));
const commit = util.getVersion(root);

// optionally allow to pass in explicit base/maps to upload
const [, , base, maps] = process.argv;

const fetch = function (base, maps = `${base}/**/*.map`) {
	return vfs.src(maps, { base })
		.pipe(es.mapSync(f => {
			f.path = `${f.base}/core/${f.relative}`;
			return f;
		}));
};

function main() {
	const sources = [];

	// vscode client maps (default)
	if (!base) {
		const vs = fetch('out-vscode-min'); // client source-maps only
		sources.push(vs);

		const extensionsOut = vfs.src(['.build/extensions/**/*.js.map', '!**/node_modules/**'], { base: '.build' });
		sources.push(extensionsOut);
	}

	// specific client base/maps
	else {
		sources.push(fetch(base, maps));
	}

	return es.merge(...sources)
		.pipe(es.through(function (data) {
			console.log('Uploading Sourcemap', data.relative); // debug
			this.emit('data', data);
		}))
		.pipe(azure.upload({
			account: process.env.AZURE_STORAGE_ACCOUNT,
			key: process.env.AZURE_STORAGE_ACCESS_KEY,
			container: 'sourcemaps',
			prefix: commit + '/'
		}));
}

main();
