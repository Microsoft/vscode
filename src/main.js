/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

/**
 * @typedef {import('./vs/base/common/product').IProductConfiguration} IProductConfiguration
 * @typedef {import('./vs/base/node/languagePacks').NLSConfiguration} NLSConfiguration
 * @typedef {import('./vs/platform/environment/common/argv').NativeParsedArgs} NativeParsedArgs
 */

const perf = require('./vs/base/common/performance');
perf.mark('code/didStartMain');

const path = require('path');
const fs = require('fs');
const os = require('os');
const bootstrap = require('./bootstrap');
const bootstrapNode = require('./bootstrap-node');
const { getUserDataPath } = require('./vs/platform/environment/node/userDataPath');
/** @type {Partial<IProductConfiguration>} */
const product = require('../product.json');
const { app, protocol, crashReporter } = require('electron');

// Disable render process reuse, we still have
// non-context aware native modules in the renderer.
app.allowRendererProcessReuse = false;

// Enable portable support
const portable = bootstrapNode.configurePortable(product);

// Enable ASAR support
bootstrap.enableASARSupport(undefined);

// Set userData path before app 'ready' event
const args = parseCLIArgs();
const userDataPath = getUserDataPath(args);
app.setPath('userData', userDataPath);

// Configure static command line arguments
const argvConfig = configureCommandlineSwitchesSync(args);

// Configure crash reporter
perf.mark('code/willStartCrashReporter');
configureCrashReporter();
perf.mark('code/didStartCrashReporter');

// Set logs path before app 'ready' event if running portable
// to ensure that no 'logs' folder is created on disk at a
// location outside of the portable directory
// (https://github.com/microsoft/vscode/issues/56651)
if (portable && portable.isPortable) {
	app.setAppLogsPath(path.join(userDataPath, 'logs'));
}

// Register custom schemes with privileges
protocol.registerSchemesAsPrivileged([
	{
		scheme: 'vscode-webview',
		privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, allowServiceWorkers: true, }
	},
	{
		scheme: 'vscode-file',
		privileges: { secure: true, standard: true, supportFetchAPI: true, corsEnabled: true }
	}
]);

// Global app listeners
registerListeners();

// Cached data
const nodeCachedDataDir = getNodeCachedDir();

/**
 * Support user defined locale: load it early before app('ready')
 * to have more things running in parallel.
 *
 * @type {Promise<NLSConfiguration> | undefined}
 */
let nlsConfigurationPromise = undefined;

const metaDataFile = path.join(__dirname, 'nls.metadata.json');
const locale = getUserDefinedLocale(argvConfig);
if (locale) {
	const { getNLSConfiguration } = require('./vs/base/node/languagePacks');
	nlsConfigurationPromise = getNLSConfiguration(product.commit, userDataPath, metaDataFile, locale);
}

