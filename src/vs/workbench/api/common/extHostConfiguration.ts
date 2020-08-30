/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mixin, deepClone } from 'vs/base/common/objects';
import { Event, Emitter } from 'vs/base/common/event';
import type * as vscode from 'vscode';
import { ExtHostWorkspace, IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { ExtHostConfigurationShape, MainThreadConfigurationShape, IConfigurationInitData, MainContext } from './extHost.protocol';
import { ConfigurationTarget as ExtHostConfigurationTarget } from './extHostTypes';
import { ConfigurationTarget, IConfigurationChange, IConfigurationData, IConfigurationOverrides } from 'vs/platform/configuration/common/configuration';
import { Configuration, ConfigurationChangeEvent } from 'vs/platform/configuration/common/configurationModels';
import { ConfigurationScope, OVERRIDE_PROPERTY_PATTERN } from 'vs/platform/configuration/common/configurationRegistry';
import { isObject } from 'vs/base/common/types';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { Barrier } from 'vs/base/common/async';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { ILogService } from 'vs/platform/log/common/log';
import { Workspace } from 'vs/platform/workspace/common/workspace';
import { URI } from 'vs/base/common/uri';

function lookUp(tree: any, key: string) {
	if (key) {
		const parts = key.split('.');
		let node = tree;
		for (let i = 0; node && i < parts.length; i++) {
			node = node[parts[i]];
		}
		return node;
	}
}

type ConfigurationInspect<T> = {
	key: string;

	defaultValue?: T;
	globalValue?: T;
	workspaceValue?: T,
	workspaceFolderValue?: T,

	defaultLanguageValue?: T;
	globalLanguageValue?: T;
	workspaceLanguageValue?: T;
	workspaceFolderLanguageValue?: T;

	languageIds?: string[];
};

function isUri(thing: any): thing is vscode.Uri {
	return thing instanceof URI;
}

function isResourceLanguage(thing: any): thing is { uri: URI, languageId: string } {
	return thing
		&& thing.uri instanceof URI
		&& (thing.languageId && typeof thing.languageId === 'string');
}

function isLanguage(thing: any): thing is { languageId: string } {
	return thing
		&& !thing.uri
		&& (thing.languageId && typeof thing.languageId === 'string');
}

function isWorkspaceFolder(thing: any): thing is vscode.WorkspaceFolder {
	return thing
		&& thing.uri instanceof URI
		&& (!thing.name || typeof thing.name === 'string')
		&& (!thing.index || typeof thing.index === 'number');
}

function scopeToOverrides(scope: vscode.ConfigurationScope | undefined | null): IConfigurationOverrides | undefined {
	if (isUri(scope)) {
		return { resource: scope };
	}
	if (isResourceLanguage(scope)) {
		return { resource: scope.uri, overrideIdentifier: scope.languageId };
	}
	if (isLanguage(scope)) {
		return { overrideIdentifier: scope.languageId };
	}
	if (isWorkspaceFolder(scope)) {
		return { resource: scope.uri };
	}
	if (scope === null) {
		return { resource: null };
	}
	return undefined;
}

export class ExtHostConfiguration implements ExtHostConfigurationShape {

	readonly _serviceBrand: undefined;

	private readonly _proxy: MainThreadConfigurationShape;
	private readonly _logService: ILogService;
	private readonly _extHostWorkspace: ExtHostWorkspace;
	private readonly _barrier: Barrier;
	private _actual: ExtHostConfigProvider | null;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostWorkspace extHostWorkspace: IExtHostWorkspace,
		@ILogService logService: ILogService,
	) {
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadConfiguration);
		this._extHostWorkspace = extHostWorkspace;
		this._logService = logService;
		this._barrier = new Barrier();
		this._actual = null;
	}

	public getConfigProvider(): Promise<ExtHostConfigProvider> {
		return this._barrier.wait().then(_ => this._actual!);
	}

	$initializeConfiguration(data: IConfigurationInitData): void {
		this._actual = new ExtHostConfigProvider(this._proxy, this._extHostWorkspace, data, this._logService);
		this._barrier.open();
	}

	$acceptConfigurationChanged(data: IConfigurationInitData, change: IConfigurationChange): void {
		this.getConfigProvider().then(provider => provider.$acceptConfigurationChanged(data, change));
	}
}

export class ExtHostConfigProvider {

