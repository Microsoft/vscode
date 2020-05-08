/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as es from 'event-stream';
import * as fs from 'fs';
import * as glob from 'glob';
import * as gulp from 'gulp';
import * as path from 'path';
import { Stream } from 'stream';
import * as File from 'vinyl';
import * as vsce from 'vsce';
import { createStatsStream } from './stats';
import * as util2 from './util';
import remote = require('gulp-remote-retry-src');
const vzip = require('gulp-vinyl-zip');
import filter = require('gulp-filter');
import rename = require('gulp-rename');
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';
const buffer = require('gulp-buffer');
import json = require('gulp-json-editor');
const webpack = require('webpack');
const webpackGulp = require('webpack-stream');
const util = require('./util');
const root = path.dirname(path.dirname(__dirname));
const commit = util.getVersion(root);
const sourceMappingURLBase = `https://ticino.blob.core.windows.net/sourcemaps/${commit}`;

function fromLocal(extensionPath: string): Stream {
	const webpackFilename = path.join(extensionPath, 'extension.webpack.config.js');
	const input = fs.existsSync(webpackFilename)
		? fromLocalWebpack(extensionPath)
		: fromLocalNormal(extensionPath);

	const tmLanguageJsonFilter = filter('**/*.tmLanguage.json', { restore: true });

	return input
		.pipe(tmLanguageJsonFilter)
		.pipe(buffer())
		.pipe(es.mapSync((f: File) => {
			f.contents = Buffer.from(JSON.stringify(JSON.parse(f.contents.toString('utf8'))));
			return f;
		}))
		.pipe(tmLanguageJsonFilter.restore);
}

function fromLocalWebpack(extensionPath: string): Stream {
	const result = es.through();

	const packagedDependencies: string[] = [];
	const packageJsonConfig = require(path.join(extensionPath, 'package.json'));
	if (packageJsonConfig.dependencies) {
		const webpackRootConfig = require(path.join(extensionPath, 'extension.webpack.config.js'));
		for (const key in webpackRootConfig.externals) {
			if (key in packageJsonConfig.dependencies) {
				packagedDependencies.push(key);
			}
		}
	}

	vsce.listFiles({ cwd: extensionPath, packageManager: vsce.PackageManager.Yarn, packagedDependencies }).then(fileNames => {
		const files = fileNames
			.map(fileName => path.join(extensionPath, fileName))
			.map(filePath => new File({
				path: filePath,
				stat: fs.statSync(filePath),
				base: extensionPath,
				contents: fs.createReadStream(filePath) as any
			}));

		const filesStream = es.readArray(files);

		// check for a webpack configuration files, then invoke webpack
		// and merge its output with the files stream. also rewrite the package.json
		// file to a new entry point
		const webpackConfigLocations = (<string[]>glob.sync(
			path.join(extensionPath, '/**/extension.webpack.config.js'),
			{ ignore: ['**/node_modules'] }
		));

		const packageJsonFilter = filter(f => {
			if (path.basename(f.path) === 'package.json') {
				// only modify package.json's next to the webpack file.
				// to be safe, use existsSync instead of path comparison.
				return fs.existsSync(path.join(path.dirname(f.path), 'extension.webpack.config.js'));
			}
			return false;
		}, { restore: true });

		const patchFilesStream = filesStream
			.pipe(packageJsonFilter)
			.pipe(buffer())
			.pipe(json((data: any) => {
				if (data.main) {
					// hardcoded entry point directory!
					data.main = data.main.replace('/out/', /dist/);
				}
				return data;
			}))
			.pipe(packageJsonFilter.restore);


		const webpackStreams = webpackConfigLocations.map(webpackConfigPath => {

			const webpackDone = (err: any, stats: any) => {
				fancyLog(`Bundled extension: ${ansiColors.yellow(path.join(path.basename(extensionPath), path.relative(extensionPath, webpackConfigPath)))}...`);
				if (err) {
					result.emit('error', err);
				}
				const { compilation } = stats;
				if (compilation.errors.length > 0) {
					result.emit('error', compilation.errors.join('\n'));
				}
				if (compilation.warnings.length > 0) {
					result.emit('error', compilation.warnings.join('\n'));
				}
			};

			const webpackConfig = {
				...require(webpackConfigPath),
				...{ mode: 'production' }
			};
			const relativeOutputPath = path.relative(extensionPath, webpackConfig.output.path);

			return webpackGulp(webpackConfig, webpack, webpackDone)
				.pipe(es.through(function (data) {
					data.stat = data.stat || {};
					data.base = extensionPath;
					this.emit('data', data);
				}))
				.pipe(es.through(function (data: File) {
					// source map handling:
					// * rewrite sourceMappingURL
					// * save to disk so that upload-task picks this up
					const contents = (<Buffer>data.contents).toString('utf8');
					data.contents = Buffer.from(contents.replace(/\n\/\/# sourceMappingURL=(.*)$/gm, function (_m, g1) {
						return `\n//# sourceMappingURL=${sourceMappingURLBase}/extensions/${path.basename(extensionPath)}/${relativeOutputPath}/${g1}`;
					}), 'utf8');

					this.emit('data', data);
				}));
		});

		es.merge(...webpackStreams, patchFilesStream)
			// .pipe(es.through(function (data) {
			// 	// debug
			// 	console.log('out', data.path, data.contents.length);
			// 	this.emit('data', data);
			// }))
			.pipe(result);

	}).catch(err => {
		console.error(extensionPath);
		console.error(packagedDependencies);
		result.emit('error', err);
	});

	return result.pipe(createStatsStream(path.basename(extensionPath)));
}

