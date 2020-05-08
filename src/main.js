/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const perf = require('./vs/base/common/performance');
const lp = require('./vs/base/node/languagePacks');

perf.mark('main:started');

const path = require('path');
const fs = require('fs');
const os = require('os');
const bootstrap = require('./bootstrap');
const paths = require('./paths');
// @ts-ignore
const product = require('../product.json');
// @ts-ignore
const { app, protocol } = require('electron');

// Enable portable support
const portable = bootstrap.configurePortable();

// Enable ASAR support
bootstrap.enableASARSupport();

// Set userData path before app 'ready' event
const args = parseCLIArgs();
const userDataPath = getUserDataPath(args);
app.setPath('userData', userDataPath);

// Set temp directory based on crash-reporter-directory CLI argument
// The crash reporter will store crashes in temp folder so we need
// to change that location accordingly.

// If a crash-reporter-directory is specified we setup the crash reporter
// right from the beginning as early as possible to monitor all processes.
let crashReporterDirectory = args['crash-reporter-directory'];
if (crashReporterDirectory) {
	crashReporterDirectory = path.normalize(crashReporterDirectory);

	if (!fs.existsSync(crashReporterDirectory)) {
		try {
			fs.mkdirSync(crashReporterDirectory);
		} catch (error) {
			console.error(`The path '${crashReporterDirectory}' specified for --crash-reporter-directory does not seem to exist or cannot be created.`);
			app.exit(1);
		}
	}

	// Crashes are stored in the temp directory by default, so we
	// need to change that directory to the provided one
	console.log(`Found --crash-reporter-directory argument. Setting temp directory to be '${crashReporterDirectory}'`);
	app.setPath('temp', crashReporterDirectory);

	// Start crash reporter
	const { crashReporter } = require('electron');
	crashReporter.start({
		companyName: 'Microsoft',
		productName: product.nameShort,
		submitURL: '',
		uploadToServer: false
	});
}

// Set logs path before app 'ready' event if running portable
// to ensure that no 'logs' folder is created on disk at a
// location outside of the portable directory
// (https://github.com/microsoft/vscode/issues/56651)
if (portable.isPortable) {
	app.setAppLogsPath(path.join(userDataPath, 'logs'));
}

// Update cwd based on environment and platform
setCurrentWorkingDirectory();

// Register custom schemes with privileges
protocol.registerSchemesAsPrivileged([
	{ scheme: 'vscode-resource', privileges: { secure: true, supportFetchAPI: true, corsEnabled: true } }
]);

// Global app listeners
registerListeners();

// Cached data
const nodeCachedDataDir = getNodeCachedDir();

// Configure static command line arguments
const argvConfig = configureCommandlineSwitchesSync(args);

// Remove env set by snap https://github.com/microsoft/vscode/issues/85344
if (process.env['SNAP']) {
	delete process.env['GDK_PIXBUF_MODULE_FILE'];
	delete process.env['GDK_PIXBUF_MODULEDIR'];
}

/**
 * Support user defined locale: load it early before app('ready')
 * to have more things running in parallel.
 *
 * @type {Promise<import('./vs/base/node/languagePacks').NLSConfiguration>} nlsConfig | undefined
 */
let nlsConfigurationPromise = undefined;

const metaDataFile = path.join(__dirname, 'nls.metadata.json');
const locale = getUserDefinedLocale(argvConfig);
if (locale) {
	nlsConfigurationPromise = lp.getNLSConfiguration(product.commit, userDataPath, metaDataFile, locale);
}

// Load our code once ready
app.once('ready', function () {
	if (args['trace']) {
		// @ts-ignore
		const contentTracing = require('electron').contentTracing;

		const traceOptions = {
			categoryFilter: args['trace-category-filter'] || '*',
			traceOptions: args['trace-options'] || 'record-until-full,enable-sampling'
		};

		contentTracing.startRecording(traceOptions).finally(() => onReady());
	} else {
		onReady();
	}
});

/**
 * Main startup routine
 *
 * @param {string | undefined} cachedDataDir
 * @param {import('./vs/base/node/languagePacks').NLSConfiguration} nlsConfig
 */
