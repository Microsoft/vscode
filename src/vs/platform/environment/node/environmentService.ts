/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEnvironmentService, IDebugParams, IExtensionHostDebugParams, BACKUPS } from 'vs/platform/environment/common/environment';
import { ParsedArgs } from 'vs/platform/environment/node/argv';
import * as crypto from 'crypto';
import * as paths from 'vs/base/node/paths';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as resources from 'vs/base/common/resources';
import { memoize } from 'vs/base/common/decorators';
import product from 'vs/platform/product/common/product';
import { toLocalISOString } from 'vs/base/common/date';
import { isWindows, isLinux, Platform, platform } from 'vs/base/common/platform';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { URI } from 'vs/base/common/uri';

export interface INativeEnvironmentService extends IEnvironmentService {
	args: ParsedArgs;

	appRoot: string;
	execPath: string;

	appSettingsHome: URI;
	userDataPath: string;
	userHome: URI;
	machineSettingsResource: URI;
	backupWorkspacesPath: string;
	nodeCachedDataDir?: string;

	mainIPCHandle: string;
	sharedIPCHandle: string;

	installSourcePath: string;

	extensionsPath?: string;
	extensionsDownloadPath: string;
	builtinExtensionsPath: string;

	driverHandle?: string;
	driverVerbose: boolean;

	disableUpdates: boolean;

	sandbox: boolean;
}

export class EnvironmentService implements INativeEnvironmentService {

	declare readonly _serviceBrand: undefined;

	get args(): ParsedArgs { return this._args; }

	@memoize
	get appRoot(): string { return path.dirname(getPathFromAmdModule(require, '')); }

	get execPath(): string { return this._execPath; }

	@memoize
	get cliPath(): string { return getCLIPath(this.execPath, this.appRoot, this.isBuilt); }

	readonly logsPath: string;

	@memoize
	get userHome(): URI { return URI.file(os.homedir()); }

	@memoize
	get userDataPath(): string {
		const vscodePortable = process.env['VSCODE_PORTABLE'];
		if (vscodePortable) {
			return path.join(vscodePortable, 'user-data');
		}

		return parseUserDataDir(this._args, process);
	}

	@memoize
	get appSettingsHome(): URI { return URI.file(path.join(this.userDataPath, 'User')); }

	@memoize
	get userRoamingDataHome(): URI { return this.appSettingsHome; }

	@memoize
	get settingsResource(): URI { return resources.joinPath(this.userRoamingDataHome, 'settings.json'); }

	@memoize
	get userDataSyncHome(): URI { return resources.joinPath(this.userRoamingDataHome, 'sync'); }

	@memoize
	get userDataSyncLogResource(): URI { return URI.file(path.join(this.logsPath, 'userDataSync.log')); }

	@memoize
	get sync(): 'on' | 'off' | undefined { return this.args.sync; }

	@memoize
	get enableSyncByDefault(): boolean { return false; }

	@memoize
	get machineSettingsResource(): URI { return resources.joinPath(URI.file(path.join(this.userDataPath, 'Machine')), 'settings.json'); }

	@memoize
	get globalStorageHome(): URI { return URI.joinPath(this.appSettingsHome, 'globalStorage'); }

	@memoize
	get workspaceStorageHome(): URI { return URI.joinPath(this.appSettingsHome, 'workspaceStorage'); }

	@memoize
	get keybindingsResource(): URI { return resources.joinPath(this.userRoamingDataHome, 'keybindings.json'); }

	@memoize
	get keyboardLayoutResource(): URI { return resources.joinPath(this.userRoamingDataHome, 'keyboardLayout.json'); }

	@memoize
	get argvResource(): URI {
		const vscodePortable = process.env['VSCODE_PORTABLE'];
		if (vscodePortable) {
			return URI.file(path.join(vscodePortable, 'argv.json'));
		}

		return resources.joinPath(this.userHome, product.dataFolderName, 'argv.json');
	}

	@memoize
	get snippetsHome(): URI { return resources.joinPath(this.userRoamingDataHome, 'snippets'); }

	@memoize
	get isExtensionDevelopment(): boolean { return !!this._args.extensionDevelopmentPath; }

	@memoize
	get backupHome(): URI { return URI.file(path.join(this.userDataPath, BACKUPS)); }

	@memoize
	get backupWorkspacesPath(): string { return path.join(this.backupHome.fsPath, 'workspaces.json'); }

