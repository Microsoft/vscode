/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check

const path = require('path');
const glob = require('glob');
const fs = require('fs');
const events = require('events');
const mocha = require('mocha');
const url = require('url');
const minimatch = require('minimatch');
const playwright = require('playwright');

// opts
const defaultReporterName = process.platform === 'win32' ? 'list' : 'spec';
const optimist = require('optimist')
	// .describe('grep', 'only run tests matching <pattern>').alias('grep', 'g').alias('grep', 'f').string('grep')
	.describe('build', 'run with build output (out-build)').boolean('build')
	.describe('run', 'only run tests matching <relative_file_path>').string('run')
	.describe('glob', 'only run tests matching <glob_pattern>').string('glob')
	.describe('debug', 'do not run browsers headless').boolean('debug')
	.describe('browser', 'browsers in which tests should run').string('browser').default('browser', ['chromium', 'firefox', 'webkit'])
	.describe('reporter', 'the mocha reporter').string('reporter').default('reporter', defaultReporterName)
	.describe('reporter-options', 'the mocha reporter options').string('reporter-options').default('reporter-options', '')
	.describe('tfs', 'tfs').string('tfs')
	.describe('help', 'show the help').alias('help', 'h');

// logic
const argv = optimist.argv;

if (argv.help) {
	optimist.showHelp();
	process.exit(0);
}

const withReporter = (function () {
	const reporterPath = path.join(path.dirname(require.resolve('mocha')), 'lib', 'reporters', argv.reporter);
	let ctor;

	try {
		ctor = require(reporterPath);
	} catch (err) {
		try {
			ctor = require(argv.reporter);
		} catch (err) {
			ctor = process.platform === 'win32' ? mocha.reporters.List : mocha.reporters.Spec;
			console.warn(`could not load reporter: ${argv.reporter}, using ${ctor.name}`);
		}
	}

	function parseReporterOption(value) {
		let r = /^([^=]+)=(.*)$/.exec(value);
		return r ? { [r[1]]: r[2] } : {};
	}

	let reporterOptions = argv['reporter-options'];
	reporterOptions = typeof reporterOptions === 'string' ? [reporterOptions] : reporterOptions;
	reporterOptions = reporterOptions.reduce((r, o) => Object.assign(r, parseReporterOption(o)), {});

	return (runner) => new ctor(runner, { reporterOptions })
})()

const outdir = argv.build ? 'out-build' : 'out';
const out = path.join(__dirname, `../../../${outdir}`);

function ensureIsArray(a) {
	return Array.isArray(a) ? a : [a];
}

const testModules = (async function () {

	const excludeGlob = '**/{node,electron-browser,electron-main}/**/*.test.js';
	let isDefaultModules = true;
	let promise;

	if (argv.run) {
		// use file list (--run)
		isDefaultModules = false;
		promise = Promise.resolve(ensureIsArray(argv.run).map(file => {
			file = file.replace(/^src/, 'out');
			file = file.replace(/\.ts$/, '.js');
			return path.relative(out, file);
		}));

	} else {
		// glob patterns (--glob)
		const defaultGlob = '**/*.test.js';
		const pattern = argv.glob || defaultGlob
		isDefaultModules = pattern === defaultGlob;

		promise = new Promise((resolve, reject) => {
			glob(pattern, { cwd: out }, (err, files) => {
				if (err) {
					reject(err);
				} else {
					resolve(files)
				}
			});
		});
	}

	return promise.then(files => {
		const modules = [];
		for (let file of files) {
			if (!minimatch(file, excludeGlob)) {
				modules.push(file.replace(/\.js$/, ''));

			} else if (!isDefaultModules) {
				console.warn(`DROPPONG ${file} because it cannot be run inside a browser`);
			}
		}
		return modules;
	})
})();