function startup(cachedDataDir, nlsConfig) {
	nlsConfig._languagePackSupport = true;

	process.env['VSCODE_NLS_CONFIG'] = JSON.stringify(nlsConfig);
	process.env['VSCODE_NODE_CACHED_DATA_DIR'] = cachedDataDir || '';

	// Load main in AMD
	perf.mark('willLoadMainBundle');
	require('./bootstrap-amd').load('vs/code/electron-main/main', () => {
		perf.mark('didLoadMainBundle');
	});
}

async function onReady() {
	perf.mark('main:appReady');

	try {
		const [cachedDataDir, nlsConfig] = await Promise.all([nodeCachedDataDir.ensureExists(), resolveNlsConfiguration()]);

		startup(cachedDataDir, nlsConfig);
	} catch (error) {
		console.error(error);
	}
}

/**
 * @typedef	 {{ [arg: string]: any; '--'?: string[]; _: string[]; }} ParsedArgs
 *
 * @param {ParsedArgs} cliArgs
 */
function configureCommandlineSwitchesSync(cliArgs) {
	const SUPPORTED_ELECTRON_SWITCHES = [

		// alias from us for --disable-gpu
		'disable-hardware-acceleration',

		// provided by Electron
		'disable-color-correct-rendering',

		// override for the color profile to use
		'force-color-profile'
	];

	if (process.platform === 'linux') {
		SUPPORTED_ELECTRON_SWITCHES.push('force-renderer-accessibility');
	}

	// Read argv config
	const argvConfig = readArgvConfigSync();

	// Append each flag to Electron
	Object.keys(argvConfig).forEach(argvKey => {
		if (SUPPORTED_ELECTRON_SWITCHES.indexOf(argvKey) === -1) {
			return; // unsupported argv key
		}

		const argvValue = argvConfig[argvKey];

		// Color profile
		if (argvKey === 'force-color-profile') {
			if (argvValue) {
				app.commandLine.appendSwitch(argvKey, argvValue);
			}
		}

		// Others
		else if (argvValue === true || argvValue === 'true') {
			if (argvKey === 'disable-hardware-acceleration') {
				app.disableHardwareAcceleration(); // needs to be called explicitly
			} else {
				app.commandLine.appendSwitch(argvKey);
			}
		}
	});

	// Support JS Flags
	const jsFlags = getJSFlags(cliArgs);
	if (jsFlags) {
		app.commandLine.appendSwitch('js-flags', jsFlags);
	}

	// TODO@Deepak Electron 7 workaround for https://github.com/microsoft/vscode/issues/88873
	app.commandLine.appendSwitch('disable-features', 'LayoutNG');

	return argvConfig;
}

function readArgvConfigSync() {

	// Read or create the argv.json config file sync before app('ready')
	const argvConfigPath = getArgvConfigPath();
	let argvConfig;
	try {
		argvConfig = JSON.parse(stripComments(fs.readFileSync(argvConfigPath).toString()));
	} catch (error) {
		if (error && error.code === 'ENOENT') {
			createDefaultArgvConfigSync(argvConfigPath);
		} else {
			console.warn(`Unable to read argv.json configuration file in ${argvConfigPath}, falling back to defaults (${error})`);
		}
	}

	// Fallback to default
	if (!argvConfig) {
		argvConfig = {
			'disable-color-correct-rendering': true // Force pre-Chrome-60 color profile handling (for https://github.com/Microsoft/vscode/issues/51791)
		};
	}

	return argvConfig;
}

/**
 * @param {string} argvConfigPath
 */
