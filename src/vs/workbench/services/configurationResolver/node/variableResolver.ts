/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as paths from 'vs/base/common/paths';
import * as types from 'vs/base/common/types';
import { IStringDictionary } from 'vs/base/common/collections';
import { relative } from 'path';
import { IProcessEnvironment, isWindows } from 'vs/base/common/platform';
import { normalizeDriveLetter } from 'vs/base/common/labels';
import { localize } from 'vs/nls';
import uri from 'vs/base/common/uri';

export interface IVariableAccessor {
	getFolderUri(folderName: string): uri | undefined;
	getWorkspaceFolderCount(): number;
	getConfigurationValue(folderUri: uri, section: string): string | undefined;
	getExecPath(): string | undefined;
	getFilePath(): string | undefined;
	getSelectedText(): string | undefined;
	getLineNumber(): string;
}

export class VariableResolver {

	static VARIABLE_REGEXP = /\$\{(.*?)\}/g;

	private envVariables: IProcessEnvironment;

	constructor(
		private accessor: IVariableAccessor,
		envVariables: IProcessEnvironment
	) {
		if (isWindows) {
			this.envVariables = Object.create(null);
			Object.keys(envVariables).forEach(key => {
				this.envVariables[key.toLowerCase()] = envVariables[key];
			});
		} else {
			this.envVariables = envVariables;
		}
	}

	resolveAny(folderUri: uri, value: any, commandValueMapping?: IStringDictionary<string>): any {
		if (types.isString(value)) {
			return this.resolve(folderUri, value, commandValueMapping);
		} else if (types.isArray(value)) {
			return value.map(s => this.resolveAny(folderUri, s, commandValueMapping));
		} else if (types.isObject(value)) {
			let result: IStringDictionary<string | IStringDictionary<string> | string[]> = Object.create(null);
			Object.keys(value).forEach(key => {
				const resolvedKey = this.resolve(folderUri, key, commandValueMapping);
				result[resolvedKey] = this.resolveAny(folderUri, value[key], commandValueMapping);
			});
			return result;
		}
		return value;
	}

	resolve(folderUri: uri, value: string, commandValueMapping: IStringDictionary<string>): string {

		const filePath = this.accessor.getFilePath();

		return value.replace(VariableResolver.VARIABLE_REGEXP, (match: string, variable: string) => {

			const replaceInResolvedVariable: boolean = variable.split('/').length === 3;
			if (replaceInResolvedVariable) {
				return this.findReplaceInVariable(folderUri, variable);
			}
			let argument: string;
			const parts = variable.split(':');
			if (parts && parts.length > 1) {
				variable = parts[0];
				argument = parts[1];
			}

			switch (variable) {

				case 'env':
					if (argument) {
						if (isWindows) {
							argument = argument.toLowerCase();
						}
						const env = this.envVariables[argument];
						if (types.isString(env)) {
							return env;
						}
						// For `env` we should do the same as a normal shell does - evaluates missing envs to an empty string #46436
						return '';
					}
					throw new Error(localize('missingEnvVarName', "'{0}' can not be resolved because no environment variable name is given.", match));

				case 'config':
					if (argument) {
						const config = this.accessor.getConfigurationValue(folderUri, argument);
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
					if (argument && commandValueMapping) {
						const v = commandValueMapping[argument];
						if (typeof v === 'string') {
							return v;
						}
						throw new Error(localize('noValueForCommand', "'{0}' can not be resolved because the command has no value.", match));
					}
					return match;

				default: {

					// common error handling for all variables that require an open folder and accept a folder name argument
					switch (variable) {
						case 'workspaceRoot':
						case 'workspaceFolder':
						case 'workspaceRootFolderName':
						case 'workspaceFolderBasename':
						case 'relativeFile':
							if (argument) {
								const folder = this.accessor.getFolderUri(argument);
								if (folder) {
									folderUri = folder;
								} else {
									throw new Error(localize('canNotFindFolder', "'{0}' can not be resolved. No such folder '{1}'.", match, argument));
								}
							}
							if (!folderUri) {
								if (this.accessor.getWorkspaceFolderCount() > 1) {
									throw new Error(localize('canNotResolveWorkspaceFolderMultiRoot', "'{0}' can not be resolved in a multi folder workspace. Scope this variable using ':' and a workspace folder name.", match));
								}
								throw new Error(localize('canNotResolveWorkspaceFolder', "'{0}' can not be resolved. Please open a folder.", match));
							}
							break;
						default:
							break;
					}

					// common error handling for all variables that require an open file
					switch (variable) {
						case 'file':
						case 'relativeFile':
						case 'fileDirname':
						case 'fileExtname':
						case 'fileBasename':
						case 'fileBasenameNoExtension':
							if (!filePath) {
								throw new Error(localize('canNotResolveFile', "'{0}' can not be resolved. Please open an editor.", match));
							}
							break;
						default:
							break;
					}

					switch (variable) {
						case 'workspaceRoot':
						case 'workspaceFolder':
							return normalizeDriveLetter(folderUri.fsPath);

						case 'cwd':
							return folderUri ? normalizeDriveLetter(folderUri.fsPath) : process.cwd();

						case 'workspaceRootFolderName':
						case 'workspaceFolderBasename':
							return paths.basename(folderUri.fsPath);

						case 'lineNumber':
							const lineNumber = this.accessor.getLineNumber();
							if (lineNumber) {
								return lineNumber;
							}
							throw new Error(localize('canNotResolveLineNumber', "'{0}' can not be resolved. Make sure to have a line selected in the active editor.", match));

						case 'selectedText':
							const selectedText = this.accessor.getSelectedText();
							if (selectedText) {
								return selectedText;
							}
							throw new Error(localize('canNotResolveSelectedText', "'{0}' can not be resolved. Make sure to have some text selected in the active editor.", match));

						case 'file':
							return filePath;

						case 'relativeFile':
							if (folderUri) {
								return paths.normalize(relative(folderUri.fsPath, filePath));
							}
							return filePath;

						case 'fileDirname':
							return paths.dirname(filePath);

						case 'fileExtname':
							return paths.extname(filePath);

						case 'fileBasename':
							return paths.basename(filePath);

						case 'fileBasenameNoExtension':
							const basename = paths.basename(filePath);
							return basename.slice(0, basename.length - paths.extname(basename).length);

						case 'execPath':
							const ep = this.accessor.getExecPath();
							if (ep) {
								return ep;
							}
							return match;

						default:
							return match;
					}
				}
			}
		});
	}

	private findReplaceInVariable(folderUri: uri, variable: string): string {
		const parts = variable.split('/');
		const resolvedVariable = this.resolveAny(folderUri, `\${${parts[0]}}`);
		return resolvedVariable.replace(parts[1], parts[2]);
	}
}