// Load our code once ready
app.once('ready', function () {
	if (args['trace']) {
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
 * @param {NLSConfiguration} nlsConfig
 */
function startup(cachedDataDir, nlsConfig) {
	nlsConfig._languagePackSupport = true;

	process.env['VSCODE_NLS_CONFIG'] = JSON.stringify(nlsConfig);
	process.env['VSCODE_NODE_CACHED_DATA_DIR'] = cachedDataDir || '';

	// Load main in AMD
	perf.mark('code/willLoadMainBundle');
	require('./bootstrap-amd').load('vs/code/electron-main/main', () => {
		perf.mark('code/didLoadMainBundle');
	});
}

async function onReady() {
	perf.mark('code/mainAppReady');

	try {
		const [cachedDataDir, nlsConfig] = await Promise.all([nodeCachedDataDir.ensureExists(), resolveNlsConfiguration()]);

		startup(cachedDataDir, nlsConfig);
	} catch (error) {
		console.error(error);
	}
}

/**
 * @param {NativeParsedArgs} cliArgs
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

		// Force enable screen readers on Linux via this flag
		SUPPORTED_ELECTRON_SWITCHES.push('force-renderer-accessibility');
	}

	const SUPPORTED_MAIN_PROCESS_SWITCHES = [

		// Persistently enable proposed api via argv.json: https://github.com/microsoft/vscode/issues/99775
		'enable-proposed-api',

		// TODO@sandbox remove me once testing is done on `vscode-file` protocol
		// (all traces of `enable-browser-code-loading` and `VSCODE_BROWSER_CODE_LOADING`)
		'enable-browser-code-loading',

		// Log level to use. Default is 'info'. Allowed values are 'critical', 'error', 'warn', 'info', 'debug', 'trace', 'off'.
		'log-level'
	];

	// Read argv config
	const argvConfig = readArgvConfigSync();

	let browserCodeLoadingStrategy = undefined;

	Object.keys(argvConfig).forEach(argvKey => {
		const argvValue = argvConfig[argvKey];

		// Append Electron flags to Electron
		if (SUPPORTED_ELECTRON_SWITCHES.indexOf(argvKey) !== -1) {

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
		}

		// Append main process flags to process.argv
		else if (SUPPORTED_MAIN_PROCESS_SWITCHES.indexOf(argvKey) !== -1) {
			switch (argvKey) {
				case 'enable-proposed-api':
					if (Array.isArray(argvValue)) {
						argvValue.forEach(id => id && typeof id === 'string' && process.argv.push('--enable-proposed-api', id));
					} else {
						console.error(`Unexpected value for \`enable-proposed-api\` in argv.json. Expected array of extension ids.`);
					}
					break;

				case 'enable-browser-code-loading':
					if (argvValue === false) {
						browserCodeLoadingStrategy = undefined;
					} else if (typeof argvValue === 'string') {
						browserCodeLoadingStrategy = argvValue;
					}
					break;

				case 'log-level':
					if (typeof argvValue === 'string') {
						process.argv.push('--log', argvValue);
					}
					break;
			}
		}
	});

	// Support JS Flags
	const jsFlags = getJSFlags(cliArgs);
	if (jsFlags) {
		app.commandLine.appendSwitch('js-flags', jsFlags);
	}

	// Configure vscode-file:// code loading environment
	if (cliArgs.__sandbox || browserCodeLoadingStrategy) {
		process.env['VSCODE_BROWSER_CODE_LOADING'] = browserCodeLoadingStrategy || 'bypassHeatCheck';
	}

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
			'disable-color-correct-rendering': true // Force pre-Chrome-60 color profile handling (for https://github.com/microsoft/vscode/issues/51791)
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

		// Default argv content
		const defaultArgvConfigContent = [
			'// This configuration file allows you to pass permanent command line arguments to VS Code.',
			'// Only a subset of arguments is currently supported to reduce the likelihood of breaking',
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
			'	// See https://github.com/microsoft/vscode/issues/51791 for details',
			'	"disable-color-correct-rendering": true',
			'}'
		];

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

function configureCrashReporter() {

	// If a crash-reporter-directory is specified we store the crash reports
	// in the specified directory and don't upload them to the crash server.
	let crashReporterDirectory = args['crash-reporter-directory'];
	let submitURL = '';
	if (crashReporterDirectory) {
		crashReporterDirectory = path.normalize(crashReporterDirectory);

		if (!path.isAbsolute(crashReporterDirectory)) {
			console.error(`The path '${crashReporterDirectory}' specified for --crash-reporter-directory must be absolute.`);
			app.exit(1);
		}

		if (!fs.existsSync(crashReporterDirectory)) {
			try {
				fs.mkdirSync(crashReporterDirectory);
			} catch (error) {
				console.error(`The path '${crashReporterDirectory}' specified for --crash-reporter-directory does not seem to exist or cannot be created.`);
				app.exit(1);
			}
		}

		// Crashes are stored in the crashDumps directory by default, so we
		// need to change that directory to the provided one
		console.log(`Found --crash-reporter-directory argument. Setting crashDumps directory to be '${crashReporterDirectory}'`);
		app.setPath('crashDumps', crashReporterDirectory);
	}

	// Otherwise we configure the crash reporter from product.json
	else {
		const appCenter = product.appCenter;
		// Disable Appcenter crash reporting if
		// * --crash-reporter-directory is specified
		// * enable-crash-reporter runtime argument is set to 'false'
		// * --disable-crash-reporter command line parameter is set
		if (appCenter && argvConfig['enable-crash-reporter'] && !args['disable-crash-reporter']) {
			const isWindows = (process.platform === 'win32');
			const isLinux = (process.platform === 'linux');
			const isDarwin = (process.platform === 'darwin');
			const crashReporterId = argvConfig['crash-reporter-id'];
			const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
			if (uuidPattern.test(crashReporterId)) {
				if (isWindows) {
					switch (process.arch) {
						case 'ia32':
							submitURL = appCenter['win32-ia32'];
							break;
						case 'x64':
							submitURL = appCenter['win32-x64'];
							break;
						case 'arm64':
							submitURL = appCenter['win32-arm64'];
							break;
					}
				} else if (isDarwin) {
					if (product.darwinUniversalAssetId) {
						submitURL = appCenter['darwin-universal'];
					} else {
						switch (process.arch) {
							case 'x64':
								submitURL = appCenter['darwin'];
								break;
							case 'arm64':
								submitURL = appCenter['darwin-arm64'];
								break;
						}
					}
				} else if (isLinux) {
					submitURL = appCenter['linux-x64'];
				}
				submitURL = submitURL.concat('&uid=', crashReporterId, '&iid=', crashReporterId, '&sid=', crashReporterId);
				// Send the id for child node process that are explicitly starting crash reporter.
				// For vscode this is ExtensionHost process currently.
				const argv = process.argv;
				const endOfArgsMarkerIndex = argv.indexOf('--');
				if (endOfArgsMarkerIndex === -1) {
					argv.push('--crash-reporter-id', crashReporterId);
				} else {
					// if the we have an argument "--" (end of argument marker)
					// we cannot add arguments at the end. rather, we add
					// arguments before the "--" marker.
					argv.splice(endOfArgsMarkerIndex, 0, '--crash-reporter-id', crashReporterId);
				}
			}
		}
	}

	// Start crash reporter for all processes
	const productName = (product.crashReporter ? product.crashReporter.productName : undefined) || product.nameShort;
	const companyName = (product.crashReporter ? product.crashReporter.companyName : undefined) || 'Microsoft';
	crashReporter.start({
		companyName: companyName,
		productName: process.env['VSCODE_DEV'] ? `${productName} Dev` : productName,
		submitURL,
		uploadToServer: !crashReporterDirectory,
		compress: true
	});
}

/**
 * @param {NativeParsedArgs} cliArgs
 * @returns {string | null}
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
 * @returns {NativeParsedArgs}
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
	const onOpenUrl =
		/**
		 * @param {{ preventDefault: () => void; }} event
		 * @param {string} url
		 */
		function (event, url) {
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
			this.value = this.compute();
		}

		async ensureExists() {
			if (typeof this.value === 'string') {
				try {
					await mkdirp(this.value);

					return this.value;
				} catch (error) {
					// ignore
				}
			}
		}

		compute() {
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

/**
 * @param {string} dir
 * @returns {Promise<string>}
 */
function mkdirp(dir) {
	const fs = require('fs');

	return new Promise((resolve, reject) => {
		fs.mkdir(dir, { recursive: true }, err => (err && err.code !== 'EEXIST') ? reject(err) : resolve(dir));
	});
}

//#region NLS Support

/**
 * Resolve the NLS configuration
 *
 * @return {Promise<NLSConfiguration>}
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

			const { getNLSConfiguration } = require('./vs/base/node/languagePacks');
			nlsConfiguration = await getNLSConfiguration(product.commit, userDataPath, metaDataFile, appLocale);
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

//#endregion