function createDefaultArgvConfigSync(argvConfigPath) {
	try {

		// Ensure argv config parent exists
		const argvConfigPathDirname = path.dirname(argvConfigPath);
		if (!fs.existsSync(argvConfigPathDirname)) {
			fs.mkdirSync(argvConfigPathDirname);
		}

		// Migrate over legacy locale
		const localeConfigPath = path.join(userDataPath, 'User', 'locale.json');
		const legacyLocale = getLegacyUserDefinedLocaleSync(localeConfigPath);
		if (legacyLocale) {
			try {
				fs.unlinkSync(localeConfigPath);
			} catch (error) {
				//ignore
			}
		}

		// Default argv content
		const defaultArgvConfigContent = [
			'// This configuration file allows you to pass permanent command line arguments to VS Code.',
			'// Only a subset of arguments is currently supported to reduce the likelyhood of breaking',
			'// the installation.',
			'//',
			'// PLEASE DO NOT CHANGE WITHOUT UNDERSTANDING THE IMPACT',
			'//',
			'// NOTE: Changing this file requires a restart of VS Code.',
			'{',
			'	// Use software rendering instead of hardware accelerated rendering.',
			'	// This can help in cases where you see rendering issues in VS Code.',
			'	// "disable-hardware-acceleration": true,',
			'',
			'	// Enabled by default by VS Code to resolve color issues in the renderer',
			'	// See https://github.com/Microsoft/vscode/issues/51791 for details',
			'	"disable-color-correct-rendering": true'
		];

		if (legacyLocale) {
			defaultArgvConfigContent[defaultArgvConfigContent.length - 1] = `${defaultArgvConfigContent[defaultArgvConfigContent.length - 1]},`; // append trailing ","

			defaultArgvConfigContent.push('');
			defaultArgvConfigContent.push('	// Display language of VS Code');
			defaultArgvConfigContent.push(`	"locale": "${legacyLocale}"`);
		}

		defaultArgvConfigContent.push('}');

		// Create initial argv.json with default content
		fs.writeFileSync(argvConfigPath, defaultArgvConfigContent.join('\n'));
	} catch (error) {
		console.error(`Unable to create argv.json configuration file in ${argvConfigPath}, falling back to defaults (${error})`);
	}
}

function getArgvConfigPath() {
	const vscodePortable = process.env['VSCODE_PORTABLE'];
	if (vscodePortable) {
		return path.join(vscodePortable, 'argv.json');
	}

	let dataFolderName = product.dataFolderName;
	if (process.env['VSCODE_DEV']) {
		dataFolderName = `${dataFolderName}-dev`;
	}

	return path.join(os.homedir(), dataFolderName, 'argv.json');
}

/**
 * @param {ParsedArgs} cliArgs
 * @returns {string}
 */
function getJSFlags(cliArgs) {
	const jsFlags = [];

	// Add any existing JS flags we already got from the command line
	if (cliArgs['js-flags']) {
		jsFlags.push(cliArgs['js-flags']);
	}

	// Support max-memory flag
	if (cliArgs['max-memory'] && !/max_old_space_size=(\d+)/g.exec(cliArgs['js-flags'])) {
		jsFlags.push(`--max_old_space_size=${cliArgs['max-memory']}`);
	}

	return jsFlags.length > 0 ? jsFlags.join(' ') : null;
}

/**
 * @param {ParsedArgs} cliArgs
 *
 * @returns {string}
 */
function getUserDataPath(cliArgs) {
	if (portable.isPortable) {
		return path.join(portable.portableDataPath, 'user-data');
	}

	return path.resolve(cliArgs['user-data-dir'] || paths.getDefaultUserDataPath(process.platform));
}

/**
 * @returns {ParsedArgs}
 */
function parseCLIArgs() {
	const minimist = require('minimist');

	return minimist(process.argv, {
		string: [
			'user-data-dir',
			'locale',
			'js-flags',
			'max-memory',
			'crash-reporter-directory'
		]
	});
}

function setCurrentWorkingDirectory() {
	try {
		if (process.platform === 'win32') {
			process.env['VSCODE_CWD'] = process.cwd(); // remember as environment variable
			process.chdir(path.dirname(app.getPath('exe'))); // always set application folder as cwd
		} else if (process.env['VSCODE_CWD']) {
			process.chdir(process.env['VSCODE_CWD']);
		}
	} catch (err) {
		console.error(err);
	}
}

function registerListeners() {

	/**
	 * macOS: when someone drops a file to the not-yet running VSCode, the open-file event fires even before
	 * the app-ready event. We listen very early for open-file and remember this upon startup as path to open.
	 *
	 * @type {string[]}
	 */
	const macOpenFiles = [];
	global['macOpenFiles'] = macOpenFiles;
	app.on('open-file', function (event, path) {
		macOpenFiles.push(path);
	});

	/**
	 * macOS: react to open-url requests.
	 *
	 * @type {string[]}
	 */
	const openUrls = [];
	const onOpenUrl = function (event, url) {
		event.preventDefault();

		openUrls.push(url);
	};

	app.on('will-finish-launching', function () {
		app.on('open-url', onOpenUrl);
	});

	global['getOpenUrls'] = function () {
		app.removeListener('open-url', onOpenUrl);

		return openUrls;
	};
}

