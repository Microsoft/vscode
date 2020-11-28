/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as objects from 'vs/base/common/objects';
import * as types from 'vs/base/common/types';
import { URI, UriComponents } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IConfigurationRegistry, Extensions, OVERRIDE_PROPERTY_PATTERN, overrideIdentifierFromKey } from 'vs/platform/configuration/common/configurationRegistry';
import { IStringDictionary } from 'vs/base/common/collections';

export const IConfigurationService = createDecorator<IConfigurationService>('configurationService');

export function isConfigurationOverrides(thing: any): thing is IConfigurationOverrides {
	return thing
		&& typeof thing === 'object'
		&& (!thing.overrideIdentifier || typeof thing.overrideIdentifier === 'string')
		&& (!thing.resource || thing.resource instanceof URI);
}

export interface IConfigurationOverrides {
	overrideIdentifier?: string | null;
	resource?: URI | null;
}

export const enum ConfigurationTarget {
	USER = 1,
	USER_LOCAL,
	USER_REMOTE,
	WORKSPACE,
	WORKSPACE_FOLDER,
	DEFAULT,
	MEMORY
}
export function ConfigurationTargetToString(configurationTarget: ConfigurationTarget) {
	switch (configurationTarget) {
		case ConfigurationTarget.USER: return 'USER';
		case ConfigurationTarget.USER_LOCAL: return 'USER_LOCAL';
		case ConfigurationTarget.USER_REMOTE: return 'USER_REMOTE';
		case ConfigurationTarget.WORKSPACE: return 'WORKSPACE';
		case ConfigurationTarget.WORKSPACE_FOLDER: return 'WORKSPACE_FOLDER';
		case ConfigurationTarget.DEFAULT: return 'DEFAULT';
		case ConfigurationTarget.MEMORY: return 'MEMORY';
	}
}

export interface IConfigurationChange {
	keys: string[];
	overrides: [string, string[]][];
}

export interface IConfigurationChangeEvent {

	readonly source: ConfigurationTarget;
	readonly affectedKeys: string[];
	readonly change: IConfigurationChange;

	affectsConfiguration(configuration: string, overrides?: IConfigurationOverrides): boolean;

	// Following data is used for telemetry
	readonly sourceConfig: any;
}

export interface IConfigurationValue<T> {

	readonly defaultValue?: T;
	readonly userValue?: T;
	readonly userLocalValue?: T;
	readonly userRemoteValue?: T;
	readonly workspaceValue?: T;
	readonly workspaceFolderValue?: T;
	readonly memoryValue?: T;
	readonly value?: T;

	readonly default?: { value?: T, override?: T };
	readonly user?: { value?: T, override?: T };
	readonly userLocal?: { value?: T, override?: T };
	readonly userRemote?: { value?: T, override?: T };
	readonly workspace?: { value?: T, override?: T };
	readonly workspaceFolder?: { value?: T, override?: T };
	readonly memory?: { value?: T, override?: T };

	readonly overrideIdentifiers?: string[];
}

export interface IConfigurationService {
	readonly _serviceBrand: undefined;

	onDidChangeConfiguration: Event<IConfigurationChangeEvent>;

	getConfigurationData(): IConfigurationData | null;

	/**
	 * Fetches the value of the section for the given overrides.
	 * Value can be of native type or an object keyed off the section name.
	 *
	 * @param section - Section of the configuraion. Can be `null` or `undefined`.
	 * @param overrides - Overrides that has to be applied while fetching
	 *
	 */
	getValue<T>(): T;
	getValue<T>(section: string): T;
	getValue<T>(overrides: IConfigurationOverrides): T;
	getValue<T>(section: string, overrides: IConfigurationOverrides): T;

	updateValue(key: string, value: any): Promise<void>;
	updateValue(key: string, value: any, overrides: IConfigurationOverrides): Promise<void>;
	updateValue(key: string, value: any, target: ConfigurationTarget): Promise<void>;
	updateValue(key: string, value: any, overrides: IConfigurationOverrides, target: ConfigurationTarget, donotNotifyError?: boolean): Promise<void>;

	inspect<T>(key: string, overrides?: IConfigurationOverrides): IConfigurationValue<T>;

