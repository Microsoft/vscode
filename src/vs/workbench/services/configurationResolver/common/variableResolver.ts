/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as paths from 'vs/base/common/path';
import * as process from 'vs/base/common/process';
import * as types from 'vs/base/common/types';
import * as objects from 'vs/base/common/objects';
import { IStringDictionary } from 'vs/base/common/collections';
import { IProcessEnvironment, isWindows, isMacintosh, isLinux } from 'vs/base/common/platform';
import { normalizeDriveLetter } from 'vs/base/common/labels';
import { localize } from 'vs/nls';
import { URI as uri } from 'vs/base/common/uri';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';

export interface IVariableResolveContext {
	getFolderUri(folderName: string): uri | undefined;
	getWorkspaceFolderCount(): number;
	getConfigurationValue(folderUri: uri, section: string): string | undefined;
	getExecPath(): string | undefined;
	getFilePath(): string | undefined;
	getSelectedText(): string | undefined;
	getLineNumber(): string | undefined;
}

export class AbstractVariableResolverService implements IConfigurationResolverService {

	static readonly VARIABLE_REGEXP = /\$\{(.*?)\}/g;

	declare readonly _serviceBrand: undefined;

	private _context: IVariableResolveContext;
	private _envVariables?: IProcessEnvironment;
	protected _contributedVariables: Map<string, () => Promise<string | undefined>> = new Map();


	constructor(_context: IVariableResolveContext, _envVariables?: IProcessEnvironment, private _ignoreEditorVariables = false) {
		this._context = _context;
		if (_envVariables) {
			if (isWindows) {
				// windows env variables are case insensitive
				const ev: IProcessEnvironment = Object.create(null);
				this._envVariables = ev;
				Object.keys(_envVariables).forEach(key => {
					ev[key.toLowerCase()] = _envVariables[key];
				});
			} else {
				this._envVariables = _envVariables;
			}
		}
	}

	public resolve(root: IWorkspaceFolder | undefined, value: string): string;
	public resolve(root: IWorkspaceFolder | undefined, value: string[]): string[];
	public resolve(root: IWorkspaceFolder | undefined, value: IStringDictionary<string>): IStringDictionary<string>;
	public resolve(root: IWorkspaceFolder | undefined, value: any): any {
		return this.recursiveResolve(root ? root.uri : undefined, value);
	}

	public resolveAnyBase(workspaceFolder: IWorkspaceFolder | undefined, config: any, commandValueMapping?: IStringDictionary<string>, resolvedVariables?: Map<string, string>): any {

		const result = objects.deepClone(config) as any;

		// hoist platform specific attributes to top level
		if (isWindows && result.windows) {
			Object.keys(result.windows).forEach(key => result[key] = result.windows[key]);
		} else if (isMacintosh && result.osx) {
			Object.keys(result.osx).forEach(key => result[key] = result.osx[key]);
		} else if (isLinux && result.linux) {
			Object.keys(result.linux).forEach(key => result[key] = result.linux[key]);
		}

		// delete all platform specific sections
		delete result.windows;
		delete result.osx;
		delete result.linux;

		// substitute all variables recursively in string values
		return this.recursiveResolve(workspaceFolder ? workspaceFolder.uri : undefined, result, commandValueMapping, resolvedVariables);
	}

	public resolveAny(workspaceFolder: IWorkspaceFolder | undefined, config: any, commandValueMapping?: IStringDictionary<string>): any {
		return this.resolveAnyBase(workspaceFolder, config, commandValueMapping);
	}

	public resolveAnyMap(workspaceFolder: IWorkspaceFolder | undefined, config: any, commandValueMapping?: IStringDictionary<string>): { newConfig: any, resolvedVariables: Map<string, string> } {
		const resolvedVariables = new Map<string, string>();
		const newConfig = this.resolveAnyBase(workspaceFolder, config, commandValueMapping, resolvedVariables);
		return { newConfig, resolvedVariables };
	}

