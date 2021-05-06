/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

//@ts-check
'use strict';

const performance = require('./vs/base/common/performance');
performance.mark('code/fork/start');

const bootstrap = require('./bootstrap');
const bootstrapNode = require('./bootstrap-node');

// Remove global paths from the node module lookup
bootstrapNode.removeGlobalNodeModuleLookupPaths();

// Enable ASAR in our forked processes
bootstrap.enableASARSupport(undefined);

if (process.env['VSCODE_INJECT_NODE_MODULE_LOOKUP_PATH']) {
	bootstrapNode.injectNodeModuleLookupPath(process.env['VSCODE_INJECT_NODE_MODULE_LOOKUP_PATH']);
}

// Configure: pipe logging to parent process
if (!!process.send && process.env['VSCODE_PIPE_LOGGING'] === 'true') {
	pipeLoggingToParent();
}

// Handle Exceptions
if (!process.env['VSCODE_HANDLES_UNCAUGHT_ERRORS']) {
	handleExceptions();
}

// Terminate when parent terminates
if (process.env['VSCODE_PARENT_PID']) {
	terminateWhenParentTerminates();
}

// Configure Crash Reporter
configureCrashReporter();

// Load AMD entry point
require('./bootstrap-amd').load(process.env['VSCODE_AMD_ENTRYPOINT']);


//#region Helpers

function pipeLoggingToParent() {
	const MAX_LENGTH = 100000;

	/**
	 * Prevent circular stringify and convert arguments to real array
	 *
	 * @param {IArguments} args
	 */
	function safeToArray(args) {
		const seen = [];
		const argsArray = [];

		// Massage some arguments with special treatment
		if (args.length) {
			for (let i = 0; i < args.length; i++) {

				// Any argument of type 'undefined' needs to be specially treated because
				// JSON.stringify will simply ignore those. We replace them with the string
				// 'undefined' which is not 100% right, but good enough to be logged to console
				if (typeof args[i] === 'undefined') {
					args[i] = 'undefined';
				}

				// Any argument that is an Error will be changed to be just the error stack/message
				// itself because currently cannot serialize the error over entirely.
				else if (args[i] instanceof Error) {
					const errorObj = args[i];
					if (errorObj.stack) {
						args[i] = errorObj.stack;
					} else {
						args[i] = errorObj.toString();
					}
				}

				argsArray.push(args[i]);
			}
		}

		// Add the stack trace as payload if we are told so. We remove the message and the 2 top frames
		// to start the stacktrace where the console message was being written
		if (process.env['VSCODE_LOG_STACK'] === 'true') {
			const stack = new Error().stack;
			if (stack) {
				argsArray.push({ __$stack: stack.split('\n').slice(3).join('\n') });
			}
		}

		try {
			const res = JSON.stringify(argsArray, function (key, value) {

				// Objects get special treatment to prevent circles
				if (isObject(value) || Array.isArray(value)) {
					if (seen.indexOf(value) !== -1) {
						return '[Circular]';
					}

					seen.push(value);
				}

				return value;
			});

			if (res.length > MAX_LENGTH) {
				return 'Output omitted for a large object that exceeds the limits';
			}

			return res;
		} catch (error) {
			return `Output omitted for an object that cannot be inspected ('${error.toString()}')`;
		}
	}

	/**
	 * @param {{ type: string; severity: string; arguments: string; }} arg
	 */
	function safeSend(arg) {
		try {
			if (process.send) {
				process.send(arg);
			}
		} catch (error) {
			// Can happen if the parent channel is closed meanwhile
		}
	}

	/**
	 * @param {unknown} obj
	 */
	function isObject(obj) {
		return typeof obj === 'object'
			&& obj !== null
			&& !Array.isArray(obj)
			&& !(obj instanceof RegExp)
			&& !(obj instanceof Date);
	}

	/**
	 *
	 * @param {'log' | 'warn' | 'error'} severity
	 * @param {string} args
	 */
	function safeSendConsoleMessage(severity, args) {
		safeSend({ type: '__$console', severity, arguments: args });
	}

	/**
	 * @param {'log' | 'info' | 'warn' | 'error'} method
	 * @param {'log' | 'warn' | 'error'} severity
	 */
	function wrapConsoleMethod(method, severity) {
		if (process.env['VSCODE_LOG_NATIVE'] === 'true') {
			const original = console[method];
			console[method] = function () {
				safeSendConsoleMessage(severity, safeToArray(arguments));

				const stream = method === 'error' || method === 'warn' ? process.stderr : process.stdout;
				stream.write('\nSTART_NATIVE_LOG\n');
				original.apply(console, arguments);
				stream.write('\nEND_NATIVE_LOG\n');
			};
		} else {
			console[method] = function () { safeSendConsoleMessage(severity, safeToArray(arguments)); };
		}
	}

	// Pass console logging to the outside so that we have it in the main side if told so
	if (process.env['VSCODE_VERBOSE_LOGGING'] === 'true') {
		wrapConsoleMethod('info', 'log');
		wrapConsoleMethod('log', 'log');
		wrapConsoleMethod('warn', 'warn');
		wrapConsoleMethod('error', 'error');
	} else if (process.env['VSCODE_LOG_NATIVE'] !== 'true') {
		console.log = function () { /* ignore */ };
		console.warn = function () { /* ignore */ };
		console.info = function () { /* ignore */ };
		wrapConsoleMethod('error', 'error');
	}
}

function handleExceptions() {

	// Handle uncaught exceptions
	process.on('uncaughtException', function (err) {
		console.error('Uncaught Exception: ', err);
	});

	// Handle unhandled promise rejections
	process.on('unhandledRejection', function (reason) {
		console.error('Unhandled Promise Rejection: ', reason);
	});
}

function terminateWhenParentTerminates() {
	const parentPid = Number(process.env['VSCODE_PARENT_PID']);

	if (typeof parentPid === 'number' && !isNaN(parentPid)) {
		setInterval(function () {
			try {
				process.kill(parentPid, 0); // throws an exception if the main process doesn't exist anymore.
			} catch (e) {
				process.exit();
			}
		}, 5000);
	}
}

function configureCrashReporter() {
	const crashReporterOptionsRaw = process.env['VSCODE_CRASH_REPORTER_START_OPTIONS'];
	if (typeof crashReporterOptionsRaw === 'string') {
		try {
			const crashReporterOptions = JSON.parse(crashReporterOptionsRaw);
			if (crashReporterOptions && process['crashReporter'] /* Electron only */) {
				process['crashReporter'].start(crashReporterOptions);
			}
		} catch (error) {
			console.error(error);
		}
	}
}

//#endregion