	reloadConfiguration(target?: ConfigurationTarget | IWorkspaceFolder): Promise<void>;

	keys(): {
		default: string[];
		user: string[];
		workspace: string[];
		workspaceFolder: string[];
		memory?: string[];
	};
}

export interface IConfigurationModel {
	contents: any;
	keys: string[];
	overrides: IOverrides[];
}

export interface IOverrides {
	keys: string[];
	contents: any;
	identifiers: string[];
}

export interface IConfigurationData {
	defaults: IConfigurationModel;
	user: IConfigurationModel;
	workspace: IConfigurationModel;
	folders: [UriComponents, IConfigurationModel][];
}

export interface IConfigurationCompareResult {
	added: string[];
	removed: string[];
	updated: string[];
	overrides: [string, string[]][];
}

export function compare(from: IConfigurationModel | undefined, to: IConfigurationModel | undefined): IConfigurationCompareResult {
	const added = to
		? from ? to.keys.filter(key => from.keys.indexOf(key) === -1) : [...to.keys]
		: [];
	const removed = from
		? to ? from.keys.filter(key => to.keys.indexOf(key) === -1) : [...from.keys]
		: [];
	const updated: string[] = [];

	if (to && from) {
		for (const key of from.keys) {
			if (to.keys.indexOf(key) !== -1) {
				const value1 = getConfigurationValue(from.contents, key);
				const value2 = getConfigurationValue(to.contents, key);
				if (!objects.equals(value1, value2)) {
					updated.push(key);
				}
			}
		}
	}

	const overrides: [string, string[]][] = [];
	const byOverrideIdentifier = (overrides: IOverrides[]): IStringDictionary<IOverrides> => {
		const result: IStringDictionary<IOverrides> = {};
		for (const override of overrides) {
			for (const identifier of override.identifiers) {
				result[keyFromOverrideIdentifier(identifier)] = override;
			}
		}
		return result;
	};
	const toOverridesByIdentifier: IStringDictionary<IOverrides> = to ? byOverrideIdentifier(to.overrides) : {};
	const fromOverridesByIdentifier: IStringDictionary<IOverrides> = from ? byOverrideIdentifier(from.overrides) : {};

	if (Object.keys(toOverridesByIdentifier).length) {
		for (const key of added) {
			const override = toOverridesByIdentifier[key];
			if (override) {
				overrides.push([overrideIdentifierFromKey(key), override.keys]);
			}
		}
	}
	if (Object.keys(fromOverridesByIdentifier).length) {
		for (const key of removed) {
			const override = fromOverridesByIdentifier[key];
			if (override) {
				overrides.push([overrideIdentifierFromKey(key), override.keys]);
			}
		}
	}

	if (Object.keys(toOverridesByIdentifier).length && Object.keys(fromOverridesByIdentifier).length) {
		for (const key of updated) {
			const fromOverride = fromOverridesByIdentifier[key];
			const toOverride = toOverridesByIdentifier[key];
			if (fromOverride && toOverride) {
				const result = compare({ contents: fromOverride.contents, keys: fromOverride.keys, overrides: [] }, { contents: toOverride.contents, keys: toOverride.keys, overrides: [] });
				overrides.push([overrideIdentifierFromKey(key), [...result.added, ...result.removed, ...result.updated]]);
			}
		}
	}

	return { added, removed, updated, overrides };
}

export function toOverrides(raw: any, conflictReporter: (message: string) => void): IOverrides[] {
	const overrides: IOverrides[] = [];
	for (const key of Object.keys(raw)) {
		if (OVERRIDE_PROPERTY_PATTERN.test(key)) {
			const overrideRaw: any = {};
			for (const keyInOverrideRaw in raw[key]) {
				overrideRaw[keyInOverrideRaw] = raw[key][keyInOverrideRaw];
			}
			overrides.push({
				identifiers: [overrideIdentifierFromKey(key).trim()],
				keys: Object.keys(overrideRaw),
				contents: toValuesTree(overrideRaw, conflictReporter)
			});
		}
	}
	return overrides;
}

export function toValuesTree(properties: { [qualifiedKey: string]: any }, conflictReporter: (message: string) => void): any {
	const root = Object.create(null);

	for (let key in properties) {
		addToValueTree(root, key, properties[key], conflictReporter);
	}

	return root;
}

