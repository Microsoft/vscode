/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Increase max listeners for event emitters
require('events').EventEmitter.defaultMaxListeners = 100;

const gulp = require('gulp');
const path = require('path');
const nodeUtil = require('util');
const tsb = require('gulp-tsb');
const es = require('event-stream');
const filter = require('gulp-filter');
const webpack = require('webpack');
const util = require('./lib/util');
const task = require('./lib/task');
const watcher = require('./lib/watch');
const createReporter = require('./lib/reporter').createReporter;
const glob = require('glob');
const sourcemaps = require('gulp-sourcemaps');
const nlsDev = require('vscode-nls-dev');
const root = path.dirname(__dirname);
const commit = util.getVersion(root);
const plumber = require('gulp-plumber');
const fancyLog = require('fancy-log');
const ansiColors = require('ansi-colors');
const ext = require('./lib/extensions');

const extensionsPath = path.join(path.dirname(__dirname), 'extensions');

const compilations = glob.sync('**/tsconfig.json', {
	cwd: extensionsPath,
	ignore: ['**/out/**', '**/node_modules/**']
});

const getBaseUrl = out => `https://ticino.blob.core.windows.net/sourcemaps/${commit}/${out}`;

const tasks = compilations.map(function (tsconfigFile) {
	const absolutePath = path.join(extensionsPath, tsconfigFile);
	const relativeDirname = path.dirname(tsconfigFile);

	const overrideOptions = {};
	overrideOptions.sourceMap = true;

	const name = relativeDirname.replace(/\//g, '-');

	const root = path.join('extensions', relativeDirname);
	const srcBase = path.join(root, 'src');
	const src = path.join(srcBase, '**');
	const srcOpts = { cwd: path.dirname(__dirname), base: srcBase };

	const out = path.join(root, 'out');
	const baseUrl = getBaseUrl(out);

	let headerId, headerOut;
	let index = relativeDirname.indexOf('/');
	if (index < 0) {
		headerId = 'vscode.' + relativeDirname;
		headerOut = 'out';
	} else {
		headerId = 'vscode.' + relativeDirname.substr(0, index);
		headerOut = relativeDirname.substr(index + 1) + '/out';
	}

	function createPipeline(build, emitError) {
		const reporter = createReporter('extensions');

		overrideOptions.inlineSources = Boolean(build);
		overrideOptions.base = path.dirname(absolutePath);

		const compilation = tsb.create(absolutePath, overrideOptions, false, err => reporter(err.toString()));

		const pipeline = function () {
			const input = es.through();
			const tsFilter = filter(['**/*.ts', '!**/lib/lib*.d.ts', '!**/node_modules/**'], { restore: true });
			const output = input
				.pipe(plumber({
					errorHandler: function (err) {
						if (err && !err.__reporter__) {
							reporter(err);
						}
					}
				}))
				.pipe(tsFilter)
				.pipe(util.loadSourcemaps())
				.pipe(compilation())
				.pipe(build ? nlsDev.rewriteLocalizeCalls() : es.through())
				.pipe(build ? util.stripSourceMappingURL() : es.through())
				.pipe(sourcemaps.write('.', {
					sourceMappingURL: !build ? null : f => `${baseUrl}/${f.relative}.map`,
					addComment: !!build,
					includeContent: !!build,
					sourceRoot: '../src'
				}))
				.pipe(tsFilter.restore)
				.pipe(build ? nlsDev.bundleMetaDataFiles(headerId, headerOut) : es.through())
				// Filter out *.nls.json file. We needed them only to bundle meta data file.
				.pipe(filter(['**', '!**/*.nls.json']))
				.pipe(reporter.end(emitError));

			return es.duplex(input, output);
		};

		// add src-stream for project files
		pipeline.tsProjectSrc = () => {
			return compilation.src(srcOpts);
		};
		return pipeline;
	}

	const cleanTask = task.define(`clean-extension-${name}`, util.rimraf(out));

	const compileTask = task.define(`compile-extension:${name}`, task.series(cleanTask, () => {
		const pipeline = createPipeline(false, true);
		const nonts = gulp.src(src, srcOpts).pipe(filter(['**', '!**/*.ts']));
		const input = es.merge(nonts, pipeline.tsProjectSrc());

		return input
			.pipe(pipeline())
			.pipe(gulp.dest(out));
	}));

	const watchTask = task.define(`watch-extension:${name}`, task.series(cleanTask, () => {
		const pipeline = createPipeline(false);
		const nonts = gulp.src(src, srcOpts).pipe(filter(['**', '!**/*.ts']));
		const input = es.merge(nonts, pipeline.tsProjectSrc());
		const watchInput = watcher(src, { ...srcOpts, ...{ readDelay: 200 } });

		return watchInput
			.pipe(util.incremental(pipeline, input))
			.pipe(gulp.dest(out));
	}));

	const compileBuildTask = task.define(`compile-build-extension-${name}`, task.series(cleanTask, () => {
		const pipeline = createPipeline(true, true);
		const nonts = gulp.src(src, srcOpts).pipe(filter(['**', '!**/*.ts']));
		const input = es.merge(nonts, pipeline.tsProjectSrc());

		return input
			.pipe(pipeline())
			.pipe(gulp.dest(out));
	}));

	// Tasks
	gulp.task(compileTask);
	gulp.task(watchTask);

	return { compileTask, watchTask, compileBuildTask };
});

const compileExtensionsTask = task.define('compile-extensions', task.parallel(...tasks.map(t => t.compileTask)));
gulp.task(compileExtensionsTask);
exports.compileExtensionsTask = compileExtensionsTask;

const watchExtensionsTask = task.define('watch-extensions', task.parallel(...tasks.map(t => t.watchTask)));
gulp.task(watchExtensionsTask);
exports.watchExtensionsTask = watchExtensionsTask;

const compileExtensionsBuildLegacyTask = task.define('compile-extensions-build-legacy', task.parallel(...tasks.map(t => t.compileBuildTask)));
gulp.task(compileExtensionsBuildLegacyTask);

// Azure Pipelines

const cleanExtensionsBuildTask = task.define('clean-extensions-build', util.rimraf('.build/extensions'));
const compileExtensionsBuildTask = task.define('compile-extensions-build', task.series(
	cleanExtensionsBuildTask,
	task.define('bundle-extensions-build', () => ext.packageLocalExtensionsStream(false).pipe(gulp.dest('.build'))),
	task.define('bundle-marketplace-extensions-build', () => ext.packageMarketplaceExtensionsStream(false).pipe(gulp.dest('.build'))),
));

gulp.task(compileExtensionsBuildTask);
exports.compileExtensionsBuildTask = compileExtensionsBuildTask;

const compileWebExtensionsTask = task.define('compile-web', () => buildWebExtensions(false));
gulp.task(compileWebExtensionsTask);
exports.compileWebExtensionsTask = compileWebExtensionsTask;

const watchWebExtensionsTask = task.define('watch-web', () => buildWebExtensions(true));
gulp.task(watchWebExtensionsTask);
exports.watchWebExtensionsTask = watchWebExtensionsTask;

async function buildWebExtensions(isWatch) {

	const webpackConfigLocations = await nodeUtil.promisify(glob)(
		path.join(extensionsPath, '**', 'extension-browser.webpack.config.js'),
		{ ignore: ['**/node_modules'] }
	);

	const webpackConfigs = [];

	for (const webpackConfigPath of webpackConfigLocations) {
		const configOrFnOrArray = require(webpackConfigPath);
		function addConfig(configOrFn) {
			if (typeof configOrFn === 'function') {
				webpackConfigs.push(configOrFn({}, {}));
			} else {
				webpackConfigs.push(configOrFn);
			}
		}
		addConfig(configOrFnOrArray);
	}
	function reporter(fullStats) {
		if (Array.isArray(fullStats.children)) {
			for (const stats of fullStats.children) {
				const outputPath = stats.outputPath;
				if (outputPath) {
					const relativePath = path.relative(extensionsPath, outputPath).replace(/\\/g, '/');
					const match = relativePath.match(/[^\/]+(\/server|\/client)?/);
					fancyLog(`Finished ${ansiColors.green('packaging web extension')} ${ansiColors.cyan(match[0])} with ${stats.errors.length} errors.`);
				}
				if (Array.isArray(stats.errors)) {
					stats.errors.forEach(error => {
						fancyLog.error(error);
					});
				}
				if (Array.isArray(stats.warnings)) {
					stats.warnings.forEach(warning => {
						fancyLog.warn(warning);
					});
				}
			}
		}
	}
	return new Promise((resolve, reject) => {
		if (isWatch) {
			webpack(webpackConfigs).watch({}, (err, stats) => {
				if (err) {
					reject();
				} else {
					reporter(stats.toJson());
				}
			});
		} else {
			webpack(webpackConfigs).run((err, stats) => {
				if (err) {
					fancyLog.error(err);
					reject();
				} else {
					reporter(stats.toJson());
					resolve();
				}
			});
		}
	});
}