	@memoize
	get untitledWorkspacesHome(): URI { return URI.file(path.join(this.userDataPath, 'Workspaces')); }

	@memoize
	get installSourcePath(): string { return path.join(this.userDataPath, 'installSource'); }

	@memoize
	get builtinExtensionsPath(): string {
		const fromArgs = parsePathArg(this._args['builtin-extensions-dir'], process);
		if (fromArgs) {
			return fromArgs;
		} else {
			return path.normalize(path.join(getPathFromAmdModule(require, ''), '..', 'extensions'));
		}
	}

	get extensionsDownloadPath(): string {
		const fromArgs = parsePathArg(this._args['extensions-download-dir'], process);
		if (fromArgs) {
			return fromArgs;
		} else {
			return path.join(this.userDataPath, 'CachedExtensionVSIXs');
		}
	}

	@memoize
	get extensionsPath(): string {
		const fromArgs = parsePathArg(this._args['extensions-dir'], process);

		if (fromArgs) {
			return fromArgs;
		}

		const vscodeExtensions = process.env['VSCODE_EXTENSIONS'];
		if (vscodeExtensions) {
			return vscodeExtensions;
		}

		const vscodePortable = process.env['VSCODE_PORTABLE'];
		if (vscodePortable) {
			return path.join(vscodePortable, 'extensions');
		}

		return resources.joinPath(this.userHome, product.dataFolderName, 'extensions').fsPath;
	}

