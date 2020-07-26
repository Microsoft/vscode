/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equals } from 'vs/base/common/objects';
import { toValuesTree, IConfigurationModel, IConfigurationOverrides, IConfigurationValue, IConfigurationChange } from 'vs/platform/configuration/common/configuration';
import { Configuration as BaseConfiguration, ConfigurationModelParser, ConfigurationModel } from 'vs/platform/configuration/common/configurationModels';
import { IStoredWorkspaceFolder } from 'vs/platform/workspaces/common/workspaces';
import { Workspace } from 'vs/platform/workspace/common/workspace';
import { ResourceMap } from 'vs/base/common/map';
import { URI } from 'vs/base/common/uri';
import { WORKSPACE_SCOPES } from 'vs/workbench/services/configuration/common/configuration';
import { OVERRIDE_PROPERTY_PATTERN, overrideIdentifierFromKey } from 'vs/platform/configuration/common/configurationRegistry';

export class WorkspaceConfigurationModelParser extends ConfigurationModelParser {

	private _folders: IStoredWorkspaceFolder[] = [];
	private _settingsModelParser: ConfigurationModelParser;
	private _launchModel: ConfigurationModel;
	private _tasksModel: ConfigurationModel;

	constructor(name: string) {
		super(name);
		this._settingsModelParser = new ConfigurationModelParser(name, WORKSPACE_SCOPES);
		this._launchModel = new ConfigurationModel();
		this._tasksModel = new ConfigurationModel();
	}

	get folders(): IStoredWorkspaceFolder[] {
		return this._folders;
	}

	get settingsModel(): ConfigurationModel {
		return this._settingsModelParser.configurationModel;
	}

	get launchModel(): ConfigurationModel {
		return this._launchModel;
	}

	get tasksModel(): ConfigurationModel {
		return this._tasksModel;
	}

	reprocessWorkspaceSettings(): void {
		this._settingsModelParser.parse();
	}

	protected doParseRaw(raw: any): IConfigurationModel {
		this._folders = (raw['folders'] || []) as IStoredWorkspaceFolder[];
		this._settingsModelParser.parseRaw(raw['settings']);
		this._launchModel = this.createConfigurationModelFrom(raw, 'launch');
		this._tasksModel = this.createConfigurationModelFrom(raw, 'tasks');
		return super.doParseRaw(raw);
	}

	private createConfigurationModelFrom(raw: any, key: string): ConfigurationModel {
		const data = raw[key];
		if (data) {
			const contents = toValuesTree(data, message => console.error(`Conflict in settings file ${this._name}: ${message}`));
			const scopedContents = Object.create(null);
			scopedContents[key] = contents;
			const keys = Object.keys(data).map(k => `${key}.${k}`);
			return new ConfigurationModel(scopedContents, keys, []);
		}
		return new ConfigurationModel();
	}
}

export class StandaloneConfigurationModelParser extends ConfigurationModelParser {

	constructor(name: string, private readonly scope: string) {
		super(name);
	}

	protected doParseRaw(raw: any): IConfigurationModel {
		const contents = toValuesTree(raw, message => console.error(`Conflict in settings file ${this._name}: ${message}`));
		const scopedContents = Object.create(null);
		scopedContents[this.scope] = contents;
		const keys = Object.keys(raw).map(key => `${this.scope}.${key}`);
		return { contents: scopedContents, keys, overrides: [] };
	}

}

export class Configuration extends BaseConfiguration {

	constructor(
		defaults: ConfigurationModel,
		localUser: ConfigurationModel,
		remoteUser: ConfigurationModel,
		workspaceConfiguration: ConfigurationModel,
		folders: ResourceMap<ConfigurationModel>,
		memoryConfiguration: ConfigurationModel,
		memoryConfigurationByResource: ResourceMap<ConfigurationModel>,
		private readonly _workspace?: Workspace) {
		super(defaults, localUser, remoteUser, workspaceConfiguration, folders, memoryConfiguration, memoryConfigurationByResource);
	}

	getValue(key: string | undefined, overrides: IConfigurationOverrides = {}): any {
		return super.getValue(key, overrides, this._workspace);
	}

	inspect<C>(key: string, overrides: IConfigurationOverrides = {}): IConfigurationValue<C> {
		return super.inspect(key, overrides, this._workspace);
	}

	keys(): {
		default: string[];
		user: string[];
		workspace: string[];
		workspaceFolder: string[];
	} {
		return super.keys(this._workspace);
	}

	compareAndDeleteFolderConfiguration(folder: URI): IConfigurationChange {
		if (this._workspace && this._workspace.folders.length > 0 && this._workspace.folders[0].uri.toString() === folder.toString()) {
			// Do not remove workspace configuration
			return { keys: [], overrides: [] };
		}
		return super.compareAndDeleteFolderConfiguration(folder);
	}

	compare(other: Configuration): IConfigurationChange {
		const compare = (fromKeys: string[], toKeys: string[], overrideIdentifier?: string): string[] => {
			const keys: string[] = [];
			keys.push(...toKeys.filter(key => fromKeys.indexOf(key) === -1));
			keys.push(...fromKeys.filter(key => toKeys.indexOf(key) === -1));
			keys.push(...fromKeys.filter(key => {
				// Ignore if the key does not exist in both models
				if (toKeys.indexOf(key) === -1) {
					return false;
				}
				// Compare workspace value
				if (!equals(this.getValue(key, { overrideIdentifier }), other.getValue(key, { overrideIdentifier }))) {
					return true;
				}
				// Compare workspace folder value
				return this._workspace && this._workspace.folders.some(folder => !equals(this.getValue(key, { resource: folder.uri, overrideIdentifier }), other.getValue(key, { resource: folder.uri, overrideIdentifier })));
			}));
			return keys;
		};
		const keys = compare(this.allKeys(), other.allKeys());
		const overrides: [string, string[]][] = [];
		for (const key of keys) {
			if (OVERRIDE_PROPERTY_PATTERN.test(key)) {
				const overrideIdentifier = overrideIdentifierFromKey(key);
				overrides.push([overrideIdentifier, compare(this.getAllKeysForOverrideIdentifier(overrideIdentifier), other.getAllKeysForOverrideIdentifier(overrideIdentifier), overrideIdentifier)]);
			}
		}
		return { keys, overrides };
	}

}