async function runTestsInBrowser(testModules, browserType) {
	const args = process.platform === 'linux' && browserType === 'chromium' ? ['--no-sandbox'] : undefined; // disable sandbox to run chrome on certain Linux distros
	const browser = await playwright[browserType].launch({ headless: !Boolean(argv.debug), args });
	const context = await browser.newContext();
	const page = await context.newPage();
	const target = url.pathToFileURL(path.join(__dirname, 'renderer.html'));
	if (argv.build) {
		target.search = `?build=true`;
	}
	await page.goto(target.href);

	const emitter = new events.EventEmitter();
	await page.exposeFunction('mocha_report', (type, data1, data2) => {
		emitter.emit(type, data1, data2)
	});

	page.on('console', async msg => {
		console[msg.type()](msg.text(), await Promise.all(msg.args().map(async arg => await arg.jsonValue())));
	});

	withReporter(new EchoRunner(emitter, browserType.toUpperCase()));

	// collection failures for console printing
	const fails = [];
	emitter.on('fail', (test, err) => {
		if (err.stack) {
			const regex = /(vs\/.*\.test)\.js/;
			for (let line of String(err.stack).split('\n')) {
				const match = regex.exec(line);
				if (match) {
					fails.push(match[1]);
					break;
				}
			}
		}
	});

	try {
		// @ts-expect-error
		await page.evaluate(modules => loadAndRun(modules), testModules);
	} catch (err) {
		console.error(err);
	}
	await browser.close();

	if (fails.length > 0) {
		return `to DEBUG, open ${browserType.toUpperCase()} and navigate to ${target.href}?${fails.map(module => `m=${module}`).join('&')}`;
	}
}

class EchoRunner extends events.EventEmitter {

	constructor(event, title = '') {
		super();
		event.on('start', () => this.emit('start'));
		event.on('end', () => this.emit('end'));
		event.on('suite', (suite) => this.emit('suite', EchoRunner.deserializeSuite(suite, title)));
		event.on('suite end', (suite) => this.emit('suite end', EchoRunner.deserializeSuite(suite, title)));
		event.on('test', (test) => this.emit('test', EchoRunner.deserializeRunnable(test)));
		event.on('test end', (test) => this.emit('test end', EchoRunner.deserializeRunnable(test)));
		event.on('hook', (hook) => this.emit('hook', EchoRunner.deserializeRunnable(hook)));
		event.on('hook end', (hook) => this.emit('hook end', EchoRunner.deserializeRunnable(hook)));
		event.on('pass', (test) => this.emit('pass', EchoRunner.deserializeRunnable(test)));
		event.on('fail', (test, err) => this.emit('fail', EchoRunner.deserializeRunnable(test, title), EchoRunner.deserializeError(err)));
		event.on('pending', (test) => this.emit('pending', EchoRunner.deserializeRunnable(test)));
	}

	static deserializeSuite(suite, titleExtra) {
		return {
			root: suite.root,
			suites: suite.suites,
			tests: suite.tests,
			title: titleExtra && suite.title ? `${suite.title} - /${titleExtra}/` : suite.title,
			fullTitle: () => suite.fullTitle,
			timeout: () => suite.timeout,
			retries: () => suite.retries,
			enableTimeouts: () => suite.enableTimeouts,
			slow: () => suite.slow,
			bail: () => suite.bail
		};
	}

	static deserializeRunnable(runnable, titleExtra) {
		return {
			title: runnable.title,
			fullTitle: () => titleExtra && runnable.fullTitle ? `${runnable.fullTitle} - /${titleExtra}/` : runnable.fullTitle,
			async: runnable.async,
			slow: () => runnable.slow,
			speed: runnable.speed,
			duration: runnable.duration
		};
	}

	static deserializeError(err) {
		const inspect = err.inspect;
		err.inspect = () => inspect;
		return err;
	}
}

testModules.then(async modules => {

	// run tests in selected browsers
	const browserTypes = Array.isArray(argv.browser)
		? argv.browser : [argv.browser];

	const promises = browserTypes.map(async browserType => {
		try {
			return await runTestsInBrowser(modules, browserType);
		} catch (err) {
			console.error(err);
			process.exit(1);
		}
	});

	// aftermath
	let didFail = false;
	const messages = await Promise.all(promises);
	for (let msg of messages) {
		if (msg) {
			didFail = true;
			console.log(msg);
		}
	}
	process.exit(didFail ? 1 : 0);

}).catch(err => {
	console.error(err);
});