	@memoize
	get extensionDevelopmentLocationURI(): URI[] | undefined {
		const s = this._args.extensionDevelopmentPath;
		if (Array.isArray(s)) {
			return s.map(p => {
				if (/^[^:/?#]+?:\/\//.test(p)) {
					return URI.parse(p);
				}
				return URI.file(path.normalize(p));
			});
		}
		return undefined;
	}

	@memoize
	get extensionTestsLocationURI(): URI | undefined {
		const s = this._args.extensionTestsPath;
		if (s) {
			if (/^[^:/?#]+?:\/\//.test(s)) {
				return URI.parse(s);
			}
			return URI.file(path.normalize(s));
		}
		return undefined;
	}

	get disableExtensions(): boolean | string[] {
		if (this._args['disable-extensions']) {
			return true;
		}
		const disableExtensions = this._args['disable-extension'];
		if (disableExtensions) {
			if (typeof disableExtensions === 'string') {
				return [disableExtensions];
			}
			if (Array.isArray(disableExtensions) && disableExtensions.length > 0) {
				return disableExtensions;
			}
		}
		return false;
	}

	get extensionEnabledProposedApi(): string[] | undefined {
		if (Array.isArray(this.args['enable-proposed-api'])) {
			return this.args['enable-proposed-api'];
		}

		if ('enable-proposed-api' in this.args) {
			return [];
		}

		return undefined;
	}

	@memoize
	get debugExtensionHost(): IExtensionHostDebugParams { return parseExtensionHostPort(this._args, this.isBuilt); }
	@memoize
	get logExtensionHostCommunication(): boolean { return !!this.args.logExtensionHostCommunication; }

	get isBuilt(): boolean { return !process.env['VSCODE_DEV']; }
	get verbose(): boolean { return !!this._args.verbose; }
	get logLevel(): string | undefined { return this._args.log; }

	@memoize
	get mainIPCHandle(): string { return getIPCHandle(this.userDataPath, 'main'); }

	@memoize
	get sharedIPCHandle(): string { return getIPCHandle(this.userDataPath, 'shared'); }

	@memoize
	get nodeCachedDataDir(): string | undefined { return process.env['VSCODE_NODE_CACHED_DATA_DIR'] || undefined; }

	@memoize
	get serviceMachineIdResource(): URI { return resources.joinPath(URI.file(this.userDataPath), 'machineid'); }

	get disableUpdates(): boolean { return !!this._args['disable-updates']; }
	get crashReporterId(): string | undefined { return this._args['crash-reporter-id']; }
	get crashReporterDirectory(): string | undefined { return this._args['crash-reporter-directory']; }

	get driverHandle(): string | undefined { return this._args['driver']; }
	get driverVerbose(): boolean { return !!this._args['driver-verbose']; }

	get disableTelemetry(): boolean { return !!this._args['disable-telemetry']; }

	get sandbox(): boolean { return !!this._args['__sandbox']; }

	constructor(private _args: ParsedArgs, private _execPath: string) {
		if (!process.env['VSCODE_LOGS']) {
			const key = toLocalISOString(new Date()).replace(/-|:|\.\d+Z$/g, '');
			process.env['VSCODE_LOGS'] = path.join(this.userDataPath, 'logs', key);
		}

		this.logsPath = process.env['VSCODE_LOGS']!;
	}
}

// Read this before there's any chance it is overwritten
// Related to https://github.com/Microsoft/vscode/issues/30624
export const xdgRuntimeDir = process.env['XDG_RUNTIME_DIR'];

const safeIpcPathLengths: { [platform: number]: number } = {
	[Platform.Linux]: 107,
	[Platform.Mac]: 103
};

function getNixIPCHandle(userDataPath: string, type: string): string {
	const vscodePortable = process.env['VSCODE_PORTABLE'];

	let result: string;
	if (xdgRuntimeDir && !vscodePortable) {
		const scope = crypto.createHash('md5').update(userDataPath).digest('hex').substr(0, 8);
		result = path.join(xdgRuntimeDir, `vscode-${scope}-${product.version}-${type}.sock`);
	} else {
		result = path.join(userDataPath, `${product.version}-${type}.sock`);
	}

	const limit = safeIpcPathLengths[platform];
	if (typeof limit === 'number') {
		if (result.length >= limit) {
			// https://nodejs.org/api/net.html#net_identifying_paths_for_ipc_connections
			console.warn(`WARNING: IPC handle "${result}" is longer than ${limit} chars, try a shorter --user-data-dir`);
		}
	}

	return result;
}

function getWin32IPCHandle(userDataPath: string, type: string): string {
	const scope = crypto.createHash('md5').update(userDataPath).digest('hex');

	return `\\\\.\\pipe\\${scope}-${product.version}-${type}-sock`;
}

function getIPCHandle(userDataPath: string, type: string): string {
	if (isWindows) {
		return getWin32IPCHandle(userDataPath, type);
	}

	return getNixIPCHandle(userDataPath, type);
}

function getCLIPath(execPath: string, appRoot: string, isBuilt: boolean): string {

	// Windows
	if (isWindows) {
		if (isBuilt) {
			return path.join(path.dirname(execPath), 'bin', `${product.applicationName}.cmd`);
		}

		return path.join(appRoot, 'scripts', 'code-cli.bat');
	}

	// Linux
	if (isLinux) {
		if (isBuilt) {
			return path.join(path.dirname(execPath), 'bin', `${product.applicationName}`);
		}

		return path.join(appRoot, 'scripts', 'code-cli.sh');
	}

	// macOS
	if (isBuilt) {
		return path.join(appRoot, 'bin', 'code');
	}

	return path.join(appRoot, 'scripts', 'code-cli.sh');
}

export function parseExtensionHostPort(args: ParsedArgs, isBuild: boolean): IExtensionHostDebugParams {
	return parseDebugPort(args['inspect-extensions'], args['inspect-brk-extensions'], 5870, isBuild, args.debugId);
}

export function parseSearchPort(args: ParsedArgs, isBuild: boolean): IDebugParams {
	return parseDebugPort(args['inspect-search'], args['inspect-brk-search'], 5876, isBuild);
}

function parseDebugPort(debugArg: string | undefined, debugBrkArg: string | undefined, defaultBuildPort: number, isBuild: boolean, debugId?: string): IExtensionHostDebugParams {
	const portStr = debugBrkArg || debugArg;
	const port = Number(portStr) || (!isBuild ? defaultBuildPort : null);
	const brk = port ? Boolean(!!debugBrkArg) : false;

	return { port, break: brk, debugId };
}

export function parsePathArg(arg: string | undefined, process: NodeJS.Process): string | undefined {
	if (!arg) {
		return undefined;
	}

	// Determine if the arg is relative or absolute, if relative use the original CWD
	// (VSCODE_CWD), not the potentially overridden one (process.cwd()).
	const resolved = path.resolve(arg);

	if (path.normalize(arg) === resolved) {
		return resolved;
	}

	return path.resolve(process.env['VSCODE_CWD'] || process.cwd(), arg);
}

export function parseUserDataDir(args: ParsedArgs, process: NodeJS.Process): string {
	return parsePathArg(args['user-data-dir'], process) || path.resolve(paths.getDefaultUserDataPath(process.platform));
}
