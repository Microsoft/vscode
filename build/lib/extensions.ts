/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as es from 'event-stream';
import * as fs from 'fs';
import * as cp from 'child_process';
import * as glob from 'glob';
import * as gulp from 'gulp';
import * as path from 'path';
import { Stream } from 'stream';
import * as File from 'vinyl';
import { createStatsStream } from './stats';
import * as util2 from './util';
const vzip = require('gulp-vinyl-zip');
import filter = require('gulp-filter');
import rename = require('gulp-rename');
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';
const buffer = require('gulp-buffer');
import * as jsoncParser from 'jsonc-parser';
import webpack = require('webpack');
const util = require('./util');
const root = path.dirname(path.dirname(__dirname));
const commit = util.getVersion(root);
const sourceMappingURLBase = `https://ticino.blob.core.windows.net/sourcemaps/${commit}`;

function minifyExtensionResources(input: Stream): Stream {
	const jsonFilter = filter(['**/*.json', '**/*.code-snippets'], { restore: true });
	return input
		.pipe(jsonFilter)
		.pipe(buffer())
		.pipe(es.mapSync((f: File) => {
			const errors: jsoncParser.ParseError[] = [];
			const value = jsoncParser.parse(f.contents.toString('utf8'), errors);
			if (errors.length === 0) {
				// file parsed OK => just stringify to drop whitespace and comments
				f.contents = Buffer.from(JSON.stringify(value));
			}
			return f;
		}))
		.pipe(jsonFilter.restore);
}

function updateExtensionPackageJSON(input: Stream, update: (data: any) => any): Stream {
	const packageJsonFilter = filter('extensions/*/package.json', { restore: true });
	return input
		.pipe(packageJsonFilter)
		.pipe(buffer())
		.pipe(es.mapSync((f: File) => {
			const data = JSON.parse(f.contents.toString('utf8'));
			f.contents = Buffer.from(JSON.stringify(update(data)));
			return f;
		}))
		.pipe(packageJsonFilter.restore);
}

function fromLocal(extensionPath: string, forWeb: boolean): Stream {
	const webpackConfigFileName = forWeb ? 'extension-browser.webpack.config.js' : 'extension.webpack.config.js';

	const isWebPacked = fs.existsSync(path.join(extensionPath, webpackConfigFileName));
	let input = isWebPacked
		? fromLocalWebpack(extensionPath, webpackConfigFileName)
		: fromLocalNormal(extensionPath);

	if (isWebPacked) {
		input = updateExtensionPackageJSON(input, (data: any) => {
			delete data.scripts;
			delete data.dependencies;
			delete data.devDependencies;
			if (data.main) {
				data.main = data.main.replace('/out/', /dist/);
			}
			return data;
		});
	}

	return input;
}