/**
 * @returns {{ ensureExists: () => Promise<string | undefined> }}
 */
function getNodeCachedDir() {
	return new class {

		constructor() {
			this.value = this._compute();
		}

		async ensureExists() {
			try {
				await bootstrap.mkdirp(this.value);

				return this.value;
			} catch (error) {
				// ignore
			}
		}

		_compute() {
			if (process.argv.indexOf('--no-cached-data') > 0) {
				return undefined;
			}

			// IEnvironmentService.isBuilt
			if (process.env['VSCODE_DEV']) {
				return undefined;
			}

			// find commit id
			const commit = product.commit;
			if (!commit) {
				return undefined;
			}

			return path.join(userDataPath, 'CachedData', commit);
		}
	};
}

//#region NLS Support
/**
 * Resolve the NLS configuration
 *
 * @return {Promise<import('./vs/base/node/languagePacks').NLSConfiguration>}
 */
async function resolveNlsConfiguration() {

	// First, we need to test a user defined locale. If it fails we try the app locale.
	// If that fails we fall back to English.
	let nlsConfiguration = nlsConfigurationPromise ? await nlsConfigurationPromise : undefined;
	if (!nlsConfiguration) {

		// Try to use the app locale. Please note that the app locale is only
		// valid after we have received the app ready event. This is why the
		// code is here.
		let appLocale = app.getLocale();
		if (!appLocale) {
			nlsConfiguration = { locale: 'en', availableLanguages: {} };
		} else {

			// See above the comment about the loader and case sensitiviness
			appLocale = appLocale.toLowerCase();

			nlsConfiguration = await lp.getNLSConfiguration(product.commit, userDataPath, metaDataFile, appLocale);
			if (!nlsConfiguration) {
				nlsConfiguration = { locale: appLocale, availableLanguages: {} };
			}
		}
	} else {
		// We received a valid nlsConfig from a user defined locale
	}

	return nlsConfiguration;
}

/**
 * @param {string} content
 * @returns {string}
 */
function stripComments(content) {
	const regexp = /("(?:[^\\"]*(?:\\.)?)*")|('(?:[^\\']*(?:\\.)?)*')|(\/\*(?:\r?\n|.)*?\*\/)|(\/{2,}.*?(?:(?:\r?\n)|$))/g;

	return content.replace(regexp, function (match, m1, m2, m3, m4) {
		// Only one of m1, m2, m3, m4 matches
		if (m3) {
			// A block comment. Replace with nothing
			return '';
		} else if (m4) {
			// A line comment. If it ends in \r?\n then keep it.
			const length_1 = m4.length;
			if (length_1 > 2 && m4[length_1 - 1] === '\n') {
				return m4[length_1 - 2] === '\r' ? '\r\n' : '\n';
			}
			else {
				return '';
			}
		} else {
			// We match a string
			return match;
		}
	});
}

/**
 * Language tags are case insensitive however an amd loader is case sensitive
 * To make this work on case preserving & insensitive FS we do the following:
 * the language bundles have lower case language tags and we always lower case
 * the locale we receive from the user or OS.
 *
 * @param {{ locale: string | undefined; }} argvConfig
 * @returns {string | undefined}
 */
function getUserDefinedLocale(argvConfig) {
	const locale = args['locale'];
	if (locale) {
		return locale.toLowerCase(); // a directly provided --locale always wins
	}

	return argvConfig.locale && typeof argvConfig.locale === 'string' ? argvConfig.locale.toLowerCase() : undefined;
}

/**
 * @param {string} localeConfigPath
 * @returns {string | undefined}
 */
function getLegacyUserDefinedLocaleSync(localeConfigPath) {
	try {
		const content = stripComments(fs.readFileSync(localeConfigPath).toString());

		const value = JSON.parse(content).locale;
		return value && typeof value === 'string' ? value.toLowerCase() : undefined;
	} catch (error) {
		// ignore
	}
}
//#endregion