	private readonly _onDidChangeConfiguration = new Emitter<vscode.ConfigurationChangeEvent>();
	private readonly _proxy: MainThreadConfigurationShape;
	private readonly _extHostWorkspace: ExtHostWorkspace;
	private _configurationScopes: Map<string, ConfigurationScope | undefined>;
	private _configuration: Configuration;
	private _logService: ILogService;

	constructor(proxy: MainThreadConfigurationShape, extHostWorkspace: ExtHostWorkspace, data: IConfigurationInitData, logService: ILogService) {
		this._proxy = proxy;
		this._logService = logService;
		this._extHostWorkspace = extHostWorkspace;
		this._configuration = Configuration.parse(data);
		this._configurationScopes = this._toMap(data.configurationScopes);
	}

	get onDidChangeConfiguration(): Event<vscode.ConfigurationChangeEvent> {
		return this._onDidChangeConfiguration && this._onDidChangeConfiguration.event;
	}

	$acceptConfigurationChanged(data: IConfigurationInitData, change: IConfigurationChange) {
		const previous = { data: this._configuration.toData(), workspace: this._extHostWorkspace.workspace };
		this._configuration = Configuration.parse(data);
		this._configurationScopes = this._toMap(data.configurationScopes);
		this._onDidChangeConfiguration.fire(this._toConfigurationChangeEvent(change, previous));
	}

	getConfiguration(section?: string, scope?: vscode.ConfigurationScope | null, extensionDescription?: IExtensionDescription): vscode.WorkspaceConfiguration {
		const overrides = scopeToOverrides(scope) || {};
		const config = this._toReadonlyValue(section
			? lookUp(this._configuration.getValue(undefined, overrides, this._extHostWorkspace.workspace), section)
			: this._configuration.getValue(undefined, overrides, this._extHostWorkspace.workspace));

		if (section) {
			this._validateConfigurationAccess(section, overrides, extensionDescription?.identifier);
		}

		function parseConfigurationTarget(arg: boolean | ExtHostConfigurationTarget): ConfigurationTarget | null {
			if (arg === undefined || arg === null) {
				return null;
			}
			if (typeof arg === 'boolean') {
				return arg ? ConfigurationTarget.USER : ConfigurationTarget.WORKSPACE;
			}

			switch (arg) {
				case ExtHostConfigurationTarget.Global: return ConfigurationTarget.USER;
				case ExtHostConfigurationTarget.Workspace: return ConfigurationTarget.WORKSPACE;
				case ExtHostConfigurationTarget.WorkspaceFolder: return ConfigurationTarget.WORKSPACE_FOLDER;
			}
		}

		const result: vscode.WorkspaceConfiguration = {
			has(key: string): boolean {
				return typeof lookUp(config, key) !== 'undefined';
			},
			get: <T>(key: string, defaultValue?: T) => {
				this._validateConfigurationAccess(section ? `${section}.${key}` : key, overrides, extensionDescription?.identifier);
				let result = lookUp(config, key);
				if (typeof result === 'undefined') {
					result = defaultValue;
				} else {
					let clonedConfig: any | undefined = undefined;
					const cloneOnWriteProxy = (target: any, accessor: string): any => {
						let clonedTarget: any | undefined = undefined;
						const cloneTarget = () => {
							clonedConfig = clonedConfig ? clonedConfig : deepClone(config);
							clonedTarget = clonedTarget ? clonedTarget : lookUp(clonedConfig, accessor);
						};
						return isObject(target) ?
							new Proxy(target, {
								get: (target: any, property: PropertyKey) => {
									if (typeof property === 'string' && property.toLowerCase() === 'tojson') {
										cloneTarget();
										return () => clonedTarget;
									}
									if (clonedConfig) {
										clonedTarget = clonedTarget ? clonedTarget : lookUp(clonedConfig, accessor);
										return clonedTarget[property];
									}
									const result = target[property];
									if (typeof property === 'string') {
										return cloneOnWriteProxy(result, `${accessor}.${property}`);
									}
									return result;
								},
								set: (_target: any, property: PropertyKey, value: any) => {
									cloneTarget();
									if (clonedTarget) {
										clonedTarget[property] = value;
									}
									return true;
								},
								deleteProperty: (_target: any, property: PropertyKey) => {
									cloneTarget();
									if (clonedTarget) {
										delete clonedTarget[property];
									}
									return true;
								},
								defineProperty: (_target: any, property: PropertyKey, descriptor: any) => {
									cloneTarget();
									if (clonedTarget) {
										Object.defineProperty(clonedTarget, property, descriptor);
									}
									return true;
								}
							}) : target;
					};
					result = cloneOnWriteProxy(result, key);
				}
				return result;
			},
			update: (key: string, value: any, extHostConfigurationTarget: ExtHostConfigurationTarget | boolean, scopeToLanguage?: boolean) => {
				key = section ? `${section}.${key}` : key;
				const target = parseConfigurationTarget(extHostConfigurationTarget);
				if (value !== undefined) {
					return this._proxy.$updateConfigurationOption(target, key, value, overrides, scopeToLanguage);
				} else {
					return this._proxy.$removeConfigurationOption(target, key, overrides, scopeToLanguage);
				}
			},
			inspect: <T>(key: string): ConfigurationInspect<T> | undefined => {
				key = section ? `${section}.${key}` : key;
				const config = deepClone(this._configuration.inspect<T>(key, overrides, this._extHostWorkspace.workspace));
				if (config) {
					return {
						key,

						defaultValue: config.default?.value,
						globalValue: config.user?.value,
						workspaceValue: config.workspace?.value,
						workspaceFolderValue: config.workspaceFolder?.value,

						defaultLanguageValue: config.default?.override,
						globalLanguageValue: config.user?.override,
						workspaceLanguageValue: config.workspace?.override,
						workspaceFolderLanguageValue: config.workspaceFolder?.override,

						languageIds: config.overrideIdentifiers
					};
				}
				return undefined;
			}
		};

		if (typeof config === 'object') {
			mixin(result, config, false);
		}

		return <vscode.WorkspaceConfiguration>Object.freeze(result);
	}

