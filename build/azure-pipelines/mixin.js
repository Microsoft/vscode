/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const json = require('gulp-json-editor');
const buffer = require('gulp-buffer');
const filter = require('gulp-filter');
const es = require('event-stream');
const vfs = require('vinyl-fs');
const fancyLog = require('fancy-log');
const ansiColors = require('ansi-colors');
const fs = require('fs');
const path = require('path');

function main() {
	const quality = process.env['VSCODE_QUALITY'];

	if (!quality) {
		console.log('Missing VSCODE_QUALITY, skipping mixin');
		return;
	}

	const productJsonFilter = filter(f => f.relative === 'product.json', { restore: true });

	fancyLog(ansiColors.blue('[mixin]'), `Mixing in sources:`);
	return vfs
		.src(`quality/${quality}/**`, { base: `quality/${quality}` })
		.pipe(filter(f => !f.isDirectory()))
		.pipe(productJsonFilter)
		.pipe(buffer())
		.pipe(json(o => {
			const ossProduct = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'product.json'), 'utf8'));
			let builtInExtensions = ossProduct.builtInExtensions;

			if (Array.isArray(o.builtInExtensions)) {
				fancyLog(ansiColors.blue('[mixin]'), 'Overwriting built-in extensions:', o.builtInExtensions.map(e => e.name));

				builtInExtensions = o.builtInExtensions;
			} else if (o.builtInExtensions) {
				const include = o.builtInExtensions['include'] || [];
				const exclude = o.builtInExtensions['exclude'] || [];

				fancyLog(ansiColors.blue('[mixin]'), 'OSS built-in extensions:', builtInExtensions.map(e => e.name));
				fancyLog(ansiColors.blue('[mixin]'), 'Including built-in extensions:', include.map(e => e.name));
				fancyLog(ansiColors.blue('[mixin]'), 'Excluding built-in extensions:', exclude);

				builtInExtensions = builtInExtensions.filter(ext => !include.find(e => e.name === ext.name) && !exclude.find(name => name === ext.name));
				builtInExtensions = [...builtInExtensions, ...include];

				fancyLog(ansiColors.blue('[mixin]'), 'Final built-in extensions:', builtInExtensions.map(e => e.name));
			} else {
				fancyLog(ansiColors.blue('[mixin]'), 'Inheriting OSS built-in extensions', builtInExtensions.map(e => e.name));
			}

			return { ...o, builtInExtensions };
		}))
		.pipe(productJsonFilter.restore)
		.pipe(es.mapSync(function (f) {
			fancyLog(ansiColors.blue('[mixin]'), f.relative, ansiColors.green('✔︎'));
			return f;
		}))
		.pipe(vfs.dest('.'));
}

main();