function fromLocalNormal(extensionPath: string): Stream {
	const result = es.through();

	vsce.listFiles({ cwd: extensionPath, packageManager: vsce.PackageManager.Yarn })
		.then(fileNames => {
			const files = fileNames
				.map(fileName => path.join(extensionPath, fileName))
				.map(filePath => new File({
					path: filePath,
					stat: fs.statSync(filePath),
					base: extensionPath,
					contents: fs.createReadStream(filePath) as any
				}));

			es.readArray(files).pipe(result);
		})
		.catch(err => result.emit('error', err));

	return result.pipe(createStatsStream(path.basename(extensionPath)));
}

const baseHeaders = {
	'X-Market-Client-Id': 'VSCode Build',
	'User-Agent': 'VSCode Build',
	'X-Market-User-Id': '291C1CD0-051A-4123-9B4B-30D60EF52EE2',
};

export function fromMarketplace(extensionName: string, version: string, metadata: any): Stream {
	const [publisher, name] = extensionName.split('.');
	const url = `https://marketplace.visualstudio.com/_apis/public/gallery/publishers/${publisher}/vsextensions/${name}/${version}/vspackage`;

	fancyLog('Downloading extension:', ansiColors.yellow(`${extensionName}@${version}`), '...');

	const options = {
		base: url,
		requestOptions: {
			gzip: true,
			headers: baseHeaders
		}
	};

	const packageJsonFilter = filter('package.json', { restore: true });

	return remote('', options)
		.pipe(vzip.src())
		.pipe(filter('extension/**'))
		.pipe(rename(p => p.dirname = p.dirname!.replace(/^extension\/?/, '')))
		.pipe(packageJsonFilter)
		.pipe(buffer())
		.pipe(json({ __metadata: metadata }))
		.pipe(packageJsonFilter.restore);
}

const excludedExtensions = [
	'vscode-api-tests',
	'vscode-web-playground',
	'vscode-colorize-tests',
	'vscode-test-resolver',
	'ms-vscode.node-debug',
	'ms-vscode.node-debug2',
	'vscode-notebook-tests'
];

interface IBuiltInExtension {
	name: string;
	version: string;
	repo: string;
	metadata: any;
}

const builtInExtensions: IBuiltInExtension[] = JSON.parse(fs.readFileSync(path.join(__dirname, '../../product.json'), 'utf8')).builtInExtensions;

export function packageLocalExtensionsStream(): NodeJS.ReadWriteStream {
	const localExtensionDescriptions = (<string[]>glob.sync('extensions/*/package.json'))
		.map(manifestPath => {
			const extensionPath = path.dirname(path.join(root, manifestPath));
			const extensionName = path.basename(extensionPath);
			return { name: extensionName, path: extensionPath };
		})
		.filter(({ name }) => excludedExtensions.indexOf(name) === -1)
		.filter(({ name }) => builtInExtensions.every(b => b.name !== name));

	const nodeModules = gulp.src('extensions/node_modules/**', { base: '.' });
	const localExtensions = localExtensionDescriptions.map(extension => {
		return fromLocal(extension.path)
			.pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
	});

	return es.merge(nodeModules, ...localExtensions)
		.pipe(util2.setExecutableBit(['**/*.sh']));
}

export function packageMarketplaceExtensionsStream(): NodeJS.ReadWriteStream {
	const extensions = builtInExtensions.map(extension => {
		return fromMarketplace(extension.name, extension.version, extension.metadata)
			.pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
	});

	return es.merge(extensions)
		.pipe(util2.setExecutableBit(['**/*.sh']));
}
