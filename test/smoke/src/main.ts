/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as cp from 'child_process';
import * as path from 'path';
import * as minimist from 'minimist';
import * as tmp from 'tmp';
import * as rimraf from 'rimraf';
import * as mkdirp from 'mkdirp';
import { ncp } from 'ncp';
import {
	Application,
	Quality,
	ApplicationOptions,
	MultiLogger,
	Logger,
	ConsoleLogger,
	FileLogger,
} from '../../automation';

import { setup as setupDataMigrationTests } from './areas/workbench/data-migration.test';
import { setup as setupDataLossTests } from './areas/workbench/data-loss.test';
import { setup as setupDataPreferencesTests } from './areas/preferences/preferences.test';
import { setup as setupDataSearchTests } from './areas/search/search.test';
import { setup as setupDataNotebookTests } from './areas/notebook/notebook.test';
import { setup as setupDataLanguagesTests } from './areas/languages/languages.test';
import { setup as setupDataEditorTests } from './areas/editor/editor.test';
import { setup as setupDataStatusbarTests } from './areas/statusbar/statusbar.test';
import { setup as setupDataExtensionTests } from './areas/extensions/extensions.test';
import { setup as setupDataMultirootTests } from './areas/multiroot/multiroot.test';
import { setup as setupDataLocalizationTests } from './areas/workbench/localization.test';
import { setup as setupLaunchTests } from './areas/workbench/launch.test';

if (!/^v10/.test(process.version) && !/^v12/.test(process.version)) {
	console.error('Error: Smoketest must be run using Node 10/12. Currently running', process.version);
	process.exit(1);
}

const tmpDir = tmp.dirSync({ prefix: 't' }) as { name: string; removeCallback: Function; };
const testDataPath = tmpDir.name;
process.once('exit', () => rimraf.sync(testDataPath));

const [, , ...args] = process.argv;
const opts = minimist(args, {
	string: [
		'browser',
		'build',
		'stable-build',
		'wait-time',
		'test-repo',
		'screenshots',
		'log'
	],
	boolean: [
		'verbose',
		'remote',
		'web'
	],
	default: {
		verbose: false
	}
});

const testRepoUrl = 'https://github.com/Microsoft/vscode-smoketest-express';
const workspacePath = path.join(testDataPath, 'vscode-smoketest-express');
const extensionsPath = path.join(testDataPath, 'extensions-dir');
mkdirp.sync(extensionsPath);

const screenshotsPath = opts.screenshots ? path.resolve(opts.screenshots) : null;
if (screenshotsPath) {
	mkdirp.sync(screenshotsPath);
}

function fail(errorMessage): void {
	console.error(errorMessage);
	process.exit(1);
}

const repoPath = path.join(__dirname, '..', '..', '..');

let quality: Quality;

//
// #### Electron Smoke Tests ####
//
if (!opts.web) {

	function getDevElectronPath(): string {
		const buildPath = path.join(repoPath, '.build');
		const product = require(path.join(repoPath, 'product.json'));

		switch (process.platform) {
			case 'darwin':
				return path.join(buildPath, 'electron', `${product.nameLong}.app`, 'Contents', 'MacOS', 'Electron');
			case 'linux':
				return path.join(buildPath, 'electron', `${product.applicationName}`);
			case 'win32':
				return path.join(buildPath, 'electron', `${product.nameShort}.exe`);
			default:
				throw new Error('Unsupported platform.');
		}
	}

	function getBuildElectronPath(root: string): string {
		switch (process.platform) {
			case 'darwin':
				return path.join(root, 'Contents', 'MacOS', 'Electron');
			case 'linux': {
				const product = require(path.join(root, 'resources', 'app', 'product.json'));
				return path.join(root, product.applicationName);
			}
			case 'win32': {
				const product = require(path.join(root, 'resources', 'app', 'product.json'));
				return path.join(root, `${product.nameShort}.exe`);
			}
			default:
				throw new Error('Unsupported platform.');
		}
	}

	let testCodePath = opts.build;
	let stableCodePath = opts['stable-build'];
	let electronPath: string;
	let stablePath: string | undefined = undefined;

	if (testCodePath) {
		electronPath = getBuildElectronPath(testCodePath);

		if (stableCodePath) {
			stablePath = getBuildElectronPath(stableCodePath);
		}
	} else {
		testCodePath = getDevElectronPath();
		electronPath = testCodePath;
		process.env.VSCODE_REPOSITORY = repoPath;
		process.env.VSCODE_DEV = '1';
		process.env.VSCODE_CLI = '1';
	}

	if (!fs.existsSync(electronPath || '')) {
		fail(`Can't find VSCode at ${electronPath}.`);
	}

	if (typeof stablePath === 'string' && !fs.existsSync(stablePath)) {
		fail(`Can't find Stable VSCode at ${stablePath}.`);
	}

	if (process.env.VSCODE_DEV === '1') {
		quality = Quality.Dev;
	} else if (electronPath.indexOf('Code - Insiders') >= 0 /* macOS/Windows */ || electronPath.indexOf('code-insiders') /* Linux */ >= 0) {
		quality = Quality.Insiders;
	} else {
		quality = Quality.Stable;
	}

	console.log(`Running desktop smoke tests against ${electronPath}`);
}