	private _toReadonlyValue(result: any): any {
		const readonlyProxy = (target: any): any => {
			return isObject(target) ?
				new Proxy(target, {
					get: (target: any, property: PropertyKey) => readonlyProxy(target[property]),
					set: (_target: any, property: PropertyKey, _value: any) => { throw new Error(`TypeError: Cannot assign to read only property '${String(property)}' of object`); },
					deleteProperty: (_target: any, property: PropertyKey) => { throw new Error(`TypeError: Cannot delete read only property '${String(property)}' of object`); },
					defineProperty: (_target: any, property: PropertyKey) => { throw new Error(`TypeError: Cannot define property '${String(property)}' for a readonly object`); },
					setPrototypeOf: (_target: any) => { throw new Error(`TypeError: Cannot set prototype for a readonly object`); },
					isExtensible: () => false,
					preventExtensions: () => true
				}) : target;
		};
		return readonlyProxy(result);
	}

	private _validateConfigurationAccess(key: string, overrides?: IConfigurationOverrides, extensionId?: ExtensionIdentifier): void {
		const scope = OVERRIDE_PROPERTY_PATTERN.test(key) ? ConfigurationScope.RESOURCE : this._configurationScopes.get(key);
		const extensionIdText = extensionId ? `[${extensionId.value}] ` : '';
		if (ConfigurationScope.RESOURCE === scope) {
			if (typeof overrides?.resource === 'undefined') {
				this._logService.warn(`${extensionIdText}Accessing a resource scoped configuration without providing a resource is not expected. To get the effective value for '${key}', provide the URI of a resource or 'null' for any resource.`);
			}
			return;
		}
		if (ConfigurationScope.WINDOW === scope) {
			if (overrides?.resource) {
				this._logService.warn(`${extensionIdText}Accessing a window scoped configuration for a resource is not expected. To associate '${key}' to a resource, define its scope to 'resource' in configuration contributions in 'package.json'.`);
			}
			return;
		}
	}

	private _toConfigurationChangeEvent(change: IConfigurationChange, previous: { data: IConfigurationData, workspace: Workspace | undefined }): vscode.ConfigurationChangeEvent {
		const event = new ConfigurationChangeEvent(change, previous, this._configuration, this._extHostWorkspace.workspace);
		return Object.freeze({
			affectsConfiguration: (section: string, scope?: vscode.ConfigurationScope) => event.affectsConfiguration(section, scopeToOverrides(scope))
		});
	}

	private _toMap(scopes: [string, ConfigurationScope | undefined][]): Map<string, ConfigurationScope | undefined> {
		return scopes.reduce((result, scope) => { result.set(scope[0], scope[1]); return result; }, new Map<string, ConfigurationScope | undefined>());
	}

}

export const IExtHostConfiguration = createDecorator<IExtHostConfiguration>('IExtHostConfiguration');
export interface IExtHostConfiguration extends ExtHostConfiguration { }
