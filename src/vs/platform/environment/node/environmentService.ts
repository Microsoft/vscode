/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import { IDebugParams, IExtensionHostDebugParams, INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import * as paths from 'vs/base/node/paths';
import * as path from 'vs/base/common/path';
import * as resources from 'vs/base/common/resources';
import { memoize } from 'vs/base/common/decorators';
import product from 'vs/platform/product/common/product';
import { toLocalISOString } from 'vs/base/common/date';
import { FileAccess } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { createStaticIPCHandle } from 'vs/base/parts/ipc/node/ipc.net';

export class NativeEnvironmentService implements INativeEnvironmentService {

	declare readonly _serviceBrand: undefined;

	get args(): NativeParsedArgs { return this._args; }

	@memoize
	get appRoot(): string { return path.dirname(FileAccess.asFileUri('', require).fsPath); }

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
	get tmpDir(): URI { return URI.file(os.tmpdir()); }

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
	get untitledWorkspacesHome(): URI { return URI.file(path.join(this.userDataPath, 'Workspaces')); }

	@memoize
	get installSourcePath(): string { return path.join(this.userDataPath, 'installSource'); }

	@memoize
	get builtinExtensionsPath(): string {
		const fromArgs = parsePathArg(this._args['builtin-extensions-dir'], process);
		if (fromArgs) {
			return fromArgs;
		} else {
			return path.normalize(path.join(FileAccess.asFileUri('', require).fsPath, '..', 'extensions'));
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

	@memoize
	get debugExtensionHost(): IExtensionHostDebugParams { return parseExtensionHostPort(this._args, this.isBuilt); }
	get debugRenderer(): boolean { return !!this._args.debugRenderer; }

	get isBuilt(): boolean { return !process.env['VSCODE_DEV']; }
	get verbose(): boolean { return !!this._args.verbose; }
	get logLevel(): string | undefined { return this._args.log; }

	@memoize
	get sharedIPCHandle(): string { return createStaticIPCHandle(this.userDataPath, 'shared', product.version); }

	@memoize
	get serviceMachineIdResource(): URI { return resources.joinPath(URI.file(this.userDataPath), 'machineid'); }

	get crashReporterId(): string | undefined { return this._args['crash-reporter-id']; }
	get crashReporterDirectory(): string | undefined { return this._args['crash-reporter-directory']; }

	get driverHandle(): string | undefined { return this._args['driver']; }

	@memoize
	get telemetryLogResource(): URI { return URI.file(path.join(this.logsPath, 'telemetry.log')); }
	get disableTelemetry(): boolean { return !!this._args['disable-telemetry']; }

	constructor(protected _args: NativeParsedArgs) {
		if (!_args.logsPath) {
			const key = toLocalISOString(new Date()).replace(/-|:|\.\d+Z$/g, '');
			_args.logsPath = path.join(this.userDataPath, 'logs', key);
		}
		this.logsPath = _args.logsPath;
	}
}

export function parseExtensionHostPort(args: NativeParsedArgs, isBuild: boolean): IExtensionHostDebugParams {
	return parseDebugPort(args['inspect-extensions'], args['inspect-brk-extensions'], 5870, isBuild, args.debugId);
}

export function parseSearchPort(args: NativeParsedArgs, isBuild: boolean): IDebugParams {
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

export function parseUserDataDir(args: NativeParsedArgs, process: NodeJS.Process): string {
	return parsePathArg(args['user-data-dir'], process) || path.resolve(paths.getDefaultUserDataPath());
}
