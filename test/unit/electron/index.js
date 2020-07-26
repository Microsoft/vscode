/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const { app, BrowserWindow, ipcMain } = require('electron');
const { tmpdir } = require('os');
const { join } = require('path');
const path = require('path');
const mocha = require('mocha');
const events = require('events');
// const MochaJUnitReporter = require('mocha-junit-reporter');
const url = require('url');

// Disable render process reuse, we still have
// non-context aware native modules in the renderer.
app.allowRendererProcessReuse = false;

const defaultReporterName = process.platform === 'win32' ? 'list' : 'spec';

const optimist = require('optimist')
	.describe('grep', 'only run tests matching <pattern>').alias('grep', 'g').alias('grep', 'f').string('grep')
	.describe('run', 'only run tests from <file>').string('run')
	.describe('runGlob', 'only run tests matching <file_pattern>').alias('runGlob', 'glob').alias('runGlob', 'runGrep').string('runGlob')
	.describe('build', 'run with build output (out-build)').boolean('build')
	.describe('coverage', 'generate coverage report').boolean('coverage')
	.describe('debug', 'open dev tools, keep window open, reuse app data').string('debug')
	.describe('reporter', 'the mocha reporter').string('reporter').default('reporter', defaultReporterName)
	.describe('reporter-options', 'the mocha reporter options').string('reporter-options').default('reporter-options', '')
	.describe('tfs').string('tfs')
	.describe('help', 'show the help').alias('help', 'h');

const argv = optimist.argv;

if (argv.help) {
	optimist.showHelp();
	process.exit(0);
}

if (!argv.debug) {
	app.setPath('userData', join(tmpdir(), `vscode-tests-${Date.now()}`));
}

function deserializeSuite(suite) {
	return {
		root: suite.root,
		suites: suite.suites,
		tests: suite.tests,
		title: suite.title,
		fullTitle: () => suite.fullTitle,
		timeout: () => suite.timeout,
		retries: () => suite.retries,
		enableTimeouts: () => suite.enableTimeouts,
		slow: () => suite.slow,
		bail: () => suite.bail
	};
}

function deserializeRunnable(runnable) {
	return {
		title: runnable.title,
		fullTitle: () => runnable.fullTitle,
		async: runnable.async,
		slow: () => runnable.slow,
		speed: runnable.speed,
		duration: runnable.duration
	};
}

function deserializeError(err) {
	const inspect = err.inspect;
	err.inspect = () => inspect;
	return err;
}

class IPCRunner extends events.EventEmitter {

	constructor() {
		super();

		this.didFail = false;

		ipcMain.on('start', () => this.emit('start'));
		ipcMain.on('end', () => this.emit('end'));
		ipcMain.on('suite', (e, suite) => this.emit('suite', deserializeSuite(suite)));
		ipcMain.on('suite end', (e, suite) => this.emit('suite end', deserializeSuite(suite)));
		ipcMain.on('test', (e, test) => this.emit('test', deserializeRunnable(test)));
		ipcMain.on('test end', (e, test) => this.emit('test end', deserializeRunnable(test)));
		ipcMain.on('hook', (e, hook) => this.emit('hook', deserializeRunnable(hook)));
		ipcMain.on('hook end', (e, hook) => this.emit('hook end', deserializeRunnable(hook)));
		ipcMain.on('pass', (e, test) => this.emit('pass', deserializeRunnable(test)));
		ipcMain.on('fail', (e, test, err) => {
			this.didFail = true;
			this.emit('fail', deserializeRunnable(test), deserializeError(err));
		});
		ipcMain.on('pending', (e, test) => this.emit('pending', deserializeRunnable(test)));
	}
}

function parseReporterOption(value) {
	let r = /^([^=]+)=(.*)$/.exec(value);
	return r ? { [r[1]]: r[2] } : {};
}

app.on('ready', () => {

	ipcMain.on('error', (_, err) => {
		if (!argv.debug) {
			console.error(err);
			app.exit(1);
		}
	});

	const win = new BrowserWindow({
		height: 600,
		width: 800,
		show: false,
		webPreferences: {
			preload: path.join(__dirname, '..', '..', '..', 'src', 'vs', 'base', 'parts', 'sandbox', 'electron-browser', 'preload.js'), // ensure similar environment as VSCode as tests may depend on this
			nodeIntegration: true,
			enableWebSQL: false,
			enableRemoteModule: false,
			spellcheck: false,
			nativeWindowOpen: true,
			webviewTag: true
		}
	});

	win.webContents.on('did-finish-load', () => {
		if (argv.debug) {
			win.show();
			win.webContents.openDevTools();
		}
		win.webContents.send('run', argv);
	});

	win.loadURL(url.format({ pathname: path.join(__dirname, 'renderer.html'), protocol: 'file:', slashes: true }));

	const runner = new IPCRunner();

	if (argv.tfs) {
		new mocha.reporters.Spec(runner);
		// TODO@deepak the mocha Junit reporter seems to cause a hang when running with Electron 6 inside docker container
		// new MochaJUnitReporter(runner, {
		// 	reporterOptions: {
		// 		testsuitesTitle: `${argv.tfs} ${process.platform}`,
		// 		mochaFile: process.env.BUILD_ARTIFACTSTAGINGDIRECTORY ? path.join(process.env.BUILD_ARTIFACTSTAGINGDIRECTORY, `test-results/${process.platform}-${argv.tfs.toLowerCase().replace(/[^\w]/g, '-')}-results.xml`) : undefined
		// 	}
		// });
	} else {
		const reporterPath = path.join(path.dirname(require.resolve('mocha')), 'lib', 'reporters', argv.reporter);
		let Reporter;

		try {
			Reporter = require(reporterPath);
		} catch (err) {
			try {
				Reporter = require(argv.reporter);
			} catch (err) {
				Reporter = process.platform === 'win32' ? mocha.reporters.List : mocha.reporters.Spec;
				console.warn(`could not load reporter: ${argv.reporter}, using ${Reporter.name}`);
			}
		}

		let reporterOptions = argv['reporter-options'];
		reporterOptions = typeof reporterOptions === 'string' ? [reporterOptions] : reporterOptions;
		reporterOptions = reporterOptions.reduce((r, o) => Object.assign(r, parseReporterOption(o)), {});

		new Reporter(runner, { reporterOptions });
	}

	if (!argv.debug) {
		ipcMain.on('all done', () => app.exit(runner.didFail ? 1 : 0));
	}
});