	public resolveWithInteractionReplace(folder: IWorkspaceFolder | undefined, config: any, section?: string, variables?: IStringDictionary<string>): Promise<any> {
		throw new Error('resolveWithInteractionReplace not implemented.');
	}

	public resolveWithInteraction(folder: IWorkspaceFolder | undefined, config: any, section?: string, variables?: IStringDictionary<string>): Promise<Map<string, string> | undefined> {
		throw new Error('resolveWithInteraction not implemented.');
	}

	public contributeVariable(variable: string, resolution: () => Promise<string | undefined>): void {
		if (this._contributedVariables.has(variable)) {
			throw new Error('Variable ' + variable + ' is contributed twice.');
		} else {
			this._contributedVariables.set(variable, resolution);
		}
	}

	private recursiveResolve(folderUri: uri | undefined, value: any, commandValueMapping?: IStringDictionary<string>, resolvedVariables?: Map<string, string>): any {
		if (types.isString(value)) {
			return this.resolveString(folderUri, value, commandValueMapping, resolvedVariables);
		} else if (types.isArray(value)) {
			return value.map(s => this.recursiveResolve(folderUri, s, commandValueMapping, resolvedVariables));
		} else if (types.isObject(value)) {
			let result: IStringDictionary<string | IStringDictionary<string> | string[]> = Object.create(null);
			Object.keys(value).forEach(key => {
				const replaced = this.resolveString(folderUri, key, commandValueMapping, resolvedVariables);
				result[replaced] = this.recursiveResolve(folderUri, value[key], commandValueMapping, resolvedVariables);
			});
			return result;
		}
		return value;
	}

	private resolveString(folderUri: uri | undefined, value: string, commandValueMapping: IStringDictionary<string> | undefined, resolvedVariables?: Map<string, string>): string {

		// loop through all variables occurrences in 'value'
		const replaced = value.replace(AbstractVariableResolverService.VARIABLE_REGEXP, (match: string, variable: string) => {

			let resolvedValue = this.evaluateSingleVariable(match, variable, folderUri, commandValueMapping);

			if (resolvedVariables) {
				resolvedVariables.set(variable, resolvedValue);
			}

			return resolvedValue;
		});

		return replaced;
	}