export function addToValueTree(settingsTreeRoot: any, key: string, value: any, conflictReporter: (message: string) => void): void {
	const segments = key.split('.');
	const last = segments.pop()!;

	let curr = settingsTreeRoot;
	for (let i = 0; i < segments.length; i++) {
		let s = segments[i];
		let obj = curr[s];
		switch (typeof obj) {
			case 'undefined':
				obj = curr[s] = Object.create(null);
				break;
			case 'object':
				break;
			default:
				conflictReporter(`Ignoring ${key} as ${segments.slice(0, i + 1).join('.')} is ${JSON.stringify(obj)}`);
				return;
		}
		curr = obj;
	}

	if (typeof curr === 'object' && curr !== null) {
		try {
			curr[last] = value; // workaround https://github.com/microsoft/vscode/issues/13606
		} catch (e) {
			conflictReporter(`Ignoring ${key} as ${segments.join('.')} is ${JSON.stringify(curr)}`);
		}
	} else {
		conflictReporter(`Ignoring ${key} as ${segments.join('.')} is ${JSON.stringify(curr)}`);
	}
}

export function removeFromValueTree(valueTree: any, key: string): void {
	const segments = key.split('.');
	doRemoveFromValueTree(valueTree, segments);
}

function doRemoveFromValueTree(valueTree: any, segments: string[]): void {
	const first = segments.shift()!;
	if (segments.length === 0) {
		// Reached last segment
		delete valueTree[first];
		return;
	}

	if (Object.keys(valueTree).indexOf(first) !== -1) {
		const value = valueTree[first];
		if (typeof value === 'object' && !Array.isArray(value)) {
			doRemoveFromValueTree(value, segments);
			if (Object.keys(value).length === 0) {
				delete valueTree[first];
			}
		}
	}
}

/**
 * A helper function to get the configuration value with a specific settings path (e.g. config.some.setting)
 */
export function getConfigurationValue<T>(config: any, settingPath: string, defaultValue?: T): T {
	function accessSetting(config: any, path: string[]): any {
		let current = config;
		for (const component of path) {
			if (typeof current !== 'object' || current === null) {
				return undefined;
			}
			current = current[component];
		}
		return <T>current;
	}

	const path = settingPath.split('.');
	const result = accessSetting(config, path);

	return typeof result === 'undefined' ? defaultValue : result;
}

export function merge(base: any, add: any, overwrite: boolean): void {
	Object.keys(add).forEach(key => {
		if (key !== '__proto__') {
			if (key in base) {
				if (types.isObject(base[key]) && types.isObject(add[key])) {
					merge(base[key], add[key], overwrite);
				} else if (overwrite) {
					base[key] = add[key];
				}
			} else {
				base[key] = add[key];
			}
		}
	});
}

export function getConfigurationKeys(): string[] {
	const properties = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties();
	return Object.keys(properties);
}

export function getDefaultValues(): any {
	const valueTreeRoot: any = Object.create(null);
	const properties = Registry.as<IConfigurationRegistry>(Extensions.Configuration).getConfigurationProperties();

	for (let key in properties) {
		let value = properties[key].default;
		addToValueTree(valueTreeRoot, key, value, message => console.error(`Conflict in default settings: ${message}`));
	}

	return valueTreeRoot;
}

export function keyFromOverrideIdentifier(overrideIdentifier: string): string {
	return `[${overrideIdentifier}]`;
}

export function getMigratedSettingValue<T>(configurationService: IConfigurationService, currentSettingName: string, legacySettingName: string): T {
	const setting = configurationService.inspect<T>(currentSettingName);
	const legacySetting = configurationService.inspect<T>(legacySettingName);

	if (typeof setting.userValue !== 'undefined' || typeof setting.workspaceValue !== 'undefined' || typeof setting.workspaceFolderValue !== 'undefined') {
		return setting.value!;
	} else if (typeof legacySetting.userValue !== 'undefined' || typeof legacySetting.workspaceValue !== 'undefined' || typeof legacySetting.workspaceFolderValue !== 'undefined') {
		return legacySetting.value!;
	} else {
		return setting.defaultValue!;
	}
}
