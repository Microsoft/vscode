/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*eslint-env mocha*/
/*global define,run*/

const assert = require('assert');
const path = require('path');
const glob = require('glob');
const jsdom = require('jsdom-no-contextify');
const TEST_GLOB = '**/test/**/*.test.js';
const coverage = require('../coverage');

const optimist = require('optimist')
	.usage('Run the Code tests. All mocha options apply.')
	.describe('build', 'Run from out-build').boolean('build')
	.describe('run', 'Run a single file').string('run')
	.describe('coverage', 'Generate a coverage report').boolean('coverage')
	.describe('browser', 'Run tests in a browser').boolean('browser')
	.alias('h', 'help').boolean('h')
	.describe('h', 'Show help');

const argv = optimist.argv;

if (argv.help) {
	optimist.showHelp();
	process.exit(1);
}

const REPO_ROOT = path.join(__dirname, '../../../');
const out = argv.build ? 'out-build' : 'out';
const loader = require(`../../../${out}/vs/loader`);
const src = path.join(REPO_ROOT, out);

function main() {
	process.on('uncaughtException', function (e) {
		console.error(e.stack || e);
	});

	const loaderConfig = {
		nodeRequire: require,
		nodeMain: __filename,
		baseUrl: path.join(REPO_ROOT, 'src'),
		paths: {
			'vs/css': '../test/unit/node/css.mock',
			'vs': `../${out}/vs`,
			'lib': `../${out}/lib`,
			'bootstrap-fork': `../${out}/bootstrap-fork`
		},
		catchError: true
	};

	if (argv.coverage) {
		coverage.initialize(loaderConfig);

		process.on('exit', function (code) {
			if (code !== 0) {
				return;
			}
			coverage.createReport(argv.run || argv.runGlob);
		});
	}

	loader.config(loaderConfig);

	global.define = loader;
	global.document = jsdom.jsdom('<!doctype html><html><body></body></html>');
	global.self = global.window = global.document.parentWindow;

	global.Element = global.window.Element;
	global.HTMLElement = global.window.HTMLElement;
	global.Node = global.window.Node;
	global.navigator = global.window.navigator;
	global.XMLHttpRequest = global.window.XMLHttpRequest;

	let didErr = false;
	const write = process.stderr.write;
	process.stderr.write = function (data) {
		didErr = didErr || !!data;
		write.apply(process.stderr, arguments);
	};

	let loadFunc = null;

	if (argv.runGlob) {
		loadFunc = (cb) => {
			const doRun = tests => {
				const modulesToLoad = tests.map(test => {
					if (path.isAbsolute(test)) {
						test = path.relative(src, path.resolve(test));
					}

					return test.replace(/(\.js)|(\.d\.ts)|(\.js\.map)$/, '');
				});
				define(modulesToLoad, () => cb(null), cb);
			};

			glob(argv.runGlob, { cwd: src }, function (err, files) { doRun(files); });
		};
	} else if (argv.run) {
		const tests = (typeof argv.run === 'string') ? [argv.run] : argv.run;
		const modulesToLoad = tests.map(function (test) {
			test = test.replace(/^src/, 'out');
			test = test.replace(/\.ts$/, '.js');
			return path.relative(src, path.resolve(test)).replace(/(\.js)|(\.js\.map)$/, '').replace(/\\/g, '/');
		});
		loadFunc = (cb) => {
			define(modulesToLoad, () => cb(null), cb);
		};
	} else {
		loadFunc = (cb) => {
			glob(TEST_GLOB, { cwd: src }, function (err, files) {
				const modulesToLoad = files.map(function (file) {
					return file.replace(/\.js$/, '');
				});
				define(modulesToLoad, function () { cb(null); }, cb);
			});
		};
	}

	loadFunc(function (err) {
		if (err) {
			console.error(err);
			return process.exit(1);
		}

		process.stderr.write = write;

		if (!argv.run && !argv.runGlob) {
			// set up last test
			suite('Loader', function () {
				test('should not explode while loading', function () {
					assert.ok(!didErr, 'should not explode while loading');
				});
			});
		}

		// report failing test for every unexpected error during any of the tests
		let unexpectedErrors = [];
		suite('Errors', function () {
			test('should not have unexpected errors in tests', function () {
				if (unexpectedErrors.length) {
					unexpectedErrors.forEach(function (stack) {
						console.error('');
						console.error(stack);
					});

					assert.ok(false);
				}
			});
		});

		// replace the default unexpected error handler to be useful during tests
		loader(['vs/base/common/errors'], function (errors) {
			errors.setUnexpectedErrorHandler(function (err) {
				const stack = (err && err.stack) || (new Error().stack);
				unexpectedErrors.push((err && err.message ? err.message : err) + '\n' + stack);
			});

			// fire up mocha
			run();
		});
	});
}

if (process.argv.some(function (a) { return /^--browser/.test(a); })) {
	require('./browser');
} else {
	main();
}