	private evaluateSingleVariable(match: string, variable: string, folderUri: uri | undefined, commandValueMapping: IStringDictionary<string> | undefined): string {

		// try to separate variable arguments from variable name
		let argument: string | undefined;
		const parts = variable.split(':');
		if (parts.length > 1) {
			variable = parts[0];
			argument = parts[1];
		}

		// common error handling for all variables that require an open editor
		const getFilePath = (): string => {

			const filePath = this._context.getFilePath();
			if (filePath) {
				return filePath;
			}
			throw new Error(localize('canNotResolveFile', "'{0}' can not be resolved. Please open an editor.", match));
		};

		// common error handling for all variables that require an open folder and accept a folder name argument
		const getFolderUri = (withArg = true): uri => {

			if (withArg && argument) {
				const folder = this._context.getFolderUri(argument);
				if (folder) {
					return folder;
				}
				throw new Error(localize('canNotFindFolder', "'{0}' can not be resolved. No such folder '{1}'.", match, argument));
			}

			if (folderUri) {
				return folderUri;
			}

			if (this._context.getWorkspaceFolderCount() > 1) {
				throw new Error(localize('canNotResolveWorkspaceFolderMultiRoot', "'{0}' can not be resolved in a multi folder workspace. Scope this variable using ':' and a workspace folder name.", match));
			}
			throw new Error(localize('canNotResolveWorkspaceFolder', "'{0}' can not be resolved. Please open a folder.", match));
		};


		switch (variable) {

			case 'env':
				if (argument) {
					if (this._envVariables) {
						const env = this._envVariables[isWindows ? argument.toLowerCase() : argument];
						if (types.isString(env)) {
							return env;
						}
					}
					// For `env` we should do the same as a normal shell does - evaluates undefined envs to an empty string #46436
					return '';
				}
				throw new Error(localize('missingEnvVarName', "'{0}' can not be resolved because no environment variable name is given.", match));

			case 'config':
				if (argument) {
					const config = this._context.getConfigurationValue(getFolderUri(false), argument);
					if (types.isUndefinedOrNull(config)) {
						throw new Error(localize('configNotFound', "'{0}' can not be resolved because setting '{1}' not found.", match, argument));
					}
					if (types.isObject(config)) {
						throw new Error(localize('configNoString', "'{0}' can not be resolved because '{1}' is a structured value.", match, argument));
					}
					return config;
				}
				throw new Error(localize('missingConfigName', "'{0}' can not be resolved because no settings name is given.", match));

			case 'command':
				return this.resolveFromMap(match, argument, commandValueMapping, 'command');

			case 'input':
				return this.resolveFromMap(match, argument, commandValueMapping, 'input');

			default: {

				switch (variable) {
					case 'workspaceRoot':
					case 'workspaceFolder':
						return normalizeDriveLetter(getFolderUri().fsPath);

					case 'cwd':
						return ((folderUri || argument) ? normalizeDriveLetter(getFolderUri().fsPath) : process.cwd());

					case 'workspaceRootFolderName':
					case 'workspaceFolderBasename':
						return paths.basename(getFolderUri().fsPath);

					case 'lineNumber':
						if (this._ignoreEditorVariables) {
							return match;
						}
						const lineNumber = this._context.getLineNumber();
						if (lineNumber) {
							return lineNumber;
						}
						throw new Error(localize('canNotResolveLineNumber', "'{0}' can not be resolved. Make sure to have a line selected in the active editor.", match));

					case 'selectedText':
						if (this._ignoreEditorVariables) {
							return match;
						}
						const selectedText = this._context.getSelectedText();
						if (selectedText) {
							return selectedText;
						}
						throw new Error(localize('canNotResolveSelectedText', "'{0}' can not be resolved. Make sure to have some text selected in the active editor.", match));

					case 'file':
						if (this._ignoreEditorVariables) {
							return match;
						}
						return getFilePath();

					case 'relativeFile':
						if (this._ignoreEditorVariables) {
							return match;
						}
						if (folderUri || argument) {
							return paths.normalize(paths.relative(getFolderUri().fsPath, getFilePath()));
						}
						return getFilePath();

					case 'relativeFileDirname':
						if (this._ignoreEditorVariables) {
							return match;
						}
						const dirname = paths.dirname(getFilePath());
						if (folderUri || argument) {
							return paths.normalize(paths.relative(getFolderUri().fsPath, dirname));
						}
						return dirname;

					case 'fileDirname':
						if (this._ignoreEditorVariables) {
							return match;
						}
						return paths.dirname(getFilePath());

					case 'fileExtname':
						if (this._ignoreEditorVariables) {
							return match;
						}
						return paths.extname(getFilePath());

					case 'fileBasename':
						if (this._ignoreEditorVariables) {
							return match;
						}
						return paths.basename(getFilePath());

					case 'fileBasenameNoExtension':
						if (this._ignoreEditorVariables) {
							return match;
						}
						const basename = paths.basename(getFilePath());
						return (basename.slice(0, basename.length - paths.extname(basename).length));

					case 'execPath':
						const ep = this._context.getExecPath();
						if (ep) {
							return ep;
						}
						return match;

					default:
						try {
							return this.resolveFromMap(match, variable, commandValueMapping, undefined);
						} catch (error) {
							return match;
						}
				}
			}
		}
	}

	private resolveFromMap(match: string, argument: string | undefined, commandValueMapping: IStringDictionary<string> | undefined, prefix: string | undefined): string {
		if (argument && commandValueMapping) {
			const v = (prefix === undefined) ? commandValueMapping[argument] : commandValueMapping[prefix + ':' + argument];
			if (typeof v === 'string') {
				return v;
			}
			throw new Error(localize('noValueForCommand', "'{0}' can not be resolved because the command has no value.", match));
		}
		return match;
	}
}