function fromLocalWebpack(extensionPath: string, webpackConfigFileName: string): Stream {
	const result = es.through();

	const packagedDependencies: string[] = [];
	const packageJsonConfig = require(path.join(extensionPath, 'package.json'));
	if (packageJsonConfig.dependencies) {
		const webpackRootConfig = require(path.join(extensionPath, webpackConfigFileName));
		for (const key in webpackRootConfig.externals) {
			if (key in packageJsonConfig.dependencies) {
				packagedDependencies.push(key);
			}
		}
	}

	const vsce = require('vsce') as typeof import('vsce');
	const webpack = require('webpack');
	const webpackGulp = require('webpack-stream');

	vsce.listFiles({ cwd: extensionPath, packageManager: vsce.PackageManager.Yarn, packagedDependencies }).then(fileNames => {
		const files = fileNames
			.map(fileName => path.join(extensionPath, fileName))
			.map(filePath => new File({
				path: filePath,
				stat: fs.statSync(filePath),
				base: extensionPath,
				contents: fs.createReadStream(filePath) as any
			}));

		// check for a webpack configuration files, then invoke webpack
		// and merge its output with the files stream.
		const webpackConfigLocations = (<string[]>glob.sync(
			path.join(extensionPath, '**', webpackConfigFileName),
			{ ignore: ['**/node_modules'] }
		));

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

		es.merge(...webpackStreams, es.readArray(files))
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

	const vsce = require('vsce') as typeof import('vsce');

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
	const remote = require('gulp-remote-retry-src');
	const json = require('gulp-json-editor') as typeof import('gulp-json-editor');

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
	'vscode-colorize-tests',
	'vscode-test-resolver',
	'ms-vscode.node-debug',
	'ms-vscode.node-debug2',
	'vscode-notebook-tests',
	'vscode-custom-editor-tests',
];

const marketplaceWebExtensionsExclude = new Set([
	'ms-vscode.node-debug',
	'ms-vscode.node-debug2',
	'ms-vscode.js-debug-companion',
	'ms-vscode.js-debug',
	'ms-vscode.vscode-js-profile-table'
]);

interface IBuiltInExtension {
	name: string;
	version: string;
	repo: string;
	metadata: any;
}

const productJson = JSON.parse(fs.readFileSync(path.join(__dirname, '../../product.json'), 'utf8'));
const builtInExtensions: IBuiltInExtension[] = productJson.builtInExtensions || [];
const webBuiltInExtensions: IBuiltInExtension[] = productJson.webBuiltInExtensions || [];

type ExtensionKind = 'ui' | 'workspace' | 'web';
interface IExtensionManifest {
	main: string;
	browser: string;
	extensionKind?: ExtensionKind | ExtensionKind[];
}
/**
 * Loosely based on `getExtensionKind` from `src/vs/workbench/services/extensions/common/extensionManifestPropertiesService.ts`
 */
function isWebExtension(manifest: IExtensionManifest): boolean {
	if (typeof manifest.extensionKind !== 'undefined') {
		const extensionKind = Array.isArray(manifest.extensionKind) ? manifest.extensionKind : [manifest.extensionKind];
		return (extensionKind.indexOf('web') >= 0);
	}
	return (!Boolean(manifest.main) || Boolean(manifest.browser));
}

export function packageLocalExtensionsStream(forWeb: boolean): Stream {
	const localExtensionsDescriptions = (
		(<string[]>glob.sync('extensions/*/package.json'))
			.map(manifestPath => {
				const absoluteManifestPath = path.join(root, manifestPath);
				const extensionPath = path.dirname(path.join(root, manifestPath));
				const extensionName = path.basename(extensionPath);
				return { name: extensionName, path: extensionPath, manifestPath: absoluteManifestPath };
			})
			.filter(({ name }) => excludedExtensions.indexOf(name) === -1)
			.filter(({ name }) => builtInExtensions.every(b => b.name !== name))
			.filter(({ manifestPath }) => (forWeb ? isWebExtension(require(manifestPath)) : true))
	);
	const localExtensionsStream = minifyExtensionResources(
		es.merge(
			...localExtensionsDescriptions.map(extension => {
				return fromLocal(extension.path, forWeb)
					.pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
			})
		)
	);

	let result: Stream;
	if (forWeb) {
		result = localExtensionsStream;
	} else {
		// also include shared node modules
		result = es.merge(localExtensionsStream, gulp.src('extensions/node_modules/**', { base: '.' }));
	}

	return (
		result
			.pipe(util2.setExecutableBit(['**/*.sh']))
	);
}

export function packageMarketplaceExtensionsStream(forWeb: boolean): Stream {
	const marketplaceExtensionsDescriptions = [
		...builtInExtensions.filter(({ name }) => (forWeb ? !marketplaceWebExtensionsExclude.has(name) : true)),
		...(forWeb ? webBuiltInExtensions : [])
	];
	const marketplaceExtensionsStream = minifyExtensionResources(
		es.merge(
			...marketplaceExtensionsDescriptions
				.map(extension => {
					const input = fromMarketplace(extension.name, extension.version, extension.metadata)
						.pipe(rename(p => p.dirname = `extensions/${extension.name}/${p.dirname}`));
					return updateExtensionPackageJSON(input, (data: any) => {
						delete data.scripts;
						delete data.dependencies;
						delete data.devDependencies;
						return data;
					});
				})
		)
	);

	return (
		marketplaceExtensionsStream
			.pipe(util2.setExecutableBit(['**/*.sh']))
	);
}

export interface IScannedBuiltinExtension {
	extensionPath: string;
	packageJSON: any;
	packageNLS?: any;
	readmePath?: string;
	changelogPath?: string;
}

export function scanBuiltinExtensions(extensionsRoot: string, exclude: string[] = []): IScannedBuiltinExtension[] {
	const scannedExtensions: IScannedBuiltinExtension[] = [];

	try {
		const extensionsFolders = fs.readdirSync(extensionsRoot);
		for (const extensionFolder of extensionsFolders) {
			if (exclude.indexOf(extensionFolder) >= 0) {
				continue;
			}
			const packageJSONPath = path.join(extensionsRoot, extensionFolder, 'package.json');
			if (!fs.existsSync(packageJSONPath)) {
				continue;
			}
			let packageJSON = JSON.parse(fs.readFileSync(packageJSONPath).toString('utf8'));
			if (!isWebExtension(packageJSON)) {
				continue;
			}
			const children = fs.readdirSync(path.join(extensionsRoot, extensionFolder));
			const packageNLSPath = children.filter(child => child === 'package.nls.json')[0];
			const packageNLS = packageNLSPath ? JSON.parse(fs.readFileSync(path.join(extensionsRoot, extensionFolder, packageNLSPath)).toString()) : undefined;
			const readme = children.filter(child => /^readme(\.txt|\.md|)$/i.test(child))[0];
			const changelog = children.filter(child => /^changelog(\.txt|\.md|)$/i.test(child))[0];

			scannedExtensions.push({
				extensionPath: extensionFolder,
				packageJSON,
				packageNLS,
				readmePath: readme ? path.join(extensionFolder, readme) : undefined,
				changelogPath: changelog ? path.join(extensionFolder, changelog) : undefined,
			});
		}
		return scannedExtensions;
	} catch (ex) {
		return scannedExtensions;
	}
}

export function translatePackageJSON(packageJSON: string, packageNLSPath: string) {
	interface NLSFormat {
		[key: string]: string | { message: string, comment: string[] };
	}
	const CharCode_PC = '%'.charCodeAt(0);
	const packageNls: NLSFormat = JSON.parse(fs.readFileSync(packageNLSPath).toString());
	const translate = (obj: any) => {
		for (let key in obj) {
			const val = obj[key];
			if (Array.isArray(val)) {
				val.forEach(translate);
			} else if (val && typeof val === 'object') {
				translate(val);
			} else if (typeof val === 'string' && val.charCodeAt(0) === CharCode_PC && val.charCodeAt(val.length - 1) === CharCode_PC) {
				const translated = packageNls[val.substr(1, val.length - 2)];
				if (translated) {
					obj[key] = typeof translated === 'string' ? translated : (typeof translated.message === 'string' ? translated.message : val);
				}
			}
		}
	};
	translate(packageJSON);
	return packageJSON;
}

const extensionsPath = path.join(root, 'extensions');

// Additional projects to webpack. These typically build code for webviews
const webpackMediaConfigFiles = [
	'markdown-language-features/webpack.config.js',
	'simple-browser/webpack.config.js',
];

// Additional projects to run esbuild on. These typically build code for webviews
const esbuildMediaScripts = [
	'markdown-language-features/esbuild.js',
	'markdown-math/esbuild.js',
];

export async function webpackExtensions(taskName: string, isWatch: boolean, webpackConfigLocations: { configPath: string, outputRoot?: string }[]) {
	const webpack = require('webpack') as typeof import('webpack');

	const webpackConfigs: webpack.Configuration[] = [];

	for (const { configPath, outputRoot } of webpackConfigLocations) {
		const configOrFnOrArray = require(configPath);
		function addConfig(configOrFn: webpack.Configuration | Function) {
			let config;
			if (typeof configOrFn === 'function') {
				config = configOrFn({}, {});
				webpackConfigs.push(config);
			} else {
				config = configOrFn;
			}

			if (outputRoot) {
				config.output.path = path.join(outputRoot, path.relative(path.dirname(configPath), config.output.path));
			}

			webpackConfigs.push(configOrFn);
		}
		addConfig(configOrFnOrArray);
	}
	function reporter(fullStats: any) {
		if (Array.isArray(fullStats.children)) {
			for (const stats of fullStats.children) {
				const outputPath = stats.outputPath;
				if (outputPath) {
					const relativePath = path.relative(extensionsPath, outputPath).replace(/\\/g, '/');
					const match = relativePath.match(/[^\/]+(\/server|\/client)?/);
					fancyLog(`Finished ${ansiColors.green(taskName)} ${ansiColors.cyan(match![0])} with ${stats.errors.length} errors.`);
				}
				if (Array.isArray(stats.errors)) {
					stats.errors.forEach((error: any) => {
						fancyLog.error(error);
					});
				}
				if (Array.isArray(stats.warnings)) {
					stats.warnings.forEach((warning: any) => {
						fancyLog.warn(warning);
					});
				}
			}
		}
	}
	return new Promise<void>((resolve, reject) => {
		if (isWatch) {
			webpack(webpackConfigs).watch({}, (err, stats) => {
				if (err) {
					reject();
				} else {
					reporter(stats?.toJson());
				}
			});
		} else {
			webpack(webpackConfigs).run((err, stats) => {
				if (err) {
					fancyLog.error(err);
					reject();
				} else {
					reporter(stats?.toJson());
					resolve();
				}
			});
		}
	});
}

async function esbuildExtensions(taskName: string, isWatch: boolean, scripts: { script: string, outputRoot?: string }[]) {
	function reporter(stdError: string, script: string) {
		const matches = (stdError || '').match(/\> (.+): error: (.+)?/g);
		fancyLog(`Finished ${ansiColors.green(taskName)} ${script} with ${matches ? matches.length : 0} errors.`);
		for (const match of matches || []) {
			fancyLog.error(match);
		}
	}

	const tasks = scripts.map(({ script, outputRoot }) => {
		return new Promise<void>((resolve, reject) => {
			const args = [script];
			if (isWatch) {
				args.push('--watch');
			}
			if (outputRoot) {
				args.push('--outputRoot', outputRoot);
			}
			const proc = cp.execFile(process.argv[0], args, {}, (error, _stdout, stderr) => {
				if (error) {
					return reject(error);
				}
				reporter(stderr, script);
				if (stderr) {
					return reject();
				}
				return resolve();
			});

			proc.stdout!.on('data', (data) => {
				fancyLog(`${ansiColors.green(taskName)}: ${data.toString('utf8')}`);
			});
		});
	});
	return Promise.all(tasks);
}

export async function buildExtensionMedia(isWatch: boolean, outputRoot?: string) {
	return Promise.all([
		webpackExtensions('webpacking extension media', isWatch, webpackMediaConfigFiles.map(p => {
			return {
				configPath: path.join(extensionsPath, p),
				outputRoot: outputRoot ? path.join(root, outputRoot, path.dirname(p)) : undefined
			};
		})),
		esbuildExtensions('esbuilding extension media', isWatch, esbuildMediaScripts.map(p => ({
			script: path.join(extensionsPath, p),
			outputRoot: outputRoot ? path.join(root, outputRoot, path.dirname(p)) : undefined
		}))),
	]);
}