//
// #### Web Smoke Tests ####
//
else {
	const testCodeServerPath = opts.build || process.env.VSCODE_REMOTE_SERVER_PATH;

	if (typeof testCodeServerPath === 'string') {
		if (!fs.existsSync(testCodeServerPath)) {
			fail(`Can't find Code server at ${testCodeServerPath}.`);
		} else {
			console.log(`Running web smoke tests against ${testCodeServerPath}`);
		}
	}

	if (!testCodeServerPath) {
		process.env.VSCODE_REPOSITORY = repoPath;
		process.env.VSCODE_DEV = '1';
		process.env.VSCODE_CLI = '1';

		console.log(`Running web smoke out of sources`);
	}

	if (process.env.VSCODE_DEV === '1') {
		quality = Quality.Dev;
	} else {
		quality = Quality.Insiders;
	}
}

const userDataDir = path.join(testDataPath, 'd');

async function setupRepository(): Promise<void> {
	if (opts['test-repo']) {
		console.log('*** Copying test project repository:', opts['test-repo']);
		rimraf.sync(workspacePath);
		// not platform friendly
		if (process.platform === 'win32') {
			cp.execSync(`xcopy /E "${opts['test-repo']}" "${workspacePath}"\\*`);
		} else {
			cp.execSync(`cp -R "${opts['test-repo']}" "${workspacePath}"`);
		}

	} else {
		if (!fs.existsSync(workspacePath)) {
			console.log('*** Cloning test project repository...');
			cp.spawnSync('git', ['clone', testRepoUrl, workspacePath]);
		} else {
			console.log('*** Cleaning test project repository...');
			cp.spawnSync('git', ['fetch'], { cwd: workspacePath });
			cp.spawnSync('git', ['reset', '--hard', 'FETCH_HEAD'], { cwd: workspacePath });
			cp.spawnSync('git', ['clean', '-xdf'], { cwd: workspacePath });
		}

		console.log('*** Running yarn...');
		cp.execSync('yarn', { cwd: workspacePath, stdio: 'inherit' });
	}
}

async function setup(): Promise<void> {
	console.log('*** Test data:', testDataPath);
	console.log('*** Preparing smoketest setup...');

	await setupRepository();

	console.log('*** Smoketest setup done!\n');
}

function createOptions(): ApplicationOptions {
	const loggers: Logger[] = [];

	if (opts.verbose) {
		loggers.push(new ConsoleLogger());
	}

	let log: string | undefined = undefined;

	if (opts.log) {
		loggers.push(new FileLogger(opts.log));
		log = 'trace';
	}
	return {
		quality,
		codePath: opts.build,
		workspacePath,
		userDataDir,
		extensionsPath,
		waitTime: parseInt(opts['wait-time'] || '0') || 20,
		logger: new MultiLogger(loggers),
		verbose: opts.verbose,
		log,
		screenshotsPath,
		remote: opts.remote,
		web: opts.web,
		browser: opts.browser
	};
}

before(async function () {
	this.timeout(2 * 60 * 1000); // allow two minutes for setup
	await setup();
	this.defaultOptions = createOptions();
});

after(async function () {
	await new Promise(c => setTimeout(c, 500)); // wait for shutdown

	if (opts.log) {
		const logsDir = path.join(userDataDir, 'logs');
		const destLogsDir = path.join(path.dirname(opts.log), 'logs');
		await new Promise((c, e) => ncp(logsDir, destLogsDir, err => err ? e(err) : c()));
	}

	await new Promise((c, e) => rimraf(testDataPath, { maxBusyTries: 10 }, err => err ? e(err) : c()));
});

describe(`VSCode Smoke Tests (${opts.web ? 'Web' : 'Electron'})`, () => {
	if (screenshotsPath) {
		afterEach(async function () {
			if (this.currentTest.state !== 'failed') {
				return;
			}
			const app = this.app as Application;
			const name = this.currentTest.fullTitle().replace(/[^a-z0-9\-]/ig, '_');

			await app.captureScreenshot(name);
		});
	}

	if (opts.log) {
		beforeEach(async function () {
			const app = this.app as Application;
			const title = this.currentTest.fullTitle();

			app.logger.log('*** Test start:', title);
		});
	}

	if (!opts.web && opts['stable-build']) {
		describe(`Stable vs Insiders Smoke Tests: This test MUST run before releasing by providing the --stable-build command line argument`, () => {
			setupDataMigrationTests(opts['stable-build'], testDataPath);
		});
	}

	describe(`VSCode Smoke Tests (${opts.web ? 'Web' : 'Electron'})`, () => {
		before(async function () {
			const app = new Application(this.defaultOptions);
			await app!.start(opts.web ? false : undefined);
			this.app = app;
		});

		after(async function () {
			await this.app.stop();
		});

		if (!opts.web) { setupDataLossTests(); }
		if (!opts.web) { setupDataPreferencesTests(); }
		setupDataSearchTests();
		setupDataNotebookTests();
		setupDataLanguagesTests();
		setupDataEditorTests();
		setupDataStatusbarTests(!!opts.web);
		if (!opts.web) { setupDataExtensionTests(); }
		if (!opts.web) { setupDataMultirootTests(); }
		if (!opts.web) { setupDataLocalizationTests(); }
		if (!opts.web) { setupLaunchTests(); }
	});
});

